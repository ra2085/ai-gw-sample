# ⚡ 30-Second AI Gateway: The Minimal Template

Want to get an enterprise-grade AI Gateway up and running immediately? You don't need to touch complex XML policies or configure 30+ separate files.

With the **AI Gateway Template**, a simple **20-line YAML file** is all you need to generate a full, production-ready Apigee gateway with universal protocol normalization, token monetization, and custom backend model routing.

---

## 📄 The 20-Line `values.quickstart.yaml`

```yaml
gateway:
  name: "ai-gateway-quickstart"
  project_id: "your-gcp-project-id"

models:
  # 1. Google Gemini on Vertex AI
  - name: "gemini-2.5-flash"
    displayName: "Gemini 2.5 Flash"
    publisher: "google"
    target: "gemini"
    format: "gemini"
    region: "global"
    is_default: true
    pricing:
      input_rate: 0.100
      output_rate: 0.400

  # 2. Anthropic Claude on Vertex AI
  - name: "claude-haiku-4-5"
    displayName: "Claude 4.5 Haiku"
    publisher: "anthropic"
    target: "claude"
    format: "anthropic"
    region: "us-east5"
    pricing:
      input_rate: 1.000
      output_rate: 5.000

  # 3. Self-Hosted vLLM / Ollama Model (OpenAI format)
  - name: "my-vllm-model"
    displayName: "Llama 3 (Self-Hosted)"
    format: "openai"
    custom_url: "https://vllm.internal.corp/v1/chat/completions"
```

---

## 🪄 The Magic: What Happens Under the Hood

When you execute:

```bash
./apigeegg/apigee-go-gen/bin/apigee-go-gen render apiproxy \
    --template ./templates/ai-gateway/apiproxy.yaml \
    --values ./templates/ai-gateway/values.quickstart.yaml \
    --output ./out/ai-gateway.zip
```

`apigee-go-gen` automatically compiles your 20-line YAML into a complete **77-file Apigee API proxy bundle**:

```mermaid
graph LR
    YAML["values.quickstart.yaml<br/>(20 lines of simple YAML)"]
    Engine["apigee-go-gen"]
    Bundle["Compiled Apigee Bundle (77 files)<br/>• 4 Proxy Endpoints (/v1/messages, /ai-gateway, /v1/chat/completions, /v1/models)<br/>• 4 Target Endpoints with IAM Token Auth<br/>• 38 Security, Quota, and Translation Policies<br/>• Dynamic Propertysets & Micro-Cost Rating Engine<br/>• Streaming EventFlow SSE Handlers"]

    YAML --> Engine
    Engine --> Bundle
```

---

## 🚀 Deploy in One Step

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

## 🧪 Try It Immediately

Now, any client SDK can communicate with your models:

```bash
# Call your self-hosted vLLM or Claude model using Anthropic SDK format!
curl -X POST "https://$APIGEE_HOSTNAME/v1/messages" \
  -H "x-apikey: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-2.5-flash",
    "messages": [{"role": "user", "content": "Explain quantum computing in one sentence."}]
  }'
```
