# ⚙️ `values.yaml` Schema Reference

The Apigee AI Gateway template is driven by `values.yaml`. Below is the complete configuration specification.

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
  monetization:
    enabled: true                                     # Attaches MLC and cost calculation policies
    default_currency: "USD"                           # Default currency code
    default_markup: 1.0                               # Default markup multiplier
  model_armor:
    enabled: true                                     # Attaches SUP, SUPGemini, and SMR policies
    template_id: "projects/.../templates/filter"      # GCP Model Armor sanitization template ID
  llm_judge:
    enabled: true                                     # Attaches SC-LLMJudge classifier callout
    classifier_model: "gemini-3.1-flash-lite"        # Fast model used for classification
  quotas:
    enabled: true                                     # Attaches LTQ-EnforceOnly and LTQ-CountOnly
  cors:
    enabled: true                                     # Emits CORS headers
  auth:
    enabled: true                                     # Enforces API key verification (VA-ApiKey)
    type: "apikey"                                    # apikey | none
```

---

## 3. Supported Ingress Endpoints (`endpoints`)

```yaml
endpoints:
  claude:
    enabled: true
    name: "claude-messages"
    base_path: "/v1/messages"                         # Anthropic Messages API
  gemini_native:
    enabled: true
    name: "gemini-native"
    base_path: "/ai-gateway"                          # Native Gemini & ADK Predict API
  openai_compat:
    enabled: true
    name: "openai-compat"
    base_path: "/v1/chat/completions"                 # OpenAI Chat Completions API
  models_catalog:
    enabled: true
    name: "claude-models"
    base_path: "/v1/models"                           # Dynamic Models Catalog Discovery
```

---

## 4. Models Catalog (`models`)

```yaml
models:
  - name: "gemini-3.5-flash"                          # Unique model identifier
    displayName: "Gemini 3.5 Flash"                   # Catalog display name
    publisher: "google"                               # Model publisher: google | anthropic | custom
    target: "gemini"                                  # Target Endpoint name
    format: "gemini"                                  # Protocol format: gemini | anthropic | openai | passthrough
    region: "global"                                  # Region: global | us-east5 | europe-west1
    created_at: "2025-01-10T00:00:00Z"                # ISO timestamp for /v1/models
    pricing:
      input_rate: 0.100                               # USD cost per 1M prompt tokens
      output_rate: 0.400                              # USD cost per 1M completion tokens
      markup: 1.0                                     # Optional per-model markup multiplier
```

---

## 5. Smart Routing & Aliases (`routing`)

```yaml
routing:
  tiers:
    low: "gemini-3.1-flash-lite"                      # Cost-tier: low
    medium: "gemini-3.5-flash"                        # Cost-tier: medium
    high: "gemini-2.5-pro"                            # Cost-tier: high
    max: "claude-haiku-4-5"                           # Cost-tier: max
  tasks:
    coding: "gemini-2.5-pro"                          # Classifier task: coding
    reasoning: "gemini-2.5-pro"                       # Classifier task: reasoning
    summarization: "gemini-3.1-flash-lite"            # Classifier task: summarization
    simple_chat: "gemini-3.5-flash"                   # Classifier task: simple_chat
  aliases:
    "gpt-4o": "gemini-2.5-pro"                        # Rewrite alias
    "gpt-4o-mini": "gemini-3.1-flash-lite"
    "claude-3-5-sonnet": "claude-haiku-4-5"
```
