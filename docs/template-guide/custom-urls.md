# 🌐 Custom URLs & Multi-Protocol Routing

The AI Gateway template allows you to route requests to **self-hosted models**, **third-party providers**, and **regional cloud endpoints** while preserving full client compatibility.

---

## 1. Custom Endpoint Patterns

### Pattern A: Self-Hosted LLMs (vLLM, Ollama, Groq)
Point an OpenAI-compatible endpoint directly to your internal cluster:

```yaml
models:
  - name: "custom-llama-3"
    displayName: "Llama 3 70B (vLLM Cluster)"
    publisher: "custom"
    target: "gemini-openai-compat"
    format: "openai"
    custom_url: "https://vllm.internal.corp/v1/chat/completions"
    auth:
      type: "bearer"
      token_ref: "propertyset.config.vllm_api_key"
    pricing:
      input_rate: 0.050
      output_rate: 0.150
```

---

### Pattern B: Azure OpenAI Deployments
Connect to an Azure OpenAI deployment using custom headers:

```yaml
models:
  - name: "azure-gpt-4o"
    displayName: "GPT-4o (Azure OpenAI)"
    publisher: "azure"
    target: "gemini-openai-compat"
    format: "openai"
    custom_url: "https://my-resource.openai.azure.com/openai/deployments/gpt-4o/chat/completions?api-version=2024-08-01-preview"
    auth:
      type: "header"
      header_name: "api-key"
      token_ref: "propertyset.config.azure_api_key"
    pricing:
      input_rate: 2.500
      output_rate: 10.000
```

---

### Pattern C: Regional Vertex AI Endpoints
Route compliance-sensitive workloads to specific GCP regions:

```yaml
models:
  - name: "gemini-2.5-pro-eu"
    displayName: "Gemini 2.5 Pro (Europe)"
    publisher: "google"
    target: "gemini"
    format: "gemini"
    region: "europe-west1"      # Resolves to europe-west1-aiplatform.googleapis.com
    pricing:
      input_rate: 1.250
      output_rate: 5.000
```

---

## 2. API Formats & Dynamic Transcoding

| Format Value | Expected Backend Protocol | Transcoding Behavior |
| :--- | :--- | :--- |
| **`openai`** | OpenAI `/v1/chat/completions` schema | Pass-through for OpenAI clients; transcoded for Claude clients. |
| **`anthropic`** | Anthropic `/v1/messages` schema | Pass-through for Claude clients; headers injected. |
| **`gemini`** | Vertex AI `:generateContent` / `:streamGenerateContent` | Transcoded from Claude/OpenAI into native Gemini format. |
| **`passthrough`** | Raw HTTP passthrough | Bypasses schema conversion policies completely. |
