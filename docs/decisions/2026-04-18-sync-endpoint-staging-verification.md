# Sync Endpoint 需加上 Staged Upload 驗證

## Decision

`/api/documents/sync` 目前直接信任 client 傳入的 `objectKey/size/checksum/mimeType/uploadId`，未驗證歸屬與 staged upload 實際狀態。決定把驗證前置到 sync 端點（或以 server 端 staged upload 落地紀錄為憑），下一個 spectra change 實作。

## Context

2026-04-18 修復 R2 presigned PUT 401 的 code review 中發現：

- `signR2UploadUrl` 原本用 `ChecksumSHA256` + `ContentLength` 雙重綁定 presigned URL，等於以 R2 擋掉偽造 metadata 的 PUT
- 為了修 401，已改為 header-based checksum（仍綁 checksum）
- 但 `server/api/documents/sync.post.ts` **從來**沒呼叫 `validateStagedUploadMetadata`，也沒驗 `objectKey` 是否匹配 `staged/{env}/{user.id}/` 前綴
- 只有 `/api/uploads/finalize` 呼叫 `validateStagedUploadMetadata`，但 sync 不要求必須先經過 finalize

攻擊路徑：具 admin 權限者取得其他 admin 的 `objectKey`，或直接帶偽造的 `objectKey` + 任意 body 走 sync，就能建立指向非自己 staged object 的 document version。

## Alternatives Considered

- **方案 A：Sync 前呼叫 `bucket.head()` + `validateStagedUploadMetadata`**
  - 優：程式變動小、沿用既有 helper
  - 缺：仍靠 client 回傳 size/checksum，uploadId 歸屬需額外檢查

- **方案 B：Finalize 落地 staged_uploads 表，sync 以 uploadId 查核**
  - 優：single source of truth；uploadId 綁定 admin、object、size、checksum
  - 缺：新增 table + migration + FK；改動面大

- **方案 C：強制 objectKey 前綴比對 `staged/{env}/{user.id}/`**
  - 優：0 成本
  - 缺：僅阻止跨 admin 盜用，無法阻止同一 admin 帶偽造 metadata

## Reasoning

等下一個 spectra change 處理。當前 commit（R2 401 fix）**不含**此修復，因為：

1. 漏洞是 pre-existing，不是 401 fix 引入
2. 修正涉及 sync endpoint 驗證邏輯、可能連動 `validateStagedUploadMetadata` 簽名/schema，範圍大
3. 本輪目的是解除 401 + 修連鎖 regression，保持 scope

## Trade-offs Accepted

- 漏洞在本 commit 後仍存在（但沒比修復前更差——R2 checksum binding 仍保留）
- 需要在下一個 spectra cycle 儘快排入

## Supersedes

無（首次記錄）
