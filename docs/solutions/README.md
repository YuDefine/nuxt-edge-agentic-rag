# Solutions

用來記錄非 trivial 問題的可重用解法，避免同類問題重複踩坑。

## 什麼情況要記

- Debug 過程嘗試了 3+ 種方法才找到 root cause
- 發現框架、平台或套件的隱性限制
- Root cause 非 typo，解法不直覺
- 解法涉及 workaround

## 目錄

- `tooling/`: hook、CLI、CI、開發流程、建置工具
- 其他分類依問題領域新增，但避免過度細分

## 格式

每篇文檔使用 YAML frontmatter，並至少包含以下段落：

```md
---
title: 簡短標題
date: YYYY-MM-DD
category: tooling
tags:
  - tag-a
  - tag-b
---

## Problem

問題現象、觸發條件、影響範圍。

## What Didn't Work

- 已嘗試但不能解決 root cause 的方法

## Solution

實際 root cause 與修復方式。

## Prevention

- 下次如何更快辨識或避免再發
```

## 維護規則

- 先搜尋是否已有相似記錄；有則更新，無則新建
- 聚焦 root cause、失敗嘗試與可重用解法，不寫流水帳
- 若同一 pattern 重複出現，考慮升級為 `.claude/rules/` 規則，並同步到 `AGENTS.md` / `CLAUDE.md` 可到達的 instruction surface
