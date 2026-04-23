## Why

目前 live workflow 已把 handoff 的 canonical 位置視為 repo root 的 `HANDOFF.md`，但 OpenSpec 與實體檔案仍保留 `template/HANDOFF.md`。這讓執行規則、spec truth 與檔案系統彼此分裂，任何單純的搬移或刪除都可能留下錯誤指引。

## What Changes

- 將 live spec 與 trace metadata 中仍指向 `template/HANDOFF.md` 的內容改為 repo root 的 `HANDOFF.md`
- 把目前 `template/HANDOFF.md` 的 session-scoped 內容移到 repo root `HANDOFF.md`
- 刪除不再作為 canonical artifact 的 `template/HANDOFF.md`，並清空 `template/` 對 handoff 的責任
- 同步檢查 `AGENTS.md`、instruction 層、ROADMAP 與 trace references，避免 live guidance 再次分裂

## Non-Goals

- 不修改 `openspec/changes/archive/` 內的歷史紀錄
- 不重寫 handoff 的內容模型；僅正規化 canonical path 與 live references
- 不處理與 handoff 無關的 active change closeout 或 manual review 項目

## Affected Entity Matrix

**No DB schema or shared entity change**

## User Journeys

**No user-facing journey (backend-only)**

理由：此 change 僅調整 repo 內的治理 artifact 路徑與規範同步，不改動任何 end-user 或 admin 的產品介面流程。

## Implementation Risk Plan

- Truth layer / invariants: repo root `HANDOFF.md` 必須成為唯一 canonical handoff artifact；archive 歷史不得被改寫。
- Review tier: Tier 1，屬治理與文件路徑正規化，無產品行為變更。
- Contract / failure paths: 若 live spec / instruction /實體檔路徑未同步，後續 agent 仍可能依錯誤路徑建立 handoff。
- Test plan: 以路徑引用掃描、Spectra analyze、proposal/apply gate 與人工 diff 檢查為主，不需 UI 驗證。
- Artifact sync: proposal / specs / tasks、`AGENTS.md` 可到達規則、`openspec/ROADMAP.md`、repo root `HANDOFF.md` 與 live spec trace references 必須一致。

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `report-artifact-governance`: 將 handoff canonical path 從 `template/HANDOFF.md` 正規化為 repo root `HANDOFF.md`

## Impact

- Affected specs: `report-artifact-governance`
- Affected code:
  - Modified: `openspec/specs/acceptance-evidence-automation/spec.md`, `openspec/specs/admin-document-management-ui/spec.md`, `openspec/specs/admin-member-management-ui/spec.md`, `openspec/specs/auth-storage-consistency/spec.md`, `openspec/specs/conversation-lifecycle-governance/spec.md`, `openspec/specs/member-and-permission-model/spec.md`, `openspec/specs/nickname-identity-anchor/spec.md`, `openspec/specs/passkey-authentication/spec.md`, `openspec/specs/report-artifact-governance/spec.md`, `openspec/specs/web-chat-ui/spec.md`
  - New: `HANDOFF.md`, `docs/decisions/2026-04-23-canonical-root-handoff-artifact.md`
  - Removed: `template/HANDOFF.md`
