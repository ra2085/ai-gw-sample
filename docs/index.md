# 🚀 Apigee AI Gateway

Welcome to the documentation for the **Enterprise AI Gateway** built on Google Cloud Apigee and configured declaratively using [`apigee-go-gen`](https://github.com/apigee/apigee-go-gen).

The AI Gateway provides a unified, production-grade control plane for generative AI workloads across Anthropic Claude, OpenAI, Google Gemini on Vertex AI, and self-hosted open-source models (vLLM, Ollama, Groq, Azure OpenAI).

---

## 🌟 Key Capabilities

<div class="grid cards" markdown>

-   :material-swap-horizontal: **Universal Protocol Normalization**
    
    ---
    
    Accepts Claude (`/v1/messages`), Gemini (`/ai-gateway`), or OpenAI (`/v1/chat/completions`) schemas and automatically transcodes them to match any target backend model format with streaming support.

-   :material-routes: **Smart Routing & LLM as a Judge**
    
    ---
    
    Dynamically routes requests using cost tiers (`low`, `medium`, `high`, `max`), cascading fallback chains, or real-time prompt complexity classification powered by Gemini 3.1 Flash-Lite.

-   :material-shield-check: **Enterprise Security (GCP Model Armor)**
    
    ---
    
    Inspects and sanitizes user prompts and model completions against sensitive data leakage, toxic content, and prompt injection attacks with automated de-identification.

-   :material-credit-card-outline: **Token Monetization & Micro-Transactions**
    
    ---
    
    Enforces prepaid wallet credit limits in pre-flight, calculates exact token consumption costs in real-time, and integrates directly with Apigee Monetization rating engines.

-   :material-tune: **Declarative Helm-Style Templates**
    
    ---
    
    Single `values.yaml` configuration drives the entire gateway bundle generation, supporting custom URLs, regional endpoints, and modular feature toggling.

-   :material-chart-box: **Comprehensive Telemetry & Observability**
    
    ---
    
    Injects rich `X-Gateway-*` observability headers and logs detailed token counts, models, and transaction costs into Apigee Analytics Data Collectors.

</div>

---

## 🏛 Architecture Diagram

```mermaid
graph TD
    Client["Client Application / SDK"]

    subgraph Ingress["Apigee Proxy Endpoints"]
        EP_Claude["Proxy: claude-messages<br/>(/v1/messages)"]
        EP_Gemini["Proxy: gemini-native<br/>(/ai-gateway)"]
        EP_OpenAI["Proxy: openai-compat<br/>(/v1/chat/completions)"]
        EP_Models["Proxy: claude-models<br/>(/v1/models)"]
    end

    subgraph Pipeline["PreFlow Execution Pipeline"]
        Auth["1. Auth (VA-ApiKey)"]
        MLC["2. Monetization Pre-flight (MLC)"]
        Judge["3. Smart Router & LLM Judge"]
        Quota["4. Token Quota Enforcement (LTQ)"]
        Armor["5. Model Armor Prompt Sanitization"]
        Xlate["6. Protocol Transcoding (if needed)"]
        
        Auth --> MLC --> Judge --> Quota --> Armor --> Xlate
    end

    subgraph Targets["Backend Model Targets"]
        T_Claude["Vertex Claude (us-east5)"]
        T_Gemini["Vertex Gemini (global)"]
        T_OpenAI["Vertex OpenAI / Gemini Compat"]
        T_Custom["Custom Self-Hosted / Regional (vLLM, Ollama, Azure)"]
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

## ⚡ Getting Started

* **Fastest Path (30 Seconds):** Check out the [30-Second Quickstart Template](getting-started/quickstart-template.md) to generate a gateway with 20 lines of YAML.
* **Full Walkthrough:** Follow the [Full Quickstart Guide](getting-started/quickstart.md).
* **Architecture Deep Dive:** Explore the [Choose Your Workflow Guide](getting-started/choose-workflow.md) and [Template Configuration](template-guide/configuration.md).

