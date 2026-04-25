## ADDED Requirements

### Requirement: Web chat SSE stream SHALL emit liveness signal during long idle gaps

The system SHALL emit a liveness signal at least every 20 seconds while the SSE stream is open, including the gap between the initial `ready` event and the first answer-content event. The liveness signal SHALL use SSE comment syntax (a line starting with `:`) so that conformant SSE clients ignore it without exposing it as application-level content. The liveness signal SHALL NOT be counted as a first-token event for first-token latency measurement, and SHALL NOT be forwarded as application-level content to the chat UI.

#### Scenario: Stream stays alive when first answer-content event is delayed beyond proxy idle threshold

- **WHEN** an accepted Web chat request emits `ready` and the upstream answer generator delays the first answer-content event for at least 30 seconds
- **THEN** the server SHALL emit a liveness signal in SSE comment syntax at least every 20 seconds during the gap
- **AND** the client SHALL stay connected and SHALL eventually receive the first answer-content event when generation produces output
- **AND** the recorded first-token latency SHALL reflect the time from request start to the first answer-content event, NOT to any liveness signal

#### Scenario: Liveness signal stops on stream termination

- **WHEN** an SSE stream terminates via accepted completion, refusal, error, or user cancellation
- **THEN** the server SHALL stop emitting liveness signals before or at the same time the stream is closed
- **AND** the server SHALL NOT enqueue any liveness signal after the stream controller is closed
