# 📜 Policies Reference Catalog

Below is the complete reference of all 38 Apigee policies used in the native AI Gateway proxy bundle.

---

## 1. Security & Authentication

| Policy | Type | Description | Attachment Flow |
| :--- | :--- | :--- | :--- |
| **`VA-ApiKey`** | `VerifyAPIKey` | Validates client API key from `x-apikey` header or query parameter. | PreFlow (Request) |
| **`SUP-SanitizeUserPrompt`** | `SanitizeUserPrompt` | GCP Model Armor filter for incoming Claude/OpenAI user prompts. | PreFlow (Request) |
| **`SUP-SanitizeUserPromptGemini`** | `SanitizeUserPrompt` | GCP Model Armor filter for native Gemini JSON contents. | PreFlow (Request) |
| **`SMR-SanitizeModelResponse`** | `SanitizeModelResponse` | GCP Model Armor filter for model completions and SSE stream deltas. | PostFlow / EventFlow (Response) |
| **`JS-inject-deidentified-finding`** | `Javascript` | Extracts Model Armor DLP findings and injects masked payloads. | FaultRules |
| **`AM-CustomError`** | `AssignMessage` | Emits structured 403 error response when security rules trigger. | FaultRules |

---

## 2. Monetization & Rate Limiting

| Policy | Type | Description | Attachment Flow |
| :--- | :--- | :--- | :--- |
| **`MLC-EnforceMonetizationLimits`** | `MonetizationLimitsCheck` | Validates prepaid developer wallet balance prior to calling LLM backends. | PreFlow (Request) |
| **`JS-calculate-monetization-cost`** | `Javascript` | Computes exact micro-transaction cost based on prompt & completion token rates. | PostFlow / EventFlow (Response) |
| **`AM-SetMonetizationHeaders`** | `AssignMessage` | Injects `X-Gateway-*-Cost-USD` and currency response headers. | PostFlow (Response) |
| **`LTQ-EnforceOnly`** | `Quota` | Enforces hourly token limits per API Product without incrementing count. | PreFlow (Request) |
| **`LTQ-CountOnly`** | `Quota` | Increments consumed token counts into the distributed rate limiter. | PostFlow / EventFlow (Response) |
| **`AM-SetQuotaHeaders`** | `AssignMessage` | Injects `x-quota-allowed`, `x-quota-used`, and `x-quota-available` headers. | PostFlow (Response) |

---

## 3. Smart Routing & LLM Judge

| Policy | Type | Description | Attachment Flow |
| :--- | :--- | :--- | :--- |
| **`EV-Model`** | `ExtractVariables` | Fast-path regex extractor for `model` field in JSON payload. | PreFlow (Request) |
| **`JS-prepare-judge-request`** | `Javascript` | Formats prompt analysis payload for the Gemini 3.1 Flash-Lite classifier. | PreFlow (Request) |
| **`SC-LLMJudge`** | `ServiceCallout` | Executes synchronous callout to Gemini on Vertex AI to evaluate prompt complexity. | PreFlow (Request) |
| **`JS-process-judge-response`** | `Javascript` | Parses judge complexity score ($1-10$) and task taxonomy. | PreFlow (Request) |
| **`JS-resolve-model-location`** | `Javascript` | Evaluates cost tiers, fallback arrays, aliases, and custom URLs. | PreFlow (Request) |

---

## 4. Telemetry & Analytics

| Policy | Type | Description | Attachment Flow |
| :--- | :--- | :--- | :--- |
| **`DC-CaptureTokenCountsNonStreaming`** | `DataCapture` | Records non-streaming token usage and costs into Apigee Analytics. | PostFlow (Response) |
| **`DC-CaptureTokenCountsStreaming`** | `DataCapture` | Records streaming token counts captured from SSE trailer deltas. | EventFlow (Response) |
| **`JS-calculate-tokens-non-streaming`** | `Javascript` | Aggregates prompt, completion, and total tokens from backend responses. | PostFlow (Response) |
| **`EV-ExtractMetadataNonStreaming`** | `ExtractVariables` | JSONPath extractor for Anthropic non-streaming response tokens. | PostFlow (Response) |
| **`EV-ExtractMetadataNonStreamingGemini`** | `ExtractVariables` | JSONPath extractor for Gemini usageMetadata tokens. | PostFlow (Response) |
| **`EV-ExtractMetadataNonStreamingOpenAI`** | `ExtractVariables` | JSONPath extractor for OpenAI usage tokens. | PostFlow (Response) |
