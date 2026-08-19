# 🔒 Enterprise Security & GCP Model Armor

Enterprise security is enforced at both input and output boundaries using **Google Cloud Model Armor**.

---

## 1. Prompt Sanitization (Ingress)

Every incoming prompt is extracted and sanitized before reaching the LLM target:

```xml
<SanitizeUserPrompt name="SUP-SanitizeUserPrompt">
  <ModelArmor>
    <TemplateName>projects/{propertyset.config.model_armor_project_id}/locations/global/templates/{propertyset.config.model_armor_template}</TemplateName>
  </ModelArmor>
  <UserPromptSource>{extracted_prompt}</UserPromptSource>
</SanitizeUserPrompt>
```

* **Sensitive Data Protection (SDP):** Detects and masks PII, credit cards, credentials, and API keys.
* **Prompt Injection Detection:** Blocks jailbreak attempts and system instruction overrides.

---

## 2. Model Response Sanitization (Egress)

Generated model responses and SSE chunks are filtered in PostFlow and EventFlow:

* **De-identification Findings:** Detected violations trigger custom error responses or content redaction via `JS-inject-deidentified-finding`.
* **Toxicity & Harm Filters:** Blocks hate speech, harassment, and unsafe completions before they reach the client application.
