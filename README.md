# 雲科大 AI 專班專題報告工具

國立雲林科技大學資管系人工智慧技優專班 114 學年實務專題。

專題主題：**企業知識庫 Agentic RAG 系統**

## 安裝

```bash
pip install -r tooling/requirements.txt
```

雲科大 thesis workflow **不需要 `pandoc`**。日常升版以精準同步或 XML / Word 精修為主；repo 內保留的全文重建 / 章節重排腳本僅供歷史追查與實驗，不作為正式 thesis 產線。

## 目前工作區配置

本專案目前以 `reports/` 作為報告工作區：`reports/latest.md` 是 current draft 本體，`reports/archive/` 保存版本化快照，`reports/notes/` 保存工作筆記。

```text
reports/
├── latest.md
├── notes/
│   └── diagram.md
└── archive/
  ├── main-v0.0.1.docx
  ├── main-v0.0.10.md
  ├── main-v0.0.11.docx
  ├── main-v0.0.11.md
  ├── main-v0.0.11_assets/
  └── main-v0.0.50.md
```

目前規則如下：

1. 新版一律建立新檔案，不可覆寫舊版。
2. Markdown、DOCX 與 `_assets/` 以相同版本號對應。
3. 工作筆記放在 `reports/notes/`。
4. 最終交付檔放在 `deliverables/report/`，不要把交付檔回寫到工作區。

## 快速開始

### 讀取某一版報告內容

```bash
VERSION_DIR="reports/archive"

python tooling/scripts/extract_docx_to_md.py \
  "$VERSION_DIR/main-v0.0.11.docx" \
  -o "$VERSION_DIR"

# 產出：
#   reports/archive/main-v0.0.11.md
#   reports/archive/main-v0.0.11_assets/
```

### 安全更新報告並建立下一版

```bash
VERSION_DIR="reports/archive"
CURRENT_DOCX="$VERSION_DIR/main-v0.0.37.docx"
TARGET_MD="reports/latest.md"
OUTPUT_DOCX="deliverables/report/main-vNEXT.docx"

# 1. 先抽出目前 DOCX，確認 CURRENT_DOCX 與 TARGET_MD 是否同一條內容線
python tooling/scripts/extract_docx_to_md.py \
  "$CURRENT_DOCX" \
  -o /tmp/docx-check

# 2. 先做 dry-run；只要出現任何 MISSING_HEADING / MISSING_PARA，就停止自動同步
python tooling/scripts/sync_docx_content.py \
  "$CURRENT_DOCX" \
  "$TARGET_MD" \
  /tmp/docx-preview.docx \
  --dry-run

# 3. 僅在結構完全一致時，才可正式同步到新版本 DOCX
python tooling/scripts/sync_docx_content.py \
  "$CURRENT_DOCX" \
  "$TARGET_MD" \
  "$OUTPUT_DOCX"
```

如果 `--dry-run` 出現任何 `MISSING_HEADING` 或 `MISSING_PARA`，表示這次更新已經不是安全的小幅同步，**不得**再用自動重建方式產生 thesis DOCX。

即使 `--dry-run` 沒出現 `MISSING_*`，也只代表它找到可覆寫的既有段落序列，不代表段落語意已完全對齊；正式同步前仍應先人工比對抽出的 Markdown 與目標章節順序。

### 大幅改動時的安全流程（XML / Word）

```bash
VERSION_DIR="reports/archive"
CURRENT_DOCX="$VERSION_DIR/main-v0.0.37.docx"
TARGET_MD="reports/latest.md"
OUTPUT_DOCX="deliverables/report/main-vNEXT.docx"

# 1. 複製 DOCX 作為編輯基底
cp "$CURRENT_DOCX" "$OUTPUT_DOCX"

# 2. 解壓縮成可編輯 XML
python tooling/scripts/office/unpack.py \
  "$OUTPUT_DOCX" \
  /tmp/docx-edit

# 3. 直接修改 /tmp/docx-edit/word/document.xml
#    或改用 Word 手動編修 OUTPUT_DOCX

# 4. 重新打包
python tooling/scripts/office/pack.py \
  /tmp/docx-edit \
  "$OUTPUT_DOCX" \
  --original "$CURRENT_DOCX"

# 5. 重新抽出驗證
python tooling/scripts/extract_docx_to_md.py \
  "$OUTPUT_DOCX" \
  -o /tmp/docx-verify
```

這條路徑的核心原則是：**複製現有 DOCX 再精修，不從 Markdown 全文重建 DOCX。**

## 版本管理規則

1. `reports/latest.md` 是目前持續編輯中的 current draft。
2. `reports/archive/` 底下採 `main-v0.0.{N}.*` 命名保存歷史版本。
3. 若要編輯新版本，先明確綁定 `CURRENT_DOCX`、`TARGET_MD`、`OUTPUT_DOCX`。
4. `sync_docx_content.py --dry-run` 只要出現任何 `MISSING_HEADING` 或 `MISSING_PARA`，就必須改走 XML / Word 精修。
5. 舊版檔案保留唯讀，不直接覆寫。
6. `_assets/` 目錄需與 Markdown 版本號一致。

## 未來可選整理方向

若之後想改成「每版一個資料夾」也可以，但目前 repo 與 `.claude`、`.agents` 規則皆以「優先遵循 repo 現況」為原則，因此日常工作流程請以平鋪版號檔名為準。

## 專案結構

```text
.
├── README.md
├── deliverables/
│   ├── defense/                    # 答辯與審查資料
│   └── report/                     # 最終報告交付物
├── references/
│   └── yuntech/                    # 學校規範 PDF
├── templates/
│   └── 海報樣板.pptx
├── tooling/
│   ├── requirements.txt            # Python 相依性
│   ├── scripts/                    # Python 工具
│   └── tests/                      # 測試
├── reports/
│   ├── latest.md                   # current draft 本體
│   ├── notes/                      # 工作筆記與待辦事項
│   └── archive/                    # 版本化快照（md/docx/assets）
```

## 工具說明

| 腳本                                      | 用途                                                       |
| ----------------------------------------- | ---------------------------------------------------------- |
| `tooling/scripts/extract_docx_to_md.py`   | DOCX 轉 Markdown，並提取圖片到指定輸出目錄                 |
| `tooling/scripts/sync_docx_content.py`    | 結構完全一致時，僅替換既有段落文字                         |
| `tooling/scripts/legacy/transform_v36.py` | 舊版 v36 XML 轉換腳本，保留供歷史追查                      |
| `tooling/scripts/office/unpack.py`        | 將 DOCX 解壓縮成 XML 目錄，供 `/docx-surgery` 或手動精修   |
| `tooling/scripts/office/pack.py`          | 將 XML 目錄重新打包為 DOCX，可沿用原始 ZIP 順序與 metadata |

## 實驗性重建腳本

repo 目前仍保留部分 thesis 用的全文重建 / 章節操作腳本，主要供歷史追查、比對與實驗使用；正式升版流程仍以複製既有 DOCX，再用 `tooling/scripts/office/unpack.py`、`tooling/scripts/office/pack.py`、`/docx-surgery` 或 Word 手動精修為準。

## Claude Code Skills

本專案整合 Claude Code，提供以下 Skills：

另外也同步提供 `.agents/` 鏡像結構，方便相容的 agent 工具直接重用同一套 `skills/` 與 `rules/`。

- `/yuntech-thesis`：專題報告處理（讀取、檢核、更新）
- `/docx`：通用 DOCX 操作
- `/docx-surgery`：進階 XML 操作（追蹤修訂、批註）

## 規範參考

### `references/yuntech/` 目錄

| 檔案                                              | 內容                       |
| ------------------------------------------------- | -------------------------- |
| `人工智慧實務專題書面成果報告內容規範1141216.pdf` | 必備內容、章節結構         |
| `專題報告編排規範1141216.pdf`                     | 字體、邊距、頁碼、圖表編號 |

### 格式重點

- 字體：標楷體／細明體 14pt，英文 Times New Roman
- 邊距：左 3cm、其他 2.5cm
- 頁碼：篇前羅馬數字（i, ii），正文阿拉伯數字（1, 2）
- 章節：每章的節次從「第一節」重新編號

## 報告章節結構

```text
第一章 開發計畫
    第一節 發展的動機
    第二節 專題目的
    第三節 專題需求
    第四節 預期效益

第二章 分析與設計
    第一節 分析
    第二節 設計
    第三節 開發時程

第三章 實作成果
    第一節 系統作業環境
    第二節 系統功能與介面說明

第四章 結論
    第一節 目標與特色
    第二節 未來展望

第五章 專題心得與檢討

第六章 參考文獻

附錄
```

## License

Private - 雲科大資管系 AI 專班專題使用
