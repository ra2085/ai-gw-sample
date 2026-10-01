# Telemetry & Observability

Every API transaction processed by the AI Gateway emits standardized observability response headers and records token, cost, and identity attribution metrics in **Apigee Analytics**.

---

## 1. Observability & Rate-Limit Response Headers

```http
HTTP/1.1 200 OK
Content-Type: application/json
# 1. Routing & Identity Attribution
X-Gateway-Requested-Model: auto:judge
X-Gateway-Routed-Model: gemini-2.5-pro
X-Gateway-Cost-Tier: high
X-Gateway-Auth-Method: idp_jwt
X-Gateway-User-Id: alice@corp.com
X-Gateway-Persona: lead-ai-engineer
X-Gateway-Team: eng-ml

# 2. Multi-Bucket Token & Micro-Cost Telemetry
X-Gateway-Prompt-Tokens: 2000
X-Gateway-Uncached-Prompt-Tokens: 500
X-Gateway-Cache-Read-Tokens: 1500
X-Gateway-Cache-Write-Tokens: 0
X-Gateway-Completion-Tokens: 350
X-Gateway-Reasoning-Tokens: 150
X-Gateway-Total-Tokens: 2500
X-Gateway-Prompt-Cost-USD: 0.001094
X-Gateway-Completion-Cost-USD: 0.005000
X-Gateway-Total-Cost-USD: 0.006094
X-Gateway-Cost-Currency: USD

# 3. Quota & Rate Limit Headers
X-RateLimit-Tier-Mode: team_budget
X-RateLimit-Limit-Tokens: 500000
X-RateLimit-Remaining-Tokens: 497500
X-RateLimit-Limit-Tokens-Secondary: 10000000
X-RateLimit-Remaining-Tokens-Secondary: 9842000
```

---

## 2. Apigee Analytics Data Collectors (All 9 Required)

Both `DC-CaptureTokenCountsNonStreaming` (`PostFlow`) and `DC-CaptureTokenCountsStreaming` (`EventFlow`) populate **9 Data Collectors** on every request so you can build custom Apigee Analytics reports grouped by **Model**, **Developer**, **User (`dc_identity_user_id`)**, **Persona (`dc_identity_persona`)**, or **Team/Department (`dc_identity_team`)**:

| Data Collector | Type | Flow Variable Source | Description |
| :--- | :---: | :--- | :--- |
| **`dc_prompt_token_count`** | `INTEGER` | `usage_prompt_tokens` | Total prompt input tokens (including cached tokens). |
| **`dc_completion_token_count`** | `INTEGER` | `usage_completion_tokens` | Completion output tokens. |
| **`dc_total_token_count`** | `INTEGER` | `usage_total_tokens` | Total tokens consumed (`prompt + completion + reasoning`). |
| **`dc_model`** | `STRING` | `model` | Effective backend model that processed the request. |
| **`dc_requested_model`** | `STRING` | `requested_model` | Original client-requested model, alias, or `auto:judge`. |
| **`dc_tx_cost_usd`** | `FLOAT` | `tx_cost_usd` | Exact micro-transaction cost in USD (cache- & reasoning-aware). |
| **`dc_identity_user_id`** | `STRING` | `identity_user_id` | Authenticated human user (`sub`/`email`), GCP Service Account, or App ID. |
| **`dc_identity_persona`** | `STRING` | `identity_persona` | Mapped enterprise persona (`lead-ai-engineer`, `power-developer`, etc.). |
| **`dc_identity_team`** | `STRING` | `identity_team` | Department / cost-center / team attribute (`eng-ml`, `platform`, etc.). |
