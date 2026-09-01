// 🔒 LOCKED — managed by clade · Source: vendor/scripts/flow/carrier-ref.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/flow/carrier-ref.ts
/**
 * `<scheme>:<id>` carrier references — parsing and the one question every caller asks about them.
 *
 * This lives apart from `answer.ts` for a mechanical reason, not a taxonomic one: `stall.ts` has
 * to ask whether a carrier is addressable by a path, and `answer.ts` reaches `stall.ts` through
 * `decisions.ts`. Importing across that edge closes a cycle. The alternative — letting `stall.ts`
 * keep its own copy of the scheme list — is the shape this repo refuses everywhere else: a second
 * matcher drifts from the first, and the drift is silent because both sides keep answering.
 *
 * Nothing here imports another flow module, which is what keeps it importable from all of them.
 */

/**
 * A carrier scheme is a namespace, not a file extension: `td:TD-9` and `tasks:<slug>` name entries
 * in registers, `handoff:` a section, and the off-repo three name places outside this checkout.
 * A value with no known scheme keeps its historical meaning — a repo-relative path.
 */
export const REF_SCHEMES = ['notion', 'im', 'chat', 'td', 'tasks', 'handoff'] as const
export type RefScheme = (typeof REF_SCHEMES)[number]

const SCHEME_RE = new RegExp(`^(${REF_SCHEMES.join('|')}):(.+)$`, 'u')

/** Split `<scheme>:<id>`. A bare value (no known scheme) keeps its historical meaning: a path. */
export function parseRef(ref: string | null): { scheme: RefScheme | null; id: string } | null {
  if (!ref) return null
  const trimmed = ref.trim()
  if (!trimmed) return null
  const m = SCHEME_RE.exec(trimmed)
  if (!m) return { scheme: null, id: trimmed }
  return { scheme: m[1] as RefScheme, id: m[2].trim() }
}

/**
 * Schemes whose carrier is real but lives outside this checkout. They are NOT a missing carrier:
 * the answer landed somewhere a file path cannot name. Callers judging "did this answer reach its
 * carrier" MUST treat them as out of scope rather than as a broken path — `findUnfiledAnswerStalls`
 * documents exactly that intent ("a decision with no carrier is NOT reported") and used carrier
 * emptiness as its proxy, which these three defeat by being non-empty (2026-09-01: `chat:` fell
 * through to the path branch and reported carrier-missing for 35h).
 */
export const OFF_REPO_SCHEMES: readonly RefScheme[] = ['notion', 'im', 'chat']

/** True when the carrier names something real that no repo-relative path can address. */
export function isOffRepoCarrier(carrier: string | null): boolean {
  const scheme = parseRef(carrier)?.scheme
  return scheme !== null && scheme !== undefined && OFF_REPO_SCHEMES.includes(scheme)
}

/**
 * `tasks:<slug>` names an entry in the tasks register, the same way `td:TD-<n>` names one in the
 * shared register — it is NOT a repo-relative path. Without this the scheme was accepted by
 * `parseRef` and then resolved as if the slug were the path, landing on `<repo>/<slug>` with the
 * directory and the extension both missing (2026-09-01: span 32ba44c6, 70h).
 *
 * Both already-qualified spellings are tolerated because the value comes from whoever wrote the
 * `flow ask`, and `tasks:tasks/foo.md` is a spelling a person reasonably produces.
 */
export function tasksRef(id: string): string {
  const slug = id.split('#')[0]
  const rel = slug.startsWith('tasks/') ? slug : `tasks/${slug}`
  return rel.endsWith('.md') ? rel : `${rel}.md`
}
