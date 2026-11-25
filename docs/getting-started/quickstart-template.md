# 5-Minute Quickstart

Get an enterprise AI Gateway running in 5 minutes using the starter **`values.quickstart.yaml` file**.

> [!IMPORTANT]
> **Prerequisites:** Complete the one-time environment setup in **[Prerequisites & Setup](installation.md)** (Steps 1–5) before deploying:
> 1. Install `apigee-go-gen` and `apigeecli`.
> 2. Authenticate with Google Cloud (`gcloud auth login`).
> 3. Create the deployment Service Account with `roles/aiplatform.user`.
> 4. Create the 18 telemetry Data Collectors in your Apigee organization.

---

## 1. Copy & Update the Quickstart Configuration (`./values.yaml`)

Copy the starter quickstart template to `./values.yaml` and set `gateway.project_id` to your GCP project ID to enable Gemini 4, Claude 5.5, and Gemini Embeddings on **Gemini Enterprise Agent Platform** (formerly Vertex AI), plus a self-hosted model endpoint:

```bash
cp ./templates/ai-gateway/values.quickstart.yaml ./values.yaml
```

```yaml
gateway:
  name: "ai-gateway"
  project_id: "your-gcp-project-id"

models:
  # 1. Google Gemini 4 on Agent Platform
  - name: "gemini-4-hydrogen"
    displayName: "Gemini 4 Hydrogen"
    publisher: "google"
    target: "gemini"
    format: "gemini"
    region: "global"
    is_default: true
    pricing:
      input_rate: 1.500
      output_rate: 7.500
      cache_read_rate: 0.150

  # 2. Anthropic Claude 5.5 on Agent Platform
  - name: "claude-haiku-5-5"
    displayName: "Claude Haiku 5.5"
    publisher: "anthropic"
    target: "claude"
    format: "anthropic"
    region: "global"
    pricing:
      input_rate: 0.100
      output_rate: 0.500
      cache_read_rate: 0.010
      cache_write_rate: 0.125

  # 3. Agent Platform Embeddings (:predict transcoded to OpenAI /v1/embeddings)
  - name: "gemini-embedding-001"
    displayName: "Gemini Embedding 001"
    publisher: "google"
    target: "gemini-openai-compat"
    format: "openai"
    region: "us-central1"
    pricing:
      input_rate: 0.150
      output_rate: 0.000

  # 4. Bonus: Custom Self-Hosted Model in 4 lines!
  - name: "my-vllm-model"
    displayName: "Llama 4 (Self-Hosted)"
    format: "openai"
    custom_url: "https://vllm.internal.corp/v1/chat/completions"
```

---

## 2. Provision AI Products, Render & Deploy

Run `scripts/sync-personas.sh` first to create your Apigee API Products (`llmOperationGroup`) and Developer App keys (`client_id`), then compile and deploy the proxy bundle:

```bash
# 1. Provision API Products (llmOperationGroup) & Developer Apps (outputs your client_id / $API_KEY)
#    (If enabling SSO/Agent token import, paste the generated client_id values into ./values.yaml before Step 2;
#     direct x-api-key / x-apikey calls work immediately with the generated $API_KEY)
bash ./scripts/sync-personas.sh \
    --values ./values.yaml \
    --org "$PROJECT_ID" \
    --env "$APIGEE_ENV"

# 2. Render the Apigee bundle from YAML
apigee-go-gen render apiproxy \
    --template ./templates/ai-gateway/apiproxy.yaml \
    --values ./values.yaml \
    --set "gateway.project_id=$PROJECT_ID" \
    --output ./out/ai-gateway.zip

# 3. Deploy the proxy to Apigee X or Apigee Hybrid
export SERVICE_ACCOUNT="ai-gateway-sa@${PROJECT_ID}.iam.gserviceaccount.com"

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

* **Default AI Products Provisioned:** Because `values.quickstart.yaml` omits a custom `personas` block, `sync-personas.sh` automatically provisions the **4 built-in AI Products** (`ai-gateway-knowledge-worker`, `ai-gateway-developer`, `ai-gateway-it`, and `ai-gateway-agent`) and their Developer Apps (`*-app`). Each product is pre-configured with `llmOperationGroup` token counters (**1M tokens / hour** default limit) for every model in your `models` list—and omitting `features:` automatically enables rolling token/USD quotas, cost attribution, and telemetry headers out-of-the-box.

---

## 3. Call Any Model from Any SDK or CLI

Once deployed, developers can call any model in your catalog using their preferred client SDK or CLI tool—**no local GCP Application Default Credentials (`gcloud auth application-default login`) required**. Click a tab below for ready-to-run examples:

=== "Claude Code / Anthropic SDK (`/v1/messages`)"

    Call Gemini, Claude, or OpenAI models using the standard Anthropic Messages API:

    ```bash
    curl -X POST "https://$APIGEE_HOSTNAME/v1/messages" \
      -H "x-api-key: $API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "model": "gemini-4-hydrogen",
        "max_tokens": 256,
        "messages": [{"role": "user", "content": "Explain quantum computing in one sentence."}]
      }'
    ```

=== "Antigravity / Copilot / OpenAI SDK (`/v1/chat/completions`)"

    Call Gemini, Claude, Agent Platform MaaS, or OpenAI models using the standard OpenAI Chat Completions API:

    ```bash
    curl -X POST "https://$APIGEE_HOSTNAME/v1/chat/completions" \
      -H "x-apikey: $API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "model": "claude-haiku-5-5",
        "messages": [{"role": "user", "content": "Write a haiku about API gateways."}]
      }'
    ```

=== "Google GenAI SDK (`/ai-gateway`)"

    When using `google-genai` in `vertexai=True` mode, pass placeholder `Credentials("gateway-managed")` so the SDK skips local ADC lookup and lets Apigee authenticate to Agent Platform upstream:

    ```python
    import os
    from google import genai
    from google.genai import types
    from google.oauth2.credentials import Credentials

    client = genai.Client(
        vertexai=True,
        project=os.environ["PROJECT_ID"],
        location="global",
        credentials=Credentials("gateway-managed"),
        http_options=types.HttpOptions(
            base_url=f"https://{os.environ['APIGEE_HOSTNAME']}/ai-gateway",
            headers={"x-api-key": os.environ["API_KEY"]},
        ),
    )

    resp = client.models.generate_content(
        model="gemini-4-hydrogen",
        contents="Explain API gateways in one sentence.",
    )
    print(resp.text)
    ```

=== "Embeddings SDK (`/v1/embeddings`)"

    Generate vector embeddings using Agent Platform (`gemini-embedding-001`; retired `text-embedding-005` also supported as a backward-compatible alias) or OpenAI (`text-embedding-3-small`):

    ```bash
    curl -X POST "https://$APIGEE_HOSTNAME/v1/embeddings" \
      -H "x-apikey: $API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "model": "gemini-embedding-001",
        "input": ["Apigee Enterprise AI Gateway"]
      }'
    ```

---

## 4. Next Steps: Layer On Enterprise Governance

Explore the **Guides** tab to enable enterprise controls via `values.yaml`:

1. **[AI Products, Tenancy & Auth](../architecture/security.md):** Define AI Products (`lead-ai-engineer`, `power-developer`, `developer-default`, `autonomous-agent`) and connect Corporate SSO, API Keys, or Google Cloud Agent tokens.
2. **[Models & Providers](../template-guide/custom-urls.md):** Add Agent Platform Open & Partner MaaS (`llama-4-maverick-17b-128e-instruct-maas`, `mistralai/*`), Direct OpenAI (`api.openai.com`), Claude Platform (`api.anthropic.com`), Microsoft Foundry (formerly Azure OpenAI), or self-hosted endpoints using Apigee PropertySet key references.
3. **[Quotas, Budgets & Cost Control](../architecture/monetization.md):** Configure per-user and per-model token quotas, shared team budgets, temporary exceptions, and **Invoice-Accurate Cost Attribution**.
4. **[Smart Routing & Content Safety](../architecture/routing.md):** Enable model aliases, cost tiers, automatic complexity routing (`auto:judge`), and Google Cloud Model Armor.
