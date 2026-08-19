# 💳 Monetization & Micro-Transactions

The gateway natively integrates with **Apigee Monetization** to bill LLM usage on a per-token basis in real time.

---

## 1. Pre-Flight Credit Enforcement

Before dispatching expensive requests to Vertex AI, the gateway evaluates the developer's prepaid wallet balance:

```xml
<Step>
  <Name>MLC-EnforceMonetizationLimits</Name>
</Step>
```

* Non-monetized free products pass through without billing overhead.
* Monetized products verify active subscriptions and sufficient funds, rejecting depleted accounts immediately.

---

## 2. Micro-Cost Calculation

Executed in PostFlow response to calculate exact dollar costs:

$$\text{Total Cost (USD)} = \left[ \left( \frac{\text{Prompt Tokens}}{10^6} \times \text{Input Rate} \right) + \left( \frac{\text{Completion Tokens}}{10^6} \times \text{Output Rate} \right) \right] \times \text{Markup}$$

### Pricing Matrix (USD per 1,000,000 Tokens)

| Model ID | Input Rate / 1M | Output Rate / 1M | Tier |
| :--- | :--- | :--- | :--- |
| **`gemini-3.1-flash-lite`** | **\$0.075** | **\$0.30** | Low / Flash-Lite |
| **`gemini-3.5-flash`** | **\$0.100** | **\$0.40** | Medium / Balanced |
| **`gemini-3.7-flash`** | **\$0.150** | **\$0.60** | Fast / Hybrid |
| **`gemini-2.5-pro`** | **\$1.250** | **\$5.00** | High / Reasoning |
| **`claude-haiku-4-5`** | **\$1.000** | **\$5.00** | Max / Enterprise |

---

## 3. Real-Time Prepaid Wallet Deductions

Apigee Monetization Data Collectors rate the transaction and deduct funds dynamically:

```xml
<Capture>
  <Collect ref="perUnitPriceMultiplier" default="1.0"/>
  <DataCollector scope="monetization">perUnitPriceMultiplier</DataCollector>
</Capture>
```
