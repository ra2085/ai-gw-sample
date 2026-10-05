# 5-Minute Quickstart

Get an enterprise AI Gateway running in 5 minutes using a single **15-line `values.quickstart.yaml` file**.

> [!IMPORTANT]
> **Prerequisites:** Complete the one-time setup in **[Prerequisites & Setup](installation.md)** before deploying:
> 1. Install `apigee-go-gen` and `apigeecli`.
> 2. Authenticate with Google Cloud (`gcloud auth login` & `gcloud auth application-default login`).
> 3. Create the deployment Service Account with `roles/aiplatform.user`.
> 4. Create the 9 telemetry Data Collectors in your Apigee organization.
> 5. Provision your AI Products and Persona Developer Apps with `bash ./scripts/sync-personas.sh`.

---

## 1. Define Your Models (`values.quickstart.yaml`)

```yaml
gateway:
  name: "ai-gateway-quickstart"
  project_id: "your-gcp-project-id"

models:
  # 1. Google Gemini on Vertex AI
  - name: "gemini-3.5-flash"
    displayName: "Gemini 3.5 Flash"
    publisher: "google"
    format: "gemini"
    region: "global"
    is_default: true

  # 2. Anthropic Claude on Vertex AI
  - name: "claude-haiku-4-5"
    displayName: "Claude 4.5 Haiku"
    publisher: "anthropic"
    format: "anthropic"
    region: "us-east5"

  # 3. Optional: Self-Hosted or External Model (OpenAI format)
  - name: "my-vllm-model"
    displayName: "Llama 3 (Self-Hosted)"
    format: "openai"
    custom_url: "https://vllm.internal.corp/v1/chat/completions"
```

---

## 2. Render, Deploy & Provision AI Products

Compile your YAML configuration into an Apigee bundle, deploy the proxy, and run `scripts/sync-personas.sh` to automatically create your Apigee API Products (`llmOperationGroup`) and Developer App keys:

```bash
# 1. Render the Apigee bundle from YAML
apigee-go-gen render apiproxy \
    --template ./templates/ai-gateway/apiproxy.yaml \
    --values ./templates/ai-gateway/values.quickstart.yaml \
    --output ./out/ai-gateway.zip

# 2. Deploy the proxy to Apigee X or Apigee Hybrid
export SERVICE_ACCOUNT="ai-gateway-sa@${PROJECT_ID}.iam.gserviceaccount.com"

apigeecli apis create bundle \
    --proxy-zip ./out/ai-gateway.zip \
    --name ai-gateway \
    --org "$PROJECT_ID" \
    --env "$APIGEE_ENV" \
    -s "$SERVICE_ACCOUNT" \
    --ovr \
    --wait \
    --default-token

# 3. Provision API Products (llmOperationGroup) & Developer Apps (outputs your client_id / $API_KEY)
bash ./scripts/sync-personas.sh \
    --values ./templates/ai-gateway/values.quickstart.yaml \
    --org "$PROJECT_ID" \
    --env "$APIGEE_ENV"
```

---

## 3. Call Any Model from Any SDK or CLI

Once deployed, developers can call any model in your catalog using their preferred client SDK or CLI tool. Click a tab below for ready-to-run examples:

=== "Claude Code / Anthropic SDK (`/v1/messages`)"

    Call Gemini, Claude, or OpenAI models using the standard Anthropic Messages API:

    ```bash
    curl -X POST "https://$APIGEE_HOSTNAME/v1/messages" \
      -H "x-api-key: $API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "model": "gemini-3.5-flash",
        "max_tokens": 256,
        "messages": [{"role": "user", "content": "Explain quantum computing in one sentence."}]
      }'
    ```

=== "Codex / OpenAI SDK (`/v1/chat/completions`)"

    Call Gemini, Claude, MaaS, or OpenAI models using the standard OpenAI Chat Completions API:

    ```bash
    curl -X POST "https://$APIGEE_HOSTNAME/v1/chat/completions" \
      -H "x-apikey: $API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "model": "claude-haiku-4-5",
        "messages": [{"role": "user", "content": "Write a haiku about API gateways."}]
      }'
    ```

=== "Embeddings SDK (`/v1/embeddings`)"

    Generate vector embeddings using Vertex AI (`text-embedding-005`) or OpenAI (`text-embedding-3-small`):

    ```bash
    curl -X POST "https://$APIGEE_HOSTNAME/v1/embeddings" \
      -H "x-apikey: $API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "model": "text-embedding-005",
        "input": ["Apigee Enterprise AI Gateway"]
      }'
    ```

---

## 4. Next Steps: Layer On Enterprise Governance

Explore the **Guides** tab to enable enterprise controls via `values.yaml`:

1. **[AI Products, Tenancy & Auth](../architecture/security.md):** Define AI Products (`lead-ai-engineer`, `power-developer`, `developer-default`, `autonomous-agent`) and connect Corporate SSO, API Keys, or Google Cloud Agent tokens.
2. **[Models & Providers](../template-guide/custom-urls.md):** Add Vertex Model Garden MaaS (`meta/llama-*`, `mistralai/*`), Direct OpenAI (`api.openai.com` with per-department key isolation), or self-hosted endpoints.
3. **[Quotas, Budgets & Cost Control](../architecture/monetization.md):** Configure per-user and per-model token quotas, shared team budgets, temporary exceptions, and **Invoice-Accurate Cost Attribution**.
4. **[Smart Routing & Content Safety](../architecture/routing.md):** Enable model aliases, cost tiers, automatic complexity routing (`auto:judge`), and Google Cloud Model Armor.
