## ADDED Requirements

### Requirement: Web retrieval SHALL use Cloudflare AI Search Workers binding

Web chat 的 retrieval pipeline SHALL 使用 Cloudflare AI Search 新 Workers binding，而不是 legacy `env.AI.autorag()`。系統 SHALL 從 `AI_SEARCH` namespace binding 取得 instance handle，並以 runtime-configured instance id 執行 `search()`。Workers AI answer / judge / query rewriter SHALL 繼續使用既有 `AI` binding；search binding 與 model inference binding 不可混用。

#### Scenario: Web chat uses AI Search namespace binding

- **WHEN** `server/api/chat.post.ts` 建立 retrieval search client
- **THEN** 系統 SHALL 從 Cloudflare env 讀取 `AI_SEARCH` binding
- **AND** 系統 SHALL 呼叫 `AI_SEARCH.get(<configured instance id>).search(...)`
- **AND** 系統 SHALL NOT 呼叫 `AI.autorag(<index name>).search(...)`

#### Scenario: Missing AI Search binding returns service unavailable

- **WHEN** Web chat retrieval 需要 search binding 但 Cloudflare env 缺少 `AI_SEARCH` 或 `AI_SEARCH.get` 不是 function
- **THEN** `/api/chat` SHALL 回傳 service-unavailable error path
- **AND** error message SHALL 指向 Cloudflare AI Search binding `AI_SEARCH` 缺失
- **AND** 系統 SHALL NOT fallback 到 legacy `AI.autorag()`

### Requirement: AI Search request mapping SHALL preserve retrieval governance

Search adapter SHALL 把既有 retrieval intent 轉換成 Cloudflare AI Search request shape。`max_num_results` SHALL 移到 `ai_search_options.retrieval.max_num_results`；`ranking_options.score_threshold` SHALL 移到 `ai_search_options.retrieval.match_threshold`；metadata filters SHALL 只出現在 `ai_search_options.retrieval.filters`。Adapter SHALL NOT 送出 legacy top-level `max_num_results`、`ranking_options`、`rewrite_query` 或 AutoRAG `{ type, key, value }` filter shape。

#### Scenario: Max results and threshold are sent in retrieval options

- **WHEN** `retrieveVerifiedEvidence` 要求 `maxResults = 8` 且 `minScore = 0.5`
- **THEN** AI Search request SHALL include `ai_search_options.retrieval.max_num_results = 8`
- **AND** AI Search request SHALL include `ai_search_options.retrieval.match_threshold = 0.5`
- **AND** request SHALL NOT include top-level `max_num_results` 或 `ranking_options`

#### Scenario: Empty filters are omitted from AI Search request

- **WHEN** retrieval filter builder 沒有產生 metadata filter
- **THEN** AI Search request SHALL omit `ai_search_options.retrieval.filters`
- **AND** D1 `resolveCurrentEvidence()` SHALL still enforce allowed access levels, active document status, and current-version requirements after search returns candidates

#### Scenario: Metadata filters use AI Search format only

- **WHEN** retrieval code sends a metadata pre-filter to Cloudflare AI Search
- **THEN** filter SHALL use AI Search / Vectorize-style shape such as implicit key-value equality or compound `and` / comparison objects
- **AND** filter SHALL be nested under `ai_search_options.retrieval.filters`
- **AND** filter SHALL NOT use legacy AutoRAG `{ type: 'eq', key, value }` objects

### Requirement: AI Search chunks SHALL map to verified evidence candidates

Search adapter SHALL map Cloudflare AI Search `chunks` response into the existing `KnowledgeSearchCandidate` shape used by D1 post-verification. The mapping SHALL read text, score, and required document metadata from each chunk. Chunks missing required metadata SHALL be discarded before D1 verification.

#### Scenario: Valid chunk maps to KnowledgeSearchCandidate

- **WHEN** AI Search returns a chunk with `text`, `score`, and `item.metadata.document_version_id`, `item.metadata.citation_locator`, `item.metadata.access_level`
- **THEN** search adapter SHALL return one `KnowledgeSearchCandidate`
- **AND** candidate SHALL preserve `excerpt`, `score`, `documentVersionId`, `citationLocator`, and `accessLevel`

#### Scenario: Chunk missing required metadata is discarded

- **WHEN** AI Search returns a chunk without `document_version_id`, `citation_locator`, `access_level`, or text
- **THEN** search adapter SHALL discard that chunk
- **AND** discarded chunk SHALL NOT reach `resolveCurrentEvidence()`
- **AND** the route SHALL continue processing other valid chunks if present

#### Scenario: Cloudflare search error remains observable

- **WHEN** `AI_SEARCH.get(instanceId).search()` rejects or throws
- **THEN** search adapter SHALL propagate the error to the existing route error handling path
- **AND** the system SHALL NOT convert the error into an empty result set
- **AND** evlog / route logging SHALL be able to capture the Cloudflare failure as runtime evidence
