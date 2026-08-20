# Quickstart: 5-Minute Minimal Template

Want to get an enterprise-grade AI Gateway up and running immediately? You don't need to touch complex XML policies or configure dozens of separate files.

With the **AI Gateway Template**, a simple **15-line YAML file** is all you need to generate a full, production-ready Apigee gateway with universal protocol normalization, token monetization, and custom backend model routing.

> [!IMPORTANT]
> **Prerequisites:** Before deploying, make sure you have completed all setup steps in the **[Installation & Setup Guide](installation.md)**:
> 1. Installed CLI tools (`apigee-go-gen` and `apigeecli`).
> 2. Authenticated with Google Cloud (`gcloud auth login` & `gcloud auth application-default login`).
> 3. Created the deployment Service Account (`roles/aiplatform.user`).
> 4. Created the 6 required telemetry Data Collectors in your Apigee organization.


---

## The Minimal `values.quickstart.yaml`


```yaml
gateway:
  name: "ai-gateway-quickstart"
  project_id: "your-gcp-project-id"

models:
  # 1. Google Gemini on Vertex AI
  - name: "gemini-2.5-flash"
    displayName: "Gemini 2.5 Flash"
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

  # 3. Optional: Self-Hosted Model (OpenAI format)
  - name: "my-vllm-model"
    displayName: "Llama 3 (Self-Hosted)"
    format: "openai"
    custom_url: "https://vllm.internal.corp/v1/chat/completions"
```

---

## What Happens Under the Hood

When you execute:

```bash
apigee-go-gen render apiproxy \
    --template ./templates/ai-gateway/apiproxy.yaml \
    --values ./templates/ai-gateway/values.quickstart.yaml \
    --output ./out/ai-gateway.zip
```

`apigee-go-gen` automatically compiles your YAML into a complete **Apigee API proxy bundle**:

```mermaid
graph LR
    YAML["values.quickstart.yaml<br/>(15 lines of simple YAML)"]
    Engine["apigee-go-gen"]
    Bundle["Compiled Apigee Bundle<br/>• 4 Proxy Endpoints (/v1/messages, /ai-gateway, /v1/chat/completions, /v1/models)<br/>• 4 Target Endpoints with IAM Token Auth<br/>• Security, Quota, and Translation Policies<br/>• Dynamic Propertysets & Micro-Cost Rating Engine<br/>• Streaming EventFlow SSE Handlers"]

    YAML --> Engine
    Engine --> Bundle
```

---

## Deploy to Apigee

> [!TIP]
> **First-time deployment in this organization?** Ensure the 6 required telemetry Data Collectors exist:
> ```bash
> for dc in "dc_prompt_token_count:INTEGER" "dc_completion_token_count:INTEGER" "dc_total_token_count:INTEGER" "dc_model:STRING" "dc_requested_model:STRING" "dc_tx_cost_usd:FLOAT"; do
>   IFS=":" read -r name type <<< "$dc"
>   apigeecli datacollectors create -o "$PROJECT_ID" -n "$name" -p "$type" --default-token || true
> done
> ```

Deploy the generated `.zip` bundle to your Apigee environment. A Service Account with the **Vertex AI User** role (`roles/aiplatform.user`) is required at deploy time (`-s` / `--sa`) because the proxy's TargetEndpoints use Google Cloud IAM authentication to call Vertex AI:

```bash
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
```



---

## Test Your Gateway

Now, any client SDK can communicate with your models:

```bash
# Call Gemini or Claude using Anthropic SDK format
curl -X POST "https://$APIGEE_HOSTNAME/v1/messages" \
  -H "x-apikey: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-2.5-flash",
    "messages": [{"role": "user", "content": "Explain quantum computing in one sentence."}]
  }'
```

