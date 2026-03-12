/**
 * hub:db 在測試環境無法 resolve，server/utils/database.ts 的 getD1Database() 會
 * 動態 import('hub:db') 炸掉。所有呼叫 getD1Database() 的 integration test 必須
 * 在模組層級加上：
 *
 *   vi.mock('../../server/utils/database', () => createHubDbMock())
 *
 * 其他 database-backed store（createMcpReplayStore、createCitationStore 等）通常
 * 另外 mock，所以這裡回傳空物件即可；若 test 需要真的傳 D1 fake，傳入 database。
 *
 * 若 test 需要 per-test 動態 bindings（例如 `tcXXMocks.bindings` 在 beforeEach 重置），
 * database 可傳 function，每次呼叫時即時解析：
 *
 *   vi.mock('../../server/utils/database', () =>
 *     createHubDbMock({ database: () => tcXXMocks.bindings?.DB })
 *   )
 */

export interface HubDbMockOptions {
  database?: unknown | (() => unknown)
}

export function createHubDbMock(options: HubDbMockOptions = {}) {
  const resolveDatabase = () =>
    typeof options.database === 'function'
      ? (options.database as () => unknown)()
      : (options.database ?? {})

  return {
    getD1Database: async () => resolveDatabase(),
    getDrizzleDb: async () => {
      const database = resolveDatabase()

      return { db: database, schema: {} }
    },
  }
}
