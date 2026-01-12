# API 結構模板

## GET 列表 API

```typescript
// server/api/v1/documents/index.get.ts
import { z } from 'zod'
import { useLogger } from 'evlog'
import { getRuntimeAdminAccess } from '~~/server/utils/knowledge-runtime'
import { paginationQuerySchema } from '~~/shared/schemas/pagination'

const querySchema = paginationQuerySchema.extend({
  status: z.enum(['draft', 'published', 'archived']).optional(),
})

export default defineEventHandler(async (event) => {
  const log = useLogger(event)
  const session = await getServerSession(event)

  if (!session?.user?.email) {
    throw createError({ statusCode: 401, message: '請先登入' })
  }

  const isAdmin = getRuntimeAdminAccess(session.user.email)
  if (!isAdmin) {
    throw createError({ statusCode: 403, message: '需要管理員權限' })
  }

  const query = await getValidatedQuery(event, querySchema.parse)
  const db = useDatabase()

  const offset = (query.page - 1) * query.pageSize

  // 計算總數
  const countResult = await db
    .prepare('SELECT COUNT(*) as total FROM documents WHERE deleted_at IS NULL')
    .first<{ total: number }>()

  const total = countResult?.total ?? 0

  // 查詢資料
  const documents = await db
    .prepare(
      `
      SELECT * FROM documents
      WHERE deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `
    )
    .bind(query.pageSize, offset)
    .all()

  return {
    data: documents.results ?? [],
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    },
  }
})
```

## POST 新增 API

```typescript
// server/api/v1/documents/index.post.ts
import { z } from 'zod'
import { useLogger } from 'evlog'
import { mapDbError } from '~~/server/utils/db-errors'

const createDocumentSchema = z.object({
  title: z.string().min(1, '標題必填').max(200),
  category: z.string().min(1),
  accessLevel: z.enum(['public', 'internal', 'restricted']),
})

export default defineEventHandler(async (event) => {
  const log = useLogger(event)
  const session = await getServerSession(event)

  if (!session?.user?.email) {
    throw createError({ statusCode: 401, message: '請先登入' })
  }

  const body = await readValidatedBody(event, createDocumentSchema.parse)
  const db = useDatabase()

  try {
    const result = await db
      .prepare(
        `
        INSERT INTO documents (title, category, access_level, created_by)
        VALUES (?, ?, ?, ?)
      `
      )
      .bind(body.title, body.category, body.accessLevel, session.user.id)
      .run()

    log.set({ result: { id: result.meta.last_row_id } })

    setResponseStatus(event, 201)
    return {
      data: {
        id: result.meta.last_row_id,
        ...body,
      },
    }
  } catch (error) {
    log.error(error as Error, { step: 'db-insert' })
    const mapped = mapDbError(error as { code?: string; message?: string })
    throw createError({
      statusCode: mapped.statusCode,
      message: mapped.message,
    })
  }
})
```

## Zod Schema 定義

在 `shared/schemas/` 定義可複用的 Schema：

```typescript
// shared/schemas/pagination.ts
import { z } from 'zod'

export const PAGE_SIZE_MAX = 100

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(PAGE_SIZE_MAX).default(20),
  search: z.string().optional(),
  sortBy: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
})

export type PaginationQuery = z.infer<typeof paginationQuerySchema>
```

## 驗證用法

```typescript
// GET：驗證 Query Parameters
const query = await getValidatedQuery(event, querySchema.parse)

// POST/PATCH：驗證 Request Body
const body = await readValidatedBody(event, createDocumentSchema.parse)

// 路徑參數
const params = await getValidatedRouterParams(
  event,
  z.object({ id: z.coerce.number().int().positive() }).parse
)
```

## 錯誤處理範例

```typescript
import { mapDbError } from '~~/server/utils/db-errors'

try {
  await db.prepare('...').run()
} catch (error) {
  log.error(error as Error, { step: 'operation-name' })
  const mapped = mapDbError(error as { code?: string; message?: string })
  throw createError({
    statusCode: mapped.statusCode,
    message: mapped.message,
  })
}
```

## 串流回應（Chat API）

```typescript
// server/api/chat/index.post.ts
export default defineEventHandler(async (event) => {
  const log = useLogger(event)

  // ... validation & auth

  const stream = new ReadableStream({
    async start(controller) {
      // ... streaming logic
      controller.enqueue(new TextEncoder().encode('data: ...\n\n'))
      controller.close()
    },
  })

  return sendStream(event, stream)
})
```
