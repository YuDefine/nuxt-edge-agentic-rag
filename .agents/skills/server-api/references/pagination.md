# 分頁與搜尋

## 分頁查詢（D1）

```typescript
const offset = (query.page - 1) * query.pageSize

// 計算總數
const countResult = await db
  .prepare(
    `
    SELECT COUNT(*) as total FROM documents
    WHERE deleted_at IS NULL
    ${query.status ? 'AND status = ?' : ''}
    ${query.search ? 'AND (title LIKE ? OR content LIKE ?)' : ''}
  `
  )
  .bind(
    ...[
      query.status,
      query.search ? `%${query.search}%` : undefined,
      query.search ? `%${query.search}%` : undefined,
    ].filter(Boolean)
  )
  .first<{ total: number }>()

const total = countResult?.total ?? 0

// 查詢資料
const documents = await db
  .prepare(
    `
    SELECT * FROM documents
    WHERE deleted_at IS NULL
    ${query.status ? 'AND status = ?' : ''}
    ${query.search ? 'AND (title LIKE ? OR content LIKE ?)' : ''}
    ORDER BY ${query.sortBy ?? 'created_at'} ${query.sortDir}
    LIMIT ? OFFSET ?
  `
  )
  .bind(
    ...[
      query.status,
      query.search ? `%${query.search}%` : undefined,
      query.search ? `%${query.search}%` : undefined,
      query.pageSize,
      offset,
    ].filter((v) => v !== undefined)
  )
  .all()
```

## 回應格式

```typescript
return {
  data: documents.results ?? [],
  pagination: {
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.ceil(total / query.pageSize),
  },
}
```

## 搜尋字串消毒

D1 使用 prepared statements 自動防 SQL injection，但 LIKE pattern 中的 `%` 和 `_` 需要手動處理：

```typescript
function sanitizeSearchTerm(term: string): string {
  return term.replace(/[%_]/g, (char) => `\\${char}`)
}

const safeSearch = sanitizeSearchTerm(query.search.trim())
// 然後用 `%${safeSearch}%` 做 LIKE 查詢
```

## Query Logs（可觀測性）

問答 API 應記錄查詢日誌：

```typescript
await db
  .prepare(
    `
    INSERT INTO query_logs (
      user_id, query_text, retrieval_count, answer_status, duration_ms
    ) VALUES (?, ?, ?, ?, ?)
  `
  )
  .bind(
    session?.user?.id ?? null,
    queryText,
    retrievedChunks.length,
    answerStatus, // 'answered' | 'refused' | 'low_confidence'
    Date.now() - startTime
  )
  .run()
```
