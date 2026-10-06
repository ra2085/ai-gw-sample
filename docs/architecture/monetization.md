# Quotas, Budgets & Cost Control

Once you have organized your consumers into **AI Products**, you can layer on token allowances, department budgets, traffic limits, and cost tracking—without managing per-user rules by hand.

---

## 1. Choose Your Consumption Controls

Click any tab below to see how to configure that control declaratively in `values.yaml` (or via Apigee API Product attributes):

=== "1. Per-User & Per-Model Quotas (Tokens or USD)"
    **What it does:** Sets a rolling allowance—either in **Tokens (`limit`)** or in **USD (`limit_usd`)** via a **Virtual USD Spend Wallet**—for each individual user belonging to a **Persona / AI Product**, plus optional model-specific caps for expensive frontier models.

    * **Token Mode (`limit` / `per_model`):** Counts raw tokens against `LTQ-EnforceOnly` / `LTQ-CountOnly`.
    * **Virtual USD Spend Wallet Mode (`limit_usd` / `per_model_usd`):** Converts USD budgets into integer **micro-dollars** (`$1.00 = 1,000,000` micro-USD) and deducts the exact invoice-accurate cost (`tx_cost_micro_usd`, accounting for input, output, cached reads, cache writes, and thinking tokens) from each user's isolated rolling counter—**without onboarding individual users as Apigee Developer entities!**

    ```yaml
    features:
      monetization:
        enabled: true
        enforce_apigee_wallet: false              # Use Virtual USD Spend Wallets instead of Apigee Developer billing wallets
      quotas:
        enabled: true
      auth:
        personas:
          developer:
            models: ["*"]                         # Expands to all concrete catalog models in llmOperationGroup
            quota:
              # Option A: Token Quota (limit / per_model)
              # limit: 500000
              # per_model:
              #   claude-sonnet-4-6: 50000
              #
              # Option B: Virtual USD Spend Wallet (limit_usd / per_model_usd)
              limit_usd: 15.00                    # $15.00 USD per day per individual engineer (15,000,000 micro-USD)
              interval: 1
              time_unit: "day"
              per_model_usd:
                claude-sonnet-4-6: 5.00           # Max $5.00 USD / day on Claude Sonnet 4.6
    ```

    *(Note: Both the proxy bundle's `config.properties` and `./scripts/sync-personas.sh`—which writes each concrete model's `llmTokenQuota` into the Apigee API Product's `llmOperationGroup.operationConfigs`—enforce these token or micro-USD caps automatically, and `x-quota-mode: usd` / `tokens` is returned on every response).*

=== "2. Shared Team Budgets & Dual Windows (Tokens or USD)"
    **What it does:** Enforces a second rolling window (`LTQ-SecondaryEnforceOnly` / `LTQ-SecondaryCountOnly`)—either as a **7-day weekly cap per user** or as a **Shared Team Budget** across everyone in a department (such as `eng-ml`). You can even mix modes (for example, a **4-hour Token Quota per user** + a **30-day Shared USD Spend Budget per team**)!

    1. Enable the secondary window and declare `team_budget` (`limit` or `limit_usd`) on the persona (or override a specific department under `exceptions`) in `values.yaml`:
       ```yaml
       features:
         quotas:
           enabled: true
           secondary_window:
             enabled: true
             shared_name: "llm-token-counter-secondary"
             identifier_ref: "secondary_quota_identifier"
             allow_count: 10000000
             # allow_usd: 250.00                  # Optional global fallback in USD
             interval: 7
             time_unit: "day"
         auth:
           personas:
             developer:
               team_budget:
                 limit_usd: 250.00                # $250.00 USD shared 30-day pool per department (or use limit: 25000000 for tokens)
                 interval: 30
                 time_unit: "day"
           exceptions:
             # Optional: give a specific department (`team:ml-research`) a $1,000.00 30-day pool (or team_budget_limit for tokens)
             - match: ["team:ml-research"]
               team_budget_limit_usd: 1000.00
       ```
    2. All users in a department (`dc_identity_team`) draw from that department's cross-model shared pool (`SharedName: llm-token-counter-secondary`, `Identifier: secondary_quota_identifier`, `LLMModelSource: "{secondary_quota_scope}"`) while also respecting their individual per-model primary quota (`SharedName: llm-token-counter`, `Identifier: rate_limit_client_id`, `LLMModelSource: "{model}"`).

=== "3. Temporary Individual & Team Exceptions"
    **What it does:** Grants a specific engineer, Service Account, SPIFFE agent, or department a temporary allowance boost—either in tokens (`quota_limit` / `team_budget_limit`) or USD (`quota_limit_usd` / `team_budget_limit_usd`)—or unlocks specific models, and **automatically expires** back to their standard persona tier when `expires_at` passes.

    Declare the exception directly in `values.yaml` under `features.auth.exceptions`:
    ```yaml
    features:
      auth:
        exceptions:
          # 1. Individual Exception (raises personal cap; still draws from shared team pool by default)
          - match: ["alice@corp.example.com"]
            quota_limit_usd: 50.00                # $50.00 USD personal allowance (or quota_limit: 5000000 for tokens)
            # bypass_team_budget: true            # Optional emergency bypass: isolates Alice from an exhausted team pool
            expires_at: "2026-12-31T17:00:00Z"    # Auto-expires in memory at this UTC timestamp
            models: ["*"]                         # Unlocks all catalog models while active

          # 2. Team Exception (temporarily tops up a department's shared pool)
          - match: ["team:ml-research"]
            team_budget_limit_usd: 1000.00        # Or team_budget_limit: 100000000 for tokens
            expires_at: "2026-12-31T17:00:00Z"    # Automatically reverts to baseline team_budget after timestamp
    ```

    | Team Pool Status | Individual Status | User Status | What Happens Next? |
    | :--- | :--- | :--- | :--- |
    | 🟢 **Has Funds** | 🟢 **Has Funds** | **Standard** | **Request Approved.** Cost/tokens are deducted from both the individual's meter (`LTQ-EnforceOnly`) and the shared team pool (`LTQ-SecondaryEnforceOnly`). |
    | 🟢 **Has Funds** | 🔴 **Exhausted** | **Standard** | **Request Denied (429).** The user hits their personal limit; teammates can continue working. |
    | 🔴 **Exhausted** | 🟢 **Has Funds** | **Standard** | **Request Denied (429).** The master team valve locks down the entire department (`team:<identity_team>`), even for users with remaining personal allowance. |
    | 🟢 **Has Funds** | 🔴 **Exhausted** | **Has Individual Exception** | **Request Approved.** `quota_limit_usd` / `quota_limit` raises the user's personal cap while still deducting from the remaining shared team pool. |
    | 🔴 **Exhausted** | 🔴 **Exhausted** | **Has Individual Exception** | **Denied by default** (master team pool is empty). **Approved** if you either top up the department (`team_budget_limit_usd`) **or** set `bypass_team_budget: true` on the individual exception. |

    * *(Alternatively, you can set custom attributes `quota_override`, `quota_override_expires_at`, and `bypass_team_budget` on a Developer or Developer App in Apigee).*

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

* **Chargeback & Showback Analytics:** Every transaction records its exact USD cost (`dc_tx_cost_usd` and `X-Gateway-Total-Cost-Micro-USD`), token breakdown, model (`dc_model`), persona (`dc_identity_persona`), team (`dc_identity_team`), and user (`dc_identity_user_id`) in Apigee Analytics.
* **Two Wallet Enforcement Modes:**
  1. **Virtual USD Spend Wallets (`limit_usd` + `enforce_apigee_wallet: false`):** Recommended when onboarding users via SSO/JWT/SPIFFE onto shared Persona AI Products without creating an Apigee Developer entity per user. Enforces per-user, per-model, and shared team USD spend caps in micro-dollars (`$1.00 = 1,000,000` micro-USD) directly inside `LTQ-EnforceOnly` and `LTQ-SecondaryEnforceOnly`.
  2. **Native Apigee Monetization Wallets (`enforce_apigee_wallet: true`):** Uses `MLC-EnforceMonetizationLimits` to verify prepaid/postpaid balances on the Apigee Developer entity owning the Developer App.


