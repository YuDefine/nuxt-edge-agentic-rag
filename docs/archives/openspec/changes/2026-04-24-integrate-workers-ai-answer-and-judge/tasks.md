## 1. Shared Workers AI adapters

- [x] 1.1 Implement **Shared Workers AI adapters stay behind the existing answer and judge contracts** by replacing the fallback answer integration in `server/api/chat.post.ts`, `server/mcp/tools/ask.ts`, and the shared answer adapter so **Web and MCP accepted paths SHALL use Workers AI-generated answers**.
- [x] 1.2 Implement **Shared Workers AI adapters stay behind the existing answer and judge contracts** by wiring the shared judge adapter through `server/utils/knowledge-answering.ts`, `server/utils/web-chat.ts`, and `server/utils/mcp-ask.ts` so **Judge paths SHALL use Workers AI without splitting Web and MCP governance**.

## 2. Accepted-path evidence and smoke

- [x] 2.1 Implement **Accepted-path evidence is a first-class deliverable** by defining fixed Web and MCP sample sets that satisfy **Accepted-path verification SHALL be reproducible and evidence-backed**, including coverage for `direct_answer` and `judge_pass`.
- [x] 2.2 Implement **Accepted-path evidence is a first-class deliverable** by adding rerunnable smoke steps and evidence capture instructions that satisfy **Accepted-path verification SHALL be reproducible and evidence-backed** for both Web and MCP.

## 3. Baseline measurement and reporting

- [x] 3.1 Implement **Cost claims use measured baseline plus labeled scenario extrapolation** by recording the minimum Workers AI latency and usage fields needed so **Cost and latency claims SHALL distinguish measured baselines from scenario estimates**.
- [x] 3.2 Implement **Cost claims use measured baseline plus labeled scenario extrapolation** by documenting the baseline-versus-estimate wording and sample-run procedure used to satisfy **Cost and latency claims SHALL distinguish measured baselines from scenario estimates**.

## 4. Regression protection

- [x] 4.1 Implement **Refused-path governance remains stable and out of scope for zero-call proof** by verifying that restricted and refused paths keep existing behavior while **Web and MCP accepted paths SHALL use Workers AI-generated answers** only for accepted and judge-assisted runs.
- [x] 4.2 Add automated regression coverage for **Web and MCP accepted paths SHALL use Workers AI-generated answers** and **Judge paths SHALL use Workers AI without splitting Web and MCP governance** across the shared Web and MCP orchestration paths.
