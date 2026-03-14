export interface McpCategoryRecord {
  count: number
  name: string
}

interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike
  all<T>(): Promise<{ results?: T[] }>
}

interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike
}

export function createMcpCategoryStore(database: D1DatabaseLike) {
  return {
    async listVisibleCategories(allowedAccessLevels: string[]): Promise<McpCategoryRecord[]> {
      if (allowedAccessLevels.length === 0) {
        return []
      }

      const placeholders = allowedAccessLevels.map(() => '?').join(', ')
      const response = await database
        .prepare(
          [
            'SELECT',
            '  d.category_slug AS category_slug,',
            '  COUNT(DISTINCT d.id) AS document_count',
            'FROM documents d',
            'INNER JOIN document_versions v ON v.id = d.current_version_id',
            "WHERE d.status = 'active'",
            '  AND d.current_version_id IS NOT NULL',
            '  AND v.is_current = 1',
            `  AND d.access_level IN (${placeholders})`,
            'GROUP BY d.category_slug',
            'ORDER BY d.category_slug ASC',
          ].join('\n'),
        )
        .bind(...allowedAccessLevels)
        .all<{
          category_slug: string
          document_count: number
        }>()

      return (response.results ?? []).map((row) => ({
        count: row.document_count,
        name: row.category_slug,
      }))
    },
  }
}

export async function listCategories(
  input: {
    allowedAccessLevels: string[]
    includeCounts?: boolean
  },
  options: {
    store: {
      listVisibleCategories(allowedAccessLevels: string[]): Promise<McpCategoryRecord[]>
    }
  },
): Promise<{
  categories: Array<
    | {
        name: string
      }
    | {
        count: number
        name: string
      }
  >
}> {
  if (input.allowedAccessLevels.length === 0) {
    return { categories: [] }
  }

  const categories = await options.store.listVisibleCategories(input.allowedAccessLevels)
  const sortedCategories = [...categories].toSorted((left, right) =>
    left.name.localeCompare(right.name),
  )

  return {
    categories: sortedCategories.map((category) =>
      input.includeCounts
        ? {
            count: category.count,
            name: category.name,
          }
        : {
            name: category.name,
          },
    ),
  }
}
