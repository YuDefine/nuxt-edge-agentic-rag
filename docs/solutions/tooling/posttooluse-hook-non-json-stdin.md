---
title: PostToolUse hook 在非 JSON stdin 下回傳 code 5
date: 2026-04-23
category: tooling
tags:
  - codex-hook
  - jq
  - bash
  - set-euo-pipefail
---

## Problem

`PostToolUse hook (failed)` 偶發顯示 `error: hook exited with code 5`，即使真正失敗的不是業務邏輯，而是提醒型 hook 本身。

這次出現在 `.codex/hooks/post-bash-error-debug.sh`：

- hook 透過 stdin 讀取 payload
- 腳本啟用了 `set -euo pipefail`
- 腳本直接用 `jq` 解析 `.tool_input.command` 與 `.tool_response.exit_code`
- 依官方 Codex hooks 文件，`PostToolUse.tool_response` 今天通常是 JSON 字串，不是保證物件

當 stdin 不是合法 JSON 時，`jq` 會直接失敗，整個 hook 也跟著非零退出，最後由 wrapper 把錯誤往外拋。

## What Didn't Work

- 先把問題歸咎於 `Stop` hook；`Stop` hook 只是提醒，與 `code 5` 無關
- 只做 shell syntax check；`zsh -n` 通過不代表 runtime payload 安全
- 只測合法 JSON payload；這會漏掉真正會讓 hook 崩潰的非 JSON / 空輸入情境

## Solution

把提醒 hook 視為 best-effort，不可因為 payload 不完整就中止整個工具流程。

`.codex/hooks/post-bash-error-debug.sh` 改為：

- 先完整讀入 `INPUT=$(cat)`
- 解析時改用 `printf '%s' "$INPUT" | jq ... || printf ''`
- `EXIT_CODE` 同時支援 `tool_response` 為物件或 JSON 字串
- `EXIT_CODE` 解析失敗時 fallback 為 `'0'`

這樣即使 stdin 不是 JSON，hook 也會安全略過，而不是向外回傳 `code 5`。

## Prevention

- 凡是提醒型、通知型 hook，都必須保證「自己失敗也不影響主流程」
- 任何從 hook stdin 讀 JSON 的 `jq` 呼叫，都要加 fallback，不能直接依賴 `set -euo pipefail`
- 驗證 hook 時至少覆蓋三種 payload：合法 JSON、非 JSON、空 stdin
- `Stop` hook 若目的是讓 Codex 自己續跑收尾，應回 `decision: "block"` + `reason`；不要回 `systemMessage`，因為那會被顯示成 warning，而不是隱藏 continuation prompt
