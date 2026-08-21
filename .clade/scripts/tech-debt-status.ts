// 🔒 LOCKED — managed by clade · Source: vendor/scripts/tech-debt-status.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/tech-debt-status.ts
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

// 第三態：規約 / 工具已經落地（所以 entry 帶著 `### Resolution`），但**驗收未跑**，
// 所以 Status 不能是 done —— 改 done 就是過早宣告完成。
//
// 為什麼需要一個 canonical token 而不是寫成 `open — 已落地`：後綴是自由散文，audit
// 只能靠字串啟發式認它，而「已實作待驗」「已 ship 待 smoke」這類同義寫法會一路漏。
// token 走既有的 `-qualifier` grammar（同 `resolved-clade-scope`），`parseTechDebtStatus`
// 的 `[A-Za-z][\w-]*` 直接吃得下，`isClosedStatus` 取 `split('-')[0]` 自動判成非 closed。
//
// **這不是 closed class**：它仍要計 Invariant 4 的 60d SLA（驗收本身會拖，那正是需要
// SLA 的形狀），只是免除 Invariant 5 的「open 不該有 Resolution」與 Invariant 6 的
// done-hint 誤判。判準見 `.claude/rules/local/tech-debt-hygiene.md § Invariant 5`。
export const LANDED_PENDING_TD_STATUSES = new Set(['landed'])

// 第四態：內容已知該怎麼做，但**動作被機制擋住**——harness sensitive-file gate
// （`.claude/**` attended-only）、`WORK_LOOP_RUNNER_CHILD` guard（publish / propagate）、
// `permissions.deny`、chmod 444、不可逆的人類 gate。
//
// **這不是 closed class，也不是「不必維護」**：它照計 Invariant 4 的 SLA、照吃所有
// hygiene invariant。它退出的只有 `actionableOpen` 這個分子——work-loop 的停止條件讀
// 那個數字，而 open 總數含這一批時**在設計上就不可能歸零**，等於宣告迴圈永不收斂。
//
// 防濫用在 Invariant 12（`**Blocker**:` MUST 指得出擋在哪一行）：這一格是 actionableOpen
// 的單一攻擊面，改 N 條 status 就能讓停止條件假成立。**NEVER** 把「需要人判斷」「風險高」
// 「還沒空」當 blocker —— 那些是優先序，不是 gate。
export const BLOCKED_ATTENDED_ONLY_TD_STATUSES = new Set(['blocked'])

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

// True when a status token is the「已落地、待驗收」third state
// (`landed-pending-verification`). Null-safe. Deliberately NOT part of
// isClosedStatus — landed entries stay in the open pool for SLA purposes.
export function isLandedPendingVerification(status) {
  if (status === null || status === undefined) return false
  return LANDED_PENDING_TD_STATUSES.has(status.split('-')[0])
}

// True when a status token is the 第四態 `blocked-attended-only`. Null-safe.
// Deliberately NOT part of isClosedStatus — blocked entries stay in the open
// pool for every hygiene invariant; they leave only the actionableOpen numerator.
export function isBlockedAttendedOnly(status) {
  if (status === null || status === undefined) return false
  return BLOCKED_ATTENDED_ONLY_TD_STATUSES.has(status.split('-')[0])
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
