# Policies Reference Catalog

Below is the complete reference of the **51 default Apigee policies** in `apiproxy/policies/` plus the **5 opt-in rate-limit & secondary quota policies** available in `templates/ai-gateway/policies/`.

---

## 1. Authentication, Persona Mapping & Security

| Policy | Type | Description | Attachment Flow |
| :--- | :--- | :--- | :--- |
| **`JS-extract-auth-credentials`** | `Javascript` | Normalizes `x-api-key` &rarr; `x-apikey` and classifies Bearer tokens (`agent_token`, `jwt`, `opaque`). | PreFlow (Request) |
| **`VA-ApiKey`** | `VerifyAPIKey` | Option 1: Validates client API key from `x-apikey` header. | PreFlow (Request) |
| **`OA-VerifyAccessToken`** | `OAuthV2` | Option 2 & Option 4 Fast-Path: Validates native Apigee OAuth tokens and imported IdP tokens (`<1ms` L1 cache). | PreFlow (Request) |
| **`LC-LookupAgentToken`** | `LookupCache` | Option 3: L1 cache lookup for verified GCP Agent Identity `ya29.*` tokens. | PreFlow (Request) |
| **`SC-VerifyGoogleTokenInfo`** | `ServiceCallout` | Option 3: Calls Google `oauth2.googleapis.com/tokeninfo` on cache miss. | PreFlow (Request) |
| **`PC-CacheAgentToken`** | `PopulateCache` | Option 3: Caches verified GCP Agent Identity claims in Apigee L1 cache. | PreFlow (Request) |
| **`LC-LookupIdpToken`** | `LookupCache` | Option 4A: L1 cache lookup for introspected Enterprise IdP opaque tokens. | PreFlow (Request) |
| **`SC-IntrospectOpaqueToken`** | `ServiceCallout` | Option 4A: RFC 7662 token introspection callout to Enterprise IdP. | PreFlow (Request) |
| **`PC-CacheIdpToken`** | `PopulateCache` | Option 4A: Caches active opaque token introspection responses. | PreFlow (Request) |
| **`JC-FetchIdpJwks`** | `ServiceCallout` | Option 4B: Fetches JWKS public keys from Enterprise IdP. | PreFlow (Request) |
| **`VJ-VerifyIdpJwt`** | `VerifyJWT` | Option 4B: Cryptographically verifies Enterprise IdP JWT signature and claims. | PreFlow (Request) |
| **`JS-resolve-auth-persona`** | `Javascript` | Maps verified IdP/Agent claims (`groups`, `sub`, `department`) to Persona API Key, `rate_limit_client_id`, and `identity_team`. | PreFlow (Request) |
| **`VA-VerifyPersonaKey`** | `VerifyAPIKey` | Loads the mapped Persona API Product's LLM Quotas and custom attributes into flow context. | PreFlow (Request) |
| **`OA-SaveTokenAttributes`** | `OAuthV2` | Imports external Bearer token into Apigee token store with `user_id`, `persona`, `team`, `team_quota_*`, and `quota_override*` attributes. | PreFlow (Request) |
| **`RF-Unauthorized`** | `RaiseFault` | Enforces Zero-Passthrough Auth by returning `401 Unauthorized` when no auth option succeeds. | PreFlow (Request) |
| **`SUP-SanitizeUserPrompt`** | `SanitizeUserPrompt` | GCP Model Armor filter for incoming Claude/OpenAI user prompts. | PreFlow (Request) |
| **`SUP-SanitizeUserPromptGemini`** | `SanitizeUserPrompt` | GCP Model Armor filter for native Gemini JSON contents. | PreFlow (Request) |
| **`SMR-SanitizeModelResponse`** | `SanitizeModelResponse` | GCP Model Armor filter for model completions and SSE stream deltas. | PostFlow / EventFlow |
| **`JS-inject-deidentified-finding`** | `Javascript` | Extracts Model Armor DLP findings and injects masked payloads. | FaultRules |
| **`AM-CustomError`** | `AssignMessage` | Emits structured `400` error response when security rules trigger. | FaultRules |

---

## 2. Quotas, Rate Limits, Team Budgets & Monetization

| Policy | Type | Description | Attachment Flow |
| :--- | :--- | :--- | :--- |
| **`MLC-EnforceMonetizationLimits`** | `MonetizationLimitsCheck` | Validates prepaid developer wallet balance prior to calling LLM backends. | PreFlow (Request) |
| **`LTQ-EnforceOnly`** | `LLMTokenQuota` | Enforces primary rolling-window token limits, per-model LLM operation quotas (`<LLMModelSource>{model}</LLMModelSource>`), and time-bound individual exceptions. | PreFlow (Request) |
| **`LTQ-CountOnly`** | `LLMTokenQuota` | Increments consumed tokens into the primary/per-model counter. | PostFlow / EventFlow |
| **`LTQ-SecondaryEnforceOnly`** *(Opt-in)* | `Quota` | Enforces 2nd rolling window (e.g., 7-day cap) OR Shared Team Budget (`secondary_quota_identifier = "team:<dept>"`). Bypassed when `individual_exception_active == "true"`. | PreFlow (Request) |
| **`LTQ-SecondaryCountOnly`** *(Opt-in)* | `Quota` | Increments consumed tokens into the 2nd rolling window or Shared Team Budget pool. | PostFlow / EventFlow |
| **`SA-BurstRateLimit`** *(Opt-in)* | `SpikeArrest` | Enforces per-client burst request rate (`<UseEffectiveCount>true</UseEffectiveCount>`). | PreFlow (Request) |
| **`Q-ConcurrencyLimit`** *(Opt-in)* | `Quota` | Distributed semaphore (`+1` on ingress) capping simultaneous in-flight requests/SSE streams per client. | PreFlow (Request) |
| **`RQ-ReleaseConcurrencySlot`** *(Opt-in)* | `ResetQuota` | Distributed semaphore release (`-1` on completion, final SSE chunk, or fault). | PostFlow / EventFlow / FaultRules |
| **`JS-format-rate-limit-error`** | `Javascript` | Identifies exact constraint (`per_model_quota`, `individual_exception_quota`, `team_budget_quota`, `burst_rate_limit`, `concurrency_limit`) and computes `Retry-After`. | FaultRules |
| **`AM-RateLimitError`** | `AssignMessage` | Emits standardized `429 Too Many Requests` JSON and `X-RateLimit-*` headers. | FaultRules |
| **`JS-calculate-monetization-cost`** | `Javascript` | Computes exact micro-transaction USD cost across uncached input, cache read, cache write, completion, and reasoning tokens. | PostFlow / EventFlow |
| **`AM-SetMonetizationHeaders`** | `AssignMessage` | Injects `X-Gateway-*-Cost-USD`, cache, and reasoning token headers. | PostFlow (Response) |
| **`AM-SetQuotaHeaders`** | `AssignMessage` | Injects `x-quota-allowed`, `x-quota-used`, `x-quota-available`, and `X-RateLimit-*` headers. | PostFlow (Response) |

---

## 3. Smart Routing, LLM Judge & Protocol Transcoding

| Policy | Type | Description | Attachment Flow |
| :--- | :--- | :--- | :--- |
| **`OAS-ValidateMessageRequest`** | `OASValidation` | Validates `/v1/messages` against Anthropic schema (`claude_messages_oas.yaml`). | PreFlow (Request) |
| **`OAS-ValidateOpenAIRequest`** | `OASValidation` | Validates `/v1/chat/completions` against OpenAI schema (`openai_chat_oas.yaml`). | PreFlow (Request) |
| **`OAS-ValidateEmbeddingsRequest`** | `OASValidation` | Validates `/v1/embeddings` against OpenAI embeddings schema (`openai_embeddings_oas.yaml`). | PreFlow (Request) |
| **`OAS-ValidateGeminiRequest`** | `OASValidation` | Validates `/ai-gateway` against Vertex Gemini schema (`gemini_predict_oas.yaml`). | PreFlow (Request) |
| **`EV-Model`** | `ExtractVariables` | Fast-path JSONPath extractor for `model` field. | PreFlow (Request) |
| **`JS-extract-prompt`** | `Javascript` | Extracts normalized user prompt text for Model Armor and LLM Judge. | PreFlow (Request) |
| **`JS-prepare-judge-request`** | `Javascript` | Formats prompt analysis payload for the Gemini Flash-Lite classifier. | PreFlow (Request) |
| **`SC-LLMJudge`** | `ServiceCallout` | Calls Vertex AI Gemini to evaluate prompt complexity ($1\text{–}10$) and task category. | PreFlow (Request) |
| **`JS-process-judge-response`** | `Javascript` | Parses judge complexity score and task taxonomy. | PreFlow (Request) |
| **`JS-resolve-model-location`** | `Javascript` | Evaluates cost tiers, fallback arrays, aliases, MaaS publishers, OpenAI per-client keys, and quota overrides. | PreFlow (Request) |
| **`JS-anthropic-to-gemini`** | `Javascript` | Translates Anthropic `/v1/messages` request to Vertex Gemini format. | Target PreFlow |
| **`JS-anthropic-to-openai`** | `Javascript` | Translates Anthropic `/v1/messages` request to OpenAI format. | Target PreFlow |
| **`JS-openai-to-anthropic`** | `Javascript` | Translates OpenAI `/v1/chat/completions` request to Anthropic format. | Target PreFlow |
| **`JS-openai-to-vertex-embeddings`** | `Javascript` | Translates OpenAI `/v1/embeddings` request to Vertex AI `:predict` format. | Target PreFlow |
| **`JS-gemini-to-anthropic-resp`** | `Javascript` | Translates non-streaming Gemini response to Anthropic `message` format. | Target PostFlow |
| **`JS-openai-to-anthropic-resp`** | `Javascript` | Translates non-streaming OpenAI response to Anthropic `message` format. | Target PostFlow |
| **`JS-anthropic-to-openai-resp`** | `Javascript` | Translates non-streaming Anthropic response to OpenAI `chat.completion` format. | Target PostFlow |
| **`JS-vertex-to-openai-embeddings`** | `Javascript` | Translates Vertex AI `:predict` embeddings response to OpenAI `list` format. | Target PostFlow |
| **`JS-combine-resp`** | `Javascript` | Streaming `EventFlow` SSE chunk translator, sanitizer buffer, and trailer token extractor. | Target EventFlow |

---

## 4. Telemetry, Headers & Target Auth

| Policy | Type | Description | Attachment Flow |
| :--- | :--- | :--- | :--- |
| **`DC-CaptureTokenCountsNonStreaming`** | `DataCapture` | Captures all 9 Data Collectors (`dc_*_token_count`, `dc_model`, `dc_tx_cost_usd`, `dc_identity_*`) on non-streaming calls. | PostFlow (Response) |
| **`DC-CaptureTokenCountsStreaming`** | `DataCapture` | Captures all 9 Data Collectors from final SSE stream trailers. | EventFlow (Response) |
| **`JS-calculate-tokens-non-streaming`** | `Javascript` | Normalizes prompt, completion, cached, and reasoning tokens across all providers. | PostFlow (Response) |
| **`EV-ExtractMetadataNonStreaming*`** | `ExtractVariables` | Protocol-specific JSONPath extractors (`Anthropic`, `Gemini`, `OpenAI`) for usage metadata. | PostFlow (Response) |
| **`AM-SetOpenAIAuth`** | `AssignMessage` | Injects `Authorization`, `OpenAI-Organization`, and `OpenAI-Project` on `openai-custom` target. | Target PreFlow |
| **`AM-SetRoutingHeaders`** | `AssignMessage` | Injects `X-Gateway-*` routing, identity, and token breakdown headers. | PostFlow (Response) |
| **`AM-CORS`** | `AssignMessage` | Injects CORS headers on responses and `OPTIONS` preflight requests. | PreFlow / PostFlow |

