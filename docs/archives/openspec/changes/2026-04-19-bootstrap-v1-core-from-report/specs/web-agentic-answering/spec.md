## ADDED Requirements

### Requirement: Verified Current Evidence Retrieval

The Web answer flow SHALL run rule-based Query Normalization without model invocation, apply AI Search retrieval filters for `status = active` and `access_level in allowed_access_levels`, optionally include `version_state = current` only as a fast filter, and validate every candidate with D1 `active/indexed/current` checks before the evidence becomes eligible for answer generation.

#### Scenario: Candidate fails current-version verification

- **WHEN** AI Search returns a candidate whose `document_version_id` no longer maps to an `active`, `indexed`, and `is_current = true` version in D1
- **THEN** the system discards that candidate as invalid evidence
- **AND** the candidate does not contribute to scoring, citations, or the final answer

#### Scenario: Query normalization stays rule-based

- **WHEN** a Web question reaches the normalization step
- **THEN** the system only applies deterministic normalization for whitespace, synonyms, abbreviations, dates, or category hints
- **AND** no model call is made before the first retrieval

### Requirement: Confidence Routed Answering

The system SHALL compute `retrieval_score` from validated evidence, route requests with `retrieval_score >= 0.70` directly to the answer model selected by question type, invoke one answerability judge when `0.45 <= retrieval_score < 0.70`, and perform at most one Query Reformulation retry with `rewrite_query = false`. If confidence stays below the refusal threshold or the required evidence count is not met, the system SHALL return a refusal response. The system SHALL NOT enable cloud fallback in `v1.0.0`.

#### Scenario: High-confidence question bypasses judge

- **WHEN** the validated evidence produces `retrieval_score >= 0.70`
- **THEN** the system skips answerability judge
- **AND** the request is answered through the model role selected for that question type

#### Scenario: Low-confidence question reformulates once and refuses if still weak

- **WHEN** a request falls below the answer threshold and satisfies the retry conditions
- **THEN** the system performs one Query Reformulation retry with AI Search `rewrite_query = false`
- **AND** the system returns a refusal response if the post-retry confidence still remains below the acceptance threshold

### Requirement: Citation Mapped Responses

The system SHALL assemble citations only from prebuilt `source_chunks`, SHALL treat unmapped provider candidates as invalid evidence, SHALL persist `citation_records` for cited chunks, and SHALL preserve the Web single-document follow-up fast path only when the previous assistant response can still be revalidated to one current document.

#### Scenario: Unmapped retrieval candidate cannot become a citation

- **WHEN** a retrieval candidate cannot be matched to an existing `source_chunks` row for the validated version
- **THEN** the candidate is excluded from the final answer
- **AND** the response does not emit a citation for that candidate

#### Scenario: Follow-up loses the single-document fast path

- **WHEN** the previous assistant response no longer revalidates to one current document
- **THEN** the next Web follow-up is reclassified as ambiguous or cross-document
- **AND** the system does not reuse the single-document follow-up route

### Requirement: Neutral Project Shell

Before the full product experience is complete, the Web shell SHALL remain a neutral knowledge-project frame aligned with the report scope. The authenticated landing page and shared layout SHALL NOT use generic starter welcome copy, SHALL NOT imply a finished vertical product, and SHALL keep role context and sign-out affordances without overstating delivered capabilities.

#### Scenario: Authenticated landing stays neutral

- **WHEN** an authenticated user lands on the root page before later feature surfaces are filled in
- **THEN** the page presents a neutral project shell with current user context
- **AND** the page does not use generic starter welcome messaging or vendor-specific claims

#### Scenario: Shared layout avoids misleading product framing

- **WHEN** the default application layout renders navigation or footer copy
- **THEN** the copy stays consistent with a `v1.0.0` knowledge-project shell
- **AND** the layout does not imply the repo is already a fully delivered end-user product
