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

  # 2. GCP Model Armor Context-Aware Prompt & Response Sanitization
  model_armor:
    enabled: true                                     # Screens prompts and responses via Google Cloud Model Armor
    project_id: "your-gcp-project-id"                 # Default GCP Project hosting Model Armor templates
    location: "us-central1"                           # Default GCP Region hosting Model Armor templates
    template: "standard-safety-template"              # Global fallback template ID
    request_template: "standard-request-template"     # Optional: global default template for user prompts (or "none")
    response_template: "standard-response-template"   # Optional: global default template for model responses (or "none")
    identity_rules:                                   # Optional: Tier 2 identity/team '*' glob overrides (ranked by specificity)
      - match: ["finance-*@*.iam.gserviceaccount.com", "team:pci-compliance"]
        request_template: "strict-pci-dlp-template"
        response_template: "strict-pci-dlp-template"
      - match: ["principal://agents.global.org-123456789012.system.id.goog/*/reasoningEngines/deep-research-*"]
        request_template: "agent-prompt-guard"
        response_template: "none"

  # 3. Real-Time LLM Judge Classifier (auto:judge)
  llm_judge:
    enabled: true                                     # Enables automatic prompt complexity classification
    classifier_model: "gemini-3.1-flash-lite"         # Fast model used for classification

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

  # 6. Rolling-Window Circuit Breaker & Automatic Fallback Chains
  circuit_breaker:
    enabled: true                                     # Enables automatic 429/5xx failover & PreFlow circuit breaking
    error_threshold: 3                                # Upstream errors within window before circuit trips OPEN
    window_interval: 1                                # Rolling error budget window duration
    window_unit: "minute"                             # Rolling window unit (minute | hour | day)

  # 7. CORS Support
  cors:
    enabled: true                                     # Emits CORS headers & handles OPTIONS preflight

  # 8. Authentication & AI Product Persona Mapping
  auth:
    enabled: true                                     # Enforces zero-passthrough authentication
    allow_bearer_api_key: true                        # Option 1: Allows passing Apigee API Key via x-apikey, x-api-key, or Authorization: Bearer <api-key>
    apigee_oauth:
      enabled: true                                   # Option 2: Native Apigee OAuth 2.0 tokens (<1ms L1 cache)
    agent_identity:
      enabled: true                                   # Option 3: Google Cloud Agents (SPIFFE Agent Identity & Service Accounts)
      tokeninfo_url: "https://oauth2.googleapis.com/tokeninfo"
      allowed_trust_domain: ".system.id.goog"         # SPIFFE trust domain (e.g. "agents.global.org-123456789012.system.id.goog")
      allowed_email_suffix: ".iam.gserviceaccount.com" # Service Account email suffix
      persona: "agent"                                # Default persona tier for verified GCP agents
      token_ttl_ms: 3600000
    idp_opaque:
      enabled: true                                   # Option 4a: Corporate SSO Opaque Tokens (/userinfo introspection)
      userinfo_url: "https://idp.internal.corp/oauth2/v1/userinfo"
      user_claim: "email"
      persona_claim: "role"
      team_claim: "department"
      quota_override_claim: "ai_quota_override"
      token_ttl_ms: 3600000
    idp_jwt:
      enabled: true                                   # Option 4b: Corporate SSO JWTs (JWKS signature verification)
      jwks_uri: "https://login.corp.example.com/oauth2/v1/keys"
      issuer: "https://login.corp.example.com"
      user_claim: "email"
      persona_claim: "role"
      team_claim: "department"
      quota_override_claim: "ai_quota_override"
      token_ttl_ms: 3600000
    default_persona: "knowledge-worker"               # Optional fallback persona if an authenticated claim doesn't match
    default_client_id: ""                             # Optional shared fallback Consumer Key when personas omit client_id
    personas:                                         # Unified AI Product & Persona definitions (compiled into config.properties + optional sync-personas.sh)
      knowledge-worker:
        match_claims: ["knowledge-worker", "general", "business-*"]
        client_id: "CONSUMER_KEY_FOR_KNOWLEDGE_WORKER_AI_PRODUCT" # Optional if default_client_id is set or synced via scripts/sync-personas.sh
        models: ["gemini-3.5-flash", "gemini-3.1-flash-lite", "claude-haiku-4-5"] # Concrete catalog model IDs (or ["*"] for all catalog models)
        quota:
          limit: 100000                               # Per-user rolling token allowance
          interval: 4
          time_unit: "hour"                           # minute | hour | day | week | month
        team_budget:
          limit: 5000000                              # Shared department/team rolling token budget
          interval: 7
          time_unit: "day"
        rate_limits:
          burst: "300pm"                              # Per-user spike arrest override
          concurrency: 10                             # Max simultaneous streams per user
        model_armor:
          request_template: "standard-request-template"
          response_template: "standard-response-template"
      developer:
        match_claims: ["developer", "engineering", "swe-*", "*-data-science"]
        client_id: "CONSUMER_KEY_FOR_DEVELOPER_AI_PRODUCT"
        models: ["*"]                                 # Expands to all concrete catalog models in llmOperationGroup
        quota:
          limit: 500000                               # 500k tokens / 4 hours per engineer
          interval: 4
          time_unit: "hour"
          per_model:                                  # Optional: cap expensive frontier models while leaving fast models uncapped
            claude-sonnet-4-6: 50000
            gemini-3.1-pro-preview: 100000
        team_budget:
          limit: 25000000
          interval: 7
          time_unit: "day"
        rate_limits:
          burst: "600pm"
          concurrency: 20
        model_armor:
          request_template: "dev-permissive-prompt-template"
          response_template: "strict-dlp-response-template"
      it:
        match_claims: ["it", "platform-admin", "sre-*", "devops", "secops"]
        client_id: "CONSUMER_KEY_FOR_IT_AI_PRODUCT"
        models: ["*"]
        quota:
          limit: 1000000
          interval: 4
          time_unit: "hour"
        model_armor:
          request_template: "it-admin-template"
          response_template: "none"
      agent:
        match_claims: ["principalSet://*.system.id.goog/*", "*@*.iam.gserviceaccount.com", "agent"]
        client_id: "CONSUMER_KEY_FOR_AGENT_AI_PRODUCT"
        models: ["gemini-3.5-flash", "gemini-3.1-flash-lite", "text-embedding-005"]
        quota:
          limit: 2000000
          interval: 1
          time_unit: "hour"
        rate_limits:
          burst: "1200pm"
          concurrency: 50
        model_armor:
          request_template: "agent-prompt-guard"
          response_template: "none"

    # 9. Unified Identity & Team Exceptions (Quotas, Team Budgets, Model Access, Rate Limits & Model Armor)
    exceptions:
      - match: ["alice@corp.example.com"]             # Individual temporary token boost + frontier model unlock
        quota_limit: 5000000                          # Overrides primary token quota (bypasses exhausted team budget while active)
        expires_at: "2026-12-31T23:59:59Z"            # Optional ISO-8601 UTC auto-expiration timestamp
        models: ["*"]                                 # Optional: unlocks specific models for this user/agent
      - match: ["team:ml-research", "team:core-ai"]   # Department-level shared team budget override
        team_budget_limit: 100000000                  # Overrides shared 7-day department pool to 100M tokens
      - match: ["finance-*@*.iam.gserviceaccount.com", "team:pci-compliance"]
        burst_rate: "1200pm"                          # Optional per-identity/team burst rate override
        concurrency_limit: 50                         # Optional per-identity/team concurrency override
        model_armor:
          request_template: "strict-pci-dlp-template"
          response_template: "strict-pci-dlp-template"
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
  - name: "gemini-3.1-pro-preview"                    # Unique model identifier exposed in /v1/models
    displayName: "Gemini 3.1 Pro Preview"             # Human-readable catalog display name
    publisher: "google"                               # google | anthropic | openai | meta | mistralai | azure | custom
    target: "gemini"                                  # gemini | claude | gemini-openai-compat | openai-custom
    format: "gemini"                                  # Wire protocol: gemini | anthropic | openai
    region: "global"                                  # Vertex AI region: global | us-east5 | us-central1 | europe-west1
    created_at: "2026-05-01T00:00:00Z"                # ISO timestamp for /v1/models
    custom_url: ""                                    # Optional: full URL for Direct OpenAI, Direct Anthropic, Azure, or vLLM
    upstream_model: ""                                # Optional: backend model ID if different from catalog `name`
    anthropic_version: "2023-06-01"                   # Optional (Anthropic): sets anthropic-version header (or body version on Vertex)
    anthropic_beta: "prompt-caching-2024-07-31"       # Optional (Anthropic): injects anthropic-beta HTTP header
    openai_org_id: ""                                 # Optional (OpenAI): injects OpenAI-Organization header (for legacy multi-org keys)
    openai_project_id: ""                             # Optional (OpenAI): injects OpenAI-Project header (for legacy multi-project keys)
    auth:                                             # Optional: upstream credentials for custom_url endpoints
      type: "bearer"                                  # bearer | header | none
      header_name: "Authorization"                    # e.g., "x-api-key" for Direct Anthropic or "api-key" for Azure OpenAI
      token_ref: "propertyset.provider_keys.openai_api_key" # Recommended: Apigee Environment PropertySet reference (no secrets in Git)
      token: ""                                       # Optional fallback: literal token (for local/dev testing only)
    model_armor:                                      # Optional: Tier 6 per-model Model Armor template override
      request_template: "frontier-request-template"
      response_template: "frontier-response-template"
    pricing:
      input_rate: 2.000                               # USD per 1M uncached prompt tokens (<= 200K context)
      output_rate: 12.000                             # USD per 1M completion & reasoning tokens
      cache_read_rate: 0.200                          # Optional: USD per 1M cached input tokens (0.10x)
      cache_write_rate: 2.500                         # Optional: USD per 1M cache creation tokens (e.g. 1.25x on Claude)
      markup: 1.0                                     # Optional per-model markup multiplier
```

---

## 5. Smart Routing & Aliases (`routing`)

```yaml
routing:
  tiers:
    low: "gemini-3.1-flash-lite"                      # X-Model-Cost-Tier: low
    medium: "gemini-3.5-flash"                        # X-Model-Cost-Tier: medium
    high: "gemini-3.1-pro-preview"                    # X-Model-Cost-Tier: high
    max: "claude-sonnet-4-6"                          # X-Model-Cost-Tier: max
  tasks:
    coding: "gemini-3.1-pro-preview"                  # Classifier task: coding
    reasoning: "gemini-3.1-pro-preview"               # Classifier task: reasoning
    creative_writing: "claude-sonnet-4-6"             # Classifier task: creative_writing
    summarization: "gemini-3.1-flash-lite"            # Classifier task: summarization
    extraction: "gemini-3.1-flash-lite"               # Classifier task: extraction
    simple_chat: "gemini-3.5-flash"                   # Classifier task: simple_chat
  aliases:
    "gpt-5.4": "gemini-3.1-pro-preview"               # Rewrite alias
    "gpt-5.4-mini": "gemini-3.1-flash-lite"
    "claude-3-5-sonnet": "claude-sonnet-4-6"
```

