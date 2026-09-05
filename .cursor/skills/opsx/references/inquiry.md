<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/opsx/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

# 問答、調查與討論

收到 ask、debug、audit、discuss 或等價原請求時，保留唯讀範圍。先確認問題與目標 repo，依 codebase discovery 規約定位程式、規格和既有驗收；需要歷史時才用中立 history 讀原件。

| 模式 | 工作與交付 |
| --- | --- |
| ask | 回答具體問題，附支撐結論的程式或規格位置，區分已知事實與推論。 |
| debug | 以使用者症狀建立可重現條件，讀呼叫路徑與錯誤證據，列出根因、影響和具體修法；沒有修改授權時停在調查結論。 |
| audit | 依任務指定標準逐項比對實作、規格與證據，按嚴重度列 finding、觸發條件、檔案位置和修正方向；沒有 finding 就明說驗證範圍及限制。 |
| discuss | 比較有真實取捨的方案，先查專案可得證據，收斂推薦及決策影響；沒有實作授權時不產生新需求或改檔。 |

調查不啟動 Spectra executable，不改歷史檔、不勾 checkbox，也不以稽核報告當作獨立驗收通過。使用者另有明確修復／實作指示時，保留已查出的證據，再依 intent/execution 流程推進該授權範圍。
