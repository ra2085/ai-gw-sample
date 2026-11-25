# `values.yaml` Schema Reference

The Apigee AI Gateway template is driven by a single declarative [`values.yaml`](https://github.com/ra2085/ai-gw-sample/blob/main/templates/ai-gateway/values.yaml) file (or its minimal quickstart counterpart [`values.quickstart.yaml`](https://github.com/ra2085/ai-gw-sample/blob/main/templates/ai-gateway/values.quickstart.yaml)) across **Gemini Enterprise Agent Platform** (formerly Vertex AI), **Claude Platform (`api.anthropic.com`)**, OpenAI, and **Microsoft Foundry** (formerly Azure OpenAI).

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
    enabled: true                                     # Calculates exact USD cost (cached & reasoning tokens)
    enforce_apigee_wallet: false                      # Opt-in: set true ONLY when Apigee Monetization Add-on + funded developer wallets exist
    default_currency: "USD"                           # Default currency code
    default_markup: 1.0                               # Default markup multiplier

  # 2. GCP Model Armor Context-Aware Prompt & Response Sanitization (Opt-In)
  model_armor:
    enabled: false                                    # Opt-in: set true once regional Model Armor templates are provisioned
    project_id: "your-gcp-project-id"                 # Default GCP Project hosting Model Armor templates (falls back to Apigee org name)
    location: "us-central1"                           # Regional GCP endpoint hosting Model Armor templates (must NOT be "global")
    template: "ai-gw-template"                        # Global fallback template ID
    request_template: "ai-gw-template"                # Optional: global default template for user prompts (or "none")
    response_template: "ai-gw-template"               # Optional: global default template for model responses (or "none")
    allow_claim_bypass: true                          # Set false to prevent token claims from passing "none" or overriding admin identity_rules
    strict_stream_sync: false                         # Opt-in: set true to hold SSE batches until SMR-SanitizeModelResponse passes before socket flush
    identity_rules:                                   # Optional: Tier 2 identity/team '*' glob overrides (ranked by specificity)
      - match: ["finance-*@*.iam.gserviceaccount.com", "team:pci-compliance"]
        request_template: "strict-pci-dlp-template"
        response_template: "strict-pci-dlp-template"
      - match: ["principal://agents.global.org-123456789012.system.id.goog/*/reasoningEngines/deep-research-*"]
        request_template: "agent-prompt-guard"
        response_template: "none"

  # 3. Real-Time LLM Judge Classifier (auto:judge)
  llm_judge:
    enabled: true                                     # Enables automatic prompt complexity & task classification
    classifier_model: "gemini-3.5-flash-lite"         # Fast Agent Platform model used for classification

  # 4. Rolling-Window Quotas & Team Budgets (Tokens or Virtual USD Spend Wallets)
  quotas:
    enabled: true                                     # Enforces AI Product rolling token or micro-USD quotas and per-model limits
    synchronous: true                                 # Default true for cross-pod accuracy; set false on individual quotas for async L1 batching
    preflight_prompt_guard: false                     # Opt-in: rejects prompts in PreFlow (429) when lower-bound usage exceeds available quota
    stream_prompt_checkpoint: false                   # Opt-in: checkpoints initial prompt tokens/spend at SSE stream start to protect against early disconnects
    secondary_window:
      enabled: false                                  # Opt-in: 2nd rolling window (7-day cap OR shared Team Budget)
      synchronous: true                               # Keep true on shared team pools so multi-pod bursts cannot overdraft shared budgets
      shared_name: "llm-token-counter-secondary"      # Isolated counter namespace for secondary/team budgets
      identifier_ref: "secondary_quota_identifier"    # Resolves to "team:<identity_team>" (team scope) or rate_limit_client_id
      allow_count: 1000000                            # Default fallback token limit (or use allow_usd: 100.00 for USD fallback)
      allow_ref: "secondary_quota_limit"              # Dynamically resolves team_quota_limit or secondary_quota_limit
      interval: 7                                     # Default fallback interval
      interval_ref: "secondary_quota_interval"        # Dynamically resolves team/secondary interval
      time_unit: "day"                                # Default fallback unit (hour | day | week | month)
      time_unit_ref: "secondary_quota_unit"           # Dynamically resolves team/secondary time unit

  # 5. Burst, Prompt-Token Velocity & Concurrency Rate Limits (Opt-In)
  rate_limits:
    burst:
      enabled: false                                  # Opt-in: smooths sudden request arrival spikes per user/agent
      rate: "600pm"                                   # Default fallback rate ("<N>ps" or "<N>pm")
      identifier_ref: "rate_limit_client_id"          # Per-client/user/agent spike smoothing
      use_effective_count: true                       # Synchronizes counters across runtime pods
    prompt_tokens:
      enabled: false                                  # Opt-in: throttles incoming prompt-token velocity via Apigee <PromptTokenLimit>
      rate: "100000pm"                                # Default fallback token rate ("<N>ps" or "<N>pm")
      identifier_ref: "rate_limit_client_id"
      use_effective_count: false                      # Default false for lock-free local pod throttling
    concurrency:
      enabled: false                                  # Opt-in: caps simultaneous in-flight requests/streams per client
      limit: 20                                       # Max simultaneous in-flight requests/streams per client
      identifier_ref: "rate_limit_client_id"
      ttl_minutes: 1                                  # Auto-expiry for disconnected SSE streams
      synchronous: true                               # Keep true for cross-pod slot semaphore accuracy

  # 6. Rolling-Window Circuit Breaker, Streaming Isolation & Upstream Error Scrubbing
  circuit_breaker:
    enabled: true                                     # Enables automatic 429/5xx failover & PreFlow circuit breaking
    shared_name: "llm-circuit-breaker"                # Isolated counter namespace for circuit breaker error budgets
    error_threshold: 3                                # Upstream errors within window before circuit trips OPEN
    window_interval: 1                                # Rolling error budget window duration
    window_unit: "minute"                             # Rolling window unit (minute | hour | day)
    synchronous: true                                 # Default true for immediate cross-pod 3-strike detection
  streaming:
    dedicated_sse_targets: false                      # Opt-in (Apigee Known Issue #449012244): split TargetEndpoints into non-SSE + *-sse targets
  security:
    sanitize_upstream_errors: false                   # Opt-in: scrubs GCP project IDs/SA emails/URLs from unrecovered upstream 4xx/5xx errors

  # 7. Authentication & AI Product Persona Mapping
  auth:
    enabled: true                                     # Enforces zero-passthrough authentication
    allow_bearer_api_key: true                        # Option 1: Allows passing Apigee API Key via x-apikey, x-api-key, or Authorization: Bearer <api-key>
    apigee_oauth:
      enabled: true                                   # Option 2: Native Apigee OAuth 2.0 tokens (<1ms L1 cache); set false to skip OA-VerifyAccessToken
    agent_identity:
      enabled: true                                   # Option 3: Google Cloud Agents (Agent Platform SPIFFE Agent Identity & Service Accounts)
      tokeninfo_url: "https://oauth2.googleapis.com/tokeninfo"
      allowed_trust_domain: "agents.global.org-123456789012.system.id.goog" # Required to accept Agent Platform Agent Engine SPIFFE tokens (comma-separated or glob)
      allowed_email_suffix: "@my-project.iam.gserviceaccount.com" # Defaults to "@<gateway.project_id>.iam.gserviceaccount.com" (comma-separated or glob)
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
      audience: "api://ai-gateway,cli-client-id"      # Required when enabled=true: single value, comma-separated list, or glob
      algorithm: "RS256"                              # Asymmetric RSA family (RS256/PS256/...) or ECDSA family (ES256/ES384/ES512)
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
        models: ["gemini-4-hydrogen", "gemini-3.5-flash-lite", "claude-haiku-5-5"] # Concrete catalog model IDs (or ["*"] for all catalog models)
        quota:
          limit: 100000                               # Per-user rolling token allowance (or use limit_usd: 5.00 for a $5.00 USD Spend Wallet)
          interval: 4
          unit: "hour"                                # minute | hour | day | week | month (alias: time_unit)
        team_budget:
          limit: 5000000                              # Shared department/team rolling token budget (or use limit_usd: 100.00)
          interval: 7
          unit: "day"
        rate_limits:
          burst_rate: "300pm"                         # Per-user spike arrest override (alias: burst)
          concurrency_limit: 10                       # Max simultaneous streams per user (alias: concurrency)
        model_armor:
          request_template: "standard-request-template"
          response_template: "standard-response-template"
      developer:
        match_claims: ["developer", "engineering", "swe-*", "*-data-science"]
        client_id: "CONSUMER_KEY_FOR_DEVELOPER_AI_PRODUCT"
        # project_id: "eng-agent-platform-prod"       # Optional: Route this persona's Agent Platform calls ({vertex_project_id}) to a dedicated spoke GCP project
        models: ["*"]                                 # Expands to all concrete catalog models in llmOperationGroup
        quota:
          limit: 500000                               # 500k tokens / 4 hours per engineer (or use limit_usd: 25.00 + per_model_usd)
          interval: 4
          unit: "hour"
          per_model:                                  # Optional: cap frontier reasoning models while leaving fast models uncapped
            claude-opus-5-5: 50000
            gemini-4-argon: 100000
        team_budget:
          limit: 25000000
          interval: 7
          unit: "day"
        rate_limits:
          burst_rate: "600pm"
          concurrency_limit: 20
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
          unit: "hour"
        model_armor:
          request_template: "it-admin-template"
          response_template: "none"
      agent:
        match_claims: ["principalSet://*.system.id.goog/*", "*@*.iam.gserviceaccount.com", "agent"]
        client_id: "CONSUMER_KEY_FOR_AGENT_AI_PRODUCT"
        models: ["gemini-4-hydrogen", "gemini-3.5-flash-lite", "gemini-embedding-001"]
        quota:
          limit: 2000000
          interval: 1
          unit: "hour"
        rate_limits:
          burst_rate: "1200pm"
          concurrency_limit: 50
        model_armor:
          request_template: "agent-prompt-guard"
          response_template: "none"

    # 8. Unified Identity & Team Exceptions (Quotas, Team Budgets, Model Access, Agent Platform Project Routing, Rate Limits & Model Armor)
    exceptions:
      - match: ["alice@corp.example.com"]             # Individual temporary token or USD boost + frontier model unlock
        quota_limit: 5000000                          # Overrides personal quota (or quota_limit_usd: 50.00; still draws from shared team pool by default)
        # project_id: "alice-sandbox-proj"            # Optional: Route this identity's Agent Platform calls ({vertex_project_id}) to a dedicated GCP project
        # bypass_team_budget: true                    # Optional emergency bypass: isolates user from an exhausted shared team pool
        expires_at: "2026-12-31T23:59:59Z"            # Optional ISO-8601 UTC auto-expiration timestamp
        models: ["*"]                                 # Optional: unlocks specific models for this user/agent
      - match: ["team:ml-research", "team:core-ai"]   # Department-level shared team budget override
        team_budget_limit: 100000000                  # Overrides shared 7-day department pool (or use team_budget_limit_usd: 1000.00)
        expires_at: "2026-12-31T23:59:59Z"            # Optional ISO-8601 UTC auto-expiration for temporary department top-ups
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
    base_path: "/ai-gateway"                          # Native Agent Platform Gemini & ADK Predict API
  openai_compat:
    enabled: true
    name: "openai-compat"
    base_path: "/v1/chat/completions"                 # OpenAI Chat Completions API (Antigravity, Copilot, OpenAI SDK)
  openai_embeddings:
    enabled: true
    name: "openai-embeddings"
    base_path: "/v1/embeddings"                       # OpenAI & Agent Platform Embeddings API
  models_catalog:
    enabled: true
    name: "claude-models"
    base_path: "/v1/models"                           # Dynamic Models Catalog Discovery
```

---

## 4. Models Catalog (`models`)

Each entry in `models` registers a model in `/v1/models`, configures its backend routing target, and defines its token pricing for **Invoice-Accurate Cost Attribution**. Note on default model precedence: if top-level `defaults.model` is set, it takes precedence; when `defaults:` is omitted (such as in `values.quickstart.yaml`), `is_default: true` on a catalog entry selects `default.model`.

### Active Default GA Catalog in `values.yaml`

| Model ID (`name`) | Display Name | Role / Tier | Region | Input / 1M | Output / 1M | Cache Read / 1M | Cache Write / 1M |
| :--- | :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| **`gemini-4-hydrogen`** | Gemini 4 Hydrogen | Default model, `medium` tier, `simple_chat` | `global` | `$1.50` | `$7.50` | `$0.15` | — |
| **`gemini-4-argon`** | Gemini 4 Argon | `high` tier, `coding` & `reasoning` tasks | `global` | `$4.00` | `$20.00` | `$0.20` | — |
| **`gemini-3.5-flash-lite`** | Gemini 3.5 Flash-Lite | Fallback, `low` tier, `summarization` / `extraction`, `llm_judge` | `global` | `$0.30` | `$2.50` | `$0.03` | — |
| **`claude-opus-5-5`** | Claude Opus 5.5 | `max` tier | `global` | `$4.00` | `$20.00` | `$0.20` | `$5.00` |
| **`claude-sonnet-5-5`** | Claude Sonnet 5.5 | `creative_writing` task | `global` | `$2.00` | `$10.00` | `$0.10` | `$2.50` |
| **`claude-haiku-5-5`** | Claude Haiku 5.5 | Fast Anthropic Claude 5.5 tier | `global` | `$0.10` | `$0.50` | `$0.01` | `$0.125` |
| **`gemini-embedding-001`** | Gemini Embedding 001 | Default `:predict` embeddings *(replaces `text-embedding-005`)* | `us-central1` | `$0.15` | `$0.00` | — | — |

### Model Entry Schema

```yaml
models:
  # 1. Agent Platform Model (uses Apigee's Google Cloud Service Account roles/aiplatform.user automatically)
  - name: "gemini-4-argon"                            # Unique model identifier exposed in /v1/models
    displayName: "Gemini 4 Argon"                     # Human-readable catalog display name
    publisher: "google"                               # google | anthropic | openai | meta | deepseek | mistralai | azure | custom
    target: "gemini"                                  # gemini | claude | gemini-openai-compat | openai-custom
    format: "gemini"                                  # Wire protocol: gemini | anthropic | openai
    region: "global"                                  # Agent Platform region: "global", multi-region "us" / "eu", or regional (us-central1, europe-west1)
    # project_id: "frontier-models-prod"              # Optional: Route this model ({vertex_project_id}) to a specific GCP project
    # pin_project: false                              # Optional: Set true to prevent persona project_id from overriding this model's project_id
    is_default: false                                 # Used when top-level `defaults.model` is omitted
    created_at: "2026-10-13T00:00:00Z"                # ISO timestamp for /v1/models
    model_armor:                                      # Optional: Tier 6 per-model Model Armor template override
      request_template: "frontier-request-template"
      response_template: "frontier-response-template"
    pricing:
      input_rate: 4.000                               # USD per 1M uncached prompt tokens
      output_rate: 20.000                             # USD per 1M completion & reasoning tokens
      cache_read_rate: 0.200                          # Optional: USD per 1M cached input tokens
      # cache_write_rate: 5.000                       # Optional: USD per 1M cache creation tokens (e.g., Claude 5.5 / GPT-6.2 Sol)
      markup: 1.0                                     # Optional per-model markup multiplier

  # 2. External / Custom URL Model (uses Apigee Environment PropertySet for upstream API key)
  - name: "gpt-6.2-sol"
    displayName: "OpenAI GPT-6.2 Sol"
    publisher: "openai"
    target: "openai-custom"
    format: "openai"
    custom_url: "https://api.openai.com/v1/chat/completions" # Full URL for OpenAI, Claude Platform (api.anthropic.com), Microsoft Foundry, or vLLM
    upstream_model: "gpt-6.2-sol"                     # Optional: backend model ID if different from catalog `name`
    anthropic_version: ""                             # Optional (Claude Platform): sets anthropic-version header (default: 2023-06-01)
    anthropic_beta: ""                                # Optional (Claude Platform): injects anthropic-beta HTTP header for opt-in beta features
    openai_org_id: ""                                 # Optional (OpenAI): injects OpenAI-Organization header
    openai_project_id: ""                             # Optional (OpenAI): injects OpenAI-Project header
    auth:                                             # Optional: upstream credentials for custom_url endpoints
      type: "bearer"                                  # bearer | api_key | header | none
      header_name: "Authorization"                    # Optional: e.g., "x-api-key" (Claude Platform) or "api-key" (Microsoft Foundry); validated against RFC 7230 & internal headers
      token_ref: "propertyset.provider_keys.openai_api_key" # Recommended: trusted variable ref (propertyset.*, private.*, verifyapikey.*, apiproduct.*)
      token: ""                                       # Optional fallback: literal token (for local/dev testing only)
    pricing:
      input_rate: 2.000
      output_rate: 10.000
      cache_read_rate: 0.100
      cache_write_rate: 2.500
```

---

## 5. Global Defaults, Smart Routing & Aliases (`defaults` & `routing`)

```yaml
defaults:
  model: "gemini-4-hydrogen"                          # Default primary model when omitted or set to auto
  fallback: "gemini-3.5-flash-lite"                   # Default automatic failover model
  target: "gemini"
  publisher: "google"
  format: "gemini"
  region: "global"

routing:
  tiers:
    low: "gemini-3.5-flash-lite"                      # X-Model-Cost-Tier: low / auto:low
    medium: "gemini-4-hydrogen"                       # X-Model-Cost-Tier: medium / auto:medium
    high: "gemini-4-argon"                            # X-Model-Cost-Tier: high / auto:high
    max: "claude-opus-5-5"                            # X-Model-Cost-Tier: max / auto:max
  tasks:
    coding: "gemini-4-argon"                          # Classifier task: coding
    reasoning: "gemini-4-argon"                       # Classifier task: reasoning
    creative_writing: "claude-sonnet-5-5"             # Classifier task: creative_writing
    summarization: "gemini-3.5-flash-lite"            # Classifier task: summarization
    extraction: "gemini-3.5-flash-lite"               # Classifier task: extraction
    simple_chat: "gemini-4-hydrogen"                  # Classifier task: simple_chat
  aliases:
    "gemini-3.5-flash": "gemini-4-hydrogen"           # Backward-compatible Gemini generation rewrites
    "gemini-3.1-pro-preview": "gemini-4-argon"
    "claude-sonnet-4-6": "claude-sonnet-5-5"          # Backward-compatible Claude generation rewrites
    "claude-opus-4-6": "claude-opus-5-5"
    "gpt-4o": "gemini-4-argon"                        # Cross-provider & retired embedding rewrites
    "gpt-4o-mini": "gemini-3.5-flash-lite"
    "text-embedding-005": "gemini-embedding-001"
```


