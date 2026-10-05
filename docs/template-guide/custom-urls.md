# Models & Provider Recipes

Add any model to your gateway by declaring it under the `models:` list in [`values.yaml`](https://github.com/ra2085/ai-gw-sample/blob/main/templates/ai-gateway/values.yaml). Once added, the model is automatically registered in the `/v1/models` catalog and accessible from **any client SDK** (`Claude Code`, `Codex`, Anthropic SDK, OpenAI SDK, or Vertex AI SDK)—the gateway handles protocol translation, streaming SSE conversion, and token accounting automatically.

---

## 1. Quick Recipes by Provider

Select a provider recipe below to copy its `values.yaml` configuration:

=== "1. Google Gemini (Vertex AI)"
    **How it works:** Uses your gateway's attached Google Cloud Service Account (`roles/aiplatform.user`)—**no API keys required**.

    ```yaml
    models:
      # Gemini 3.5 Flash (Global Endpoint)
      - name: "gemini-3.5-flash"
        displayName: "Gemini 3.5 Flash"
        publisher: "google"
        target: "gemini"
        format: "gemini"
        region: "global"                  # Or a specific region such as "us-central1" / "europe-west1"
        is_default: true
        pricing:
          input_rate: 1.500               # $1.50 / 1M input tokens
          output_rate: 9.000              # $9.00 / 1M output & reasoning tokens
          cache_read_rate: 0.150          # $0.15 / 1M cached input tokens (0.10x)

      # Gemini 3.1 Pro Preview (Frontier Coding & Reasoning)
      - name: "gemini-3.1-pro-preview"
        displayName: "Gemini 3.1 Pro Preview"
        publisher: "google"
        target: "gemini"
        format: "gemini"
        region: "global"
        pricing:
          input_rate: 2.000               # $2.00 / 1M input tokens (<= 200K context)
          output_rate: 12.000             # $12.00 / 1M output & reasoning tokens
          cache_read_rate: 0.200          # $0.20 / 1M cached input tokens (0.10x)

      # Gemini 3.1 Flash-Lite (High-Throughput / Low-Cost Tier)
      - name: "gemini-3.1-flash-lite"
        displayName: "Gemini 3.1 Flash-Lite"
        publisher: "google"
        target: "gemini"
        format: "gemini"
        region: "global"
        pricing:
          input_rate: 0.250               # $0.25 / 1M input tokens
          output_rate: 1.500              # $1.50 / 1M output & reasoning tokens
          cache_read_rate: 0.025          # $0.025 / 1M cached input tokens (0.10x)
    ```

=== "2. Anthropic Claude (Vertex AI)"
    **How it works:** Routes to Anthropic Claude partner models on Google Cloud Vertex AI (`:rawPredict` / `:streamRawPredict`) using your gateway's attached GCP Service Account. The gateway automatically injects `"anthropic_version": "vertex-2023-10-16"` into the request payload and strips `"model"` from the body as required by Vertex AI.

    > **Global vs. Regional Endpoint Pricing:** On Vertex AI, `region: "global"` uses base pricing. Regional endpoints (`us-east5`, `europe-west1`) carry a **10% regional uplift (`1.1x`)** for Claude 4.5+ models.

    ```yaml
    models:
      # Claude Sonnet 4.6 on Vertex AI
      - name: "claude-sonnet-4-6"
        displayName: "Claude Sonnet 4.6"
        publisher: "anthropic"
        target: "claude"
        format: "anthropic"
        region: "global"                  # Or "us-east5" / "europe-west1" for regional data residency
        pricing:
          input_rate: 3.000               # $3.00 / 1M input tokens ($3.30 regional)
          output_rate: 15.000             # $15.00 / 1M output tokens ($16.50 regional)
          cache_read_rate: 0.300          # $0.30 / 1M cache hit tokens (0.10x)
          cache_write_rate: 3.750         # $3.75 / 1M 5m cache write tokens (1.25x)

      # Claude Haiku 4.5 on Vertex AI
      - name: "claude-haiku-4-5"
        displayName: "Claude Haiku 4.5"
        publisher: "anthropic"
        target: "claude"
        format: "anthropic"
        region: "us-east5"
        pricing:
          input_rate: 1.000               # $1.00 / 1M input tokens ($1.10 regional)
          output_rate: 5.000              # $5.00 / 1M output tokens ($5.50 regional)
          cache_read_rate: 0.100          # $0.10 / 1M cache hit tokens (0.10x)
          cache_write_rate: 1.250         # $1.25 / 1M 5m cache write tokens (1.25x)
    ```

=== "3. Direct Anthropic (`api.anthropic.com`) & BYO Claude"
    **How it works:** Routes directly to Anthropic's first-party API (`https://api.anthropic.com/v1/messages`) or a custom Anthropic-compatible proxy (e.g., AWS Bedrock gateway / LiteLLM):

    * **Authentication (`x-api-key` + `token_ref`):** Direct Anthropic authenticates via the `x-api-key` HTTP header. Use `auth.token_ref` to reference the secret from an Apigee API Product custom attribute or Environment PropertySet rather than hardcoding the key in Git.
    * **Workspace Isolation:** Unlike OpenAI, Anthropic does not use organization/project headers—each Anthropic API key (`sk-ant-api03-...`) is already bound to a specific **Anthropic Workspace** in the Anthropic Console.
    * **Headers & Model ID (`anthropic_version`, `anthropic_beta`, `upstream_model`):** When `custom_url` is set, the gateway automatically sets the `anthropic-version: 2023-06-01` HTTP header, omits `vertex-2023-10-16` from the JSON body for `api.anthropic.com`, optionally injects `anthropic-beta` headers, and preserves/rewrites `"model"` in the JSON payload.

    ```yaml
    models:
      # Direct Anthropic API (api.anthropic.com)
      - name: "claude-direct-sonnet"
        displayName: "Claude Sonnet 4.6 (Direct Anthropic API)"
        publisher: "anthropic"
        target: "claude"
        format: "anthropic"
        custom_url: "https://api.anthropic.com/v1/messages"
        upstream_model: "claude-sonnet-4-6"               # Model ID sent in the outbound JSON body
        anthropic_version: "2023-06-01"                   # Sets anthropic-version HTTP header (default: 2023-06-01)
        anthropic_beta: "prompt-caching-2024-07-31"       # Optional: injects anthropic-beta HTTP header
        auth:
          type: "header"
          header_name: "x-api-key"
          token_ref: "verifyapikey.VA-ApiKey.apiproduct.anthropic_api_key"
          # token: "sk-ant-..."                           # Optional literal fallback (for local/dev testing only)
        pricing:
          input_rate: 3.000
          output_rate: 15.000
          cache_read_rate: 0.300
          cache_write_rate: 3.750
    ```

=== "4. Direct OpenAI (`api.openai.com`)"
    **How it works:** Routes to OpenAI (`https://api.openai.com/v1/chat/completions`) while keeping OpenAI API keys managed centrally in Apigee:

    * **Authentication (`bearer` + `token_ref`):** Injects `Authorization: Bearer <token>` resolved from `auth.token_ref` (or per-client/per-product custom attributes).
    * **Are `openai_org_id` and `openai_project_id` needed?**
        * **With modern Project API Keys (`sk-proj-...`):** **No.** Modern OpenAI Project keys are already cryptographically scoped to a single Organization and Project inside OpenAI.
        * **With legacy User/Admin Keys (`sk-...`):** **Optional.** If a single legacy key spans multiple OpenAI organizations or projects, you can set `openai_org_id` and `openai_project_id` on the model (or as custom attributes on the Apigee **API Product** / **Developer App**) to inject `OpenAI-Organization` and `OpenAI-Project` headers on outbound requests.

    ```yaml
    models:
      # OpenAI GPT-5.4
      - name: "gpt-5.4"
        displayName: "OpenAI GPT-5.4"
        publisher: "openai"
        target: "openai-custom"
        format: "openai"
        custom_url: "https://api.openai.com/v1/chat/completions"
        # Optional: only needed when using legacy multi-project keys instead of sk-proj-* keys
        # openai_org_id: "org-your-openai-org"
        # openai_project_id: "proj-your-openai-project"
        auth:
          type: "bearer"
          token_ref: "verifyapikey.VA-ApiKey.apiproduct.openai_api_key"
          # token: "sk-proj-..."                          # Optional literal fallback (for local/dev testing only)
        pricing:
          input_rate: 2.500                               # $2.50 / 1M input tokens
          output_rate: 15.000                             # $15.00 / 1M output tokens
          cache_read_rate: 0.250                          # $0.25 / 1M cached input tokens (0.10x)

      # OpenAI GPT-4o Mini
      - name: "gpt-4o-mini"
        displayName: "OpenAI GPT-4o Mini"
        publisher: "openai"
        target: "openai-custom"
        format: "openai"
        custom_url: "https://api.openai.com/v1/chat/completions"
        auth:
          type: "bearer"
          token_ref: "verifyapikey.VA-ApiKey.apiproduct.openai_api_key"
        pricing:
          input_rate: 0.150                               # $0.15 / 1M input tokens
          output_rate: 0.600                               # $0.60 / 1M output tokens
          cache_read_rate: 0.075                          # $0.075 / 1M cached input tokens
    ```

=== "5. Vertex Model Garden MaaS (Llama, Mistral, Qwen)"
    **How it works:** Connects to Partner Models-as-a-Service (MaaS) on Vertex AI OpenAI-compatible endpoints (`endpoints/openapi/chat/completions`) using your gateway's GCP Service Account—no API keys needed. Simply set `publisher` (`meta`, `mistralai`, `qwen`, etc.) and `format: "openai"`:

    ```yaml
    models:
      # Meta Llama 4 Maverick (17B 128E)
      - name: "llama-4-maverick-17b-128e-instruct-maas"
        displayName: "Meta Llama 4 Maverick"
        publisher: "meta"
        target: "gemini-openai-compat"
        format: "openai"
        region: "us-east5"
        pricing:
          input_rate: 0.350               # $0.35 / 1M input tokens
          output_rate: 1.150              # $1.15 / 1M output tokens

      # Meta Llama 3.3 70B Instruct
      - name: "llama-3.3-70b-instruct-maas"
        displayName: "Meta Llama 3.3 70B Instruct"
        publisher: "meta"
        target: "gemini-openai-compat"
        format: "openai"
        region: "us-central1"
        pricing:
          input_rate: 0.720               # $0.72 / 1M input tokens
          output_rate: 0.720              # $0.72 / 1M output tokens

      # Mistral Small 3.1 (25.03)
      - name: "mistral-small-2503@001"
        displayName: "Mistral Small 3.1"
        publisher: "mistralai"
        target: "gemini-openai-compat"
        format: "openai"
        region: "us-central1"
        pricing:
          input_rate: 0.100               # $0.10 / 1M input tokens
          output_rate: 0.300              # $0.30 / 1M output tokens
    ```

=== "6. Self-Hosted (vLLM / Ollama) & Azure OpenAI"
    **How it works:** Point `custom_url` to any self-hosted cluster (vLLM, Ollama, TGI, Cloud Run, GKE) or third-party OpenAI-compatible provider (Azure OpenAI, DeepSeek, Groq). Use `upstream_model` if the model identifier expected by your backend differs from the catalog name exposed to clients:

    ```yaml
    models:
      # 1. Self-Hosted vLLM / Ollama Cluster (Bearer Token Reference)
      - name: "llama-3-70b-internal"
        displayName: "Llama 3 70B (Internal vLLM)"
        publisher: "custom"
        target: "openai-custom"
        format: "openai"
        custom_url: "https://vllm.internal.corp/v1/chat/completions"
        upstream_model: "meta-llama/Meta-Llama-3-70B-Instruct"
        auth:
          type: "bearer"
          token_ref: "verifyapikey.VA-ApiKey.apiproduct.vllm_api_key"
        pricing:
          input_rate: 0.050
          output_rate: 0.150

      # 2. Azure OpenAI Deployment (Custom "api-key" Header Reference)
      - name: "azure-gpt-4o"
        displayName: "GPT-4o (Azure OpenAI)"
        publisher: "azure"
        target: "openai-custom"
        format: "openai"
        custom_url: "https://my-resource.openai.azure.com/openai/deployments/gpt-4o/chat/completions?api-version=2024-08-01-preview"
        auth:
          type: "header"
          header_name: "api-key"
          token_ref: "verifyapikey.VA-ApiKey.apiproduct.azure_api_key"
        pricing:
          input_rate: 2.500
          output_rate: 10.000
          cache_read_rate: 1.250
    ```

=== "7. Vector Embeddings (`/v1/embeddings`)"
    **How it works:** Exposes a single OpenAI-compatible `POST /v1/embeddings` endpoint across both **Google Vertex AI** (automatically translated to/from Vertex `:predict` `{instances: [{content}]}`) and **OpenAI** (`/v1/embeddings`):

    ```yaml
    models:
      # 1. Google Vertex AI Text Embeddings (Translated to/from Vertex :predict)
      - name: "text-embedding-005"
        displayName: "Vertex AI Text Embedding 005"
        publisher: "google"
        target: "gemini-openai-compat"
        format: "gemini"
        region: "us-central1"
        pricing:
          input_rate: 0.025               # $0.025 / 1M input tokens
          output_rate: 0.000

      # 2. Direct OpenAI Embeddings
      - name: "text-embedding-3-small"
        displayName: "OpenAI Text Embedding 3 Small"
        publisher: "openai"
        target: "openai-custom"
        format: "openai"
        custom_url: "https://api.openai.com/v1/embeddings"
        auth:
          type: "bearer"
          token_ref: "verifyapikey.VA-ApiKey.apiproduct.openai_api_key"
        pricing:
          input_rate: 0.020               # $0.02 / 1M input tokens
          output_rate: 0.000
    ```

---

## 2. Managing Upstream API Keys Securely (`token_ref` vs `token`)

For external providers (`api.openai.com`, `api.anthropic.com`, Azure OpenAI, vLLM), **avoid hardcoding plaintext keys in `values.yaml`**. The gateway resolves upstream credentials dynamically per request in the following priority order (emitting the winning tier in the `X-Gateway-Auth-Source` response header):

| Priority | Source (`X-Gateway-Auth-Source`) | How to Configure | Best For |
| :---: | :--- | :--- | :--- |
| **1 (Highest)** | **`client_app`**<br>*(Developer App Attribute)* | Add custom attribute `<model>_api_key` or `<publisher>_api_key` (or `*_api_key_ref`) on the Apigee **Developer App** | Dedicated per-team or per-app BYO provider keys |
| **2** | **`api_product`**<br>*(AI Product Attribute)* | Add custom attribute `<model>_api_key` or `<publisher>_api_key` (e.g., `openai_api_key`, `anthropic_api_key`) on the Apigee **API Product** | Multi-tenant department billing isolation per AI Product |
| **3** | **`model_config`**<br>*(Model `auth.token_ref` / `auth.token`)* | Set `auth.token_ref` on the model in `values.yaml` to any runtime Apigee variable (e.g., `verifyapikey.VA-ApiKey.apiproduct.openai_api_key` or an environment-scoped PropertySet `propertyset.secrets.openai_api_key`). Falls back to `auth.token` if set. | Central gateway key shared across all callers of a model |

---

## 3. Any Client SDK, Any Model

Regardless of which provider hosts a model, developers can call it from their preferred SDK or CLI tool:

| Client Endpoint | Google Gemini & Embeddings | Anthropic Claude (Vertex & Direct) | OpenAI, MaaS & vLLM |
| :--- | :---: | :---: | :---: |
| **`POST /v1/messages`**<br>*(Claude Code, Anthropic SDK)* | Automatic translation | Native format | Automatic translation |
| **`POST /v1/chat/completions`**<br>*(Codex, OpenAI SDK)* | Automatic translation | Automatic translation | Native format |
| **`POST /v1/embeddings`**<br>*(OpenAI Embeddings SDK)* | Automatic translation (`:predict`) | N/A | Native format (`/embeddings`) |
| **`POST /ai-gateway`**<br>*(Vertex AI / Google GenAI SDK)* | Native format | Native format (`:rawPredict`) | Use `/v1/chat/completions` |

