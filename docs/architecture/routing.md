# Smart Routing & Content Safety

Optimize cost, availability, and content safety across all your models without changing client application code.

---

## 1. Smart Routing Strategies

Select a routing strategy below to see how it is configured in `values.yaml` and used by clients:

=== "Model Aliases"
    **Best for:** Migrating existing OpenAI or Claude applications to new models with **zero client code changes**.

    Configure aliases in `values.yaml`:
    ```yaml
    routing:
      aliases:
        "gpt-5.4": "gemini-3.1-pro-preview"
        "gpt-5.4-mini": "gemini-3.1-flash-lite"
        "claude-3-5-sonnet": "claude-sonnet-4-6"
    ```

    When a client requests `"model": "gpt-5.4"`, the gateway transparently routes the call to `gemini-3.1-pro-preview` while recording both the requested alias (`X-Gateway-Requested-Model`) and the actual model used (`X-Gateway-Routed-Model`).

=== "Cost Tiers (`low`, `medium`, `high`, `max`)"
    **Best for:** Decoupling applications from specific model versions so platform teams can upgrade underlying models centrally.

    Configure your tiers in `values.yaml`:
    ```yaml
    routing:
      tiers:
        low: "gemini-3.1-flash-lite"
        medium: "gemini-3.5-flash"
        high: "gemini-3.1-pro-preview"
        max: "claude-sonnet-4-6"
    ```

    Clients can request a tier using `"model": "auto:low"`, the `X-Model-Cost-Tier: low` header, or `"plugins": [{"id": "auto-router", "cost_tier": "low"}]`.

=== "Automatic Complexity Judge (`auto:judge`)"
    **Best for:** Automatically sending simple prompts (summaries, formatting, basic Q&A) to fast, inexpensive models while reserving frontier reasoning models for complex coding and analysis.

    Enable the classifier in `values.yaml`:
    ```yaml
    features:
      llm_judge:
        enabled: true
        classifier_model: "gemini-3.1-flash-lite"

    routing:
      tasks:
        coding: "gemini-3.1-pro-preview"
        reasoning: "gemini-3.1-pro-preview"
        creative_writing: "claude-sonnet-4-6"
        summarization: "gemini-3.1-flash-lite"
        simple_chat: "gemini-3.5-flash"
    ```

    Clients simply pass `"model": "auto:judge"` (or header `X-Gateway-Judge: true`).

=== "Fallback Chains"
    **Best for:** High-availability applications that want prioritized model failover.

    Clients pass a `models` array in the request body, and the gateway selects the first configured and available model:
    ```json
    {
      "models": ["claude-sonnet-4-6", "gemini-3.1-pro-preview", "gemini-3.5-flash"],
      "messages": [{"role": "user", "content": "Analyze this quarterly report."}]
    }
    ```

---

## 2. Content Safety (Google Cloud Model Armor)

When `features.model_armor.enabled: true` is set in `values.yaml`, the gateway inspects both incoming prompts and outgoing model responses (including streaming responses) using **Google Cloud Model Armor**:

```yaml
features:
  model_armor:
    enabled: true
    project_id: "your-gcp-project-id"
    template_id: "filter"
```

* **Sensitive Data Protection (SDP):** Detects and blocks or redacts PII, credit card numbers, credentials, and API keys before they leave your environment.
* **Prompt Injection & Jailbreak Protection:** Blocks prompt injection attempts and system instruction overrides before the model is called.
* **Response Safety Filters:** Screens generated completions for harmful or unsafe content before returning them to the client.

