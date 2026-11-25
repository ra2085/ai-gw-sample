---
name: ai-gateway-architecture
description: >-
  Complete architectural map, request/response/streaming pipeline order, and Apigee X runtime invariants
  for the Apigee Enterprise AI Gateway. Activate this skill whenever reading, modifying, or debugging
  Java Callouts in callout/, apigee-go-gen YAML/Go templates in templates/ai-gateway/, EventFlow SSE
  streaming in combine_resp.js, quotas/wallets, Model Armor, LLM Judge routing, or fallback/fault flows.
---

# Apigee Enterprise AI Gateway — Architecture & Runtime Invariants

Use this skill alongside `apigee-performance-engineering` and `apigee-security-engineering` whenever working on `callout/` or `templates/ai-gateway/`.

---

## 1. End-to-End Topology (`5 ProxyEndpoints` $\times$ `5 TargetEndpoints`)

### 1.1 Ingress `ProxyEndpoint`s (`templates/ai-gateway/apiproxy.yaml`)
1. **`claude-messages` (`/v1/messages`)**: Anthropic Messages SDK ingress (non-streaming & SSE). Transcodes to/from Gemini, OpenAI, or passes through to Anthropic (`:rawPredict` / `:streamRawPredict` or custom BYO Anthropic).
2. **`openai-compat` (`/v1/chat/completions`)**: OpenAI Chat Completions SDK ingress (non-streaming & SSE). Transcodes to/from Anthropic or Gemini, or passes through to Agent Platform OpenAI-compat / MaaS / custom vLLM / Microsoft Foundry / direct OpenAI.
3. **`gemini-native` (`/ai-gateway`)**: Google GenAI / Gemini Enterprise Agent Platform SDK ingress (`:generateContent`, `:streamGenerateContent`, `:rawPredict`, `:streamRawPredict`, `:embedContent`, `:batchEmbedContents`, `:predict`).
4. **`openai-embeddings` (`/v1/embeddings`)**: OpenAI Embeddings ingress. Routes to OpenAI-compatible `/embeddings` or transcodes to/from Agent Platform `:predict` (`gemini-embedding-001`).
5. **`claude-models` (`/v1/models`)**: Loopback (`no-target`) persona-filtered catalog discovery (`GET /v1/models` & `GET /v1/models/{id}`; non-`GET` blocked `405` by `unsupportedModelsMethod`).

### 1.2 Outbound `TargetEndpoint`s
1. **`gemini`**: Gemini Enterprise Agent Platform Gemini Native (`<GoogleAccessToken>` IAM; supports `global`, multi-region `us`/`eu`, and regional hosts via `GlobMatcher.resolveAiPlatformHost`).
2. **`claude`**: Agent Platform Anthropic Partner (`:rawPredict` / `:streamRawPredict` via `<GoogleAccessToken>`) **or** custom BYO Claude Platform (`custom_url` with `x-api-key` / `Authorization`, IAM skipped via `target_skip_google_iam`).
3. **`gemini-openai-compat`**: Agent Platform OpenAI-compatibility, MaaS, & `:predict` embeddings (`<GoogleAccessToken>` IAM).
4. **`openai-custom`**: External / self-hosted OpenAI-compatible endpoints (vLLM, Ollama, Microsoft Foundry, direct OpenAI). **Never** attaches `<GoogleAccessToken>` (`SEC-SKILL-13`: all external `custom_url`s—even if misconfigured with `google_iam`—are forced here or blocked `403` if non-Agent-Platform on IAM targets).
5. **`gemini-native-target`**: Dynamic Agent Platform pass-through for `/ai-gateway` (`gemini_native_target_url` persisted in `TargetEndpoint` `PreFlow` so `OPEN` circuit-breaker path promotion works cleanly).
*(Note: Opt-in `features.streaming.dedicated_sse_targets: true` renders 5 additional `*-sse` `TargetEndpoint`s to isolate SSE vs. non-SSE connection pools if needed; default is `false` to preserve 5 warm `ClientPool`s.)*

---

## 2. Consolidated Callout Architecture (~65–110 µs Total Overhead)

All business logic is consolidated into **4 stateless, thread-safe `BaseCallout` classes** shaded with Jackson `2.17.0` (`com.google.apigee.shaded.jackson.core.*`) into `templates/ai-gateway/resources/java/ai-gateway-callouts.jar`, dispatched via `<Property name="action">...</Property>`, plus **1 Rhino `<EventFlow>` script**:

1. **`AuthAndPersonaCallout.java`** (`callout/src/main/java/com/google/apigee/callouts/AuthAndPersonaCallout.java`)
   - Actions: `extract_auth_credentials`, `resolve_auth_persona`, `restore_request_payload`.
   - Strips untrusted client headers (`X-Upstream-Provider`, `X-Goog-FieldMask`, `X-Goog-User-Project`, secondary API-key headers), resolves all 5 auth modes (Apigee API Key across 6 header names, Apigee OAuth2, GCP SPIFFE Agent Identity / SA via `/tokeninfo`, IdP Opaque via OIDC `/userinfo` cached in `OA-ImportExternalToken`, IdP JWT via `VJ-VerifyIdpJwt`), clamps external token TTLs (`min(configuredTtlMs, upstreamRemainingMs)` with `1000ms` CPS floor), and resolves persona, team, RBAC `allowed_models`, time-bound `exceptions`, and 5-tier Model Armor templates.
2. **`RequestRouterAndTranscoderCallout.java`** (`callout/src/main/java/com/google/apigee/callouts/RequestRouterAndTranscoderCallout.java`)
   - Actions: `extract_vars_gemini`, `extract_vars_openai`, `extract_vars_claude`, `extract_prompt`, `prepare_judge_request`, `process_judge_response`, `resolve_model_location`, `inject_anthropic_version`, `anthropic_to_gemini`, `restore_model_openai`, `models_endpoint`.
   - Single-pass `StrictJson` DOM parsing (`payload_strict_validated = "true"`), bounded `32 KiB` prompt extraction (skipped entirely when both Model Armor and LLM Judge are inactive; covers `contents[].parts` plus `:embedContent` `content.parts` and `:batchEmbedContents` `requests[].content.parts`), two-pass Judge/Smart-Router resolution, SSRF/GCS/cross-project Vertex guards (`GlobMatcher`), and stateless AST transcoders (`tools`, `tool_choice`, `$defs`/`$ref` schema sanitization, `response_format`, multi-turn `thoughtSignature` provenance `gem_ts:*`, Gemini 4 `thinkingLevel`, Claude 5.5 adaptive thinking + `output_config.effort`, `gpt-6*`/`gpt-5*`/`o1`/`o3` reasoning).
3. **`ResponseTranscoderAndCostCallout.java`** (`callout/src/main/java/com/google/apigee/callouts/ResponseTranscoderAndCostCallout.java`)
   - Actions: `gemini_to_anthropic_resp`, `anthropic_to_openai_resp`, `gemini_to_openai_resp`, `calculate_tokens_non_streaming`, `calculate_monetization_cost`.
   - Direct single-pass response transcoding (never 2-hop), `SAFETY`/`RECITATION` $\leftrightarrow$ `refusal` $\leftrightarrow$ `content_filter` mapping, OpenAI vs. Vertex OpenAI-compat `reasoning_tokens` normalization, native embedding token summation (`embedding.statistics.tokenCount`, `embeddings[].statistics.tokenCount`, `predictions[].embeddings.statistics.token_count`), deterministic non-streaming token floor if upstream omits `usage`, and granular USD/micro-USD cost attribution (rolling in `tx_judge_cost_usd` with `gemini-3.5-flash-lite` `$0.25`/`$1.50` fallback rates).
4. **`FallbackAndErrorCallout.java`** (`callout/src/main/java/com/google/apigee/callouts/FallbackAndErrorCallout.java`)
   - Actions: `prepare_fallback_request`, `apply_fallback_response`, `format_rate_limit_error`, `inject_deidentified_finding`.
   - Reuses `RequestRouterAndTranscoderCallout`'s AST transcoders for cross-format fallback chains, wraps `stream: true` fallback recoveries in protocol-native synthetic SSE (or JSON array `[...]` for `:streamGenerateContent` without `?alt=sse`), formats protocol-aware `401`/`403`/`404`/`415`/`429`/`502`/`504` JSON errors, and supports opt-in `sanitize_upstream_errors`.
5. **`combine_resp.js`** (`templates/ai-gateway/resources/jsc/combine_resp.js`, Rhino `<EventFlow>` SSE Aggregator)
   - Decomposed into compact per-protocol helper functions inside a `'use strict'` IIFE to stay strictly below HotSpot JVM C2 `HugeMethodLimit` (`8000` bytecode bytes).
   - Maintains a `64 KiB` `sse_partial_carry` buffer for mid-JSON TCP splits while preserving a zero-copy fast path for complete single frames, tracks concurrent parallel OpenAI $\rightarrow$ Claude tool blocks (`open_tool_blocks_map`), suppresses unrequested synthetic `choices: []` usage chunks unless `client_requested_include_usage == "true"`, supports opt-in `stream_prompt_checkpoint` and `strict_stream_sync`, and computes final streaming token/USD billing on EOF (resolving Judge token overhead via configured classifier model ID with `gemini-3.5-flash-lite` `$0.25`/`$1.50` fallback rates).

---

## 3. Critical Apigee X & Template Gotchas (Never Violate)

### 3.1 Java Callout Classloader Boundary (`NoClassDefFoundError: InputChannel`)
- **Trap**: `com.apigee.flow.message.TransportMessage` declares `setContent(com.apigee.nio.channels.InputChannel)`. `InputChannel` is an internal Apigee NIO class **hidden** from the Java Callout sandbox classloader. Referencing `TransportMessage` anywhere in `callout/` causes `NoClassDefFoundError: com/apigee/nio/channels/InputChannel` at runtime on Apigee X!
- **Pattern**: To construct an outbound `ServiceCallout` request message with dynamic headers and zero blank wire headers (e.g., `SC-FallbackExternal`), initialize the message via `<AssignMessage>` (`AM-model.yaml` `<AssignTo createNew="true">fallbackRequest</AssignTo>`) gated on the fallback condition, retrieve `Object existingFb = vars.get("fallbackRequest")` in Java, cast to `com.apigee.flow.message.Message` (100% public SPI), and call `fbMsg.setHeader(name, value)`.

### 3.2 Mandatory `VarCache` Memoization (`PERF-SKILL-02`)
- `tests/unit/01_performance_skill.test.js` scans all `.java` source files and fails if `msgCtxt.getVariable(` or `msgCtxt.setVariable(` is called directly outside `BaseCallout.java`.
- Always read/write through `VarCache` (`vars.get(...)`, `vars.getString(...)`, `vars.firstNonEmptyKey(...)`, `vars.set(...)`). Embedded bundle `PropertySet`s (`propertyset.config.*`, `propertyset.model_locations.*`, `propertyset.monetization_rates.*`) are Base64-injected into `<JavaCallout>` `<Properties>` and resolved in $O(1)$ from `staticPropertySets` with **zero** JNI/`MessageContext` bridge calls.

### 3.3 Request Security & Guardrail Execution Order (`SEC-SKILL-15`)
In `templates/ai-gateway/_helpers.tmpl`, `ProxyEndpoint` `PreFlow` **must** execute in this exact order:
1. OAS Validation + `JS-extract-vars-*` (`StrictJson` duplicate-key rejection + `415` `Content-Type` check + `?fields=`/`?alt=` HPP check)
2. Multi-Auth Verification + `JS-resolve-auth-persona` (`401`/`403` fail-closed)
3. Pass-1 `JS-resolve-model-location` (persona RBAC `allowed_models`, circuit-breaker `LTQ-CircuitBreakerCheck` promotion, quota bucket/limit setup)
4. `RF-Unauthorized` (`403` RBAC) $\rightarrow$ `SA-BurstRateLimit` $\rightarrow$ `RF-ZeroQuota` / `LTQ-EnforceOnly` / `LTQ-SecondaryEnforceOnly` (`429`) $\rightarrow$ `PTL-PromptTokenLimit` / `preflight_prompt_guard` (opt-in) $\rightarrow$ `Q-ConcurrencyLimit`
5. `SUP-SanitizeUserPrompt*` (Model Armor request scan — `403` before any LLM call)
6. **Only after all guardrails pass**: `JS-prepare-judge-request` $\rightarrow$ `SC-LLMJudge` $\rightarrow$ `JS-process-judge-response` $\rightarrow$ Pass-2 `JS-resolve-model-location` (with `judge_quota_recheck_needed` `LTQ-EnforceOnly` recheck if the resolved model switched per-model quota buckets).

### 3.4 Native `<EventFlow>` Streaming & Concurrency Slot Release (`PERF-SKILL-09`)
- **Never** set `response.streaming.enabled = true` on `ProxyEndpoint` or `TargetEndpoint` HTTP connections—Apigee X `<EventFlow>` (`content.event.type = MESSAGE_CHUNK`) handles chunked SSE natively; enabling legacy `BodyPipe` streaming breaks `<EventFlow>` execution.
- Every `RQ-ReleaseConcurrencySlot` step across `PostFlow`, `EventFlow`, `FaultRules`, and `DefaultFaultRule` **must** remain guarded by `(ratelimit.Q-ConcurrencyLimit.used.count != null) and (apigee.metrics.policy.RQ-ReleaseConcurrencySlot.timeTaken = null)` (and `!(response.header.Content-Type =| "text/event-stream")` in `PostFlow` so slots aren't released on Chunk 0 before the SSE stream finishes).

### 3.5 Fault Handling, `<AlwaysEnforce>` & `TargetEndpoint` `transport-fallback` (`SEC-SKILL-16`, `ROUTE-TRANSCODE-13`)
- All 10 `<DefaultFaultRule>`s set `<AlwaysEnforce>true</AlwaysEnforce>`, guarded by `sanitized_error_applied != "true"` (set in `AM-CustomError` and `AM-RateLimitError`) so intentional `400`/`401`/`403`/`404`/`405`/`415`/`429` JSON errors and `200` fallback recoveries are never overwritten.
- `FallbackAndErrorCallout` `catch` blocks **must never** return `ExecutionResult.ABORT` inside a `FaultRule`/`DefaultFaultRule` (which triggers Apigee's raw `FlowState.ABORT` HTML/XML fault); instead, populate a static fail-closed JSON body and return `ExecutionResult.CONTINUE`.
- All 5 `TargetEndpoint`s define `<FaultRule name="transport-fallback">` to catch DNS/TCP/TLS/timeout faults before HTTP response headers arrive, increment `LTQ-CircuitBreakerCount`, check `< 240s` elapsed budget, execute fallback, scan via `SMR-SanitizeFallbackInFault` (`continueOnError="true"`), and write the recovered `200 OK` response onto `error.*` (`fault_fallback_recovery`).

### 3.6 `apigee-go-gen` Go-Template Rules (`templates/ai-gateway/_helpers.tmpl`)
- **Zero-Value Trap (`QUOTA-COST-11`)**: In Go `text/template`, numeric `0` and `0.0` are falsy! Never write `{{ if .limit }}` or `{{ if .output_rate }}`—always check `(hasKey $map "key") (ne (index $map "key") nil)` and use `positive_allow_count` (emitting `<Allow count="1"/>` in `LTQ-*.yaml` since Apigee XML rejects `count="0"`, paired with `zero_primary_quota` / `zero_secondary_quota` runtime flags for `0`-CPS-RPC `429` enforcement).
- **Colon Model IDs**: Escape `:` as `\:` when writing model keys into `.properties` files (e.g., `llama3.3\:70b`), and split `per_model_quotas` entries with `lastIndexOf(':')` / `rsplit(":", 1)` rather than `split(":", 1)`.

### 3.7 Multi-Project Vertex AI Routing (`ROUTE-TRANSCODE-17`)
- Keep `vertex_project_id` (used by `claude`, `gemini`, `gemini-openai-compat` `TargetEndpoint`s, `/ai-gateway` `gemini_native_target_url` path rewrites, and `SC-FallbackGoogleIAM`) separate from `gcp_project_id` (used by `SC-LLMJudge` and Model Armor).
- Default operator precedence is **`Persona > Model > Gateway`** (`personas.<persona>.project_id` $>$ `models[].project_id` $>$ `gateway.project_id`), with optional advanced overrides for `models[].pin_project: true` and `exceptions[].project_id`. Default single-project bundles (`has_project_overrides=false`) short-circuit via `VarCache.getFallbackProperty` with `0` `MessageContext` reads.
- On `/ai-gateway` (`executeExtractVarsGemini`), validate `reqPathProj` and `cachedContent` *after* `body.get("model")` is extracted, memoizing `callerVertexProj` (`isAllowedPreResolveGeminiProject` + `buildIdentityRuleCandidates`), and honor `upstream_model` when rewriting `gemini_native_target_url`.

### 3.8 OpenAI vs. Vertex OpenAI-Compat `reasoning_tokens` Differential (`QUOTA-COST-12`)
- **Trap**: Direct OpenAI (`api.openai.com` — `o1`, `o3`, `gpt-5`, `gpt-6`) **includes** `completion_tokens_details.reasoning_tokens` inside `usage.completion_tokens` (`total_tokens == prompt_tokens + completion_tokens`), whereas **Vertex AI's OpenAI-compatible endpoint (`gemini-openai-compat`, `/endpoints/openapi/chat/completions`)** puts only visible candidate tokens in `completion_tokens` and puts `thoughtsTokenCount` separately in `reasoning_tokens` (`total_tokens == prompt_tokens + completion_tokens + reasoning_tokens`).
- **Invariant**: Always normalize via `normalizeOpenAiCompletionTokens` (`ResponseTranscoderAndCostCallout` / `FallbackAndErrorCallout`) and `normalizeOaiStreamOut` (`combine_resp.js`):
  - Short-circuit (`0` extra `MessageContext` reads of `upstream_total_tokens`) when `reasoning_tokens <= 0`.
  - Add `reasoning_tokens` to `completion_tokens` **only** when `total_tokens >= prompt_tokens + completion_tokens + reasoning_tokens`, otherwise use `Math.max(completion_tokens, reasoning_tokens)` so Vertex OpenAI-compat thinking tokens are billed at output rates while Direct OpenAI is never double-billed.

### 3.9 Corporate IdP (Okta / Entra ID / Ping Identity) External Token Bridging
- `OA-ImportExternalToken` bridges verified external Bearer tokens (JWTs via `VJ-VerifyIdpJwt` or opaque reference tokens via OIDC `GET` `/userinfo` in `SC-VerifyIdpOpaqueToken`) onto Persona-scoped Apigee Developer App `client_id`s so `<LLMTokenQuota>` has an `APIProduct` in context while isolating budgets per `identity_user_id` and `identity_team`. Subsequent calls hit `OA-VerifyAccessToken` in `< 1 ms`.
- Always clamp `auth_token_ttl_ms` to `max(1000, min(configured_token_ttl_ms, upstreamRemainingMs))` so cached tokens never outlive the IdP's `exp`. Note that `SC-VerifyIdpOpaqueToken` uses the OIDC UserInfo `GET` (`Authorization: Bearer <token>`) contract (e.g., PingFederate `/idp/userinfo.openid`), not client-authenticated RFC 7662 `POST /introspect`.

### 3.10 2027 Frontier Reasoning & Parameter Normalization (`ROUTE-TRANSCODE-18`, `ROUTE-TRANSCODE-19`)
- **Gemini 4 & 3.5 (`gemini-4-*`, `gemini-3.5-flash-lite*`)**:
  - Gemini 4 models reject `thinkingBudget` (`400`); always normalize `thinkingBudget` / `reasoning_effort` / Claude `output_config.effort` into `generationConfig.thinkingConfig.thinkingLevel` and remove `thinkingBudget`.
  - `gemini-4-hydrogen*` supports `MINIMAL`..`XHIGH` (`supportsGeminiMinimalThinking`, `supportsGeminiXHighThinking`); `gemini-4-neon*` and `gemini-4-carbon*` clamp `MINIMAL` $\rightarrow$ `LOW` while supporting `XHIGH`; `gemini-4-argon*` clamps `MINIMAL` $\rightarrow$ `LOW` and `XHIGH`/`MAX` $\rightarrow$ `HIGH`.
  - Strip unsupported `frequencyPenalty` / `presencePenalty` on `gemini-3.5-flash-lite*`.
- **Anthropic Claude 5.5 & Opus 4.7 (`claude-*-5*`, `claude-opus-4-7*`)**:
  - Adaptive-only (`isClaudeAdaptiveOnlyModel`): convert `thinking.type: "enabled"` / `budget_tokens` into `thinking: {"type": "adaptive"}` + `output_config.effort` (and convert `type: "disabled"` on `claude-opus-5*` / `claude-fable-5*` / `claude-mythos*` into `adaptive` + `effort: "low"`), and strip non-`1.0` `temperature` and `top_p`.
  - `output_config.effort` supports `"xhigh"` and `"max"` on `claude-opus-5*`, `claude-sonnet-5*`, and `claude-opus-4-7*`; maps `"xhigh"` $\rightarrow$ `"max"` on `claude-opus-4-6*`; and clamps `"xhigh"`/`"max"` $\rightarrow$ `"high"` on `claude-haiku-5*` and `claude-sonnet-4*`.
- **OpenAI GPT-6, GPT-5 & o-Series (`gpt-6*`, `gpt-5*`, `o1*`, `o3*`, `o4*`)**:
  - Normalize `max_tokens` $\rightarrow$ `max_completion_tokens` and strip `temperature`/`top_p` whenever reasoning is active (`o1*`/`o3*`/`o4*` always; `gpt-5*`/`gpt-6*` when `reasoning_effort` is present and not `"none"`).

---

## 4. Safe Extension Playbook (Zero-Regression Checklist)

1. **Adding or Modifying Models, Quotas, or Pricing**:
   Keep all 4 layers in lockstep whenever schema keys in `values.yaml` evolve:
   - `templates/ai-gateway/_helpers.tmpl` (`config_properties`, `model_locations_properties`, `monetization_rates_properties`)
   - `RequestRouterAndTranscoderCallout.java`, `ResponseTranscoderAndCostCallout.java`, and `templates/ai-gateway/resources/jsc/combine_resp.js`
   - `scripts/sync-personas.sh` (ensuring any new catalog model or alias is registered in `llmOperationGroup.operationConfigs`)
   - `tests/unit/` + `callout/src/test/java/.../CalloutSecurityAndPerformanceTest.java` + `docs/template-guide/`
2. **Adding Gateway Logic Without Increasing Step Count**:
   - Prefer adding branches or actions inside the 4 existing `BaseCallout` classes (or `combine_resp.js` for SSE chunks) rather than introducing new XML policy files—this preserves the exact `57` default policies, keeps `<EventFlow>` within Apigee's 5-step ceiling (`PERF-SKILL-09`), and avoids per-step latency/metrics overhead.
   - Gate any new opt-in `values.yaml` capability to `false` (or empty) by default so existing configurations render identically and incur `0` extra `MessageContext` reads on the default hot path.

