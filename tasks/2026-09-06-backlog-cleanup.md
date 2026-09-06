# Edge agentic-rag backlog cleanup — 2026-09-06

## Scope

- Repository: `/home/charles/offline/nuxt-edge-agentic-rag`
- Worktree: `/home/charles/offline/nuxt-edge-agentic-rag-wt/backlog-cleanup`
- Branch: `session/2026-09-06-1222-backlog-cleanup` (created by `wt-helper add`)
- Owned files: `HANDOFF.md`, `docs/tech-debt.md`, `docs/archives/tech-debt-closed-2026-09.md`, and this task receipt.
- No source code, tests, `.claude/**`, `.cursor/**`, workflow, commit, merge, flow, or push changes were made.
- The worktree inherited 91 pre-existing dirty paths from the repository baseline, including clade projections and `CLAUDE.md`;
  those paths were not edited. The global `git diff --check` is blocked by an inherited `.npmrc:8` trailing blank line;
  the owned-path check passes.

## Original TD manifest and disposition

| ID | Original status | Disposition | Evidence / blocker |
| --- | --- | --- | --- |
| TD-027 | in-progress | retained active | local migration verified; staging/production Claude.ai connector journey pending |
| TD-045 | in-progress | retained active | cleanroom migration auto-apply, first login/chat 200, and intermittent D1 binding trace pending |
| TD-054 | open | retained active | Safari private-window three-entry acceptance pending |
| TD-056 | open | retained active | judge truncation telemetry/repro and production reduction pending |
| TD-057 | open | retained active | wide-event lifecycle ordering fix and evidence pending |
| TD-058 | open | retained active | six production orphaned `user_profiles` rows require independent remediation |
| TD-060 | in-progress | retained active | staging/production retrieval-score acceptance under `rag-query-rewriting` pending |
| TD-061 | open | retained active | 10/35 production pipeline errors require fix and post-fix sampling |
| TD-062 | open | retained active | duplicated retrieve closure remains in three entry points |
| TD-063 | open | retained active | duplicated rewriter callback documentation remains in four files |
| TD-064 | open | retained active | integration test still mocks DB; real D1 round-trip coverage pending |
| TD-065 | open | retained active | nullable TypeScript input conflicts with NOT NULL D1 column |
| TD-066 | open | retained active | `RewriterStatus` still lacks `switch + assertNever` exhaustiveness |
| TD-067 | open | retained active | test tsconfig baseline remains 191 errors across 63 files |
| TD-068 | open | retained active | deploy secret inventory, workflow `secrets:` wiring, and staging proof pending |
| TD-069 | open | retained active | production `evlog_events` D1 migration and §7.1–7.4 evidence pending |
| TD-070 | open | retained active | seven manual-review items need `[discuss]` markers and evidence trail |
| TD-071 | done | source-key collision receipt | canonical `TD-071` already belongs to AutoRAG → AI Search migration in `tech-debt-closed-2026-06.md`; completed deploy-test evidence preserved without reusing ID |
| TD-072 | missing in body (index said done) | retained active, normalized open | local five-commit backlog was pushed; clade-side consecutive-withheld alert/follow-up remains open |

## Handoff disposition

The completed production chat empty-answer narrative was removed from the active handoff after v0.57.10 deploy and
production verification. Current changes, review items, blockers, external signals, deferred blocks, and stash ownership
remain in `HANDOFF.md`; no handoff entry was silently dropped.

## Verification record

- Source baseline: 19 unique `## TD-NNN —` records in `docs/tech-debt.md` at worktree HEAD `69f79920`.
- Result: 18 active records remain; completed source-key collision `TD-071` is represented by a non-ID receipt because the canonical ID already exists in the 2026-06 archive.
- `TD-071` canonical collision check: exactly one `^## TD-071 —` exists across all `docs/archives/tech-debt-closed-*.md`; the new archive contains no `TD-071` heading.
- Active records retain `Status`, `Priority`, `Discovered`, `Location`, `Problem`, `Fix approach`, and `Acceptance`.
- The source-key collision receipt contains terminal status, resolution/reason, and evidence.
- Scoped `git diff --check -- HANDOFF.md docs/tech-debt.md docs/archives/tech-debt-closed-2026-09.md tasks/2026-09-06-backlog-cleanup.md` passes.
