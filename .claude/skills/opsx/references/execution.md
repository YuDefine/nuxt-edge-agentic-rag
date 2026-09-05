<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/opsx/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

# 實作、證據與歸檔

1. 對指定 repo/change 執行 `inspect --change-id <id> --repo-root <repo> --json`，並對所需 artifact 執行 `instructions --change-id <id> --artifact-id <artifact-id> --repo-root <repo> --json`，取得當前 requirement/work revisions、原驗收、阻塞及證據政策。讀取失敗明示；不得由舊tasks checkbox補猜狀態。
2. 對每個待執行 work spec 呼叫 `materialize --change-id <id> --work-spec-id <id> --repo-root <repo> --json`，回讀同一 work。以現有 work/attempt controller、檔案所有權與 task-type routing 執行；自動開關控制新自動啟動，手動接手保持原身分與互斥 owner。
3. 依該 work 的 BDD 政策取得實際 RED validity、GREEN、mutation 或其他必需證據。沒有相應 phase 的證據就保留未通過；測試 exit 0、截圖、worker 報告各自只證明其真正量到的事。
4. 經 `evidence --receipt <json>` 提交帶 change/requirement revision、work/attempt/span、phase、subject digest 及可查引用的實際收據，再回讀。人的回答仍經既有 decision queue／共同 command，不能由實作者捏造 human decision。
5. 執行 `project --change-id <id> --repo-root <repo> --json` 重建目前投影，再 `inspect` 檢查既有判定器的 gate。tasks.md、驗證與完成 badge 都讀這個投影，不能直接寫checkbox。
6. 使用者任務包含歸檔且所有 archive predicates 通過後，呼叫 `archive --change-id <id> --repo-root <repo> --json`，回讀封存位置及保留的來源／證據。任一 predicate 未過就處理具體原因；不以 skip validation、mark complete 或關掉writer偵測繞過。

完成回報附當前 revision、work、驗證證據及 commit／部署的實際狀態。尚未部署就明說未部署；已完成程式驗證但仍有人的 gate，就呈現待驗收而非已交付。
