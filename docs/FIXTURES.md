# Fixtures Reference

本 consumer 走 Cloudflare 原生 storage（D1 / R2 / KV / Workers AI Vectorize），無 `supabase/seed.sql`。Fixture 形態與 supabase consumer 不同：

- **測試身分** 來自 `.env.test` + `.env.example` 的 E2E 帳號定義（D1 `user` / `user_profiles` 表）
- **樣本文件（RAG 來源）** 來自 `docs/sample-documents/`，可直接透過 Admin UI 上傳至 R2
- **D1 schema** 定義於 `server/database/migrations/`（0001–0017，共 17 個 migration）

> Cross-link 規約：任何 manual-review item inline 引用 sample 時，必須以本檔欄位為來源；若欄位標 `_待補_`，先在本地 D1 dev 插入對應 row，再回來補齊本欄位，才可進行 review。

---

## 測試身分

### E2E 帳號（本機 / staging）

帳號由 `.env.example` E2E 區段定義；`.env.test` 提供 auth secrets。

| Email               | Role（D1 `user_profiles.role_snapshot`） | 密碼          | 用途                                                      |
| ------------------- | ---------------------------------------- | ------------- | --------------------------------------------------------- |
| `admin@test.local`  | `admin`                                  | `testpass123` | 管理員操作：上傳文件、設定 `guest_policy`、Mint MCP Token |
| `member@test.local` | `member`                                 | `testpass123` | 一般成員操作：查詢 RAG、查看 citation                     |

> Source：`.env.example` L58–60（`E2E_ADMIN_EMAIL` / `E2E_MEMBER_EMAIL` / `E2E_PASSWORD`）

**注意**：三層角色為 `admin` / `member` / `guest`（migration 0006 確立）。新註冊帳號預設為 `guest`，需管理員手動提升或設 `ADMIN_EMAIL_ALLOWLIST`。

### Admin Allowlist（本機 dev 配置）

在 `.env` 設 `ADMIN_EMAIL_ALLOWLIST=admin@test.local` 以自動授予 admin 角色。

---

## 樣本文件（RAG 知識庫 fixture）

以下文件位於 `docs/sample-documents/`，可在 dev / staging Admin UI 上傳以初始化知識庫：

| 檔名                     | 類型       | 用途                                     |
| ------------------------ | ---------- | ---------------------------------------- |
| `人事管理規章.md`        | Markdown   | HR 政策文件；測試中文語義檢索            |
| `採購流程操作手冊.md`    | Markdown   | 流程文件 v1；測試版本管理                |
| `採購流程操作手冊-v2.md` | Markdown   | 流程文件 v2；測試「current_version」切換 |
| `系統操作常見問題.txt`   | Plain text | FAQ；測試 txt 解析與 chunking            |

> Source：`docs/sample-documents/index.md`

D1 `documents` 表對應欄位：`slug`（人工設定）、`access_level`（`internal` \| `restricted`）、`status`（`draft` \| `active` \| `archived`）。上傳後 `document_versions.index_status` 會經 `upload_pending → preprocessing → smoke_pending → indexed` 流程。

### 建議 slug 命名（dev 用）

| 文件                   | 建議 `slug`             |
| ---------------------- | ----------------------- |
| 人事管理規章.md        | `hr-rules-v1`           |
| 採購流程操作手冊.md    | `procurement-manual-v1` |
| 採購流程操作手冊-v2.md | `procurement-manual-v2` |
| 系統操作常見問題.txt   | `faq-system-ops-v1`     |

---

## MCP Token（本機 / staging）

| Token 名稱                   | 環境      | Scopes                                                   | 用途                        |
| ---------------------------- | --------- | -------------------------------------------------------- | --------------------------- |
| _待補（本機 dev mint 後補）_ | `local`   | `knowledge.ask,knowledge.search`                         | E2E MCP tool-selection eval |
| _待補（staging mint 後補）_  | `staging` | `knowledge.ask,knowledge.search,knowledge.citation.read` | Eval 連 staging MCP         |

> Mint 方式：`pnpm mint:dev-mcp-token`（local）或 staging Admin UI → `/admin/tokens`。Token 值 NEVER 寫入本檔。

---

## 環境連線

| 環境       | Worker URL                                | D1 Database                                                            | Vectorize Index           |
| ---------- | ----------------------------------------- | ---------------------------------------------------------------------- | ------------------------- |
| Production | `https://agentic.yudefine.com.tw`         | `agentic-rag-db`（ID: `3036df7f-d54b-4d36-a33d-ecbb551fc278`）         | `agentic-rag`             |
| Staging    | `https://agentic-staging.yudefine.com.tw` | `agentic-rag-db-staging`（ID: `d64077d7-b1c7-43f9-8dca-a1a1ff8c8350`） | `agentic-rag-staging`     |
| Local      | `http://localhost:3010`                   | `.wrangler/state/` D1（wrangler dev 自動建立）                         | N/A（本機不跑 Vectorize） |

Cloudflare Account ID：`0eac599c12df10586d97a78179b9f11f`（非 secret，來自 `wrangler.jsonc`）

---

## 常用指令

```bash
# 本機 dev（Nuxt + wrangler dev）
pnpm dev

# D1：執行 migration（local）
pnpm wrangler d1 migrations apply agentic-rag-db --local

# D1：執行 migration（staging）
pnpm wrangler d1 migrations apply agentic-rag-db-staging --env staging

# D1：查詢 user table（local dev）
pnpm wrangler d1 execute agentic-rag-db --local --command "SELECT id, email, role FROM user LIMIT 10"

# R2：列出已上傳文件（staging）
pnpm wrangler r2 object list agentic-rag-documents-staging

# Mint MCP token（local）
pnpm mint:dev-mcp-token
```

---

## 回饋迴路（給 Claude）

manual-review / verify item 裡引用 sample 時的標準流程：

1. **Read 本檔**，找對應 section 的具體 ID / email / slug。
2. **確認 D1 / R2 實際存在**：跑對應 wrangler 指令或 `/admin` UI 確認 row / object 存在；若不存在先建立。
3. **補齊本檔**：建立後回來把 `_待補_` 欄位填上實際值，保持本檔與實際環境同步。
4. **Cross-link**：在 manual-review item inline 引用時，標明「見 `docs/FIXTURES.md` §XXX」。

---

## 相關規則

- `clade/rules/core/fixtures-reference.md` — 本檔格式規約與 propagate 警告條件
- `.claude/rules/local/` — consumer 自家 rules（若有 fixtures 相關限制）
- `server/database/migrations/` — D1 schema 定義（0001–0017）
- `docs/sample-documents/README.md` — 樣本文件用途說明
- `docs/manual-review-checklist.md` — manual-review item 格式規約
