# Design Review: passkey-first-link-google-custom-endpoint

- **Date**: 2026-04-23
- **Mode**: improve
- **Spectra Change**: passkey-first-link-google-custom-endpoint
- **Target**: `app/pages/account/settings.vue`

## Diagnosis Summary

| Dimension     | Score | Finding                                                                                                                   |
| ------------- | ----- | ------------------------------------------------------------------------------------------------------------------------- |
| Visual        | 4/4   | 延續既有黑白中性色系與 Nuxt UI 卡片結構，Google link 區塊沒有破壞整頁節奏。                                               |
| Interaction   | 4/4   | success/error feedback 透過頁內 alert 明確，passkey-only 分流正確；loading/disabled 已以實際畫面與 runtime state 補證據。 |
| Structure     | 4/4   | 個人資料 / Passkey / Google Link / Danger Zone 分區清楚，符合帳號設定資訊密度。                                           |
| Copy          | 4/4   | 文案直接、可操作，沒有冗字；錯誤訊息已改為不暴露 email。                                                                  |
| Resilience    | 4/4   | query feedback 清除、loading guard 與鍵盤 walkthrough 證據皆已到位。                                                      |
| Performance   | 4/4   | 僅增加輕量 watch 與 feedback 分流，沒有額外重型 UI 負擔。                                                                 |
| Accessibility | 4/4   | query feedback 改為頁內 alert 後，`@nuxt/a11y` dev report 已無 error；鍵盤 walkthrough 亦正常。                           |
| Consistency   | 4/4   | 色彩、字重、卡片層級與按鈕樣式皆符合既有 design system。                                                                  |

## Design Fidelity Report

Source: `.impeccable.md`

| 維度                 | 狀態 | 證據                                                                                                                                                |
| -------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Color Tokens         | PASS | 使用 `text-default` / `text-muted` / `bg-muted` / `border-default` 與 Nuxt UI `neutral` / `error` / `info` / `success` 語意色，無硬編碼灰階 class。 |
| Typography           | PASS | 標題層級維持 `text-2xl font-bold`、區塊標題 `text-lg font-semibold`、輔助文 `text-sm text-muted`，符合既有層級。                                    |
| Spacing              | PASS | 全頁 `gap-6`、卡片內 `gap-3/4`、空狀態 `py-10/16`，與 design system 的 16/24/32 節奏一致。                                                          |
| Component Usage      | PASS | 全面沿用 Nuxt UI：`UCard`、`UButton`、`UFormField`、`UInput`、`UModal`、`UAlert`。                                                                  |
| Interaction Patterns | PASS | account settings 採 read-only identity + credential actions + danger zone 分區，符合最短路徑原則。                                                  |
| Layout Fidelity      | PASS | 單欄堆疊卡片、桌面與行動皆維持簡潔帳號頁面結構，未引入多餘裝飾。                                                                                    |
| Design Principles    | PASS | 內容優先、資訊層級清楚、無多餘動畫與裝飾，維持內部工具的高信噪比風格。                                                                              |
| Anti-references      | PASS | 無漸層、無玻璃擬態、無彩色主按鈕、無 AI slop hero/card gallery 漂移。                                                                               |

Fidelity Score: 8/8 PASS

### DRIFT 修復記錄

- 無需修復；本次變更未引入 design drift。

## Planned Skills

1. `/audit app/pages/account/settings.vue` — 針對 responsive / a11y / anti-pattern 做技術驗證。
2. `review-screenshot` — 以 local dev 實際截圖確認 xs / md / xl 與 success/error feedback 變體。
3. `/polish app/pages/account/settings.vue` — 針對 loading 可感知性、danger zone contrast 與 query feedback a11y 做收尾。

## Screenshot QA

- **Date**: 2026-04-23
- **Method**: local `pnpm dev` + Playwright headless capture（xs `360x900` / md `768x1024` / xl `1280x960`）
- **States checked**:
  - baseline loaded
  - `?linked=google` success feedback
  - `?linkError=EMAIL_ALREADY_LINKED`
  - `?linkError=EMAIL_NOT_VERIFIED`
  - `?linkError=GOOGLE_ID_TOKEN_INVALID`

### Findings

- `xs / md / xl` baseline：PASS。Google 綁定卡片、說明文與主按鈕皆可見，未見破版。
- `xs / md / xl` error feedback：PASS。頁內 alert 在三個 viewport 皆可見，未遮蔽主要按鈕到無法辨識的程度。
- `xs / md / xl` success feedback：PASS。頁內 alert 可見且未超出畫面。
- loading / disabled：PASS。以 Vue runtime 將 `linkGoogleLoading` 切為 `true` 後，已取得 disabled button + spinner + 「正在導向 Google 驗證頁面…」畫面證據：`/Users/charles/.tmp/settings-loading-RwRknQ/loading-state.png`。
- a11y：PASS。baseline / `?linked=google` / `?linkError=EMAIL_ALREADY_LINKED` 皆未再出現 `@nuxt/a11y` error；鍵盤 walkthrough 已補，焦點可沿 skip link → nav → theme → account menu → add passkey → link google → delete account 前進。

## Design Decisions

- Google link feedback 採頁內 alert + query cleanup，避免 toaster 的 hidden focus guards，同時維持 account settings 的低干擾風格。
- Danger zone 刪除按鈕改回 `neutral outline`，避免白字配 `bg-error` 造成 `color-contrast` warning，同時保留危險區域語意由紅色警示 icon 承擔。
- `EMAIL_ALREADY_LINKED` 改為 generic message，不把衝突 email 顯示在畫面與 URL，兼顧隱私與一致性。
