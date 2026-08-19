# 🎛 Feature Toggles & Modular Policies

The AI Gateway is designed with a **zero-overhead architecture**. When a feature is disabled in `values.yaml`, `apigee-go-gen` completely removes the corresponding policies and flow steps during compilation.

---

## Available Feature Toggles

### 1. Token Monetization (`features.monetization`)
* **Enabled:** Injects `MLC-EnforceMonetizationLimits` in PreFlow to check prepaid credit, `JS-calculate-monetization-cost` in PostFlow, and `AM-SetMonetizationHeaders`.
* **Disabled:** Omits monetization checks and rating headers for non-commercial internal gateways.

```yaml
features:
  monetization:
    enabled: false
```

---

### 2. Enterprise Security (`features.model_armor`)
* **Enabled:** Injects `SUP-SanitizeUserPrompt` on prompt ingress and `SMR-SanitizeModelResponse` on stream/response egress.
* **Disabled:** Disables Model Armor calls for reduced latency in trusted private environments.

```yaml
features:
  model_armor:
    enabled: false
```

---

### 3. LLM as a Judge Classifier (`features.llm_judge`)
* **Enabled:** Attaches `SC-LLMJudge` and parsing scripts to support `auto:judge` dynamic model routing.
* **Disabled:** Bypasses judge classification callouts.

```yaml
features:
  llm_judge:
    enabled: false
```

---

### 4. Hourly Token Quotas (`features.quotas`)
* **Enabled:** Evaluates API Product token quotas via `LTQ-EnforceOnly` and accumulates counts via `LTQ-CountOnly`.
* **Disabled:** Removes quota enforcement for unlimited throughput testing.

```yaml
features:
  quotas:
    enabled: false
```
