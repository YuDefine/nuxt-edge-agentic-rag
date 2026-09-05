<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/opsx/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

# 需求建立與修訂

輸入是責任 repo、可引用來源、交付目標、驗收條件及既有 change 身分。新需求與修訂都先讀已交付的 schema：clade 用 `docs/contracts/ai-control-plane/v1/native-intent.schema.json`，consumer 用 `.clade/vendor/contracts/ai-control-plane/v1/native-intent.schema.json`，並以現有 source 與 CLI validator 核對形狀。

1. 保存來源定位、原句、captured time、digest 與來源 revision。既有相同來源保持同一 change/work，內容 digest 只識別修訂。
2. 依 canonical artifact DAG 整理 intake、clarifications、requirement impacts 與 work plan。每個 requirement 有來源引用、目前 revision 及可驗證結果。尚未取得的人的回答留待澄清，不能填成已回答；已有的明確授權照原範圍推進。
3. work specs 連到 requirement refs、影響範圍、verification policy 與 BDD feature/scenario。執行、獨立審查與人的 gate 各有責任來源，不用一個 worker 的自述滿足全部 gate。
4. 新建呼叫 `create --source <json> --repo-root <repo> --commit`；只產草稿的明確任務使用 `--no-commit` 並明示尚未具執行資格。執行前以目前 checkout 的 workflow 規約確認 commit 範圍。create 後回讀 canonical source／binding，只有 CLI 輸出 handle 不算已落檔。
5. 修訂先讀當前 source digest，再呼叫 `revise --source <json> --previous-source-digest <digest> --repo-root <repo> --commit`。衝突時回读最新版本並保留待合併內容，不能覆寫別人修訂。影響的 work 沿原身分重開，旧證據留歷史並等待目前 revision 的重驗。

legacy 接續保留 supersedes target、原 artifact_root 及其 digest，引用原需求／證據。封存或 supersede 是來源關係，不能替原需求蓋完成章。每個已產生副作用的步驟都回讀；失敗保留場景與可重播身分，不用換名稱、鏡像別棵樹或刪原件使操作通過。

來源回讀為 corrupt／unsupported／truncated 時，先恢復可讀原件並核對實際內容與 digest；在這兩項確認前不 create 接續 change、不 materialize。不能用猜測的需求或虛構 digest 填滿 supersedes／provenance。

輸出：change ID、source revision/digest、binding 結果、可執行 work specs、仍缺的澄清或 gate。原任務包含實作且已具執行資格時，接續 execution 流程。
