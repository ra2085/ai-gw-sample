# <img src="img/Apigee-512-color.png" alt="Apigee Logo" width="40" style="vertical-align: middle; margin-right: 8px;" /> Apigee Enterprise AI Gateway (`ai-gateway`)


[![Documentation](https://img.shields.io/badge/docs-GitHub_Pages-blue.svg)](https://ra2085.github.io/ai-gw-sample/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

An enterprise-grade, production-ready **AI Gateway** on Google Cloud Apigee, featuring **Universal Protocol Normalization**, **Smart Routing & LLM as a Judge**, **GCP Model Armor Security**, **Token Quotas**, and **Apigee Monetization with Real-Time Micro-Transactions Tracking**.

---

## Documentation Site

Full guides, architecture specifications, and API references are available on our documentation site:

**[https://ra2085.github.io/ai-gw-sample/](https://ra2085.github.io/ai-gw-sample/)**

---

## Progressive Adoption Journey

The repository is organized for a progressive learning curve:

1. **[Quickstart (5 Minutes)](docs/getting-started/quickstart-template.md)**: Deploy a working gateway with minimal configuration supporting Gemini and Claude.
2. **[Configuration Reference](docs/template-guide/configuration.md)**: Full schema reference of all `values.yaml` options, endpoints, and defaults.
3. **[Custom Providers & URLs](docs/template-guide/custom-urls.md)**: Bring your own models (Azure, DeepSeek, Mistral, Ollama, vLLM) with custom auth.
4. **[Enterprise Feature Toggles](docs/template-guide/feature-flags.md)**: Turn on Model Armor security, token quotas, and monetization as needed.
5. **[Smart Routing & LLM Judge](docs/architecture/routing.md)**: Enable AI-driven complexity classification and cost tier routing.


---

## Key Highlights

* **Universal Protocol Normalization:** Query Anthropic Claude, Google Gemini on Vertex AI, or self-hosted OpenAI models using Anthropic (`/v1/messages`), Gemini (`/ai-gateway`), or OpenAI (`/v1/chat/completions`) schemas with real-time SSE streaming translation.
* **Smart Routing & LLM Judge:** Optimize cost and performance using abstract cost tiers (`low`, `medium`, `high`, `max`), fallback chains, or real-time prompt complexity classification powered by Gemini 3.1 Flash-Lite.
* **Enterprise Security:** Automated prompt and response sanitization via GCP Model Armor to prevent data leakage and prompt injection.
* **Token Monetization:** Pre-flight prepaid wallet balance verification and real-time micro-transaction token billing.
* **Custom URLs & Multi-Cloud LLMs:** Declare custom target URLs and formats (`openai`, `anthropic`, `gemini`) in `values.yaml` to route to self-hosted vLLM/Ollama or Azure OpenAI instances.
* **Declarative Configuration:** Define models, pricing, and features in a single `values.yaml` file to generate a complete Apigee proxy bundle.


---

## Architecture Overview

```mermaid
graph LR
    subgraph Clients["Client Applications"]
        C1["OpenAI SDK"]
        C2["Anthropic Claude SDK"]
        C3["Vertex AI SDK"]
    end

    subgraph Gateway["Apigee AI Gateway"]
        direction TB
        G1["Universal Protocol Normalization"]
        G2["Model Armor Security & PII Sanitization"]
        G3["Smart Routing & Cost Optimization"]
        G4["Token Quotas & Monetization"]
    end

    subgraph Providers["Backend LLM Providers"]
        P1["Google Vertex AI (Gemini & Claude)"]
        P2["Third-Party APIs (OpenAI, Azure, DeepSeek)"]
        P3["Self-Hosted Clusters (vLLM, Ollama)"]
    end

    Clients --> Gateway
    Gateway --> Providers
```

> Looking for the complete 25-step policy execution sequence? See the [Pipeline Execution Flow (Appendix)](https://ra2085.github.io/ai-gw-sample/proxy-deep-dive/bundle-structure/#3-appendix-end-to-end-pipeline-execution-flow).


---

## Quickstart (5 Minutes)

> **Prerequisites:** Ensure you have [`apigee-go-gen`](https://ra2085.github.io/ai-gw-sample/getting-started/installation/#install-apigee-go-gen-template-generator) and [`apigeecli`](https://ra2085.github.io/ai-gw-sample/getting-started/installation/#install-apigeecli-deployment-cli) installed. See the [Installation Guide](https://ra2085.github.io/ai-gw-sample/getting-started/installation/) for 1-line install commands.

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

# Deploy to Apigee (requires Service Account for Vertex AI IAM authentication)
apigeecli apis create bundle \
    --proxy-zip ./out/ai-gateway.zip \
    --name ai-gateway \
    --org "$PROJECT_ID" \
    --env "$APIGEE_ENV" \
    -s "$SERVICE_ACCOUNT" \
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

