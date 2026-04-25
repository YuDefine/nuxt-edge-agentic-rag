/**
 * Single source of truth for the user-facing refusal message content.
 *
 * Both `server/utils/web-chat.ts` (persistence) and
 * `app/utils/chat-stream.ts` (live SSE rendering) MUST emit this exact
 * string for refusal turns so reload paths and live paths render the same
 * `RefusalMessage.vue` content. Do not interpolate dynamic refusal reasons
 * into this constant — the "可能原因 / 建議下一步" copy lives in the
 * component template, and per-reason copy (when needed in future) should
 * be derived from `query_logs.refusal_reason` join, not from `messages.content`.
 *
 * See: openspec/changes/persist-refusal-and-label-new-chat/design.md
 *      `Refusal content 採固定字串 '抱歉，我無法回答這個問題。'`
 */
export const REFUSAL_MESSAGE_CONTENT = '抱歉，我無法回答這個問題。'
