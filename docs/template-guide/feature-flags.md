# 🎛 Feature Toggles & Modular Policies

The AI Gateway is designed with a **zero-overhead architecture**. When a feature is disabled in `values.yaml`, `apigee-go-gen` completely strips the corresponding XML policies and flow steps during bundle compilation.

---

## Quick Decision Matrix: Which Features Should You Enable?

| Feature Toggle | Default | Latency Impact | When to Enable | When to Disable |
| :--- | :---: | :---: | :--- | :--- |
| **`features.auth`** | `true` | `< 1ms` *(cached)* | **Always in production.** Enforces Zero-Passthrough Auth across API Keys, Apigee OAuth, GCP Agent Identity, and Enterprise IdP tokens. | Only in isolated sandbox environments behind an internal VPC perimeter. |
| **`features.quotas.enabled`** | `true` | `< 1ms` *(async)* | Whenever you want rolling-window token limits (e.g., 4-hour developer window) or per-model LLM quotas. | Unlimited internal benchmarking or load testing. |
| **`features.quotas.secondary_window`** | `false` | `< 1ms` *(async)* | When you need **Shared Team Budgets** (`team_quota_limit`) or a **2nd Rolling Window** (e.g., 4-hour burst + 7-day weekly cap). | When a single rolling window per API Product is sufficient. |
| **`features.rate_limits.burst`** | `false` | `< 1ms` | To smooth sudden request-per-second spikes (`SpikeArrest`) from runaway loops or agent swarms. | When token quotas alone are sufficient. |
| **`features.rate_limits.concurrency`** | `false` | `~2–5ms` *(sync)* | To cap simultaneous open SSE streams per developer/agent (`Q-ConcurrencyLimit` + `RQ-ReleaseConcurrencySlot`). | When you want zero synchronous distributed cache overhead on ingress. |
| **`features.monetization`** | `true` | `< 1ms` | For real-time USD cost calculation (including cache read/write & reasoning tokens) and prepaid wallet enforcement. | If you only care about raw token counts and not USD cost attribution. |
| **`features.model_armor`** | `true` | `~30–80ms` | When prompts or completions may contain PII, secrets, or prompt injection attempts. | Trusted internal code-generation pipelines where minimum latency is paramount. |
| **`features.llm_judge`** | `true` | `0ms` *(unless `auto:judge` requested)* | When clients use `"model": "auto:judge"` for automatic complexity-based model routing. | When clients always specify explicit model names or cost tiers. |

---

## Available Feature Toggles

### 1. Token Monetization (`features.monetization`)
* **Enabled:** Injects `MLC-EnforceMonetizationLimits` in PreFlow to check prepaid credit, `JS-calculate-monetization-cost` in PostFlow/EventFlow (with cache-read, cache-write, and thinking token rating), and `AM-SetMonetizationHeaders`.
* **Disabled:** Omits monetization checks and rating headers for non-commercial internal gateways.


```yaml
features:
  monetization:
    enabled: false
```

---

### 2. Enterprise Security (`features.model_armor`)
* **Enabled:** Injects `SUP-SanitizeUserPrompt` on prompt ingress and `SMR-SanitizeModelResponse` on stream/response egress.
* **Disabled:** Disables Model Armor calls for reduced latency in trusted private environments.

```yaml
features:
  model_armor:
    enabled: false
```

---

### 3. LLM as a Judge Classifier (`features.llm_judge`)
* **Enabled:** Attaches `SC-LLMJudge` and parsing scripts to support `auto:judge` dynamic model routing.
* **Disabled:** Bypasses judge classification callouts.

```yaml
features:
  llm_judge:
    enabled: false
```

---

### 4. Rolling-Window Token Quotas (`features.quotas`)
* **Enabled:** Evaluates native API Product token quotas via `LTQ-EnforceOnly` (`<UseQuotaConfigInAPIProduct>`) and accumulates counts via `LTQ-CountOnly`.
* **Secondary Rolling Window (`secondary_window.enabled`):** Optional opt-in policy pair (`LTQ-SecondaryEnforceOnly` and `LTQ-SecondaryCountOnly`) for customers requiring dual simultaneous rolling token windows (e.g., a 4-hour API Product burst window paired with a 7-day rolling window). Limits are dynamically resolved from API Product or Developer App custom attributes (`secondary_quota_limit`, `secondary_quota_interval`, `secondary_quota_unit`) with configurable fallback defaults.
* **Disabled:** Removes quota enforcement for unlimited throughput testing.

```yaml
features:
  quotas:
    enabled: true
    secondary_window:
      enabled: false # Set true to add a second rolling window (e.g. 7-day)
      allow_count: 1000000
      allow_ref: "verifyapikey.VA-ApiKey.apiproduct.secondary_quota_limit"
      interval: 7
      interval_ref: "verifyapikey.VA-ApiKey.apiproduct.secondary_quota_interval"
      time_unit: "day"
      time_unit_ref: "verifyapikey.VA-ApiKey.apiproduct.secondary_quota_unit"
```

---

### 5. Burst & Concurrency Rate Limits (`features.rate_limits`)
Both **Burst Rate Limiting** and **Concurrency Limiting** are **opt-in (`enabled: false` by default)** so the base proxy bundle incurs zero extra distributed cache overhead unless explicitly enabled. Note that `JS-format-rate-limit-error` and `AM-RateLimitError` remain active whenever `quotas` or `rate_limits` are enabled so that `429 Too Many Requests` responses include structured JSON (`reason: "burst_rate_limit_exceeded" | "concurrency_limit_exceeded" | "token_quota_exceeded"`) and `Retry-After` / `X-RateLimit-*` headers.

* **Burst Rate Limit (`features.rate_limits.burst`):**
  * **Enabled (`burst.enabled: true`):** Injects `SA-BurstRateLimit` (`SpikeArrest` with `<UseEffectiveCount>true</UseEffectiveCount>`) across all 4 ProxyEndpoints to smooth sudden request spikes per client identifier (`rate_limit_client_id`).
  * **Dynamic Overrides:** Reads `rate_limit_burst` at runtime from `X-Gateway-Burst-Rate` header -> Developer App / Developer / API Product custom attributes (`burst_rate` or `burst_rate_limit`) -> `config.properties` (`default_burst_rate`) -> policy fallback (`burst.rate`, default `"600pm"`).
* **Active Concurrency Limit (`features.rate_limits.concurrency`):**
  * **Enabled (`concurrency.enabled: true`):** Injects `Q-ConcurrencyLimit` and `RQ-ReleaseConcurrencySlot` to cap the maximum number of simultaneous in-flight LLM requests/streams per client (`rate_limit_client_id`).
  * **Dynamic Overrides:** Reads `rate_limit_concurrency` at runtime from `X-Gateway-Concurrency-Limit` header -> Developer App / Developer / API Product custom attributes (`concurrency_limit`) -> `config.properties` (`default_concurrency_limit`) -> policy fallback (`concurrency.limit`, default `20`).
  * **Why `Quota` + `ResetQuota` is used for Concurrency in Apigee X:**
    1. **Deprecation of `ConcurrentRateLimit`:** Legacy Apigee Edge had a `<ConcurrentRateLimit>` policy, which was deprecated and removed in Apigee X / hybrid (and fails Apigee X bundle validation).
    2. **Arrival Rate vs. In-Flight Concurrency:** `SpikeArrest` only regulates *how fast requests arrive* (requests/sec), whereas an LLM SSE stream (`text/event-stream`) can remain open for 30–120+ seconds while generating tokens.
    3. **Distributed Semaphore Pattern (`Acquire` / `Release`):** The only native Apigee X distributed counter that supports both **incrementing** and **decrementing** across runtime pods is pairing `<Quota type="rollingwindow">` (`Q-ConcurrencyLimit`, `<Distributed>true</Distributed>`, `<Synchronous>true</Synchronous>`) on request ingress (`+1` in-flight slot) with `<ResetQuota>` (`RQ-ReleaseConcurrencySlot`, `<Allow>1</Allow>`) on response completion (`-1` in-flight slot across non-streaming `PostFlow`, streaming `EventFlow` on `[DONE]`/`message_stop`/final `usageMetadata`, and `sanitize` `FaultRules`).
    4. **Dead-Man Switch TTL (`ttl_minutes`):** If a client abruptly disconnects (`Ctrl+C`) mid-stream before the terminal SSE chunk arrives, the `Quota` rolling window (`ttl_minutes: 1` by default) automatically expires the leaked slot after the window elapses so the client is never permanently locked out.
  * **Tradeoffs to Consider Before Enabling Concurrency:**
    * **Latency (~2–5ms):** Because `<Synchronous>true</Synchronous>` is required for accurate real-time concurrency counting across pods, each request performs a synchronous distributed cache read/write on ingress.
    * **TTL vs. Stream Duration:** Any single LLM stream that runs longer than `ttl_minutes` will have its slot auto-released when the rolling window expires, and if a client aborts mid-stream (`Ctrl+C`), that slot remains held until `ttl_minutes` elapses.

```yaml
features:
  rate_limits:
    burst:
      enabled: false             # Opt-in: set true to inject SA-BurstRateLimit
      rate: "600pm"              # Supports "<N>ps" (per second) or "<N>pm" (per minute)
      identifier_ref: "rate_limit_client_id"
      use_effective_count: true
    concurrency:
      enabled: false             # Opt-in: set true to inject Q-ConcurrencyLimit & RQ-ReleaseConcurrencySlot
      limit: 20                  # Max simultaneous in-flight requests/streams per client
      identifier_ref: "rate_limit_client_id"
      ttl_minutes: 1             # Dead-man switch auto-expiry (minutes) for abandoned client streams
```
