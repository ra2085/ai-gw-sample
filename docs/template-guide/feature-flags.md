# Feature Toggles

Every capability in `values.yaml` under `features:` is modular. When a feature is set to `enabled: false`, it is completely omitted from the compiled gateway bundle.

---

## Summary of Feature Toggles

| Feature Toggle | Default | Purpose | Guide |
| :--- | :---: | :--- | :--- |
| **`features.auth.enabled`** | `true` | Authenticates callers (API Keys, Corporate SSO, GCP Agents, OAuth) and maps them to **AI Products**. | [AI Products & Auth](../architecture/security.md) |
| **`features.auth.apigee_oauth.enabled`** | `true` | Enables native Apigee OAuth 2.0 bearer token verification (`OA-VerifyAccessToken`). | [AI Products & Auth](../architecture/security.md) |
| **`features.quotas.enabled`** | `true` | Enforces rolling token or Virtual USD Spend Wallet allowances defined on your **AI Products**. | [Quotas & Budgets](../architecture/monetization.md) |
| **`features.quotas.synchronous`** | `true` | Controls cross-pod CPS sync on primary individual quotas (`true` for immediate cross-pod accuracy; `false` for async L1 batching via `QuotaAsyncBatchUpdater`). | [Quotas & Budgets](../architecture/monetization.md) |
| **`features.quotas.preflight_prompt_guard`** | `false` | Opt-in: rejects requests in `PreFlow` (`429`) when conservative lower-bound prompt usage exceeds remaining quota (`available.count`). | [Quotas & Budgets](../architecture/monetization.md) |
| **`features.quotas.stream_prompt_checkpoint`** | `false` | Opt-in: immediately checkpoints exact initial prompt tokens and spend when an SSE stream starts, ensuring early client disconnects still account for prompt usage. | [Quotas & Budgets](../architecture/monetization.md) |
| **`features.quotas.secondary_window.enabled`** | `false` | Adds a second rolling window for **Shared Team Budgets** or 7-day weekly caps (`secondary_window.synchronous` defaults to `true` for shared pools). | [Quotas & Budgets](../architecture/monetization.md) |
| **`features.rate_limits.burst.enabled`** | `false` | Smooths sudden request-per-second/minute spikes per user or agent. | [Quotas & Budgets](../architecture/monetization.md) |
| **`features.rate_limits.prompt_tokens.enabled`** | `false` | Opt-in: throttles incoming prompt-token velocity (`<N>ps` or `<N>pm`) via Apigee `<PromptTokenLimit>` (`PTL-PromptTokenLimit`). | [Quotas & Budgets](../architecture/monetization.md) |
| **`features.rate_limits.concurrency.enabled`** | `false` | Caps the maximum number of simultaneous open streaming connections per caller. | [Quotas & Budgets](../architecture/monetization.md) |
| **`features.monetization.enabled`** | `true` | Enables **Invoice-Accurate Cost Attribution** (including cached & reasoning tokens) and cost telemetry headers. | [Quotas & Cost Control](../architecture/monetization.md) |
| **`features.monetization.enforce_apigee_wallet`** | `false` | Opt-in: enforces native Apigee Monetization Add-on developer billing wallets (`MLC-EnforceMonetizationLimits`). | [Quotas & Cost Control](../architecture/monetization.md) |
| **`features.llm_judge.enabled`** | `true` | Enables `"model": "auto:judge"` complexity-based and task-based model selection. | [Smart Routing & Safety](../architecture/routing.md) |
| **`features.circuit_breaker.enabled`** | `true` | Enables automatic upstream failover (`429`/`5xx`) and a rolling-window Circuit Breaker (`LTQ-CircuitBreakerCount` + `LTQ-CircuitBreakerCheck`). | [Smart Routing & Safety](../architecture/routing.md) |
| **`features.streaming.dedicated_sse_targets`** | `false` | Opt-in (Apigee Known Issue `#449012244`): renders dedicated `*-sse` `TargetEndpoint`s (`stream = true` `RouteRule`s) separated from non-SSE `PostFlow` targets. | [Smart Routing & Safety](../architecture/routing.md) |
| **`features.security.sanitize_upstream_errors`** | `false` | Opt-in: scrubs GCP project IDs/numbers, SA emails, quota IDs, and internal URLs from unrecovered upstream `4xx`/`5xx` error strings and normalizes non-JSON/cross-protocol errors while preserving SDK error schemas. | [AI Products & Auth](../architecture/security.md) |
| **`features.model_armor.enabled`** | `false` | Opt-in: screens prompts and responses for PII, secrets, and prompt injection via regional GCP Model Armor templates. | [Smart Routing & Safety](../architecture/routing.md) |

---

## Minimal vs. Full Enterprise Feature Configuration

=== "Minimal (Default Quickstart)"
    If you omit the `features:` block in `values.yaml`, sensible defaults (`auth`, `quotas`, `monetization` cost attribution, `llm_judge`, and `circuit_breaker`) are enabled automatically while external add-ons (`model_armor` and `enforce_apigee_wallet`) stay disabled until provisioned. To disable cost calculation or the LLM Judge explicitly:

    ```yaml
    features:
      monetization:
        enabled: false
      model_armor:
        enabled: false
      llm_judge:
        enabled: false
      quotas:
        enabled: true
      auth:
        enabled: true
    ```

=== "Full Enterprise Governance"
    Enables Corporate SSO Persona mapping, Shared Team Budgets, Burst & Concurrency protection, Invoice-Accurate Cost Attribution, Fallback Chains with Rolling-Window Circuit Breaker, and regional Model Armor:

    ```yaml
    features:
      auth:
        enabled: true
        allow_bearer_api_key: true
        apigee_oauth:
          enabled: true
        agent_identity:
          enabled: true
          allowed_trust_domain: "agents.global.org-123456789012.system.id.goog"
          allowed_email_suffix: "@your-gcp-project-id.iam.gserviceaccount.com"
        idp_jwt:
          enabled: true
          jwks_uri: "https://www.googleapis.com/oauth2/v3/certs"
          issuer: "https://accounts.google.com"
          audience: "api://ai-gateway"
          persona_claim: "groups"
        default_persona: "developer"
        personas:
          lead-ai-engineer:
            match_claims: ["ai-gateway-leads", "lead-*"]
            client_id: "DEMO_KEY_LEAD_PERSONA"
          power-developer:
            match_claims: ["ai-gateway-power-users", "swe-*"]
            client_id: "DEMO_KEY_POWER_PERSONA"
          developer:
            match_claims: ["developer", "engineering"]
            client_id: "DEMO_KEY_DEFAULT_PERSONA"

      quotas:
        enabled: true
        synchronous: true
        preflight_prompt_guard: true
        stream_prompt_checkpoint: true
        secondary_window:
          enabled: true
          synchronous: true
          shared_name: "llm-token-counter-secondary"
          identifier_ref: "secondary_quota_identifier"
          allow_count: 1000000
          interval: 7
          time_unit: "day"

      rate_limits:
        burst:
          enabled: true
          rate: "600pm"
        prompt_tokens:
          enabled: true
          rate: "100000pm"
        concurrency:
          enabled: true
          limit: 20
          ttl_minutes: 1

      monetization:
        enabled: true
        enforce_apigee_wallet: false
        default_currency: "USD"
        default_markup: 1.0

      model_armor:
        enabled: true
        project_id: "your-gcp-project-id"
        location: "us-central1"
        template: "standard-safety-template"
        request_template: "standard-request-template"
        response_template: "standard-response-template"
        allow_claim_bypass: false
        identity_rules:
          - match: ["finance-*@*.iam.gserviceaccount.com", "team:pci-compliance"]
            request_template: "strict-pci-dlp-template"
            response_template: "strict-pci-dlp-template"

      llm_judge:
        enabled: true
        classifier_model: "gemini-3.1-flash-lite"

      circuit_breaker:
        enabled: true
        error_threshold: 3
        window_interval: 1
        window_unit: "minute"
    ```


