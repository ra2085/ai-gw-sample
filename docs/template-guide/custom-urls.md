# Models & Providers

Add any model to your gateway by declaring it under the `models:` list in `values.yaml`. Once added, the model is automatically registered in the `/v1/models` catalog and accessible from any client SDK (`Claude Code`, `Codex`, Anthropic SDK, OpenAI SDK, or Vertex AI SDK).

---

## 1. Configure Models by Provider

Select a provider tab below to copy its `values.yaml` configuration (with official USD rates per 1M tokens):

=== "Google Gemini (Vertex AI)"
    Uses your gateway's attached Google Cloud Service Account (`roles/aiplatform.user`)—no API keys required.

    ```yaml
    models:
      # Gemini 3.5 Flash (Standard Global)
      - name: "gemini-3.5-flash"
        displayName: "Gemini 3.5 Flash"
        publisher: "google"
        format: "gemini"
        region: "global"                  # Or a specific region such as "us-central1" / "europe-west1"
        is_default: true
        pricing:
          input_rate: 1.500               # $1.50 / 1M input tokens (text, image, video, audio)
          output_rate: 9.000              # $9.00 / 1M output & reasoning tokens
          cache_read_rate: 0.150          # $0.15 / 1M cached input tokens (0.10x)

      # Gemini 3.1 Pro Preview (Standard <= 200K context, Global)
      - name: "gemini-3.1-pro-preview"
        displayName: "Gemini 3.1 Pro Preview"
        publisher: "google"
        format: "gemini"
        region: "global"
        pricing:
          input_rate: 2.000               # $2.00 / 1M input tokens (<= 200K context)
          output_rate: 12.000             # $12.00 / 1M output & reasoning tokens
          cache_read_rate: 0.200          # $0.20 / 1M cached input tokens (0.10x)

      # Gemini 3.1 Flash-Lite (High-throughput / low-cost tier)
      - name: "gemini-3.1-flash-lite"
        displayName: "Gemini 3.1 Flash-Lite"
        publisher: "google"
        format: "gemini"
        region: "global"
        pricing:
          input_rate: 0.250               # $0.25 / 1M input tokens (text, image, video)
          output_rate: 1.500              # $1.50 / 1M output & reasoning tokens
          cache_read_rate: 0.025          # $0.025 / 1M cached input tokens (0.10x)
    ```

=== "Anthropic Claude (Vertex AI)"
    Routes to Anthropic Claude on Google Cloud Vertex AI using your gateway's Service Account.

    > **Global vs. Regional Endpoint Pricing:** On Vertex AI, `region: "global"` uses standard base pricing. Regional endpoints (such as `us-east5` or `europe-west1`) include a **10% regional uplift (`1.1x`)** for Claude 4.5 and newer models.

    ```yaml
    models:
      # Claude Sonnet 4.6 (Global endpoint base pricing)
      - name: "claude-sonnet-4-6"
        displayName: "Claude Sonnet 4.6"
        publisher: "anthropic"
        format: "anthropic"
        region: "global"                  # Use "us-east5" or "europe-west1" for regional residency (1.1x rate)
        pricing:
          input_rate: 3.000               # $3.00 / 1M input tokens ($3.30 regional)
          output_rate: 15.000             # $15.00 / 1M output tokens ($16.50 regional)
          cache_read_rate: 0.300          # $0.30 / 1M cache hit tokens (0.10x)
          cache_write_rate: 3.750         # $3.75 / 1M 5m cache write tokens (1.25x)

      # Claude Opus 4.6 (Global endpoint base pricing)
      - name: "claude-opus-4-6"
        displayName: "Claude Opus 4.6"
        publisher: "anthropic"
        format: "anthropic"
        region: "global"
        pricing:
          input_rate: 5.000               # $5.00 / 1M input tokens ($5.50 regional)
          output_rate: 25.000             # $25.00 / 1M output tokens ($27.50 regional)
          cache_read_rate: 0.500          # $0.50 / 1M cache hit tokens (0.10x)
          cache_write_rate: 6.250         # $6.25 / 1M 5m cache write tokens (1.25x)

      # Claude Haiku 4.5 (Global endpoint base pricing)
      - name: "claude-haiku-4-5"
        displayName: "Claude Haiku 4.5"
        publisher: "anthropic"
        format: "anthropic"
        region: "global"
        pricing:
          input_rate: 1.000               # $1.00 / 1M input tokens ($1.10 regional)
          output_rate: 5.000              # $5.00 / 1M output tokens ($5.50 regional)
          cache_read_rate: 0.100          # $0.10 / 1M cache hit tokens (0.10x)
          cache_write_rate: 1.250         # $1.25 / 1M 5m cache write tokens (1.25x)
    ```

=== "Vertex Model Garden MaaS (Llama & Mistral)"
    Connect to Partner Models-as-a-Service (MaaS) on Vertex AI such as **Meta Llama** and **Mistral**. Simply set `publisher` (`meta` or `mistralai`) and `format: "openai"`:

    ```yaml
    models:
      # Meta Llama 4 Maverick (17B 128E)
      - name: "llama-4-maverick-17b-128e-instruct-maas"
        displayName: "Meta Llama 4 Maverick"
        publisher: "meta"
        format: "openai"
        region: "us-east5"
        pricing:
          input_rate: 0.350               # $0.35 / 1M input tokens
          output_rate: 1.150              # $1.15 / 1M output tokens

      # Meta Llama 3.3 70B Instruct
      - name: "llama-3.3-70b-instruct-maas"
        displayName: "Meta Llama 3.3 70B Instruct"
        publisher: "meta"
        format: "openai"
        region: "us-central1"
        pricing:
          input_rate: 0.720               # $0.72 / 1M input tokens
          output_rate: 0.720              # $0.72 / 1M output tokens

      # Mistral Small 3.1 (25.03)
      - name: "mistral-small-2503@001"
        displayName: "Mistral Small 3.1"
        publisher: "mistralai"
        format: "openai"
        region: "us-central1"
        pricing:
          input_rate: 0.100               # $0.10 / 1M input tokens
          output_rate: 0.300              # $0.30 / 1M output tokens
    ```

=== "Direct OpenAI (`api.openai.com`)"
    Route requests to OpenAI's cloud while keeping OpenAI API keys managed centrally in the gateway rather than distributed to client machines:

    ```yaml
    models:
      # OpenAI GPT-5.4 (Standard <= 272K context)
      - name: "gpt-5.4"
        displayName: "OpenAI GPT-5.4"
        publisher: "openai"
        format: "openai"
        custom_url: "https://api.openai.com/v1/chat/completions"
        auth:
          type: "bearer"
          token_ref: "propertyset.config.openai_api_key"
        pricing:
          input_rate: 2.500               # $2.50 / 1M input tokens
          output_rate: 15.000             # $15.00 / 1M output tokens
          cache_read_rate: 0.250          # $0.25 / 1M cached input tokens (0.10x)

      # OpenAI GPT-5.4 Mini
      - name: "gpt-5.4-mini"
        displayName: "OpenAI GPT-5.4 Mini"
        publisher: "openai"
        format: "openai"
        custom_url: "https://api.openai.com/v1/chat/completions"
        auth:
          type: "bearer"
          token_ref: "propertyset.config.openai_api_key"
        pricing:
          input_rate: 0.750               # $0.75 / 1M input tokens
          output_rate: 4.500              # $4.50 / 1M output tokens
          cache_read_rate: 0.075          # $0.075 / 1M cached input tokens (0.10x)
    ```

    **Multi-Tenant OpenAI Keys (Per-Department Billing Isolation):**
    If different business units have their own OpenAI billing accounts, attach `openai_api_key`, `openai_org_id`, and `openai_project_id` as custom attributes on their **AI Product** (or Developer App). The gateway automatically injects that tenant's credentials and `OpenAI-Organization` / `OpenAI-Project` headers on outbound calls.

=== "Vector Embeddings (`/v1/embeddings`)"
    Expose a unified `/v1/embeddings` endpoint across both **Google Vertex AI** and **OpenAI** embedding models:

    ```yaml
    models:
      # 1. Google Vertex AI Text Embeddings (Automatically translated to/from OpenAI Embeddings format)
      - name: "text-embedding-005"
        displayName: "Vertex AI Text Embedding 005"
        publisher: "google"
        format: "gemini"
        region: "us-central1"
        pricing:
          input_rate: 0.025               # $0.000025 / 1K tokens ($0.025 / 1M tokens)
          output_rate: 0.000

      # 2. Direct OpenAI Embeddings
      - name: "text-embedding-3-small"
        displayName: "OpenAI Text Embedding 3 Small"
        publisher: "openai"
        format: "openai"
        custom_url: "https://api.openai.com/v1/embeddings"
        auth:
          type: "bearer"
          token_ref: "propertyset.config.openai_api_key"
        pricing:
          input_rate: 0.020               # $0.02 / 1M input tokens
          output_rate: 0.000
    ```

=== "Self-Hosted & Third-Party (vLLM, Azure, DeepSeek)"
    Point `custom_url` to any internal cluster (vLLM, Ollama) or external provider (Azure OpenAI, DeepSeek):

    ```yaml
    models:
      # Self-hosted vLLM cluster
      - name: "llama-3-70b-internal"
        displayName: "Llama 3 70B (Internal vLLM)"
        publisher: "custom"
        format: "openai"
        custom_url: "https://vllm.internal.corp/v1/chat/completions"
        auth:
          type: "bearer"
          token: "sk-internal-vllm-token"

      # Azure OpenAI deployment
      - name: "azure-gpt-4o"
        displayName: "GPT-4o (Azure OpenAI)"
        publisher: "azure"
        format: "openai"
        custom_url: "https://my-resource.openai.azure.com/openai/deployments/gpt-4o/chat/completions?api-version=2024-08-01-preview"
        auth:
          type: "header"
          header_name: "api-key"
          token: "azure-secret-key"
    ```

---

## 2. Any Client SDK, Any Model

Regardless of which provider hosts a model, developers can call it from their preferred SDK or CLI tool:

| Client Endpoint | Google Gemini & Embeddings | Anthropic Claude | OpenAI, MaaS & vLLM |
| :--- | :---: | :---: | :---: |
| **`POST /v1/messages`**<br>*(Claude Code, Anthropic SDK)* | Automatic translation | Native format | Automatic translation |
| **`POST /v1/chat/completions`**<br>*(Codex, OpenAI SDK)* | Automatic translation | Automatic translation | Native format |
| **`POST /v1/embeddings`**<br>*(OpenAI Embeddings SDK)* | Automatic translation | N/A | Native format |
| **`POST /ai-gateway`**<br>*(Vertex AI / Google GenAI SDK)* | Native format | Native format | Use `/v1/chat/completions` |
