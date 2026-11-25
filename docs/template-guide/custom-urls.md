# Models & Provider Recipes

Add any model to your gateway by declaring it under the `models:` list in [`values.yaml`](https://github.com/ra2085/ai-gw-sample/blob/main/templates/ai-gateway/values.yaml). Once added, the model is automatically registered in the `/v1/models` catalog and accessible from **any client SDK** (`Claude Code`, `Google Antigravity`, Anthropic SDK, OpenAI SDK, or Google GenAI / **Gemini Enterprise Agent Platform** — formerly Vertex AI — SDK)—the gateway handles protocol translation, streaming SSE conversion, and token accounting automatically.

---

## 1. Quick Recipes by Provider

Select a provider recipe below to copy its `values.yaml` configuration:

=== "1. Google Gemini (Agent Platform)"
    **How it works:** Routes to **Agent Platform** (`aiplatform.googleapis.com`) using your gateway's attached Google Cloud Service Account (`roles/aiplatform.user`)—**no API keys required**.

    > **Global, Multi-Region (`"us"` / `"eu"`), and Regional Endpoints:**
    > * `region: "global"` routes to `aiplatform.googleapis.com` (`locations/global`) for maximum quota capacity.
    > * `region: "us"` (`aiplatform.us.rep.googleapis.com`) and `region: "eu"` (`aiplatform.eu.rep.googleapis.com`) enforce continental multi-region data residency.
    > * Single-region values (such as `"us-central1"` or `"europe-west1"`) route to `<region>-aiplatform.googleapis.com`.

    ```yaml
    models:
      # Gemini 4 Hydrogen (Default Balanced Tier — Global Endpoint)
      - name: "gemini-4-hydrogen"
        displayName: "Gemini 4 Hydrogen"
        publisher: "google"
        target: "gemini"
        format: "gemini"
        region: "global"                  # Supports "global", multi-region "us" / "eu", or regional (e.g., "us-central1")
        is_default: true
        pricing:
          input_rate: 1.500               # $1.50 / 1M input tokens
          output_rate: 7.500              # $7.50 / 1M output & reasoning tokens
          cache_read_rate: 0.150          # $0.15 / 1M cached input tokens

      # Gemini 4 Argon (High Tier — Frontier Coding & Reasoning)
      - name: "gemini-4-argon"
        displayName: "Gemini 4 Argon"
        publisher: "google"
        target: "gemini"
        format: "gemini"
        region: "global"
        pricing:
          input_rate: 4.000               # $4.00 / 1M input tokens
          output_rate: 20.000             # $20.00 / 1M output & reasoning tokens
          cache_read_rate: 0.200          # $0.20 / 1M cached input tokens

      # Gemini 3.5 Flash-Lite (Low Tier — Fallback, Summarization & LLM Judge)
      - name: "gemini-3.5-flash-lite"
        displayName: "Gemini 3.5 Flash-Lite"
        publisher: "google"
        target: "gemini"
        format: "gemini"
        region: "global"
        pricing:
          input_rate: 0.300               # $0.30 / 1M input tokens
          output_rate: 2.500              # $2.50 / 1M output & reasoning tokens
          cache_read_rate: 0.030          # $0.03 / 1M cached input tokens

      # Optional Frontier Enterprise Recipe: Gemini 4 Carbon
      - name: "gemini-4-carbon"
        displayName: "Gemini 4 Carbon (Verified Enterprise)"
        publisher: "google"
        target: "gemini"
        format: "gemini"
        region: "global"                  # Or "us" (aiplatform.us.rep.googleapis.com) / "eu" (aiplatform.eu.rep.googleapis.com)
        pricing:
          input_rate: 2.000               # $2.00 / 1M input tokens
          output_rate: 10.000             # $10.00 / 1M output & reasoning tokens
          cache_read_rate: 0.100          # $0.10 / 1M cached input tokens
    ```

=== "2. Anthropic Claude (Agent Platform)"
    **How it works:** Routes to Anthropic Claude partner models on Google Cloud **Agent Platform** (`:rawPredict` / `:streamRawPredict`) using your gateway's attached GCP Service Account (`roles/aiplatform.user`). The gateway automatically injects `"anthropic_version": "vertex-2023-10-16"` into the request payload and strips `"model"` from the body as required by the upstream API.

    > **Global, Multi-Region (`"us"` / `"eu"`), and Regional Data Residency:** On Agent Platform, `region: "global"` (`aiplatform.googleapis.com`) uses base global pricing, while multi-region `"us"` (`aiplatform.us.rep.googleapis.com`), `"eu"` (`aiplatform.eu.rep.googleapis.com`), and single-region endpoints (`us-east5`, `europe-west1`) enforce geographic data residency (regional/multi-region endpoints may carry a `1.1x` regional pricing uplift).

    ```yaml
    models:
      # Claude Opus 5.5 on Agent Platform (Max Tier)
      - name: "claude-opus-5-5"
        displayName: "Claude Opus 5.5"
        publisher: "anthropic"
        target: "claude"
        format: "anthropic"
        region: "global"                  # Supports "global", multi-region "us" / "eu", or "us-east5" / "europe-west1"
        pricing:
          input_rate: 4.000               # $4.00 / 1M input tokens
          output_rate: 20.000             # $20.00 / 1M output tokens
          cache_read_rate: 0.200          # $0.20 / 1M cache hit tokens
          cache_write_rate: 5.000         # $5.00 / 1M 5m cache write tokens

      # Claude Sonnet 5.5 on Agent Platform
      - name: "claude-sonnet-5-5"
        displayName: "Claude Sonnet 5.5"
        publisher: "anthropic"
        target: "claude"
        format: "anthropic"
        region: "global"
        pricing:
          input_rate: 2.000               # $2.00 / 1M input tokens
          output_rate: 10.000             # $10.00 / 1M output tokens
          cache_read_rate: 0.100          # $0.10 / 1M cache hit tokens
          cache_write_rate: 2.500         # $2.50 / 1M 5m cache write tokens

      # Claude Haiku 5.5 on Agent Platform
      - name: "claude-haiku-5-5"
        displayName: "Claude Haiku 5.5"
        publisher: "anthropic"
        target: "claude"
        format: "anthropic"
        region: "global"
        pricing:
          input_rate: 0.100               # $0.10 / 1M input tokens
          output_rate: 0.500              # $0.50 / 1M output tokens
          cache_read_rate: 0.010          # $0.01 / 1M cache hit tokens
          cache_write_rate: 0.125         # $0.125 / 1M 5m cache write tokens

      # Optional Frontier Apex Reasoning Model: Claude Fable 5.2
      - name: "claude-fable-5-2"
        displayName: "Claude Fable 5.2"
        publisher: "anthropic"
        target: "claude"
        format: "anthropic"
        region: "global"
        pricing:
          input_rate: 8.000               # $8.00 / 1M input tokens
          output_rate: 40.000             # $40.00 / 1M output tokens
          cache_read_rate: 0.200          # $0.20 / 1M cache hit tokens
          cache_write_rate: 10.000        # $10.00 / 1M 5m cache write tokens
    ```

=== "3. Claude Platform (`api.anthropic.com`) & BYO Claude"
    **How it works:** Routes directly to **Claude Platform (`api.anthropic.com`)** (`https://api.anthropic.com/v1/messages`) or a custom Anthropic-compatible proxy (e.g., AWS Bedrock gateway / LiteLLM):

    * **Authentication (`x-api-key` + `token_ref`):** Claude Platform (`api.anthropic.com`) authenticates via the `x-api-key` HTTP header. Reference your key from an Apigee Environment PropertySet (`propertyset.provider_keys.anthropic_api_key`)—see **[Section 2](#2-storing-provider-api-keys-in-an-apigee-propertyset)** below—rather than hardcoding secrets in Git.
    * **Workspace Isolation:** Unlike OpenAI, Anthropic does not use organization/project headers—each API key (`sk-ant-api03-...`) is already bound to a specific Workspace in **Claude Platform (`api.anthropic.com`)**.
    * **Headers & Model ID (`anthropic_version`, `anthropic_beta`, `upstream_model`):** When `custom_url` is set, the gateway automatically sets the `anthropic-version: 2023-06-01` HTTP header, omits `vertex-2023-10-16` from the JSON body for `api.anthropic.com`, and preserves/rewrites `"model"` in the JSON payload. Prompt caching is GA on Claude Platform without extra headers; `anthropic_beta` is optional and only needed when opting into experimental beta features.

    ```yaml
    models:
      # Claude Sonnet 5.5 on Claude Platform (api.anthropic.com)
      - name: "claude-direct-sonnet"
        displayName: "Claude Sonnet 5.5 (Claude Platform)"
        publisher: "anthropic"
        target: "claude"
        format: "anthropic"
        custom_url: "https://api.anthropic.com/v1/messages"
        upstream_model: "claude-sonnet-5-5"               # Model ID sent in the outbound JSON body
        anthropic_version: "2023-06-01"                   # Sets anthropic-version HTTP header (default: 2023-06-01)
        # anthropic_beta: ""                              # Optional: injects anthropic-beta header for opt-in beta features
        auth:
          type: "header"
          header_name: "x-api-key"
          token_ref: "propertyset.provider_keys.anthropic_api_key"
        pricing:
          input_rate: 2.000
          output_rate: 10.000
          cache_read_rate: 0.100
          cache_write_rate: 2.500

      # Claude Opus 5.5 on Claude Platform (api.anthropic.com)
      - name: "claude-direct-opus"
        displayName: "Claude Opus 5.5 (Claude Platform)"
        publisher: "anthropic"
        target: "claude"
        format: "anthropic"
        custom_url: "https://api.anthropic.com/v1/messages"
        upstream_model: "claude-opus-5-5"
        anthropic_version: "2023-06-01"
        auth:
          type: "header"
          header_name: "x-api-key"
          token_ref: "propertyset.provider_keys.anthropic_api_key"
        pricing:
          input_rate: 4.000
          output_rate: 20.000
          cache_read_rate: 0.200
          cache_write_rate: 5.000

      # Claude Fable 5.2 on Claude Platform (api.anthropic.com)
      - name: "claude-direct-fable"
        displayName: "Claude Fable 5.2 (Claude Platform)"
        publisher: "anthropic"
        target: "claude"
        format: "anthropic"
        custom_url: "https://api.anthropic.com/v1/messages"
        upstream_model: "claude-fable-5-2"
        anthropic_version: "2023-06-01"
        auth:
          type: "header"
          header_name: "x-api-key"
          token_ref: "propertyset.provider_keys.anthropic_api_key"
        pricing:
          input_rate: 8.000
          output_rate: 40.000
          cache_read_rate: 0.200
          cache_write_rate: 10.000
    ```

=== "4. Direct OpenAI (`api.openai.com` — GPT-6 Series)"
    **How it works:** Routes to OpenAI (`https://api.openai.com/v1/chat/completions`) while keeping OpenAI API keys stored in an Apigee Environment PropertySet:

    * **Authentication (`bearer` + `token_ref`):** Injects `Authorization: Bearer <token>` resolved from `propertyset.provider_keys.openai_api_key` (see **[Section 2](#2-storing-provider-api-keys-in-an-apigee-propertyset)** below).
    * **Are `openai_org_id` and `openai_project_id` needed?**
        * **With modern Project API Keys (`sk-proj-...`):** **No.** Modern OpenAI Project keys are already cryptographically scoped to a single Organization and Project inside OpenAI.
        * **With legacy User/Admin Keys (`sk-...`):** **Optional.** If a single legacy key spans multiple OpenAI organizations or projects, you can set `openai_org_id` and `openai_project_id` on the model to inject `OpenAI-Organization` and `OpenAI-Project` headers on outbound requests.

    ```yaml
    models:
      # OpenAI GPT-6.2 Sol (Frontier Coding & Reasoning)
      - name: "gpt-6.2-sol"
        displayName: "OpenAI GPT-6.2 Sol"
        publisher: "openai"
        target: "openai-custom"
        format: "openai"
        custom_url: "https://api.openai.com/v1/chat/completions"
        # Optional: only needed when using legacy multi-project keys instead of sk-proj-* keys
        # openai_org_id: "org-your-openai-org"
        # openai_project_id: "proj-your-openai-project"
        auth:
          type: "bearer"
          token_ref: "propertyset.provider_keys.openai_api_key"
        pricing:
          input_rate: 2.000                               # $2.00 / 1M input tokens
          output_rate: 10.000                             # $10.00 / 1M output tokens
          cache_read_rate: 0.100                          # $0.10 / 1M cached input tokens
          cache_write_rate: 2.500                         # $2.50 / 1M cache write tokens

      # OpenAI GPT-6 Luna (Balanced Mid-Tier)
      - name: "gpt-6-luna"
        displayName: "OpenAI GPT-6 Luna"
        publisher: "openai"
        target: "openai-custom"
        format: "openai"
        custom_url: "https://api.openai.com/v1/chat/completions"
        auth:
          type: "bearer"
          token_ref: "propertyset.provider_keys.openai_api_key"
        pricing:
          input_rate: 0.400                               # $0.40 / 1M input tokens
          output_rate: 1.600                              # $1.60 / 1M output tokens
          cache_read_rate: 0.040                          # $0.04 / 1M cached input tokens

      # OpenAI GPT-6 Nano (Ultra-Low-Latency / High-Throughput)
      - name: "gpt-6-nano"
        displayName: "OpenAI GPT-6 Nano"
        publisher: "openai"
        target: "openai-custom"
        format: "openai"
        custom_url: "https://api.openai.com/v1/chat/completions"
        auth:
          type: "bearer"
          token_ref: "propertyset.provider_keys.openai_api_key"
        pricing:
          input_rate: 0.100                               # $0.10 / 1M input tokens
          output_rate: 0.400                              # $0.40 / 1M output tokens
          cache_read_rate: 0.010                          # $0.01 / 1M cached input tokens
    ```

=== "5. Agent Platform MaaS (Llama 4, DeepSeek)"
    **How it works:** Connects to Open and Partner Models-as-a-Service (MaaS) on **Agent Platform** OpenAI-compatible endpoints (`endpoints/openapi/chat/completions`) using your gateway's GCP Service Account (`roles/aiplatform.user`)—no API keys needed. Simply set `publisher` (`meta`, `deepseek`, `mistralai`, `qwen`, etc.), `target: "gemini-openai-compat"`, and `format: "openai"`:

    ```yaml
    models:
      # Meta Llama 4 Maverick (17B 128E — Agent Platform MaaS)
      - name: "llama-4-maverick-17b-128e-instruct-maas"
        displayName: "Llama 4 Maverick 17B 128E (Agent Platform MaaS)"
        publisher: "meta"
        target: "gemini-openai-compat"
        format: "openai"
        region: "us-east5"
        pricing:
          input_rate: 0.350               # $0.35 / 1M input tokens
          output_rate: 1.150              # $1.15 / 1M output tokens

      # DeepSeek V4.1 Flash (Agent Platform MaaS)
      - name: "deepseek-v4.1-flash-maas"
        displayName: "DeepSeek V4.1 Flash (Agent Platform MaaS)"
        publisher: "deepseek"
        target: "gemini-openai-compat"
        format: "openai"
        region: "global"
        pricing:
          input_rate: 0.200               # $0.20 / 1M input tokens
          output_rate: 0.600              # $0.60 / 1M output tokens
    ```

=== "6. Microsoft Foundry & Self-Hosted (vLLM / Ollama)"
    **How it works:** Point `custom_url` to **Microsoft Foundry** (formerly Azure OpenAI)—supporting both unified `services.ai.azure.com/models/chat/completions` endpoints and classic `openai.azure.com` deployment URLs—or to any self-hosted inference cluster (**vLLM**, **Ollama**, TGI, Cloud Run, GKE). Use `upstream_model` when the model identifier expected by your backend differs from the catalog name exposed to clients:

    ```yaml
    models:
      # 1. Microsoft Foundry Unified Model Inference Endpoint (services.ai.azure.com)
      - name: "foundry-gpt-6.2-sol"
        displayName: "GPT-6.2 Sol (Microsoft Foundry)"
        publisher: "azure"
        target: "openai-custom"
        format: "openai"
        custom_url: "https://my-foundry-resource.services.ai.azure.com/models/chat/completions"
        # Classic openai.azure.com deployment URLs are also fully supported:
        # custom_url: "https://my-resource.openai.azure.com/openai/deployments/gpt-6.2-sol/chat/completions?api-version=2024-10-21"
        upstream_model: "gpt-6.2-sol"
        auth:
          type: "header"
          header_name: "api-key"
          token_ref: "propertyset.provider_keys.foundry_api_key"
        pricing:
          input_rate: 2.000
          output_rate: 10.000
          cache_read_rate: 0.100

      # 2. Self-Hosted vLLM Cluster — Llama 4 Maverick (Bearer Token Reference)
      - name: "custom-llama-4"
        displayName: "Llama 4 Maverick (Internal vLLM)"
        publisher: "custom"
        target: "openai-custom"
        format: "openai"
        custom_url: "https://vllm.internal.corp/v1/chat/completions"
        upstream_model: "meta-llama/Llama-4-Maverick-17B-128E-Instruct"
        auth:
          type: "bearer"
          token_ref: "propertyset.provider_keys.vllm_api_key"
        pricing:
          input_rate: 0.050
          output_rate: 0.150

      # 3. Self-Hosted Ollama Instance
      - name: "ollama-llama4"
        displayName: "Llama 4 Scout (Internal Ollama)"
        publisher: "custom"
        target: "openai-custom"
        format: "openai"
        custom_url: "https://ollama.internal.corp/v1/chat/completions"
        upstream_model: "llama4:scout"
        pricing:
          input_rate: 0.020
          output_rate: 0.060
    ```

=== "7. Vector Embeddings (`/v1/embeddings`)"
    **How it works:** Exposes a single OpenAI-compatible `POST /v1/embeddings` endpoint across both **Agent Platform** (automatically translated to/from `:predict` `{instances: [{content}]}`; `gemini-embedding-001` replaces retired `text-embedding-005`) and **OpenAI** (`/v1/embeddings`):

    ```yaml
    models:
      # 1. Google Gemini Embedding 001 on Agent Platform (Translated to/from :predict)
      - name: "gemini-embedding-001"
        displayName: "Gemini Embedding 001"
        publisher: "google"
        target: "gemini-openai-compat"
        format: "openai"
        region: "us-central1"
        pricing:
          input_rate: 0.150               # $0.15 / 1M input tokens
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
          token_ref: "propertyset.provider_keys.openai_api_key"
        pricing:
          input_rate: 0.020               # $0.02 / 1M input tokens
          output_rate: 0.000
    ```

---

## 2. Storing Provider API Keys in an Apigee PropertySet

For external providers (`api.openai.com`, **Claude Platform (`api.anthropic.com`)**, **Microsoft Foundry**, vLLM), keep your provider keys out of Git by storing them in an **Apigee Environment-Scoped PropertySet** (for example, `provider_keys`) and referencing them via `auth.token_ref`.

### Step 1: Create a local `provider_keys.properties` file (do not commit to Git)

```ini
openai_api_key=sk-proj-your-openai-key
anthropic_api_key=sk-ant-api03-your-anthropic-key
vllm_api_key=your-internal-vllm-token
foundry_api_key=your-microsoft-foundry-key
```

### Step 2: Upload the PropertySet to your Apigee Environment

```bash
apigeecli res create \
    --org "$PROJECT_ID" \
    --env "$APIGEE_ENV" \
    --name provider_keys \
    --type properties \
    --respath ./provider_keys.properties \
    -t "$(gcloud auth print-access-token)"

# Delete the local plaintext file once uploaded
rm ./provider_keys.properties
```

*(To rotate a key later without redeploying the proxy, run `apigeecli res update --org "$PROJECT_ID" --env "$APIGEE_ENV" --name provider_keys --type properties --respath ./provider_keys.properties -t "$(gcloud auth print-access-token)"`).*

### Step 3: Reference the PropertySet key in `values.yaml`

```yaml
models:
  - name: "gpt-6.2-sol"
    publisher: "openai"
    target: "openai-custom"
    format: "openai"
    custom_url: "https://api.openai.com/v1/chat/completions"
    auth:
      type: "bearer"
      token_ref: "propertyset.provider_keys.openai_api_key"
```

> [!NOTE]
> **Runtime Security Guarantees for External Provider Credentials:**
> * **`token_ref` Namespace Allowlisting:** `auth.token_ref` only resolves variables from trusted credential namespaces (`propertyset.*`, `private.*`, `verifyapikey.*`, `apiproduct.*`). Arbitrary flow variable namespaces (`request.*`, `message.*`, `client.*`, `system.*`) are rejected.
> * **Header Injection & Internal Header Protection:** Custom `auth.header_name` values are validated against RFC 7230 token characters and cannot overwrite internal gateway or hop-by-hop headers (`X-Internal-*`, `X-Gateway-*`, `Host`, `Content-Length`, `Transfer-Encoding`).
> * **Inbound `Authorization` Stripping & Trace Masking:** When routing to external `custom_url` endpoints using custom headers (`x-api-key`, `api-key`) or `auth.type: "none"`, the gateway automatically strips the caller's inbound Apigee `Authorization` header so gateway tokens never leak upstream, and isolates resolved fallback credentials in `private.*` variables so Apigee Debug/Trace masks them automatically.

---

## 3. Any Client SDK, Any Model

Regardless of which provider hosts a model, developers can call it from their preferred SDK or CLI tool:

| Client Endpoint | Google Gemini & Embeddings (Agent Platform) | Anthropic Claude (Agent Platform & Claude Platform) | OpenAI, MaaS, Microsoft Foundry & vLLM |
| :--- | :---: | :---: | :---: |
| **`POST /v1/messages`**<br>*(Claude Code, Anthropic SDK)* | Automatic translation | Native format | Automatic translation |
| **`POST /v1/chat/completions`**<br>*(Antigravity, Copilot, OpenAI SDK)* | Automatic translation | Automatic translation | Native format |
| **`POST /v1/embeddings`**<br>*(OpenAI Embeddings SDK)* | Automatic translation (`:predict`) | N/A | Native format (`/embeddings`) |
| **`POST /ai-gateway`**<br>*(Agent Platform / Google GenAI SDK)* | Native format | Native format (`:rawPredict`) | Use `/v1/chat/completions` |


