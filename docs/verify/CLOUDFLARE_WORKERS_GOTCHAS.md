# Cloudflare Workers 注意事項

## Request Body Stream

Workers 的 request body 是 ReadableStream，只能讀取一次。

**問題**：如果 middleware 讀取了 body，後續 handler 會收到空 body。

**解法**：

- 在 middleware 中使用 `readBody()` 會快取結果，後續 `readBody()` 會回傳快取
- 如果直接操作 `event.node.req`，需要自行處理

## Node.js API 限制

Workers 不支援所有 Node.js API。常見限制：

| API             | 狀態                  | 替代方案               |
| --------------- | --------------------- | ---------------------- |
| `fs`            | ❌ 不可用             | 使用 KV/R2 Storage     |
| `child_process` | ❌ 不可用             | 使用 Service Bindings  |
| `crypto`        | ✅ 透過 `node:crypto` | 需啟用 `nodejs_compat` |
| `Buffer`        | ✅ 透過 `node:buffer` | 需啟用 `nodejs_compat` |

在 `wrangler.jsonc` 中啟用：

```jsonc
{
  "compatibility_flags": ["nodejs_compat"],
}
```

## 環境變數

Workers 的環境變數在 runtime 透過 `process.env` 讀取（Nitro 已處理）。

**注意**：`NUXT_PUBLIC_*` 變數在 **build time** 注入到 client bundle，不是 runtime。
確保 CI/CD build 時有傳入所有 `NUXT_PUBLIC_*` 變數。

## Bundle Size

Workers 有 10MB 的 bundle 大小限制（壓縮後）。

監控方式：

```bash
wrangler deploy --dry-run --outdir dist
ls -lh dist/
```

## 資料連線

Workers 無法使用 TCP 長連線。

如果需要連接只提供 TCP driver 的資料來源（例如直接 Postgres 連線）：

- 優先考慮 Cloudflare Hyperdrive
- 或改走 HTTP 型 API / server-side proxy

## 本地開發與 Cloudflare Bindings

**重要**：`pnpm dev` 使用 Nuxt 內建的 dev server，**不會**載入 Cloudflare bindings（D1、KV、R2、AI 等）。

### NuxtHub 本地模擬

NuxtHub 會在本地模擬部分 bindings：

| Binding | 本地模擬                    | 備註                         |
| ------- | --------------------------- | ---------------------------- |
| D1      | ✅ SQLite (`.data/hub/d1/`) | 自動模擬                     |
| KV      | ✅ fs-lite (`.data/kv/`)    | 需在 nuxt.config.ts 配置     |
| R2/Blob | ✅ fs (`.data/hub/blob/`)   | 自動模擬                     |
| AI      | ❌ 不可用                   | 需要 Cloudflare Workers 環境 |
| Cache   | ✅ memory                   | 自動模擬                     |

### 使用真正的 Cloudflare Bindings

如果需要在本地使用真正的 Cloudflare bindings（例如 AI），必須用 wrangler 運行：

```bash
# 方法 1：wrangler pages dev（推薦）
pnpm build
npx wrangler pages dev .output/public --compatibility-date=2025-05-15

# 方法 2：wrangler dev
pnpm build
npx wrangler dev
```

**注意事項**：

- 需要先 `pnpm build`，wrangler 運行的是 build 產物
- 會連接到 `wrangler.jsonc` 中配置的真實 Cloudflare 資源
- 本地 D1 資料與生產環境分開（除非用 `--remote`）

### AI Binding 配置

確保 `wrangler.jsonc` 有 AI binding：

```jsonc
{
  "ai": {
    "binding": "AI",
  },
}
```

### 常見錯誤

**錯誤**：`Cloudflare AI binding "AI" is not available`

**原因**：用 `pnpm dev` 運行，沒有 Cloudflare Workers 環境

**解法**：改用 `pnpm build && npx wrangler pages dev .output/public`
