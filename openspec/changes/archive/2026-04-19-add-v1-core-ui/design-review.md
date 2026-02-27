# Design Review: add-v1-core-ui

**Date**: 2026-04-16
**Scope**: app/pages/**, app/components/**

## Design Fidelity Report

| 檢查項目       | 狀態 | 說明                                      |
| -------------- | ---- | ----------------------------------------- |
| 語意色彩類別   | OK   | 所有 text-_/bg-_ 使用語意類別             |
| `dark:` prefix | OK   | 無違規                                    |
| Nuxt UI 元件   | OK   | 正確使用 UButton, UCard, UTable 等        |
| 間距系統       | OK   | 遵循 Tailwind 4 預設                      |
| 字體層級       | OK   | 符合 .impeccable.md 規範                  |
| 圓角           | OK   | 統一使用 `rounded-lg`                     |
| 空狀態         | OK   | DocumentListEmpty, MessageList 空狀態完整 |
| 錯誤狀態       | OK   | 使用 UAlert 顯示錯誤                      |

**Fidelity Score: 8/8**

## 修復記錄

| 檔案                          | 修復前                                 | 修復後                          |
| ----------------------------- | -------------------------------------- | ------------------------------- |
| `CitationReplayModal.vue:127` | `bg-neutral-50 dark:bg-neutral-900`    | `bg-muted`                      |
| `CitationReplayModal.vue:142` | `border-neutral-200 bg-white dark:...` | `border-default bg-elevated`    |
| `CitationMarker.vue:20`       | `bg-primary-100 dark:bg-primary-900`   | `bg-accented border-default`    |
| `UploadWizard.vue:277-281`    | 硬編碼 primary/success/error 背景      | 語意類別 `bg-accented/bg-muted` |
| `UploadWizard.vue:300`        | `border-neutral-300 dark:...`          | `border-muted`                  |
| `UploadWizard.vue:364,383`    | `bg-success-100 dark:...`              | `bg-muted`                      |

## 診斷摘要

### Quick Assessment (修復後)

| 維度          | 評分  |
| ------------- | ----- |
| Visual        | ★★★★★ |
| Interaction   | ★★★★☆ |
| Structure     | ★★★★★ |
| Copy          | ★★★★★ |
| Resilience    | ★★★★☆ |
| Performance   | ★★★★★ |
| Accessibility | ★★★★☆ |
| Consistency   | ★★★★★ |

### 執行的 Skills

1. `/polish` — 修復 10 處 design system 違規
2. `/harden` — 略過（狀態處理已完整）
3. `/polish` — 待執行
