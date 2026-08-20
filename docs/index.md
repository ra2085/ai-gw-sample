# Apigee AI Gateway

Welcome to the documentation for the **Enterprise AI Gateway** on Google Cloud Apigee, configured declaratively using [`apigee-go-gen`](https://github.com/apigee/apigee-go-gen).

The AI Gateway provides a unified, production-grade control plane for generative AI workloads across Anthropic Claude, OpenAI, Google Gemini on Vertex AI, and self-hosted models (vLLM, Ollama, Groq, Azure OpenAI).

---

## Progressive Adoption Journey

The repository is designed to let you start simple and add capabilities as your requirements grow:

```mermaid
graph LR
    Step1["1. Quickstart<br/><b>5-Minute Setup</b><br/>Deploy with Gemini & Claude"] --> Step2["2. Add Models<br/><b>Custom Endpoints</b><br/>vLLM, Ollama, Azure, DeepSeek"]
    Step2 --> Step3["3. Enterprise Features<br/><b>Security & Governance</b><br/>Model Armor, Quotas, Monetization"]
    Step3 --> Step4["4. Advanced Routing<br/><b>Smart Router & Judge</b><br/>Cost optimization & dynamic triage"]
```

1. **[Quickstart (5 Minutes)](getting-started/quickstart-template.md)**: Deploy a working gateway with 15 lines of YAML supporting Gemini and Claude.
2. **[Custom Providers & URLs](template-guide/custom-urls.md)**: Connect external APIs (Azure, DeepSeek) and private clusters (vLLM, Ollama) with custom auth.
3. **[Enterprise Features](template-guide/feature-flags.md)**: Enable Model Armor prompt/response sanitization, token quotas, and monetization.
4. **[Smart Routing & LLM as a Judge](architecture/routing.md)**: Automatically route prompts based on cost tiers and complexity.

---

## Core Capabilities

<div class="grid cards" markdown>

-   :material-swap-horizontal: **Universal Protocol Normalization**
    
    ---
    
    Accepts Claude (`/v1/messages`), Gemini (`/ai-gateway`), or OpenAI (`/v1/chat/completions`) schemas and automatically transcodes them across any backend provider with real-time SSE streaming.

-   :material-routes: **Smart Routing & LLM as a Judge**
    
    ---
    
    Dynamically routes requests using cost tiers (`low`, `medium`, `high`, `max`), fallback chains, or real-time prompt complexity classification powered by Gemini 3.1 Flash-Lite.

-   :material-shield-check: **Enterprise Security (GCP Model Armor)**
    
    ---
    
    Inspects and sanitizes user prompts and model completions against sensitive data leakage, toxic content, and prompt injection attacks with automated de-identification.

-   :material-credit-card-outline: **Token Monetization & Quotas**
    
    ---
    
    Enforces prepaid wallet credit limits in pre-flight, calculates exact token consumption costs in real-time, and integrates directly with Apigee rate plans and quotas.

-   :material-tune: **Declarative Configuration**
    
    ---
    
    Single `values.yaml` file drives the entire gateway bundle generation, supporting custom URLs, regional endpoints, and modular feature toggling.

-   :material-chart-box: **Telemetry & Observability**
    
    ---
    
    Injects standard observability headers and logs detailed token counts, model identifiers, and transaction costs into Apigee Analytics Data Collectors.

</div>

---

## Architecture

```mermaid
graph TD
    Client["Client Application / SDK"]

    subgraph Ingress["Apigee Proxy Endpoints"]
        EP_Claude["claude-messages<br/>(/v1/messages)"]
        EP_Gemini["gemini-native<br/>(/ai-gateway)"]
        EP_OpenAI["openai-compat<br/>(/v1/chat/completions)"]
        EP_Models["claude-models<br/>(/v1/models)"]
    end

    subgraph Pipeline["PreFlow Execution Pipeline"]
        Auth["1. Auth & API Key Validation"]
        MLC["2. Monetization Pre-flight"]
        Judge["3. Smart Router & LLM Judge"]
        Quota["4. Token Quota Enforcement"]
        Armor["5. Model Armor Prompt Sanitization"]
        Xlate["6. Protocol Transcoding (if needed)"]
        
        Auth --> MLC --> Judge --> Quota --> Armor --> Xlate
    end

    subgraph Targets["Backend Model Targets"]
        T_Claude["Vertex Claude (us-east5)"]
        T_Gemini["Vertex Gemini (global)"]
        T_OpenAI["Vertex OpenAI Endpoint"]
        T_Custom["Custom Upstreams (vLLM, Ollama, Azure, DeepSeek)"]
    end

    Client -->|Anthropic Request| EP_Claude
    Client -->|Gemini Predict| EP_Gemini
    Client -->|OpenAI Chat| EP_OpenAI
    Client -->|Catalog Discovery| EP_Models

    EP_Claude --> Pipeline
    EP_Gemini --> Pipeline
    EP_OpenAI --> Pipeline

    Xlate -->|route_target = claude| T_Claude
    Xlate -->|route_target = gemini| T_Gemini
    Xlate -->|route_target = openai| T_OpenAI
    Xlate -->|custom_url / format| T_Custom

    subgraph Egress["PostFlow Response & Telemetry"]
        SMR["1. Model Armor Response Filter"]
        Calc["2. Micro-Cost Calculator (USD)"]
        LTQ_Cnt["3. Token Quota Accumulation"]
        DC["4. Apigee Data Collectors"]
        Hdrs["5. Observability Response Headers"]
        
        SMR --> Calc --> LTQ_Cnt --> DC --> Hdrs
    end

    T_Claude --> Egress
    T_Gemini --> Egress
    T_OpenAI --> Egress
    T_Custom --> Egress
    Hdrs --> Client
    EP_Models --> Client
```

---

## Next Steps

* **[5-Minute Quickstart](getting-started/quickstart-template.md)**: Generate and deploy your first gateway bundle.
* **[Configuration Reference](template-guide/configuration.md)**: Full guide to `values.yaml` settings.
* **[Custom Models Guide](template-guide/custom-urls.md)**: How to bring self-hosted and third-party models.


