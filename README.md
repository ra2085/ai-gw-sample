# <img src="img/Apigee-512-color.png" alt="Apigee Logo" width="40" style="vertical-align: middle; margin-right: 8px;" /> Apigee Enterprise AI Gateway (`ai-gateway`)

[![Documentation](https://img.shields.io/badge/docs-GitHub_Pages-blue.svg)](https://ra2085.github.io/ai-gw-sample/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

A declarative **Enterprise AI Gateway framework** on Google Cloud Apigee. Define your models, **AI Products** (personas and tenant boundaries), authentication, token quotas, **Invoice-Accurate Cost Attribution**, and routing rules in a single `values.yaml` file—without writing or maintaining raw Apigee XML policies.

Full documentation is available at **[https://ra2085.github.io/ai-gw-sample/](https://ra2085.github.io/ai-gw-sample/)**.

---

## Core Concept: The AI Product Model

Instead of managing per-user rules or separate proxies for every model provider, the gateway organizes access around **AI Products** (Apigee API Products). An AI Product defines a consumer tier or tenant boundary:

| AI Product Example | Target Consumers | Allowed Models | Default Token Quota |
| :--- | :--- | :--- | :--- |
| **`lead-ai-engineer`** | Principal & Staff Engineers (`Claude Code`, `Codex`) | All models (including `claude-opus-4-6` & `gemini-3.1-pro-preview`) | 500,000 tokens / 4 hours |
| **`power-developer`** | Senior Developers | `claude-sonnet-4-6`, `gemini-3.1-pro-preview`, `gemini-3.5-flash` | 200,000 tokens / 4 hours |
| **`developer-default`** | Standard Engineering Org | Fast / Economy models (`gemini-3.5-flash`, `claude-haiku-4-5`) | 50,000 tokens / 4 hours |
| **`autonomous-agent`** | CI/CD Pipelines & Cloud Run Agents | Approved workflow models + shared department budget | 1,000,000 tokens / hour |

With 3–5 AI Products, you can govern **10,000+ developers and autonomous agents** while enforcing isolated per-user token counters, per-model caps, shared team budgets, and context-aware Model Armor safety policies.

---

## Quickstart (5 Minutes)

> **Prerequisites:** Complete the one-time setup in **[Prerequisites & Setup](docs/getting-started/installation.md)** (`apigee-go-gen`, `apigeecli`, Google Cloud Service Account with `roles/aiplatform.user`, and telemetry Data Collectors).

### 1. Copy & Customize Your Gateway (`./values.yaml`)

```bash
cp ./templates/ai-gateway/values.quickstart.yaml ./values.yaml
```

Edit `./values.yaml` and set `gateway.project_id` to your GCP project ID:

```yaml
gateway:
  name: "ai-gateway"
  project_id: "your-gcp-project-id"

models:
  - name: "gemini-3.5-flash"
    displayName: "Gemini 3.5 Flash"
    publisher: "google"
    format: "gemini"
    region: "global"
    is_default: true

  - name: "claude-haiku-4-5"
    displayName: "Claude 4.5 Haiku"
    publisher: "anthropic"
    target: "claude"
    format: "anthropic"
    region: "us-east5"

  - name: "text-embedding-005"
    displayName: "Vertex AI Text Embedding 005"
    publisher: "google"
    target: "gemini-openai-compat"
    format: "openai"
    region: "us-central1"

  # Optional: Self-Hosted or External OpenAI-Compatible Model
  - name: "my-vllm-model"
    displayName: "Llama 3 (Self-Hosted)"
    format: "openai"
    custom_url: "https://vllm.internal.corp/v1/chat/completions"
```

### 2. Provision AI Products, Render & Deploy

```bash
# 1. Safely provision Apigee API Products (llmOperationGroup) & Developer App keys
#    (If using SSO/Agent token import, copy the generated client_id values into ./values.yaml;
#     direct x-api-key calls work immediately with the generated $API_KEY)
bash ./scripts/sync-personas.sh \
    --values ./values.yaml \
    --org "$PROJECT_ID" \
    --env "$APIGEE_ENV"

# 2. Compile the Apigee proxy bundle from YAML
apigee-go-gen render apiproxy \
    --template ./templates/ai-gateway/apiproxy.yaml \
    --values ./values.yaml \
    --set "gateway.project_id=$PROJECT_ID" \
    --output ./out/ai-gateway.zip

# 3. Deploy to Apigee X / Hybrid
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

## Documentation Navigation

The documentation is organized into four task-oriented sections:

| Section | Guides | What You Will Find |
| :--- | :--- | :--- |
| **1. Getting Started** | • [Overview](docs/index.md)<br>• [5-Minute Quickstart](docs/getting-started/quickstart-template.md)<br>• [Prerequisites & Setup](docs/getting-started/installation.md) | Core architecture, minimal quickstart YAML, and one-time CLI/IAM setup. |
| **2. Guides** | • [AI Products, Tenancy & Auth](docs/architecture/security.md)<br>• [Models & Providers](docs/template-guide/custom-urls.md)<br>• [Quotas, Budgets & Cost Control](docs/architecture/monetization.md)<br>• [Smart Routing & Content Safety](docs/architecture/routing.md) | Copy-pasteable `values.yaml` recipes for Corporate SSO, API Keys, GCP Agents, Vertex AI, MaaS, Direct OpenAI & Anthropic (`provider_keys` PropertySet), token budgets, Invoice-Accurate Cost Attribution, and Model Armor. |
| **3. Reference** | • [`values.yaml` Reference](docs/template-guide/configuration.md)<br>• [Feature Toggles](docs/template-guide/feature-flags.md)<br>• [Client Endpoints & Protocols](docs/architecture/protocols.md) | Complete schema table, feature toggles, and client SDK compatibility matrix. |
| **4. Analytics & Operations** | • [Analytics & Looker Studio Dashboards](docs/operations/looker-studio-dashboard.md)<br>• [Telemetry & Headers](docs/operations/telemetry.md)<br>• [CI/CD & Deployment](docs/operations/deployment.md) | Looker Studio persona dashboards (multi-bucket FinOps chargeback, Prompt Cache ROI, team/peer insights, developer self-service, security & quota governance, Judge ROI), response headers (`X-Gateway-*`, `x-quota-*`), and CI/CD deployment. |
