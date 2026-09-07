## ADDED Requirements

### Requirement: Web chat SHALL stream answers through SSE events

The system SHALL deliver Web chat answers as real SSE events instead of waiting for a complete answer and simulating chunked output on the client. The client SHALL render streamed content from server events rather than from synthetic timer-based chunking.

#### Scenario: Client renders streamed answer content from server events

- **WHEN** an accepted Web chat request starts streaming
- **THEN** the server SHALL emit answer content as SSE events
- **AND** the client SHALL append visible answer content from those events
- **AND** the client SHALL NOT depend on synthetic chunk timers to display the answer

### Requirement: Web chat streaming SHALL record first-token latency

The system SHALL measure and persist first-token latency for streamed Web chat answers. The measurement SHALL reflect the elapsed time between request start and the first emitted answer-content event that is visible to the client.

#### Scenario: First token latency is recorded for a streamed answer

- **WHEN** a streamed Web chat answer emits its first visible answer-content event
- **THEN** the system SHALL record first-token latency for that run
- **AND** the recorded value SHALL be available to the verification flow for the streaming capability

### Requirement: Web chat streaming SHALL support end-to-end cancellation

The system SHALL support user-triggered cancellation that stops both client-side rendering and server-side streaming work. A canceled run SHALL terminate the active stream and SHALL NOT continue emitting answer-content events after cancellation is acknowledged.

#### Scenario: User stop action terminates the active stream

- **WHEN** the user triggers stop during an active streamed answer
- **THEN** the client SHALL stop rendering additional streamed content
- **AND** the server SHALL stop emitting further answer-content events for that run

### Requirement: Streaming SHALL preserve citation, refusal, and error contracts

The system SHALL preserve the existing Web chat citation, refusal, and error semantics after enabling streaming. Accepted runs SHALL still deliver the citation data required by the Web chat UI, refusal runs SHALL still terminate with a refusal outcome, and error runs SHALL still surface a stable error state.

#### Scenario: Accepted streamed answer completes with citation data

- **WHEN** a streamed accepted run completes successfully
- **THEN** the final streaming outcome SHALL include the citation data required by the Web chat UI
- **AND** the UI SHALL be able to render the completed answer without a separate fallback fetch

#### Scenario: Refusal and error outcomes remain explicit

- **WHEN** a streamed run ends in refusal or error
- **THEN** the stream SHALL terminate with an explicit refusal or error outcome
- **AND** the UI SHALL preserve the corresponding refusal or error behavior instead of hanging in a streaming state
