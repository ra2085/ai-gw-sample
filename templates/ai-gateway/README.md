# 🚀 Apigee AI Gateway Template

A declarative, configurable template for generating the **Apigee Enterprise AI Gateway** using [`apigee-go-gen`](https://github.com/apigee/apigee-go-gen).

---

## 📁 Directory Structure

```text
templates/ai-gateway/
├── apiproxy.yaml                  # Root template (APIProxy, ProxyEndpoints, TargetEndpoints, Resources)
├── values.yaml                    # Declarative configuration & models catalog
├── _helpers.tmpl                  # Go template helper macros (Dynamic PropertySets & URL builders)
├── policies.yaml                  # Aggregated policy definitions template
├── policies/                      # Decomposed YAML policy definitions
│   ├── VA-ApiKey.yaml
│   ├── MLC-EnforceMonetizationLimits.yaml
│   ├── SC-LLMJudge.yaml
│   ├── SUP-SanitizeUserPrompt.yaml
│   ├── SMR-SanitizeModelResponse.yaml
│   ├── LTQ-EnforceOnly.yaml
│   ├── LTQ-CountOnly.yaml
│   └── ...
└── resources/
    ├── jsc/                       # JavaScript callouts (Smart Router, Converters, Rating)
    ├── oas/                       # OpenAPI schema definitions
    └── properties/                # Target directory for generated propertysets
```

---

## 🛠 Usage & Generation

### 1. Build or Install `apigee-go-gen`
```bash
cd apigeegg/apigee-go-gen
go build -o ./bin/apigee-go-gen ./cmd/apigee-go-gen
```

### 2. Render Proxy Bundle
Generate a deployable Apigee API proxy bundle (`.zip` or directory):

```bash
apigee-go-gen render apiproxy \
    --template ./templates/ai-gateway/apiproxy.yaml \
    --values ./templates/ai-gateway/values.yaml \
    --output ./out/ai-gateway.zip
```

### 3. Deploy to Apigee
```bash
apigeecli apis create bundle \
    --proxy-zip ./out/ai-gateway.zip \
    --name ai-gateway \
    --org "$PROJECT_ID" \
    --env "$APIGEE_ENV" \
    --ovr \
    --wait \
    --default-token
```

---

## ⚙️ Custom URLs & API Formats per Model

To add self-hosted LLMs (e.g., vLLM, Ollama) or regional endpoints, specify `custom_url`, `format`, and optional `auth` settings directly in `values.yaml`:

```yaml
models:
  # Self-hosted OpenAI-compatible LLM (vLLM / Ollama)
  - name: "custom-llama-3"
    displayName: "Llama 3 70B (vLLM)"
    publisher: "custom"
    target: "gemini-openai-compat"
    format: "openai"                            # openai | anthropic | gemini | passthrough
    custom_url: "https://vllm.internal.corp/v1/chat/completions"
    auth:
      type: "bearer"                            # api_key | bearer | header | none
      token_ref: "propertyset.provider_keys.vllm_api_key"
    pricing:
      input_rate: 0.050
      output_rate: 0.150

  # Regional Vertex AI Model
  - name: "gemini-3.1-pro-eu"
    displayName: "Gemini 3.1 Pro (Europe)"
    publisher: "google"
    target: "gemini"
    format: "gemini"
    region: "europe-west1"                      # Automatically routes to europe-west1-aiplatform.googleapis.com
    pricing:
      input_rate: 2.000
      output_rate: 12.000
      cache_read_rate: 0.200
```

---

## 🎛 Feature Toggles, Personas & Exceptions

Configure features, unified Personas (AI Products), and individual/team Exceptions in `values.yaml`:

```yaml
features:
  monetization:
    enabled: true
  model_armor:
    enabled: true
  llm_judge:
    enabled: true
  quotas:
    enabled: true
  cors:
    enabled: true
  auth:
    enabled: true
    allow_bearer_api_key: true
    personas:
      knowledge-worker:
        match_claims: ["knowledge-worker", "general", "business-*"]
        models: ["gemini-3.1-flash-lite", "gemini-3.5-flash"]
        quota:
          limit: 50000
          interval: 4
          unit: "hour"
      developer:
        match_claims: ["developer", "engineering", "swe-*"]
        models: ["*"]
        quota:
          limit: 250000
          interval: 4
          unit: "hour"
          per_model:
            claude-sonnet-4-6: 50000
    exceptions:
      - match: ["alice@company.com"]
        quota_limit: 500000
        expires_at: "2026-12-31T23:59:59Z"
        models: ["*"]
```

To safely preview or upsert the corresponding Apigee API Products (`llmOperationGroup.operationConfigs`) and Developer Apps:

```bash
# Preview API Product & Developer App payloads (zero network calls)
bash ./scripts/sync-personas.sh --values ./templates/ai-gateway/values.yaml --org "$PROJECT_ID" --env "$APIGEE_ENV" --dry-run

# Apply additive create-or-update (preserves existing Consumer Keys)
bash ./scripts/sync-personas.sh --values ./templates/ai-gateway/values.yaml --org "$PROJECT_ID" --env "$APIGEE_ENV"
```
