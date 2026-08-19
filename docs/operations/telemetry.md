# 📊 Telemetry & Observability

Every API transaction processed by the AI Gateway emits standardized observability response headers and records metrics in Apigee Analytics.

---

## 1. Observability Response Headers

```http
HTTP/1.1 200 OK
Content-Type: application/json
X-Gateway-Requested-Model: auto:judge
X-Gateway-Routed-Model: gemini-3.5-flash
X-Gateway-Cost-Tier: medium
X-Gateway-Prompt-Tokens: 1500
X-Gateway-Completion-Tokens: 350
X-Gateway-Total-Tokens: 1850
X-Gateway-Prompt-Cost-USD: 0.000150
X-Gateway-Completion-Cost-USD: 0.000140
X-Gateway-Total-Cost-USD: 0.000290
X-Gateway-Cost-Currency: USD
```

---

## 2. Apigee Analytics Data Collectors

| Data Collector | Type | Description |
| :--- | :--- | :--- |
| **`dc_prompt_token_count`** | `INTEGER` | Billed prompt input token count. |
| **`dc_completion_token_count`** | `INTEGER` | Billed completion output token count. |
| **`dc_total_token_count`** | `INTEGER` | Total token consumption count. |
| **`dc_model`** | `STRING` | Effective model that processed the request. |
| **`dc_requested_model`** | `STRING` | Original consumer request intent. |
| **`dc_tx_cost_usd`** | `FLOAT` | Micro-transaction cost in USD. |
