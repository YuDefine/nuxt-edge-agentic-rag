# TDD 實踐指南

## 核心流程

```
Red → Green → Refactor
```

1. **Red**：寫一個失敗的測試
2. **Green**：寫最少的程式碼讓測試通過
3. **Refactor**：改善程式碼結構，確保測試仍然通過

## Pre-Commit 檢查清單

- [ ] 所有新功能都有對應測試
- [ ] `pnpm test` 全部通過
- [ ] 沒有 `.skip` 或被註解的測試
- [ ] Mock 只用在外部依賴（API、DB），不 mock 內部邏輯

## 測試分類

| 類型 | 路徑                       | 用途                       |
| ---- | -------------------------- | -------------------------- |
| Unit | `test/unit/*.test.ts`      | 純函式、composables、utils |
| Nuxt | `test/nuxt/*.nuxt.test.ts` | 需要 Nuxt 環境的元件測試   |
| E2E  | `e2e/*.spec.ts`            | 端對端使用者流程           |

## 測試覆蓋率目標

- Server API：每個 endpoint 至少 1 個測試（happy path + validation）
- 業務邏輯：完整邊界測試
- Composables：初始狀態 + 主要行為
- feat:test commits 比例 >= 2:1

## Integration Test Mocking

Integration test 位於 `test/integration/*.test.ts`，透過 `#server/utils/...` 實際
載入 production handler。共用 mock helper 位於 `test/integration/helpers/`，
集中化避免多檔重複 boilerplate。

### `createHubDbMock({ database? })`

`server/utils/database.ts` 在 runtime 透過動態 `import('hub:db')` 取得 D1 binding，
vitest 環境無法 resolve，必須在模組層級 mock。共用 helper：

```typescript
// test/integration/helpers/database.ts
export function createHubDbMock(options: HubDbMockOptions = {}) {
  const resolveDatabase = () =>
    typeof options.database === 'function'
      ? (options.database as () => unknown)()
      : (options.database ?? {})

  return {
    getD1Database: async () => resolveDatabase(),
    getDrizzleDb: async () => ({ db: resolveDatabase(), schema: {} }),
  }
}
```

**用法 A — 另外 mock 所有 store（不需要真 D1）**：

```typescript
vi.mock('../../server/utils/database', () => createHubDbMock())

// 個別 mock citation-store / conversation-store / mcp-replay 等
vi.mock('../../server/utils/citation-store', () => ({
  createCitationStore: vi.fn().mockReturnValue({ persistCitations: vi.fn() }),
}))
```

適用情境：chat-route、citations-route、publish-route 等只測 handler 邏輯，
不碰 D1 fake 的測試。

**用法 B — 傳 getter 給 TC acceptance tests（per-test 動態 bindings）**：

```typescript
const tc01Mocks = vi.hoisted(() => ({ bindings: null }))

vi.mock('../../server/utils/database', async () => {
  const { createHubDbMock } = await import('./helpers/database')

  return createHubDbMock({ database: () => (tc01Mocks.bindings ?? {}).DB })
})

beforeEach(() => {
  tc01Mocks.bindings = null // 每個 it 重置
})

it.each(cases)('...', async (fixture) => {
  tc01Mocks.bindings = createTc01Bindings(...) // 該 test 的 D1 fake
  // handler 呼叫 getD1Database() 時會透過 getter 取得最新的 DB
})
```

適用情境：acceptance TC tests，每個 it 重置 D1 fake（含不同 SQL responders），
需要讓 `getD1Database()` 在每次呼叫時即時解析。

### Closure 模式（lazy getter）的理由

`beforeEach` 在每個 `it` 執行前重置 `tcXXMocks.bindings = null`，然後測試內
`tcXXMocks.bindings = createTcXXBindings(...)`。若 helper 只接 static 值：

```typescript
// ❌ 錯 — database 值在 vi.mock 執行時就被凍結，後續 beforeEach 重置無感
vi.mock('...', () => createHubDbMock({ database: tcXXMocks.bindings?.DB }))
```

Getter 模式讓 `getD1Database()` 每次呼叫都讀當下的 `tcXXMocks.bindings`：

```typescript
// ✅ 對 — getter 延遲到 getD1Database() 呼叫時才解析
vi.mock('...', async () => {
  const { createHubDbMock } = await import('./helpers/database')
  return createHubDbMock({ database: () => (tcXXMocks.bindings ?? {}).DB })
})
```

### Dynamic import factory 陷阱

vitest 會把 `vi.mock('...')` 的 factory 提升至檔頂（hoist），優先於一般 `import`
執行。若 factory 直接使用 top-level 的 `import { createHubDbMock } from './helpers/database'`，
而該 test 又同時 mock 了會觸發 eager module resolution 的 module
（例如 `vi.mock('...', async (importOriginal) => { const actual = await importOriginal(); ... })`
的 `knowledge-runtime`），就會得到：

```
Cannot access '__vi_import_5__' before initialization
```

原因：`importOriginal` 觸發上游 module 的 eager 解析，連動呼叫 `database`
mock factory，此時 top-level import 尚未完成初始化。

**解法**：改用 dynamic `import()` 在 factory 內部取得 helper，延後 binding：

```typescript
vi.mock('../../server/utils/database', async () => {
  const { createHubDbMock } = await import('./helpers/database')

  return createHubDbMock({ database: () => (tcXXMocks.bindings ?? {}).DB })
})
```

chat-route / citations-route 等單純的 test 不碰 `importOriginal` 不會觸發此
陷阱，可用 `() => createHubDbMock()` 直接呼叫。TC acceptance tests 幾乎都
會 mock `knowledge-runtime` + `importOriginal`，一律用 dynamic import 寫法。

### 與 `nuxt-route.ts` helper 的分工

| Helper                                               | 角色                                                  |
| ---------------------------------------------------- | ----------------------------------------------------- |
| `helpers/database.ts::createHubDbMock`               | 取代 `hub:db` runtime resolution，提供 D1 fake        |
| `helpers/nuxt-route.ts::createRouteEvent`            | 模擬 H3 event（`event.context`、`readValidatedBody`） |
| `helpers/nuxt-route.ts::installNuxtRouteTestGlobals` | stub Nuxt/H3 globals（`createError` 等）              |
| `helpers/mcp-tool-runner.ts::runMcpTool`             | 執行 MCP tool handler 並注入 auth + pending event     |

兩者互補：`nuxt-route` 負責 HTTP/MCP 執行環境，`database` 負責 DB binding。
一個標準 TC test 四個 helper 都會用到。

## 參考

- [Vitest 文件](https://vitest.dev/)
- [Vue Test Utils](https://test-utils.vuejs.org/)
- [Playwright](https://playwright.dev/)
- `.claude/rules/testing-anti-patterns.md` — 測試反模式指南
