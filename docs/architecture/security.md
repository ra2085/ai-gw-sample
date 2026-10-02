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

    The gateway verifies your corporate Identity Provider's **JWT** (via JWKS) or **Opaque Token** (via `/userinfo` introspection) and maps the user's IdP role/group claim directly to the corresponding **AI Product** (`personas.<name>.client_id`):

    ```yaml
    features:
      auth:
        enabled: true
        # Configure JWT verification, Opaque introspection, or both:
        idp_jwt:
          enabled: true
          jwks_uri: "https://login.corp.example.com/oauth2/v1/keys"
          issuer: "https://login.corp.example.com"
          user_claim: "email"
          persona_claim: "groups"
          team_claim: "department"
        idp_opaque:
          enabled: false
          userinfo_url: "https://idp.corp.example.com/oauth2/v1/userinfo"
        # Map IdP role/group claims (supports exact strings & '*' glob wildcards) to AI Products:
        default_persona: "knowledge-worker"
        personas:
          developer:
            match_claims: ["engineering", "swe-*", "*-data-science"]
            client_id: "CONSUMER_KEY_FOR_DEVELOPER_AI_PRODUCT"
          knowledge-worker:
            match_claims: ["knowledge-worker", "general", "business-*"]
            client_id: "CONSUMER_KEY_FOR_DEFAULT_AI_PRODUCT"
    ```

    * **Flexible Claim & Glob Matching:** `match_claims` supports both exact strings and `*` glob wildcards (e.g., `swe-*`, `*-engineering`, `gcp-ai-*`). If a user belongs to multiple matching groups, the gateway automatically selects the most specific match.
    * **Zero-Latency Repeat Calls:** After the first request, the validated SSO token and its resolved AI Product are cached in Apigee's token store (`OA-ImportExternalToken`), so subsequent requests authenticate in **`< 1ms`**.
    * **Moving Users Between Tiers:** Promoting a user from `knowledge-worker` to `developer` is a simple group update in your corporate IdP—no gateway changes required.

=== "API Keys (CLIs & Direct Apps)"
    **Best for:** Rapid onboarding, developer CLI tools (`Claude Code`, `Codex`), and service-to-service integrations.

    Create a Developer App in Apigee, associate it with an **AI Product**, and pass the key using `x-apikey`, `x-api-key`, `anthropic-api-key`, `x-goog-api-key`, or `Authorization: Bearer <api-key>`:

    ```yaml
    features:
      auth:
        enabled: true
        allow_bearer_api_key: true
    ```

    ```bash
    curl -X POST "https://$APIGEE_HOSTNAME/v1/messages" \
      -H "x-api-key: $API_KEY" \
      -H "Content-Type: application/json" \
      -d '{"model": "gemini-3.5-flash", "max_tokens": 256, "messages": [{"role": "user", "content": "Hello"}]}'
    ```

=== "Google Cloud Agent Identity (SPIFFE)"
    **Best for:** Autonomous agents running on Vertex AI Agent Engine, Gemini Enterprise, or Cloud Run using **[Google Cloud Agent Identity](https://docs.cloud.google.com/iam/docs/agent-identity-overview)**.

    Unlike IAM Service Accounts, each deployed agent receives its own strongly attested **[SPIFFE identity](https://docs.cloud.google.com/iam/docs/agent-identity-overview#spiffe-identity)** (`spiffe://...` / `principal://...`) in the `.system.id.goog` trust domain. On the first request (`Authorization: Bearer ya29...`), the gateway verifies the token, resolves the agent's SPIFFE principal to an **AI Product** via `personas`, and caches the token in Apigee's OAuth store for `< 1ms` repeat lookups.

    Matching [Google Cloud IAM's Agent Identity hierarchy](https://docs.cloud.google.com/iam/docs/auth-agent-own-identity#grant-access), `match_claims` supports both **canonical IAM `principal://` / `principalSet://` URIs** and **`*` glob patterns**, automatically ranking matches from most specific to broadest (Single Agent → Region → Project → Organization):

    ```yaml
    features:
      auth:
        enabled: true
        agent_identity:
          enabled: true
          allowed_trust_domain: "agents.global.org-123456789012.system.id.goog" # Or "*.system.id.goog"
          persona: "agent"              # Fallback persona tier for verified GCP agents
          token_ttl_ms: 3600000
        personas:
          # 1. A Single Agent (exact principal:// URI or '*' glob by reasoningEngine ID):
          research-agent:
            match_claims:
              - "principal://agents.global.org-123456789012.system.id.goog/resources/aiplatform/projects/9876543210/locations/us-central1/reasoningEngines/deep-research-*"
              - "*/reasoningEngines/1122334455"
            client_id: "CONSUMER_KEY_FOR_HIGH_QUOTA_AGENT_AI_PRODUCT"

          # 2. All Agents in a Specific GCP Project (canonical principalSet:// URI or project glob):
          ml-project-agents:
            match_claims:
              - "principalSet://agents.global.org-123456789012.system.id.goog/attribute.platformContainer/aiplatform/projects/9876543210"
              - "principal://*/projects/9876543210/*"
            client_id: "CONSUMER_KEY_FOR_PROJECT_AGENT_AI_PRODUCT"

          # 3. All Agents in the Organization (org-wide principalSet:// wildcard):
          agent:
            match_claims:
              - "principalSet://agents.global.org-123456789012.system.id.goog/*"
              - "agent"
            client_id: "CONSUMER_KEY_FOR_STANDARD_AGENT_AI_PRODUCT"
    ```

    * **Automatic Per-Agent Quota & Project Isolation:** Because each deployed agent instance (`reasoningEngines/<ENGINE_ID>`) has its own unique `principal://...` URI, **every individual agent automatically receives its own isolated token quota counter, burst limit, and concurrency bucket** under its mapped AI Product, while its team attribution (`dc_identity_team`) is automatically set to its hosting GCP project (`project:9876543210`).

    ```python
    from google.auth import default
    from google.auth.transport.requests import Request
    import requests

    # ADC automatically retrieves the bound Agent Identity token from the metadata server
    credentials, _ = default()
    credentials.refresh(Request())

    response = requests.post(
        f"https://{APIGEE_HOSTNAME}/v1/chat/completions",
        headers={"Authorization": f"Bearer {credentials.token}"},
        json={"model": "gemini-3.5-flash", "messages": [{"role": "user", "content": "Summarize status."}]},
    )
    ```

=== "Google Cloud Service Accounts"
    **Best for:** Microservices, batch jobs, and workloads on Cloud Run, GKE, or Compute Engine authenticating with **Google Cloud IAM Service Accounts** (`*.iam.gserviceaccount.com`).

    Workloads present their Service Account access token (`Authorization: Bearer ya29...`). The gateway verifies the token against Google Cloud (`oauth2.googleapis.com/tokeninfo`), verifies the email domain against `allowed_email_suffix`, maps the Service Account to an **AI Product** via `personas` using exact strings or `*` glob wildcards (automatically ranked from most specific to broadest), and caches the token in Apigee's OAuth store for `< 1ms` repeat lookups:

    ```yaml
    features:
      auth:
        enabled: true
        agent_identity:
          enabled: true
          allowed_email_suffix: ".iam.gserviceaccount.com" # Or "*@my-project.iam.gserviceaccount.com"
          persona: "agent"              # Fallback persona tier for verified Service Accounts
          token_ttl_ms: 3600000
        personas:
          # 1. Exact Service Account or Name Prefix Glob in a Project (highest specificity):
          finance-automation:
            match_claims:
              - "finance-bot@my-project.iam.gserviceaccount.com"
              - "finance-*@my-project.iam.gserviceaccount.com"
            client_id: "CONSUMER_KEY_FOR_FINANCE_BOT_AI_PRODUCT"

          # 2. All Service Accounts in a Specific GCP Project (project-level glob):
          data-pipeline-services:
            match_claims:
              - "*@my-data-project.iam.gserviceaccount.com"
            client_id: "CONSUMER_KEY_FOR_DATA_PROJECT_AI_PRODUCT"

          # 3. Default AI Product for All Other Verified Service Accounts:
          agent:
            match_claims:
              - "*@*.iam.gserviceaccount.com"
              - "agent"
            client_id: "CONSUMER_KEY_FOR_STANDARD_SERVICE_ACCOUNT_AI_PRODUCT"
    ```

    * **Per-Service-Account Quota Buckets:** Quota counters (`LLMTokenQuota`, burst rate, and concurrency) are keyed by the verified Service Account email (`<sa-name>@<project-id>.iam.gserviceaccount.com`), and team attribution (`dc_identity_team`) is automatically set to `project:<project-id>`. *(Note: If multiple workloads share the same Service Account, they share that Service Account's quota bucket—use **Google Cloud Agent Identity** when you need automatic per-agent instance isolation).*

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
