# 🚀 Deployment & Testing Guide

Follow these steps to validate, deploy, and test the AI Gateway in CI/CD or production.

---

## 1. Create Required Data Collectors (Once per Organization)

Apigee requires the following **9 Data Collectors** to record token metrics, billing telemetry, and identity attribution (`user_id`, `persona`, `team`):

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

## 2. Offline Template & Runtime Validation (Pre-Deploy CI/CD)

Before deploying to Apigee, run the offline validation suites to verify template rendering, XML policy integrity, cross-protocol JS transcoding, 4-Option Auth, Per-Model/Team/Exception Quotas, and Rhino IIFE memory safety:

```bash
# 1. Validate full enterprise template (8 test suites including JS runtime simulation)
./tests/scripts/test_template.sh

# 2. Validate 15-line minimal quickstart template
./tests/scripts/test_quickstart.sh
```

---

## 3. Deploy Generated Proxy Bundle

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

---

## 4. Run End-to-End Live Test Suites

Once deployed, run the automated live verification scripts against your Apigee hostname:

```bash
# Master end-to-end test suite
./tests/scripts/test_all.sh "$APIGEE_HOST" "$API_KEY" "$PROJECT_ID"

# Targeted feature test suites
./tests/scripts/test_smart_routing.sh "$APIGEE_HOST" "$API_KEY"
./tests/scripts/test_judge.sh "$APIGEE_HOST" "$API_KEY" "$PROJECT_ID"
./tests/scripts/test_monetization.sh "$APIGEE_HOST" "$API_KEY"
./tests/scripts/test_quota.sh "$APIGEE_HOST" "$API_KEY"
./tests/scripts/test_model_armor.sh "$APIGEE_HOST" "$API_KEY"
```

