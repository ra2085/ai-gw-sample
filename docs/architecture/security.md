# AI Products, Tenancy & Authentication

To govern AI usage across an organization—whether for 50 developers or 10,000 employees and autonomous agents—the gateway organizes access, model availability, and token budgets around **AI Products** (configured as Apigee API Products).

---

## 1. The AI Product Strategy

Instead of configuring settings for one user at a time, you define a small set of **AI Products** that represent how different personas or teams consume AI across your organization:

| AI Product Example | Target Persona / Tenant | Allowed Models | Default Guardrails |
| :--- | :--- | :--- | :--- |
| **`lead-ai-engineer`** | Principal Engineers & AI Researchers | All Frontier Models (`claude-opus-4-6`, `gemini-3.1-pro-preview`, `gpt-5.4`) | **2M tokens / 4h** per user |
| **`power-developer`** | Software Engineering Teams (`Claude Code`, `Codex`) | Coding & Reasoning Models (`claude-sonnet-4-6`, `gemini-3.1-pro-preview`) | **500k tokens / 4h** per user |
| **`developer-default`** | Knowledge Workers & Internal Portals | Fast, Cost-Efficient Models (`gemini-3.5-flash`, `claude-haiku-4-5`) | **100k tokens / 4h** per user |
| **`autonomous-agent`** | Cloud Run / Vertex AI Production Agents | Scoped Task Models (`gemini-3.1-flash-lite`, `text-embedding-005`) | **Dedicated service quota** & burst limit |

### How AI Products Simplify Operations
* **Define Once, Apply Everywhere:** Model access, token limits, and department budgets are configured once on the **AI Product**.
* **Automatic Per-User Isolation:** When 1,000 engineers use the `power-developer` AI Product, each engineer automatically receives their own isolated **500k token / 4h** allowance and individual usage tracking—without creating per-user configurations in Apigee.
* **Multi-Tenant Department Isolation:** You can attach department-specific attributes to an AI Product or Developer App—such as a shared **Team Token Budget** (`team_quota_limit`) or a department's own **OpenAI API Key & Billing Project** (`openai_api_key`, `openai_project_id`).

---

## 2. Connecting Callers to AI Products

Every incoming request is authenticated at the gateway perimeter and resolved to an **AI Product**. Select your caller type below to see how it connects:

=== "Corporate SSO (Okta / Entra ID / Ping)"
    **Best for:** Human engineers and employees using CLI tools (`Claude Code`, `Codex`) or internal web apps with their corporate login.

    The gateway verifies your corporate Identity Provider's **JWT** (via JWKS) or **Opaque Token** (via RFC 7662 introspection) and maps the user's IdP group claim (such as `groups`) directly to the corresponding **AI Product**:

    ```yaml
    features:
      auth:
        enabled: true
        # Configure JWT verification, Opaque introspection, or both:
        idp_jwt:
          enabled: true
          jwks_uri: "https://login.corp.example.com/oauth2/v1/keys"
          issuer: "https://login.corp.example.com"
        idp_opaque:
          enabled: false
          introspection_url: "https://idp.corp.example.com/oauth2/introspect"
        # Map IdP groups to AI Products:
        personas:
          claim_name: "groups"
          default_persona: "developer-default"
          mappings:
            "ai-gateway-leads": "lead-ai-engineer:KEY_FOR_LEAD_PRODUCT"
            "ai-gateway-devs": "power-developer:KEY_FOR_DEV_PRODUCT"
            "default": "developer-default:KEY_FOR_DEFAULT_PRODUCT"
    ```

    * **Zero-Latency Repeat Calls:** After the first request, the validated SSO token and its resolved AI Product are cached in Apigee's token store for the remaining lifetime of the token, so subsequent requests authenticate in **`< 1ms`**.
    * **Moving Users Between Tiers:** Promoting a user from `developer-default` to `power-developer` is a simple group update in your corporate IdP—no gateway changes required.

=== "API Keys (CLIs & Direct Apps)"
    **Best for:** Rapid onboarding, developer CLI tools (`Claude Code`, `Codex`), and service-to-service integrations.

    Create a Developer App in Apigee, associate it with an **AI Product**, and pass the key using either `x-apikey` or `x-api-key` (used by Anthropic and OpenAI CLIs):

    ```yaml
    features:
      auth:
        enabled: true
        type: "apikey"
        allow_x_api_key_alias: true   # Accepts both x-apikey and x-api-key headers
    ```

    ```bash
    curl -X POST "https://$APIGEE_HOSTNAME/v1/messages" \
      -H "x-api-key: $API_KEY" \
      -H "Content-Type: application/json" \
      -d '{"model": "gemini-3.5-flash", "max_tokens": 256, "messages": [{"role": "user", "content": "Hello"}]}'
    ```

=== "Google Cloud Agents (Agent Identity, Service Accounts)"
    **Best for:** Autonomous agents and microservices running on Vertex AI Agent Engine, Cloud Run, or GKE using Google Cloud Agent Identity or Service Accounts.

    Workloads present their standard Google Cloud access token (`Authorization: Bearer ya29...`). The gateway verifies the token with Google Cloud IAM, caches it for `< 1ms` repeat lookups, and maps the agent identity or service account to your **Agent AI Product**:

    ```yaml
    features:
      auth:
        enabled: true
        agent_identity:
          enabled: true
          cache_ttl_seconds: 300
    ```

    ```bash
    curl -X POST "https://$APIGEE_HOSTNAME/v1/chat/completions" \
      -H "Authorization: Bearer $(gcloud auth print-access-token)" \
      -H "Content-Type: application/json" \
      -d '{"model": "gemini-3.5-flash", "messages": [{"role": "user", "content": "Summarize status."}]}'
    ```

=== "Apigee OAuth 2.0"
    **Best for:** Applications that already obtain OAuth 2.0 `Bearer` tokens directly from Apigee.

    ```yaml
    features:
      auth:
        enabled: true
        oauth:
          enabled: true
    ```

    Apigee validates the `Authorization: Bearer <token>` header natively and applies the quotas and settings of the associated **AI Product**.
