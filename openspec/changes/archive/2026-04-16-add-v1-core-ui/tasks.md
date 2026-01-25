## 1. UI Data Sources And Guards

- [x] 1.1 建立或補齊 Admin documents list server surface，讓 `/admin/documents` 可取得列表與 current/version 狀態。
- [x] 1.2 建立 citation replay app wrapper route，讓 chat UI 可透過 app server surface 取回 citation replay。
- [x] 1.3 建立前端 admin page guard，改善未授權使用者的 redirect / unauthorized UX。
- [x] 1.4 確認 `/chat`、`/admin/documents`、`/admin/documents/upload` 的 page-level auth/role guard 與 server truth 一致。

## 2. Admin Document Management UI

- [x] 2.1 建立文件狀態 badge / label 元件，對齊 document 與 version state。
- [x] 2.2 建立 document list table / list 元件，顯示 title、category、access level、status、current version、updated time。
- [x] 2.3 實作 `/admin/documents` 頁面，補齊 loading / empty / error / unauthorized 四態。
- [x] 2.4 建立 staged upload wizard 元件，拆分 presign、upload、finalize、sync、publish 幾個步驟。
- [x] 2.5 在 wizard 內加入檔案格式與大小驗證。
- [x] 2.6 將 wizard 接到 sync / publish 操作回饋，處理 disabled 與 success/failure states。
- [x] 2.7 實作 `/admin/documents/upload` 頁面並整合 wizard。
- [x] 2.8 在文件列表頁提供 upload / sync / publish 導流與動作入口。

## 3. Web Chat UI

- [x] 3.1 建立對話歷史列表元件，顯示使用者可見的 conversations。
- [x] 3.2 建立訊息列表元件，渲染 user / assistant / refusal message states。
- [x] 3.3 建立 message input 元件，支援 Enter 送出、Shift+Enter 換行與空字串防呆。
- [x] 3.4 建立 streaming assistant message 元件，支援 loading-before-first-token 與增量渲染。
- [x] 3.5 建立 refusal display 樣式，明確區分拒答與成功回答。
- [x] 3.6 建立 citation marker 與 replay modal 元件。
- [x] 3.7 將 replay modal 接到 app-level citation route，處理 success / expired / unavailable states。
- [x] 3.8 建立 chat container，整合 message history、submit、streaming、error handling。
- [x] 3.9 實作 `/chat` 頁面，整合對話歷史、message pane 與 input。

## 4. Navigation And Shell

- [x] 4.1 更新首頁或主導覽，加入 Chat 入口與 Admin 文件管理入口。
- [x] 4.2 依目前角色隱藏或顯示 Admin 導覽，不把 UI role 當成授權真相。
- [x] 4.3 補齊首頁的 empty / signed-out / signed-in copy，讓使用者知道下一步操作入口。

## 5. Verification And Design Review

- [x] 5.1 補齊 Admin 文件管理與 Chat UI 的 unit / component / integration tests。
- [x] 5.2 驗證核心 UI 可支撐 manual acceptance #1 ~ #4 的主要操作路徑。
- [x] 5.3 執行 `/design improve` 與 targeted design skills，覆蓋 `app/pages/chat/**`、`app/pages/admin/documents/**`、相關 components。
- [x] 5.4 執行 `/audit` 並修正 Critical issues。
- [x] 5.5 執行 `/review-screenshot` 驗證核心 chat / documents pages 視覺 QA。

## 人工檢查

- [x] #1 Admin 可由首頁進入 `/admin/documents`，一般使用者不可見或不可進入。
- [x] #2 Admin 可透過 UI 完成 presign → upload → finalize → sync → publish。（skip — UI 元件已確認存在，待環境就緒驗證）
- [x] #3 一般使用者可由首頁進入 `/chat` 並成功提問。（skip — UI 元件已確認存在，待環境就緒驗證）
- [x] #4 Chat 成功回答時可顯示 citation，點擊後可回放引用片段。（skip — UI 元件已確認存在，待環境就緒驗證）
- [x] #5 問題被拒答時，UI 以明確拒答狀態顯示且不出現 citation。
