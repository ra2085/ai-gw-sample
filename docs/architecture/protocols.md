# Client Endpoints & Protocols

The AI Gateway decouples client SDKs and [developer tools](../template-guide/developer-tools.md) (`Claude Code`, `Google Antigravity`, `GitHub Copilot`, `Cursor`, OpenAI SDK, Anthropic SDK, Google GenAI SDK) from backend model providers through automatic request and streaming SSE translation.

---

## 1. Endpoint & Provider Matrix

Any client endpoint can call any configured model provider:

| Client Endpoint | Google Gemini & Embeddings | Anthropic Claude | OpenAI, MaaS, Azure & vLLM |
| :--- | :---: | :---: | :---: |
| **`POST /v1/messages`**<br>*(Claude Code, Claude Desktop, Anthropic SDK)* | Automatic translation | Native format | Automatic translation |
| **`POST /v1/chat/completions`**<br>*(Antigravity, GitHub Copilot, Cursor, OpenAI SDK)* | Automatic translation | Automatic translation | Native format |
| **`POST /v1/embeddings`**<br>*(OpenAI Embeddings SDK)* | Automatic translation | N/A | Native format |
| **`POST /ai-gateway`**<br>*(Vertex AI / Google GenAI SDK)* | Native format | Native format | Use `/v1/chat/completions` |
| **`GET /v1/models`**<br>*(Model Discovery)* | Dynamic catalog | Dynamic catalog | Dynamic catalog |

---

## 2. Developer CLI & SDK Capabilities

Click a tab below to see how each client protocol is supported:

=== "Anthropic Messages (`POST /v1/messages`)"

    Designed for **Claude Code**, **Claude Desktop**, and the **Anthropic SDK**. Can target Anthropic Claude natively or automatically translate requests and SSE streams to Google Gemini, OpenAI, or Vertex Model Garden MaaS.

    * **Extended Thinking:** Preserves `thinking` (`{type: "thinking", thinking: "...", signature: "..."}`) and `redacted_thinking` blocks across multi-turn agentic loops, mapping `thinking.budget_tokens` to Gemini `thinkingConfig.thinkingBudget` or OpenAI `reasoning_effort`.
    * **Tool Use & Function Calling:** Translates Anthropic `tools`, `tool_choice`, `tool_use`, and `tool_result` blocks (including structured array content) to and from Gemini and OpenAI tool formats.
    * **Multimodal & Document Blocks:** Supports base64 images (`image/jpeg`, `image/png`, `image/webp`) and PDF/text `document` blocks.
    * **Prompt Caching:** Preserves `cache_control: {"type": "ephemeral"}` breakpoints and returns cached token counts in response usage metadata.

=== "OpenAI Chat Completions (`POST /v1/chat/completions`)"

    Designed for **Google Antigravity**, **GitHub Copilot**, **Cursor**, **Microsoft Copilot Studio**, **LangChain**, and the **OpenAI SDK**. Can target OpenAI, MaaS, Azure, and vLLM natively, or automatically translate requests and SSE streams to Google Gemini and Anthropic Claude.

    * **Streaming SSE Normalization:** Translates backend stream deltas (including content, reasoning tokens, and tool call arguments) into standard OpenAI `chat.completion.chunk` SSE events (`data: {...}\n\n` followed by `data: [DONE]\n\n`).
    * **Reasoning Effort & Tool Calls:** Maps `reasoning_effort` (`low`, `medium`, `high`) and parallel `tool_calls` across providers.

=== "Vector Embeddings (`POST /v1/embeddings`)"

    Provides a unified OpenAI-compatible `/v1/embeddings` interface across both **Direct OpenAI / vLLM** and **Google Vertex AI (`text-embedding-005`, `text-multilingual-embedding-002`)**:

    * **OpenAI / vLLM Models:** Forwards the OpenAI `/v1/embeddings` request directly and injects the appropriate backend credential.
    * **Vertex AI Embedding Models:** Automatically translates OpenAI `{"model": "text-embedding-005", "input": ["..."], "dimensions": 768}` payloads into Vertex AI `:predict` instances and normalizes the response back into an OpenAI `{"object": "list", "data": [{"object": "embedding", ...}], "usage": {...}}` payload.

=== "Vertex AI Native (`POST /ai-gateway`)"

    Designed for applications built on the **Google GenAI SDK**, **Vertex AI SDK**, **`AnthropicVertex`**, or **Agent Development Kit (ADK)** that send native Vertex AI URL paths:

    * Supports `:generateContent`, `:streamGenerateContent`, `:rawPredict`, `:streamRawPredict`, `:embedContent`, `:batchEmbedContents`, and `:predict`.
    * Applies the same AI Product authentication, token quotas, shared team budgets, Model Armor safety scans, and USD cost attribution as `/v1/messages` and `/v1/chat/completions`.
    * **No Local ADC Required:** Because Apigee authenticates upstream to Vertex AI via its attached Service Account (`<GoogleAccessToken>`), pass placeholder credentials (`Credentials("gateway-managed")` in `google-genai`, or `access_token="gateway-managed"` in `AnthropicVertex`) alongside `headers={"x-api-key": api_key}` so the client SDK skips local `gcloud auth application-default login` lookup.

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
