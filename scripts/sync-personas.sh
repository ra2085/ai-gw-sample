#!/usr/bin/env bash
# ==============================================================================
# Apigee AI Gateway — Safe, Additive Persona & API Product Upsert Tool
# ==============================================================================
# Safely provisions or updates Apigee API Products, Persona Developer, and
# Developer Apps declared under `personas` in values.yaml.
#
# Safety Guardrails (Zero Blast Radius):
#   1. Strictly Additive (Create-or-Update only): Never deletes any API Product,
#      Developer, or Developer App.
#   2. Scoped Naming: Only touches API Products named `<proxy>-<persona>` and
#      Developer Apps named `<proxy>-<persona>-app`.
#   3. Zero Key Rotation: If a Persona Developer App already exists, its
#      existing consumerKey (`client_id`) is preserved and never rotated.
#   4. Dry-Run Preview (`--dry-run`): Prints exact API Product & App payloads
#      without mutating Apigee state.
# ==============================================================================

set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

VALUES_FILE="$REPO_ROOT/templates/ai-gateway/values.yaml"
BUNDLE_DIR=""
APIGEE_ORG="${APIGEE_ORG:-}"
APIGEE_ENV="${APIGEE_ENV:-qa}"
PROXY_NAME=""
DEV_EMAIL=""
DRY_RUN=false

usage() {
    cat <<EOF
Usage: bash scripts/sync-personas.sh [OPTIONS]

Safely creates or updates (upserts) Apigee API Products and Developer Apps
for each audience/persona defined in values.yaml.

Options:
  --values <path>      Path to values.yaml (default: templates/ai-gateway/values.yaml)
  --bundle <path>      Path to already-rendered apiproxy directory (optional)
  --org <org_id>       Apigee Organization / GCP Project ID (or set APIGEE_ORG)
  --env <env_name>     Apigee Environment name (default: qa, or set APIGEE_ENV)
  --proxy <name>       API Proxy name override (defaults to gateway.name in values.yaml)
  --developer <email>  Developer email owning Persona Apps (default: ai-gateway-personas@<org>.iam.gserviceaccount.com)
  --dry-run            Preview all API Product & App upserts without calling Apigee APIs
  -h, --help           Show this help message
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --values)
            VALUES_FILE="$2"
            shift 2
            ;;
        --bundle)
            BUNDLE_DIR="$2"
            shift 2
            ;;
        --org)
            APIGEE_ORG="$2"
            shift 2
            ;;
        --env)
            APIGEE_ENV="$2"
            shift 2
            ;;
        --proxy)
            PROXY_NAME="$2"
            shift 2
            ;;
        --developer)
            DEV_EMAIL="$2"
            shift 2
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown argument: $1${NC}" >&2
            usage
            exit 1
            ;;
    esac
done

TMP_WORK_DIR="$(mktemp -d /tmp/ai-gw-persona-sync.XXXXXX)"
cleanup() {
    if [[ -n "$TMP_WORK_DIR" && -d "$TMP_WORK_DIR" ]]; then
        rm -rf "$TMP_WORK_DIR"
    fi
}
trap cleanup EXIT

# 1. Resolve or render bundle to obtain config.properties & model_locations.properties
if [[ -z "$BUNDLE_DIR" ]]; then
    if [[ ! -f "$VALUES_FILE" ]]; then
        echo -e "${RED}✗ Error: values file not found at $VALUES_FILE${NC}" >&2
        exit 1
    fi
    if command -v apigee-go-gen &>/dev/null; then
        APIGEE_GEN="apigee-go-gen"
    elif [[ -f "$REPO_ROOT/bin/apigee-go-gen" ]]; then
        APIGEE_GEN="$REPO_ROOT/bin/apigee-go-gen"
    elif [[ -f "$REPO_ROOT/apigeegg/apigee-go-gen/bin/apigee-go-gen" ]]; then
        APIGEE_GEN="$REPO_ROOT/apigeegg/apigee-go-gen/bin/apigee-go-gen"
    else
        echo -e "${RED}✗ Error: 'apigee-go-gen' not found in PATH. Provide --bundle <dir> or install apigee-go-gen.${NC}" >&2
        exit 1
    fi

    "$APIGEE_GEN" render apiproxy \
        --template "$REPO_ROOT/templates/ai-gateway/apiproxy.yaml" \
        --values "$VALUES_FILE" \
        --output "$TMP_WORK_DIR/rendered" \
        --validate=false >/dev/null
    BUNDLE_DIR="$TMP_WORK_DIR/rendered/apiproxy"
fi

CONFIG_PROPS="$BUNDLE_DIR/resources/properties/config.properties"
MODEL_PROPS="$BUNDLE_DIR/resources/properties/model_locations.properties"
if [[ ! -f "$CONFIG_PROPS" ]]; then
    echo -e "${RED}✗ Error: config.properties not found at $CONFIG_PROPS${NC}" >&2
    exit 1
fi

get_prop() {
    local key="$1"
    local val
    val=$(grep -E "^${key}=" "$CONFIG_PROPS" 2>/dev/null | tail -n 1 | cut -d'=' -f2- || true)
    echo "${val}"
}

if [[ -z "$PROXY_NAME" ]]; then
    PROXY_XML=$(find "$BUNDLE_DIR" -maxdepth 1 -name "*.xml" | head -n 1 || true)
    if [[ -n "$PROXY_XML" ]]; then
        PROXY_NAME=$(basename "$PROXY_XML" .xml)
    else
        PROXY_NAME="ai-gateway"
    fi
fi

if [[ -z "$APIGEE_ORG" ]]; then
    PROP_PROJ=$(get_prop "project_id")
    if [[ -n "$PROP_PROJ" && "$PROP_PROJ" != "{organization.name}" ]]; then
        APIGEE_ORG="$PROP_PROJ"
    else
        APIGEE_ORG="my-apigee-org"
    fi
fi

if [[ -z "$DEV_EMAIL" ]]; then
    DEV_EMAIL="ai-gateway-personas@${APIGEE_ORG}.iam.gserviceaccount.com"
fi

PERSONAS_CSV=$(get_prop "auth_personas_list")
if [[ -z "$PERSONAS_CSV" ]]; then
    PERSONAS_CSV="knowledge-worker,developer,it,agent"
fi

echo -e "${BLUE}======================================================================${NC}"
echo -e "${BLUE}🛡️  Apigee AI Gateway — Safe Persona & API Product Upsert${NC}"
echo -e "${BLUE}======================================================================${NC}"
echo -e "  Organization : ${GREEN}${APIGEE_ORG}${NC}"
echo -e "  Environment  : ${GREEN}${APIGEE_ENV}${NC}"
echo -e "  Proxy Name   : ${GREEN}${PROXY_NAME}${NC}"
echo -e "  Developer    : ${GREEN}${DEV_EMAIL}${NC}"
echo -e "  Personas     : ${GREEN}${PERSONAS_CSV}${NC}"
echo -e "  Mode         : $(if $DRY_RUN; then echo -e "${YELLOW}DRY-RUN (no changes will be applied)${NC}"; else echo -e "${GREEN}LIVE UPSERT (additive create-or-update)${NC}"; fi)"
echo -e "${BLUE}======================================================================${NC}"

TOKEN=""
if ! $DRY_RUN; then
    TOKEN=$(gcloud auth print-access-token 2>/dev/null || true)
    if [[ -z "$TOKEN" ]]; then
        echo -e "${RED}✗ Error: Unable to obtain gcloud access token. Run 'gcloud auth login' or use --dry-run.${NC}" >&2
        exit 1
    fi
fi

APIGEE_API="https://apigee.googleapis.com/v1/organizations/${APIGEE_ORG}"

# Step 1: Safe Upsert of Persona Owner Developer
echo -e "\n${YELLOW}Step 1: Ensuring Persona Owner Developer (${DEV_EMAIL})...${NC}"
DEV_PAYLOAD=$(python3 -c 'import json, sys; print(json.dumps({"email": sys.argv[1], "firstName": "AI-Gateway", "lastName": "Personas", "userName": "ai-gateway-personas"}))' "$DEV_EMAIL")

if $DRY_RUN; then
    echo -e "  ${BLUE}[DRY-RUN]${NC} Check GET ${APIGEE_API}/developers/${DEV_EMAIL} -> POST if 404"
else
    DEV_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer ${TOKEN}" "${APIGEE_API}/developers/${DEV_EMAIL}")
    if [[ "$DEV_STATUS" == "200" ]]; then
        echo -e "  ${GREEN}✓ Developer ${DEV_EMAIL} already exists (preserved).${NC}"
    else
        CREATE_DEV_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${APIGEE_API}/developers" \
            -H "Authorization: Bearer ${TOKEN}" \
            -H "Content-Type: application/json" \
            -d "$DEV_PAYLOAD")
        if [[ "$CREATE_DEV_STATUS" == "200" || "$CREATE_DEV_STATUS" == "201" ]]; then
            echo -e "  ${GREEN}✓ Created Developer ${DEV_EMAIL}.${NC}"
        else
            echo -e "  ${RED}✗ Failed to create Developer ${DEV_EMAIL} (HTTP ${CREATE_DEV_STATUS}).${NC}" >&2
            exit 1
        fi
    fi
fi

# Step 2: Safe Upsert of API Products & Developer Apps per Persona
IFS=',' read -r -a PERSONAS_ARRAY <<< "$PERSONAS_CSV"
SUMMARY_LINES=()
FIRST_CLIENT_ID=""

for raw_p in "${PERSONAS_ARRAY[@]}"; do
    p=$(echo "$raw_p" | tr -d '[:space:]')
    [[ -z "$p" ]] && continue

    PRODUCT_NAME="${PROXY_NAME}-${p}"
    APP_NAME="${PROXY_NAME}-${p}-app"
    DISPLAY_NAME=$(get_prop "persona.${p}.display_name")
    [[ -z "$DISPLAY_NAME" ]] && DISPLAY_NAME="${PROXY_NAME} Persona: ${p}"

    MATCH_CLAIMS=$(get_prop "persona.${p}.match_claims")
    MODELS=$(get_prop "persona.${p}.models")
    QUOTA_MODE=$(get_prop "persona.${p}.quota_mode")
    QUOTA_LIMIT=$(get_prop "persona.${p}.quota_limit")
    QUOTA_LIMIT_USD=$(get_prop "persona.${p}.quota_limit_usd")
    QUOTA_INTERVAL=$(get_prop "persona.${p}.quota_interval")
    QUOTA_UNIT=$(get_prop "persona.${p}.quota_unit")
    PER_MODEL_QUOTAS=$(get_prop "persona.${p}.per_model_quotas")
    TEAM_MODE=$(get_prop "persona.${p}.team_quota_mode")
    TEAM_LIMIT=$(get_prop "persona.${p}.team_quota_limit")
    TEAM_LIMIT_USD=$(get_prop "persona.${p}.team_quota_limit_usd")
    TEAM_INTERVAL=$(get_prop "persona.${p}.team_quota_interval")
    TEAM_UNIT=$(get_prop "persona.${p}.team_quota_unit")
    BURST_RATE=$(get_prop "persona.${p}.burst_rate")
    CONCURRENCY=$(get_prop "persona.${p}.concurrency_limit")
    MA_TMPL=$(get_prop "model_armor.persona.${p}.template")
    MA_REQ=$(get_prop "model_armor.persona.${p}.request_template")
    MA_RESP=$(get_prop "model_armor.persona.${p}.response_template")

    echo -e "\n${YELLOW}Step 2.${p}: Syncing Persona '${p}' -> Product '${PRODUCT_NAME}' & App '${APP_NAME}'...${NC}"

    # Build API Product JSON with Apigee X llmOperationGroup.operationConfigs
    # expanding concrete catalog models (and aliases) so LTQ-EnforceOnly / LTQ-CountOnly
    # token or micro-USD counters track every authorized model and per-model quota accurately.
    PRODUCT_JSON=$(python3 - "$PRODUCT_NAME" "$DISPLAY_NAME" "$APIGEE_ENV" "$PROXY_NAME" "$p" \
        "$MATCH_CLAIMS" "$MODELS" "$QUOTA_MODE" "$QUOTA_LIMIT" "$QUOTA_LIMIT_USD" "$QUOTA_INTERVAL" "$QUOTA_UNIT" \
        "$PER_MODEL_QUOTAS" "$TEAM_MODE" "$TEAM_LIMIT" "$TEAM_LIMIT_USD" "$TEAM_INTERVAL" "$TEAM_UNIT" "$BURST_RATE" "$CONCURRENCY" \
        "$MA_TMPL" "$MA_REQ" "$MA_RESP" "$MODEL_PROPS" <<'PYEOF'
import fnmatch
import json
import os
import sys

(
    product_name, display_name, env_name, proxy_name, persona,
    match_claims, models, q_mode, q_limit, q_limit_usd, q_interval, q_unit,
    per_model_quotas, t_mode, t_limit, t_limit_usd, t_interval, t_unit, burst, concurrency,
    ma_tmpl, ma_req, ma_resp, model_props_path
) = sys.argv[1:25]

# 1. Parse models.catalog and alias.* from model_locations.properties
catalog_models = []
aliases_map = {}
if model_props_path and os.path.isfile(model_props_path):
    with open(model_props_path, "r", encoding="utf-8") as f:
        for raw_line in f:
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            k = k.strip()
            v = v.strip()
            if k == "models.catalog" and v:
                for m in v.split(","):
                    m_clean = m.strip()
                    if m_clean and m_clean not in catalog_models:
                        catalog_models.append(m_clean)
            elif k.startswith("alias.") and v:
                alias_name = k[len("alias."):].strip()
                if alias_name:
                    aliases_map[alias_name] = v

# 2. Parse per-model quota overrides (format: modelA:limitA,modelB:limitB)
per_model_map = {}
if per_model_quotas:
    for item in per_model_quotas.split(","):
        if ":" in item:
            mk, mv = item.split(":", 1)
            mk = mk.strip()
            mv = mv.strip()
            if mk and mv:
                per_model_map[mk] = mv

# 3. Expand persona models for RBAC (allowed_models) and build full catalog list for llmOperationGroup
# Note: llmOperationGroup.operationConfigs includes all catalog models + aliases (matching live
# ai-product-gold/silver/bronze in cymbal-ai) so that if an exception unlocks a frontier model
# for a user on a restricted persona (or circuit-breaker fallback triggers), LTQ-EnforceOnly
# and LTQ-CountOnly still have a valid token counter bucket for {model}, while JS-resolve-model-location
# and models_endpoint.js enforce the persona/exception RBAC allowlist before LTQ-EnforceOnly runs.
raw_patterns = [p.strip() for p in models.split(",") if p.strip()] if models else []
unrestricted = (not raw_patterns) or ("*" in raw_patterns)

rbac_allowed = []
def add_rbac_model(m_id):
    if m_id and m_id not in rbac_allowed:
        rbac_allowed.append(m_id)

if not unrestricted:
    for pat in raw_patterns:
        if "*" in pat or "?" in pat:
            for cm in catalog_models:
                if fnmatch.fnmatchcase(cm.lower(), pat.lower()):
                    add_rbac_model(cm)
        else:
            add_rbac_model(pat)

counter_models = []
def add_counter_model(m_id):
    if m_id and m_id not in counter_models:
        counter_models.append(m_id)

for cm in catalog_models:
    add_counter_model(cm)
for rm in rbac_allowed:
    add_counter_model(rm)
for ak in aliases_map:
    add_counter_model(ak)
for special in ("auto", "gateway/auto", "auto:judge", "gateway/judge"):
    add_counter_model(special)
for pm_key in per_model_map:
    add_counter_model(pm_key)

# Fallback if catalog was empty
if not counter_models:
    counter_models = ["gemini-3.5-flash", "gemini-3.1-flash-lite"]

eff_default_limit = str(q_limit) if q_limit else "1000000"
eff_interval = str(q_interval) if q_interval else "1"
eff_unit = str(q_unit) if q_unit else "hour"

llm_op_configs = []
for m_id in counter_models:
    target_m = aliases_map.get(m_id, m_id)
    m_limit = str(per_model_map.get(m_id) or per_model_map.get(target_m) or eff_default_limit)
    llm_op_configs.append({
        "apiSource": proxy_name,
        "llmOperations": [
            {
                "resource": "/",
                "model": m_id
            }
        ],
        "llmTokenQuota": {
            "limit": m_limit,
            "interval": eff_interval,
            "timeUnit": eff_unit
        }
    })

attrs = [{"name": "access", "value": "public"}, {"name": "persona", "value": persona}]
if match_claims:
    attrs.append({"name": "match_claims", "value": match_claims})
if models:
    # Store concrete expanded model names (or '*' if unrestricted)
    expanded_attr_models = "*" if unrestricted else ",".join(rbac_allowed)
    attrs.append({"name": "allowed_models", "value": expanded_attr_models})
if q_mode:
    attrs.append({"name": "quota_mode", "value": q_mode})
if q_limit_usd:
    attrs.append({"name": "quota_limit_usd", "value": q_limit_usd})
if per_model_quotas:
    attrs.append({"name": "per_model_quotas", "value": per_model_quotas})
if t_mode:
    attrs.append({"name": "team_quota_mode", "value": t_mode})
    attrs.append({"name": "secondary_quota_mode", "value": t_mode})
if t_limit_usd:
    attrs.append({"name": "team_quota_limit_usd", "value": t_limit_usd})
    attrs.append({"name": "secondary_quota_limit_usd", "value": t_limit_usd})
if t_limit:
    attrs.append({"name": "team_quota_limit", "value": t_limit})
    attrs.append({"name": "secondary_quota_limit", "value": t_limit})
    attrs.append({"name": "secondary_quota_scope", "value": "team"})
if t_interval:
    attrs.append({"name": "team_quota_interval", "value": t_interval})
    attrs.append({"name": "secondary_quota_interval", "value": t_interval})
if t_unit:
    attrs.append({"name": "team_quota_unit", "value": t_unit})
    attrs.append({"name": "secondary_quota_unit", "value": t_unit})
if burst:
    attrs.append({"name": "burst_rate", "value": burst})
if concurrency:
    attrs.append({"name": "concurrency_limit", "value": concurrency})
if ma_tmpl:
    attrs.append({"name": "model_armor_template", "value": ma_tmpl})
if ma_req:
    attrs.append({"name": "model_armor_request_template", "value": ma_req})
if ma_resp:
    attrs.append({"name": "model_armor_response_template", "value": ma_resp})

product = {
    "name": product_name,
    "displayName": display_name,
    "approvalType": "auto",
    "environments": [env_name],
    "llmOperationGroup": {
        "operationConfigs": llm_op_configs
    },
    "attributes": attrs
}

if q_limit:
    product["quota"] = str(q_limit)
    product["quotaInterval"] = eff_interval
    product["quotaTimeUnit"] = eff_unit
    product["quotaCounterScope"] = "PROXY"

print(json.dumps(product, indent=2))
PYEOF
)

    if $DRY_RUN; then
        echo -e "  ${BLUE}[DRY-RUN]${NC} Upsert API Product ${PRODUCT_NAME}:"
        echo "$PRODUCT_JSON" | sed 's/^/    /'
        echo -e "  ${BLUE}[DRY-RUN]${NC} Upsert Developer App ${APP_NAME} (preserving existing consumerKey if present)"
        CLIENT_ID="<dry-run-${p}-client-id>"
    else
        PROD_CHECK_FILE="$TMP_WORK_DIR/prod_check_${p}.json"
        PROD_RESP_FILE="$TMP_WORK_DIR/prod_resp_${p}.json"
        APP_RESP_FILE="$TMP_WORK_DIR/app_resp_${p}.json"

        PROD_STATUS=$(curl -s -o "$PROD_CHECK_FILE" -w "%{http_code}" \
            -H "Authorization: Bearer ${TOKEN}" "${APIGEE_API}/apiproducts/${PRODUCT_NAME}")
        if [[ "$PROD_STATUS" == "200" ]]; then
            UPD_STATUS=$(curl -s -o "$PROD_RESP_FILE" -w "%{http_code}" \
                -X PUT "${APIGEE_API}/apiproducts/${PRODUCT_NAME}" \
                -H "Authorization: Bearer ${TOKEN}" \
                -H "Content-Type: application/json" \
                -d "$PRODUCT_JSON")
            if [[ "$UPD_STATUS" == "200" ]]; then
                echo -e "  ${GREEN}✓ Updated existing API Product ${PRODUCT_NAME} in-place.${NC}"
            else
                echo -e "  ${RED}✗ Failed to update API Product ${PRODUCT_NAME} (HTTP ${UPD_STATUS}): $(cat "$PROD_RESP_FILE")${NC}" >&2
                exit 1
            fi
        else
            CRT_STATUS=$(curl -s -o "$PROD_RESP_FILE" -w "%{http_code}" \
                -X POST "${APIGEE_API}/apiproducts" \
                -H "Authorization: Bearer ${TOKEN}" \
                -H "Content-Type: application/json" \
                -d "$PRODUCT_JSON")
            if [[ "$CRT_STATUS" == "200" || "$CRT_STATUS" == "201" ]]; then
                echo -e "  ${GREEN}✓ Created new API Product ${PRODUCT_NAME}.${NC}"
            else
                echo -e "  ${RED}✗ Failed to create API Product ${PRODUCT_NAME} (HTTP ${CRT_STATUS}): $(cat "$PROD_RESP_FILE")${NC}" >&2
                exit 1
            fi
        fi

        # Safe Upsert of Developer App (preserving existing consumerKey)
        APP_STATUS=$(curl -s -o "$APP_RESP_FILE" -w "%{http_code}" \
            -H "Authorization: Bearer ${TOKEN}" "${APIGEE_API}/developers/${DEV_EMAIL}/apps/${APP_NAME}")
        if [[ "$APP_STATUS" == "200" ]]; then
            CLIENT_ID=$(python3 -c 'import json, sys; d=json.load(open(sys.argv[1])); print(d.get("credentials",[{}])[0].get("consumerKey",""))' "$APP_RESP_FILE")
            echo -e "  ${GREEN}✓ Preserved existing Developer App ${APP_NAME} (client_id: ${CLIENT_ID:0:8}...).${NC}"
            # Ensure PRODUCT_NAME is associated with the existing credential
            ASSOC_PAYLOAD=$(python3 -c 'import json, sys; print(json.dumps({"apiProducts": [sys.argv[1]]}))' "$PRODUCT_NAME")
            curl -s -o /dev/null -X POST \
                "${APIGEE_API}/developers/${DEV_EMAIL}/apps/${APP_NAME}/keys/${CLIENT_ID}" \
                -H "Authorization: Bearer ${TOKEN}" \
                -H "Content-Type: application/json" \
                -d "$ASSOC_PAYLOAD" || true
        else
            APP_CREATE_PAYLOAD=$(python3 -c 'import json, sys; print(json.dumps({"name": sys.argv[1], "apiProducts": [sys.argv[2]], "attributes": [{"name": "persona", "value": sys.argv[3]}]}))' "$APP_NAME" "$PRODUCT_NAME" "$p")
            APP_CRT_STATUS=$(curl -s -o "$APP_RESP_FILE" -w "%{http_code}" \
                -X POST "${APIGEE_API}/developers/${DEV_EMAIL}/apps" \
                -H "Authorization: Bearer ${TOKEN}" \
                -H "Content-Type: application/json" \
                -d "$APP_CREATE_PAYLOAD")
            if [[ "$APP_CRT_STATUS" == "200" || "$APP_CRT_STATUS" == "201" ]]; then
                CLIENT_ID=$(python3 -c 'import json, sys; d=json.load(open(sys.argv[1])); print(d.get("credentials",[{}])[0].get("consumerKey",""))' "$APP_RESP_FILE")
                echo -e "  ${GREEN}✓ Created Developer App ${APP_NAME} (client_id: ${CLIENT_ID:0:8}...).${NC}"
            else
                echo -e "  ${RED}✗ Failed to create Developer App ${APP_NAME} (HTTP ${APP_CRT_STATUS}): $(cat "$APP_RESP_FILE")${NC}" >&2
                exit 1
            fi
        fi
    fi

    [[ -z "$FIRST_CLIENT_ID" ]] && FIRST_CLIENT_ID="$CLIENT_ID"
    SUMMARY_LINES+=("      ${p}:|${PRODUCT_NAME}|${APP_NAME}|${CLIENT_ID}")
done

echo -e "\n${BLUE}======================================================================${NC}"
echo -e "${GREEN}✅ Persona Sync Complete — values.yaml Snippet:${NC}"
echo -e "${BLUE}======================================================================${NC}"
echo "features:"
echo "  auth:"
echo "    default_client_id: \"${FIRST_CLIENT_ID}\""
echo "    personas:"
for entry in "${SUMMARY_LINES[@]}"; do
    IFS='|' read -r p_label prod_name app_name cid <<< "$entry"
    echo "${p_label} # Product: ${prod_name} | App: ${app_name}"
    echo "        client_id: \"${cid}\""
done
echo -e "${BLUE}======================================================================${NC}"
