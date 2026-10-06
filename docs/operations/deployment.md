# CI/CD & Deployment Guide

Follow these steps to render, validate, and deploy the AI Gateway in CI/CD or production environments.

---

## 1. Create Required Data Collectors (Once per Organization)

Apigee requires the following **18 Data Collectors** to record granular token metrics (`prompt`, `uncached_prompt`, `cache_read`, `cache_write`, `thinking`, `completion`, `total`), per-token-type USD cost attribution (`uncached_prompt_cost`, `cache_read_cost`, `cache_write_cost`, `prompt_cost`, `completion_cost`, `total_cost`), and identity dimensions (`user_id`, `persona`, `team`):

```bash
for dc in \
  "dc_prompt_token_count:INTEGER" \
  "dc_uncached_prompt_token_count:INTEGER" \
  "dc_cache_read_token_count:INTEGER" \
  "dc_cache_write_token_count:INTEGER" \
  "dc_thinking_token_count:INTEGER" \
  "dc_completion_token_count:INTEGER" \
  "dc_total_token_count:INTEGER" \
  "dc_tx_uncached_prompt_cost_usd:FLOAT" \
  "dc_tx_cache_read_cost_usd:FLOAT" \
  "dc_tx_cache_write_cost_usd:FLOAT" \
  "dc_tx_prompt_cost_usd:FLOAT" \
  "dc_tx_completion_cost_usd:FLOAT" \
  "dc_tx_cost_usd:FLOAT" \
  "dc_model:STRING" \
  "dc_requested_model:STRING" \
  "dc_identity_user_id:STRING" \
  "dc_identity_persona:STRING" \
  "dc_identity_team:STRING"; do
  IFS=":" read -r name type <<< "$dc"
  apigeecli datacollectors create -o "$PROJECT_ID" -n "$name" -p "$type" --default-token || true
done
```

---

## 2. Dry-Run Template Validation (Pre-Deploy CI/CD)

Before packaging and deploying to Apigee, validate that your `values.yaml` configuration renders cleanly using `apigee-go-gen --dry-run xml` and preview any API Product / Persona changes with `scripts/sync-personas.sh --dry-run`:

```bash
# 1. Validate XML template rendering
apigee-go-gen render apiproxy \
    --template ./templates/ai-gateway/apiproxy.yaml \
    --values ./templates/ai-gateway/values.yaml \
    --dry-run xml

# 2. Preview API Product (llmOperationGroup) & Developer App upserts (zero network calls)
bash ./scripts/sync-personas.sh \
    --values ./templates/ai-gateway/values.yaml \
    --org "$PROJECT_ID" \
    --env "$APIGEE_ENV" \
    --dry-run
```

---

## 3. Sync Personas & Deploy Proxy Bundle

> [!IMPORTANT]
> **Service Account Prerequisite**: Because the gateway's upstream targets and Google Cloud features (Model Armor, LLM Judge) authenticate using Google Cloud IAM tokens, attach a Service Account with `roles/aiplatform.user` (and `roles/modelarmor.user` if Model Armor is enabled) at deploy time using `-s "$SERVICE_ACCOUNT"`.

```bash
export SERVICE_ACCOUNT="ai-gateway-sa@${PROJECT_ID}.iam.gserviceaccount.com"

# 1. (Optional — Day 1 or when adding new personas/catalog models)
# Safely upsert Apigee API Products (llmOperationGroup) & Developer Apps
bash ./scripts/sync-personas.sh \
    --values ./templates/ai-gateway/values.yaml \
    --org "$PROJECT_ID" \
    --env "$APIGEE_ENV"

# 2. Render bundle from template
apigee-go-gen render apiproxy \
    --template ./templates/ai-gateway/apiproxy.yaml \
    --values ./templates/ai-gateway/values.yaml \
    --output ./out/ai-gateway.zip

# 3. Deploy to Apigee
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

