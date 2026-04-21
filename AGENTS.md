<!-- AUTO-GENERATED from .claude/ — 請勿手動編輯 -->

<!-- SPECTRA:START v2.2.3 -->

# Spectra Instructions

This project uses Spectra 2.2.3 for Spec-Driven Development (SDD). Specs live in `openspec/specs/`, change proposals in `openspec/changes/`. Config: `.spectra.yaml`.

## Use `/spectra-*` skills when:

- A discussion needs structure before coding → `/spectra-discuss`
- User wants to plan, propose, or design a change → `/spectra-propose`
- Tasks are ready to implement → `/spectra-apply`
- There's an in-progress change to continue → `/spectra-ingest`
- User asks about specs or how something works → `/spectra-ask`
- Implementation is done → `/spectra-archive`

## Workflow

discuss? → propose → apply ⇄ ingest → archive

<!-- SPECTRA:END -->

## RTK Instructions

Use RTK (Rust Token Killer) to reduce token-heavy shell output when running commands through an AI coding assistant.

### Command Routing

- Prefer `rtk git status`, `rtk git diff`, `rtk git log`, `rtk gh ...` for Git and GitHub CLI output.
- Prefer `rtk pnpm ...`, `rtk npm ...`, `rtk vitest`, `rtk playwright test`, `rtk lint`, and `rtk tsc` for package manager, test, lint, and typecheck output.
- Prefer `rtk grep`, `rtk find`, `rtk read`, and `rtk ls` when the expected output is large.
- Use raw shell commands for small, structural, or shell-native operations such as `pwd`, `cd`, `mkdir`, `test`, `[ ... ]`, `[[ ... ]]`, `true`, `false`, `export`, `printf`, and `echo`.
- Do not rewrite shell builtins as RTK subcommands. For example, use `test -d path`, not `rtk test -d path`.
- For shell syntax, compound commands, heredocs, or commands RTK does not understand, use the raw command or `rtk proxy <command>` only when compact tracking is still useful.

### Sandbox Database

RTK tracking must use a Codex-writable database path:

```toml
[tracking]
database_path = "/Users/charles/.codex/memories/rtk/history.db"
```

## Project Report

**Current Version**: `main-v0.0.48.md`

專題報告作為本專案的 Single Source of Truth，包含：討論紀錄、提案內容、實作成果、結論總結。

### 維護原則

1. **實作與文件同步**：程式碼變更若影響報告內容，須同步更新報告
2. **版本遞增**：修訂報告時複製新版本並遞增版號（如 `main-v0.0.37.md`）
3. **禁止覆寫**：不得直接修改既有版本檔案
