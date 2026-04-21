## 1. Source Format Tiers And Runtime Boundary

- [ ] 1.1 撰寫 shared format registry 的紅測試，覆蓋 direct text、supported rich、deferred legacy Office、deferred media 四類判定（對應 Requirement: `Canonical Snapshot Extraction By Source Format`；design `Source Format Tiers And Runtime Boundary`）
- [ ] 1.2 建立共用 format registry（extension + MIME + support tier + operator guidance），供 Upload Wizard、staged upload 驗證與 sync orchestration 共用（對應 Requirement: `Upload Wizard Format Tier Disclosure`；design `Source Format Tiers And Runtime Boundary`）
- [ ] 1.3 更新 client / server validation：只接受 `.txt`、`.md`、`.pdf`、`.docx`、`.xlsx`、`.pptx` 進入 supported path；`.doc`、`.xls`、`.ppt`、音檔、影片以 tier-specific 訊息拒絕（對應 Requirement: `Upload Wizard Format Tier Disclosure`；design `Source Format Tiers And Runtime Boundary`）

## 2. Canonical Snapshot Contract Stays Line-Oriented

- [ ] 2.1 撰寫 rich-format extractor fixture 紅測試：`.pdf`、`.docx`、`.xlsx`、`.pptx` 各至少 1 份，驗證 canonical snapshot 會保留 `[Page]` / `[Sheet]` / `[Slide]` marker 並可生成 replay assets（對應 Requirement: `Canonical Snapshot Extraction By Source Format`；design `Canonical Snapshot Contract Stays Line-Oriented`）
- [ ] 2.2 新增 extraction utility（例如 `server/utils/document-source-extractor.ts`），把 supported rich source 轉成 deterministic、line-oriented canonical text（對應 Requirement: `Canonical Snapshot Extraction By Source Format`；design `Canonical Snapshot Contract Stays Line-Oriented`）
- [ ] 2.3 重構 `document-preprocessing` 接收 extractor 輸出，但維持既有 `citationLocator = lines x-y`、`normalized_text_r2_key`、`source_chunks` schema 不變（對應 Requirement: `Canonical Snapshot Extraction By Source Format`；design `Canonical Snapshot Contract Stays Line-Oriented`）

## 3. Sync Orchestration Rejects Unsupported Formats Before Version Creation

- [ ] 3.1 撰寫 integration 紅測試：unsupported legacy/media format 與 textless rich source 都必須在 version 建立前失敗，且不得留下新 `documents` / `document_versions` row（對應 Requirement: `Canonical Snapshot Extraction By Source Format`；design `Sync Orchestration Rejects Unsupported Formats Before Version Creation`）
- [ ] 3.2 調整 `syncDocumentVersionSnapshot` 的順序：先 extraction，後 document shell / version row；unsupported 或 extraction 失敗回傳 actionable 4xx（對應 Requirement: `Canonical Snapshot Extraction By Source Format`；design `Sync Orchestration Rejects Unsupported Formats Before Version Creation`）
- [ ] 3.3 更新 `/api/documents/sync` 來源載入策略：text 類走 `getText()`；rich 類走 bytes / arrayBuffer，再交由 extraction utility 分流（對應 Requirement: `Canonical Snapshot Extraction By Source Format`；design `Sync Orchestration Rejects Unsupported Formats Before Version Creation`）

## 4. Upload Wizard Shows Support Tiers Instead Of Overpromising

- [ ] 4.1 修改 `UploadWizard.vue` 說明文案、`accept` 屬性與 validation feedback，清楚標示 direct text / supported rich / conversion required / deferred media（對應 Requirement: `Upload Wizard Format Tier Disclosure`；design `Upload Wizard Shows Support Tiers Instead Of Overpromising`）
- [ ] 4.2 將 extraction 失敗訊息改為 next-step guidance（例如「先轉成 DOCX / PDF 再上傳」或「改提供可選取文字版本」），避免 generic invalid-file error（對應 Requirement: `Upload Wizard Format Tier Disclosure`；design `Upload Wizard Shows Support Tiers Instead Of Overpromising`）

## 5. Testing And Acceptance Boundary

- [ ] 5.1 為每個 supported rich format 加至少 1 條成功路徑測試，確認可走到 `normalized_text_r2_key` + `source_chunks` + `smoke_test_queries`（對應 Requirement: `Canonical Snapshot Extraction By Source Format`；design `Testing And Acceptance Boundary`）
- [ ] 5.2 為每個 deferred class 加至少 1 條拒絕測試，並對 scanned / image-only PDF 加 1 條 non-replayable 失敗測試（對應 Requirement: `Canonical Snapshot Extraction By Source Format`；design `Testing And Acceptance Boundary`）
- [ ] 5.3 執行 targeted unit / integration 驗證，記錄 PDF 空文字、表格 flatten、投影片版面流失等已知 trade-off，不把 visual fidelity 當作通過條件（對應 Requirement: `Canonical Snapshot Extraction By Source Format`；design `Testing And Acceptance Boundary`）

## 6. Design Review

- [ ] 6.1 執行 `/design improve app/components/documents/UploadWizard.vue`，確認格式支援文案與失敗引導沒有 DRIFT
- [ ] 6.2 執行響應式 viewport 測試（xs 360 / md 768 / xl 1280）確認 Upload Wizard 的格式說明與錯誤狀態不溢出
- [ ] 6.3 執行無障礙檢查（@nuxt/a11y dev report 無 error + 鍵盤 Tab walkthrough），確認格式說明、錯誤提示與 CTA 可被朗讀與聚焦
- [ ] 6.4 執行 `/audit`，確認此 UI 變更無 Critical 問題

## 人工檢查

- [ ] 7.1 以 admin 實際上傳 `.pdf`、`.docx`、`.xlsx`、`.pptx` 各 1 份 fixture，確認 wizard 可完成至 sync 成功且文件詳情可見 smoke-ready / indexed 狀態
- [ ] 7.2 實際選擇 `.doc`、`.xls`、`.ppt` 各 1 份 legacy fixture，確認 wizard 回傳「需先轉成現代 Office / PDF 或文字版」而非 generic invalid-file error
- [ ] 7.3 實際選擇 1 份 scanned PDF 或 image-only PDF，確認系統回傳「檔案可上傳但無法抽出可引用文字」的 extraction-failed guidance
