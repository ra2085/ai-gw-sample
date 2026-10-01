# Quotas, Budgets & Cost Control

Once you have organized your consumers into **AI Products**, you can layer on token allowances, department budgets, traffic limits, and cost tracking—without managing per-user rules by hand.

---

## 1. Choose Your Consumption Controls

Click any tab below to see how to configure that control on your **AI Products** or in `values.yaml`:

=== "1. Per-User & Per-Model Token Quotas"
    **What it does:** Sets a rolling token allowance (for example, `500,000 tokens per 4 hours`) for each individual user belonging to an **AI Product**.

    * **Standard AI Product Quota:** Set the LLM Token Quota directly on the Apigee API Product. Every user mapped to that product receives their own isolated rolling counter.
    * **Per-Model Quota:** Want to cap expensive frontier models (such as `claude-opus-4-6` or `gpt-5.4` at `50,000 tokens / 4h`) while leaving fast models (`gemini-2.5-flash-lite`) unlimited? Add a model-specific **LLM Operation Quota** on the API Product. Unquoted models automatically run without throttling.

    ```yaml
    features:
      quotas:
        enabled: true
    ```

=== "2. Shared Team Budgets & Dual Windows"
    **What it does:** Enforces a second rolling token window—either as a **7-day weekly cap per user** or as a **Shared Team Budget** across everyone in a department (such as `eng-ml`).

    1. Enable the secondary window in `values.yaml`:
       ```yaml
       features:
         quotas:
           enabled: true
           secondary_window:
             enabled: true
             allow_count: 10000000
             interval: 7
             time_unit: "day"
       ```
    2. **To pool tokens across a department/team:** Add custom attributes `team_quota_limit` (e.g., `10000000`), `team_quota_interval` (`7`), and `team_quota_unit` (`day`) on the AI Product or Developer App. All users in that department will draw from the shared team pool while also respecting their individual 4-hour primary quota.

=== "3. Temporary Individual Exceptions"
    **What it does:** Grants a specific engineer or application a temporary token boost (for example, `5,000,000 tokens` until Friday at 5:00 PM UTC) that **automatically expires** and reverts to their standard AI Product tier.

    Set two custom attributes on the Developer or Developer App:
    * `quota_override`: `"5000000"`
    * `quota_override_expires_at`: `"2026-12-31T17:00:00Z"`

    While the exception is active, the user gets the elevated limit and is not blocked if their team's shared pool is exhausted. Once the timestamp passes, the gateway automatically reverts them to their standard AI Product quota—no manual cleanup required.

=== "4. Burst & Stream Concurrency Limits"
    **What it does:** Protects backend capacity from sudden request spikes (`burst`) or runaway clients opening dozens of simultaneous streaming connections (`concurrency`). Both are opt-in in `values.yaml`:

    ```yaml
    features:
      rate_limits:
        burst:
          enabled: true
          rate: "600pm"        # Smooths request arrival spikes (e.g. 600 requests/minute per user)
        concurrency:
          enabled: true
          limit: 20            # Max simultaneous open SSE streams per user
          ttl_minutes: 1       # Auto-releases slot after 1 min if a client disconnects mid-stream
    ```

    You can also override these per **AI Product** using custom attributes `burst_rate` (e.g. `"1200pm"`) and `concurrency_limit` (e.g. `"50"`).

---

## 2. Invoice-Accurate Cost Attribution

Modern LLMs bill differently for **standard input tokens**, **cached prompt reads**, **cache creation writes**, and **internal reasoning/thinking tokens**.

When `features.monetization.enabled: true` is set, the gateway automatically performs **Invoice-Accurate Cost Attribution** on every request (both non-streaming and streaming) using the rates defined on each model in `values.yaml`:

```yaml
models:
  - name: "claude-sonnet-4-5"
    publisher: "anthropic"
    format: "anthropic"
    region: "us-east5"
    pricing:
      input_rate: 3.000           # USD per 1M uncached input tokens
      output_rate: 15.000         # USD per 1M output & reasoning tokens
      cache_read_rate: 0.300      # USD per 1M cached prompt read tokens (0.10x)
      cache_write_rate: 3.750     # USD per 1M cache creation tokens (1.25x)
      markup: 1.0                 # Optional markup multiplier
```

* **Chargeback & Showback Analytics:** Every transaction records its exact USD cost (`dc_tx_cost_usd`), token breakdown, model (`dc_model`), persona (`dc_identity_persona`), team (`dc_identity_team`), and user (`dc_identity_user_id`) in Apigee Analytics.
* **Prepaid Balance Enforcement:** Accounts with depleted prepaid balances are automatically blocked before calling the upstream model provider.

