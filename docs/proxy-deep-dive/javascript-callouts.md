# ⚡ JavaScript Callouts & Streaming Logic

The AI Gateway includes 17 specialized JavaScript callouts in `apiproxy/resources/jsc/` to perform low-latency routing, protocol transcoding, and stream processing.

---

## 1. Core Routing & Resolution

### `resolve_model_location.js`
* **Purpose:** Core brain of the Smart Router.
* **Key Logic:**
  * Fast-path single-model detection (avoids full JSON parsing for simple requests).
  * Evaluates multi-model fallback arrays (`body.models = [...]`).
  * Resolves cost tiers (`low`, `medium`, `high`, `max`) and classifier recommendations.
  * Inspects `model_locations.properties` for publisher, endpoint host, region, and **custom URL overrides**.
  * Dynamically populates `route_target`, `endpoint_host`, `model_location`, and `target.url`.

---

## 2. Bidirectional Protocol Translation

### `anthropic_to_gemini.js`
* **Purpose:** Converts Anthropic Claude requests (`/v1/messages`) to Google Gemini `generateContent` or `streamGenerateContent` format.
* **Handles:**
  * System instructions mapping (`system` string or content blocks → `systemInstruction.parts`).
  * Message history and role mapping (`assistant` → `model`).
  * Multimodal base64 image transcoding (`image/jpeg`, `image/png` → `inlineData`).
  * Tool definitions and tool call invocations (`tool_use` → `functionCall`).
  * Generation configs (`max_tokens`, `temperature`, `top_p`, `top_k`, `stop_sequences`).

### `gemini_to_anthropic_resp.js`
* **Purpose:** Converts non-streaming Gemini responses back to Anthropic `message` responses.
* **Handles:**
  * Text content aggregation from candidates.
  * Function call translations to Anthropic `tool_use` blocks.
  * Token usage mapping (`usageMetadata` → `usage.input_tokens`, `usage.output_tokens`).

---

## 3. Streaming EventFlow Handlers

### `combine_resp.js`
* **Purpose:** Executes on every SSE chunk inside Apigee's `EventFlow`.
* **Handles:**
  * Buffers and inspects partial stream deltas for Model Armor evaluation.
  * Converts Gemini chunk events into standardized Anthropic SSE events (`content_block_delta`).
  * Extracts stream trailers containing final token usage counts (`usage_prompt_tokens`, `usage_completion_tokens`).
  * Triggers downstream monetization rating and data capture when the stream completes.

---

## 4. Monetization & Rating

### `calculate_monetization_cost.js`
* **Purpose:** Computes the micro-transaction charge for every API call.
* **Formula:**
  ```text
  Charged USD = [ (Prompt Tokens / 1,000,000 × Input Rate) + (Completion Tokens / 1,000,000 × Output Rate) ] × Markup
  ```
  $$
  \text{Charged USD} = \left[ \left( \frac{\text{Prompt Tokens}}{10^6} \times \text{Input Rate} \right) + \left( \frac{\text{Completion Tokens}}{10^6} \times \text{Output Rate} \right) \right] \times \text{Markup}
  $$
* Populates `perUnitPriceMultiplier`, `currency`, and `tx_cost_usd` variables for Apigee Monetization.

