import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getUiPageState } from '../../shared/utils/ui-state'

import { createRouteEvent, installNuxtRouteTestGlobals } from './helpers/nuxt-route'

/**
 * TC-UI-01 ~ TC-UI-05 integration coverage — verifies that the
 * `/api/admin/documents` contract actually drives each UI state as
 * expected. Pairs with the unit tests in
 * `test/unit/tc-ui-state-coverage.test.ts` (which test the state
 * selector in isolation) and the EV-UI-01 exporter (which aggregates
 * screenshots + network logs for the report backfill).
 *
 * We call the handler directly (same pattern as
 * `admin-documents-route.test.ts`) so this remains a fast Node-level
 * integration test. Browser-level visual QA is captured via
 * screenshot-review agent when running against staging.
 */

const adminDocumentsMocks = vi.hoisted(() => ({
  createDocumentListStore: vi.fn().mockReturnValue({
    listDocumentsWithCurrentVersion: vi.fn(),
  }),
  getKnowledgeRuntimeConfig: vi.fn().mockReturnValue({
    bindings: {
      d1Database: 'DB',
    },
  }),
  getRequiredD1Binding: vi.fn().mockReturnValue({}),
  requireRuntimeAdminSession: vi.fn().mockResolvedValue({
    user: { id: 'admin-1', email: 'admin@example.com' },
  }),
}))

vi.mock('../../server/utils/document-list-store', () => ({
  createDocumentListStore: adminDocumentsMocks.createDocumentListStore,
}))

installNuxtRouteTestGlobals()

describe('TC-UI-01 empty state contract (/api/admin/documents returns [])', () => {
  beforeEach(() => {
    vi.stubGlobal('getKnowledgeRuntimeConfig', adminDocumentsMocks.getKnowledgeRuntimeConfig)
    vi.stubGlobal('getRequiredD1Binding', adminDocumentsMocks.getRequiredD1Binding)
    vi.stubGlobal('requireRuntimeAdminSession', adminDocumentsMocks.requireRuntimeAdminSession)
  })

  it('TC-UI-01: returns `{data: []}` and the state selector resolves to empty', async () => {
    const mockStore = {
      listDocumentsWithCurrentVersion: vi.fn().mockResolvedValue([]),
    }
    adminDocumentsMocks.createDocumentListStore.mockReturnValue(mockStore)

    const { default: handler } = await import('../../server/api/admin/documents/index.get')
    const result = await handler(createRouteEvent())

    expect(result).toEqual({ data: [] })
    // State selector must resolve to empty when data is present but length=0
    expect(
      getUiPageState({
        error: null,
        itemCount: result.data.length,
        status: 'success',
      })
    ).toBe('empty')
  })
})

describe('TC-UI-03 error state contract (/api/admin/documents surfaces fetch errors)', () => {
  beforeEach(() => {
    vi.stubGlobal('getKnowledgeRuntimeConfig', adminDocumentsMocks.getKnowledgeRuntimeConfig)
    vi.stubGlobal('getRequiredD1Binding', adminDocumentsMocks.getRequiredD1Binding)
    vi.stubGlobal('requireRuntimeAdminSession', adminDocumentsMocks.requireRuntimeAdminSession)
  })

  it('TC-UI-03: unexpected 500 from store propagates as error state', async () => {
    const mockStore = {
      listDocumentsWithCurrentVersion: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error('db down'), { statusCode: 500 })),
    }
    adminDocumentsMocks.createDocumentListStore.mockReturnValue(mockStore)

    const { default: handler } = await import('../../server/api/admin/documents/index.get')

    await expect(handler(createRouteEvent())).rejects.toMatchObject({
      statusCode: 500,
    })

    // Callers translate this into status='error' + generic error surface
    expect(
      getUiPageState({
        error: { statusCode: 500 },
        itemCount: 0,
        status: 'error',
      })
    ).toBe('error')
  })

  it('TC-UI-03: malformed query/params (400) drives generic error, not unauthorized', () => {
    // Client-side: useFetch wraps a 400 into status='error' + error.statusCode=400.
    // We verify the state-selector rule here (unit-level guard) to make
    // sure the integration path does not accidentally collapse 400 into
    // unauthorized.
    expect(
      getUiPageState({
        error: { statusCode: 400 },
        itemCount: 0,
        status: 'error',
      })
    ).toBe('error')
  })
})

describe('TC-UI-04 success state contract (/api/admin/documents returns populated list)', () => {
  beforeEach(() => {
    vi.stubGlobal('getKnowledgeRuntimeConfig', adminDocumentsMocks.getKnowledgeRuntimeConfig)
    vi.stubGlobal('getRequiredD1Binding', adminDocumentsMocks.getRequiredD1Binding)
    vi.stubGlobal('requireRuntimeAdminSession', adminDocumentsMocks.requireRuntimeAdminSession)
  })

  it('TC-UI-04: non-empty list drives the success state', async () => {
    const mockStore = {
      listDocumentsWithCurrentVersion: vi.fn().mockResolvedValue([
        {
          id: 'doc-1',
          title: 'Doc 1',
          slug: 'doc-1',
          categorySlug: 'general',
          accessLevel: 'internal',
          status: 'active',
          currentVersionId: 'ver-1',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-02T00:00:00Z',
          currentVersion: {
            id: 'ver-1',
            versionNumber: 1,
            syncStatus: 'synced',
            indexStatus: 'indexed',
            publishedAt: '2024-01-02T00:00:00Z',
          },
        },
      ]),
    }
    adminDocumentsMocks.createDocumentListStore.mockReturnValue(mockStore)

    const { default: handler } = await import('../../server/api/admin/documents/index.get')
    const result = await handler(createRouteEvent())

    expect(result.data).toHaveLength(1)
    expect(
      getUiPageState({
        error: null,
        itemCount: result.data.length,
        status: 'success',
      })
    ).toBe('success')
  })
})

describe('TC-UI-05 unauthorized state contract (/api/admin/documents enforces admin session)', () => {
  beforeEach(() => {
    vi.stubGlobal('getKnowledgeRuntimeConfig', adminDocumentsMocks.getKnowledgeRuntimeConfig)
    vi.stubGlobal('getRequiredD1Binding', adminDocumentsMocks.getRequiredD1Binding)
    vi.stubGlobal('requireRuntimeAdminSession', adminDocumentsMocks.requireRuntimeAdminSession)
  })

  it('TC-UI-05: 401 from requireRuntimeAdminSession drives unauthorized state', async () => {
    adminDocumentsMocks.requireRuntimeAdminSession.mockRejectedValueOnce(
      Object.assign(new Error('Unauthorized'), { statusCode: 401 })
    )

    const { default: handler } = await import('../../server/api/admin/documents/index.get')

    await expect(handler(createRouteEvent())).rejects.toMatchObject({
      statusCode: 401,
    })

    expect(
      getUiPageState({
        error: { statusCode: 401 },
        itemCount: 0,
        status: 'error',
      })
    ).toBe('unauthorized')
  })

  it('TC-UI-05: 403 from middleware (non-admin user) drives unauthorized state', async () => {
    adminDocumentsMocks.requireRuntimeAdminSession.mockRejectedValueOnce(
      Object.assign(new Error('Forbidden'), { statusCode: 403 })
    )

    const { default: handler } = await import('../../server/api/admin/documents/index.get')

    await expect(handler(createRouteEvent())).rejects.toMatchObject({
      statusCode: 403,
    })

    expect(
      getUiPageState({
        error: { statusCode: 403 },
        itemCount: 0,
        status: 'error',
      })
    ).toBe('unauthorized')
  })
})

/**
 * TC-UI-02 loading state is a pure client-side concern (the useFetch
 * status is 'pending' between request send and response receive). The
 * Node-level handler cannot emit that state because it resolves
 * synchronously as far as the API is concerned. We therefore cover the
 * selector behaviour in the unit test and rely on the EV-UI-01
 * screenshot evidence to confirm the skeleton surface actually
 * renders on the Vue side.
 */
describe('TC-UI-02 loading state selector rule', () => {
  it('selector returns loading whenever the fetch status is pending', () => {
    expect(
      getUiPageState({
        error: null,
        itemCount: 0,
        status: 'pending',
      })
    ).toBe('loading')
  })
})
