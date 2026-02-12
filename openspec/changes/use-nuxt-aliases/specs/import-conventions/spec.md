## ADDED Requirements

### Requirement: Alias-based cross-module imports

Source files under `app/`, `server/`, `shared/`, and `test/` SHALL import cross-module dependencies through Nuxt 4 built-in path aliases instead of `../` relative paths that traverse a directory boundary.

The mapping between source directory and alias SHALL follow this table:

| Importer root | Target tree        | Required alias prefix |
| ------------- | ------------------ | --------------------- |
| `app/`        | `shared/`          | `#shared/`            |
| `server/`     | `shared/`          | `#shared/`            |
| `server/`     | `server/` (deeper) | `#server/`            |
| `test/`       | `app/`             | `~/`                  |
| `test/`       | `server/`          | `#server/`            |
| `test/`       | `shared/`          | `#shared/`            |

Within-file-tree sibling imports (for example `./helpers` inside the same feature folder) MAY continue to use relative paths and are NOT covered by this requirement.

**Exception: files loaded outside the Nuxt module resolver** (for example `server/auth.config.ts` loaded by `@onmax/nuxt-better-auth` via `jiti`) MUST use relative paths for cross-module imports, because their loader does not resolve Nuxt virtual aliases (`#shared`, `#server`). Such files SHALL include a one-line comment noting why the relative path is retained.

#### Scenario: Server util imports shared schema

- **WHEN** a file under `server/utils/` needs a symbol exported from `shared/schemas/knowledge-runtime.ts`
- **THEN** the import statement MUST use `#shared/schemas/knowledge-runtime`
- **AND** MUST NOT use `../../shared/schemas/knowledge-runtime`

#### Scenario: Test file imports server util

- **WHEN** a file under `test/unit/` needs a symbol exported from `server/utils/knowledge-answering.ts`
- **THEN** the import statement MUST use `#server/utils/knowledge-answering`
- **AND** MUST NOT use `../../server/utils/knowledge-answering`

#### Scenario: Same-folder helper import

- **WHEN** `server/api/admin/documents/index.get.ts` imports from a sibling file `./validation.ts` in the same folder
- **THEN** the relative path `./validation` is permitted and the alias form is NOT required

### Requirement: Vitest alias parity with Nuxt runtime

The `vitest.config.ts` alias table SHALL declare every non-default path alias that test files are allowed to use, so that tests can resolve the same alias prefixes that Nuxt resolves at runtime.

At minimum this SHALL include: `~`, `@`, `~~`, `@@`, `#shared`, `#server`.

Adding a new alias prefix to Nuxt runtime resolution (via `nuxt.config.ts` `alias`) SHALL be accompanied by the same entry in `vitest.config.ts` in the same change.

#### Scenario: Test imports `#shared/*` successfully

- **WHEN** a file under `test/` runs via `pnpm test` and contains `import { foo } from '#shared/schemas/bar'`
- **THEN** Vitest MUST resolve the import to `shared/schemas/bar.ts`
- **AND** the test run MUST NOT fail with a module-not-found error for the `#shared` prefix

#### Scenario: New alias added to Nuxt only

- **WHEN** a contributor adds a new path alias `#foo` to `nuxt.config.ts` but not to `vitest.config.ts`
- **THEN** the change violates this requirement
- **AND** either `vitest.config.ts` MUST be updated in the same change, or the alias MUST be added to both configs before tests are expected to use it
