# `values.yaml` Schema Reference

The Apigee AI Gateway template is driven by a single declarative [`values.yaml`](https://github.com/ra2085/ai-gw-sample/blob/main/templates/ai-gateway/values.yaml) file (or its 15-line minimal counterpart [`values.quickstart.yaml`](https://github.com/ra2085/ai-gw-sample/blob/main/templates/ai-gateway/values.quickstart.yaml)).

> [!TIP]
> **Sensible Defaults Applied Automatically:** Every field in `features`, `endpoints`, and `routing` has a production-ready default inside [`apiproxy.yaml`](https://github.com/ra2085/ai-gw-sample/blob/main/templates/ai-gateway/apiproxy.yaml). You only need to declare the sections you want to customize!

---

## 1. Gateway Metadata (`gateway`)

```yaml
gateway:
  name: "ai-gateway"                                  # Name of the API Proxy in Apigee
  displayName: "Apigee Enterprise AI Gateway"         # Human-readable title
  description: "Enterprise GenAI Gateway"             # Proxy bundle description
  revision: 1                                         # Initial revision number
  project_id: "{propertyset.config.project_id}"       # Dynamic GCP project ID or hardcoded string
```

---

## 2. Feature Toggles (`features`)

```yaml
features:
  # 1. Invoice-Accurate Cost Attribution
  monetization:
    enabled: true                                     # Calculates exact USD cost (cached & reasoning tokens) and checks prepaid balances
    default_currency: "USD"                           # Default currency code
    default_markup: 1.0                               # Default markup multiplier

  # 2. GCP Model Armor Prompt & Response Sanitization
  model_armor:
    enabled: true                                     # Screens prompts and responses via Google Cloud Model Armor
    project_id: "your-gcp-project-id"                 # GCP Project hosting the Model Armor template
    template_id: "filter"                             # Model Armor template ID

  # 3. Real-Time LLM Judge Classifier (auto:judge)
  llm_judge:
    enabled: true                                     # Enables automatic prompt complexity classification
    classifier_model: "gemini-2.5-flash-lite"         # Fast model used for classification

  # 4. Rolling-Window Token Quotas & Team Budgets
  quotas:
    enabled: true                                     # Enforces AI Product rolling token quotas and per-model limits
    secondary_window:
      enabled: false                                  # Opt-in: 2nd rolling window (7-day cap OR shared Team Budget)
      allow_count: 1000000                            # Default fallback token limit
      allow_ref: "secondary_quota_limit"              # Dynamically resolves team_quota_limit or secondary_quota_limit
      interval: 7                                     # Default fallback interval
      interval_ref: "secondary_quota_interval"        # Dynamically resolves team/secondary interval
      time_unit: "day"                                # Default fallback unit (hour | day | week | month)
      time_unit_ref: "secondary_quota_unit"           # Dynamically resolves team/secondary time unit

  # 5. Burst & Concurrency Rate Limits (Opt-In)
  rate_limits:
    burst:
      enabled: false                                  # Opt-in: smooths sudden request arrival spikes per user/agent
      rate: "600pm"                                   # Default fallback rate ("<N>ps" or "<N>pm")
      identifier_ref: "rate_limit_client_id"          # Per-client/user/agent spike smoothing
      use_effective_count: true                       # Synchronizes counters across runtime pods
    concurrency:
      enabled: false                                  # Opt-in: caps simultaneous in-flight requests/streams per client
      limit: 20                                       # Max simultaneous in-flight requests/streams per client
      identifier_ref: "rate_limit_client_id"
      ttl_minutes: 1                                  # Auto-expiry for disconnected SSE streams

  # 6. CORS Support
  cors:
    enabled: true                                     # Emits CORS headers & handles OPTIONS preflight

  # 7. Authentication & AI Product Persona Mapping
  auth:
    enabled: true                                     # Enforces zero-passthrough authentication
    type: "apikey"                                    # Primary mode: apikey | oauth | multi
    allow_x_api_key_alias: true                       # Accepts both x-apikey and x-api-key (Anthropic/OpenAI SDKs)
    oauth:
      enabled: true                                   # Enables native Apigee OAuth 2.0 tokens
    agent_identity:
      enabled: true                                   # Enables Google Cloud Agent Identity (ya29.* Service Account tokens)
      tokeninfo_url: "https://oauth2.googleapis.com/tokeninfo"
      cache_ttl_seconds: 300
    idp_opaque:
      enabled: true                                   # Enables Corporate SSO Opaque Tokens (RFC 7662 introspection)
      introspection_url: "https://idp.internal.corp/oauth2/introspect"
      auth_header: "Basic YXBpZ2VlLWdhdGV3YXk6c2VjcmV0"
      cache_ttl_seconds: 300
    idp_jwt:
      enabled: true                                   # Enables Corporate SSO JWTs (JWKS signature verification)
      jwks_uri: "https://www.googleapis.com/oauth2/v3/certs"
      issuer: ""                                      # Optional expected JWT iss claim
      audience: ""                                    # Optional expected JWT aud claim
    personas:
      claim_name: "groups"                            # JWT/Introspection claim holding user groups/roles
      default_persona: "developer-default"            # Fallback AI Product persona when no group matches
      mappings:                                       # Group -> AI Product name:Consumer Key of that AI Product
        "ai-gateway-leads": "lead-ai-engineer:DEMO_KEY_LEAD_PERSONA"
        "ai-gateway-PowerUsers": "power-developer:DEMO_KEY_POWER_PERSONA"
        "ai-gateway-contractors": "contractor-restricted:DEMO_KEY_CONTRACTOR_PERSONA"
        "default": "developer-default:DEMO_KEY_DEFAULT_PERSONA"
```

---

## 3. Supported Ingress Endpoints (`endpoints`)

All 5 client endpoints are enabled by default:

```yaml
endpoints:
  claude:
    enabled: true
    name: "claude-messages"
    base_path: "/v1/messages"                         # Anthropic Messages API (Claude Code, Anthropic SDK)
  gemini_native:
    enabled: true
    name: "gemini-native"
    base_path: "/ai-gateway"                          # Native Vertex AI Gemini & ADK Predict API
  openai_compat:
    enabled: true
    name: "openai-compat"
    base_path: "/v1/chat/completions"                 # OpenAI Chat Completions API (Codex, OpenAI SDK)
  openai_embeddings:
    enabled: true
    name: "openai-embeddings"
    base_path: "/v1/embeddings"                       # OpenAI & Vertex AI Embeddings API
  models_catalog:
    enabled: true
    name: "claude-models"
    base_path: "/v1/models"                           # Dynamic Models Catalog Discovery
```

---

## 4. Models Catalog (`models`)

Each entry in `models` registers a model in `/v1/models`, configures its backend routing target, and defines its token pricing for **Invoice-Accurate Cost Attribution**:

```yaml
models:
  - name: "gemini-2.5-pro"                            # Unique model identifier
    displayName: "Gemini 2.5 Pro"                     # Catalog display name
    publisher: "google"                               # google | anthropic | openai | meta | mistralai | custom
    format: "gemini"                                  # Wire protocol: gemini | anthropic | openai
    region: "global"                                  # Region: global | us-east5 | us-central1 | europe-west1
    created_at: "2025-05-01T00:00:00Z"                # ISO timestamp for /v1/models
    custom_url: ""                                    # Optional: full URL for OpenAI, Azure, vLLM, or DeepSeek
    auth:                                             # Optional: upstream auth for custom_url
      type: "bearer"                                  # bearer | header | none
      header_name: "Authorization"
      token: ""
      token_ref: "propertyset.config.openai_api_key"
    pricing:
      input_rate: 1.250                               # USD per 1M uncached prompt tokens
      output_rate: 10.000                             # USD per 1M completion & reasoning tokens
      cache_read_rate: 0.3125                         # Optional: USD per 1M cached input tokens (e.g. 0.25x)
      cache_write_rate: 1.5625                        # Optional: USD per 1M cache creation tokens (e.g. 1.25x)
      markup: 1.0                                     # Optional per-model markup multiplier
```

---

## 5. Smart Routing & Aliases (`routing`)

```yaml
routing:
  tiers:
    low: "gemini-2.5-flash-lite"                      # X-Model-Cost-Tier: low
    medium: "gemini-2.5-flash"                        # X-Model-Cost-Tier: medium
    high: "gemini-2.5-pro"                            # X-Model-Cost-Tier: high
    max: "claude-sonnet-4-5"                          # X-Model-Cost-Tier: max
  tasks:
    coding: "gemini-2.5-pro"                          # Classifier task: coding
    reasoning: "gemini-2.5-pro"                       # Classifier task: reasoning
    creative_writing: "claude-sonnet-4-5"             # Classifier task: creative_writing
    summarization: "gemini-2.5-flash-lite"            # Classifier task: summarization
    extraction: "gemini-2.5-flash-lite"               # Classifier task: extraction
    simple_chat: "gemini-2.5-flash"                   # Classifier task: simple_chat
  aliases:
    "gpt-5.4": "gemini-2.5-pro"                       # Rewrite alias
    "gpt-5.4-mini": "gemini-2.5-flash-lite"
    "claude-3-5-sonnet": "claude-sonnet-4-5"
```

