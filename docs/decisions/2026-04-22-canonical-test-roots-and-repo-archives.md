# Canonical Test Roots and Repo Archives

## Decision

維持雙 canonical 測試根目錄：Vitest 使用 `test/`，Playwright 使用 `e2e/`；`tests/` 視為 deprecated legacy 路徑，不再新增正式檔案。與提交無直接關聯的歷史報告與一次性備份，改收納到專屬 archive 目錄，而不是散落根目錄。

## Context

2026-04-22 結構整理時觀察到三種漂移同時存在：

- 執行器設定已明確分流：`vitest.config.ts` / `vitest.vscode.config.ts` 讀 `test/`，`playwright.config.ts` 讀 `e2e/`
- 規則與 agent 說明卻仍引用 `tests/e2e/`，導致 screenshot review 類工作容易在 legacy 路徑長出殘留檔案
- 根目錄保留多份歷史報告 `main-v0.0.49.md` ~ `main-v0.0.51.md` 與一次性資料庫備份 `backup-pre-0010-20260421.sql`，降低 repo 作為正式提交成果的整潔度

其中 `tests/e2e/screenshots/passkey-auth-review.spec.ts` 就是典型例子：它不是 canonical Playwright 路徑的一部分，內容也屬於 ad hoc screenshot 腳本，不應繼續暗示 `tests/` 是正式入口。

## Alternatives Considered

- **方案 A：全面收斂到 `tests/` 單一根目錄**
  - 優：命名表面上最一致
  - 缺：要同步改 Playwright、Vitest、VS Code、scripts、文件與既有習慣，風險高，收益主要只是字面整齊

- **方案 B：維持現況，只補文件說明**
  - 優：改動最少
  - 缺：漂移仍存在，legacy 路徑與根目錄殘留會繼續累積

- **方案 C：保留 `test/` + `e2e/` 雙 canonical roots，淘汰 `tests/`，並把歷史/備份檔收納到專屬 archive 目錄**（採用）
  - 優：符合現有執行器設定，改動集中、風險低，可立即改善 formal submission 整潔度
  - 缺：字面上仍是雙根；需要額外 guard 防止 `tests/` 回流

## Reasoning

這個 repo 的問題不是「一定要單一測試根目錄」，而是「真實執行路徑與文件/規則說法不一致」。既然執行器早已穩定分流，最務實的做法是承認這個現況，把 `test/` 與 `e2e/` 正式化，然後把 `tests/` 降級成 legacy path。這比大規模 rename 更符合成本效益。

同理，根目錄不應同時承擔「目前版本入口」「歷史版本堆疊」「一次性作業備份」三種責任。正式提交 repo 可以保留當前主報告，但不該讓已無引用的歷史版本與作業備份繼續散落在第一層。

## Trade-offs Accepted

- 新增 guard 後，未來若再把正式檔案放進 `tests/`，本地檢查會直接失敗
- current report 已收斂到 `reports/latest.md`，歷史版本位於 `reports/archive/`；後續升版不再需要讓 repo root 承擔報告入口
- 一次性 screenshot 腳本若仍需保留，可放到 `tmp/` 等非 canonical 區域，而不是回到 `tests/`

## Supersedes

無。這是首次把測試根目錄與 repo archive 收納策略正式記錄成決策。
