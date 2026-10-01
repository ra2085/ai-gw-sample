# CI/CD & Deployment Guide

Follow these steps to render, validate, and deploy the AI Gateway in CI/CD or production environments.

---

## 1. Create Required Data Collectors (Once per Organization)

Apigee requires the following **9 Data Collectors** to record token metrics, cost attribution telemetry, and identity dimensions (`user_id`, `persona`, `team`):

```bash
for dc in \
  "dc_prompt_token_count:INTEGER" \
  "dc_completion_token_count:INTEGER" \
  "dc_total_token_count:INTEGER" \
  "dc_model:STRING" \
  "dc_requested_model:STRING" \
  "dc_tx_cost_usd:FLOAT" \
  "dc_identity_user_id:STRING" \
  "dc_identity_persona:STRING" \
  "dc_identity_team:STRING"; do
  IFS=":" read -r name type <<< "$dc"
  apigeecli datacollectors create -o "$PROJECT_ID" -n "$name" -p "$type" --default-token || true
done
```

---

## 2. Dry-Run Template Validation (Pre-Deploy CI/CD)

Before packaging and deploying to Apigee, validate that your `values.yaml` configuration renders cleanly using `apigee-go-gen --dry-run xml`:

```bash
apigee-go-gen render apiproxy \
    --template ./templates/ai-gateway/apiproxy.yaml \
    --values ./templates/ai-gateway/values.yaml \
    --dry-run xml
```

---

## 3. Render & Deploy Proxy Bundle

> [!IMPORTANT]
> **Service Account Prerequisite**: Because the gateway's upstream targets and Google Cloud features (Model Armor, LLM Judge) authenticate using Google Cloud IAM tokens, attach a Service Account with `roles/aiplatform.user` (and `roles/modelarmor.user` if Model Armor is enabled) at deploy time using `-s "$SERVICE_ACCOUNT"`.

```bash
export SERVICE_ACCOUNT="ai-gateway-sa@${PROJECT_ID}.iam.gserviceaccount.com"

# 1. Render bundle from template
apigee-go-gen render apiproxy \
    --template ./templates/ai-gateway/apiproxy.yaml \
    --values ./templates/ai-gateway/values.yaml \
    --output ./out/ai-gateway.zip

# 2. Deploy to Apigee
apigeecli apis create bundle \
    --name ai-gateway \
    --proxy-zip ./out/ai-gateway.zip \
    --org "$PROJECT_ID" \
    --env "$APIGEE_ENV" \
    -s "$SERVICE_ACCOUNT" \
    --ovr \
    --wait \
    --default-token
```

---

## 4. Verify the Deployment

Once deployed, verify your model catalog and inspect the `X-Gateway-*` response headers using `curl`:

```bash
# 1. Verify the dynamic model catalog
curl -s "https://$APIGEE_HOST/v1/models" \
  -H "x-api-key: $API_KEY" | jq .

# 2. Send a test request and inspect X-Gateway-* telemetry headers
curl -i -X POST "https://$APIGEE_HOST/v1/messages" \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-3.5-flash",
    "max_tokens": 128,
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

