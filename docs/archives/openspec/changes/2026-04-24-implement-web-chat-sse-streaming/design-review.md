# Design Review: implement-web-chat-sse-streaming

- **Date**: 2026-04-24
- **Mode**: improve
- **Spectra Change**: implement-web-chat-sse-streaming
- **Target**: `app/components/chat/Container.vue`, `app/utils/chat-stream.ts`

## Diagnosis Summary

| Dimension     | Score | Finding                                                                                             |
| ------------- | ----- | --------------------------------------------------------------------------------------------------- |
| Visual        | 5/5   | No visual layout change; existing neutral chat surface remains intact.                              |
| Interaction   | 5/5   | Stop action now uses the active `AbortController`; streaming content is driven by SSE delta events. |
| Structure     | 5/5   | Terminal event to assistant-message mapping moved into a focused utility.                           |
| Copy          | 5/5   | Existing refusal and error copy is preserved.                                                       |
| Resilience    | 5/5   | Accepted, refusal, error, and abort paths have automated coverage.                                  |
| Performance   | 5/5   | Removed synthetic timer dependency; no layout or animation-heavy work added.                        |
| Accessibility | 5/5   | Existing keyboard/focus and 360px overflow checks pass.                                             |
| Consistency   | 5/5   | Uses existing Nuxt UI token classes and chat component contracts.                                   |

## Design Fidelity Report

Source: `.impeccable.md`

| Dimension            | Status | Evidence                                                                                                        |
| -------------------- | ------ | --------------------------------------------------------------------------------------------------------------- |
| Color Tokens         | PASS   | No new color classes; existing `text-*`, `bg-*`, `border-*` token usage unchanged.                              |
| Typography           | PASS   | No typography changes.                                                                                          |
| Spacing              | PASS   | No layout spacing changes.                                                                                      |
| Component Usage      | PASS   | Existing `ChatMessageList`, `LazyChatStreamingMessage`, `ChatMessageInput`, and `UAlert` composition preserved. |
| Interaction Patterns | PASS   | Send/stop flow stays in the chat input; cancellation now propagates through the stream.                         |
| Layout Fidelity      | PASS   | Chat layout structure unchanged.                                                                                |
| Design Principles    | PASS   | Content-first streaming behavior reduces fake UI state and keeps the answer path direct.                        |
| Anti-references      | PASS   | No decorative gradients, hard-coded color palette, or extra motion introduced.                                  |

Fidelity Score: 8/8 PASS

### Verification

- `rtk playwright test e2e/viewport-baseline.spec.ts e2e/keyboard-nav.spec.ts` — PASS (7)
- `rtk playwright test e2e/responsive-baseline-screenshots.spec.ts` — PASS (9)
- `rtk pnpm lint` — 0 warnings, 0 errors
- `rtk pnpm typecheck` — completed

### DRIFT 修復記錄

- Removed stale `streamingCancelled` shadow state from `app/components/chat/Container.vue`.
- Updated component comment from simulated streaming to SSE-driven streaming.

## Design Decisions

- No additional visual design skills were required because the change does not alter markup, spacing, color, typography, or navigation. The review scope was interaction integrity, responsive baseline, keyboard accessibility, and design-system drift.
