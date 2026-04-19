# Handoff

## In Progress

_(none — v0.24.3 / main-v0.0.46.md 已 archive 為 commit `f264132`；報告已反映 v46 驗收自動化與實機截圖)_

## Next Steps

1. **`frozen-final` 驗收跑報**：接上實模型後跑 30–50 筆正式測試集，回填下一版 §3.3.2 表 3-7 / 3-8 的延遲、P50 / P95、Judge 觸發率、引用正確率、拒答精準率等統計。
2. **重拍 `/chat` 含回答 + 引用卡片版本**：目前 v46 只有 empty onboarding。需完整 R2 + AI Search 閉環（或 staging 環境）才能拍出含「【引1】【引2】」行內引用與引用卡片的畫面。
3. **重拍 `/admin/usage` loaded 版本**：目前 v46 為 graceful error。接上真實 `CLOUDFLARE_API_TOKEN_ANALYTICS` + 有流量後重拍 tokens / requests / cache / Neurons 圖表。
4. **第五章收尾**：§5.1 組員心得、§5.2.2 實作前待驗證事項留待最終交付前依實際驗收結果回填；v0.0.47 時一併處理。
5. **tag push（如啟用遠端）**：目前 repo 無 `origin` remote，`v0.24.0~v0.24.3` tag 都只存 local。

## 注意事項

- 報告版本命名：v0.0.45 → v0.0.46（本輪 deploy `v0.24.3`）→ v0.0.47（驗收完成後）。**不可覆寫舊版**。
- v46 的表 4-1 狀態已分三級（結構性保障 / 自動化覆蓋 / 待驗收）；v47 再升時，A01 / A13 從「待驗收」推進為「驗收完成」需以 frozen-final 跑報與 runbook 實跑紀錄為憑。
- `/chat` 實模型接入牽涉 prompt 工程、token 成本觀測、延遲分布——屬獨立議題，見 §5.2.4 Fallback Synthesizer 取捨說明。
- screenshots 目錄已 gitignored；若要併入 DOCX 交付版，需另走 Word / 嵌圖流程，不經 git。
