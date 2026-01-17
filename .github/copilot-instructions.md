# Copilot Instructions

This project follows specific development guidelines. See detailed rules in `.github/instructions/`.

## Skill System

This project uses a skill-based workflow. When the user mentions a skill name (e.g., "spectra-apply", "commit"), read the corresponding file and follow its instructions:

- **Skills**: `.agents/skills/<name>/SKILL.md` — reusable procedures
- **Commands**: `.agents/commands/<name>.md` — action-oriented workflows
- **Agents**: `.agents/agents/<name>.md` — specialized agent definitions

### Key Skills (Spectra Workflow)

| Skill             | Purpose                  | Trigger              |
| ----------------- | ------------------------ | -------------------- |
| `spectra-discuss` | Structured discussion    | Requirements unclear |
| `spectra-propose` | Create change proposal   | Requirements clear   |
| `spectra-apply`   | Implement tasks          | Tasks ready          |
| `spectra-archive` | Archive completed change | All done             |

**Workflow**: discuss? → propose → apply ⇄ ingest → archive

### Key Commands

| Command               | Purpose                              |
| --------------------- | ------------------------------------ |
| `commit`              | Structured commit with quality gates |
| `ship`                | Auto release: check → push → PR      |
| `freeze` / `unfreeze` | Protect/unprotect paths              |

### Invoking Skills

When user says "run [name]" or "[name] [args]":

1. Read the corresponding `.md` file in `.agents/`
2. Follow the documented procedure step by step
3. Execute CLI commands as needed (e.g., `spectra status`)

## Available Instruction Files

- [skills](instructions/skills.instructions.md) — **Full skill reference**
- [api_patterns](instructions/api_patterns.instructions.md)
- [commit](instructions/commit.instructions.md)
- [development](instructions/development.instructions.md)
- [error_handling](instructions/error_handling.instructions.md)
- [handoff](instructions/handoff.instructions.md)
- [knowledge_and_decisions](instructions/knowledge_and_decisions.instructions.md)
- [logging](instructions/logging.instructions.md)
- [manual_review](instructions/manual_review.instructions.md)
- [mcp_remote](instructions/mcp_remote.instructions.md)
- [proactive_skills](instructions/proactive_skills.instructions.md)
- [review_tiers](instructions/review_tiers.instructions.md)
- [screenshot_strategy](instructions/screenshot_strategy.instructions.md)
- [testing_anti_patterns](instructions/testing_anti_patterns.instructions.md)
- [unused_features](instructions/unused_features.instructions.md)
- [ux_completeness](instructions/ux_completeness.instructions.md)

## Quick Reference

Refer to `AGENTS.md` for the complete project specification.
