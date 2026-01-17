---
applyTo: '**'
description: Available skills, commands, and agents. When user mentions a skill/command name, read the corresponding file and follow its instructions.
---

# Skills System

This project uses a skill system for structured workflows. Artifacts are in `.agents/`:

- **Skills**: `.agents/skills/<name>/SKILL.md` — reusable procedures
- **Commands**: `.agents/commands/<name>.md` — action-oriented workflows
- **Agents**: `.agents/agents/<name>.md` — specialized agent definitions

## How to Use in Copilot

When the user mentions a skill/command by name (e.g., "run spectra-apply", "commit", "ship"), you should:

1. Read the corresponding file in `.agents/`
2. Follow the instructions step by step
3. Execute any CLI commands mentioned (e.g., `spectra status`, `git status`)

## Spectra Skills (Spec-Driven Development)

| Skill             | Purpose                                | When to Use                                       |
| ----------------- | -------------------------------------- | ------------------------------------------------- |
| `spectra-discuss` | Structured discussion before coding    | When requirements are vague or need clarification |
| `spectra-propose` | Create a change proposal               | When requirements are clear and ready to plan     |
| `spectra-apply`   | Implement tasks from a change          | When tasks are ready to implement                 |
| `spectra-ingest`  | Update artifacts during implementation | When discovering spec changes mid-implementation  |
| `spectra-ask`     | Query existing specs                   | When you need to understand how something works   |
| `spectra-archive` | Archive a completed change             | When all tasks and reviews are done               |
| `spectra-debug`   | Systematic debugging                   | When encountering unexpected errors               |
| `spectra-audit`   | Audit code for issues                  | Before committing Tier 2/3 changes                |

### Spectra Workflow

```
discuss? → propose → apply ⇄ ingest → archive
```

### Example Usage

User says: "run spectra-apply"
You should:

1. Read `.agents/skills/spectra-apply/SKILL.md`
2. Follow the steps: select change → check status → implement tasks
3. Mark tasks complete in the tasks.md file

## Design Skills

| Skill      | Purpose                       |
| ---------- | ----------------------------- |
| `design`   | UI/UX design orchestrator     |
| `arrange`  | Improve layout and spacing    |
| `audit`    | Comprehensive interface audit |
| `colorize` | Add strategic color           |
| `polish`   | Final quality pass            |

## Development Skills

| Skill                     | Purpose                               |
| ------------------------- | ------------------------------------- |
| `test-driven-development` | TDD workflow (Red → Green → Refactor) |
| `vue`                     | Vue 3 Composition API patterns        |
| `nuxt`                    | Nuxt full-stack patterns              |
| `vitest`                  | Testing with Vitest                   |

## Commands

Commands are action-oriented workflows in `.agents/commands/`:

| Command          | Purpose                              | File                |
| ---------------- | ------------------------------------ | ------------------- |
| `commit`         | Structured commit with quality gates | `commit.md`         |
| `ship`           | Auto release: check → push → PR      | `ship.md`           |
| `freeze`         | Protect paths from modification      | `freeze.md`         |
| `unfreeze`       | Unprotect paths                      | `unfreeze.md`       |
| `guard`          | Show/manage safety guardrails        | `guard.md`          |
| `doc-sync`       | Sync documentation                   | `doc-sync.md`       |
| `second-opinion` | Independent code review              | `second-opinion.md` |
| `sprint-status`  | Show development dashboard           | `sprint-status.md`  |
| `canary`         | Post-deploy health check             | `canary.md`         |
| `retro`          | Sprint retrospective                 | `retro.md`          |

## Agents

Specialized agents in `.agents/agents/`:

| Agent               | Purpose                     | File                   |
| ------------------- | --------------------------- | ---------------------- |
| `code-review`       | Code review a PR or changes | `code-review.md`       |
| `screenshot-review` | Visual QA via screenshots   | `screenshot-review.md` |
| `check-runner`      | Run full code checks        | `check-runner.md`      |

## Invoking Skills/Commands

To invoke, the user can say:

- "run [name]" or "use [name]"
- "[name] [args]" (e.g., "spectra-apply add-auth", "commit")

When you see these patterns:

1. Check `.agents/skills/[name]/SKILL.md` first
2. If not found, check `.agents/commands/[name].md`
3. Execute the procedure step by step
