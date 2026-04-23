## 1. Root Handoff Artifact Becomes Canonical

- [x] 1.1 更新 `report-artifact-governance` delta，將 cross-session planning 與 session-scoped handoff 的 canonical path 正規化為 repo root `HANDOFF.md`（對應 Requirement: `Cross-Session Report Planning Lives In OpenSpec Roadmap`、`Handoff Remains Session-Scoped`；design `Canonical path becomes repo root HANDOFF.md`）
- [x] 1.2 以整理後的有效內容建立 repo root `HANDOFF.md`，搬移目前仍需交接的 session 狀態，然後刪除 `template/HANDOFF.md` 與空的 `template/` 目錄（對應 Requirement: `Handoff Remains Session-Scoped`；design `Migrate current contents before deleting template`）

## 2. Live References And Decision Records Stay Consistent

- [x] 2.1 重寫 live `openspec/specs/**/spec.md` 中仍指向 `template/HANDOFF.md` 的 requirement / `@trace` metadata，使其全部改指向 `HANDOFF.md`，但不得修改 `openspec/changes/archive/**`（對應 Requirement: `Cross-Session Report Planning Lives In OpenSpec Roadmap`、`Handoff Remains Session-Scoped`；design `Archive references remain untouched`）
- [x] 2.2 新增 `docs/decisions/2026-04-23-canonical-root-handoff-artifact.md`，記錄 root `HANDOFF.md` 為唯一 canonical handoff artifact 的決策與不回寫 archive 的理由（對應 Requirement: `Handoff Remains Session-Scoped`；design `Canonical path becomes repo root HANDOFF.md`）

## 3. Verification

- [x] 3.1 執行 live 路徑掃描與 `spectra analyze canonical-root-handoff-path --json`，確認 `template/HANDOFF.md` 只存在於 archive 歷史，且 change artifacts 與 live spec 沒有一致性錯誤（對應 Requirement: `Cross-Session Report Planning Lives In OpenSpec Roadmap`、`Handoff Remains Session-Scoped`；design `Archive references remain untouched`）
