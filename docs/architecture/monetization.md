# Quotas, Budgets & Cost Control

Once you have organized your callers into **AI Products**, you can enforce personal allowances, shared department budgets, temporary exceptions, and traffic limits—using a single declarative block in `values.yaml`.

---

## 1. How It Works: The Two-Valve Model

Regardless of how a caller authenticates (**API Key**, **Native OAuth**, **Okta/Entra SSO**, **Google Cloud Agent Identity / SPIFFE**, or **IAM Service Account**), the gateway resolves the caller's **User/Agent ID**, **Persona**, and **Department/Team**, and passes every request through at most **two independent valves**:

<div class="arch-flow">
  <div class="arch-stage arch-stage--highlight">
    <div class="arch-stage-title">Two-Valve Budget Pipeline (Evaluated on Every Request)</div>
    <div class="arch-grid">
      <div class="arch-card">
        <div class="arch-card-title">1. Caller Identity</div>
        <div class="arch-card-sub">SSO User, API Key, OAuth Client, SPIFFE Agent, or Service Account</div>
      </div>
      <div class="arch-card">
        <div class="arch-card-title">2. Valve 1: Personal Allowance</div>
        <div class="arch-card-sub"><strong>Has Funds</strong> &rarr; Continue to Valve 2<br/><strong>Exhausted</strong> &rarr; <code>429 Personal Limit</code> (Teammates unaffected)</div>
      </div>
      <div class="arch-card">
        <div class="arch-card-title">3. Valve 2: Shared Team Pool</div>
        <div class="arch-card-sub"><strong>Has Funds</strong> &rarr; Route to Upstream LLM<br/><strong>Exhausted</strong> &rarr; <code>429 Team Budget</code> (Department paused)</div>
      </div>
    </div>
  </div>
</div>

* **Valve 1 — Personal Allowance (Always Active):** Gives each individual engineer or agent their own isolated rolling budget (in **Tokens** or **USD**), plus optional stricter caps on expensive frontier models (like `claude-opus-4-6`). One runaway script can never drain a teammate's personal quota.
* **Valve 2 — Shared Team Pool (Opt-In):** Caps total spend across an entire department (e.g., `eng-ml`, `sales`) across **all models combined**. You can even mix units (for example, a **4-hour Token limit per user** + a **30-day USD budget per team**).
* **Auto-Expiring Exceptions:** Temporarily boost an individual's allowance, top up a team's shared pool, or grant an emergency bypass (`bypass_team_budget: true`) until an `expires_at` timestamp—without creating separate API Products or remembering to roll changes back.

### Independent Units & Precedence at a Glance

**Valve 1 (Personal)** and **Valve 2 (Team Pool)** have **independent units (`Tokens` or `USD`) and independent time windows**. You can mix them freely, and an active **Exception** can even switch units for a specific user or team:

#### 1. Precedence Order (Highest to Lowest Priority)

| Valve | 1st Priority (Wins First) | 2nd Priority | 3rd Priority (Baseline) |
| :--- | :--- | :--- | :--- |
| **Valve 1: Personal Allowance** | **Active Individual Exception**<br>(`quota_limit_usd` or `quota_limit` until `expires_at`) | **Per-Model Cap**<br>(`per_model_usd` or `per_model` on the model) | **Persona Quota**<br>(`quota.limit_usd` or `quota.limit`) |
| **Valve 2: Shared Team Pool** | **Emergency Bypass** (`bypass_team_budget: true`)<br>*or* **Active Team Exception** (`team_budget_limit_usd` / `team_budget_limit`) | **Persona Team Budget**<br>(`team_budget.limit_usd` or `team_budget.limit`) | **Global Secondary Fallback**<br>(`secondary_window.allow_usd` / `allow_count`) |

#### 2. Supported Hybrid Combinations (Tokens and USD)

| Mode | Valve 1: Personal | Valve 2: Team Pool | Best For |
| :--- | :---: | :---: | :--- |
| **All-USD** | `USD` *(e.g. $15 / day)* | `USD` *(e.g. $250 / 30d)* | Strict financial chargeback at both the engineer and department level. |
| **All-Token** | `Tokens` *(e.g. 500k / 4h)* | `Tokens` *(e.g. 25M / 7d)* | Pure capacity and throughput pacing without pricing tables. |
| **Hybrid (Token Pacing + Team USD)** | `Tokens` *(e.g. 500k / 4h)* | `USD` *(e.g. $250 / 30d)* | Developers pace usage in tokens (`Claude Code`), while Finance caps monthly department spend in USD. |
| **Hybrid (Personal USD + Team Tokens)** | `USD` *(e.g. $15 / day)* | `Tokens` *(e.g. 50M / 7d)* | Cap individual dollar spend on frontier models while sharing a weekly token reservation across a team. |
| **Cross-Unit Exception** | *Overrides Valve 1 in `USD` or `Tokens`* | *Keeps Valve 2 unit* | Even on a Token-based persona, you can grant one user a temporary `$50.00 USD` exception (`quota_limit_usd: 50.00`), or vice versa. |

---

## 2. Copy-Paste Recipes

Click any tab below for the exact `values.yaml` snippet to copy into your configuration:

=== "Recipe 1: Personal Allowance (USD or Tokens)"
    **Goal:** Cap each individual developer's usage per day (plus a stricter cap on expensive frontier models like `claude-sonnet-4-6`), using either **USD (`limit_usd`)** or **Tokens (`limit`)**:

    ```yaml
    features:
      monetization:
        enabled: true
        enforce_apigee_wallet: false              # Use zero-admin Virtual USD Spend Wallets
      quotas:
        enabled: true
      auth:
        personas:
          # Option A: Virtual USD Spend Wallet ($15/day overall, max $5/day on Claude Sonnet 4.6)
          developer:
            models: ["*"]
            quota:
              limit_usd: 15.00
              interval: 1
              time_unit: "day"
              per_model_usd:
                claude-sonnet-4-6: 5.00

          # Option B: Raw Token Quota (500k tokens / 4 hours overall, max 50k on Claude Sonnet 4.6)
          knowledge-worker:
            models: ["gemini-3.5-flash", "claude-haiku-4-5", "claude-sonnet-4-6"]
            quota:
              limit: 500000
              interval: 4
              time_unit: "hour"
              per_model:
                claude-sonnet-4-6: 50000
    ```

=== "Recipe 2: Hybrid (Per-User Tokens + Team USD)"
    **Goal:** Combine **Tokens** and **USD** in the same persona—for example, give each engineer a **500,000 token / 4-hour** pacing limit (Valve 1) while enforcing a **$250.00 / 30-day** finance chargeback cap across their entire department (Valve 2):

    ```yaml
    features:
      monetization:
        enabled: true
        enforce_apigee_wallet: false
      quotas:
        enabled: true
        secondary_window:
          enabled: true                           # Turns on Valve 2 (Shared Team Pool)
      auth:
        personas:
          developer:
            models: ["*"]
            quota:                                # Valve 1 (Tokens): 500k tokens / 4h per engineer
              limit: 500000
              interval: 4
              time_unit: "hour"
              per_model:
                claude-sonnet-4-6: 50000          # Per-model token cap on frontier model
            team_budget:                          # Valve 2 (USD): $250.00 / 30d shared across the department
              limit_usd: 250.00
              interval: 30
              time_unit: "day"
    ```

=== "Recipe 3: All-USD Team Pool + Personal Cap"
    **Goal:** Manage both valves in **USD**—give each department a shared **250.00 USD / 30-day** pool across all models (or `limit: 25000000` for an all-token pool), while keeping a **15.00 USD / day** personal limit per engineer so one user cannot drain the team's monthly budget in an afternoon:

    ```yaml
    features:
      monetization:
        enabled: true
        enforce_apigee_wallet: false
      quotas:
        enabled: true
        secondary_window:
          enabled: true                           # Turns on Valve 2 (Shared Team Pool)
      auth:
        personas:
          developer:
            models: ["*"]
            quota:                                # Valve 1 (USD): $15.00 / day per engineer
              limit_usd: 15.00
              interval: 1
              time_unit: "day"
            team_budget:                          # Valve 2 (USD): $250.00 / 30d shared by department
              limit_usd: 250.00
              interval: 30
              time_unit: "day"
    ```

=== "Recipe 4: Temporary Exceptions & Emergency Bypass"
    **Goal:** Grant time-bound boosts in **USD (`*_usd`)** or **Tokens (`quota_limit` / `team_budget_limit`)**—with automatic expiration (`expires_at`) so temporary boosts never become permanent leaks:

    ```yaml
    features:
      auth:
        exceptions:
          # Case A: Personal Boost in USD or Tokens (still draws from the user's shared team pool)
          - match: ["alice@corp.example.com"]
            quota_limit_usd: 50.00                # Or use quota_limit: 5000000 for a token boost
            expires_at: "2026-12-31T17:00:00Z"
            models: ["*"]

          # Case B: Emergency On-Call Bypass (Bob keeps working even if his team's pool is $0)
          - match: ["bob@corp.example.com"]
            quota_limit_usd: 100.00               # Or use quota_limit: 10000000 for tokens
            bypass_team_budget: true              # Isolates Bob from an exhausted team budget
            expires_at: "2026-12-31T17:00:00Z"

          # Case C: Department Top-Up (Raise team 'ml-research' shared pool until quarter-end)
          - match: ["team:ml-research"]
            team_budget_limit_usd: 1000.00        # Or use team_budget_limit: 100000000 for tokens
            expires_at: "2026-12-31T17:00:00Z"
    ```

    #### How Valve 1 (Individual), Valve 2 (Team Pool), and Exceptions Interact

    | Valve 2: Team Pool | Valve 1: Personal Cap | Caller Status | Outcome |
    | :--- | :--- | :--- | :--- |
    | **Has Funds** | **Has Funds** | **Standard** | **Approved (`200`).** Deducts from both the user's personal meter and their department's shared pool. |
    | **Has Funds** | **Exhausted** | **Standard** | **Blocked (`429`).** Only this user is rate-limited (`per_model_quota` / `token_quota_primary`); teammates keep working. |
    | **Exhausted** | **Has Funds** | **Standard** | **Blocked (`429`).** Department pool is empty (`team_budget_quota`); all standard users on that team are paused. |
    | **Has Funds** | **Exhausted** | **Individual Exception** | **Approved (`200`).** Exception raises the user's personal cap while still deducting from the remaining team pool. |
    | **Exhausted** | *Any* | **Individual Exception** | **Blocked (`429`) by default** (team pool is empty). **Approved (`200`)** if you top up the team (`Case C`) **or** set `bypass_team_budget: true` (`Case B`). |

=== "Recipe 5: Burst & Stream Concurrency Limits"
    **Goal:** Protect upstream LLM capacity from sudden request spikes (`burst`) or runaway loops opening dozens of simultaneous SSE streams (`concurrency`):

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

## 3. Invoice-Accurate Cost Attribution

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
  1. **Virtual USD Spend Wallets (`limit_usd` + `enforce_apigee_wallet: false`):** Recommended when onboarding users via SSO/JWT/SPIFFE onto shared Persona AI Products without creating an Apigee Developer entity per user. Enforces per-user, per-model, and shared team USD spend caps in micro-dollars (`$1.00 = 1,000,000` micro-USD).
  2. **Native Apigee Monetization Wallets (`enforce_apigee_wallet: true`):** Uses `MLC-EnforceMonetizationLimits` to verify prepaid/postpaid balances on the Apigee Developer entity owning the Developer App.
