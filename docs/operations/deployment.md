# 🚀 Deployment Guide

Follow these steps to deploy and manage the AI Gateway in production.

---

## 1. Create Required Data Collectors (Once per Organization)

Apigee requires the following Data Collectors to record token metrics and billing telemetry:

```bash
for dc in \
  "dc_prompt_token_count:INTEGER" \
  "dc_completion_token_count:INTEGER" \
  "dc_total_token_count:INTEGER" \
  "dc_model:STRING" \
  "dc_requested_model:STRING" \
  "dc_tx_cost_usd:FLOAT"; do
  IFS=":" read -r name type <<< "$dc"
  apigeecli datacollectors create -o "$PROJECT_ID" -n "$name" -p "$type" --default-token || true
done
```


---

## 2. Deploy Generated Proxy Bundle

> [!IMPORTANT]
> **Service Account Prerequisite**: Because the proxy's TargetEndpoints and Google Cloud features (Model Armor, LLM Judge) authenticate using Google Cloud IAM tokens, you must attach a Service Account with `roles/aiplatform.user` (and `roles/modelarmor.user` if Model Armor is enabled) at deploy time using `-s "$SERVICE_ACCOUNT"`.

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

