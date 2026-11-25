# Smart Routing & Content Safety

Optimize cost, availability, and content safety across all your models without changing client application code.

---

## 1. Smart Routing Strategies

Select a routing strategy below to see how it is configured in `values.yaml` and used by clients:

=== "Model Aliases"
    **Best for:** Migrating existing OpenAI, Claude, or retired Gemini applications to current GA models with **zero client code changes**.

    Configure backward-compatible aliases in `values.yaml`:
    ```yaml
    routing:
      aliases:
        "gemini-3.5-flash": "gemini-4-hydrogen"
        "gemini-3.1-pro-preview": "gemini-4-argon"
        "gemini-3.1-flash-lite": "gemini-3.5-flash-lite"
        "claude-sonnet-4-6": "claude-sonnet-5-5"
        "claude-opus-4-6": "claude-opus-5-5"
        "claude-haiku-4-5": "claude-haiku-5-5"
        "gpt-4o": "gemini-4-argon"
        "gpt-4o-mini": "gemini-3.5-flash-lite"
        "text-embedding-005": "gemini-embedding-001"
    ```

    When a client requests a retired or external alias such as `"model": "gemini-3.5-flash"` or `"model": "text-embedding-005"`, the gateway transparently routes the call to `gemini-4-hydrogen` or `gemini-embedding-001` while recording both the requested alias (`X-Gateway-Requested-Model`) and the actual model used (`X-Gateway-Routed-Model`).

=== "Cost Tiers (`low`, `medium`, `high`, `max`)"
    **Best for:** Decoupling applications from specific model versions so platform teams can upgrade underlying models centrally.

    Configure your tiers in `values.yaml`:
    ```yaml
    routing:
      tiers:
        low: "gemini-3.5-flash-lite"
        medium: "gemini-4-hydrogen"
        high: "gemini-4-argon"
        max: "claude-opus-5-5"
    ```

    Clients can request a tier using `"model": "auto:low"`, the `X-Model-Cost-Tier: low` header, or `"plugins": [{"id": "auto-router", "cost_tier": "low"}]`.

=== "Automatic Complexity Judge (`auto:judge`)"
    **Best for:** Automatically sending simple prompts (summaries, extraction, basic Q&A) to fast, inexpensive models while reserving frontier reasoning models for complex coding and analysis.

    Enable the classifier in `values.yaml`:
    ```yaml
    features:
      llm_judge:
        enabled: true
        classifier_model: "gemini-3.5-flash-lite"

    routing:
      tasks:
        coding: "gemini-4-argon"
        reasoning: "gemini-4-argon"
        creative_writing: "claude-sonnet-5-5"
        summarization: "gemini-3.5-flash-lite"
        extraction: "gemini-3.5-flash-lite"
        simple_chat: "gemini-4-hydrogen"
    ```

    Clients simply pass `"model": "auto:judge"` (or header `X-Gateway-Judge: true`).

=== "Fallback Chains & Rolling-Window Circuit Breaker"
    **Best for:** High-availability applications that require automatic cross-provider/cross-format failover on upstream `429` (rate limit) or `5xx` (server/overload) errors—across **Gemini Enterprise Agent Platform** (formerly Vertex AI), **Direct OpenAI**, **Claude Platform (`api.anthropic.com`)**, and **Microsoft Foundry (formerly Azure OpenAI)**—without paying an extra network hop penalty during sustained outages.

    Configure the rolling-window circuit breaker in `values.yaml`:
    ```yaml
    features:
      circuit_breaker:
        enabled: true
        error_threshold: 3       # Number of upstream 429/5xx errors that trips the circuit OPEN
        window_interval: 1       # Rolling window duration before automatic self-healing recovery
        window_unit: "minute"    # minute | hour | day
    ```

    Clients pass a `models` array in the request body (or use a Smart Router cost tier, which automatically pairs the tier's primary model with `defaults.fallback`):
    ```json
    {
      "models": ["claude-sonnet-5-5", "gemini-3.5-flash-lite"],
      "messages": [{"role": "user", "content": "Analyze this quarterly report."}]
    }
    ```

    **How the Two-Stage Failover & Circuit Breaker Works:**
    1. **Circuit `CLOSED` (First N Upstream Errors — Transparent Failover):**
       - When the primary model returns `HTTP 429` or `5xx`, the gateway increments a rolling error counter for that model and automatically retries the request against the fallback model—transcoding the request, reasoning parameters (`thinkingConfig.thinkingLevel`, Claude 5.5 `thinking: {"type": "adaptive"}` + `output_config.effort`, or OpenAI GPT-6 `max_completion_tokens` / `reasoning_effort`), and response across providers if needed (`200 OK`, `X-Gateway-Fallback-Triggered: true`, `X-Gateway-Circuit-Breaker: CLOSED`).
       - Token quotas, cost attribution, and Model Armor safety checks are applied against the fallback model that actually served the response.
    2. **Circuit `OPEN` (Sustained Outage — Zero-Latency Promotion):**
       - Once the primary model hits `error_threshold` within the rolling window, the circuit trips `OPEN`.
       - Subsequent requests immediately promote the fallback model **before** routing upstream—delivering **0ms extra hop latency** and **full native SSE streaming** (`X-Gateway-Fallback-Triggered: true`, `X-Gateway-Circuit-Breaker: OPEN`, `X-Gateway-Routed-Model: <fallback_model>`).
    3. **Self-Healing Recovery:** When the rolling window expires, the error counter resets automatically and traffic resumes routing to the primary model.

=== "Multi-Project & Multi-Region Agent Platform Routing (Hub-and-Spoke)"
    **Best for:** Enterprises running a centralized Apigee AI Gateway ("hub") that routes **Agent Platform** traffic into dedicated GCP "spoke" projects per **business unit / persona** (for native GCP Cloud Billing chargeback and isolated QPM/TPM quota pools) or per **model**, while enforcing data-residency regions (`"global"`, multi-region `"us"` / `"eu"`, or single-region endpoints).

    Configure `project_id` and `region` declaratively in `values.yaml` (never via client headers or Developer App UI attributes):
    ```yaml
    gateway:
      project_id: "apigee-hub-prod"               # Default gateway project (also used for SC-LLMJudge & Model Armor)

    features:
      auth:
        personas:
          marketing-ai:
            client_id: "CONSUMER_KEY_FOR_MARKETING"
            project_id: "mktg-vertex-prod"        # All Agent Platform calls from marketing-ai bill & draw quota in mktg-vertex-prod

    models:
      - name: "claude-sonnet-5-5"
        publisher: "anthropic"
        target: "claude"
        format: "anthropic"
        region: "global"                          # Supports "global" (aiplatform.googleapis.com), "us" (aiplatform.us.rep.googleapis.com), "eu" (aiplatform.eu.rep.googleapis.com), or regional endpoints
        project_id: "agent-platform-anthropic-hub" # Default project when caller's persona has no project_id
    ```

    **Default Project Precedence (Across `/v1/messages`, `/v1/chat/completions`, `/v1/embeddings`, `/ai-gateway`, and Fallback Chains):**
    1. **`personas.<persona>.project_id`** — Persona wins over Model for clean department billing & quota isolation (`vertex_project_id`)
    2. **`models[].project_id`** — Per-model Agent Platform project (when the caller's persona has no `project_id`)
    3. **`gateway.project_id`** — Default gateway hub project

    *Optional advanced overrides:* Set `pin_project: true` alongside `models[].project_id` to lock a fine-tuned/provisioned model to its host project regardless of persona, or set `project_id` on an active `exceptions[]` rule to route a specific identity/team above its persona default.

    !!! note "Cross-Project IAM & Endpoint Residency"
        Grant the Apigee proxy deployment Service Account `roles/aiplatform.user` on each target Agent Platform spoke project (`gcloud projects add-iam-policy-binding <SPOKE_PROJECT_ID> --member="serviceAccount:<APIGEE_RUNTIME_SA>" --role="roles/aiplatform.user"`). Setting `region: "global"` routes to `aiplatform.googleapis.com`, multi-region `"us"` / `"eu"` routes to `aiplatform.us.rep.googleapis.com` / `aiplatform.eu.rep.googleapis.com`, and regional values (e.g., `"us-central1"`) route to `<region>-aiplatform.googleapis.com`. Circuit-breaker counters (`cb_identifier`) are automatically isolated per target project (`<model>:proj:<project_id>`), and cross-persona project spoofing on `/ai-gateway` is blocked with `HTTP 403`.

---

## 2. Context-Aware Content Safety (Google Cloud Model Armor)

A single "blanket" safety template rarely fits every consumer across an enterprise: a **PCI/HIPAA compliance workflow** requires strict Sensitive Data Protection (SDP/DLP) redaction on both prompts and responses, a **software engineer** debugging code needs permissive prompt filters but strict response PII/secret redaction, and a **high-throughput internal batch agent** may only need prompt injection screening on ingress while bypassing response sanitization (`"none"`) for minimum latency.

When `features.model_armor.enabled: true` is set in `values.yaml`, the gateway enforces **context-aware, asymmetric Model Armor templates** independently for **Requests (`SUP-SanitizeUserPrompt`)** and **Responses (`SMR-SanitizeModelResponse`)**—across both non-streaming payloads and real-time SSE streams:

```yaml
features:
  model_armor:
    enabled: true
    project_id: "your-gcp-project-id"
    location: "us-central1"
    # Global fallback templates (applied when no higher-priority rule matches):
    template: "standard-safety-template"
    request_template: "standard-request-template"
    response_template: "standard-response-template"

    # Tier 2: Identity & Team Glob Rules (supports '*' wildcards, ranked by specificity)
    identity_rules:
      - match:
          - "finance-*@*.iam.gserviceaccount.com"
          - "team:pci-compliance"
          - "*@pci-audit.corp.example.com"
        request_template: "strict-pci-dlp-template"
        response_template: "strict-pci-dlp-template"

      - match:
          - "principal://agents.global.org-123456789012.system.id.goog/*/reasoningEngines/deep-research-*"
        request_template: "agent-prompt-guard"
        response_template: "none"   # Bypass response sanitization for trusted internal agent
```

You can also bind templates directly to **Personas** (under `features.auth.personas`) or **Individual Models** (under `models`):

```yaml
features:
  auth:
    personas:
      developer:
        match_claims: ["swe-*", "engineering", "developer"]
        client_id: "CONSUMER_KEY_FOR_DEVELOPER_AI_PRODUCT"
        model_armor:
          request_template: "dev-permissive-prompt-template"
          response_template: "strict-dlp-response-template"
      agent:
        match_claims: ["principalSet://*.system.id.goog/*", "*@*.iam.gserviceaccount.com"]
        client_id: "CONSUMER_KEY_FOR_AGENT_AI_PRODUCT"
        model_armor:
          request_template: "agent-prompt-guard"
          response_template: "none"
```

### 6-Tier Template Resolution Precedence

On every request, the gateway independently resolves the **Request Template** and **Response Template** using a 6-tier hierarchy (highest to lowest priority):

| Priority | Source (`X-Gateway-Model-Armor-Source`) | How It Is Configured |
| :---: | :--- | :--- |
| **1 (Highest)** | **`identity_claim`** | Explicit same-project template claim in the verified IdP JWT, `/userinfo` response, or OAuth token (`model_armor_request_template`, `model_armor_response_template`, or `model_armor_template`). Set `features.model_armor.allow_claim_bypass: false` to disallow `"none"` bypasses and keep admin `identity_rules` non-overridable. |
| **2** | **`identity_rule`** | Matches caller identity (`user_id`, `email`, SPIFFE `principal://...`, or `team:<department>`) against `features.model_armor.identity_rules` using linear-time `*` glob matching ranked by specificity. |
| **3** | **`app_attribute`** | Custom attribute on the Apigee Developer App (`model_armor_request_template`, `model_armor_response_template`, or `model_armor_template`). |
| **4** | **`persona:<name>`** | Persona-level config under `features.auth.personas.<name>.model_armor` (or `features.model_armor.personas.<name>`). |
| **5** | **`api_product`** | Custom attribute on the Apigee API Product (`model_armor_request_template`, `model_armor_response_template`, or `model_armor_template`). |
| **6 (Fallback)** | **`model_config` → `global_default`** | Per-model `models[].model_armor` override, falling back to `features.model_armor.{request_template,response_template,template}`. |

### Flexible Template Formats & Phase Bypass (`"none"`)

* **Short ID, Regional Path, or Full Resource URI:** Admin-configured template fields accept a short template ID (`strict-pci-dlp`), a regional shorthand (`us-east1/strict-pci-dlp`), or a full cross-project resource name (`projects/sec-ops-prod/locations/us-central1/templates/strict-pci-dlp`). Token-supplied `identity_claim` overrides are restricted to the gateway's own project (or `allowed_gcp_projects`).
* **Selective Phase Bypass (`"none"` / `"disabled"`):** Setting `request_template: "none"` or `response_template: "none"` dynamically skips Model Armor execution for that specific phase without disabling the other phase (controlled for token claims via `features.model_armor.allow_claim_bypass`, default `true`).
* **End-to-End Audit Headers & Block Diagnostics:** Every response includes `X-Gateway-Model-Armor-Request-Template`, `X-Gateway-Model-Armor-Response-Template`, and `X-Gateway-Model-Armor-Source`. When a prompt or model response is blocked (`HTTP 403`), the gateway returns `X-Gateway-Model-Armor-Phase` (`request` or `response`), `X-Gateway-Model-Armor-Template`, the resolved persona, and any Sensitive Data Protection `deidentifiedData` redaction preview.


