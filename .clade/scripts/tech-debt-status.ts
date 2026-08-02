// clade improvement-loop: shared tech-debt `**Status**:` parsing.
//
// Single source of truth for "is this TD closed?" so the emission path
// (improvement-digest.ts detectFromTechDebt) and the closure path
// (closure-scanner.ts evaluateStatePredicate) cannot drift apart — they
// previously disagreed: emission skipped Status-closed TDs while the closure
// scanner only recognised a TD as closed when its entry was physically removed.

// Closed-class TD statuses: fix has landed or is intentionally not happening.
// Matched on the leading token so `-clade-scope` qualifiers count
// (`resolved-clade-scope`, `wontfix-clade-scope`); `pending` / `deferred` /
// `workaround` / `mitigated` stay open.
export const CLOSED_TD_STATUSES = new Set(['done', 'resolved', 'closed', 'wontfix', 'superseded'])

// TD metadata 欄位的共用行首前綴：部分 entry 把整個 metadata 區塊寫成 bullet list
// （`- **Status**: done`）。少了它，`^` 錨點只吃裸欄位行。
//
// 集中在這裡而不是各自寫一份：同型 bug 已發生三次（Status 2026-05、Class 與
// Discovered/Location 2026-08-02），失敗形態都是「一個欄位認得 bullet、另一個不認，
// 同一條 TD 半邊解析成功」。**NEVER** 在個別 regex 內重寫這段前綴。
export const TD_FIELD_PREFIX = '(?:[-*+]\\s+)?'

// Parse the `**Status**:` field value (first token) from a TD body. Returns
// lowercased status word (e.g. 'done', 'resolved', 'open', 'wontfix') or null.
// The `[\w-]*` capture stops at the trailing CJK parenthetical annotation
// (`done（2026-05-10）`) because `（` is non-word.
//
// The optional `[-*+]\s+` prefix accepts the bullet-list metadata style some
// TD entries use (`- **Status**: done`) — without it the `^` anchor only
// matched bare `**Status**:` lines, so bullet-style closed TDs parsed as null
// → treated as open → falsely re-emitted as digest candidates every run.
export function parseTechDebtStatus(body) {
  const m = body.match(
    new RegExp(`^${TD_FIELD_PREFIX}\\*\\*Status\\*\\*:\\s*([A-Za-z][\\w-]*)`, 'm'),
  )
  return m ? m[1].toLowerCase() : null
}

// True when a status token (possibly with a `-qualifier`) is a closed-class
// status. Null-safe — a missing Status field is treated as open.
export function isClosedStatus(status) {
  if (status === null || status === undefined) return false
  return CLOSED_TD_STATUSES.has(status.split('-')[0])
}

// Extract the `**Status**:` of a single TD entry from a full tech-debt.md
// content string. Slices the block from the `## <tdId>` heading to the next
// `## ` heading (same splitting contract as improvement-digest.ts readTechDebt)
// so a sibling TD's Status line can't leak in. Returns the lowercased status
// token, or null when the entry is absent or has no Status field.
export function getTechDebtStatus(fileContent, tdId) {
  const lines = fileContent.split('\n')
  const headingRe = new RegExp(`^## ${tdId}\\s*[—-]\\s`)
  let inBlock = false
  const block = []
  for (const line of lines) {
    if (!inBlock) {
      if (headingRe.test(line)) inBlock = true
      continue
    }
    if (line.startsWith('## ')) break
    block.push(line)
  }
  if (!inBlock) return null
  return parseTechDebtStatus(block.join('\n'))
}
