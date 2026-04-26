---
title: Cloudflare Pages deploy API 拒絕合法 UTF-8 commit message（code 8000111）
date: 2026-04-25
category: tooling
tags:
  - cloudflare-pages
  - wrangler
  - github-actions
  - deploy
---

## Problem

`wrangler pages deploy docs/.vitepress/dist ...` 在 GitHub Actions 裡跑，上傳檔案全部成功後，呼叫 `/accounts/.../pages/projects/.../deployments` 時 Cloudflare API 回：

```
✘ [ERROR] A request to the Cloudflare API failed.
  Invalid commit message, it must be a valid UTF-8 string. [code: 8000111]
```

Process exit 1，`deploy-docs-*` job 失敗。app worker deploy 不受影響（走 `wrangler deploy`，不經 Pages API）。

### 關鍵怪事：兩個都是合法 UTF-8 卻不同結果

同一個 repo、同一版 wrangler（4.84.1）、同一條 workflow：

| Commit    | Type                       | Subject                                                                     | Result     |
| --------- | -------------------------- | --------------------------------------------------------------------------- | ---------- |
| `5a47a63` | v0.43.0 annotated tag push | `🚀 deploy: 發布新版本 v0.43.0`                                             | ❌ 8000111 |
| `a0e2426` | main push（更新 HANDOFF）  | `📝 docs: 更新 HANDOFF 反映 v0.43.0 release 與 deploy-docs-staging blocker` | ✅         |

兩個 commit message 經 `git log -1 --format='%s%n%b' <sha> | xxd` 檢驗，**全部 bytes 都是合法 UTF-8**（只有 1/2/3/4 byte sequence，沒有 invalid continuation、沒有 BOM、沒有 overlong encoding）。兩邊都含 emoji + 繁中 + 全形標點 + 美式引號。

## What Didn't Work

- **Rerun job（兩次）** — 相同 commit message 會穩定失敗，非 transient。
- **懷疑是 wrangler 4.84.1 / CF API contract 漂移** — 但 `a0e2426` 同版 wrangler 通過，推翻此假設。
- **懷疑是 runner locale / encoding** — GitHub Actions 預設 `LANG=C.UTF-8`，stdin/stdout 都走 UTF-8；且兩個 commit 都在同一 workflow 跑，條件一致。

## Solution

### Workaround（採用）

在 `.github/workflows/deploy.yml` 的兩個 `deploy-docs-*` step 顯式傳 sanitized `--commit-message`：

```yaml
# 下列 <SHA> 為 GitHub Actions context expression `github.sha`（實際 yaml
# 寫法為 dollar 符 + 雙大括號包 github.sha；此處改用占位符避免 docs site
# Vue SSR 把字面 mustache 誤判為模板表達式）。實際 expression 以
# `.github/workflows/deploy.yml` 為準。
- name: Deploy docs to Cloudflare Pages (production)
  run: pnpm exec wrangler pages deploy docs/.vitepress/dist
    --project-name "$DOCS_CF_PAGES_PROJECT_NAME"
    --branch "$DOCS_CF_PAGES_PRODUCTION_BRANCH"
    --commit-hash "<SHA>"
    --commit-message "Deploy <SHA>"
```

- `--commit-message "Deploy <sha>"` 純 ASCII，避開 CF validator
- `--commit-hash "<github.sha>"` 保留 SHA 給 CF dashboard 與 CF 自己的 Git 連動
- Trade-off：Pages dashboard 的 deployment 只看到 `Deploy <sha>` 而不是原 commit message。要追 message 仍可從 SHA 回 GitHub 查。

### Root cause

**未解**。Cloudflare 的錯誤訊息本身不精確：兩個 bytes 都合法 UTF-8，但一個通過、一個不通過。最可能的解釋是 CF Pages API 有**未文件化的 validator**，針對某種字元組合或特定 byte pattern 拒絕（不是真的 UTF-8 檢查）。無進一步 log 可查。

## Prevention

### 辨識信號

- `deploy-docs-*` 失敗、看到 `[code: 8000111]` → 直接認定是 TD-049，走 workaround，不要再 rerun。
- `deploy-production`（app worker）失敗與此無關，app 走另一條 API。

### 避免再發

- 所有 `wrangler pages deploy` 呼叫**一律顯式傳 `--commit-message`** 用 ASCII 內容（此 repo 已這麼做；套用到其他 repo 時同樣處理）。
- 不要假設「合法 UTF-8」就能通過 CF API validator — CF 的錯誤訊息與實際檢查邏輯不一致時有發生。

### 若想追根因（未來）

- 保留 `5a47a63` 完整 body bytes（已在 TD-049 下）
- 二分搜尋：把 commit message 切半上傳，看哪一半觸發
- 有最小 repro 後開 issue 至 [`cloudflare/workers-sdk`](https://github.com/cloudflare/workers-sdk/issues)
