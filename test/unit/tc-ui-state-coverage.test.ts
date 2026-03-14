import { describe, expect, it } from 'vitest'

import {
  getUiPageState,
  getUiStateForTestCase,
  UI_PAGE_STATE_VALUES,
  UI_STATE_BY_TEST_CASE,
} from '../../shared/utils/ui-state'

/**
 * TC-UI-01 到 TC-UI-05 的 state coverage 單元層驗證。
 *
 * 每個 TC-UI-* 對應一種 UI state：
 *   - TC-UI-01 empty
 *   - TC-UI-02 loading
 *   - TC-UI-03 error
 *   - TC-UI-04 success
 *   - TC-UI-05 unauthorized
 *
 * 驗證策略：測 `getUiPageState()` 純函式邏輯（由
 * `/admin/documents/index.vue` 的 isLoading/hasError/isEmpty 抽出為
 * shared helper），以及 `UI_STATE_BY_TEST_CASE` 這個 static 對照表。
 * 這些是 state-selection 的 single source of truth；任何新 UI state
 * 一旦加入 `UI_PAGE_STATE_VALUES`，TypeScript exhaustiveness 保證會逼
 * 迫每個 consumer 補上對應處理（遵守 `.claude/rules/development.md`
 * 的 assertNever rule）。
 *
 * 瀏覽器端的視覺驗收（screenshot / state-machine assertion）由
 * `/design improve` + `review-screenshot` 在 local 執行後，透過
 * EV-UI-01 exporter 注入 pointer 升級為 `passed`。
 */

describe('TC-UI state-coverage exhaustiveness', () => {
  it('declares exactly five UI states in the shared taxonomy', () => {
    expect(UI_PAGE_STATE_VALUES).toEqual(['loading', 'error', 'empty', 'success', 'unauthorized'])
  })

  it('maps each TC-UI-* id to a distinct UI state', () => {
    const states = Object.values(UI_STATE_BY_TEST_CASE)
    expect(new Set(states).size).toBe(states.length)
    expect(new Set(states)).toEqual(new Set(UI_PAGE_STATE_VALUES))
  })
})

describe('TC-UI-01 empty state (對照 add-v1-core-ui §7.3)', () => {
  it('renders empty state when fetch succeeds with zero items', () => {
    expect(
      getUiPageState({
        error: null,
        itemCount: 0,
        status: 'success',
      }),
    ).toBe('empty')
  })

  it('TC-UI-01 registry mapping points at empty state', () => {
    expect(getUiStateForTestCase('TC-UI-01')).toBe('empty')
  })

  it('empty state is distinct from success state even with same status=success', () => {
    expect(
      getUiPageState({
        error: null,
        itemCount: 10,
        status: 'success',
      }),
    ).toBe('success')
  })
})

describe('TC-UI-02 loading state (對照 add-v1-core-ui §7.4)', () => {
  it('renders loading state while fetch is pending regardless of itemCount', () => {
    expect(
      getUiPageState({
        error: null,
        itemCount: 0,
        status: 'pending',
      }),
    ).toBe('loading')

    expect(
      getUiPageState({
        error: null,
        itemCount: 5,
        status: 'pending',
      }),
    ).toBe('loading')
  })

  it('TC-UI-02 registry mapping points at loading state', () => {
    expect(getUiStateForTestCase('TC-UI-02')).toBe('loading')
  })
})

describe('TC-UI-03 error state (對照 add-v1-core-ui §7.5)', () => {
  it('renders error state on fetch failure without 401/403', () => {
    expect(
      getUiPageState({
        error: { statusCode: 500 },
        itemCount: 0,
        status: 'error',
      }),
    ).toBe('error')
  })

  it('renders error state when status is error and no statusCode is available', () => {
    expect(
      getUiPageState({
        error: {},
        itemCount: 0,
        status: 'error',
      }),
    ).toBe('error')
  })

  it('renders error state for generic 400 (invalid id format)', () => {
    expect(
      getUiPageState({
        error: { statusCode: 400 },
        itemCount: 0,
        status: 'error',
      }),
    ).toBe('error')
  })

  it('renders error state for 404 (unknown id)', () => {
    expect(
      getUiPageState({
        error: { statusCode: 404 },
        itemCount: 0,
        status: 'error',
      }),
    ).toBe('error')
  })

  it('TC-UI-03 registry mapping points at error state', () => {
    expect(getUiStateForTestCase('TC-UI-03')).toBe('error')
  })
})

describe('TC-UI-04 success state transition', () => {
  it('transitions from loading to success when data arrives', () => {
    const loading = getUiPageState({
      error: null,
      itemCount: 0,
      status: 'pending',
    })
    const success = getUiPageState({
      error: null,
      itemCount: 5,
      status: 'success',
    })

    expect(loading).toBe('loading')
    expect(success).toBe('success')
  })

  it('TC-UI-04 registry mapping points at success state', () => {
    expect(getUiStateForTestCase('TC-UI-04')).toBe('success')
  })

  it('success state renders only when non-empty data is returned', () => {
    // itemCount=0 is empty, not success
    expect(
      getUiPageState({
        error: null,
        itemCount: 0,
        status: 'success',
      }),
    ).toBe('empty')

    // itemCount>0 is success
    expect(
      getUiPageState({
        error: null,
        itemCount: 1,
        status: 'success',
      }),
    ).toBe('success')
  })
})

describe('TC-UI-05 unauthorized state (對照 add-v1-core-ui §7.6)', () => {
  it('renders unauthorized state on 401', () => {
    expect(
      getUiPageState({
        error: { statusCode: 401 },
        itemCount: 0,
        status: 'error',
      }),
    ).toBe('unauthorized')
  })

  it('renders unauthorized state on 403', () => {
    expect(
      getUiPageState({
        error: { statusCode: 403 },
        itemCount: 0,
        status: 'error',
      }),
    ).toBe('unauthorized')
  })

  it('unauthorized takes precedence over generic error', () => {
    // Both status='error' and statusCode=401 — unauthorized wins.
    expect(
      getUiPageState({
        error: { statusCode: 401 },
        itemCount: 0,
        status: 'error',
      }),
    ).toBe('unauthorized')
  })

  it('TC-UI-05 registry mapping points at unauthorized state', () => {
    expect(getUiStateForTestCase('TC-UI-05')).toBe('unauthorized')
  })

  it('non-401/403 error codes fall through to generic error', () => {
    for (const statusCode of [400, 404, 409, 422, 500, 502, 503]) {
      expect(
        getUiPageState({
          error: { statusCode },
          itemCount: 0,
          status: 'error',
        }),
      ).toBe('error')
    }
  })
})
