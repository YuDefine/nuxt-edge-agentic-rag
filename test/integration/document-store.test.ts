import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createDocumentSyncStore } from '../../server/utils/document-store'

interface CapturedStatement {
  bindings: unknown[]
  sql: string
}

function createD1Mock(versionRow: Record<string, unknown>) {
  const captured: CapturedStatement[] = []

  const prepare = vi.fn((sql: string) => {
    let bindings: unknown[] = []
    return {
      bind(...values: unknown[]) {
        bindings = values
        captured.push({ bindings, sql })
        return this
      },
      first: vi.fn().mockResolvedValue(versionRow),
      run: vi.fn().mockResolvedValue(undefined),
    }
  })

  const batch = vi.fn().mockResolvedValue([])

  return {
    batch,
    captured,
    database: { batch, prepare },
    prepare,
  }
}

describe('createDocumentSyncStore.publishVersionAtomic', () => {
  const versionRow = {
    created_at: '2026-04-18T00:00:00.000Z',
    document_id: 'doc-1',
    id: 'ver-1',
    index_status: 'indexed',
    is_current: 1,
    metadata_json: '{}',
    normalized_text_r2_key: 'normalized/local/doc-1/ver-1.txt',
    published_at: '2026-04-18T01:00:00.000Z',
    smoke_test_queries_json: '[]',
    source_r2_key: 'staged/local/admin-1/upload-1/first.txt',
    sync_status: 'completed',
    updated_at: '2026-04-18T01:00:00.000Z',
    version_number: 1,
  }

  let mock: ReturnType<typeof createD1Mock>

  beforeEach(() => {
    mock = createD1Mock(versionRow)
  })

  it('appends a status promotion statement when promoteToActive is true', async () => {
    const store = createDocumentSyncStore(mock.database)

    await store.publishVersionAtomic({
      documentId: 'doc-1',
      previousCurrentVersionId: null,
      promoteToActive: true,
      publishedAt: '2026-04-18T01:00:00.000Z',
      versionId: 'ver-1',
    })

    expect(mock.batch).toHaveBeenCalledTimes(1)
    const batchedStatements = mock.batch.mock.calls[0]?.[0]
    expect(Array.isArray(batchedStatements)).toBe(true)
    // 3 existing statements + 1 promotion statement
    expect(batchedStatements).toHaveLength(4)

    // The captured statements list contains the SQL strings in batch order
    // (findVersionById prepare is called AFTER batch, so it's the last entry).
    const promoteStatements = mock.captured.filter(
      (entry) =>
        /UPDATE\s+documents/i.test(entry.sql) &&
        /SET[^]*status\s*=\s*'active'/i.test(entry.sql) &&
        /WHERE[^]*status\s*=\s*'draft'/i.test(entry.sql),
    )

    expect(promoteStatements).toHaveLength(1)
    // Promotion statement bound with (publishedAt, documentId)
    expect(promoteStatements[0]?.bindings).toEqual(['2026-04-18T01:00:00.000Z', 'doc-1'])
  })

  it('does not append a status promotion statement when promoteToActive is false', async () => {
    const store = createDocumentSyncStore(mock.database)

    await store.publishVersionAtomic({
      documentId: 'doc-1',
      previousCurrentVersionId: 'ver-old',
      promoteToActive: false,
      publishedAt: '2026-04-18T01:00:00.000Z',
      versionId: 'ver-1',
    })

    expect(mock.batch).toHaveBeenCalledTimes(1)
    const batchedStatements = mock.batch.mock.calls[0]?.[0]
    // Only the original 3 statements, no promotion appended
    expect(batchedStatements).toHaveLength(3)

    const promoteStatements = mock.captured.filter((entry) =>
      /SET[^]*status\s*=\s*'active'/i.test(entry.sql),
    )
    expect(promoteStatements).toHaveLength(0)
  })
})
