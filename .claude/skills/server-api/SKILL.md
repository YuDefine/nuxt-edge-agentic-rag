---
name: server-api
description: >-
  Server API 設計規範。Use when creating server/api/**/*.ts files,
  building API endpoints, or working with defineEventHandler.
  Always use this skill for API route design, request validation,
  error handling, and response formatting.
---

# Server API 設計規範

## 技術棧

- **Database**: NuxtHub D1 (Cloudflare D1)
- **Auth**: better-auth + Google OAuth
- **Storage**: Cloudflare R2
- **Rate Limit**: Cloudflare KV
- **Logging**: evlog

## 目錄結構

```
server/
├── api/
│   ├── v1/                       # 版本化業務 API
│   │   └── resources/
│   │       ├── index.get.ts      # GET /api/v1/resources（列表）
│   │       ├── index.post.ts     # POST /api/v1/resources（新增）
│   │       └── [id]/
│   │           ├── index.get.ts     # GET /api/v1/resources/:id
│   │           ├── index.patch.ts   # PATCH /api/v1/resources/:id
│   │           └── index.delete.ts  # DELETE /api/v1/resources/:id
│   ├── uploads/                  # 檔案上傳 API
│   │   ├── presign.post.ts       # 取得預簽名 URL
│   │   └── finalize.post.ts      # 完成上傳驗證
│   ├── chat/                     # 問答 API
│   │   └── index.post.ts         # 串流問答
│   └── auth/                     # 認證 API（better-auth 處理）
├── utils/
│   ├── knowledge-runtime.ts      # 權限推導
│   ├── rate-limiter.ts           # KV rate limit
│   ├── allowlist.ts              # Admin allowlist
│   └── db-errors.ts              # DB 錯誤處理
└── auth.config.ts                # better-auth 設定
```

### 命名規範

- **檔案名稱**：`index.<method>.ts` 格式
- **路徑參數**：有意義的名稱（`[documentId]` 優於 `[id]`）
- **API 版本**：`/api/v1/` 前綴

## 權限檢查

### Admin 權限（runtime allowlist）

```typescript
import { getRuntimeAdminAccess } from '~~/server/utils/knowledge-runtime'

export default defineEventHandler(async (event) => {
  const session = await getServerSession(event)
  if (!session?.user?.email) {
    throw createError({ statusCode: 401, message: '請先登入' })
  }

  const isAdmin = getRuntimeAdminAccess(session.user.email)
  if (!isAdmin) {
    throw createError({ statusCode: 403, message: '需要管理員權限' })
  }

  // ... business logic
})
```

### Access Levels 推導

```typescript
import { getAllowedAccessLevels } from '~~/server/utils/knowledge-runtime'

const accessLevels = getAllowedAccessLevels({
  channel: 'web',
  isAdmin,
  isAuthenticated: !!session,
  tokenScopes: [], // MCP 用
})
```

## D1 資料庫存取

```typescript
export default defineEventHandler(async (event) => {
  const db = useDatabase() // NuxtHub D1

  // 查詢
  const documents = await db.prepare('SELECT * FROM documents WHERE is_current = 1').all()

  // 新增
  const result = await db
    .prepare('INSERT INTO documents (title, status) VALUES (?, ?)')
    .bind(title, 'draft')
    .run()

  // Transaction
  const batch = [
    db.prepare('UPDATE document_versions SET is_current = 0 WHERE document_id = ?').bind(docId),
    db.prepare('UPDATE document_versions SET is_current = 1 WHERE id = ?').bind(newVersionId),
  ]
  await db.batch(batch)
})
```

## 回應格式

| 類型 | 格式                                                                 |
| ---- | -------------------------------------------------------------------- |
| 列表 | `{ data: items, pagination: { page, pageSize, total, totalPages } }` |
| 單筆 | `{ data: item }`                                                     |
| 新增 | status 201 + `{ data: newItem }`                                     |
| 刪除 | `{ data: { id, deleted_at } }`                                       |
| 串流 | `sendStream(event, stream)`                                          |

## 錯誤處理

### 狀態碼對照

| 狀態碼 | 使用情境                    |
| ------ | --------------------------- |
| 400    | 請求格式錯誤、驗證失敗      |
| 401    | 未認證                      |
| 403    | 無權限                      |
| 404    | 資源不存在                  |
| 409    | 資源衝突（unique key 違反） |
| 429    | Rate limit 超過             |
| 500    | 伺服器內部錯誤              |

### DB 錯誤處理

```typescript
import { mapDbError } from '~~/server/utils/db-errors'

try {
  await db.prepare('...').run()
} catch (error) {
  const mapped = mapDbError(error as { code?: string; message?: string })
  throw createError({
    statusCode: mapped.statusCode,
    message: mapped.message,
  })
}
```

### evlog 錯誤記錄

```typescript
import { useLogger } from 'evlog'

export default defineEventHandler(async (event) => {
  const log = useLogger(event) // 第一行取得 logger

  try {
    // ... business logic
  } catch (error) {
    log.error(error as Error, { step: 'db-insert' })
    throw createError({ statusCode: 500, message: '操作失敗' })
  }
})
```

## 參考資料

| 檔案                                                     | 內容                       |
| -------------------------------------------------------- | -------------------------- |
| [references/api-template.md](references/api-template.md) | 完整 API 模板 + Zod Schema |
| [references/pagination.md](references/pagination.md)     | 分頁、搜尋、排序           |

## 檢查清單

- [ ] 使用 `index.<method>.ts` 命名
- [ ] 在 `shared/schemas/` 定義 Zod Schema
- [ ] 開頭取得 logger：`const log = useLogger(event)`
- [ ] 權限檢查（`getServerSession` + `getRuntimeAdminAccess`）
- [ ] 使用 `getValidatedQuery` / `readValidatedBody` 驗證輸入
- [ ] 使用 `useDatabase()` 取得 D1 連線
- [ ] 回傳統一格式（`{ data, pagination? }`）
- [ ] 新增操作設定 201 狀態碼
- [ ] 錯誤時使用 `log.error` 記錄（僅限 5xx）
