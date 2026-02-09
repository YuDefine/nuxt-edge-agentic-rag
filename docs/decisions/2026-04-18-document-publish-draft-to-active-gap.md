# 新文件無法 publish 第一個版本

## Decision

`document-sync` 建立新文件時 `status = 'draft'`，但 `publishDocumentVersion` 拒絕非 `active` 狀態的文件，形成死結：新文件永遠過不了第一次 publish。決定在下一個 spectra change 處理狀態轉換。

## Context

2026-04-18 R2 upload 鏈路（presign → PUT → finalize → sync）修通後，首次真正跑到 publish 階段，暴露此 pre-existing 漏洞：

- `server/utils/document-sync.ts:83`：`createDocument({ status: 'draft', ... })`
- `server/utils/document-publish.ts:44`：`if (document.status !== 'active') throw 409 'Only active documents can publish versions'`
- 沒有任何程式路徑把 `draft → active`

實際錯誤：

```json
{
  "statusCode": 409,
  "statusMessage": "DocumentPublishStateError",
  "message": "Only active documents can publish versions"
}
```

此 bug 在 R2 upload 鏈路之前被前置的 401 與 finalize 500 遮蓋，從未真正執行到 publish 的狀態檢查。

## Alternatives Considered

- **方案 A：擴充 publishVersionAtomic 支援同時 upsert document.status**
  - 優：狀態轉換原子化、符合「首次 publish 升格為 active」語意
  - 缺：需改 `DocumentPublishStore` 介面、migration 可能要加 trigger / 檢查

- **方案 B：sync 建立時直接 `status = 'active'`**
  - 優：最小改動、一行修
  - 缺：放棄 draft 階段語意，若未來需要「上架前審核」會失去欄位意義

- **方案 C：publish 前獨立步驟 activateDocument(documentId)**
  - 優：邏輯清楚
  - 缺：非原子、race 風險（兩個 request 同時 publish 第一個 version）

## Reasoning

下一個 spectra change 處理，理由：

1. 非 R2 fix 引入，是既有 feature gap（sync → publish 轉換從未接通）
2. 牽涉 store 介面設計決策（atomic 與否、draft 語意保留與否），需要先釐清 product intent
3. 本輪目標是解除 R2 upload 鏈路的 401 / finalize / sync，已達成

## Trade-offs Accepted

- 本輪 commit 後，admin 仍無法透過 UI 完成「上傳 → 發布」的 end-to-end 流程
- 若要緊急使用，可手動在 D1 console 將 document 的 status 改為 `active` 再點發布

## Supersedes

無（首次記錄）
