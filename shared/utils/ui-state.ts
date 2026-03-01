import { assertNever } from './assert-never'

/**
 * Shared helpers for deriving the current UI state of a list/detail
 * page. Callers (Vue pages, integration assertions, and evidence
 * exporters) all use this so the "which state should render" decision
 * is exhaustive and single-sourced.
 *
 * Matches the state taxonomy documented in
 * `add-v1-core-ui §7.3-7.6` and mirrored by `/admin/documents/index.vue`.
 */

export const UI_FETCH_STATUS_VALUES = ['pending', 'success', 'error'] as const

export type UiFetchStatus = (typeof UI_FETCH_STATUS_VALUES)[number]

export const UI_PAGE_STATE_VALUES = [
  'loading',
  'error',
  'empty',
  'success',
  'unauthorized',
] as const

export type UiPageState = (typeof UI_PAGE_STATE_VALUES)[number]

export interface UiPageStateInput {
  error?: { statusCode?: number } | null
  itemCount: number
  status: UiFetchStatus
}

export function getUiPageState(input: UiPageStateInput): UiPageState {
  const errorStatusCode = input.error?.statusCode ?? null

  // Unauthorized is strictly 401/403 even if status is 'error'; we
  // detect it here so the caller can render a dedicated 403/redirect
  // surface instead of the generic error panel.
  if (errorStatusCode === 401 || errorStatusCode === 403) {
    return 'unauthorized'
  }

  switch (input.status) {
    case 'pending':
      return 'loading'
    case 'error':
      return 'error'
    case 'success':
      return input.itemCount === 0 ? 'empty' : 'success'
    default:
      return assertNever(input.status, 'getUiPageState')
  }
}

/**
 * Map each TC-UI test case id to the UI state it covers. Used by the
 * EV-UI-01 exporter to assert that a per-TC observation actually
 * landed on the expected state.
 */
export const UI_STATE_BY_TEST_CASE = {
  'TC-UI-01': 'empty',
  'TC-UI-02': 'loading',
  'TC-UI-03': 'error',
  'TC-UI-04': 'success',
  'TC-UI-05': 'unauthorized',
} as const satisfies Record<string, UiPageState>

export type UiCoverageTestCaseId = keyof typeof UI_STATE_BY_TEST_CASE

export function getUiStateForTestCase(testCaseId: UiCoverageTestCaseId): UiPageState {
  return UI_STATE_BY_TEST_CASE[testCaseId]
}
