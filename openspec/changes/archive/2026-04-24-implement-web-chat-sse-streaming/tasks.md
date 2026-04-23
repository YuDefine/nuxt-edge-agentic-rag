## 1. SSE transport contract

- [x] 1.1 Implement **Web chat SHALL use SSE semantics on the existing authenticated chat request path** so **Web chat SHALL stream answers through SSE events** on the Web chat response path.
- [x] 1.2 Implement **First-token latency and cancellation are part of the transport contract** by defining the event sequence, completion markers, and timing hooks needed so **Web chat streaming SHALL record first-token latency**.

## 2. Client streaming state

- [x] 2.1 Implement **Streaming state is driven by server events, not by synthetic chunk timers** by removing timer-based chunk simulation from `app/components/chat/Container.vue` so **Web chat SHALL stream answers through SSE events**.
- [x] 2.2 Implement **Citation, refusal, and error outcomes remain contract-stable across streaming** in the Web chat UI so **Streaming SHALL preserve citation, refusal, and error contracts** during accepted, refusal, and error runs.

## 3. Cancellation and observability

- [x] 3.1 Implement **First-token latency and cancellation are part of the transport contract** by propagating stop requests through the active stream so **Web chat streaming SHALL support end-to-end cancellation**.
- [x] 3.2 Implement **First-token latency and cancellation are part of the transport contract** by persisting and exposing the measurements required so **Web chat streaming SHALL record first-token latency**.

## 4. Design Review

- [x] 4.1 Run the required UI design review and responsive/a11y checks for the files touched by **Streaming state is driven by server events, not by synthetic chunk timers** before human verification.

## 5. Regression and verification

- [x] 5.1 Add automated and smoke verification for **Web chat SHALL stream answers through SSE events** and **Web chat streaming SHALL support end-to-end cancellation**.
- [x] 5.2 Add regression coverage for **Streaming SHALL preserve citation, refusal, and error contracts** and verify the completed flow for **Web chat streaming SHALL record first-token latency**.
