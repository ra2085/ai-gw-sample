# Quickstart: 5-Minute Minimal Template

Want to get an enterprise-grade AI Gateway up and running immediately? You don't need to touch complex XML policies or configure dozens of separate files.

With the **AI Gateway Template**, a simple **15-line YAML file** is all you need to generate a full, production-ready Apigee gateway with universal protocol normalization, token monetization, and custom backend model routing.

> [!IMPORTANT]
> **Prerequisites:** Before deploying, make sure you have completed all setup steps in the **[Installation & Setup Guide](installation.md)**:
> 1. Installed CLI tools (`apigee-go-gen` and `apigeecli`).
> 2. Authenticated with Google Cloud (`gcloud auth login` & `gcloud auth application-default login`).
> 3. Created the deployment Service Account (`roles/aiplatform.user`).
> 4. Created the **9 required telemetry Data Collectors** in your Apigee organization.


---

## 1. The Minimal `values.quickstart.yaml`


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

## 2. Compile the Proxy Bundle

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
    Bundle["Compiled Apigee Bundle<br/>• 5 Proxy Endpoints (/v1/messages, /v1/chat/completions, /v1/embeddings, /ai-gateway, /v1/models)<br/>• 5 Target Endpoints with IAM & Custom Auth<br/>• 4-Option Auth, Quota, and Translation Policies<br/>• Dynamic Propertysets & Micro-Cost Rating Engine<br/>• Streaming EventFlow SSE Handlers"]

    YAML --> Engine
    Engine --> Bundle
```

---

## 3. Deploy to Apigee

> [!TIP]
> **First-time deployment in this organization?** Ensure the 9 required telemetry Data Collectors exist:
> ```bash
> for dc in "dc_prompt_token_count:INTEGER" "dc_completion_token_count:INTEGER" "dc_total_token_count:INTEGER" "dc_model:STRING" "dc_requested_model:STRING" "dc_tx_cost_usd:FLOAT" "dc_identity_user_id:STRING" "dc_identity_persona:STRING" "dc_identity_team:STRING"; do
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

## 4. Test Your Gateway Across Any SDK

Once deployed, any client SDK or CLI tool (`Claude Code`, `Codex`, OpenAI SDK, Anthropic SDK, Google GenAI SDK) can immediately communicate with your models:

=== "Anthropic SDK / Claude Code (`POST /v1/messages`)"
    ```bash
    # Call Gemini, Claude, or OpenAI using Anthropic Messages format
    # Supports both x-apikey and x-api-key headers!
    curl -X POST "https://$APIGEE_HOSTNAME/v1/messages" \
      -H "x-api-key: $API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "model": "gemini-2.5-flash",
        "max_tokens": 256,
        "messages": [{"role": "user", "content": "Explain quantum computing in one sentence."}]
      }'
    ```

=== "OpenAI SDK / Codex (`POST /v1/chat/completions`)"
    ```bash
    # Call Gemini, Claude, or OpenAI using OpenAI Chat Completions format
    curl -X POST "https://$APIGEE_HOSTNAME/v1/chat/completions" \
      -H "x-apikey: $API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "model": "claude-haiku-4-5",
        "messages": [{"role": "user", "content": "Write a haiku about API gateways."}]
      }'
    ```

=== "Embeddings (`POST /v1/embeddings`)"
    ```bash
    # Generate vector embeddings using Vertex AI text-embedding-005 or OpenAI text-embedding-3-small
    curl -X POST "https://$APIGEE_HOSTNAME/v1/embeddings" \
      -H "x-apikey: $API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "model": "text-embedding-005",
        "input": ["Apigee Enterprise AI Gateway"]
      }'
    ```

---

## 5. Next Steps: Layer On Enterprise Governance

Ready to add enterprise controls? Follow the progressive adoption guides:

1. **[Custom Providers, MaaS & Direct OpenAI](../template-guide/custom-urls.md):** Add Vertex Model Garden MaaS (`meta/llama-*`, `mistralai/*`), Direct OpenAI (`api.openai.com` with per-client key isolation), or self-hosted vLLM endpoints.
2. **[Enterprise Auth & Persona Token Import](../architecture/security.md):** Configure 4-Option Zero-Passthrough Auth (API Keys, Apigee OAuth, GCP Agent Identity, or Enterprise IdP Token Import mapped to low-cardinality Persona API Products).
3. **[Quotas, Team Budgets & Monetization](../architecture/monetization.md):** Enforce per-model quotas, shared team token pools, time-bound individual exceptions, burst/concurrency rate limits, and cache/reasoning-aware token pricing.

