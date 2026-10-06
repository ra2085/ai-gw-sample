# <img src="img/Apigee-512-color.png" alt="Apigee Logo" width="40" style="vertical-align: middle; margin-right: 8px;" /> Apigee Enterprise AI Gateway

The **Apigee Enterprise AI Gateway** is a declarative framework for operating and governing AI traffic on Google Cloud Apigee.

Instead of building custom API proxies from scratch for every model provider and client SDK, you define your gateway in a single [`values.yaml`](template-guide/configuration.md) file and organize consumption around **AI Products**.

---

## Core Concepts

<div class="grid cards" markdown>

-   **1. Declarative Gateway Configuration (`values.yaml`)**

    ---

    Define your model catalog, routing rules, and security guardrails in a single YAML file. The framework compiles a complete, production-ready Apigee bundle in seconds—start in 15 lines of YAML and turn on advanced capabilities as your needs grow.

-   **2. The AI Product Model (Personas & Multi-Tenancy)**

    ---

    Package model access, token budgets, and rate limits into reusable **AI Products** (backed by Apigee API Products) aligned to how your organization works—such as **Knowledge Workers**, **Developers**, **Lead AI Engineers**, or **Autonomous Agents**.

-   **3. Universal Client & Model Compatibility**

    ---

    Developers and agents connect using their preferred tools (`Claude Code`, `Codex`, Anthropic SDK, OpenAI SDK, or Google GenAI SDK), and the gateway translates requests and streams across **Vertex AI (Gemini, Claude, Llama, Mistral)**, **Direct OpenAI**, and **self-hosted models**.

-   **4. Invoice-Accurate Cost Attribution & Spend Control**

    ---

    Calculate exact dollar costs (including prompt cache read/write rates and internal reasoning tokens) across every model, AI Product persona, and department, with out-of-the-box Looker Studio dashboards.

</div>

---

## How the Framework Fits Together

<div class="grid cards" markdown>

-   **1. Who Calls the Gateway (Any SDK or Identity)**

    ---

    * **Developers & CLI Tools:** `Claude Code`, `Codex`, Anthropic SDK, OpenAI SDK, Google GenAI SDK
    * **Internal Apps & Portals:** Corporate SSO (`Okta`, `Entra ID`, `Ping`) & Apigee OAuth / API Keys
    * **Autonomous Agents:** Vertex AI Agent Engine (`SPIFFE` `.system.id.goog`) & GCP Service Accounts

-   **2. How You Govern (Apigee AI Products)**

    ---

    * **Lead Engineer:** High USD / Token budget • All frontier models (`claude-opus-4-6`, `gemini-3.1-pro`)
    * **Standard Developer:** Personal daily cap + shared department pool • Coding & reasoning models
    * **Knowledge Worker:** Standard budget • Fast, cost-efficient models (`gemini-3.5-flash`, `claude-haiku-4-5`)
    * **Autonomous Agent:** Dedicated service quota • Scoped task models • Burst & stream concurrency limits

-   **3. Where Models Run (Multi-Cloud & Self-Hosted)**

    ---

    * **Google Cloud Vertex AI:** Gemini, Anthropic Claude, Embeddings & Model Garden MaaS (`Llama`, `Mistral`, `Qwen`)
    * **Direct Cloud Providers:** OpenAI, Anthropic & Azure OpenAI (isolated keys per app or PropertySet)
    * **Self-Hosted Clusters:** Custom `vLLM`, `Ollama` & private endpoints on GKE or Cloud Run

</div>

---

## Explore the Guides

| Step | Guide | What You Will Accomplish |
| :--- | :--- | :--- |
| **Step 1** | **[5-Minute Quickstart](getting-started/quickstart-template.md)** | Render and deploy a working AI Gateway from a minimal 15-line `values.quickstart.yaml` file. |
| **Step 2** | **[AI Products, Tenancy & Auth](architecture/security.md)** | Design your **AI Product** tiers for personas and teams, and connect API Keys, Corporate SSO (Okta / Entra / Ping), or GCP Agent identities. |
| **Step 3** | **[Models & Providers](template-guide/custom-urls.md)** | Add Vertex AI Gemini & Claude, Model Garden MaaS (Llama, Mistral), Direct OpenAI & Anthropic (`provider_keys` PropertySet), Embeddings, or self-hosted vLLM. |
| **Step 4** | **[Quotas, Budgets & Cost Control](architecture/monetization.md)** | Configure rolling token allowances, per-model caps, shared department budgets, temporary overrides, and **Invoice-Accurate Cost Attribution**. |
| **Step 5** | **[Smart Routing & Content Safety](architecture/routing.md)** | Set up transparent model aliases, cost tiers, fallback chains, complexity-based routing (`auto:judge`), and GCP Model Armor sanitization. |

