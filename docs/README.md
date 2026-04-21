# docs README

這個資料夾現在同時扮演兩個角色：

- 給 repo 直接瀏覽的人看的文件入口。
- 給 VitePress 文件站渲染的內容來源。

如果你是第一次接手這個專案，建議不要直接從檔名海開始掃，先照下面的順序進入。

## 建議閱讀順序

### 1. 先建立地圖

- [STRUCTURE](./STRUCTURE.md)
- [index](./index.md)

### 2. 再看你現在要做什麼

- 要部署或處理事故：進 [verify/README](./verify/README.md)
- 要查維運短手冊：進 [runbooks/index](./runbooks/index.md)
- 要理解既有決策：進 [decisions/index](./decisions/index.md)
- 要查規則與 spec 入口：看 [rules/index](./rules/index.md) 與 [specs/index](./specs/index.md)

### 3. 最後再鑽進單一文件

- verify 內是可操作或可驗證的手冊。
- 根目錄的 design tokens、manual review、tech debt 比較偏專案治理與長期維護。

## 這個資料夾目前的結構

- `verify/`：部署、驗證、QA、保留策略等操作型文件。
- `runbooks/`：較短、單一主題的操作手冊。
- `decisions/`：已記錄的技術決策。
- `sample-documents/`：知識庫樣本文檔。
- `rules/`、`specs/`：文件站入口頁，對應 repo 內真正維護的規則與 spectra 規格來源。

## 維護原則

- 先改善導覽，再做大規模檔名搬動。
- verify 檔名目前保留，是因為 repo 內仍有大量明確路徑引用。
- 如果未來要 rename，應先批次更新 openspec、報告、workflow 與程式碼中的引用。
