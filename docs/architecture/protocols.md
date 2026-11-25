# Client Endpoints & Protocols

The AI Gateway decouples client SDKs and [developer tools](../template-guide/developer-tools.md) (`Claude Code`, `Google Antigravity`, `GitHub Copilot`, `Cursor`, OpenAI SDK, Anthropic SDK, Google GenAI SDK) from backend model providers through automatic request and streaming SSE translation.

---

## 1. Endpoint & Provider Matrix

Any client endpoint can call any configured model provider—across **Gemini Enterprise Agent Platform** (formerly Vertex AI), **Direct OpenAI (`api.openai.com`)**, **Claude Platform (`api.anthropic.com`)**, **Microsoft Foundry (formerly Azure OpenAI)**, and self-hosted `vLLM` / `Ollama` clusters:

| Client Endpoint | Google Gemini & Embeddings (Agent Platform) | Anthropic Claude (Agent Platform & Claude Platform) | OpenAI, Agent Platform MaaS, Microsoft Foundry & vLLM |
| :--- | :---: | :---: | :---: |
| **`POST /v1/messages`**<br>*(Claude Code, Claude Desktop, Anthropic SDK)* | Automatic translation | Native format | Automatic translation |
| **`POST /v1/chat/completions`**<br>*(Antigravity, GitHub Copilot, Cursor, OpenAI SDK)* | Automatic translation | Automatic translation | Native format |
| **`POST /v1/embeddings`**<br>*(OpenAI Embeddings SDK)* | Automatic translation | N/A | Native format |
| **`POST /ai-gateway`**<br>*(Agent Platform / Google GenAI SDK)* | Native format | Native format | Use `/v1/chat/completions` |
| **`GET /v1/models`**<br>*(Model Discovery)* | Dynamic catalog | Dynamic catalog | Dynamic catalog |

---

## 2. Developer CLI & SDK Capabilities

Click a tab below to see how each client protocol is supported:

=== "Anthropic Messages (`POST /v1/messages`)"

    Designed for **Claude Code**, **Claude Desktop**, and the **Anthropic SDK**. Targets Anthropic Claude natively on **Agent Platform** (`vertex-2023-10-16`) or **Claude Platform (`api.anthropic.com`)**, or automatically translates requests and SSE streams to Google Gemini, OpenAI GPT-6, Microsoft Foundry, or Agent Platform MaaS.

    * **Adaptive & Extended Thinking (`Claude 5.5` / `Fable 5.2`):** Supports native Claude 5.5 (`claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`) and `claude-fable-5-2` adaptive thinking (`thinking: {"type": "adaptive"}`) paired with `output_config: {"effort": "low"|"medium"|"high"|"max"}`—automatically upgrading legacy `thinking: {"type": "enabled", "budget_tokens": ...}` requests on adaptive-only models. Preserves `thinking` (`{type: "thinking", thinking: "...", signature: "..."}`) and `redacted_thinking` blocks across multi-turn agentic loops, and translates thinking effort/budgets to Gemini 4 `thinkingConfig.thinkingLevel` (`MINIMAL`, `LOW`, `MEDIUM`, `HIGH`) or OpenAI GPT-6 `reasoning_effort` (`low`, `medium`, `high`, `xhigh`).
    * **Tool Use & Function Calling:** Translates Anthropic `tools`, `tool_choice`, `tool_use`, and `tool_result` blocks (including structured array content) to and from Gemini and OpenAI tool formats.
    * **Multimodal & Document Blocks:** Supports base64 images (`image/jpeg`, `image/png`, `image/webp`) and PDF/text `document` blocks.
    * **Prompt Caching:** Preserves `cache_control: {"type": "ephemeral"}` breakpoints and returns cached token counts in response usage metadata.

=== "OpenAI Chat Completions (`POST /v1/chat/completions`)"

    Designed for **Google Antigravity**, **GitHub Copilot**, **Cursor**, **Microsoft Copilot Studio**, **LangChain**, and the **OpenAI SDK**. Targets Direct OpenAI, Agent Platform MaaS, Microsoft Foundry, and vLLM natively, or automatically translates requests and SSE streams to Google Gemini and Anthropic Claude (on Agent Platform or Claude Platform `api.anthropic.com`).

    * **Streaming SSE Normalization:** Translates backend stream deltas (including content, reasoning tokens, and tool call arguments) into standard OpenAI `chat.completion.chunk` SSE events (`data: {...}\n\n` followed by `data: [DONE]\n\n`).
    * **GPT-6 Reasoning Normalization & Cross-Provider Mapping:** Automatically normalizes OpenAI GPT-6 series (`gpt-6.2-sol`, `gpt-6-luna`, `gpt-6-nano`) reasoning requests (`max_completion_tokens`, `reasoning_effort` including `minimal`, `low`, `medium`, `high`, and `"xhigh"`), and maps `reasoning_effort` and parallel `tool_calls` across Gemini 4 (`thinkingConfig.thinkingLevel`) and Claude 5.5 / Fable 5.2 (`thinking: {"type": "adaptive"}` + `output_config.effort`, mapping `"xhigh"` to `"max"`).

=== "Vector Embeddings (`POST /v1/embeddings`)"

    Provides a unified OpenAI-compatible `/v1/embeddings` interface across **Direct OpenAI / Microsoft Foundry / vLLM** and **Agent Platform (`gemini-embedding-001`, `text-multilingual-embedding-002`)**:

    * **OpenAI / Microsoft Foundry / vLLM Models:** Forwards the OpenAI `/v1/embeddings` request directly and injects the appropriate backend credential.
    * **Agent Platform Embedding Models:** Automatically translates OpenAI `{"model": "gemini-embedding-001", "input": ["..."], "dimensions": 768}` payloads into Agent Platform `:predict` instances (`us-central1-aiplatform.googleapis.com`) and normalizes the response back into an OpenAI `{"object": "list", "data": [{"object": "embedding", ...}], "usage": {...}}` payload. *(Replaces retired `text-embedding-005`, which remains supported as a backward-compatible alias mapped to `gemini-embedding-001`.)*

=== "Agent Platform Native (`POST /ai-gateway`)"

    Designed for applications built on the **Google GenAI SDK**, **Agent Platform** SDKs, **`AnthropicVertex`**, or **Agent Development Kit (ADK)** that send native `aiplatform.googleapis.com` URL paths:

    * Supports `:generateContent`, `:streamGenerateContent`, `:rawPredict`, `:streamRawPredict`, `:embedContent`, `:batchEmbedContents`, and `:predict`.
    * **Gemini 4 & 3.5 Flash-Lite `thinkingLevel` & Multi-Region Residency:** Supports `thinkingConfig.thinkingLevel` (`MINIMAL`, `LOW`, `MEDIUM`, `HIGH`) on Gemini 4 (`gemini-4-hydrogen`, `gemini-4-argon`, `gemini-4-carbon`) and `gemini-3.5-flash-lite` (automatically normalizing legacy `thinkingBudget` fields on Gemini 4), and routes cleanly across `global` (`aiplatform.googleapis.com`), multi-region `"us"` (`aiplatform.us.rep.googleapis.com`), multi-region `"eu"` (`aiplatform.eu.rep.googleapis.com`), and single-region endpoints.
    * Applies the same AI Product authentication, token quotas, shared team budgets, Model Armor safety scans, and USD cost attribution as `/v1/messages` and `/v1/chat/completions`.
    * **No Local ADC Required:** Because Apigee authenticates upstream to Agent Platform via its attached Service Account (`<GoogleAccessToken>`), pass placeholder credentials (`Credentials("gateway-managed")` in `google-genai`, or `access_token="gateway-managed"` in `AnthropicVertex`) alongside `headers={"x-api-key": api_key}` so the client SDK skips local `gcloud auth application-default login` lookup.

    ```python
    from google import genai
    from google.genai import types
    from google.oauth2.credentials import Credentials

    client = genai.Client(
        vertexai=True,
        project="your-gcp-project-id",
        location="global",
        credentials=Credentials("gateway-managed"),
        http_options=types.HttpOptions(
            base_url="https://ai-gateway.example.com/ai-gateway",
            headers={"x-api-key": "YOUR_APIGEE_API_KEY"},
        ),
    )
    ```
