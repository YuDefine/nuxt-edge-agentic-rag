# 專案結構說明

## 概覽

本專案為 **Nuxt Edge Agentic RAG** 系統，採用 Nuxt 3 + Cloudflare Workers 架構，實現企業知識庫的 RAG（Retrieval-Augmented Generation）問答功能。

```
nuxt-edge-agentic-rag/
├── app/                    # Nuxt 前端應用
├── server/                 # Nitro 後端 API
├── shared/                 # 前後端共用程式碼
├── docs/                   # 專案文件
├── openspec/               # Spectra 規格與變更管理
├── test/                   # 測試檔案
├── scripts/                # 建置與工具腳本
└── .claude/                # Claude Code 設定與規則
```

## 目錄詳解

### `app/` — 前端應用

```
app/
├── assets/css/             # 全域樣式
├── components/             # Vue 元件
│   ├── chat/               # 聊天介面元件
│   └── documents/          # 文件管理元件
├── composables/            # Vue Composables
├── layouts/                # 頁面佈局
├── middleware/             # 路由中介層
├── pages/                  # 頁面路由
│   ├── admin/              # 管理後台頁面
│   │   └── documents/      # 文件管理（列表/上傳/詳情）
│   ├── auth/               # 認證頁面
│   └── chat/               # 聊天頁面
├── types/                  # 前端型別定義
└── utils/                  # 工具函式
```

### `server/` — 後端 API

```
server/
├── api/                    # API 路由
│   ├── admin/              # 管理 API（需 admin 權限）
│   │   └── documents/      # 文件管理 API
│   ├── documents/          # 文件 API（發布等）
│   ├── uploads/            # 上傳 API（presign/finalize）
│   ├── citations/          # 引用 API
│   ├── mcp/                # MCP 協議 API
│   └── setup/              # 設定 API
├── database/
│   └── migrations/         # D1 資料庫 migration
├── middleware/             # 伺服器中介層
├── plugins/                # Nitro 插件
└── utils/                  # 後端工具函式
```

### `shared/` — 共用程式碼

```
shared/
├── schemas/                # Zod 驗證 schema
└── types/                  # 共用型別定義
```

### `docs/` — 專案文件

```
docs/
├── STRUCTURE.md            # 本文件 — 專案結構說明
├── sample-documents/       # 上傳測試用範例文件
├── verify/                 # 開發驗證指南
│   ├── TEST_DRIVEN_DEVELOPMENT.md
│   ├── OAUTH_SETUP.md
│   └── ...
├── manual-review-checklist.md
└── manual-review-archive.md
```

### `openspec/` — Spectra 規格管理

```
openspec/
├── ROADMAP.md              # 專案路線圖
├── specs/                  # 功能規格
│   ├── admin-document-management-ui/
│   └── web-chat-ui/
└── changes/                # 變更提案
    ├── archive/            # 已完成的變更
    └── {change-name}/      # 進行中的變更
```

### `test/` — 測試

```
test/
├── unit/                   # 單元測試
├── integration/            # 整合測試
├── acceptance/             # 驗收測試
│   ├── fixtures/           # 測試案例資料
│   ├── helpers/            # 測試輔助函式
│   └── registry/           # 測試案例註冊
└── fixtures/               # 測試 fixture
```

### `.claude/` — Claude Code 設定

```
.claude/
├── agents/                 # 子代理定義
├── commands/               # 自訂指令
├── hooks/                  # 自動化 hook
├── rules/                  # 開發規則
├── scripts/                # 輔助腳本
└── skills/                 # 技能定義
```

### 其他目錄

| 目錄         | 說明                      |
| ------------ | ------------------------- |
| `e2e/`       | E2E 測試（Playwright）    |
| `scripts/`   | 建置腳本、檢查腳本        |
| `supabase/`  | Supabase 設定（snippets） |
| `.github/`   | GitHub Actions、PR 範本   |
| `.wrangler/` | Wrangler 本地開發狀態     |
| `.data/`     | NuxtHub 本地開發資料      |

## 重要檔案

| 檔案             | 說明                    |
| ---------------- | ----------------------- |
| `nuxt.config.ts` | Nuxt 設定               |
| `wrangler.jsonc` | Cloudflare Workers 設定 |
| `.spectra.yaml`  | Spectra 設定            |
| `CLAUDE.md`      | Claude Code 專案指示    |

## 資料流

```
使用者 → pages/ → composables/ → server/api/ → database/
                                      ↓
                              Cloudflare R2 (文件儲存)
                              Cloudflare D1 (資料庫)
                              Cloudflare Vectorize (向量搜尋)
```

## 相關文件

- [開發規則](../.claude/rules/) — 程式碼品質與開發流程規範
- [Spectra 規格](../openspec/specs/) — 功能規格文件
- [驗證指南](./verify/) — 開發環境設定與驗證步驟
