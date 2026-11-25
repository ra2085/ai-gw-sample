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
    ├── java/                      # Shaded Java Callouts JAR (Auth, Smart Router, Transcoders, Cost/Billing)
    ├── jsc/                       # EventFlow SSE streaming aggregator (combine_resp.js)
    ├── oas/                       # OpenAPI schema definitions
    └── properties/                # Target directory for generated propertysets
```

---

## 🛠 Usage & Generation

### 1. Install `apigee-go-gen`
```bash
curl -s https://apigee.github.io/apigee-go-gen/install | bash
# Or via Go:
# go install github.com/apigee/apigee-go-gen/cmd/...@latest
```

### 2. Render Proxy Bundle
Generate a deployable Apigee API proxy bundle (`.zip` or directory):

```bash
apigee-go-gen render apiproxy \
    --template ./templates/ai-gateway/apiproxy.yaml \
    --values ./templates/ai-gateway/values.yaml \
    --output ./out/ai-gateway.zip \
    --validate=true
```

### 3. Deploy to Apigee
```bash
apigeecli apis create bundle \
    --proxy-zip ./out/ai-gateway.zip \
    --name ai-gateway \
    --org "$PROJECT_ID" \
    --env "$APIGEE_ENV" \
    -s "$SERVICE_ACCOUNT" \
    --ovr \
    --wait \
    -t "$(gcloud auth print-access-token)"
```

---

## ⚙️ Custom URLs & API Formats per Model

To add self-hosted LLMs (e.g., vLLM, Ollama), multi-region (`us` / `eu`), or regional endpoints on **Gemini Enterprise Agent Platform**, specify `custom_url`, `format`, `region`, and optional `auth` settings directly in `values.yaml`:

```yaml
models:
  # Self-hosted OpenAI-compatible LLM (vLLM / Ollama)
  - name: "custom-llama-4"
    displayName: "Llama 4 Maverick (vLLM)"
    publisher: "custom"
    target: "openai-custom"
    format: "openai"                            # openai | anthropic | gemini
    custom_url: "https://vllm.internal.corp/v1/chat/completions"
    auth:
      type: "bearer"                            # api_key | bearer | none
      token_ref: "propertyset.provider_keys.vllm_api_key"
    pricing:
      input_rate: 0.050
      output_rate: 0.150

  # Multi-Region / Regional Agent Platform Model
  - name: "gemini-4-argon-eu"
    displayName: "Gemini 4 Argon (Europe Multi-Region)"
    publisher: "google"
    target: "gemini"
    format: "gemini"
    region: "eu"                                # Routes to aiplatform.eu.rep.googleapis.com (or e.g. europe-west1-aiplatform.googleapis.com)
    upstream_model: "gemini-4-argon"
    # project_id: "eu-agent-platform-spoke"     # Optional: Route this model to a dedicated GCP project (Persona > Model > Gateway)
    pricing:
      input_rate: 4.000
      output_rate: 20.000
      cache_read_rate: 0.200
```

---

## 🎛 Feature Toggles, Personas & Exceptions

Configure features, unified Personas (AI Products), and individual/team Exceptions in `values.yaml`:

```yaml
features:
  monetization:
    enabled: true
    enforce_apigee_wallet: false
  model_armor:
    enabled: false
    location: "us-central1"
  llm_judge:
    enabled: true
  quotas:
    enabled: true
  auth:
    enabled: true
    allow_bearer_api_key: true
    personas:
      knowledge-worker:
        match_claims: ["knowledge-worker", "general", "business-*"]
        # project_id: "biz-agent-platform-prod" # Optional: Route this persona's Agent Platform calls to a dedicated GCP project
        models: ["gemini-3.5-flash-lite", "gemini-4-hydrogen"]
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
            claude-opus-5-5: 50000
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
