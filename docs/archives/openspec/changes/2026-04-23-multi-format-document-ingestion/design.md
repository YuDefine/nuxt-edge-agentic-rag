## Context

目前文件 ingestion 的控制路徑有三個明確限制：

- Upload Wizard 前端已放行 `.pdf`，但 server preprocessing 仍只接受 `text/plain` / `text/markdown`
- `/api/documents/sync` 目前直接以 `bucket.getText()` 讀來源物件，隱含假設上傳檔案本身就是文字檔
- replay 真相來源建立在 line-oriented `normalized_text_r2_key` + `source_chunks` + `citationLocator = lines x-y` 之上

因此，本 change 不是單純補幾個副檔名，而是要在既有 replay truth 不失效的前提下，把 rich source 先轉成可預測的 canonical text snapshot，再沿用現有 indexing / publish / answering / MCP replay 契約。

同時，Cloudflare Workers 雖可處理輕量 parser 與 lazy import，但不適合在 request path 內承擔 legacy binary conversion、OCR 或媒體轉錄。這些能力若與 PDF / OOXML 一起綁進第一波 scope，change 將同時碰到 runtime budget、依賴體積、維運邊界與驗收複雜度，難以在單一 change 內可控落地。

## Goals / Non-Goals

**Goals**

- 讓 `.pdf`、`.docx`、`.xlsx`、`.pptx` 能進入與 `md/txt` 一致的 canonical snapshot → replay asset → publish 管線
- 維持 `normalized_text_r2_key` / `source_chunks` 作為唯一 replay truth
- 避免 unsupported / non-replayable rich source 在 sync 失敗後留下 orphan document/version state
- 讓 Upload Wizard 說清楚 direct text、supported rich、deferred format 三種層級

**Non-Goals**

- 不直接支援 `.doc`、`.xls`、`.ppt`
- 不支援音檔 / 影片 transcript ingestion
- 不做 OCR 或 scanned PDF 文字辨識
- 不新增 provider-owned locator truth，也不把 `citationLocator` schema 改成 page/sheet/slide 專屬結構
- 不在這一波引入 Queue / Workflow / 外部 conversion service

## Decisions

### Source Format Tiers And Runtime Boundary

**Decision**: 來源格式明確分成三層，並以此決定是否能在目前 sync 路徑內處理。

| Tier           | Formats                              | Handling                                                     |
| -------------- | ------------------------------------ | ------------------------------------------------------------ |
| direct text    | `.txt`, `.md`                        | 維持現有直接文字正規化                                       |
| supported rich | `.pdf`, `.docx`, `.xlsx`, `.pptx`    | 在 sync 內先抽出 canonical text snapshot，再進 preprocessing |
| deferred       | `.doc`, `.xls`, `.ppt`, audio, video | 直接拒絕；回傳 conversion / transcript guidance              |

**Rationale**:

- `.docx` / `.xlsx` / `.pptx` 屬 OOXML，結構化且可用 JS parser 或 unzip+xml 方式穩定抽文字
- `.pdf` 雖較脆弱，但對中小企業文件是高頻需求；只要明確排除 image-only / scanned PDF，仍值得納入第一波
- `.doc` / `.xls` / `.ppt` 是 legacy binary 格式；若在 Workers request path 內硬 parse，維護與驗收風險遠高於收益
- 音檔與影片天然需要 async transcript pipeline，不應與同步文件 ingestion 混在同一波

**Alternative considered**: 直接把所有 Office / media 都納入同一個「多格式」change。**Rejected** — 會把可控的 canonical snapshot 擴充，和 conversion/transcription 基礎設施耦合在一起，導致 task 數量與驗收面積失控。

### Canonical Snapshot Contract Stays Line-Oriented

**Decision**: rich format extraction 的輸出仍必須收斂為 line-oriented canonical text；`citationLocator` 先維持 `lines x-y`，來源結構資訊改以可讀標記寫進 snapshot 本身。

**Format-specific snapshot rules**:

- PDF：依頁面順序輸出，頁首插入如 `[Page 3]` 的 heading marker；抽不出足夠文字的 PDF 視為 non-replayable
- DOCX：保留段落與 heading 順序；表格以 row-wise 純文字行展開
- XLSX：依 worksheet 順序輸出，插入如 `[Sheet: Revenue]` marker；每列資料以穩定欄位順序轉成單行文字
- PPTX：依投影片順序輸出，插入如 `[Slide 5]` marker；標題與 bullet 逐行輸出

**Rationale**:

- 目前 `document-preprocessing` 的 replay 資產完全建立在 line numbering 上；若第一波就改 schema 為 page / sheet / slide aware locator，會同時碰到 DB、replay、acceptance evidence 與 debug surface
- 將 page / sheet / slide 資訊編進 canonical text，可在不破壞既有 truth source 的情況下，讓管理員與答辯材料看得出 rich source 的來源脈絡

**Alternative considered**: 直接把 `citationLocator` 改成結構化 JSON（例如 `page=3`, `sheet=A`）。**Rejected** — 這是值得做的第二階段，但不該和第一波格式擴充同時發生。

### Sync Orchestration Rejects Unsupported Formats Before Version Creation

**Decision**: `syncDocumentVersionSnapshot` 必須先完成 source extraction，再建立新 document shell / version row；unsupported format 或 extraction 失敗都應在版本建立前返回 4xx。

**Required changes**:

- `/api/documents/sync` 依 MIME 分流讀取 raw object：text 類繼續走 `getText()`；rich 類改走 bytes / arrayBuffer
- 新增 extraction utility，負責把 source object 轉成 canonical text snapshot
- 若 extraction 失敗：
  - 新 document 不得先建立 `documents` row
  - 既有 document 不得建立新的 `document_versions` row
  - 錯誤訊息要區分 unsupported、empty extraction、textless rich source

**Rationale**:

- 現有 sync 流程會在 extraction 前就建立 document shell；rich format 若在抽取時失敗，容易留下難以向管理員解釋的半成品狀態
- unsupported / non-replayable rich source 的失敗本質屬於 caller / source quality 問題，應回 4xx 並附具體 guidance，而不是 generic 500

**Alternative considered**: 保留現有 document-first 寫入順序，失敗後再做 cleanup。**Rejected** — rollback path 複雜且易留下 drift，不如一開始就延後建立 row。

### Upload Wizard Shows Support Tiers Instead Of Overpromising

**Decision**: Upload Wizard 的 `accept`、說明文案、client-side validation message，都必須用同一份 shared format registry 驅動。

**UI copy direction**:

- direct text：`.txt`, `.md`
- supported rich：`.pdf`, `.docx`, `.xlsx`, `.pptx`
- conversion required：`.doc`, `.xls`, `.ppt`
- deferred media：音檔、影片

**Rationale**:

- 目前最明顯的 drift 是 UI 已放行 `.pdf`，server 卻不支援；若 format registry 不共享，之後加 `.docx` / `.xlsx` / `.pptx` 時還會再發生一次
- 「格式不支援」與「格式可支援但這份檔案抽不出可引用文字」是兩種不同失敗，wizard 必須給不同 guidance

### Testing And Acceptance Boundary

**Decision**: 第一波 rich format 驗收以 fixture-based deterministic tests 為主，不把 visual fidelity、OCR、版面還原列入通過條件。

**Required checks**:

- 每個 supported rich format 至少 1 組成功 fixture，確認可產出 `normalized_text_r2_key`、`source_chunks`、`smoke_test_queries`
- 每個 deferred class 至少 1 組拒絕 fixture，確認回傳 actionable 4xx
- 至少 1 組「空文字 / 掃描型 PDF」失敗測試，確認 rich format 不會因空抽取結果進入 publishable path

**Rationale**:

- 本 change 的核心是「可驗證的文字快照」，不是「保留原始排版」
- 若 acceptance 一開始就綁定 OCR、表格視覺保真或投影片版面還原，change 會失去可收斂性

## Risks / Trade-offs

- rich format parser 可能增加 bundle size；應優先使用 lazy import 或格式分流，避免所有 parser 常駐於 hot path
- XLSX / PPTX 的 canonical snapshot 必然比原始視覺版面更扁平；這是可接受的，只要引用與回放仍可追溯
- image-only / scanned PDF 仍會失敗；這不是 bug，而是第一波明確排除的格式邊界
- `.doc` / `.xls` / `.ppt` 與音影片的需求仍存在；本 change 只是把第一條可交付的擴充路徑釘牢，不代表最終終點

### Validated Trade-offs

- PDF 若抽不出任何可引用文字（例如 scanned / image-only source），會以 non-replayable 4xx 失敗；不在這一波補 OCR
- DOCX 表格目前以 row-wise 純文字行展開（例如 `欄位A | 欄位B`），保留內容順序但不保留原始表格視覺版面
- XLSX canonical snapshot 以 worksheet 順序與列資料 flatten 為單行文字；欄寬、格式、公式呈現不是驗收條件
- PPTX canonical snapshot 只保留 slide 順序與文字內容；版面、座標與視覺層次流失屬已知 trade-off
