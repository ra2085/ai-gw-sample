#!/bin/bash
# Copyright 2027 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# ==============================================================================
# Apigee AI Gateway - Live Quickstart Template Deployment & Integration Test
# Deploys minimal quickstart template to Apigee QA and verifies live HTTP traffic
# ==============================================================================

set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

export PATH="$PATH:$HOME/.apigeecli/bin:/opt/homebrew/bin:/usr/local/bin:$HOME/go/bin"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

SKIP_DEPLOY=false
CUSTOM_ENV_FILE=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --skip-deploy)
            SKIP_DEPLOY=true
            shift
            ;;
        --env)
            if [ -z "${2:-}" ]; then
                echo -e "${RED}✗ Error: --env requires a file path argument.${NC}"
                exit 1
            fi
            CUSTOM_ENV_FILE="$2"
            shift 2
            ;;
        --env=*)
            CUSTOM_ENV_FILE="${1#--env=}"
            shift
            ;;
        *)
            shift
            ;;
    esac
done

# Source env file without clobbering explicit caller overrides
_CALLER_PROJECT_ID="${PROJECT_ID:-}"
_CALLER_APIGEE_ENV="${APIGEE_ENV:-}"
_CALLER_SERVICE_ACCOUNT="${SERVICE_ACCOUNT:-}"
_CALLER_PROXY_NAME="${PROXY_NAME:-}"
_CALLER_APIGEE_HOST="${APIGEE_HOST:-}"
_CALLER_API_KEY="${API_KEY:-}"
if [ -n "$CUSTOM_ENV_FILE" ]; then
    if [ ! -f "$CUSTOM_ENV_FILE" ] && [ -f "$REPO_ROOT/$CUSTOM_ENV_FILE" ]; then
        CUSTOM_ENV_FILE="$REPO_ROOT/$CUSTOM_ENV_FILE"
    fi
    if [ ! -f "$CUSTOM_ENV_FILE" ]; then
        echo -e "${RED}✗ Error: Environment file not found: $CUSTOM_ENV_FILE${NC}"
        exit 1
    fi
    # shellcheck disable=SC1090
    source "$CUSTOM_ENV_FILE"
    [ -n "$_CALLER_PROJECT_ID" ] && PROJECT_ID="$_CALLER_PROJECT_ID"
    [ -n "$_CALLER_APIGEE_ENV" ] && APIGEE_ENV="$_CALLER_APIGEE_ENV"
    [ -n "$_CALLER_SERVICE_ACCOUNT" ] && SERVICE_ACCOUNT="$_CALLER_SERVICE_ACCOUNT"
    [ -n "$_CALLER_PROXY_NAME" ] && PROXY_NAME="$_CALLER_PROXY_NAME"
    [ -n "$_CALLER_APIGEE_HOST" ] && APIGEE_HOST="$_CALLER_APIGEE_HOST"
    [ -n "$_CALLER_API_KEY" ] && API_KEY="$_CALLER_API_KEY"
fi

APIGEE_ENV="${APIGEE_ENV:-qa}"
PROXY_NAME="${PROXY_NAME:-ai-gateway}"
if [ -z "${PROJECT_ID:-}" ] || [ -z "${APIGEE_HOST:-}" ] || [ -z "${API_KEY:-}" ]; then
    echo -e "${RED}✗ Error: PROJECT_ID, APIGEE_HOST, and API_KEY are required for live quickstart tests.${NC}"
    echo -e "  Pass ${YELLOW}--env tests/env/<your-env>.env${NC} (see ${CYAN}tests/env/example.env${NC})."
    exit 1
fi
SERVICE_ACCOUNT="${SERVICE_ACCOUNT:-ai-gateway-runtime@${PROJECT_ID}.iam.gserviceaccount.com}"
TEMPLATE_FILE="$REPO_ROOT/templates/ai-gateway/apiproxy.yaml"

echo -e "${BOLD}${CYAN}======================================================================${NC}"
echo -e "${BOLD}${CYAN}   🚀 Quickstart Template Live Deployment & Integration Test          ${NC}"
echo -e "${BOLD}${CYAN}======================================================================${NC}"
echo -e "${YELLOW}Target Project:${NC}        ${BOLD}${PROJECT_ID}${NC}"
echo -e "${YELLOW}Target Environment:${NC}    ${BOLD}${APIGEE_ENV}${NC}"
echo -e "${YELLOW}Apigee Host:${NC}           ${BOLD}${APIGEE_HOST}${NC}"
echo -e "----------------------------------------------------------------------"

# 1. Check CLI Tools
if command -v apigeecli &>/dev/null; then
    APIGEECLI="apigeecli"
elif [ -f "$HOME/.apigeecli/bin/apigeecli" ]; then
    APIGEECLI="$HOME/.apigeecli/bin/apigeecli"
elif [ -f "/opt/homebrew/bin/apigeecli" ]; then
    APIGEECLI="/opt/homebrew/bin/apigeecli"
elif [ -f "/usr/local/bin/apigeecli" ]; then
    APIGEECLI="/usr/local/bin/apigeecli"
else
    echo -e "${RED}✗ Error: apigeecli not found.${NC}"
    exit 1
fi

if command -v apigee-go-gen &>/dev/null; then
    APIGEE_GEN="apigee-go-gen"
elif [ -f "/usr/local/bin/apigee-go-gen" ]; then
    APIGEE_GEN="/usr/local/bin/apigee-go-gen"
elif [ -f "$REPO_ROOT/bin/apigee-go-gen" ]; then
    APIGEE_GEN="$REPO_ROOT/bin/apigee-go-gen"
else
    echo -e "${RED}✗ Error: apigee-go-gen not found.${NC}"
    exit 1
fi

# 2. Render Bundle from templates/ai-gateway/values.quickstart.yaml
echo -e "\n${BLUE}Step 1: Compiling Quickstart Proxy Bundle (from values.quickstart.yaml)...${NC}"
TMP_DIR="/tmp/ai-gw-quickstart-live-$(date +%s)"
BUNDLE_ZIP="$TMP_DIR/${PROXY_NAME}.zip"
LIVE_VALUES="$TMP_DIR/values.quickstart.yaml"
mkdir -p "$TMP_DIR"

QUICKSTART_GEMINI_MODEL="${QUICKSTART_GEMINI_MODEL:-gemini-4-hydrogen}"
QUICKSTART_CLAUDE_MODEL="${QUICKSTART_CLAUDE_MODEL:-claude-haiku-5-5}"

sed \
    -e "s|project_id: \"your-gcp-project-id\"|project_id: \"${PROJECT_ID}\"|g" \
    -e "s|name: \"ai-gateway\"|name: \"${PROXY_NAME}\"|g" \
    -e "s|gemini-4-hydrogen|${QUICKSTART_GEMINI_MODEL}|g" \
    -e "s|claude-haiku-5-5|${QUICKSTART_CLAUDE_MODEL}|g" \
    -e "s|https://vllm.internal.corp/v1/chat/completions|https://${APIGEE_HOST}/mock/v1/chat/completions|g" \
    "$REPO_ROOT/templates/ai-gateway/values.quickstart.yaml" > "$LIVE_VALUES"

$APIGEE_GEN render apiproxy \
    --template "$TEMPLATE_FILE" \
    --values "$LIVE_VALUES" \
    --output "$BUNDLE_ZIP" \
    --validate=true

echo -e "${GREEN}✓ Quickstart Bundle compiled successfully: $BUNDLE_ZIP${NC}"

# 3. Deploy to Apigee
if [ "$SKIP_DEPLOY" = true ]; then
    echo -e "\n${YELLOW}Step 2: Skipping deployment (--skip-deploy specified).${NC}"
else
    echo -e "\n${BLUE}Step 2: Ensuring Apigee Data Collectors & Deploying to Apigee Org '$PROJECT_ID' ($APIGEE_ENV)...${NC}"
    GCLOUD_TOKEN=$(gcloud auth print-access-token 2>/dev/null || true)
    if [ -n "$GCLOUD_TOKEN" ]; then
        AUTH_FLAGS=(-t "$GCLOUD_TOKEN")
    else
        AUTH_FLAGS=(--default-token)
    fi

    for dc in \
        "dc_prompt_token_count:INTEGER" \
        "dc_uncached_prompt_token_count:INTEGER" \
        "dc_cache_read_token_count:INTEGER" \
        "dc_cache_write_token_count:INTEGER" \
        "dc_thinking_token_count:INTEGER" \
        "dc_completion_token_count:INTEGER" \
        "dc_total_token_count:INTEGER" \
        "dc_model:STRING" \
        "dc_requested_model:STRING" \
        "dc_tx_uncached_prompt_cost_usd:FLOAT" \
        "dc_tx_cache_read_cost_usd:FLOAT" \
        "dc_tx_cache_write_cost_usd:FLOAT" \
        "dc_tx_prompt_cost_usd:FLOAT" \
        "dc_tx_completion_cost_usd:FLOAT" \
        "dc_tx_cost_usd:FLOAT" \
        "dc_identity_user_id:STRING" \
        "dc_identity_persona:STRING" \
        "dc_identity_team:STRING"; do
        IFS=":" read -r dc_name dc_type <<< "$dc"
        $APIGEECLI datacollectors create -n "$dc_name" -p "$dc_type" -d "AI Gateway Telemetry ($dc_name)" --org "$PROJECT_ID" "${AUTH_FLAGS[@]}" >/dev/null 2>&1 || true
    done

    $APIGEECLI apis create bundle \
        --name "$PROXY_NAME" \
        --proxy-zip "$BUNDLE_ZIP" \
        --org "$PROJECT_ID" \
        --env "$APIGEE_ENV" \
        -s "$SERVICE_ACCOUNT" \
        --ovr \
        --wait \
        "${AUTH_FLAGS[@]}"

    echo -e "${GREEN}✓ Deployed successfully! Waiting 6 seconds for runtime propagation...${NC}"
    sleep 6
fi

# 4. Live API Tests
echo -e "\n${BLUE}Step 3: Running Live API Calls against Deployed Quickstart Gateway...${NC}"
PASSED=0
TOTAL=6

# --- Test 1: Claude SDK -> Gemini 4 Hydrogen ---
echo -e "\n${YELLOW}[Test 1/6] Claude Ingress (/v1/messages) -> ${QUICKSTART_GEMINI_MODEL} (Transcoded)${NC}"
RESP1=$(curl -s -w "\n%{http_code}" -X POST "https://${APIGEE_HOST}/v1/messages" \
    -H "x-apikey: ${API_KEY}" \
    -H "Content-Type: application/json" \
    -d "{
        \"model\": \"${QUICKSTART_GEMINI_MODEL}\",
        \"max_tokens\": 50,
        \"messages\": [{\"role\": \"user\", \"content\": \"Respond with exactly: Quickstart Gemini Works\"}]
    }")
CODE1=$(echo "$RESP1" | tail -n 1)
BODY1=$(echo "$RESP1" | sed '$d')
echo "HTTP Status: $CODE1"
echo "Response: $BODY1"
if [ "$CODE1" -eq 200 ] && echo "$BODY1" | grep -qi "Quickstart Gemini Works"; then
    echo -e "${GREEN}✓ PASSED${NC}"
    PASSED=$((PASSED+1))
else
    echo -e "${RED}✗ FAILED${NC}"
fi

# --- Test 2: OpenAI Ingress -> Gemini 4 Hydrogen ---
echo -e "\n${YELLOW}[Test 2/6] OpenAI Ingress (/v1/chat/completions) -> ${QUICKSTART_GEMINI_MODEL} (Transcoded)${NC}"
RESP2=$(curl -s -w "\n%{http_code}" -X POST "https://${APIGEE_HOST}/v1/chat/completions" \
    -H "x-apikey: ${API_KEY}" \
    -H "Content-Type: application/json" \
    -d "{
        \"model\": \"${QUICKSTART_GEMINI_MODEL}\",
        \"messages\": [{\"role\": \"user\", \"content\": \"Respond with exactly: Quickstart OpenAI to Gemini Works\"}]
    }")
CODE2=$(echo "$RESP2" | tail -n 1)
BODY2=$(echo "$RESP2" | sed '$d')
echo "HTTP Status: $CODE2"
echo "Response: $BODY2"
if [ "$CODE2" -eq 200 ] && echo "$BODY2" | grep -qi "Quickstart OpenAI to Gemini Works"; then
    echo -e "${GREEN}✓ PASSED${NC}"
    PASSED=$((PASSED+1))
else
    echo -e "${RED}✗ FAILED${NC}"
fi

# --- Test 3: Claude Ingress -> Claude Haiku 5.5 (Native) ---
echo -e "\n${YELLOW}[Test 3/6] Claude Ingress (/v1/messages) -> ${QUICKSTART_CLAUDE_MODEL} (Native Passthrough)${NC}"
RESP3=$(curl -s -w "\n%{http_code}" -X POST "https://${APIGEE_HOST}/v1/messages" \
    -H "x-apikey: ${API_KEY}" \
    -H "Content-Type: application/json" \
    -d "{
        \"model\": \"${QUICKSTART_CLAUDE_MODEL}\",
        \"max_tokens\": 50,
        \"messages\": [{\"role\": \"user\", \"content\": \"Respond with exactly: Quickstart Claude Haiku Works\"}]
    }")
CODE3=$(echo "$RESP3" | tail -n 1)
BODY3=$(echo "$RESP3" | sed '$d')
echo "HTTP Status: $CODE3"
echo "Response: $BODY3"
if [ "$CODE3" -eq 200 ] && echo "$BODY3" | grep -qi "Quickstart Claude Haiku Works"; then
    echo -e "${GREEN}✓ PASSED${NC}"
    PASSED=$((PASSED+1))
else
    echo -e "${RED}✗ FAILED${NC}"
fi

# --- Test 4: OpenAI Ingress -> Claude Haiku 5.5 (Transcoded) ---
echo -e "\n${YELLOW}[Test 4/6] OpenAI Ingress (/v1/chat/completions) -> ${QUICKSTART_CLAUDE_MODEL} (OpenAI to Claude Transcoded)${NC}"
RESP4=$(curl -s -w "\n%{http_code}" -X POST "https://${APIGEE_HOST}/v1/chat/completions" \
    -H "x-apikey: ${API_KEY}" \
    -H "Content-Type: application/json" \
    -d "{
        \"model\": \"${QUICKSTART_CLAUDE_MODEL}\",
        \"max_tokens\": 50,
        \"messages\": [{\"role\": \"user\", \"content\": \"Respond with exactly: Quickstart OpenAI to Claude Works\"}]
    }")
CODE4=$(echo "$RESP4" | tail -n 1)
BODY4=$(echo "$RESP4" | sed '$d')
echo "HTTP Status: $CODE4"
echo "Response: $BODY4"
if [ "$CODE4" -eq 200 ] && echo "$BODY4" | grep -qi "Quickstart OpenAI to Claude Works"; then
    echo -e "${GREEN}✓ PASSED${NC}"
    PASSED=$((PASSED+1))
else
    echo -e "${RED}✗ FAILED${NC}"
fi

# --- Test 5: OpenAI Ingress -> Custom Model (my-vllm-model) ---
echo -e "\n${YELLOW}[Test 5/6] OpenAI Ingress (/v1/chat/completions) -> Custom Model (my-vllm-model)${NC}"
RESP5=$(curl -s -w "\n%{http_code}" -X POST "https://${APIGEE_HOST}/v1/chat/completions" \
    -H "x-apikey: ${API_KEY}" \
    -H "Content-Type: application/json" \
    -d '{
        "model": "my-vllm-model",
        "messages": [{"role": "user", "content": "Ping"}]
    }')
CODE5=$(echo "$RESP5" | tail -n 1)
BODY5=$(echo "$RESP5" | sed '$d')
echo "HTTP Status: $CODE5"
echo "Response: $BODY5"
if [ "$CODE5" -eq 200 ]; then
    echo -e "${GREEN}✓ PASSED${NC}"
    PASSED=$((PASSED+1))
else
    echo -e "${RED}✗ FAILED${NC}"
fi

# --- Test 6: Catalog Discovery (/v1/models) ---
echo -e "\n${YELLOW}[Test 6/6] Model Catalog Discovery (GET /v1/models)${NC}"
RESP6=$(curl -s -w "\n%{http_code}" -X GET "https://${APIGEE_HOST}/v1/models" \
    -H "x-apikey: ${API_KEY}")
CODE6=$(echo "$RESP6" | tail -n 1)
BODY6=$(echo "$RESP6" | sed '$d')
echo "HTTP Status: $CODE6"
echo "Response: $BODY6"
if [ "$CODE6" -eq 200 ] && echo "$BODY6" | grep -q "${QUICKSTART_GEMINI_MODEL}" && echo "$BODY6" | grep -q "${QUICKSTART_CLAUDE_MODEL}"; then
    echo -e "${GREEN}✓ PASSED${NC}"
    PASSED=$((PASSED+1))
else
    echo -e "${RED}✗ FAILED${NC}"
fi

# Clean Up
rm -rf "$TMP_DIR"

echo -e "\n${BOLD}${CYAN}======================================================================${NC}"
echo -e "${BOLD}${CYAN}   RESULTS: ${PASSED}/${TOTAL} TESTS PASSED                          ${NC}"
echo -e "${BOLD}${CYAN}======================================================================${NC}"

if [ "$PASSED" -eq "$TOTAL" ]; then
    echo -e "${GREEN}${BOLD}🎉 ALL QUICKSTART LIVE INTEGRATION TESTS PASSED 100%!${NC}"
    exit 0
else
    echo -e "${RED}${BOLD}✗ SOME TESTS FAILED!${NC}"
    exit 1
fi
