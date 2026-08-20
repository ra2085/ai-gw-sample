# Apigee Enterprise AI Gateway (`ai-gateway`)

[![Documentation](https://img.shields.io/badge/docs-GitHub_Pages-blue.svg)](https://ra2085.github.io/ai-gw-sample/)
[![Template Engine](https://img.shields.io/badge/template-apigee--go--gen-orange.svg)](https://github.com/apigee/apigee-go-gen)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

An enterprise-grade, production-ready **AI Gateway** on Google Cloud Apigee, featuring **Universal Protocol Normalization**, **Smart Routing & LLM as a Judge**, **GCP Model Armor Security**, **Token Quotas**, and **Apigee Monetization with Real-Time Micro-Transactions Tracking**.

---

## Documentation Site

Full guides, architecture specifications, and API references are available on our documentation site:

**[https://ra2085.github.io/ai-gw-sample/](https://ra2085.github.io/ai-gw-sample/)**

---

## Progressive Adoption Journey

The repository is organized for a progressive learning curve:

1. **Quickstart (5 Minutes)**: Deploy a working gateway with minimal configuration supporting Gemini and Claude.
2. **Custom Providers & URLs**: Bring your own models (Azure, DeepSeek, Mistral, Ollama, vLLM) with custom auth.
3. **Enterprise Governance**: Turn on Model Armor security, token quotas, and monetization as needed.
4. **Smart Routing**: Enable AI-driven complexity classification and cost tier routing.

---

## Key Highlights

* **Universal Protocol Normalization:** Query Anthropic Claude, Google Gemini on Vertex AI, or self-hosted OpenAI models using Anthropic (`/v1/messages`), Gemini (`/ai-gateway`), or OpenAI (`/v1/chat/completions`) schemas with real-time SSE streaming translation.
* **Smart Routing & LLM Judge:** Optimize cost and performance using abstract cost tiers (`low`, `medium`, `high`, `max`), fallback chains, or real-time prompt complexity classification powered by Gemini 3.1 Flash-Lite.
* **Enterprise Security:** Automated prompt and response sanitization via GCP Model Armor to prevent data leakage and prompt injection.
* **Token Monetization:** Pre-flight prepaid wallet balance verification and real-time micro-transaction token billing.
* **Custom URLs & Multi-Cloud LLMs:** Declare custom target URLs and formats (`openai`, `anthropic`, `gemini`) in `values.yaml` to route to self-hosted vLLM/Ollama or Azure OpenAI instances.
* **Declarative Helm-Style Templates:** Powered by [`apigee-go-gen`](https://github.com/apigee/apigee-go-gen) to compile clean Apigee proxy bundles in seconds.

---

## Architecture Overview

```mermaid
graph TD
    Client["Client App / SDK"]

    subgraph Ingress["Apigee Ingress Endpoints"]
        EP_Claude["claude-messages (/v1/messages)"]
        EP_Gemini["gemini-native (/ai-gateway)"]
        EP_OpenAI["openai-compat (/v1/chat/completions)"]
        EP_Models["claude-models (/v1/models)"]
    end

    subgraph Pipeline["PreFlow Execution Pipeline"]
        Auth["1. Auth & API Key Validation"]
        MLC["2. Monetization Pre-flight"]
        Judge["3. Smart Router & LLM Judge"]
        Quota["4. Token Quota Enforcement"]
        Armor["5. Model Armor Prompt Sanitization"]
        Xlate["6. Protocol Transcoding"]
        
        Auth --> MLC --> Judge --> Quota --> Armor --> Xlate
    end

    subgraph Targets["Backend Model Targets"]
        T_Claude["Vertex Claude (us-east5)"]
        T_Gemini["Vertex Gemini (global)"]
        T_OpenAI["Vertex OpenAI Endpoint"]
        T_Custom["Custom Upstreams (vLLM, Ollama, Azure, DeepSeek)"]
    end

    Client -->|Anthropic SDK| EP_Claude
    Client -->|Gemini Predict| EP_Gemini
    Client -->|OpenAI SDK| EP_OpenAI
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

## Quickstart (5 Minutes)

### 1. Define Your Gateway in `values.quickstart.yaml`

```yaml
gateway:
  name: "ai-gateway"
  project_id: "your-gcp-project-id"

models:
  - name: "gemini-2.5-flash"
    displayName: "Gemini 2.5 Flash"
    publisher: "google"
    format: "gemini"
    region: "global"
    is_default: true

  - name: "claude-haiku-4-5"
    displayName: "Claude 4.5 Haiku"
    publisher: "anthropic"
    format: "anthropic"
    region: "us-east5"

  # Optional: Custom Self-Hosted Model in 4 lines
  - name: "my-vllm-model"
    displayName: "Llama 3 (Self-Hosted)"
    format: "openai"
    custom_url: "https://vllm.internal.corp/v1/chat/completions"
```

### 2. Render and Deploy

```bash
# Render bundle using apigee-go-gen
apigee-go-gen render apiproxy \
    --template ./templates/ai-gateway/apiproxy.yaml \
    --values ./templates/ai-gateway/values.quickstart.yaml \
    --output ./out/ai-gateway.zip

# Deploy to Apigee
apigeecli apis create bundle \
    --proxy-zip ./out/ai-gateway.zip \
    --name ai-gateway \
    --org "$PROJECT_ID" \
    --env "$APIGEE_ENV" \
    --ovr \
    --wait \
    --default-token
```

---

## Documentation Index

Explore the complete guides on the **[Documentation Site](https://ra2085.github.io/ai-gw-sample/)**:

| Section | Description |
| :--- | :--- |
| **[5-Minute Quickstart](https://ra2085.github.io/ai-gw-sample/getting-started/quickstart-template/)** | Get a gateway running immediately with minimal configuration. |
| **[Choose Your Workflow](https://ra2085.github.io/ai-gw-sample/getting-started/choose-workflow/)** | Declarative Template approach vs. Native Proxy structure. |
| **[Custom Providers & URLs](https://ra2085.github.io/ai-gw-sample/template-guide/custom-urls/)** | Connect self-hosted vLLM/Ollama, Azure OpenAI, or DeepSeek endpoints. |
| **[Configuration Reference](https://ra2085.github.io/ai-gw-sample/template-guide/configuration/)** | Schema reference for models, pricing, feature flags, and routing tiers. |
| **[Feature Toggles](https://ra2085.github.io/ai-gw-sample/template-guide/feature-flags/)** | Enable or disable security, quotas, judge, and monetization modules. |
| **[Protocol Normalization](https://ra2085.github.io/ai-gw-sample/architecture/protocols/)** | Deep dive into Anthropic, Gemini, and OpenAI request/response/SSE transcoding. |
| **[Smart Routing & LLM Judge](https://ra2085.github.io/ai-gw-sample/architecture/routing/)** | Real-time prompt complexity classifier and fallback chains. |
| **[Enterprise Security](https://ra2085.github.io/ai-gw-sample/architecture/security/)** | Prompt and response sanitization with GCP Model Armor. |
| **[Token Monetization](https://ra2085.github.io/ai-gw-sample/architecture/monetization/)** | Pre-flight wallet balance checks and real-time micro-cost rating engine. |
| **[Deployment & CI/CD](https://ra2085.github.io/ai-gw-sample/operations/deployment/)** | Service accounts, deployment automation, and automated test suites. |

