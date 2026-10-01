# Models & Providers

Add any model to your gateway by declaring it under the `models:` list in `values.yaml`. Once added, the model is automatically registered in the `/v1/models` catalog and accessible from any client SDK (`Claude Code`, `Codex`, Anthropic SDK, OpenAI SDK, or Vertex AI SDK).

---

## 1. Configure Models by Provider

Select a provider tab below to copy its `values.yaml` configuration:

=== "Google Gemini (Vertex AI)"
    Uses your gateway's attached Google Cloud Service Account (`roles/aiplatform.user`)—no API keys required.

    ```yaml
    models:
      - name: "gemini-2.5-flash"
        displayName: "Gemini 2.5 Flash"
        publisher: "google"
        format: "gemini"
        region: "global"                  # Or a specific region such as "europe-west1"
        is_default: true
        pricing:
          input_rate: 0.150
          output_rate: 0.600

      - name: "gemini-2.5-pro"
        displayName: "Gemini 2.5 Pro"
        publisher: "google"
        format: "gemini"
        region: "global"
        pricing:
          input_rate: 1.250
          output_rate: 10.000
          cache_read_rate: 0.3125
    ```

=== "Anthropic Claude (Vertex AI)"
    Routes to Anthropic Claude on Google Cloud Vertex AI using your gateway's Service Account.

    ```yaml
    models:
      - name: "claude-sonnet-4-5"
        displayName: "Claude 4.5 Sonnet"
        publisher: "anthropic"
        format: "anthropic"
        region: "us-east5"
        pricing:
          input_rate: 3.000
          output_rate: 15.000
          cache_read_rate: 0.300
          cache_write_rate: 3.750

      - name: "claude-haiku-4-5"
        displayName: "Claude 4.5 Haiku"
        publisher: "anthropic"
        format: "anthropic"
        region: "us-east5"
        pricing:
          input_rate: 1.000
          output_rate: 5.000
    ```

=== "Vertex Model Garden MaaS (Llama & Mistral)"
    Connect to Partner Models-as-a-Service (MaaS) on Vertex AI such as **Meta Llama** and **Mistral**. Simply set `publisher` (`meta` or `mistralai`) and `format: "openai"`:

    ```yaml
    models:
      - name: "llama-3.3-70b-instruct-maas"
        displayName: "Meta Llama 3.3 70B Instruct"
        publisher: "meta"
        format: "openai"
        region: "us-central1"
        pricing:
          input_rate: 0.720
          output_rate: 0.720

      - name: "mistral-small-2503@001"
        displayName: "Mistral Small 3"
        publisher: "mistralai"
        format: "openai"
        region: "us-central1"
        pricing:
          input_rate: 0.100
          output_rate: 0.300
    ```

=== "Direct OpenAI (`api.openai.com`)"
    Route requests to OpenAI's cloud while keeping OpenAI API keys managed centrally in the gateway rather than distributed to client machines:

    ```yaml
    models:
      - name: "gpt-5.4"
        displayName: "OpenAI GPT-5.4"
        publisher: "openai"
        format: "openai"
        custom_url: "https://api.openai.com/v1/chat/completions"
        auth:
          type: "bearer"
          token_ref: "propertyset.config.openai_api_key"
        pricing:
          input_rate: 2.500
          output_rate: 10.000
          cache_read_rate: 0.625
    ```

    **Multi-Tenant OpenAI Keys (Per-Department Billing Isolation):**
    If different business units have their own OpenAI billing accounts, attach `openai_api_key`, `openai_org_id`, and `openai_project_id` as custom attributes on their **AI Product** (or Developer App). The gateway automatically injects that tenant's credentials and `OpenAI-Organization` / `OpenAI-Project` headers on outbound calls.

=== "Vector Embeddings (`/v1/embeddings`)"
    Expose a unified `/v1/embeddings` endpoint across both **Google Vertex AI** and **OpenAI** embedding models:

    ```yaml
    models:
      # 1. Google Vertex AI Embeddings (Automatically translated to/from OpenAI Embeddings format)
      - name: "text-embedding-005"
        displayName: "Vertex AI Text Embedding 005"
        publisher: "google"
        format: "gemini"
        region: "us-central1"
        pricing:
          input_rate: 0.025
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
          input_rate: 0.020
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
