import { describe, expect, it, vi } from 'vitest'

import { createMcpCategoryStore, listCategories } from '#server/utils/mcp-categories'

describe('mcp categories', () => {
  it('returns categories in stable name order and omits counts unless requested', async () => {
    const store = {
      listVisibleCategories: vi.fn().mockResolvedValue([
        {
          count: 2,
          name: 'zeta',
        },
        {
          count: 5,
          name: 'alpha',
        },
        {
          count: 1,
          name: 'finance',
        },
      ]),
    }

    await expect(
      listCategories(
        {
          allowedAccessLevels: ['internal'],
        },
        {
          store,
        },
      ),
    ).resolves.toEqual({
      categories: [{ name: 'alpha' }, { name: 'finance' }, { name: 'zeta' }],
    })

    await expect(
      listCategories(
        {
          allowedAccessLevels: ['internal'],
          includeCounts: true,
        },
        {
          store,
        },
      ),
    ).resolves.toEqual({
      categories: [
        { count: 5, name: 'alpha' },
        { count: 1, name: 'finance' },
        { count: 2, name: 'zeta' },
      ],
    })
  })

  it('queries only visible active documents with a current version and distinct document counts', async () => {
    const all = vi.fn().mockResolvedValue({
      results: [
        {
          category_slug: 'finance',
          document_count: 2,
        },
      ],
    })
    const bind = vi.fn().mockReturnValue({ all })
    const prepare = vi.fn().mockReturnValue({ bind })
    const database = { prepare }

    const store = createMcpCategoryStore(database)

    await expect(store.listVisibleCategories(['internal', 'restricted'])).resolves.toEqual([
      {
        count: 2,
        name: 'finance',
      },
    ])

    expect(prepare).toHaveBeenCalledTimes(1)
    const query = prepare.mock.calls[0]?.[0] as string
    expect(query).toContain('COUNT(DISTINCT d.id) AS document_count')
    expect(query).toContain('FROM documents d')
    expect(query).toContain('INNER JOIN document_versions v ON v.id = d.current_version_id')
    expect(query).toContain("d.status = 'active'")
    expect(query).toContain('v.is_current = 1')
    expect(query).toContain('d.access_level IN (?, ?)')
    expect(query).toContain('ORDER BY d.category_slug ASC')
    expect(bind).toHaveBeenCalledWith('internal', 'restricted')
  })
})
