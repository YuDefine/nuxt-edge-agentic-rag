## Why

目前 chat 頁面（`/`）在 `lg` 以上永遠強制顯示 `w-64` 的對話記錄 sidebar，使用者無法收合讓 chat 主區擴寬；加上對話數量累積後，扁平列表缺乏時間分組，舊對話難以定位。本次加上「sidebar 可收合」＋「列表依時間分組可摺疊」的雙層收合機制，讓使用者自行控制空間分配與資訊密度，同時維持對話可點選與刪除的主要互動。

## What Changes

- **Sidebar collapsible（lg+ only）**：`app/pages/index.vue` 左側 `<aside>` 加上 collapsed state，展開態維持 `w-64` 完整列表，收合態為 `w-12` icon rail（只顯示歷史圖示 + 對話總數 Badge + 新增對話按鈕）。
- **Persistent state**：以 `useLocalStorage` 記住 collapse 狀態（key：`chat:history-sidebar:collapsed`，預設 `false`），跨 session 保留使用者偏好。
- **Toggle 按鈕**：展開態放在 sidebar header 右側、收合態放在 rail 頂端，icon 採 `i-lucide-panel-left-close` / `i-lucide-panel-left-open`，搭 `UTooltip` 在 collapsed 時顯示文字提示。
- **列表時間分組**：`ConversationHistory.vue` 依 `updatedAt` 將對話分入「今天 / 昨天 / 本週 / 本月 / 更早」五個 bucket；每個非空 bucket 用 `UCollapsible` 包裝，header 顯示組名 + 對話數 `UBadge` + chevron 旋轉 icon。
- **預設展開策略**：今天、昨天、本週預設展開；本月、更早預設收起，讓最近對話優先可見。
- **Collapsed rail 可互動**：收合態的 rail 頂端 toggle 按鈕可點擊展開；歷史 icon + Badge 整體作為次要展開觸發（點擊即展開），無需展開後再點歷史項目。

## Non-Goals

- **NOT** 變更 `< lg` 的 `USlideover` drawer 行為（drawer 展開即全寬，不適合 rail 概念）。
- **NOT** 新增對話搜尋、重新命名、pin 等功能（本次只處理收合與分組）。
- **NOT** 改變 `useChatConversationHistory` composable API，或 `ChatConversationHistory` 對外 props / emits 契約。
- **NOT** 變更對話列表的資料來源、刪除流程、或 `conversation-selected` / `conversation-cleared` 事件語意。
- **NOT** 加入 virtualization 或 pagination（對話數量若真成長到需要，另案處理）。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `responsive-and-a11y-foundation`: 擴充 `Mobile-First Layout Pattern At md Breakpoint` requirement，加入「chat conversation history sidebar 在 `lg` 以上可由使用者收合成 icon rail，狀態須跨 session 保留」的新 scenario。既有 `md` 以下 drawer 行為維持不變。

## Impact

- Affected specs:
  - Modified: `responsive-and-a11y-foundation` — 新增 scenario 描述 lg+ collapsible rail 行為與狀態保留。
- Affected code:
  - Modified:
    - `app/pages/index.vue` — 左側 `<aside>` 加 collapsed state、寬度切換、rail 版 template；`lg` 以下 drawer 部分不動。
    - `app/components/chat/ConversationHistory.vue` — 列表改為時間分組、加入 collapsed prop 支援 rail 顯示、toggle 按鈕。
  - New:
    - `app/utils/conversation-grouping.ts` — 純函式：`groupConversationsByRecency(conversations, now)` 將列表分入五個 time bucket。
    - `test/unit/conversation-grouping.test.ts` — `groupConversationsByRecency` 的邊界測試（今天 / 昨天 / 本週邊界 / 本月邊界 / 更早）。
  - Removed:（無）
- Affected runtime / API / data model: **無**（純前端 UI refactor，不動 server、D1、API、shared schema）。
- Review tier: **Tier 2**（跨兩個 UI 檔案 + 新增純函式與測試；觸動 `responsive-and-a11y-foundation` spec 擴充；需要 design review + screenshot review）。

## Affected Entity Matrix

**No DB entity / shared type touched** — 純前端 UI refactor，不改 D1 schema、不擴張 enum、不變更 `shared/types/`、不加 API route。`ChatConversationSummary` shape 完全沿用既有。

## User Journeys

### Web User — 已登入，對話數量 ≥ 6（含今天/本週/更早分組）

1. 開 `/` → 預設看到左側 sidebar 展開（`w-64`），列表依時間分組，「今天 / 昨天 / 本週」三組預設展開，看得到對話；「本月 / 更早」預設收起，只看到組名 + 數量 Badge。
2. 點「更早」組 header → 該組展開列出對話，chevron 旋轉 180°。再點一次 → 收起。
3. 點 sidebar header 右側的 `i-lucide-panel-left-close` 按鈕 → sidebar 以 `transition-[width]` 收合成 `w-12` icon rail，只剩 rail 頂端的 toggle icon + 歷史 icon + 對話總數 Badge + 新增對話按鈕。
4. Reload 頁面 → sidebar 維持 collapsed 狀態（從 localStorage 還原）。
5. 在 collapsed rail 上 hover 歷史 icon → `UTooltip` 顯示「展開對話記錄」。點擊 → sidebar 展開，剛剛的 bucket 展開狀態保留（session 內記憶體狀態，不需要 localStorage）。
6. 點擊某個對話項 → `conversation-selected` 觸發，chat 主區載入對話內容（行為與現有一致）。

### Web User — 已登入，對話數量 = 0

1. 開 `/` → sidebar 展開（或依上次偏好收合），展開態顯示現有的 empty state「尚無已保存對話...」提示；收合態 rail 的 Badge 顯示 `0` 或隱藏。
2. 送出第一個問題後 → 新對話出現在「今天」組（預設展開），使用者立刻看見。

### Web User — 已登入，lg 以下（mobile / tablet）

1. 開 `/` → 左側 sidebar 不 inline 顯示，行為與現況一致：從 chat header 按 `i-lucide-history` 按鈕 → `USlideover` drawer 從左側滑出，顯示**分組後**的對話列表（與 desktop 展開態相同內容，但不適用 rail collapse 概念）。
2. Drawer 內仍可點擊分組 header 收合／展開，與 desktop 行為一致。

### Guest User（未登入或訪客）

- 不受本 change 影響 —— `ChatGuestAccessGate` 的 gate 行為、`GuestAccessGate.vue` UI 與 sidebar 存在與否的判斷皆沿用現況。

## Implementation Risk Plan

- **Truth layer / invariants**：`ChatConversationSummary.updatedAt` 是 grouping 的唯一輸入，其 ISO-8601 語意不變；`groupConversationsByRecency` 為**純函式**（無副作用、吃 `now` 參數），確保 SSR 與 client 時區一致（以 client local time 算 bucket，避免 UTC midnight 誤判）；localStorage key `chat:history-sidebar:collapsed` 只存布林，SSR 預設 `false`。
- **Review tier**：Tier 2（兩個 UI 檔案 + 新純函式 + spec 擴充；Design Gate + Screenshot Review 必跑；不涉 migration / auth / raw SQL）。
- **Contract / failure paths**：localStorage 不可用（Safari 隱私模式 / 禁用）→ fallback 為 in-memory ref（`useLocalStorage` 原生支援）；`updatedAt` 非法或缺失 → 歸入「更早」bucket，不 crash；SSR hydration 階段避免讀 localStorage，首次 paint 一律展開態，mount 後再套用 persisted 值（避免 hydration mismatch）。
- **Test plan**：Unit（`groupConversationsByRecency` 邊界測試：今天/昨天/本週/本月邊界 + 空陣列 + 非法 `updatedAt`）＋ 既有 `ChatConversationHistory` 行為測試（refreshKey / selected / delete 不回歸）＋ Screenshot Review（desktop 展開 / 收合 / drawer 三態，light + dark）＋ 人工檢查 journey 1-6。
- **Artifact sync**：`openspec/specs/responsive-and-a11y-foundation/spec.md` delta（ADD scenario）；`docs/rules/ux-completeness.md` 無需改；若新增 `app/utils/conversation-grouping.ts`，不需同步 `shared/types/`（純 UI 工具，不跨 server / client boundary）。
