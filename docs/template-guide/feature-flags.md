# Feature Toggles

Every capability in `values.yaml` under `features:` is modular. When a feature is set to `enabled: false`, it is completely omitted from the compiled gateway bundle.

---

## Summary of Feature Toggles

| Feature Toggle | Default | Purpose | Guide |
| :--- | :---: | :--- | :--- |
| **`features.auth.enabled`** | `true` | Authenticates callers (API Keys, Corporate SSO, GCP Agents, OAuth) and maps them to **AI Products**. | [AI Products & Auth](../architecture/security.md) |
| **`features.quotas.enabled`** | `true` | Enforces rolling token allowances and per-model limits defined on your **AI Products**. | [Quotas & Budgets](../architecture/monetization.md) |
| **`features.quotas.secondary_window.enabled`** | `false` | Adds a second rolling window for **Shared Team Budgets** or 7-day weekly caps. | [Quotas & Budgets](../architecture/monetization.md) |
| **`features.rate_limits.burst.enabled`** | `false` | Smooths sudden request-per-second/minute spikes per user or agent. | [Quotas & Budgets](../architecture/monetization.md) |
| **`features.rate_limits.concurrency.enabled`** | `false` | Caps the maximum number of simultaneous open streaming connections per caller. | [Quotas & Budgets](../architecture/monetization.md) |
| **`features.monetization.enabled`** | `true` | Enables **Invoice-Accurate Cost Attribution** (including cached & reasoning tokens) and checks prepaid balances. | [Quotas & Cost Control](../architecture/monetization.md) |
| **`features.llm_judge.enabled`** | `true` | Enables `"model": "auto:judge"` complexity-based model selection. | [Smart Routing & Safety](../architecture/routing.md) |
| **`features.model_armor.enabled`** | `true` | Screens prompts and responses for PII, secrets, and prompt injection via GCP Model Armor. | [Smart Routing & Safety](../architecture/routing.md) |
| **`features.cors.enabled`** | `true` | Adds CORS headers and `OPTIONS` preflight support for browser-based applications. | [`values.yaml` Reference](configuration.md) |

---

## Minimal vs. Full Enterprise Feature Configuration

=== "Minimal (Default Quickstart)"
    If you omit the `features:` block in `values.yaml`, sensible defaults are applied automatically. To disable optional external dependencies (like Model Armor or Invoice-Accurate Cost Attribution) during initial testing:

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
    Enables Corporate SSO Persona mapping, Shared Team Budgets, Burst & Concurrency protection, Invoice-Accurate Cost Attribution, and Model Armor:

    ```yaml
    features:
      auth:
        enabled: true
        allow_x_api_key_alias: true
        oauth:
          enabled: true
        agent_identity:
          enabled: true
        idp_jwt:
          enabled: true
          jwks_uri: "https://www.googleapis.com/oauth2/v3/certs"
        personas:
          claim_name: "groups"
          default_persona: "developer-default"
          mappings:
            "ai-gateway-leads": "lead-ai-engineer:DEMO_KEY_LEAD_PERSONA"
            "ai-gateway-PowerUsers": "power-developer:DEMO_KEY_POWER_PERSONA"
            "default": "developer-default:DEMO_KEY_DEFAULT_PERSONA"

      quotas:
        enabled: true
        secondary_window:
          enabled: true
          allow_count: 1000000
          interval: 7
          time_unit: "day"

      rate_limits:
        burst:
          enabled: true
          rate: "600pm"
        concurrency:
          enabled: true
          limit: 20
          ttl_minutes: 1

      monetization:
        enabled: true
        default_currency: "USD"
        default_markup: 1.0

      model_armor:
        enabled: true
        project_id: "your-gcp-project-id"
        template_id: "filter"

      llm_judge:
        enabled: true
        classifier_model: "gemini-2.5-flash-lite"
    ```

