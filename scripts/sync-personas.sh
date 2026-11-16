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
TOKEN="${APIGEE_TOKEN:-}"
EXISTING_PRODUCTS_DIR=""
DRY_RUN=false
SHOW_KEYS=false
WRITE_SNIPPET_FILE=""

usage() {
    cat <<EOF
Usage: bash scripts/sync-personas.sh [OPTIONS]

Safely creates or updates (upserts) Apigee API Products and Developer Apps
for each audience/persona defined in values.yaml.

Options:
  --values <path>                 Path to values.yaml (default: templates/ai-gateway/values.yaml)
  --bundle <path>                 Path to already-rendered apiproxy directory (optional)
  --org <org_id>                  Apigee Organization / GCP Project ID (or set APIGEE_ORG)
  --env <env_name>                Apigee Environment name (default: qa, or set APIGEE_ENV)
  --proxy <name>                  API Proxy name override (defaults to gateway.name in values.yaml)
  --developer <email>             Developer email owning Persona Apps (default: ai-gateway-personas@<org>.iam.gserviceaccount.com)
  --token <bearer_token>          OAuth access token override (or set APIGEE_TOKEN)
  --existing-products-dir <path>  Optional directory of existing <product>.json snapshots for offline merge preview
  --show-keys                     Print unmasked client_id values even when CI=true
  --write-snippet <path>          Write unmasked values.yaml snippet to file with 0600 permissions
  --dry-run                       Preview all API Product & App upserts without calling Apigee APIs
  -h, --help                      Show this help message
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
        --token)
            TOKEN="$2"
            shift 2
            ;;
        --existing-products-dir)
            EXISTING_PRODUCTS_DIR="$2"
            shift 2
            ;;
        --show-keys)
            SHOW_KEYS=true
            shift
            ;;
        --write-snippet)
            WRITE_SNIPPET_FILE="$2"
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

umask 077
TMP_WORK_DIR="$(mktemp -d /tmp/ai-gw-persona-sync.XXXXXX)"
chmod 700 "$TMP_WORK_DIR"
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

TOKEN_FROM_GCLOUD=false
TOKEN_FETCHED_AT=0
APIGEE_TOKEN_REFRESH_SEC="${APIGEE_TOKEN_REFRESH_SEC:-2400}"

fetch_gcloud_token() {
    if [[ -n "${GCLOUD_TOKEN_CMD:-}" ]]; then
        eval "$GCLOUD_TOKEN_CMD" 2>/dev/null || true
    else
        CLOUDSDK_METRICS_ENVIRONMENT="${CLOUDSDK_METRICS_ENVIRONMENT:+$CLOUDSDK_METRICS_ENVIRONMENT }datacloud.antigravity" gcloud auth print-access-token 2>/dev/null || true
    fi
}

if ! $DRY_RUN; then
    if [[ -z "$TOKEN" ]]; then
        TOKEN=$(fetch_gcloud_token)
        TOKEN_FROM_GCLOUD=true
        TOKEN_FETCHED_AT=$SECONDS
    fi
    if [[ -z "$TOKEN" ]]; then
        echo -e "${RED}✗ Error: Unable to obtain OAuth access token. Pass --token <token>, run 'gcloud auth login', or use --dry-run.${NC}" >&2
        exit 1
    fi
fi

APIGEE_API_BASE="${APIGEE_API_BASE:-https://apigee.googleapis.com}"
APIGEE_API="${APIGEE_API_BASE%/}/v1/organizations/${APIGEE_ORG}"
APIGEE_MAX_RETRIES="${APIGEE_MAX_RETRIES:-3}"
APIGEE_RETRY_BASE_SLEEP="${APIGEE_RETRY_BASE_SLEEP:-1}"

redact_json_secrets() {
    local file="$1"
    if [[ -f "$file" && -s "$file" ]]; then
        sed -E 's/("consumerSecret"[[:space:]]*:[[:space:]]*")[^"]*"/\1***REDACTED***"/g' "$file"
    fi
}

# Retry-aware HTTP wrapper: retries transient 000/429/500/502/503/504 up to APIGEE_MAX_RETRIES times,
# and refreshes gcloud-minted tokens once on HTTP 401 if --token was not hardcoded by caller.
apigee_curl() {
    local out_file="$1"
    shift
    local clean_args=()
    while [[ $# -gt 0 ]]; do
        if [[ "$1" == "-H" && "${2:-}" == Authorization:\ Bearer\ * ]]; then
            shift 2
        else
            clean_args+=("$1")
            shift
        fi
    done

    local attempt=0
    local refreshed_401=false
    local http_code="000"
    while true; do
        : > "$out_file"
        local raw_code=""
        raw_code=$(curl -s -o "$out_file" -w "%{http_code}" -H "Authorization: Bearer ${TOKEN}" "${clean_args[@]}") || true
        http_code=$(printf '%s' "$raw_code" | tr -d '[:space:]')
        [[ -z "$http_code" ]] && http_code="000"
        if [[ "$http_code" == "401" && "$TOKEN_FROM_GCLOUD" == "true" && "$refreshed_401" == "false" ]]; then
            local fresh_tok
            fresh_tok=$(fetch_gcloud_token)
            if [[ -n "$fresh_tok" ]]; then
                TOKEN="$fresh_tok"
                refreshed_401=true
                continue
            fi
        fi
        if [[ "$http_code" != "000" && "$http_code" != "429" && "$http_code" != "500" && "$http_code" != "502" && "$http_code" != "503" && "$http_code" != "504" ]]; then
            echo "$http_code"
            return 0
        fi
        attempt=$((attempt + 1))
        if [[ $attempt -ge $APIGEE_MAX_RETRIES ]]; then
            echo "$http_code"
            return 0
        fi
        local sleep_s
        sleep_s=$(python3 -c 'import sys; print(float(sys.argv[1]) * (2 ** (int(sys.argv[2]) - 1)))' "$APIGEE_RETRY_BASE_SLEEP" "$attempt")
        sleep "$sleep_s"
    done
}

# Inspects a DeveloperApp (or DeveloperAppKey) JSON file and outputs:
#   <app_status>|<cred_action>|<consumer_key>
# where cred_action is one of:
#   approved       -> active approved+unexpired key already approved for PRODUCT_NAME
#   needs_approve  -> active approved+unexpired key has PRODUCT_NAME in revoked/pending state
#   missing        -> active approved+unexpired key exists, needs PRODUCT_NAME associated
#   mint_new       -> no active approved+unexpired credential exists (empty credentials[] or all revoked/expired)
inspect_app_credentials() {
    local json_file="$1"
    local product_name="$2"
    python3 - "$json_file" "$product_name" <<'PYCRED'
import json
import sys
import time

json_path, prod_name = sys.argv[1], sys.argv[2]
with open(json_path, "r", encoding="utf-8") as fh:
    d = json.load(fh)
if not isinstance(d, dict):
    raise SystemExit("Invalid JSON response object")

now_ms = int(time.time() * 1000)
app_status = str(d.get("status") or "approved").strip().lower()

# Support both DeveloperApp ({"credentials": [...]}) and DeveloperAppKey ({"consumerKey": "...", "apiProducts": [...]})
if "credentials" in d or "consumerKey" not in d:
    raw_creds = d.get("credentials")
    if not isinstance(raw_creds, list):
        raw_creds = []
else:
    raw_creds = [d]

def is_cred_active(c):
    if not isinstance(c, dict):
        return False
    ck = str(c.get("consumerKey") or "").strip()
    if not ck:
        return False
    st = str(c.get("status") or "approved").strip().lower()
    if st != "approved":
        return False
    exp = c.get("expiresAt")
    if exp not in (None, "", "-1", -1):
        try:
            exp_val = int(str(exp).strip())
        except ValueError:
            return False
        if exp_val != -1 and exp_val <= now_ms:
            return False
    return True

def prod_state(c):
    prods = c.get("apiProducts")
    if not isinstance(prods, list):
        return "missing"
    saw_unapproved = False
    for item in prods:
        if isinstance(item, dict) and item.get("apiproduct") == prod_name:
            pst = str(item.get("status") or "approved").strip().lower()
            if pst == "approved":
                return "approved"
            saw_unapproved = True
    return "needs_approve" if saw_unapproved else "missing"

active = []
for cred in raw_creds:
    if is_cred_active(cred):
        active.append((prod_state(cred), str(cred["consumerKey"]).strip()))

if not active:
    print(f"{app_status}|mint_new|")
    sys.exit(0)

priority = {"approved": 0, "needs_approve": 1, "missing": 2}
active.sort(key=lambda pair: priority.get(pair[0], 3))
best_action, best_key = active[0]
print(f"{app_status}|{best_action}|{best_key}")
PYCRED
}

# Step 1: Safe Upsert of Persona Owner Developer
echo -e "\n${YELLOW}Step 1: Ensuring Persona Owner Developer (${DEV_EMAIL})...${NC}"
DEV_PAYLOAD=$(python3 -c 'import json, sys; print(json.dumps({"email": sys.argv[1], "firstName": "AI-Gateway", "lastName": "Personas", "userName": "ai-gateway-personas"}))' "$DEV_EMAIL")

if $DRY_RUN; then
    echo -e "  ${BLUE}[DRY-RUN]${NC} Check GET ${APIGEE_API}/developers/${DEV_EMAIL} -> POST if 404"
else
    DEV_CHECK_FILE="$TMP_WORK_DIR/dev_check.json"
    DEV_STATUS=$(apigee_curl "$DEV_CHECK_FILE" -H "Authorization: Bearer ${TOKEN}" "${APIGEE_API}/developers/${DEV_EMAIL}")
    if [[ "$DEV_STATUS" == "200" ]]; then
        echo -e "  ${GREEN}✓ Developer ${DEV_EMAIL} already exists (preserved).${NC}"
    elif [[ "$DEV_STATUS" == "404" ]]; then
        DEV_CREATE_FILE="$TMP_WORK_DIR/dev_create.json"
        CREATE_DEV_STATUS=$(apigee_curl "$DEV_CREATE_FILE" -X POST "${APIGEE_API}/developers" \
            -H "Authorization: Bearer ${TOKEN}" \
            -H "Content-Type: application/json" \
            -d "$DEV_PAYLOAD")
        if [[ "$CREATE_DEV_STATUS" == "200" || "$CREATE_DEV_STATUS" == "201" ]]; then
            echo -e "  ${GREEN}✓ Created Developer ${DEV_EMAIL}.${NC}"
        else
            echo -e "  ${RED}✗ Failed to create Developer ${DEV_EMAIL} (HTTP ${CREATE_DEV_STATUS}): $(redact_json_secrets "$DEV_CREATE_FILE")${NC}" >&2
            exit 1
        fi
    else
        echo -e "  ${RED}✗ Failed to query Developer ${DEV_EMAIL} (HTTP ${DEV_STATUS}): $(redact_json_secrets "$DEV_CHECK_FILE")${NC}" >&2
        exit 1
    fi
fi

# Step 2: Safe Upsert of API Products & Developer Apps per Persona
IFS=',' read -r -a PERSONAS_ARRAY <<< "$PERSONAS_CSV"
SUMMARY_LINES=()
FIRST_CLIENT_ID=""

for raw_p in "${PERSONAS_ARRAY[@]}"; do
    p=$(echo "$raw_p" | tr -d '[:space:]')
    [[ -z "$p" ]] && continue

    if ! $DRY_RUN && [[ "$TOKEN_FROM_GCLOUD" == "true" ]] && (( SECONDS - TOKEN_FETCHED_AT >= APIGEE_TOKEN_REFRESH_SEC )); then
        FRESH_LOOP_TOKEN=$(fetch_gcloud_token)
        if [[ -n "$FRESH_LOOP_TOKEN" ]]; then
            TOKEN="$FRESH_LOOP_TOKEN"
            TOKEN_FETCHED_AT=$SECONDS
        fi
    fi

    PRODUCT_NAME="${PROXY_NAME}-${p}"
    APP_NAME="${PROXY_NAME}-${p}-app"
    RAW_DISPLAY_NAME=$(get_prop "persona.${p}.display_name")
    HAS_EXPLICIT_DISPLAY="false"
    if [[ -n "$RAW_DISPLAY_NAME" ]]; then
        DISPLAY_NAME="$RAW_DISPLAY_NAME"
        HAS_EXPLICIT_DISPLAY="true"
    else
        DISPLAY_NAME="${PROXY_NAME} Persona: ${p}"
    fi

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

    PROD_CHECK_FILE="$TMP_WORK_DIR/prod_check_${p}.json"
    PROD_RESP_FILE="$TMP_WORK_DIR/prod_resp_${p}.json"
    APP_RESP_FILE="$TMP_WORK_DIR/app_resp_${p}.json"
    PROD_STATUS="404"
    EXISTING_PROD_PATH=""

    if $DRY_RUN; then
        if [[ -n "$EXISTING_PRODUCTS_DIR" && -f "$EXISTING_PRODUCTS_DIR/${PRODUCT_NAME}.json" ]]; then
            EXISTING_PROD_PATH="$EXISTING_PRODUCTS_DIR/${PRODUCT_NAME}.json"
            PROD_STATUS="200"
        fi
    else
        PROD_STATUS=$(apigee_curl "$PROD_CHECK_FILE" \
            -H "Authorization: Bearer ${TOKEN}" "${APIGEE_API}/apiproducts/${PRODUCT_NAME}")
        if [[ "$PROD_STATUS" == "200" ]]; then
            if ! python3 -c 'import json, sys; d=json.load(open(sys.argv[1])); assert isinstance(d, dict) and d.get("name")' "$PROD_CHECK_FILE" 2>/dev/null; then
                echo -e "  ${RED}✗ GET API Product ${PRODUCT_NAME} returned HTTP 200 with invalid or empty JSON body.${NC}" >&2
                exit 1
            fi
            EXISTING_PROD_PATH="$PROD_CHECK_FILE"
        elif [[ "$PROD_STATUS" != "404" ]]; then
            echo -e "  ${RED}✗ Failed to query API Product ${PRODUCT_NAME} (HTTP ${PROD_STATUS}): $(redact_json_secrets "$PROD_CHECK_FILE")${NC}" >&2
            exit 1
        fi
    fi

    # Build (or non-destructively deep-merge) API Product JSON with Apigee X
    # llmOperationGroup.operationConfigs while preserving existing environments,
    # non-target proxy operations, top-level metadata, and unmanaged attributes.
    PRODUCT_JSON=$(python3 - "$PRODUCT_NAME" "$DISPLAY_NAME" "$HAS_EXPLICIT_DISPLAY" "$APIGEE_ENV" "$PROXY_NAME" "$p" \
        "$MATCH_CLAIMS" "$MODELS" "$QUOTA_MODE" "$QUOTA_LIMIT" "$QUOTA_LIMIT_USD" "$QUOTA_INTERVAL" "$QUOTA_UNIT" \
        "$PER_MODEL_QUOTAS" "$TEAM_MODE" "$TEAM_LIMIT" "$TEAM_LIMIT_USD" "$TEAM_INTERVAL" "$TEAM_UNIT" "$BURST_RATE" "$CONCURRENCY" \
        "$MA_TMPL" "$MA_REQ" "$MA_RESP" "$MODEL_PROPS" "$EXISTING_PROD_PATH" <<'PYEOF'
import copy
import fnmatch
import json
import os
import sys

(
    product_name, display_name, has_explicit_display, env_name, proxy_name, persona,
    match_claims, models, q_mode, q_limit, q_limit_usd, q_interval, q_unit,
    per_model_quotas, t_mode, t_limit, t_limit_usd, t_interval, t_unit, burst, concurrency,
    ma_tmpl, ma_req, ma_resp, model_props_path, existing_prod_path
) = sys.argv[1:27]

existing_product = None
if existing_prod_path and os.path.isfile(existing_prod_path):
    with open(existing_prod_path, "r", encoding="utf-8") as ef:
        loaded = json.load(ef)
        if isinstance(loaded, dict) and loaded.get("name"):
            existing_product = loaded

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
                alias_name = k[len("alias."):].strip().replace("\\:", ":")
                if alias_name:
                    aliases_map[alias_name] = v

# 2. Parse per-model quota overrides (format: modelA:limitA,modelB:limitB)
per_model_map = {}
if per_model_quotas:
    for item in per_model_quotas.split(","):
        if ":" in item:
            mk, mv = item.rsplit(":", 1)
            mk = mk.strip()
            mv = mv.strip()
            if mk and mv:
                per_model_map[mk] = mv

# 3. Expand persona models for RBAC (allowed_models) and build full catalog list for llmOperationGroup
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
for special in ("auto", "gateway/auto", "auto:judge", "gateway/judge", "shared_wallet"):
    add_counter_model(special)
for pm_key in per_model_map:
    add_counter_model(pm_key)

# Fallback if catalog was empty
if not counter_models:
    counter_models = ["gemini-3.5-flash", "gemini-3.1-flash-lite"]

eff_default_limit = str(q_limit) if q_limit != "" else "1000000"
eff_interval = str(q_interval) if q_interval else "1"
eff_unit = str(q_unit) if q_unit else "hour"

llm_op_configs = []
for m_id in counter_models:
    target_m = aliases_map.get(m_id, m_id)
    if m_id in per_model_map:
        raw_m_limit = str(per_model_map[m_id])
    elif target_m in per_model_map:
        raw_m_limit = str(per_model_map[target_m])
    else:
        raw_m_limit = eff_default_limit
    api_m_limit = "1" if raw_m_limit.strip() in ("0", "0.0", "0.00") else raw_m_limit
    llm_op_configs.append({
        "apiSource": proxy_name,
        "llmOperations": [
            {
                "resource": "/",
                "model": m_id
            }
        ],
        "llmTokenQuota": {
            "limit": api_m_limit,
            "interval": eff_interval,
            "timeUnit": eff_unit
        }
    })

MANAGED_ATTR_KEYS = {
    "persona",
    "match_claims",
    "allowed_models",
    "quota_mode",
    "quota_limit_usd",
    "per_model_quotas",
    "team_quota_mode",
    "secondary_quota_mode",
    "team_quota_limit_usd",
    "secondary_quota_limit_usd",
    "team_quota_limit",
    "secondary_quota_limit",
    "secondary_quota_scope",
    "team_quota_interval",
    "secondary_quota_interval",
    "team_quota_unit",
    "secondary_quota_unit",
    "burst_rate",
    "concurrency_limit",
    "model_armor_template",
    "model_armor_request_template",
    "model_armor_response_template",
}

managed_attrs = [{"name": "persona", "value": persona}]
if match_claims:
    managed_attrs.append({"name": "match_claims", "value": match_claims})
if models:
    expanded_attr_models = "*" if unrestricted else ",".join(rbac_allowed)
    managed_attrs.append({"name": "allowed_models", "value": expanded_attr_models})
if q_mode:
    managed_attrs.append({"name": "quota_mode", "value": q_mode})
if q_limit_usd:
    managed_attrs.append({"name": "quota_limit_usd", "value": q_limit_usd})
if per_model_quotas:
    managed_attrs.append({"name": "per_model_quotas", "value": per_model_quotas})
if t_mode:
    managed_attrs.append({"name": "team_quota_mode", "value": t_mode})
    managed_attrs.append({"name": "secondary_quota_mode", "value": t_mode})
if t_limit_usd:
    managed_attrs.append({"name": "team_quota_limit_usd", "value": t_limit_usd})
    managed_attrs.append({"name": "secondary_quota_limit_usd", "value": t_limit_usd})
if t_limit:
    managed_attrs.append({"name": "team_quota_limit", "value": t_limit})
    managed_attrs.append({"name": "secondary_quota_limit", "value": t_limit})
    managed_attrs.append({"name": "secondary_quota_scope", "value": "team"})
if t_interval:
    managed_attrs.append({"name": "team_quota_interval", "value": t_interval})
    managed_attrs.append({"name": "secondary_quota_interval", "value": t_interval})
if t_unit:
    managed_attrs.append({"name": "team_quota_unit", "value": t_unit})
    managed_attrs.append({"name": "secondary_quota_unit", "value": t_unit})
if burst:
    managed_attrs.append({"name": "burst_rate", "value": burst})
if concurrency:
    managed_attrs.append({"name": "concurrency_limit", "value": concurrency})
if ma_tmpl:
    managed_attrs.append({"name": "model_armor_template", "value": ma_tmpl})
if ma_req:
    managed_attrs.append({"name": "model_armor_request_template", "value": ma_req})
if ma_resp:
    managed_attrs.append({"name": "model_armor_response_template", "value": ma_resp})

if existing_product:
    product = copy.deepcopy(existing_product)
    # Strip read-only Apigee server timestamps and legacy proxy/resource arrays
    # (Apigee X rejects PUT payloads combining legacy proxies/apiResources with operationGroup/llmOperationGroup)
    product.pop("createdAt", None)
    product.pop("lastModifiedAt", None)
    product.pop("proxies", None)
    product.pop("apiResources", None)

    product["name"] = product_name
    if has_explicit_display == "true" or not product.get("displayName"):
        product["displayName"] = display_name
    if not product.get("approvalType"):
        product["approvalType"] = "auto"

    # Union environments (preserving existing environment promotions)
    merged_envs = []
    for e in product.get("environments", []) or []:
        if isinstance(e, str) and e.strip() and e.strip() not in merged_envs:
            merged_envs.append(e.strip())
    if env_name and env_name.strip() and env_name.strip() not in merged_envs:
        merged_envs.append(env_name.strip())
    product["environments"] = merged_envs

    # Preserve llmOperationGroup configs belonging to other proxies (apiSource != proxy_name)
    existing_llm_group = product.get("llmOperationGroup")
    if not isinstance(existing_llm_group, dict):
        existing_llm_group = {}
    else:
        existing_llm_group = copy.deepcopy(existing_llm_group)
    preserved_llm_ops = [
        cfg for cfg in (existing_llm_group.get("operationConfigs") or [])
        if isinstance(cfg, dict) and cfg.get("apiSource") != proxy_name
    ]
    existing_llm_group["operationConfigs"] = preserved_llm_ops + llm_op_configs
    product["llmOperationGroup"] = existing_llm_group

    # Merge attributes: preserve existing access (or default to public) + all unmanaged custom attributes
    existing_attrs = product.get("attributes") or []
    existing_access = None
    unmanaged_attrs = []
    for attr in existing_attrs:
        if not isinstance(attr, dict) or not attr.get("name"):
            continue
        a_name = attr["name"]
        if a_name == "access":
            existing_access = attr
        elif a_name not in MANAGED_ATTR_KEYS:
            unmanaged_attrs.append(attr)

    access_attr = existing_access if existing_access is not None else {"name": "access", "value": "public"}
    product["attributes"] = [access_attr] + unmanaged_attrs + managed_attrs

    if q_limit != "":
        product["quota"] = "1" if str(q_limit).strip() in ("0", "0.0", "0.00") else str(q_limit)
        product["quotaInterval"] = eff_interval
        product["quotaTimeUnit"] = eff_unit
        product["quotaCounterScope"] = "PROXY"
else:
    attrs = [{"name": "access", "value": "public"}] + managed_attrs
    product = {
        "name": product_name,
        "displayName": display_name,
        "approvalType": "auto",
        "environments": [env_name] if env_name else [],
        "llmOperationGroup": {
            "operationConfigs": llm_op_configs
        },
        "attributes": attrs
    }
    if q_limit != "":
        product["quota"] = "1" if str(q_limit).strip() in ("0", "0.0", "0.00") else str(q_limit)
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
        if [[ "$PROD_STATUS" == "200" ]]; then
            UPD_STATUS=$(apigee_curl "$PROD_RESP_FILE" \
                -X PUT "${APIGEE_API}/apiproducts/${PRODUCT_NAME}" \
                -H "Authorization: Bearer ${TOKEN}" \
                -H "Content-Type: application/json" \
                -d "$PRODUCT_JSON")
            if [[ "$UPD_STATUS" == "200" ]]; then
                echo -e "  ${GREEN}✓ Merged & updated existing API Product ${PRODUCT_NAME} in-place (preserved environments, custom attributes & external operations).${NC}"
            else
                echo -e "  ${RED}✗ Failed to update API Product ${PRODUCT_NAME} (HTTP ${UPD_STATUS}): $(redact_json_secrets "$PROD_RESP_FILE")${NC}" >&2
                exit 1
            fi
        else
            CRT_STATUS=$(apigee_curl "$PROD_RESP_FILE" \
                -X POST "${APIGEE_API}/apiproducts" \
                -H "Authorization: Bearer ${TOKEN}" \
                -H "Content-Type: application/json" \
                -d "$PRODUCT_JSON")
            if [[ "$CRT_STATUS" == "200" || "$CRT_STATUS" == "201" ]]; then
                echo -e "  ${GREEN}✓ Created new API Product ${PRODUCT_NAME}.${NC}"
            else
                echo -e "  ${RED}✗ Failed to create API Product ${PRODUCT_NAME} (HTTP ${CRT_STATUS}): $(redact_json_secrets "$PROD_RESP_FILE")${NC}" >&2
                exit 1
            fi
        fi

        # Safe Upsert of Developer App (preserving active approved consumerKey & product bindings)
        APP_STATUS=$(apigee_curl "$APP_RESP_FILE" \
            -H "Authorization: Bearer ${TOKEN}" "${APIGEE_API}/developers/${DEV_EMAIL}/apps/${APP_NAME}")
        if [[ "$APP_STATUS" == "200" ]]; then
            IFS='|' read -r APP_APPROVAL CRED_ACTION CLIENT_ID <<< "$(inspect_app_credentials "$APP_RESP_FILE" "$PRODUCT_NAME")"
            if [[ "$APP_APPROVAL" != "approved" ]]; then
                APP_APPROVE_FILE="$TMP_WORK_DIR/app_approve_${p}.json"
                APP_APPROVE_STATUS=$(apigee_curl "$APP_APPROVE_FILE" \
                    -X POST "${APIGEE_API}/developers/${DEV_EMAIL}/apps/${APP_NAME}?action=approve" \
                    -H "Authorization: Bearer ${TOKEN}" \
                    -H "Content-Type: application/octet-stream")
                if [[ "$APP_APPROVE_STATUS" != "200" && "$APP_APPROVE_STATUS" != "204" ]]; then
                    echo -e "  ${RED}✗ Failed to approve Developer App ${APP_NAME} (HTTP ${APP_APPROVE_STATUS}): $(redact_json_secrets "$APP_APPROVE_FILE")${NC}" >&2
                    exit 1
                fi
            fi

            if [[ "$CRED_ACTION" == "mint_new" ]]; then
                MINT_PAYLOAD=$(python3 -c 'import json, sys; print(json.dumps({"name": sys.argv[1], "apiProducts": [sys.argv[2]]}))' "$APP_NAME" "$PRODUCT_NAME")
                APP_MINT_FILE="$TMP_WORK_DIR/app_mint_${p}.json"
                MINT_STATUS=$(apigee_curl "$APP_MINT_FILE" \
                    -X POST "${APIGEE_API}/developers/${DEV_EMAIL}/apps/${APP_NAME}" \
                    -H "Authorization: Bearer ${TOKEN}" \
                    -H "Content-Type: application/json" \
                    -d "$MINT_PAYLOAD")
                if [[ "$MINT_STATUS" != "200" && "$MINT_STATUS" != "201" ]]; then
                    echo -e "  ${RED}✗ Failed to mint active credential for Developer App ${APP_NAME} (HTTP ${MINT_STATUS}): $(redact_json_secrets "$APP_MINT_FILE")${NC}" >&2
                    exit 1
                fi
                IFS='|' read -r _ CRED_ACTION CLIENT_ID <<< "$(inspect_app_credentials "$APP_MINT_FILE" "$PRODUCT_NAME")"
                if [[ -z "$CLIENT_ID" ]]; then
                    echo -e "  ${RED}✗ Developer App ${APP_NAME} returned no active approved consumerKey after credential creation.${NC}" >&2
                    exit 1
                fi
                echo -e "  ${GREEN}✓ Minted new active credential for existing Developer App ${APP_NAME} (client_id: ${CLIENT_ID:0:8}...).${NC}"
            else
                echo -e "  ${GREEN}✓ Preserved existing Developer App ${APP_NAME} (client_id: ${CLIENT_ID:0:8}...).${NC}"
            fi

            if [[ "$CRED_ACTION" == "missing" ]]; then
                ASSOC_PAYLOAD=$(python3 -c 'import json, sys; print(json.dumps({"apiProducts": [sys.argv[1]]}))' "$PRODUCT_NAME")
                KEY_ASSOC_FILE="$TMP_WORK_DIR/key_assoc_${p}.json"
                KEY_ASSOC_STATUS=$(apigee_curl "$KEY_ASSOC_FILE" \
                    -X POST "${APIGEE_API}/developers/${DEV_EMAIL}/apps/${APP_NAME}/keys/${CLIENT_ID}" \
                    -H "Authorization: Bearer ${TOKEN}" \
                    -H "Content-Type: application/json" \
                    -d "$ASSOC_PAYLOAD")
                if [[ "$KEY_ASSOC_STATUS" != "200" && "$KEY_ASSOC_STATUS" != "201" ]]; then
                    echo -e "  ${RED}✗ Failed to bind API Product ${PRODUCT_NAME} to key ${CLIENT_ID:0:8}... on App ${APP_NAME} (HTTP ${KEY_ASSOC_STATUS}): $(redact_json_secrets "$KEY_ASSOC_FILE")${NC}" >&2
                    exit 1
                fi
                if [[ -s "$KEY_ASSOC_FILE" ]]; then
                    IFS='|' read -r _ POST_ASSOC_ACTION _ <<< "$(inspect_app_credentials "$KEY_ASSOC_FILE" "$PRODUCT_NAME" 2>/dev/null || echo "approved|approved|")"
                    if [[ "$POST_ASSOC_ACTION" == "needs_approve" ]]; then
                        CRED_ACTION="needs_approve"
                    fi
                fi
            fi

            if [[ "$CRED_ACTION" == "needs_approve" ]]; then
                KEY_APPROVE_FILE="$TMP_WORK_DIR/key_approve_${p}.json"
                KEY_APPROVE_STATUS=$(apigee_curl "$KEY_APPROVE_FILE" \
                    -X POST "${APIGEE_API}/developers/${DEV_EMAIL}/apps/${APP_NAME}/keys/${CLIENT_ID}/apiproducts/${PRODUCT_NAME}?action=approve" \
                    -H "Authorization: Bearer ${TOKEN}" \
                    -H "Content-Type: application/octet-stream")
                if [[ "$KEY_APPROVE_STATUS" != "200" && "$KEY_APPROVE_STATUS" != "204" ]]; then
                    echo -e "  ${RED}✗ Failed to approve API Product ${PRODUCT_NAME} on key ${CLIENT_ID:0:8}... for App ${APP_NAME} (HTTP ${KEY_APPROVE_STATUS}): $(redact_json_secrets "$KEY_APPROVE_FILE")${NC}" >&2
                    exit 1
                fi
                echo -e "  ${GREEN}✓ Approved API Product ${PRODUCT_NAME} binding on key ${CLIENT_ID:0:8}...${NC}"
            fi
        elif [[ "$APP_STATUS" == "404" ]]; then
            APP_CREATE_PAYLOAD=$(python3 -c 'import json, sys; print(json.dumps({"name": sys.argv[1], "apiProducts": [sys.argv[2]], "attributes": [{"name": "persona", "value": sys.argv[3]}]}))' "$APP_NAME" "$PRODUCT_NAME" "$p")
            APP_CRT_STATUS=$(apigee_curl "$APP_RESP_FILE" \
                -X POST "${APIGEE_API}/developers/${DEV_EMAIL}/apps" \
                -H "Authorization: Bearer ${TOKEN}" \
                -H "Content-Type: application/json" \
                -d "$APP_CREATE_PAYLOAD")
            if [[ "$APP_CRT_STATUS" == "200" || "$APP_CRT_STATUS" == "201" ]]; then
                IFS='|' read -r _ CRED_ACTION CLIENT_ID <<< "$(inspect_app_credentials "$APP_RESP_FILE" "$PRODUCT_NAME")"
                if [[ -z "$CLIENT_ID" ]]; then
                    echo -e "  ${RED}✗ Created Developer App ${APP_NAME}, but response contained no active approved consumerKey.${NC}" >&2
                    exit 1
                fi
                if [[ "$CRED_ACTION" == "needs_approve" ]]; then
                    KEY_APPROVE_FILE="$TMP_WORK_DIR/key_approve_${p}.json"
                    KEY_APPROVE_STATUS=$(apigee_curl "$KEY_APPROVE_FILE" \
                        -X POST "${APIGEE_API}/developers/${DEV_EMAIL}/apps/${APP_NAME}/keys/${CLIENT_ID}/apiproducts/${PRODUCT_NAME}?action=approve" \
                        -H "Authorization: Bearer ${TOKEN}" \
                        -H "Content-Type: application/octet-stream")
                    if [[ "$KEY_APPROVE_STATUS" != "200" && "$KEY_APPROVE_STATUS" != "204" ]]; then
                        echo -e "  ${RED}✗ Failed to approve API Product ${PRODUCT_NAME} on newly created App ${APP_NAME} (HTTP ${KEY_APPROVE_STATUS}): $(redact_json_secrets "$KEY_APPROVE_FILE")${NC}" >&2
                        exit 1
                    fi
                fi
                echo -e "  ${GREEN}✓ Created Developer App ${APP_NAME} (client_id: ${CLIENT_ID:0:8}...).${NC}"
            else
                echo -e "  ${RED}✗ Failed to create Developer App ${APP_NAME} (HTTP ${APP_CRT_STATUS}): $(redact_json_secrets "$APP_RESP_FILE")${NC}" >&2
                exit 1
            fi
        else
            echo -e "  ${RED}✗ Failed to query Developer App ${APP_NAME} (HTTP ${APP_STATUS}): $(redact_json_secrets "$APP_RESP_FILE")${NC}" >&2
            exit 1
        fi
    fi

    [[ -z "$FIRST_CLIENT_ID" ]] && FIRST_CLIENT_ID="$CLIENT_ID"
    SUMMARY_LINES+=("      ${p}:|${PRODUCT_NAME}|${APP_NAME}|${CLIENT_ID}")
done

mask_if_ci() {
    local raw_key="$1"
    if [[ "${CI:-}" == "true" && "$SHOW_KEYS" != "true" && "$DRY_RUN" != "true" ]]; then
        if [[ ${#raw_key} -gt 8 ]]; then
            printf '%s...<masked-in-ci>' "${raw_key:0:8}"
        else
            printf '<masked-in-ci>'
        fi
    else
        printf '%s' "$raw_key"
    fi
}

if [[ -n "$WRITE_SNIPPET_FILE" ]]; then
    {
        echo "features:"
        echo "  auth:"
        echo "    default_client_id: \"${FIRST_CLIENT_ID}\""
        echo "    personas:"
        for entry in "${SUMMARY_LINES[@]}"; do
            IFS='|' read -r p_label prod_name app_name cid <<< "$entry"
            echo "${p_label} # Product: ${prod_name} | App: ${app_name}"
            echo "        client_id: \"${cid}\""
        done
    } > "$WRITE_SNIPPET_FILE"
    chmod 600 "$WRITE_SNIPPET_FILE"
fi

echo -e "\n${BLUE}======================================================================${NC}"
echo -e "${GREEN}✅ Persona Sync Complete — values.yaml Snippet:${NC}"
if [[ "${CI:-}" == "true" && "$SHOW_KEYS" != "true" && "$DRY_RUN" != "true" ]]; then
    echo -e "${YELLOW}ℹ CI=true detected: masking client_id in stdout (pass --show-keys or --write-snippet <path> for full values).${NC}"
fi
echo -e "${BLUE}======================================================================${NC}"
echo "features:"
echo "  auth:"
echo "    default_client_id: \"$(mask_if_ci "$FIRST_CLIENT_ID")\""
echo "    personas:"
for entry in "${SUMMARY_LINES[@]}"; do
    IFS='|' read -r p_label prod_name app_name cid <<< "$entry"
    echo "${p_label} # Product: ${prod_name} | App: ${app_name}"
    echo "        client_id: \"$(mask_if_ci "$cid")\""
done
echo -e "${BLUE}======================================================================${NC}"
