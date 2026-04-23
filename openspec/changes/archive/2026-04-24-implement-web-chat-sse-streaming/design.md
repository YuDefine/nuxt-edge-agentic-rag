## Context

目前 Web chat 在 `app/components/chat/Container.vue` 會先透過 `/api/chat` 取得完整 JSON answer，再以 `simulateStreaming()` 模擬逐字輸出。這種做法雖提供近似體驗，但沒有真實串流事件，也沒有 `first_token_latency` 或 server 端中斷語義。因為串流只影響 web chat，不影響 MCP，這個 change 應聚焦在 Web route、串流狀態管理與觀測面，避免與回答層接入 proposal 混成同一條主題。

## Goals / Non-Goals

**Goals:**

- 將 Web chat 回答改為由 server 以 SSE 事件逐步輸出。
- 讓前端依實際串流事件更新畫面，不再依賴 `simulateStreaming()` 假串流。
- 補齊 `first_token_latency` 觀測與 end-to-end 中斷語義。
- 維持 citation、refusal、error 行為與現有 Web contract 一致，不因串流上線而退化。

**Non-Goals:**

- 不把 MCP 工具改成串流協定。
- 不在本 change 中重新定義 Workers AI `answer + judge` 模型接入。
- 不擴張成 dashboard、長期延遲分析或跨通道串流統一層。

## Decisions

### Web chat SHALL use SSE semantics on the existing authenticated chat request path

這個 change 採用 SSE 事件格式作為 Web chat 串流協定，並優先沿用既有受保護的 chat request path，而不是另開與認證 / CSRF 完全分離的第二套通道。這可降低 session、rate limit、conversation persistence 與治理規則漂移的風險。

替代方案是引入 WebSocket 或第二個專用 streaming service，但對目前單向回答串流來說成本過高，因此不採用。

### Streaming state is driven by server events, not by synthetic chunk timers

前端狀態必須由 server 送出的事件推進，包含 waiting、streaming、complete、error 與 cancel。這代表 `simulateStreaming()` 類的前端計時拆字邏輯應被移除，畫面只能反映真實收到的事件與內容。

替代方案是保留假串流作為 fallback 視覺效果，但那會模糊真串流的完成定義，因此不採用。

### First-token latency and cancellation are part of the transport contract

`first_token_latency` 與 end-to-end cancellation 不只是附帶指標，而是串流 capability 的一部分。server 必須在第一個可見 token 或第一個回答內容事件發出時留下量測基準，client 的 stop 操作也必須能讓 server 停止後續生成與串流，而不是只有前端停止渲染。

替代方案是先只做前端停更或只記錄 completion latency，但這不足以支撐真串流主張，因此不採用。

### Citation, refusal, and error outcomes remain contract-stable across streaming

串流上線後，citation、refusal、error 的對外契約必須保持可預期。accepted path 仍要能在最終完成時提供引用資料；refusal path 仍要明確結束並顯示拒答；error path 仍要維持可辨識的錯誤狀態與停止語義。

替代方案是先犧牲 citation 或 refusal 一致性以換取較快上線，但那會破壞 core loop，因此不採用。

## Risks / Trade-offs

- [Risk] SSE 事件解析與前端狀態管理變複雜，容易出現 incomplete / duplicate append 問題。 → Mitigation：先定義有限事件集合與明確終止條件，再以整合測試覆蓋主要狀態轉換。
- [Risk] 沿用既有 `/api/chat` 路徑可能讓同步 JSON 與串流事件並存一段時間。 → Mitigation：在設計中明確定義相容模式或切換條件，避免 client 與 route contract 混亂。
- [Risk] stop 行為只中斷 client，不中斷 server 生成。 → Mitigation：把 abort propagation 列為硬性驗收，並要求 smoke 驗證。
- [Risk] 串流完成後 citation 或 refusal payload 與既有 UI 不相容。 → Mitigation：把 final event payload 與 UI adapter 視為同一份 contract 來設計與驗證。
