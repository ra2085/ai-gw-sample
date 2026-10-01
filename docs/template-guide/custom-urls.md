# Custom Providers, MaaS, Direct OpenAI & Embeddings

The Apigee AI Gateway lets you route requests across **Google Vertex AI (Gemini & Claude)**, **Vertex AI Model Garden MaaS (Llama, Mistral)**, **Direct OpenAI (`api.openai.com`)**, **Azure OpenAI**, **DeepSeek**, and **self-hosted clusters (vLLM, Ollama)**—all while allowing developers to use whichever client SDK they prefer.

---

## 1. Quick Decision Matrix: How to Configure Your Model

| Backend Provider | `publisher` | `format` | Target Endpoint Used | Auth Mechanism |
| :--- | :--- | :---: | :--- | :--- |
| **Google Gemini (Vertex AI)** | `google` | `gemini` | `gemini` / `gemini-native-target` | Vertex IAM (`<GoogleAccessToken>`) |
| **Anthropic Claude (Vertex AI)** | `anthropic` | `anthropic` | `claude` (`:streamRawPredict`) | Vertex IAM (`<GoogleAccessToken>`) |
| **Vertex Model Garden MaaS**<br>*(Llama 3.3, Mistral, Codestral)* | `meta`, `mistralai` | `openai` | `gemini-openai-compat` (`endpoints/openapi`) | Vertex IAM (`<GoogleAccessToken>`) |
| **Direct OpenAI**<br>*(`api.openai.com`)* | `openai` | `openai` | `openai-custom` | Per-Client App/Product `openai_api_key` or `config.properties` |
| **Self-Hosted / 3rd Party OpenAI**<br>*(vLLM, Ollama, DeepSeek, Azure)* | `custom`, `azure`, `deepseek` | `openai` | `openai-custom` (via `custom_url`) | `Bearer` token, custom header (`api-key`), or `token_ref` |
| **Direct Anthropic API**<br>*(`api.anthropic.com`)* | `anthropic` | `anthropic` | `claude` (via `custom_url`) | `x-api-key` custom header |

> [!TIP]
> **Automatic Target Selection:** You do not need to manually specify `target` in `values.yaml`. The Smart Router (`resolve_model_location.js`) automatically selects the right Apigee TargetEndpoint based on `publisher`, `format`, and `custom_url`.

---

## 2. Configuration Recipes by Provider

### Pattern A: Vertex AI Model Garden MaaS (Llama 3.3, Mistral, Codestral)

Vertex AI Model Garden Partner Models-as-a-Service (MaaS) expose an OpenAI-compatible chat completions endpoint on Vertex AI (`https://{region}-aiplatform.googleapis.com/v1/projects/{project}/locations/{region}/endpoints/openapi/chat/completions`) where the model payload field must be prefixed with `{publisher}/{model_id}` (e.g., `meta/llama-3.3-70b-instruct-maas` or `mistralai/mistral-small-2503@001`).

The AI Gateway automates this completely:

```yaml
models:
  - name: "llama-3.3-70b-instruct-maas"
    displayName: "Meta Llama 3.3 70B Instruct (Vertex MaaS)"
    publisher: "meta"
    format: "openai"
    region: "us-central1"
    pricing:
      input_rate: 0.720
      output_rate: 0.720

  - name: "mistral-small-2503@001"
    displayName: "Mistral Small 3 (Vertex MaaS)"
    publisher: "mistralai"
    format: "openai"
    region: "us-central1"
    pricing:
      input_rate: 0.100
      output_rate: 0.300
```

* When a client requests `"model": "llama-3.3-70b-instruct-maas"` (or `"meta/llama-3.3-70b-instruct-maas"`), the gateway routes to `us-central1-aiplatform.googleapis.com`, authenticates with the proxy's Google Cloud Service Account, and rewrites the upstream model identifier to `meta/llama-3.3-70b-instruct-maas`.

---

### Pattern B: Direct OpenAI (`api.openai.com`) with Per-Client Key Isolation

To route models like `gpt-5.4`, `gpt-5.4-mini`, `o3-mini`, or `text-embedding-3-small` directly to OpenAI (`https://api.openai.com/v1/chat/completions` or `/v1/embeddings`) without leaking client credentials:

```yaml
models:
  - name: "gpt-5.4"
    displayName: "OpenAI GPT-5.4 (Direct)"
    publisher: "openai"
    format: "openai"
    custom_url: "https://api.openai.com/v1/chat/completions"
    auth:
      type: "bearer"
      token_ref: "propertyset.config.openai_api_key"
    pricing:
      input_rate: 2.500
      output_rate: 10.000
      cache_read_rate: 0.625      # 0.25x cached prompt token discount
```

#### Per-Team / Per-Department OpenAI Key Isolation
In large enterprises, different business units often have their own OpenAI billing organizations, project IDs, or API keys. Instead of deploying separate proxies, `resolve_model_location.js` dynamically resolves OpenAI credentials using a **4-tier precedence hierarchy**:

1. **Developer App Custom Attributes:** `openai_api_key`, `openai_org_id`, `openai_project_id`
2. **Developer Custom Attributes:** `openai_api_key`, `openai_org_id`, `openai_project_id`
3. **API Product Custom Attributes:** `openai_api_key`, `openai_org_id`, `openai_project_id`
4. **Gateway PropertySet Fallback:** `propertyset.config.openai_api_key`, `openai_org_id`, `openai_project_id`

The `openai-custom` TargetEndpoint (`AM-SetOpenAIAuth`) then injects `Authorization: Bearer {target_auth_token}`, `OpenAI-Organization: {openai_org_id}`, and `OpenAI-Project: {openai_project_id}` into the outbound call to `api.openai.com`.

---

### Pattern C: Vector Embeddings (`POST /v1/embeddings`)

The gateway provides a dedicated `/v1/embeddings` ProxyEndpoint that accepts standard OpenAI Embeddings requests (`{"model": "...", "input": "...", "dimensions": 768}`) and supports both **Google Vertex AI embeddings** and **OpenAI-compatible embeddings**:

```yaml
models:
  # 1. Google Vertex AI Embeddings (Automatically transcoded to/from Vertex :predict)
  - name: "text-embedding-005"
    displayName: "Vertex AI Text Embedding 005"
    publisher: "google"
    format: "gemini"
    region: "us-central1"
    pricing:
      input_rate: 0.025
      output_rate: 0.000

  # 2. Direct OpenAI Embeddings (Native passthrough to api.openai.com/v1/embeddings)
  - name: "text-embedding-3-small"
    displayName: "OpenAI Text Embedding 3 Small"
    publisher: "openai"
    format: "openai"
    custom_url: "https://api.openai.com/v1/embeddings"
    auth:
      type: "bearer"
      token_ref: "propertyset.config.openai_api_key"
    pricing:
      input_rate: 0.020
      output_rate: 0.000
```

* **How Vertex AI Embeddings Transcoding Works:** When a client calls `POST /v1/embeddings` with `"model": "text-embedding-005"`, `JS-openai-to-vertex-embeddings` converts `input` (string or array of strings) into Vertex AI `instances: [{"content": "..."}]` and maps `dimensions` to `parameters.outputDimensionality`. On response, `JS-vertex-to-openai-embeddings` converts Vertex `predictions[].embeddings.values` and `statistics.token_count` back into an OpenAI `list` of `embedding` objects with accurate `usage.prompt_tokens` for Apigee Quota and Monetization!

---

### Pattern D: Self-Hosted LLMs (vLLM / Kubernetes / Ollama)
Point an OpenAI-compatible endpoint directly to your internal cluster:

```yaml
models:
  - name: "llama-3-70b"
    displayName: "Meta Llama 3 70B (vLLM Cluster)"
    publisher: "meta"
    format: "openai"
    custom_url: "https://vllm.internal.corp/v1/chat/completions"
    auth:
      type: "bearer"
      token: "sk-internal-vllm-secret-token"
    pricing:
      input_rate: 0.050
      output_rate: 0.150
```

---

### Pattern E: Azure OpenAI & DeepSeek API

=== "Azure OpenAI (`api-key` header)"
    ```yaml
    models:
      - name: "azure-gpt-4o"
        displayName: "GPT-4o (Azure OpenAI)"
        publisher: "azure"
        format: "openai"
        custom_url: "https://my-resource.openai.azure.com/openai/deployments/gpt-4o/chat/completions?api-version=2024-08-01-preview"
        auth:
          type: "header"
          header_name: "api-key"
          token: "azure-secret-api-key-123"
        pricing:
          input_rate: 2.500
          output_rate: 10.000
    ```

=== "DeepSeek API (`Bearer` token)"
    ```yaml
    models:
      - name: "deepseek-r1"
        displayName: "DeepSeek R1 (API)"
        publisher: "deepseek"
        format: "openai"
        custom_url: "https://api.deepseek.com/v1/chat/completions"
        auth:
          type: "bearer"
          token: "sk-deepseek-api-key"
        pricing:
          input_rate: 0.550
          output_rate: 2.190
    ```

---

## 3. Cross-Protocol 4×3 Transcoding Matrix

Regardless of how a model is hosted, clients can interact with it using their preferred SDK:

| Ingress Client Endpoint | Target Backend: **OpenAI**<br>*(OpenAI / MaaS / vLLM / Azure)* | Target Backend: **Anthropic**<br>*(Vertex Claude / Claude Direct)* | Target Backend: **Gemini**<br>*(Google Vertex AI)* |
| :--- | :---: | :---: | :---: |
| **Claude SDK / Claude Code**<br>`POST /v1/messages` | ✅ **Full Transcoding**<br>*(Claude &harr; OpenAI schema + SSE)* | ✅ **Native Passthrough**<br>*(Direct routing + auth injection)* | ✅ **Full Transcoding**<br>*(Claude &harr; Gemini schema + SSE)* |
| **OpenAI SDK / Codex**<br>`POST /v1/chat/completions` | ✅ **Native Passthrough**<br>*(Direct routing + auth injection)* | ✅ **Full Transcoding**<br>*(OpenAI &harr; Claude schema + SSE)* | ✅ **Full Transcoding**<br>*(OpenAI &harr; Gemini schema + SSE)* |
| **Embeddings SDK**<br>`POST /v1/embeddings` | ✅ **Native Passthrough**<br>*(OpenAI / vLLM `/v1/embeddings`)* | N/A | ✅ **Full Transcoding**<br>*(OpenAI &harr; Vertex `:predict`)* |
| **Vertex AI / ADK SDK**<br>`POST /ai-gateway` | ℹ️ **Via OpenAI Endpoint**<br>*(Use `/v1/chat/completions`)* | ✅ **Native Passthrough**<br>*(Direct to Claude `:rawPredict`)* | ✅ **Native Passthrough**<br>*(Direct to Gemini `:generateContent`)* |
