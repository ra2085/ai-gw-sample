# Quotas, Budgets & Cost Control

Once you have organized your consumers into **AI Products**, you can layer on token allowances, department budgets, traffic limits, and cost tracking—without managing per-user rules by hand.

---

## 1. Choose Your Consumption Controls

Click any tab below to see how to configure that control declaratively in `values.yaml` (or via Apigee API Product attributes):

=== "1. Per-User & Per-Model Token Quotas"
    **What it does:** Sets a rolling token allowance (for example, `500,000 tokens per 4 hours`) for each individual user belonging to a **Persona / AI Product**, plus optional model-specific caps for expensive frontier models.

    * **Standard Persona Quota:** Declared under `features.auth.personas.<name>.quota`. Every user mapped to that persona receives their own isolated rolling counter (`quota_client_id`).
    * **Per-Model Quota (`per_model`):** Want to cap expensive frontier models (such as `claude-sonnet-4-6` at `50,000 tokens / 4h`) while leaving fast models (`gemini-3.1-flash-lite`) uncapped up to the 500k allowance? Add `per_model` under the persona's `quota` block:

    ```yaml
    features:
      quotas:
        enabled: true
      auth:
        personas:
          developer:
            models: ["*"]                         # Expands to all concrete catalog models in llmOperationGroup
            quota:
              limit: 500000                       # 500k tokens per 4 hours per individual engineer
              interval: 4
              time_unit: "hour"
              per_model:
                claude-sonnet-4-6: 50000          # Max 50k tokens / 4h on Claude Sonnet 4.6
                gemini-3.1-pro-preview: 100000    # Max 100k tokens / 4h on Gemini 3.1 Pro
    ```

    *(Note: Both the proxy bundle's `config.properties` and `./scripts/sync-personas.sh`—which writes each concrete model's `llmTokenQuota` into the Apigee API Product's `llmOperationGroup.operationConfigs`—enforce these per-model caps automatically).*

=== "2. Shared Team Budgets & Dual Windows"
    **What it does:** Enforces a second rolling token window—either as a **7-day weekly cap per user** or as a **Shared Team Budget** across everyone in a department (such as `eng-ml`).

    1. Enable the secondary window and declare `team_budget` on the persona (or override a specific department under `exceptions`) in `values.yaml`:
       ```yaml
       features:
         quotas:
           enabled: true
           secondary_window:
             enabled: true
             allow_count: 10000000
             interval: 7
             time_unit: "day"
         auth:
           personas:
             developer:
               team_budget:
                 limit: 25000000      # 25M shared 7-day token pool per department
                 interval: 7
                 time_unit: "day"
           exceptions:
             # Optional: give a specific department (`team:ml-research`) a 100M 7-day pool
             - match: ["team:ml-research"]
               team_budget_limit: 100000000
       ```
    2. All users in a department (`dc_identity_team`) draw from that department's shared pool while also respecting their individual 4-hour primary quota.

=== "3. Temporary Individual & Team Exceptions"
    **What it does:** Grants a specific engineer, Service Account, SPIFFE agent, or department a temporary token boost (for example, `5,000,000 tokens` until Friday at 5:00 PM UTC) or unlocks specific models, and **automatically expires** back to their standard persona tier when `expires_at` passes.

    Declare the exception directly in `values.yaml` under `features.auth.exceptions`:
    ```yaml
    features:
      auth:
        exceptions:
          - match: ["alice@corp.example.com"]
            quota_limit: 5000000                  # 5M token allowance
            expires_at: "2026-12-31T17:00:00Z"    # Auto-expires in memory at this UTC timestamp
            models: ["*"]                         # Unlocks all catalog models while active
    ```

    * **Zero Manual Cleanup:** While the exception is active, the user gets the elevated limit and is **not blocked** if their team's shared pool is exhausted (`is_quota_exception_active = "true"`). Once `expires_at` passes, the gateway automatically reverts them to their standard persona quota on the very next request.
    * *(Alternatively, you can set custom attributes `quota_override` and `quota_override_expires_at` on a Developer or Developer App in Apigee).*

=== "4. Burst & Stream Concurrency Limits"
    **What it does:** Protects backend capacity from sudden request spikes (`burst`) or runaway clients opening dozens of simultaneous streaming connections (`concurrency`). Both are opt-in globally in `values.yaml` and can be customized per persona or exception:

    ```yaml
    features:
      rate_limits:
        burst:
          enabled: true
          rate: "600pm"        # Global fallback: 600 requests/minute per user
        concurrency:
          enabled: true
          limit: 20            # Global fallback: 20 simultaneous open SSE streams per user
          ttl_minutes: 1       # Auto-releases slot after 1 min if a client disconnects mid-stream
      auth:
        personas:
          agent:
            rate_limits:
              burst: "1200pm"  # Higher spike limit for autonomous agents
              concurrency: 50
    ```

---

## 2. Invoice-Accurate Cost Attribution

Modern LLMs bill differently for **standard input tokens**, **cached prompt reads**, **cache creation writes**, and **internal reasoning/thinking tokens**.

When `features.monetization.enabled: true` is set, the gateway performs **Invoice-Accurate Cost Attribution** on every request (both non-streaming and streaming) using the exact rates declared on each model in `values.yaml`—with no hardcoded provider multipliers:

```yaml
models:
  - name: "claude-sonnet-4-6"
    publisher: "anthropic"
    format: "anthropic"
    region: "global"              # Global base pricing (use 1.1x rates for regional endpoints like "us-east5")
    pricing:
      input_rate: 3.000           # $3.00 per 1M uncached input tokens ($3.30 regional)
      output_rate: 15.000         # $15.00 per 1M output & reasoning tokens ($16.50 regional)
      cache_read_rate: 0.300      # $0.30 per 1M cached prompt read tokens (0.10x)
      cache_write_rate: 3.750     # $3.75 per 1M 5-minute cache write tokens (1.25x)
      markup: 1.0                 # Optional markup multiplier
```

| Model Family / Provider | `input_rate` & `output_rate` | `cache_read_rate` | `cache_write_rate` | Why |
| :--- | :---: | :---: | :---: | :--- |
| **Google Gemini (`3.x`)** | Required | **Recommended** *(0.10x of `input_rate`)* | Not needed | Gemini bills cached prompt hits at `cache_read_rate`; cache storage is billed by Vertex AI per hour out-of-band rather than per-request write tokens. |
| **Anthropic Claude (`4.5` / `4.6`)** | Required | **Recommended** *(0.10x of `input_rate`)* | **Recommended** *(1.25x of `input_rate`)* | Claude returns both `cache_read_input_tokens` and `cache_creation_input_tokens` on every response. |
| **OpenAI (`gpt-5.4`, `gpt-5.4-mini`)** | Required | **Recommended** *(0.10x of `input_rate`)* | Not needed | OpenAI automatic prompt caching bills `cached_tokens` at `cache_read_rate` with no cache write surcharge. |
| **Vertex MaaS (Llama, Mistral), Embeddings, & Self-Hosted (`vLLM`)** | Required | Not needed | Not needed | These endpoints do not bill separate cached token rates; if omitted, any reported cached tokens default to `input_rate`. |

* **Chargeback & Showback Analytics:** Every transaction records its exact USD cost (`dc_tx_cost_usd`), token breakdown, model (`dc_model`), persona (`dc_identity_persona`), team (`dc_identity_team`), and user (`dc_identity_user_id`) in Apigee Analytics.
* **Prepaid Balance Enforcement:** Accounts with depleted prepaid balances are automatically blocked before calling the upstream model provider.

