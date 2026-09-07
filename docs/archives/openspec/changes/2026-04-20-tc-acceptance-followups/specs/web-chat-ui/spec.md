## MODIFIED Requirements

### Requirement: Streaming Answer And Refusal Display

The system SHALL stream assistant responses in the chat UI, show loading state before the first token, render partial content incrementally, display refusal responses distinctly from successful answers, and treat detected high-risk inputs (credentials and credit card numbers) as refusal-worthy regardless of retrieval outcome.

#### Scenario: Streaming tokens render incrementally

- **WHEN** a user submits a question and the server streams a response
- **THEN** the UI renders partial answer content as it arrives
- **AND** keeps the newest streamed content visible

#### Scenario: Refusal displays without citation markers

- **WHEN** the final assistant response is a refusal
- **THEN** the UI displays refusal styling and explanatory copy
- **AND** does not render citation markers for that refusal message

#### Scenario: Credit card pattern in user input triggers refusal

- **WHEN** a user submits a question whose text matches the credit card number pattern (13-19 consecutive digits with optional separators)
- **THEN** the server SHALL classify the input as high-risk via `auditKnowledgeText` with `shouldBlock=true`
- **AND** the assistant SHALL return a refusal response styled identically to other credential-based refusals (api_key, secret, token)
- **AND** persisted records (`messages.content_redacted`, `query_logs.query_redacted_text`) MUST contain only the masked form (e.g., `[BLOCKED:credential]` or `[REDACTED:credit_card]`), never the raw digits
- **AND** `risk_flags_json` MUST include `'pii_credit_card'`
- **AND** no AI Search retrieval or Workers AI generation calls SHALL be made for the blocked request
