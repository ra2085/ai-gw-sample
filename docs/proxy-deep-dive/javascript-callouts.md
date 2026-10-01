# JavaScript Callouts & Streaming Logic

The AI Gateway includes **20 specialized JavaScript callouts** in `apiproxy/resources/jsc/` (and `templates/ai-gateway/resources/jsc/`) to perform low-latency authentication classification, smart routing, bidirectional protocol transcoding, and streaming SSE processing.

---

## 1. Authentication & Persona Resolution Callouts

| Script | Policy | Purpose |
| :--- | :--- | :--- |
| **`extract_auth_credentials.js`** | `JS-extract-auth-credentials` | Normalizes `x-api-key` &rarr; `x-apikey`, extracts `Bearer` tokens, and classifies token type (`agent_token` for `ya29.*`, `jwt` for 3-part base64url, or `opaque`). |
| **`resolve_auth_persona.js`** | `JS-resolve-auth-persona` | Evaluates verified JWT/Opaque/Agent claims (`groups`, `roles`, `sub`, `department`), maps the user to a low-cardinality **Persona API Key**, computes remaining token TTL (`token_expires_in_ms`), and sets `rate_limit_client_id` and `identity_team`. |

---

## 2. Core Smart Router & Quota Resolution

| Script | Policy | Purpose |
| :--- | :--- | :--- |
| **`resolve_model_location.js`** | `JS-resolve-model-location` | Core brain of the Smart Router. Evaluates cost tiers (`low`, `medium`, `high`, `max`), fallback arrays (`body.models`), aliases, Vertex MaaS dynamic publisher prefixes (`meta/`, `mistralai/`), per-client OpenAI keys (`openai_api_key`), per-model quota bridges, shared Team Budgets (`team:<identity_team>`), and time-bound individual exceptions (`quota_override_expires_at`). |
| **`extract_prompt.js`** | `JS-extract-prompt` | Extracts the latest user prompt text across Anthropic, OpenAI, and Gemini payloads for Model Armor sanitization and LLM Judge classification. |
| **`prepare_judge_request.js`** | `JS-prepare-judge-request` | Builds the classification prompt for `SC-LLMJudge` when `"model": "auto:judge"` is requested. |
| **`process_judge_response.js`** | `JS-process-judge-response` | Parses the classifier's complexity score ($1\text{–}10$) and task category (`coding`, `reasoning`, `summarization`, `simple_chat`). |
| **`build_models_catalog.js`** | `JS-build-models-catalog` | Dynamically serves `GET /v1/models` in both OpenAI and Anthropic catalog formats using `model_locations.properties`. |

---

## 3. Bidirectional Protocol & Embeddings Transcoders

| Script | Policy | Direction |
| :--- | :--- | :--- |
| **`anthropic_to_gemini.js`** | `JS-anthropic-to-gemini` | Converts Anthropic `/v1/messages` requests (including `thinking`, `tool_use`, `tool_result`, `document`, and `image` blocks) to Vertex Gemini `generateContent` / `streamGenerateContent`. |
| **`gemini_to_anthropic_resp.js`** | `JS-gemini-to-anthropic-resp` | Converts non-streaming Gemini responses back to Anthropic `message` format. |
| **`anthropic_to_openai.js`** | `JS-anthropic-to-openai` | Converts Anthropic `/v1/messages` requests to OpenAI `/v1/chat/completions` format (mapping `thinking` to `reasoning_effort`, system blocks, and tools). |
| **`openai_to_anthropic_resp.js`** | `JS-openai-to-anthropic-resp` | Converts non-streaming OpenAI chat completion responses (including `reasoning_content` and `tool_calls`) back to Anthropic `message` format. |
| **`openai_to_anthropic.js`** | `JS-openai-to-anthropic` | Converts OpenAI `/v1/chat/completions` requests to Anthropic `/v1/messages` (`:streamRawPredict`) format. |
| **`anthropic_to_openai_resp.js`** | `JS-anthropic-to-openai-resp` | Converts non-streaming Anthropic responses back to OpenAI `chat.completion` format. |
| **`openai_to_vertex_embeddings.js`** | `JS-openai-to-vertex-embeddings` | Converts OpenAI `/v1/embeddings` requests (`input`, `dimensions`) to Vertex AI `:predict` (`instances`, `parameters.outputDimensionality`). |
| **`vertex_to_openai_embeddings.js`** | `JS-vertex-to-openai-embeddings` | Converts Vertex AI `:predict` embeddings (`predictions[].embeddings.values`, `statistics.token_count`) back to OpenAI `list` format. |
| **`rewrite_openai_model.js`** | `JS-rewrite-openai-model` | Rewrites the JSON body `model` field on `/v1/chat/completions` and `/v1/embeddings` after alias/tier resolution or Vertex MaaS `{publisher}/{model}` prefixing. |

---

## 4. Streaming, Monetization & Error Formatting

| Script | Policy | Purpose |
| :--- | :--- | :--- |
| **`combine_resp.js`** | `JS-combine-resp` | Executes inside `EventFlow` on SSE chunks. Translates Gemini/OpenAI/Anthropic SSE deltas, buffers text for Model Armor inspection, and extracts final token usage (`prompt`, `completion`, `cache_read`, `cache_write`, `thinking`) on the terminal chunk. |
| **`calculate_tokens_non_streaming.js`** | `JS-calculate-tokens-non-streaming` | Normalizes non-streaming token usage across all providers (subtracting cached input tokens from total prompt tokens to compute `usage_uncached_prompt_tokens`). |
| **`calculate_monetization_cost.js`** | `JS-calculate-monetization-cost` | Computes exact micro-transaction USD costs across uncached input, cache read (`0.10x`/`0.25x`), cache write (`1.25x`), completion, and reasoning tokens. |
| **`format_rate_limit_error.js`** | `JS-format-rate-limit-error` | Inspects quota/rate-limit fault variables to return a structured `429` JSON error identifying the exact constraint (`per_model_quota`, `individual_exception_quota`, `team_budget_quota`, `token_quota_secondary`, `burst_rate_limit`, or `concurrency_limit`). |
| **`inject_deidentified_finding.js`** | `JS-inject-deidentified-finding` | Formats Model Armor sanitization and DLP findings into structured error responses. |
