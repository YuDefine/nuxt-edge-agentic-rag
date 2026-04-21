## Why

目前文件 ingestion 真相仍是「文字檔直讀」：Admin 上傳流程已對外呈現文件上傳能力，但同步路徑仍直接以 `getText()` 讀取來源物件，`document-preprocessing` 也只接受 `text/plain` 與 `text/markdown`。這代表實際可穩定 ingestion 的核心格式仍是 `md` / `txt`，與管理者對常見企業文件格式的期待存在落差。

對中小企業知識庫而言，實際來源通常是 PDF、Word、Excel、PowerPoint，而不是已人工整理好的 Markdown。若持續要求操作人員先手動轉檔，除了削弱產品說服力，也會讓報告與答辯材料必須長期停留在「條件支援」與「展示案例」口徑，無法自然過渡到真正的多格式文件管理能力。

這個 change 的目的不是把所有檔案格式一次塞進現有管線，而是先在不破壞既有 replay truth 的前提下，建立一條可驗證、可引用、可逐步擴充的多格式 canonical snapshot ingestion 路徑。

## What Changes

### Modified Capability `document-ingestion-and-publishing`

- 將來源檔 ingestion 擴成三層格式策略：
  - direct text：`.txt`、`.md`
  - supported rich formats：`.pdf`、`.docx`、`.xlsx`、`.pptx`
  - deferred formats：`.doc`、`.xls`、`.ppt` 與音檔 / 影片
- 在既有 `normalized_text_r2_key` / `source_chunks` 真相來源之前，加入 canonical snapshot extraction 階段；supported rich formats 先轉成可重播的 line-oriented 文字快照，再沿用既有 preprocessing / publish / replay 契約。
- unsupported 或 extraction 失敗的來源檔，必須在版本建立前就被拒絕，避免留下 orphan `documents` / `document_versions` 狀態。

### Modified Capability `admin-document-management-ui`

- Upload Wizard 必須明確揭露格式分級：哪些可以直接上傳、哪些屬於 supported rich formats、哪些需要先轉檔或等待後續 transcript pipeline。
- 上傳與同步錯誤訊息要區分「格式尚未支援」與「格式可支援但這份檔案無法抽出可引用文字」，避免用 generic invalid-file message 掩蓋真實原因。

## Non-Goals

- 本 change **不直接支援** `.doc`、`.xls`、`.ppt`；這三類 legacy binary Office 格式需經 conversion boundary 才適合納入現有治理與 replay 契約。
- 本 change **不納入** 音檔與影片 ingestion；媒體內容需要 async transcript pipeline，超出目前同步 sync 路徑與 Workers request budget。
- 本 change **不處理** OCR 與 image-only / scanned PDF 文字辨識。
- 本 change **不改變** `citationId` / `normalized_text_r2_key` / `source_chunks` 作為 replay truth source 的設計。
- 本 change **不把**供應商 chunk id 或原始檔頁碼當成新的唯一回放真相來源。

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `document-ingestion-and-publishing`: 支援 rich document canonical snapshot extraction，並在版本建立前拒絕 unsupported / non-replayable source。
- `admin-document-management-ui`: Upload Wizard 顯示格式支援層級與 extraction-aware 錯誤指引。

## Impact

- Affected specs:
  - `document-ingestion-and-publishing`
  - `admin-document-management-ui`
- Affected code:
  - `app/components/documents/UploadWizard.vue`
  - `server/api/documents/sync.post.ts`
  - `server/utils/document-sync.ts`
  - `server/utils/document-preprocessing.ts`
  - `server/utils/staged-upload.ts`
  - `shared/types/knowledge.ts`
  - `test/unit/**` rich-format extractor / validation tests
  - `test/integration/**` sync rejection / success path tests
  - new extraction utility (例如 `server/utils/document-source-extractor.ts`)
- Affected docs:
  - `main-v0.0.48.md` 後續需同步說明多格式擴充順序與邊界
  - `deliverables/defense/答辯準備_口試Q&A.md` 需同步改為「分級支援 + canonical snapshot」口徑
