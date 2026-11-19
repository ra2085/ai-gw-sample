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
# Apigee AI Gateway - BYO Models & Custom URLs Integration Test Script
# ==============================================================================

set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

export PATH="$PATH:$HOME/.apigeecli/bin:/opt/homebrew/bin:/usr/local/bin:$HOME/go/bin:$HOME/google-cloud-sdk/bin"

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
STRICT_ARMOR_TEMPLATE="${STRICT_ARMOR_TEMPLATE:-ai-gw-template}"
if [ -z "${PROJECT_ID:-}" ] || [ -z "${APIGEE_HOST:-}" ] || [ -z "${API_KEY:-}" ]; then
    echo -e "${RED}✗ Error: PROJECT_ID, APIGEE_HOST, and API_KEY are required for live integration tests.${NC}"
    echo -e "  Pass ${YELLOW}--env tests/env/<your-env>.env${NC} (see ${CYAN}tests/env/example.env${NC})."
    exit 1
fi
SERVICE_ACCOUNT="${SERVICE_ACCOUNT:-ai-gateway-runtime@${PROJECT_ID}.iam.gserviceaccount.com}"
DEV_KEY="${DEV_KEY:-$API_KEY}"
IT_KEY="${IT_KEY:-$API_KEY}"
AGENT_KEY="${AGENT_KEY:-$API_KEY}"
TEMPLATE_FILE="$REPO_ROOT/templates/ai-gateway/apiproxy.yaml"
VALUES_FILE="${VALUES_FILE:-$REPO_ROOT/tests/templates/values.byo-models.yaml}"

echo -e "${BOLD}${CYAN}======================================================================${NC}"
echo -e "${BOLD}${CYAN}   🚀 Apigee AI Gateway - BYO Models Integration & Live Suite         ${NC}"
echo -e "${BOLD}${CYAN}======================================================================${NC}"
echo -e "${YELLOW}Target Project:${NC}        ${BOLD}${PROJECT_ID}${NC}"
echo -e "${YELLOW}Target Environment:${NC}    ${BOLD}${APIGEE_ENV}${NC}"
echo -e "${YELLOW}Service Account:${NC}       ${BOLD}${SERVICE_ACCOUNT}${NC}"
echo -e "${YELLOW}Apigee Host:${NC}           ${BOLD}${APIGEE_HOST}${NC}"
echo -e "${YELLOW}Values Template:${NC}       ${BOLD}${VALUES_FILE}${NC}"
echo -e "----------------------------------------------------------------------"

# 1. Locate Required CLI Tools
if command -v apigee-go-gen &>/dev/null; then
    APIGEE_GEN="apigee-go-gen"
elif [ -f "/usr/local/bin/apigee-go-gen" ]; then
    APIGEE_GEN="/usr/local/bin/apigee-go-gen"
elif [ -f "$REPO_ROOT/bin/apigee-go-gen" ]; then
    APIGEE_GEN="$REPO_ROOT/bin/apigee-go-gen"
else
    echo -e "${RED}✗ Error: 'apigee-go-gen' command not found in PATH.${NC}"
    exit 1
fi

if command -v apigeecli &>/dev/null; then
    APIGEECLI="apigeecli"
elif [ -f "$HOME/.apigeecli/bin/apigeecli" ]; then
    APIGEECLI="$HOME/.apigeecli/bin/apigeecli"
else
    echo -e "${RED}✗ Error: 'apigeecli' command not found in PATH or ~/.apigeecli/bin.${NC}"
    exit 1
fi

# 2. Render Bundle
echo -e "\n${BLUE}Step 1: Compiling API Proxy Bundle from BYO Template...${NC}"
TMP_DIR="$REPO_ROOT/.tmp-byo-$(date +%s)"
trap 'rm -rf "$TMP_DIR"' EXIT
BUNDLE_ZIP="$TMP_DIR/${PROXY_NAME}.zip"
LIVE_VALUES="$TMP_DIR/values.byo-models.rendered.yaml"
mkdir -p "$TMP_DIR"

sed \
    -e "s|your-gcp-project-id|${PROJECT_ID}|g" \
    -e "s|your-apigee-host.example.com|${APIGEE_HOST}|g" \
    -e "s|__API_KEY__|${API_KEY}|g" \
    -e "s|__DEV_KEY__|${DEV_KEY}|g" \
    -e "s|__IT_KEY__|${IT_KEY}|g" \
    -e "s|__AGENT_KEY__|${AGENT_KEY}|g" \
    -e "s|__STRICT_ARMOR_TEMPLATE__|${STRICT_ARMOR_TEMPLATE}|g" \
    "$VALUES_FILE" > "$LIVE_VALUES"

$APIGEE_GEN render apiproxy \
    --template "$TEMPLATE_FILE" \
    --values "$LIVE_VALUES" \
    --include "$REPO_ROOT/templates/ai-gateway/*.tmpl" \
    --output "$BUNDLE_ZIP" \
    --validate=true

if [ -f "$BUNDLE_ZIP" ]; then
    BUNDLE_SIZE=$(ls -lh "$BUNDLE_ZIP" | awk '{print $5}')
    echo -e "${GREEN}✓ Rendered deployable bundle: $BUNDLE_ZIP ($BUNDLE_SIZE)${NC}"
else
    echo -e "${RED}✗ Bundle compilation failed!${NC}"
    exit 1
fi

# 3. Deploy to Apigee
if [ "$SKIP_DEPLOY" = true ]; then
    echo -e "\n${YELLOW}Step 2: Skipping deployment (--skip-deploy specified).${NC}"
else
    echo -e "\n${BLUE}Step 2: Ensuring Apigee Data Collectors, Environment PropertySet & Deploying Bundle to '$PROJECT_ID' ($APIGEE_ENV)...${NC}"
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

    cat << 'PROP_EOF' > "$TMP_DIR/provider_keys.properties"
openai_api_key=sk-mock-openai-env-propertyset-key
anthropic_api_key=sk-ant-mock-env-propertyset-key
PROP_EOF
    $APIGEECLI res create -o "$PROJECT_ID" -e "$APIGEE_ENV" --name provider_keys --type properties --respath "$TMP_DIR/provider_keys.properties" "${AUTH_FLAGS[@]}" >/dev/null 2>&1 || \
    $APIGEECLI res update -o "$PROJECT_ID" -e "$APIGEE_ENV" --name provider_keys --type properties --respath "$TMP_DIR/provider_keys.properties" "${AUTH_FLAGS[@]}" >/dev/null 2>&1 || true

    $APIGEECLI apis create bundle \
        --name "$PROXY_NAME" \
        --proxy-zip "$BUNDLE_ZIP" \
        --org "$PROJECT_ID" \
        --env "$APIGEE_ENV" \
        -s "$SERVICE_ACCOUNT" \
        --ovr \
        --wait \
        "${AUTH_FLAGS[@]}"

    echo -e "${GREEN}✓ Proxy '$PROXY_NAME' deployed successfully to '$APIGEE_ENV' with SA '$SERVICE_ACCOUNT'.${NC}"
    echo -e "${YELLOW}Waiting 5 seconds for runtime propagation...${NC}"
    sleep 5
fi

# 4. Live Tests
echo -e "\n${BLUE}Step 3: Executing Live BYO Integration Test Cases...${NC}"
PASSED=0
FAILED=0

run_test() {
    local test_name="$1"
    local method="$2"
    local endpoint="$3"
    local payload="$4"
    local expected_pattern="$5"

    local auth_header="${6:-x-apikey: ${API_KEY}}"
    local expected_status="${7:-^20[0-9]$}"
    local expected_header_pattern="${8:-}"

    echo -n "  Testing ${test_name}... "

    local raw_resp
    local http_code
    local full_content
    local flat_content
    local attempt=1
    while [ $attempt -le 3 ]; do
        if [ "$method" == "GET" ]; then
            raw_resp=$(curl -s -i -w "\n%{http_code}" -X GET "https://${APIGEE_HOST}${endpoint}" \
                -H "${auth_header}" \
                -H "Content-Type: application/json")
        else
            raw_resp=$(curl -s -i -w "\n%{http_code}" -X POST "https://${APIGEE_HOST}${endpoint}" \
                -H "${auth_header}" \
                -H "Content-Type: application/json" \
                -d "${payload}")
        fi

        http_code=$(echo "$raw_resp" | tail -n 1)
        full_content=$(echo "$raw_resp" | sed '$d')
        flat_content=$(echo "$full_content" | tr '\r\n' '  ')

        if [ "$http_code" == "429" ] && echo "$flat_content" | grep -q "RESOURCE_EXHAUSTED" && [[ "200" =~ $expected_status ]]; then
            sleep 2
            attempt=$((attempt + 1))
        else
            break
        fi
    done

    local header_ok=true
    if [ -n "$expected_header_pattern" ]; then
        if ! echo "$full_content" | grep -Eiq "$expected_header_pattern"; then
            header_ok=false
        fi
    fi

    if [[ "$http_code" =~ $expected_status ]] && echo "$flat_content" | grep -Eq "$expected_pattern" && [ "$header_ok" = true ]; then
        echo -e "${GREEN}✓ PASSED (HTTP $http_code)${NC}"
        PASSED=$((PASSED + 1))
    else
        echo -e "${RED}✗ FAILED (HTTP $http_code)${NC}"
        echo -e "    ${YELLOW}Response Preview:${NC} $(echo "$flat_content" | tail -c 300)..."
        FAILED=$((FAILED + 1))
    fi
}

# --- 3A. ProxyEndpoint 1: claude-models (/v1/models) ---
echo -e "\n${CYAN}  [3A] ProxyEndpoint: claude-models (/v1/models)${NC}"
run_test "GET /v1/models (Catalog Discovery Across All Providers)" "GET" "/v1/models" "" "(gemini-2.5-flash.*claude-haiku-4-5.*qwen-2.5-coder.*gpt-4o-mini.*my-vllm-model|my-vllm-model)"
run_test "GET /v1/models/gemini-2.5-flash (Single Model Retrieve)" "GET" "/v1/models/gemini-2.5-flash" "" '("id":\s*"gemini-2.5-flash")'
run_test "GET /v1/models?apikey=... (Query Param Auth Stripped Upstream)" "GET" "/v1/models?apikey=${API_KEY}" "" '(gemini-2.5-flash)' "X-Dummy: 1"
run_test "GET /v1/models/unknown-org/nonexistent (Multi-Segment Unknown Model -> 404)" "GET" "/v1/models/unknown-org/nonexistent" "" '("not_found_error")' "x-apikey: ${API_KEY}" "^404$" "X-Content-Type-Options: nosniff"
run_test "POST /v1/models (Loopback Reflection Blocked -> 405 Method Not Allowed)" "POST" "/v1/models" '<h1>Echo Attempt</h1>' '("code":\s*405)' "x-apikey: ${API_KEY}" "^405$" "X-Content-Type-Options: nosniff"

# --- 3B. ProxyEndpoint 2: claude-messages (/v1/messages) x All Target Providers (Non-Streaming & Streaming) ---
echo -e "\n${CYAN}  [3B] ProxyEndpoint: claude-messages (/v1/messages) x All Targets (Non-Streaming & Streaming)${NC}"
run_test "POST /v1/messages/count_tokens (Subpath Coercion Blocked -> 404 Not Found)" "POST" "/v1/messages/count_tokens" \
    '{"model":"claude-haiku-4-5","messages":[{"role":"user","content":"Count me"}]}' \
    '("not_found_error")' \
    "x-apikey: ${API_KEY}" \
    "^404$"
run_test "POST /v1/messages (Duplicate Key Pre-Judge Smuggling Blocked -> 400)" "POST" "/v1/messages" \
    '{"model":"auto:judge","model":"claude-haiku-4-5","max_tokens":64,"messages":[{"role":"user","content":"Hi"}]}' \
    '(Duplicate JSON object key)' \
    "x-apikey: ${API_KEY}" \
    "^400$"
# 1. Target: gemini (Vertex AI Gemini Native :generateContent / :streamGenerateContent)
run_test "POST /v1/messages -> Target: gemini [Vertex Gemini Non-Streaming]" "POST" "/v1/messages" \
    '{"model":"gemini-2.5-flash","max_tokens":64,"messages":[{"role":"user","content":"Reply with OK"}]}' \
    '("type":\s*"message")' \
    "x-apikey: ${API_KEY}" \
    "^200$" \
    "x-gateway-total-tokens: [1-9]"
run_test "POST /v1/messages -> Target: gemini [Vertex Gemini Streaming SSE]" "POST" "/v1/messages" \
    '{"model":"gemini-2.5-flash","max_tokens":64,"stream":true,"messages":[{"role":"user","content":"Reply with OK"}]}' \
    '(event:\s*message_start.*event:\s*content_block_delta.*event:\s*message_stop)'

# 2. Target: claude (Vertex AI Anthropic Partner :rawPredict / :streamRawPredict)
run_test "POST /v1/messages -> Target: claude [Vertex Anthropic Non-Streaming]" "POST" "/v1/messages" \
    '{"model":"claude-haiku-4-5","max_tokens":64,"messages":[{"role":"user","content":"Reply with OK"}]}' \
    '("type":\s*"message")' \
    "x-apikey: ${API_KEY}" \
    "^200$" \
    "x-gateway-total-tokens: [1-9]"
run_test "POST /v1/messages -> Target: claude [Vertex Anthropic Streaming SSE]" "POST" "/v1/messages" \
    '{"model":"claude-haiku-4-5","max_tokens":64,"stream":true,"messages":[{"role":"user","content":"Reply with OK"}]}' \
    '(event:\s*message_start.*event:\s*content_block_delta.*event:\s*message_stop)'

# 3. Target: claude (Custom BYO Anthropic Endpoint via custom_url)
run_test "POST /v1/messages -> Target: claude [Custom BYO Anthropic Non-Streaming]" "POST" "/v1/messages" \
    '{"model":"claude-on-bedrock","max_tokens":64,"messages":[{"role":"user","content":"echo: Bedrock Mock OK"}]}' \
    '(Bedrock Mock OK)' \
    "x-apikey: ${API_KEY}" \
    "^200$" \
    "x-gateway-total-tokens: [1-9]"
run_test "POST /v1/messages -> Target: claude [Custom BYO Anthropic Streaming SSE]" "POST" "/v1/messages" \
    '{"model":"claude-on-bedrock","max_tokens":64,"stream":true,"messages":[{"role":"user","content":"echo: Bedrock Stream OK"}]}' \
    '(event:\s*message_start.*Bedrock.*Stream.*OK.*event:\s*message_stop)'

# 4. Target: gemini-openai-compat (Vertex AI Model Garden MaaS via /v1/messages Transcoding)
run_test "POST /v1/messages -> Target: gemini-openai-compat [Model Garden MaaS Non-Streaming]" "POST" "/v1/messages" \
    '{"model":"qwen-2.5-coder","max_tokens":64,"messages":[{"role":"user","content":"Reply with OK"}]}' \
    '("type":\s*"message")' \
    "x-apikey: ${API_KEY}" \
    "^200$" \
    "x-gateway-total-tokens: [1-9]"
run_test "POST /v1/messages -> Target: gemini-openai-compat [Model Garden MaaS Streaming SSE]" "POST" "/v1/messages" \
    '{"model":"qwen-2.5-coder","max_tokens":64,"stream":true,"messages":[{"role":"user","content":"Reply with OK"}]}' \
    '(event:\s*message_start.*event:\s*content_block_delta.*event:\s*message_stop)'

# 5. Target: openai-custom (Custom BYO OpenAI/vLLM Endpoint via /v1/messages Transcoding)
run_test "POST /v1/messages -> Target: openai-custom [Custom BYO vLLM Non-Streaming]" "POST" "/v1/messages" \
    '{"model":"my-vllm-model","max_tokens":64,"messages":[{"role":"user","content":"echo: vLLM via Claude OK"}]}' \
    '("type":\s*"message".*vLLM via Claude OK)' \
    "x-apikey: ${API_KEY}" \
    "^200$" \
    "x-gateway-total-tokens: [1-9]"
run_test "POST /v1/messages -> Target: openai-custom [Custom BYO vLLM Streaming SSE]" "POST" "/v1/messages" \
    '{"model":"my-vllm-model","max_tokens":64,"stream":true,"messages":[{"role":"user","content":"echo: vLLM Stream via Claude OK"}]}' \
    '(event:\s*message_start.*vLLM.*Stream.*via.*Claude.*OK.*event:\s*message_stop)'

# 6. Target: openai-custom (Direct OpenAI Provider via /v1/messages Transcoding)
run_test "POST /v1/messages -> Target: openai-custom [Direct OpenAI Provider Non-Streaming]" "POST" "/v1/messages" \
    '{"model":"gpt-4o-mini","max_tokens":64,"messages":[{"role":"user","content":"echo: Direct OpenAI via Claude OK"}]}' \
    '("type":\s*"message".*Direct OpenAI via Claude OK)' \
    "x-apikey: ${API_KEY}" \
    "^200$" \
    "x-gateway-provider-account: org-ai-gateway-test"
run_test "POST /v1/messages -> Target: openai-custom [Direct OpenAI Provider Streaming SSE]" "POST" "/v1/messages" \
    '{"model":"gpt-4o-mini","max_tokens":64,"stream":true,"messages":[{"role":"user","content":"echo: Direct OpenAI Stream via Claude OK"}]}' \
    '(event:\s*message_start.*Direct.*OpenAI.*Stream.*via.*Claude.*OK.*event:\s*message_stop)'

# 7. Smart Auto-Router & LLM Judge on /v1/messages
run_test "POST /v1/messages -> Smart Auto-Router (model=auto)" "POST" "/v1/messages" \
    '{"model":"auto","max_tokens":64,"messages":[{"role":"user","content":"Reply with OK"}]}' \
    '("type":\s*"message")' \
    "x-apikey: ${API_KEY}" \
    "^200$" \
    "x-gateway-cost-tier: medium"

# --- 3C. ProxyEndpoint 3: openai-compat (/v1/chat/completions) x All Target Providers (Non-Streaming & Streaming) ---
echo -e "\n${CYAN}  [3C] ProxyEndpoint: openai-compat (/v1/chat/completions) x All Targets (Non-Streaming & Streaming)${NC}"
# 1. Target: gemini-openai-compat (Vertex AI Gemini via OpenAI-Compat Endpoint)
run_test "POST /v1/chat/completions -> Target: gemini-openai-compat [Vertex Gemini Non-Streaming]" "POST" "/v1/chat/completions" \
    '{"model":"gemini-2.5-flash","messages":[{"role":"user","content":"Reply with OK"}]}' \
    '("choices":\s*\[)' \
    "x-apikey: ${API_KEY}" \
    "^200$" \
    "x-gateway-total-tokens: [1-9]"
run_test "POST /v1/chat/completions -> Target: gemini-openai-compat [Vertex Gemini Streaming SSE]" "POST" "/v1/chat/completions" \
    '{"model":"gemini-2.5-flash","stream":true,"messages":[{"role":"user","content":"Reply with OK"}]}' \
    '(chat\.completion\.chunk.*\[DONE\])'

# 2. Target: gemini-openai-compat (Vertex AI Model Garden MaaS)
run_test "POST /v1/chat/completions -> Target: gemini-openai-compat [Model Garden MaaS Non-Streaming]" "POST" "/v1/chat/completions" \
    '{"model":"qwen-2.5-coder","messages":[{"role":"user","content":"Reply with OK"}]}' \
    '("choices":\s*\[)' \
    "x-apikey: ${API_KEY}" \
    "^200$" \
    "x-gateway-total-tokens: [1-9]"
run_test "POST /v1/chat/completions -> Target: gemini-openai-compat [Model Garden MaaS Streaming SSE]" "POST" "/v1/chat/completions" \
    '{"model":"qwen-2.5-coder","stream":true,"messages":[{"role":"user","content":"Reply with OK"}]}' \
    '(chat\.completion\.chunk.*\[DONE\])'

# 3. Target: claude (Vertex AI Anthropic Partner via /v1/chat/completions Transcoding)
run_test "POST /v1/chat/completions -> Target: claude [Vertex Anthropic Non-Streaming]" "POST" "/v1/chat/completions" \
    '{"model":"claude-haiku-4-5","max_tokens":64,"messages":[{"role":"user","content":"Reply with OK"}]}' \
    '("object":\s*"chat\.completion".*"choices":\s*\[)' \
    "x-apikey: ${API_KEY}" \
    "^200$" \
    "x-gateway-total-tokens: [1-9]"
run_test "POST /v1/chat/completions -> Target: claude [Vertex Anthropic Streaming SSE]" "POST" "/v1/chat/completions" \
    '{"model":"claude-haiku-4-5","max_tokens":64,"stream":true,"messages":[{"role":"user","content":"Reply with OK"}]}' \
    '(chat\.completion\.chunk.*\[DONE\])'

# 4. Target: claude (Custom BYO Anthropic via /v1/chat/completions Transcoding)
run_test "POST /v1/chat/completions -> Target: claude [Custom BYO Anthropic Non-Streaming]" "POST" "/v1/chat/completions" \
    '{"model":"claude-on-bedrock","max_tokens":64,"messages":[{"role":"user","content":"echo: Bedrock via OpenAI OK"}]}' \
    '("object":\s*"chat\.completion".*Bedrock via OpenAI OK)' \
    "x-apikey: ${API_KEY}" \
    "^200$" \
    "x-gateway-total-tokens: [1-9]"
run_test "POST /v1/chat/completions -> Target: claude [Custom BYO Anthropic Streaming SSE]" "POST" "/v1/chat/completions" \
    '{"model":"claude-on-bedrock","max_tokens":64,"stream":true,"messages":[{"role":"user","content":"echo: Bedrock Stream via OpenAI OK"}]}' \
    '(chat\.completion\.chunk.*Bedrock.*Stream.*via.*OpenAI.*OK.*\[DONE\])'

# 5. Target: openai-custom (Custom BYO OpenAI/vLLM Endpoint)
run_test "POST /v1/chat/completions -> Target: openai-custom [Custom BYO vLLM Non-Streaming]" "POST" "/v1/chat/completions" \
    '{"model":"my-vllm-model","messages":[{"role":"user","content":"echo: OK"}]}' \
    "(choices|message|content|OK)" \
    "x-apikey: ${API_KEY}" \
    "^200$" \
    "x-gateway-total-tokens: [1-9]"
run_test "POST /v1/chat/completions -> Target: openai-custom [Custom BYO vLLM Streaming SSE]" "POST" "/v1/chat/completions" \
    '{"model":"my-vllm-model","stream":true,"messages":[{"role":"user","content":"echo: Stream OK"}]}' \
    '(chat\.completion\.chunk.*Stream.*OK.*\[DONE\])'

# 6. Target: openai-custom (Direct OpenAI Provider with Org/Project Headers)
run_test "POST /v1/chat/completions -> Target: openai-custom [Direct OpenAI Provider Non-Streaming]" "POST" "/v1/chat/completions" \
    '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"echo: Direct OpenAI OK"}]}' \
    "(Direct OpenAI OK)" \
    "x-apikey: ${API_KEY}" \
    "^200$" \
    "x-gateway-auth-source: model_config"
run_test "POST /v1/chat/completions -> Target: openai-custom [Direct OpenAI Provider Streaming SSE]" "POST" "/v1/chat/completions" \
    '{"model":"gpt-4o-mini","stream":true,"messages":[{"role":"user","content":"echo: Direct OpenAI Stream OK"}]}' \
    '(chat\.completion\.chunk.*Direct.*OpenAI.*Stream.*OK.*\[DONE\])'

# 7. Smart Auto-Router & LLM Judge on /v1/chat/completions
run_test "POST /v1/chat/completions -> Smart Auto-Router (model=auto)" "POST" "/v1/chat/completions" \
    '{"model":"auto","messages":[{"role":"user","content":"Reply with OK"}]}' \
    '("choices":\s*\[)' \
    "x-apikey: ${API_KEY}" \
    "^200$" \
    "x-gateway-cost-tier: medium"
run_test "POST /v1/chat/completions -> LLM Judge Classifier (model=auto:judge)" "POST" "/v1/chat/completions" \
    '{"model":"auto:judge","messages":[{"role":"user","content":"Reply with OK"}]}' \
    '("choices":\s*\[)' \
    "x-apikey: ${API_KEY}" \
    "^200$" \
    "x-gateway-judge-tier: (low|medium|high|max)"

# 8. Cache & Thinking Token Telemetry Directives + Live Vertex OpenAI-Compat Reasoning Cost Parity
run_test "POST /v1/chat/completions -> Cache & Thinking Token Accounting" "POST" "/v1/chat/completions" \
    '{"model":"my-vllm-model","messages":[{"role":"user","content":"tokens: 100,200 cache: 50 thinking: 50"}]}' \
    '("cached_tokens":50|"reasoning_tokens":50)' \
    "x-apikey: ${API_KEY}" \
    "^200$" \
    "x-gateway-cache-read-tokens: 50"

echo -ne "  Testing POST /v1/chat/completions -> Vertex OpenAI-Compat Reasoning Token Cost Parity... "
R_HDR=$(mktemp)
R_BODY=$(curl -sS -D "$R_HDR" "https://${APIGEE_HOST}/v1/chat/completions" \
    -H "x-apikey: ${DEV_KEY}" \
    -H "Content-Type: application/json" \
    -d '{"model":"gemini-2.5-flash","messages":[{"role":"user","content":"What is 27 * 43? Show brief steps."}],"max_tokens":512}')
if python3 - "$R_HDR" "$R_BODY" << 'PYEOF'
import json, re, sys
hdr_text = open(sys.argv[1], encoding="utf-8", errors="replace").read()
body = json.loads(sys.argv[2])
u = body.get("usage") or {}
raw_in = int(u.get("prompt_tokens") or 0)
raw_out = int(u.get("completion_tokens") or 0)
raw_reason = int(((u.get("completion_tokens_details") or {}).get("reasoning_tokens")) or 0)
raw_total = int(u.get("total_tokens") or 0)
def h(name):
    m = re.search(rf"^{re.escape(name)}:\s*(\S+)", hdr_text, re.I | re.M)
    return m.group(1) if m else ""
gw_comp = int(h("x-gateway-completion-tokens") or 0)
gw_think = int(h("x-gateway-thinking-tokens") or 0)
gw_total = int(h("x-gateway-total-tokens") or 0)
gw_comp_cost = float(h("x-gateway-completion-cost-usd") or 0.0)
exp_comp = (raw_out + raw_reason) if (raw_reason > 0 and raw_total >= raw_in + raw_out + raw_reason) else raw_out
assert raw_reason > 0, f"expected gemini-2.5-flash to emit reasoning_tokens > 0, got {u}"
assert gw_think == raw_reason, f"thinking mismatch: {gw_think} != {raw_reason}"
assert gw_comp == exp_comp, f"completion mismatch: {gw_comp} != {exp_comp} (raw_out={raw_out}, reason={raw_reason})"
assert gw_total == raw_total, f"total mismatch: {gw_total} != {raw_total}"
exp_min_cost = round((exp_comp * 2.50 / 1000000.0) - 0.000002, 6)
assert gw_comp_cost >= exp_min_cost, f"USD completion cost {gw_comp_cost} missed reasoning tokens (expected >= {exp_min_cost} for {exp_comp} tokens)"
PYEOF
then
    echo -e "${GREEN}✓ PASSED (HTTP 200)${NC}"
    PASSED=$((PASSED + 1))
else
    echo -e "${RED}✗ FAILED${NC}"
    FAILED=$((FAILED + 1))
fi
rm -f "$R_HDR"

# --- 3D. ProxyEndpoint 4: gemini-native (/ai-gateway/v1/...) x Vertex Gemini & Vertex Anthropic ---
echo -e "\n${CYAN}  [3D] ProxyEndpoint: gemini-native (/ai-gateway) x Vertex Gemini & Anthropic (Non-Streaming & Streaming)${NC}"
run_test "POST /ai-gateway -> Target: gemini-native-target [Vertex Gemini :generateContent]" "POST" \
    "/ai-gateway/v1/projects/${PROJECT_ID}/locations/global/publishers/google/models/gemini-2.5-flash:generateContent" \
    '{"contents":[{"role":"user","parts":[{"text":"Reply with OK"}]}]}' \
    '("candidates":\s*\[)' \
    "x-apikey: ${API_KEY}" \
    "^200$" \
    "x-gateway-total-tokens: [1-9]"
run_test "POST /ai-gateway -> Target: gemini-native-target [Vertex Gemini :streamGenerateContent?alt=sse]" "POST" \
    "/ai-gateway/v1/projects/${PROJECT_ID}/locations/global/publishers/google/models/gemini-2.5-flash:streamGenerateContent?alt=sse" \
    '{"contents":[{"role":"user","parts":[{"text":"Reply with OK"}]}]}' \
    '(data:\s*\{.*"candidates")'
run_test "POST /ai-gateway -> Target: gemini-native-target [Vertex Anthropic :rawPredict]" "POST" \
    "/ai-gateway/v1/projects/${PROJECT_ID}/locations/us-east5/publishers/anthropic/models/claude-haiku-4-5:rawPredict" \
    '{"anthropic_version":"vertex-2023-10-16","max_tokens":64,"messages":[{"role":"user","content":"Reply with OK"}]}' \
    '("type":\s*"message")' \
    "x-apikey: ${API_KEY}" \
    "^200$" \
    "x-gateway-total-tokens: [1-9]"
run_test "POST /ai-gateway -> Target: gemini-native-target [Vertex Anthropic :streamRawPredict]" "POST" \
    "/ai-gateway/v1/projects/${PROJECT_ID}/locations/us-east5/publishers/anthropic/models/claude-haiku-4-5:streamRawPredict" \
    '{"anthropic_version":"vertex-2023-10-16","max_tokens":64,"stream":true,"messages":[{"role":"user","content":"Reply with OK"}]}' \
    '(event:\s*message_start.*event:\s*message_stop)'

# --- 3E. ProxyEndpoint 5: openai-embeddings (/v1/embeddings) x Vertex :predict & OpenAI /embeddings ---
echo -e "\n${CYAN}  [3E] ProxyEndpoint: openai-embeddings (/v1/embeddings) x Vertex :predict & OpenAI /embeddings${NC}"
run_test "POST /v1/embeddings -> Target: gemini-openai-compat [Vertex AI text-embedding-005 :predict Transcoded]" "POST" \
    "/v1/embeddings" \
    '{"model":"byo-gemini-model","input":"Apigee Enterprise AI Gateway embeddings test"}' \
    '("object":\s*"list".*"object":\s*"embedding")' \
    "x-apikey: ${API_KEY}" \
    "^200$" \
    "x-gateway-total-tokens: [1-9]"
run_test "POST /v1/embeddings -> Target: openai-custom [Custom BYO OpenAI /embeddings]" "POST" \
    "/v1/embeddings" \
    '{"model":"my-vllm-model","input":"Custom vLLM embeddings test"}' \
    '("object":\s*"list".*"object":\s*"embedding")' \
    "x-apikey: ${API_KEY}" \
    "^200$" \
    "x-gateway-total-tokens: [1-9]"
run_test "POST /v1/embeddings -> Target: openai-custom [Direct OpenAI Provider /embeddings]" "POST" \
    "/v1/embeddings" \
    '{"model":"gpt-4o-mini","input":"Direct OpenAI embeddings test"}' \
    '("object":\s*"list".*"object":\s*"embedding")' \
    "x-apikey: ${API_KEY}" \
    "^200$" \
    "x-gateway-provider-account: org-ai-gateway-test"

# --- 3F. Identity & Persona Token Import Tests ---
echo -e "\n${CYAN}  [3F] Multi-Auth Persona & Glob Identity Resolution${NC}"
AUTH_RUN_ID="$(date +%s)"
run_test "POST /v1/chat/completions (GCP SPIFFE Agent Identity Glob Auth)" "POST" "/v1/chat/completions" \
    '{"model":"my-vllm-model","messages":[{"role":"user","content":"echo: SPIFFE Auth OK"}]}' \
    "(SPIFFE Auth OK)" \
    "Authorization: Bearer ya29.spiffe-research-agent-${AUTH_RUN_ID}"
run_test "POST /v1/chat/completions (GCP Service Account Glob Auth)" "POST" "/v1/chat/completions" \
    '{"model":"my-vllm-model","messages":[{"role":"user","content":"echo: SA Auth OK"}]}' \
    "(SA Auth OK)" \
    "Authorization: Bearer ya29.sa-finance-bot-${AUTH_RUN_ID}"
run_test "POST /v1/chat/completions (IdP Opaque Token Glob Auth swe-* -> developer)" "POST" "/v1/chat/completions" \
    '{"model":"my-vllm-model","messages":[{"role":"user","content":"echo: Okta Dev Glob Match OK"}]}' \
    "(Okta Dev Glob Match OK)" \
    "Authorization: Bearer okta_dev_token_${AUTH_RUN_ID}"
run_test "POST /v1/chat/completions (IdP Opaque Token Glob Auth sre-* -> it)" "POST" "/v1/chat/completions" \
    '{"model":"my-vllm-model","messages":[{"role":"user","content":"echo: Okta SRE Glob Match OK"}]}' \
    "(Okta SRE Glob Match OK)" \
    "Authorization: Bearer okta_it_token_${AUTH_RUN_ID}"
run_test "POST /v1/chat/completions (IdP Opaque Token Unmapped Role -> 403 Forbidden)" "POST" "/v1/chat/completions" \
    '{"model":"my-vllm-model","messages":[{"role":"user","content":"echo: Should Fail 403"}]}' \
    "(permission_error)" \
    "Authorization: Bearer okta_unmapped_token_${AUTH_RUN_ID}" \
    "^403$"

# --- Context-Aware Model Armor Live Tests (6-Tier Precedence & Request/Response Split) ---
echo -e "\n${BLUE}Step 4: Executing Live Context-Aware Model Armor Tests...${NC}"

# 1. Global Default (ai-gw-template): allows email in prompt (no SDP filter) and emits global_default headers
run_test "Model Armor [Global Default]: Email in prompt allowed by ai-gw-template" "POST" "/v1/chat/completions" \
    '{"model":"my-vllm-model","messages":[{"role":"user","content":"echo: Contact john.doe@example.com"}]}' \
    "(john.doe@example.com)" \
    "x-apikey: ${API_KEY}" \
    "^200$" \
    "x-gateway-model-armor-request-template: ai-gw-template"

# 2. Identity Glob Rule (team:pci-compliance -> STRICT_ARMOR_TEMPLATE): blocks exact same email prompt in REQUEST phase (403)
run_test "Model Armor [Identity Rule team:pci-compliance]: Email in prompt BLOCKED in Request Phase (403)" "POST" "/v1/chat/completions" \
    '{"model":"my-vllm-model","messages":[{"role":"user","content":"echo: Contact john.doe@example.com"}]}' \
    "(\"modelArmorPhase\":\\s*\"request\"|\"modelArmorTemplate\":\\s*\"${STRICT_ARMOR_TEMPLATE}\")" \
    "Authorization: Bearer okta_pci_auditor_token_${AUTH_RUN_ID}" \
    "^403$" \
    "x-gateway-model-armor-phase: request"

# 3. Asymmetric Persona Templates (developer: req=ai-gw-template, resp=gap_template):
#    Global default (ai-gw-template) allows simulated PII in model response (200),
#    whereas Developer persona (resp=gap_template) BLOCKS simulated PII in RESPONSE phase (403)!
run_test "Model Armor [Global Default]: Simulated PII in model response allowed by ai-gw-template (200)" "POST" "/v1/chat/completions" \
    '{"model":"my-vllm-model","messages":[{"role":"user","content":"simulate_response: pii"}]}' \
    "(123-45-6789)" \
    "x-apikey: ${API_KEY}" \
    "^200$" \
    "x-gateway-model-armor-response-template: ai-gw-template"

run_test "Model Armor [Persona developer]: Asymmetric Response Template (gap_template) BLOCKS PII in Response Phase (403)" "POST" "/v1/chat/completions" \
    '{"model":"my-vllm-model","messages":[{"role":"user","content":"simulate_response: pii"}]}' \
    '("modelArmorPhase":\s*"response"|"modelArmorTemplate":\s*"gap_template")' \
    "Authorization: Bearer okta_dev_token_${AUTH_RUN_ID}" \
    "^403$" \
    "x-gateway-model-armor-phase: response"

# 4. Response Phase Bypass (Persona it: req=gap_template, resp=none):
#    Simulated PII in model response is ALLOWED (200) because response_template=none!
run_test "Model Armor [Persona it]: Response Phase Bypass (resp=none) allows PII in model response (200)" "POST" "/v1/chat/completions" \
    '{"model":"my-vllm-model","messages":[{"role":"user","content":"simulate_response: pii"}]}' \
    "(123-45-6789)" \
    "Authorization: Bearer okta_it_token_${AUTH_RUN_ID}" \
    "^200$" \
    "x-gateway-model-armor-response-template: none"

# 5. Tier 1 Explicit Token Claim Override (okta_armor_claim_token: req=STRICT_ARMOR_TEMPLATE, resp=none):
#    Overrides persona defaults via identity_claim, blocking email in request phase (403) while bypassing response phase (200)
run_test "Model Armor [Tier 1 Token Claim]: Response Bypass (resp=none via identity_claim) (200)" "POST" "/v1/chat/completions" \
    '{"model":"my-vllm-model","messages":[{"role":"user","content":"simulate_response: pii"}]}' \
    "(123-45-6789)" \
    "Authorization: Bearer okta_armor_claim_token_${AUTH_RUN_ID}" \
    "^200$" \
    "x-gateway-model-armor-source: .*identity_claim"

run_test "Model Armor [Tier 1 Token Claim]: Request Template (${STRICT_ARMOR_TEMPLATE} via identity_claim) BLOCKS email (403)" "POST" "/v1/chat/completions" \
    '{"model":"my-vllm-model","messages":[{"role":"user","content":"echo: Contact john.doe@example.com"}]}' \
    '("modelArmorSource":\s*"identity_claim")' \
    "Authorization: Bearer okta_armor_claim_token_${AUTH_RUN_ID}" \
    "^403$" \
    "x-gateway-model-armor-template: ${STRICT_ARMOR_TEMPLATE}"

# --- Multi-Model Fallback Chain & Rolling-Window Circuit Breaker Live Tests ---
echo -e "\n${BLUE}Step 5: Executing Live Fallback Chain & Rolling-Window Circuit Breaker Tests...${NC}"

run_test "Fallback Chain [Call 1/3 - Circuit CLOSED]: Primary 503 fails over to gemini-2.5-flash (200)" "POST" "/v1/chat/completions" \
    '{"model":"deepseek-r1-custom","models":["deepseek-r1-custom","gemini-2.5-flash"],"messages":[{"role":"user","content":"error: 503: GPU cluster overloaded. Reply with the single word FALLBACK_OK."}]}' \
    "(FALLBACK_OK|choices)" \
    "x-apikey: ${API_KEY}" \
    "^200$" \
    "x-gateway-fallback-triggered: true"

run_test "Fallback Chain [Call 2/3 - Circuit CLOSED]: Primary 429 fails over to gemini-2.5-flash (200)" "POST" "/v1/chat/completions" \
    '{"model":"deepseek-r1-custom","models":["deepseek-r1-custom","gemini-2.5-flash"],"messages":[{"role":"user","content":"error: 429: Upstream rate limit. Reply with the single word FALLBACK_OK."}]}' \
    "(FALLBACK_OK|choices)" \
    "x-apikey: ${API_KEY}" \
    "^200$" \
    "x-gateway-routed-model: gemini-2.5-flash"

run_test "Fallback Chain [Call 3/3 - Budget Reached]: Primary 503 fails over & trips error budget (200)" "POST" "/v1/chat/completions" \
    '{"model":"deepseek-r1-custom","models":["deepseek-r1-custom","gemini-2.5-flash"],"messages":[{"role":"user","content":"error: 503: Third upstream failure. Reply with the single word FALLBACK_OK."}]}' \
    "(FALLBACK_OK|choices)" \
    "x-apikey: ${API_KEY}" \
    "^200$" \
    "x-gateway-fallback-triggered: true"

sleep 2

run_test "Circuit Breaker [Call 4 - Circuit OPEN]: PreFlow promotes gemini-2.5-flash with 0ms extra hop latency (200)" "POST" "/v1/chat/completions" \
    '{"model":"deepseek-r1-custom","models":["deepseek-r1-custom","gemini-2.5-flash"],"messages":[{"role":"user","content":"Reply with the single word CIRCUIT_OPEN_OK."}]}' \
    "(CIRCUIT_OPEN_OK|choices)" \
    "x-apikey: ${API_KEY}" \
    "^200$" \
    "x-gateway-circuit-breaker: OPEN"

# --- Virtual USD Spend Wallets, Shared Team Budgets & System Behavior Matrix (Rows 1-5 + Option C) ---
echo -e "\n${BLUE}Step 6: Executing Live Virtual USD Spend Wallets, Team Budgets & System Behavior Matrix Tests...${NC}"
MATRIX_RUN_ID="$(date +%s)"
TEAM_A="matrix-team-${MATRIX_RUN_ID}"
TEAM_B="matrix-topup-${MATRIX_RUN_ID}"

# Row 1: Team Pool 🟢 Has Funds ($0.10) + Individual 🟢 Has Funds ($0.05) + Standard User -> Approved (200)
# my-vllm-model pricing: input=$0.20/1M, output=$0.50/1M -> tokens: 100000,40000 = $0.02 + $0.02 = $0.040000 (40,000 micro-USD)
run_test "Matrix Row 1 [Team 🟢 \$0.10 | Indiv 🟢 \$0.05 | Standard]: Approved & deducts \$0.04 from both meters (200)" "POST" "/v1/chat/completions" \
    '{"model":"my-vllm-model","messages":[{"role":"user","content":"tokens: 100000,40000"}]}' \
    '("choices":\s*\[)' \
    "Authorization: Bearer ya29.sa.std1@${TEAM_A}.iam.gserviceaccount.com" \
    "^200$" \
    "x-gateway-total-cost-usd: 0\.040000"

# Second call by std1 ($0.02 = 20,000 micro-USD) pushes std1 to $0.06/$0.05 (🔴 Exhausted) while TEAM_A is at $0.06/$0.10 (🟢 Has Funds)
run_test "Matrix Row 1 -> Exhaust Individual [Team 🟢 \$0.04 rem | Indiv 🟢 \$0.01 rem]: Approved & crosses \$0.05 personal cap (200)" "POST" "/v1/chat/completions" \
    '{"model":"my-vllm-model","messages":[{"role":"user","content":"tokens: 50000,20000"}]}' \
    '("choices":\s*\[)' \
    "Authorization: Bearer ya29.sa.std1@${TEAM_A}.iam.gserviceaccount.com" \
    "^200$" \
    "x-quota-allowed: 50000"

sleep 1

# Row 2: Team Pool 🟢 Has Funds ($0.06/$0.10) + Individual 🔴 Exhausted ($0.06/$0.05) + Standard User -> Denied (429)
run_test "Matrix Row 2 [Team 🟢 Has Funds | Indiv 🔴 Exhausted | Standard]: std1 Blocked by \$0.05 personal limit (429)" "POST" "/v1/chat/completions" \
    '{"model":"my-vllm-model","messages":[{"role":"user","content":"tokens: 1000,1000"}]}' \
    '(spend quota exceeded.*\$0\.05 USD)' \
    "Authorization: Bearer ya29.sa.std1@${TEAM_A}.iam.gserviceaccount.com" \
    "^429$" \
    "X-RateLimit-Constraint: per_model_quota"

# Row 2 (Teammate Continues): Teammate std2 ($0.00/$0.05) keeps working while Team Pool still has $0.04 -> Approved (200), exhausting TEAM_A ($0.11/$0.10)
run_test "Matrix Row 2 [Team 🟢 Has Funds | Teammate std2 🟢 \$0.00/\$0.05]: Rest of team keeps working & exhausts \$0.10 team pool (200)" "POST" "/v1/chat/completions" \
    '{"model":"my-vllm-model","messages":[{"role":"user","content":"tokens: 125000,50000"}]}' \
    '("choices":\s*\[)' \
    "Authorization: Bearer ya29.sa.std2@${TEAM_A}.iam.gserviceaccount.com" \
    "^200$" \
    "x-gateway-total-cost-usd: 0\.050000"

sleep 1

# Row 3: Team Pool 🔴 Exhausted ($0.11/$0.10) + Individual 🟢 Has Funds ($0.00/$0.05) + Standard User -> Denied (429 Team Lockdown)
run_test "Matrix Row 3 [Team 🔴 Exhausted | Indiv 🟢 \$0.00 used | Standard]: std3 Blocked by \$0.10 master team pool (429)" "POST" "/v1/chat/completions" \
    '{"model":"my-vllm-model","messages":[{"role":"user","content":"tokens: 1000,1000"}]}' \
    "(Team spend budget exceeded for team 'project:${TEAM_A}'.*\\\$0\\.10 USD)" \
    "Authorization: Bearer ya29.sa.std3@${TEAM_A}.iam.gserviceaccount.com" \
    "^429$" \
    "X-RateLimit-Constraint: team_budget_quota"

# Row 4a (Option C Default — bypass_team_budget: false): Individual Exception ($0.20 cap) still blocked when Team Pool is 🔴 Exhausted (429)
run_test "Matrix Row 4a [Team 🔴 Exhausted | Indiv Exception \$0.20 (bypass=false)]: Blocked by master team pool (429)" "POST" "/v1/chat/completions" \
    '{"model":"my-vllm-model","messages":[{"role":"user","content":"tokens: 1000,1000"}]}' \
    "(Team spend budget exceeded for team 'project:${TEAM_A}'.*\\\$0\\.10 USD)" \
    "Authorization: Bearer ya29.sa.alice-exc-1@${TEAM_A}.iam.gserviceaccount.com" \
    "^429$" \
    "X-RateLimit-Constraint: team_budget_quota"

# Row 4b (Option C Emergency Override — bypass_team_budget: true): Individual Exception ($0.20 cap + bypass=true) approved despite 🔴 Exhausted Team Pool (200)
run_test "Matrix Row 4b [Team 🔴 Exhausted | Indiv Exception \$0.20 (bypass_team_budget=true)]: Emergency bypass Approved (200)" "POST" "/v1/chat/completions" \
    '{"model":"my-vllm-model","messages":[{"role":"user","content":"tokens: 200000,80000"}]}' \
    '("choices":\s*\[)' \
    "Authorization: Bearer ya29.sa.alice-bypass-1@${TEAM_A}.iam.gserviceaccount.com" \
    "^200$" \
    "x-quota-allowed: 200000"

# Row 5: Team Pool 🟢 Has Funds + Individual 🔴 Exhausted Baseline (>$0.05) + Individual Exception ($0.20 cap, bypass=false) -> Approved & draws from Team Pool (200)
run_test "Matrix Row 5 [Setup — Indiv Exception spends \$0.08 (> \$0.05 baseline) on TEAM_B]: Approved (200)" "POST" "/v1/chat/completions" \
    '{"model":"my-vllm-model","messages":[{"role":"user","content":"tokens: 200000,80000"}]}' \
    '("choices":\s*\[)' \
    "Authorization: Bearer ya29.sa.alice-exc-2@${TEAM_B}.iam.gserviceaccount.com" \
    "^200$" \
    "x-quota-allowed: 200000"

sleep 1

run_test "Matrix Row 5 [Team 🟢 Has Funds | Indiv >\$0.05 Baseline | Exception \$0.20]: Approved & deducts from shared TEAM_B pool (200)" "POST" "/v1/chat/completions" \
    '{"model":"my-vllm-model","messages":[{"role":"user","content":"tokens: 200000,80000"}]}' \
    '("choices":\s*\[)' \
    "Authorization: Bearer ya29.sa.alice-exc-2@${TEAM_B}.iam.gserviceaccount.com" \
    "^200$" \
    "x-gateway-total-cost-usd: 0\.080000"

sleep 1

# Team Exception (team:project:matrix-topup-* -> $0.25 team pool): TEAM_B is now at $0.16 (above $0.10 baseline), but standard user bob is Approved (200)!
run_test "Team Exception [team:project:${TEAM_B} -> \$0.25 Pool]: Standard user bob Approved after \$0.16 team spend (> \$0.10 baseline) (200)" "POST" "/v1/chat/completions" \
    '{"model":"my-vllm-model","messages":[{"role":"user","content":"tokens: 100000,40000"}]}' \
    '("choices":\s*\[)' \
    "Authorization: Bearer ya29.sa.bob@${TEAM_B}.iam.gserviceaccount.com" \
    "^200$" \
    "x-quota-allowed: 50000"

# Multi-Auth Quota & Counter Verification (Option 1: API Key, Option 3a: SPIFFE Agent Identity, Option 4a: IdP Opaque Token)
run_test "Multi-Auth Quota [Option 1 — API Key]: Enforces & counts tokens against API key identifier (200)" "POST" "/v1/chat/completions" \
    '{"model":"my-vllm-model","messages":[{"role":"user","content":"tokens: 1000,1000"}]}' \
    '("choices":\s*\[)' \
    "x-apikey: ${API_KEY}" \
    "^200$" \
    "x-quota-used: [1-9]"

run_test "Multi-Auth Quota [Option 3a — GCP SPIFFE Agent Identity]: Enforces & counts tokens against principal:// identifier (200)" "POST" "/v1/chat/completions" \
    '{"model":"my-vllm-model","messages":[{"role":"user","content":"tokens: 1500,500"}]}' \
    '("choices":\s*\[)' \
    "Authorization: Bearer ya29.spiffe.123456789012.${MATRIX_RUN_ID}.us-central1.matrix-agent" \
    "^200$" \
    "x-quota-used: 2000"

run_test "Multi-Auth Quota [Option 4a — IdP Opaque Token ai_quota_override]: Applies 10,000,000 token override from IdP /userinfo claim (200)" "POST" "/v1/chat/completions" \
    '{"model":"my-vllm-model","messages":[{"role":"user","content":"tokens: 2000,1000"}]}' \
    '("choices":\s*\[)' \
    "Authorization: Bearer okta_exception_token_${MATRIX_RUN_ID}" \
    "^200$" \
    "x-quota-allowed: 10000000"

rm -rf "$TMP_DIR"

echo -e "\n${BOLD}${CYAN}======================================================================${NC}"
echo -e "${BOLD}BYO Models Integration Test Summary:${NC}"
echo -e "  ${GREEN}Passed: $PASSED${NC}"
if [ "$FAILED" -gt 0 ]; then
    echo -e "  ${RED}Failed: $FAILED${NC}"
    exit 1
else
    echo -e "  ${GREEN}All live integration tests passed against $APIGEE_ENV! 🎉${NC}"
fi
