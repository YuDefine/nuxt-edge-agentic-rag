# Collapse Environments to Local + Production

## Decision

把 `KNOWLEDGE_ENVIRONMENT_VALUES` 從 `['local', 'staging', 'production']` 收斂為 `['local', 'production']`。所有規格、文件、測試 fixture、scripts 中對 `staging` 的引用一併改寫為 `local`（或對應語境的 `production`）。`v1.0.0` 不再宣稱「至少需區分三種環境」，改為「兩種環境 + 預留 staging/preview 擴充路徑」。

## Context

2026-04-19 review 時發現報告與實作存在反向漂移：

- **規格層**：`shared/schemas/knowledge-runtime.ts` 的 enum 定義三環境；報告 §2.4.1.6 寫「至少需區分下列三種環境」；表 2-25 是三欄結構（Local/Dev | Staging/Preview | Production）
- **實作層**：`wrangler.jsonc` 只有 production 部署目標、`scripts/deploy.sh` 只 deploy 一次到 `agentic.yudefine.com.tw`、`agentic-staging.yudefine.com.tw` 從未真實存在（只在 `scripts/staging-retention-prune.ts` 範例字串裡）

本專題 v1.0.0 同時受時程與「Cloudflare Workers + R2 + KV + AI Search 一份額度」的客觀限制，繼續維持「規格寫三環境、實作只兩環境」的狀態，比承認「只有兩環境」更糟——它讓答辯時審查者找出「為什麼說至少三環境但只 deploy 兩個」這類落差。

## Alternatives Considered

- **方案 A：補做 staging 環境，對齊報告**
  - 優：規格論述完整保留，部署成熟度看起來更高
  - 缺：多一組 D1/R2/KV/AI Search 的維護成本與額度消耗、對「實效」貢獻低（專題不是 SaaS 商品）、需要新建 GitHub Actions workflow + secrets 一整套

- **方案 B：收斂為 local + production，對齊實作**（採用）
  - 優：誠實反映現況、改動可逆（未來要加 staging 只需 enum 加值 + 補 deploy 流程）、答辯有現成立論（報告 L1748 「答辯範圍收斂」原則、L1264/L1385 「縮短 TTL 驗證」在 local 用 backdated record 即可達成）
  - 缺：需要改寫表 2-25 三欄為兩欄 + 註記、約 30 個檔案的 staging 引用要清理

- **方案 C：保留三環境 enum，僅改文件文字**
  - 優：程式碼變動最少
  - 缺：enum 還允許 `staging` 但實際無 staging 部署，依然是漂移；無法用 schema enum 把「不存在的環境」擋掉

## Reasoning

選 B 的核心理由是「報告是 SSoT，前提是與實作同步」。當報告與實作衝突時，要往**較小、較誠實**的那邊收斂，不能用「補做」的方式假裝規格成立——專題時程不允許、客觀額度不允許、對實效也沒幫助。

報告本身已經立好兩個論據可以順勢承接此決策：

1. **L1748 答辯範圍收斂原則**：v1.0.0 聚焦「架構正確性 + 治理機制 + 契約穩定性」，獨立 staging 屬於驗收方法學議題，可留待後續
2. **L1264 / L1385 staging 用途**：原本就只是「縮短 TTL 驗證 retention」，這在 local 用 backdated record 同樣可達成

## Trade-offs Accepted

- 報告 §2.4.1.6 與表 2-25 需要重寫，新版 `main-v0.0.43.md`
- 約 15 支測試的 governance fixture 從 `'staging'` 改為 `'local'`
- `scripts/staging-retention-prune.ts` 改名為 `scripts/retention-prune.ts`
- `docs/verify/staging-deploy-checklist.md` 改名為 `production-deploy-checklist.md`、`KNOWLEDGE_STAGING_SMOKE.md` 改名為 `KNOWLEDGE_SMOKE.md`
- Archived openspec changes / specs 中的 staging 引用**不回頭改**（屬於歷史紀錄，scope 外）
- 未來若真要引入 staging，要恢復成本：enum 加值 + 補 wrangler env + 補 GitHub Actions workflow + 補 secrets。這個成本是可接受的，因為當前不需要

## Supersedes

無（首次記錄環境收斂決策）。本決策不取代 `2026-04-18-sync-endpoint-staging-verification.md`（該 ADR 講的是 staged upload 驗證，與環境名稱無關）。
