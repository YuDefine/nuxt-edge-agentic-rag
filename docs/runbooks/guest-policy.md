# Guest Policy Runbook

`guest_policy` 是 B16 引入的訪客權限 dial，值為 `{ same_as_member | browse_only | no_access }`。本 runbook 說明如何安全地修改此設定，以及**為何不能**繞過 API 直接改 DB。

參考：`docs/tech-debt.md` TD-002、`server/utils/guest-policy.ts`。

## 變更 guest_policy 的**唯一**合法路徑

```text
PATCH /api/admin/settings/guest-policy
Authorization: Admin session (Better Auth)
Body: { "value": "same_as_member" | "browse_only" | "no_access" }
```

對應 UI：`/admin/settings/guest-policy`（admin-only page，radio-group 單選）。

呼叫後效果：

1. 寫 D1 `system_settings('guest_policy').value`
2. 清掉當前 Worker instance 的 module-level cache
3. Bump KV `guest_policy:version` stamp（Date.now() string）

其他 Worker instance 下次 request `getGuestPolicy()` 讀 KV version → 與 local cache 版號 mismatch → 重讀 D1 → 更新 local cache + version。跨 Worker propagation 在**下一個 request** 生效，無需 redeploy 或強制 eviction。

## **禁止**：繞過 API 直接改 DB

### 場景

Admin 在緊急 rollback 情境想快速改值，可能誘惑用：

```bash
# ❌ 禁止
wrangler d1 execute DB --remote --command \
  "UPDATE system_settings SET value='no_access' WHERE key='guest_policy';"
```

或從 Cloudflare D1 console 直接改 row。

### 為什麼不行

- 直接 UPDATE 只改 D1 row，**不會 bump KV `guest_policy:version`**
- 每個 Worker instance 下次 request 讀 KV version → 與 local cache mismatch → 重讀 D1 的前提不成立（version 沒變 → 繼續回 cached 舊值）
- 冷啟動 instance 讀到新值 → 熱 instance 繼續回舊值
- 結果：**部分 request 回舊 policy，部分回新 policy**（實測：5 個 parallel request 2 個舊 / 3 個新）
- 使用者觀察到「改了 DB 但 Worker 還回舊值」的困惑

### 若已誤操作，如何復原

1. **重新呼叫 API** 將正確值寫回：

   ```
   PATCH /api/admin/settings/guest-policy
   Body: { "value": "<正確值>" }
   ```

   API 會同時寫 D1 + bump KV version，跨 Worker 恢復同步。

2. **確認同步**：

   ```bash
   # 讀當前 D1 value
   wrangler d1 execute DB --remote --command \
     "SELECT value, updated_at FROM system_settings WHERE key='guest_policy';"

   # 讀當前 KV version（從 Cloudflare dashboard 的 KV namespace）
   # key: guest_policy:version
   # 應為一個 Date.now() 毫秒字串，比 D1 updated_at 新
   ```

3. **測試 propagation**：連續打 5 個 chat / MCP request（到不同 region 更好），確認 policy enforcement 一致。

## 為什麼是這個設計

`guest_policy` 讀頻極高 —— 每次 Web chat + 每次 MCP askKnowledge 都 hit。原設計刻意讓 hot path 只讀 KV version（~1ms），**不讀 D1**（避免 p99 退化）。

替代設計比較（保留紀錄供未來 revisit）：

| 方案                                      | 讀頻成本         | 運維心智     | 評估                                                |
| ----------------------------------------- | ---------------- | ------------ | --------------------------------------------------- |
| **當前：KV version stamp**                | +1 KV read / hit | runbook 紀律 | p99 好，需要 runbook（此檔）                        |
| 每次 hit 讀 D1 `updated_at` 與 cache 比對 | +1 D1 read / hit | 0 runbook    | p99 退化（見 TD-002 fix approach 選項 B）           |
| IAM 層拿掉 DB-direct 寫權限               | 0 額外 read      | 0 runbook    | 最徹底，但超過 code scope（需 Cloudflare 帳號配置） |

選項 B / C 在 TD-002 fix approach 有完整討論。若未來觀察到 operator 誤操作頻率高，可重啟評估。

## On-boarding checklist

新進 operator **MUST** 閱讀本檔，並在 on-boarding 清單勾選理解下列三項：

- [ ] 知道 `guest_policy` 只能透過 `PATCH /api/admin/settings/guest-policy` 修改
- [ ] 知道繞過 API 直接 UPDATE D1 會造成 cross-Worker cache drift
- [ ] 知道若誤操作該如何復原（重打 API + 確認 propagation）
