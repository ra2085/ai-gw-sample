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
# Apigee AI Gateway - Template Rendering, Feature Toggle & Parity Test Suite
# ==============================================================================

set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TMP_DIR="/tmp/ai-gw-template-test-$(date +%s)"
mkdir -p "$TMP_DIR"

echo -e "${BLUE}======================================================${NC}"
echo -e "${BLUE}Apigee AI Gateway Template Verification Suite${NC}"
echo -e "${BLUE}======================================================${NC}"

# 1. Locate apigee-go-gen CLI (Prerequisite)
echo -e "\n${YELLOW}Step 1: Checking for apigee-go-gen prerequisite...${NC}"

if command -v apigee-go-gen &>/dev/null; then
    APIGEE_GEN="apigee-go-gen"
elif [ -f "$REPO_ROOT/bin/apigee-go-gen" ]; then
    APIGEE_GEN="$REPO_ROOT/bin/apigee-go-gen"
else
    echo -e "${RED}✗ Error: 'apigee-go-gen' command not found in PATH.${NC}"
    echo "Please install apigee-go-gen as a prerequisite:"
    echo "  curl -s https://apigee.github.io/apigee-go-gen/install | sh"
    exit 1
fi
echo -e "${GREEN}✓ Found apigee-go-gen: $(which $APIGEE_GEN 2>/dev/null || echo $APIGEE_GEN)${NC}"


# 2. Test MVP Full Bundle Render & Schema Validation
echo -e "\n${YELLOW}Step 2: Rendering Full MVP Template...${NC}"
MVP_OUT="$TMP_DIR/mvp_bundle"
$APIGEE_GEN render apiproxy \
    --template "$REPO_ROOT/templates/ai-gateway/apiproxy.yaml" \
    --values "$REPO_ROOT/templates/ai-gateway/values.yaml" \
    --output "$MVP_OUT" \
    --validate=true

if [ -d "$MVP_OUT/apiproxy" ]; then
    echo -e "${GREEN}✓ MVP Template rendered and validated successfully.${NC}"
else
    echo -e "${RED}✗ MVP Template rendering failed!${NC}"
    exit 1
fi

# 3. Verify Bundle Components & Static/Rendered Parity
echo -e "\n${YELLOW}Step 3: Checking Bundle Component & Static/Template Parity...${NC}"

# Check ProxyEndpoints (5 expected)
PROXY_COUNT=$(find "$MVP_OUT/apiproxy/proxies" -name "*.xml" | wc -l | tr -d ' ')
if [ "$PROXY_COUNT" -eq 5 ]; then
    echo -e "${GREEN}✓ ProxyEndpoints (5/5): claude-messages, gemini-native, openai-compat, openai-embeddings, claude-models${NC}"
    if grep -q "<TargetEndpoint>gemini-native-target</TargetEndpoint>" "$MVP_OUT/apiproxy/proxies/gemini-native.xml" && \
       grep -q "<TargetEndpoint>claude</TargetEndpoint>" "$MVP_OUT/apiproxy/proxies/gemini-native.xml"; then
        echo -e "${GREEN}✓ gemini-native RouteRules verified (claude conditional + fallback gemini-native-target).${NC}"
    else
        echo -e "${RED}✗ gemini-native ProxyEndpoint missing claude or fallback RouteRule!${NC}"
        exit 1
    fi
    if grep -q "<BasePath>/v1/embeddings</BasePath>" "$MVP_OUT/apiproxy/proxies/openai-embeddings.xml"; then
        echo -e "${GREEN}✓ openai-embeddings ProxyEndpoint (/v1/embeddings) verified.${NC}"
    else
        echo -e "${RED}✗ openai-embeddings ProxyEndpoint missing /v1/embeddings BasePath!${NC}"
        exit 1
    fi
else
    echo -e "${RED}✗ Expected 5 ProxyEndpoints, found $PROXY_COUNT${NC}"
    exit 1
fi

# Check TargetEndpoints (5 expected)
TARGET_COUNT=$(find "$MVP_OUT/apiproxy/targets" -name "*.xml" | wc -l | tr -d ' ')
if [ "$TARGET_COUNT" -eq 5 ]; then
    echo -e "${GREEN}✓ TargetEndpoints (5/5): claude, gemini, gemini-native-target, gemini-openai-compat, openai-custom${NC}"
else
    echo -e "${RED}✗ Expected 5 TargetEndpoints, found $TARGET_COUNT${NC}"
    exit 1
fi

# Check Policies (57 expected in default rendered bundle; MLC-EnforceMonetizationLimits is opt-in)
POLICY_COUNT=$(find "$MVP_OUT/apiproxy/policies" -name "*.xml" | wc -l | tr -d ' ')
EXPECTED_POLICY_COUNT=57
if [ "$POLICY_COUNT" -eq "$EXPECTED_POLICY_COUNT" ]; then
    echo -e "${GREEN}✓ Policies ($POLICY_COUNT/$EXPECTED_POLICY_COUNT default policies rendered from templates/ai-gateway/policies/)${NC}"
else
    echo -e "${RED}✗ Policy count mismatch in rendered MVP: expected $EXPECTED_POLICY_COUNT, found $POLICY_COUNT!${NC}"
    exit 1
fi

for dc_policy in "$MVP_OUT/apiproxy/policies/DC-CaptureTokenCountsNonStreaming.xml" "$MVP_OUT/apiproxy/policies/DC-CaptureTokenCountsStreaming.xml"; do
    for dc_col in \
        dc_prompt_token_count dc_uncached_prompt_token_count dc_cache_read_token_count dc_cache_write_token_count \
        dc_thinking_token_count dc_completion_token_count dc_total_token_count \
        dc_tx_uncached_prompt_cost_usd dc_tx_cache_read_cost_usd dc_tx_cache_write_cost_usd \
        dc_tx_prompt_cost_usd dc_tx_completion_cost_usd dc_tx_cost_usd \
        dc_model dc_requested_model dc_identity_user_id dc_identity_persona dc_identity_team; do
        if ! grep -q "<DataCollector>$dc_col</DataCollector>" "$dc_policy"; then
            echo -e "${RED}✗ Missing DataCollector '$dc_col' in $(basename "$dc_policy")!${NC}"
            exit 1
        fi
    done
done
echo -e "${GREEN}✓ DataCapture Policies: All 18 granular token-type count, per-type USD cost, and identity DataCollectors verified.${NC}"

# Check Resources (Java Callout JAR, EventFlow JavaScript & PropertySets)
JAVA_COUNT=$(find "$MVP_OUT/apiproxy/resources/java" -name "*.jar" | wc -l | tr -d ' ')
JS_COUNT=$(find "$MVP_OUT/apiproxy/resources/jsc" -name "*.js" | wc -l | tr -d ' ')
PROP_COUNT=$(find "$MVP_OUT/apiproxy/resources/properties" -name "*.properties" | wc -l | tr -d ' ')
if [ "$JAVA_COUNT" -ne 1 ] || [ "$JS_COUNT" -ne 1 ]; then
    echo -e "${RED}✗ Expected 1 Java Callout JAR and 1 EventFlow JS resource, found $JAVA_COUNT JAR(s) and $JS_COUNT JS file(s)!${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Resources: $JAVA_COUNT Java Callout JAR (ai-gateway-callouts.jar), $JS_COUNT EventFlow JS callout (combine_resp.js), and $PROP_COUNT PropertySets verified.${NC}"

# 4. Verify Generated PropertySets Content
echo -e "\n${YELLOW}Step 4: Validating Dynamic PropertySets Content...${NC}"
MODEL_LOC_FILE="$MVP_OUT/apiproxy/resources/properties/model_locations.properties"
MONET_FILE="$MVP_OUT/apiproxy/resources/properties/monetization_rates.properties"

if grep -q "models.catalog=gemini-4-hydrogen,gemini-4-argon,gemini-3.5-flash-lite,claude-opus-5-5,claude-sonnet-5-5,claude-haiku-5-5,gemini-embedding-001" "$MODEL_LOC_FILE"; then
    echo -e "${GREEN}✓ model_locations.properties: Dynamic models catalog (Gemini 4, Gemini 3.5 Flash-Lite, Claude 5.5, and gemini-embedding-001) generated correctly.${NC}"
else
    echo -e "${RED}✗ model_locations.properties missing or incomplete models.catalog!${NC}"
    exit 1
fi

if grep -q "tier.low=gemini-3.5-flash-lite" "$MODEL_LOC_FILE" && \
   grep -q "tier.high=gemini-4-argon" "$MODEL_LOC_FILE" && \
   grep -q "tier.max=claude-opus-5-5" "$MODEL_LOC_FILE" && \
   grep -q "alias.gemini-3.5-flash=gemini-4-hydrogen" "$MODEL_LOC_FILE" && \
   grep -q "alias.claude-sonnet-4-6=claude-sonnet-5-5" "$MODEL_LOC_FILE" && \
   grep -q "alias.text-embedding-005=gemini-embedding-001" "$MODEL_LOC_FILE" && \
   grep -Fq 'alias.auto\:judge=' "$MODEL_LOC_FILE"; then
    echo -e "${GREEN}✓ model_locations.properties: Smart Router tiers, backward-compatible aliases, and escaped alias.auto\:judge mapped correctly.${NC}"
else
    echo -e "${RED}✗ model_locations.properties Smart Router tier / alias check failed!${NC}"
    exit 1
fi

if grep -q "gemini-4-hydrogen.input_rate_per_m=1.5" "$MONET_FILE" && \
   grep -q "gemini-4-hydrogen.output_rate_per_m=7.5" "$MONET_FILE" && \
   grep -q "gemini-4-hydrogen.cache_read_rate_per_m=0.15" "$MONET_FILE" && \
   grep -q "claude-opus-5-5.output_rate_per_m=20" "$MONET_FILE" && \
   grep -q "claude-haiku-5-5.output_rate_per_m=0.5" "$MONET_FILE" && \
   grep -q "claude-haiku-5-5.cache_read_rate_per_m=0.01" "$MONET_FILE" && \
   grep -q "claude-haiku-5-5.cache_write_rate_per_m=0.125" "$MONET_FILE"; then
    echo -e "${GREEN}✓ monetization_rates.properties: Invoice-accurate pricing matrix (input, output, cache_read, cache_write) generated correctly.${NC}"
else
    echo -e "${RED}✗ monetization_rates.properties pricing generation failed!${NC}"
    exit 1
fi

if grep -q "^stream_prompt_checkpoint=false$" "$MVP_OUT/apiproxy/resources/properties/config.properties"; then
    echo -e "${GREEN}✓ config.properties: stream_prompt_checkpoint defaults safely to false.${NC}"
else
    echo -e "${RED}✗ config.properties missing stream_prompt_checkpoint=false default!${NC}"
    exit 1
fi

# 5. Test Minimal Quickstart Template Rendering
echo -e "\n${YELLOW}Step 5: Testing Minimal Quickstart Template (20 lines)...${NC}"
QUICK_OUT="$TMP_DIR/quickstart_bundle"
$APIGEE_GEN render apiproxy \
    --template "$REPO_ROOT/templates/ai-gateway/apiproxy.yaml" \
    --values "$REPO_ROOT/templates/ai-gateway/values.quickstart.yaml" \
    --output "$QUICK_OUT" \
    --validate=true

if [ -d "$QUICK_OUT/apiproxy" ]; then
    QUICK_LOC="$QUICK_OUT/apiproxy/resources/properties/model_locations.properties"
    if grep -q "tier.low=claude-haiku-5-5" "$QUICK_LOC" && \
       grep -q "tier.medium=gemini-4-hydrogen" "$QUICK_LOC" && \
       grep -q "tier.high=gemini-4-hydrogen" "$QUICK_LOC" && \
       grep -q "tier.max=gemini-4-hydrogen" "$QUICK_LOC"; then
        echo -e "${GREEN}✓ Quickstart Template rendered cleanly with catalog-safe tier fallbacks.${NC}"
    else
        echo -e "${RED}✗ Quickstart Template emitted out-of-catalog tier defaults!${NC}"
        cat "$QUICK_LOC"
        exit 1
    fi
fi

cat << 'CUSTOM_CAT_EOF' > "$TMP_DIR/custom_regional_catalog.yaml"
gateway:
  name: "ai-gateway"
  project_id: "apigee-east"
models:
  - name: "gemini-3.5-flash-lite"
    publisher: "google"
    target: "gemini"
    format: "gemini"
    region: "us-east4"
    is_default: false
  - name: "gemini-3.8-flash"
    publisher: "google"
    target: "gemini"
    format: "gemini"
    region: "us-east4"
    is_default: true
  - name: "gemini-4-argon"
    publisher: "google"
    target: "gemini"
    format: "gemini"
    region: "us-east4"
    is_default: false
CUSTOM_CAT_EOF
CUSTOM_CAT_OUT="$TMP_DIR/custom_regional_bundle"
$APIGEE_GEN render apiproxy \
    --template "$REPO_ROOT/templates/ai-gateway/apiproxy.yaml" \
    --values "$TMP_DIR/custom_regional_catalog.yaml" \
    --output "$CUSTOM_CAT_OUT" \
    --validate=true
CUSTOM_CAT_LOC="$CUSTOM_CAT_OUT/apiproxy/resources/properties/model_locations.properties"
if grep -q "default.model=gemini-3.8-flash" "$CUSTOM_CAT_LOC" && \
   grep -q "default.fallback=gemini-3.5-flash-lite" "$CUSTOM_CAT_LOC" && \
   grep -q "tier.low=gemini-3.5-flash-lite" "$CUSTOM_CAT_LOC" && \
   grep -q "tier.medium=gemini-3.8-flash" "$CUSTOM_CAT_LOC" && \
   grep -q "tier.high=gemini-4-argon" "$CUSTOM_CAT_LOC" && \
   grep -q "tier.max=gemini-4-argon" "$CUSTOM_CAT_LOC" && \
   grep -q "judge.model=gemini-3.5-flash-lite" "$CUSTOM_CAT_LOC" && \
   grep -q "judge.location=us-east4" "$CUSTOM_CAT_LOC" && \
   ! grep -q "=gemini-3.5-flash$" "$CUSTOM_CAT_LOC"; then
    echo -e "${GREEN}✓ Custom 3-model regional catalog inferred in-catalog tiers, default.model (is_default), and regional judge.location cleanly.${NC}"
else
    echo -e "${RED}✗ Custom 3-model regional catalog failed tier/judge inference!${NC}"
    cat "$CUSTOM_CAT_LOC"
    exit 1
fi


# 6. Test Feature Toggle Omission
echo -e "\n${YELLOW}Step 6: Testing Feature Toggles (Monetization & Armor Disabled)...${NC}"
cat << 'TOGGLE_EOF' > "$TMP_DIR/test_toggles.yaml"
gateway:
  name: "ai-gateway-minimal"
  project_id: "test-project"

features:
  monetization:
    enabled: false
  model_armor:
    enabled: false
  llm_judge:
    enabled: false
  quotas:
    enabled: false
  auth:
    enabled: true

endpoints:
  claude:
    enabled: true
  gemini_native:
    enabled: true
  openai_compat:
    enabled: true
  models_catalog:
    enabled: true
TOGGLE_EOF

TOGGLE_OUT="$TMP_DIR/test_toggles_bundle"
$APIGEE_GEN render apiproxy \
    --template "$REPO_ROOT/templates/ai-gateway/apiproxy.yaml" \
    --values "$TMP_DIR/test_toggles.yaml" \
    --output "$TOGGLE_OUT" \
    --validate=true

if grep -q 'default="1.0"' "$MVP_OUT/apiproxy/policies/DC-CaptureTokenCountsNonStreaming.xml" || \
   grep -q 'default="1.0"' "$MVP_OUT/apiproxy/policies/DC-CaptureTokenCountsStreaming.xml" || \
   ! grep -q 'default="0.0"' "$MVP_OUT/apiproxy/policies/DC-CaptureTokenCountsNonStreaming.xml"; then
    echo -e "${RED}✗ DC-CaptureTokenCounts*.xml must default perUnitPriceMultiplier to 0.0 (never 1.0)!${NC}"
    exit 1
fi

if grep -q "MLC-EnforceMonetizationLimits" "$TOGGLE_OUT/apiproxy/proxies/claude-messages.xml" || \
   grep -q "perUnitPriceMultiplier" "$TOGGLE_OUT/apiproxy/policies/DC-CaptureTokenCountsNonStreaming.xml" || \
   grep -q "perUnitPriceMultiplier" "$TOGGLE_OUT/apiproxy/policies/DC-CaptureTokenCountsStreaming.xml"; then
    echo -e "${RED}✗ Monetization was disabled but MLC or monetization DataCapture blocks were still included!${NC}"
    exit 1
else
    echo -e "${GREEN}✓ Monetization feature toggle verified (MLC step and monetization DataCapture blocks cleanly omitted).${NC}"
fi

if grep -q "SUP-SanitizeUserPrompt" "$TOGGLE_OUT/apiproxy/proxies/claude-messages.xml"; then
    echo -e "${RED}✗ Model Armor was disabled but SUP policy was still included in proxy flow!${NC}"
    exit 1
else
    echo -e "${GREEN}✓ Model Armor feature toggle verified (SUP step cleanly omitted).${NC}"
fi

# Verify default values.yaml is safe on fresh Apigee orgs (omits MLC-EnforceMonetizationLimits, SUP-SanitizeUserPrompt, LTQ-Secondary*, SA-BurstRateLimit, PTL-PromptTokenLimit, Q-ConcurrencyLimit)
if [ -f "$MVP_OUT/apiproxy/policies/MLC-EnforceMonetizationLimits.xml" ] || \
   grep -q "SUP-SanitizeUserPrompt" "$MVP_OUT/apiproxy/proxies/claude-messages.xml" || \
   [ -f "$MVP_OUT/apiproxy/policies/LTQ-SecondaryEnforceOnly.xml" ] || \
   [ -f "$MVP_OUT/apiproxy/policies/SA-BurstRateLimit.xml" ] || \
   [ -f "$MVP_OUT/apiproxy/policies/PTL-PromptTokenLimit.xml" ] || \
   [ -f "$MVP_OUT/apiproxy/policies/Q-ConcurrencyLimit.xml" ] || \
   [ -f "$MVP_OUT/apiproxy/policies/RQ-ReleaseConcurrencySlot.xml" ] || \
   ! grep -q "<Synchronous>true</Synchronous>" "$MVP_OUT/apiproxy/policies/LTQ-EnforceOnly.xml"; then
    echo -e "${RED}✗ Default values.yaml should NOT include opt-in MLC, SUP-SanitizeUserPrompt, LTQ-Secondary*, SA-BurstRateLimit, PTL-PromptTokenLimit, or Q-ConcurrencyLimit, and must default LTQ Synchronous=true!${NC}"
    exit 1
else
    echo -e "${GREEN}✓ Default values.yaml is safe on fresh Apigee orgs (omits opt-in MLC, Model Armor, secondary quota, burst, prompt_tokens, and concurrency steps; preserves Synchronous=true).${NC}"
fi

# Verify creative_writing and extraction tasks rendered in model_locations.properties
if grep -q "task.creative_writing=claude-sonnet-5-5" "$MVP_OUT/apiproxy/resources/properties/model_locations.properties" && \
   grep -q "task.extraction=gemini-3.5-flash-lite" "$MVP_OUT/apiproxy/resources/properties/model_locations.properties"; then
    echo -e "${GREEN}✓ routing.tasks.creative_writing and routing.tasks.extraction rendered properly.${NC}"
else
    echo -e "${RED}✗ routing.tasks.creative_writing or routing.tasks.extraction missing in model_locations.properties!${NC}"
    exit 1
fi

# Verify DefaultFaultRule AlwaysEnforce=true + sanitized_error_applied guard across all 5 ProxyEndpoints & 5 TargetEndpoints, and default sanitize_upstream_errors=false
for ep_xml in "$MVP_OUT"/apiproxy/proxies/*.xml "$MVP_OUT"/apiproxy/targets/*.xml; do
    if ! awk '/<DefaultFaultRule/,/<\/DefaultFaultRule>/' "$ep_xml" | grep -q "<AlwaysEnforce>true</AlwaysEnforce>" || \
       ! awk '/<DefaultFaultRule/,/<\/DefaultFaultRule>/' "$ep_xml" | grep -Fq 'sanitized_error_applied != "true"'; then
        echo -e "${RED}✗ $(basename "$ep_xml") DefaultFaultRule missing <AlwaysEnforce>true</AlwaysEnforce> or sanitized_error_applied guard!${NC}"
        exit 1
    fi
done
if ! grep -q "sanitize_upstream_errors=false" "$MVP_OUT/apiproxy/resources/properties/config.properties"; then
    echo -e "${RED}✗ Expected sanitize_upstream_errors=false by default in config.properties!${NC}"
    exit 1
fi
echo -e "${GREEN}✓ DefaultFaultRule <AlwaysEnforce>true</AlwaysEnforce> + sanitized_error_applied guard verified across all 10 endpoints (sanitize_upstream_errors=false default).${NC}"

SECONDARY_OUT="$TMP_DIR/secondary_quota_bundle"
$APIGEE_GEN render apiproxy \
    --template "$REPO_ROOT/templates/ai-gateway/apiproxy.yaml" \
    --values "$REPO_ROOT/templates/ai-gateway/values.yaml" \
    --set "features.quotas.synchronous=false" \
    --set "features.quotas.preflight_prompt_guard=true" \
    --set "features.quotas.secondary_window.enabled=true" \
    --set "features.rate_limits.burst.enabled=true" \
    --set "features.rate_limits.prompt_tokens.enabled=true" \
    --set "features.rate_limits.concurrency.enabled=true" \
    --set "features.model_armor.enabled=true" \
    --set "features.monetization.enforce_apigee_wallet=true" \
    --set "features.security.sanitize_upstream_errors=true" \
    --output "$SECONDARY_OUT" \
    --validate=true

if [ -f "$SECONDARY_OUT/apiproxy/policies/MLC-EnforceMonetizationLimits.xml" ] && \
   [ -f "$SECONDARY_OUT/apiproxy/policies/LTQ-SecondaryEnforceOnly.xml" ] && \
   [ -f "$SECONDARY_OUT/apiproxy/policies/LTQ-SecondaryCountOnly.xml" ] && \
   [ -f "$SECONDARY_OUT/apiproxy/policies/SA-BurstRateLimit.xml" ] && \
   [ -f "$SECONDARY_OUT/apiproxy/policies/PTL-PromptTokenLimit.xml" ] && \
   [ -f "$SECONDARY_OUT/apiproxy/policies/Q-ConcurrencyLimit.xml" ] && \
   [ -f "$SECONDARY_OUT/apiproxy/policies/RQ-ReleaseConcurrencySlot.xml" ] && \
   grep -q "<Synchronous>false</Synchronous>" "$SECONDARY_OUT/apiproxy/policies/LTQ-EnforceOnly.xml" && \
   grep -q "<Synchronous>false</Synchronous>" "$SECONDARY_OUT/apiproxy/policies/LTQ-CountOnly.xml" && \
   grep -q "<Synchronous>true</Synchronous>" "$SECONDARY_OUT/apiproxy/policies/LTQ-SecondaryEnforceOnly.xml" && \
   grep -q "<Synchronous>true</Synchronous>" "$SECONDARY_OUT/apiproxy/policies/LTQ-SecondaryCountOnly.xml" && \
   grep -q "preflight_prompt_guard=true" "$SECONDARY_OUT/apiproxy/resources/properties/config.properties" && \
   grep -q "prompt_token_limit_enabled=true" "$SECONDARY_OUT/apiproxy/resources/properties/config.properties" && \
   grep -q "sanitize_upstream_errors=true" "$SECONDARY_OUT/apiproxy/resources/properties/config.properties" && \
   grep -q "MLC-EnforceMonetizationLimits" "$SECONDARY_OUT/apiproxy/proxies/claude-messages.xml" && \
   grep -q "SUP-SanitizeUserPrompt" "$SECONDARY_OUT/apiproxy/proxies/claude-messages.xml" && \
   grep -q "LTQ-SecondaryEnforceOnly" "$SECONDARY_OUT/apiproxy/proxies/claude-messages.xml" && \
   grep -q "<Name>SA-BurstRateLimit</Name>" "$SECONDARY_OUT/apiproxy/proxies/claude-messages.xml" && \
   grep -q "<Name>PTL-PromptTokenLimit</Name>" "$SECONDARY_OUT/apiproxy/proxies/claude-messages.xml" && \
   grep -q "<Name>Q-ConcurrencyLimit</Name>" "$SECONDARY_OUT/apiproxy/proxies/claude-messages.xml" && \
   grep -q "<Name>RQ-ReleaseConcurrencySlot</Name>" "$SECONDARY_OUT/apiproxy/targets/claude.xml" && \
   grep -q "LTQ-SecondaryCountOnly" "$SECONDARY_OUT/apiproxy/targets/claude.xml" && \
   grep -q "x-quota-secondary-available" "$SECONDARY_OUT/apiproxy/policies/AM-SetQuotaHeaders.xml" && \
   awk '/<PostFlow name="PostFlow">/,/<\/PostFlow>/' "$SECONDARY_OUT/apiproxy/proxies/claude-messages.xml" | grep -Fq "ratelimit.Q-ConcurrencyLimit.used.count != null"; then
    echo -e "${GREEN}✓ Opt-in enforce_apigee_wallet, Model Armor, secondary rolling-window quota (Synchronous=true), async individual quota (Synchronous=false), burst, prompt_tokens, preflight_prompt_guard, sanitize_upstream_errors, and PostFlow concurrency release verified.${NC}"
else
    echo -e "${RED}✗ Opt-in MLC, Model Armor, secondary quota, async individual quota, burst, prompt_tokens, sanitize_upstream_errors, or concurrency policies/steps failed to render when enabled!${NC}"
    exit 1
fi

# Verify Apigee X EventFlow 5-policy ceiling across all 5 TargetEndpoints when ALL features (including secondary_window & monetization) are enabled
for tgt_xml in "$SECONDARY_OUT"/apiproxy/targets/*.xml; do
    EF_STEPS=$(awk '/<EventFlow/,/<\/EventFlow>/' "$tgt_xml" | grep -c "<Step>" || true)
    if [ "$EF_STEPS" -gt 5 ]; then
        echo -e "${RED}✗ Target $(basename "$tgt_xml") EventFlow has $EF_STEPS steps (exceeds Apigee 5-policy EventFlow limit)!${NC}"
        exit 1
    fi
done
echo -e "${GREEN}✓ EventFlow 5-policy ceiling verified across all 5 TargetEndpoints ($EF_STEPS/5 steps with secondary_window + monetization + model_armor enabled).${NC}"

# Verify features.auth.apigee_oauth.enabled=false omits pre-import OA-VerifyAccessToken step cleanly
NO_OAUTH_OUT="$TMP_DIR/no_apigee_oauth_bundle"
$APIGEE_GEN render apiproxy \
    --template "$REPO_ROOT/templates/ai-gateway/apiproxy.yaml" \
    --values "$REPO_ROOT/templates/ai-gateway/values.yaml" \
    --set "features.auth.apigee_oauth.enabled=false" \
    --output "$NO_OAUTH_OUT" \
    --validate=true

OAUTH_STEP_COUNT=$(grep -c "<Name>OA-VerifyAccessToken</Name>" "$NO_OAUTH_OUT/apiproxy/proxies/claude-messages.xml" || true)
if [ "$OAUTH_STEP_COUNT" -eq 1 ] && ! grep -Fq 'oauthV2.OA-VerifyAccessToken.failed = "true"' "$NO_OAUTH_OUT/apiproxy/proxies/claude-messages.xml"; then
    echo -e "${GREEN}✓ features.auth.apigee_oauth.enabled=false cleanly omits pre-import OA-VerifyAccessToken step.${NC}"
else
    echo -e "${RED}✗ features.auth.apigee_oauth.enabled=false failed to omit pre-import OA-VerifyAccessToken (found $OAUTH_STEP_COUNT occurrences)!${NC}"
    exit 1
fi

# Verify opt-in features.streaming.dedicated_sse_targets=true splits 5 non-SSE + 5 *-sse TargetEndpoints cleanly
DED_SSE_OUT="$TMP_DIR/dedicated_sse_targets_bundle"
$APIGEE_GEN render apiproxy \
    --template "$REPO_ROOT/templates/ai-gateway/apiproxy.yaml" \
    --values "$REPO_ROOT/templates/ai-gateway/values.yaml" \
    --set "features.streaming.dedicated_sse_targets=true" \
    --output "$DED_SSE_OUT" \
    --validate=true

DED_SSE_TARGET_COUNT=$(ls -1 "$DED_SSE_OUT/apiproxy/targets/"*.xml | wc -l | tr -d ' ')
if [ "$DED_SSE_TARGET_COUNT" -eq 10 ] && \
   ! grep -q "<EventFlow" "$DED_SSE_OUT/apiproxy/targets/claude.xml" && \
   grep -q "<EventFlow" "$DED_SSE_OUT/apiproxy/targets/claude-sse.xml" && \
   ! grep -q "JS-anthropic-to-openai-resp" "$DED_SSE_OUT/apiproxy/targets/claude-sse.xml" && \
   grep -q "JS-anthropic-to-gemini" "$DED_SSE_OUT/apiproxy/targets/gemini-sse.xml" && \
   ! grep -q "JS-gemini-to-anthropic-resp" "$DED_SSE_OUT/apiproxy/targets/gemini-sse.xml" && \
   grep -q "<TargetEndpoint>claude-sse</TargetEndpoint>" "$DED_SSE_OUT/apiproxy/proxies/claude-messages.xml"; then
    echo -e "${GREEN}✓ features.streaming.dedicated_sse_targets=true rendered & validated 10 isolated non-SSE + *-sse TargetEndpoints.${NC}"
else
    echo -e "${RED}✗ features.streaming.dedicated_sse_targets=true failed TargetEndpoint isolation check (count=$DED_SSE_TARGET_COUNT)!${NC}"
    exit 1
fi

# Verify docs/template-guide/feature-flags.md Full Enterprise Governance YAML recipe renders & validates cleanly
python3 -c '
import re, pathlib
md = pathlib.Path("'"$REPO_ROOT"'/docs/template-guide/feature-flags.md").read_text()
m = re.search(r"=== \"Full Enterprise Governance\".*?```yaml\n(.*?)```", md, re.S)
assert m, "Could not locate Full Enterprise Governance YAML block in feature-flags.md"
lines = [l[4:] if l.startswith("    ") else l for l in m.group(1).splitlines()]
out = "gateway:\n  name: \"ai-gateway\"\n  project_id: \"doc-recipe-proj\"\n" + "\n".join(lines) + "\n"
pathlib.Path("'"$TMP_DIR"'/doc_enterprise_recipe.yaml").write_text(out)
'
DOC_RECIPE_OUT="$TMP_DIR/doc_enterprise_recipe_bundle"
$APIGEE_GEN render apiproxy \
    --template "$REPO_ROOT/templates/ai-gateway/apiproxy.yaml" \
    --values "$TMP_DIR/doc_enterprise_recipe.yaml" \
    --output "$DOC_RECIPE_OUT" \
    --validate=true
if grep -q "persona.lead-ai-engineer.match_claims=ai-gateway-leads,lead-\*" "$DOC_RECIPE_OUT/apiproxy/resources/properties/config.properties" && \
   grep -q "^stream_prompt_checkpoint=true$" "$DOC_RECIPE_OUT/apiproxy/resources/properties/config.properties" && \
   grep -q '<Audience ref="propertyset.config.auth_idp_jwt_audience"' "$DOC_RECIPE_OUT/apiproxy/policies/VJ-VerifyIdpJwt.xml"; then
    echo -e "${GREEN}✓ docs/template-guide/feature-flags.md Full Enterprise Governance YAML recipe rendered & schema-validated cleanly.${NC}"
else
    echo -e "${RED}✗ feature-flags.md Enterprise recipe failed persona, stream_prompt_checkpoint, or VJ-VerifyIdpJwt <Audience> check!${NC}"
    exit 1
fi

# Verify VJ-VerifyIdpJwt render-time hardening: rejects missing/wildcard audience and symmetric/none algorithms, accepts RS256,ES256,PS256 + multi-client audience
if $APIGEE_GEN render apiproxy \
    --template "$REPO_ROOT/templates/ai-gateway/apiproxy.yaml" \
    --values "$REPO_ROOT/templates/ai-gateway/values.yaml" \
    --set "features.auth.idp_jwt.enabled=true" \
    --set "features.auth.idp_jwt.audience=" \
    --output "$TMP_DIR/bad_jwt_no_aud" \
    --validate=true >/dev/null 2>&1; then
    echo -e "${RED}✗ idp_jwt.enabled=true with empty audience should have failed template rendering!${NC}"
    exit 1
fi

if $APIGEE_GEN render apiproxy \
    --template "$REPO_ROOT/templates/ai-gateway/apiproxy.yaml" \
    --values "$REPO_ROOT/templates/ai-gateway/values.yaml" \
    --set "features.auth.idp_jwt.algorithm=HS256" \
    --output "$TMP_DIR/bad_jwt_hs256" \
    --validate=true >/dev/null 2>&1; then
    echo -e "${RED}✗ idp_jwt.algorithm=HS256 should have failed template rendering!${NC}"
    exit 1
fi

if $APIGEE_GEN render apiproxy \
    --template "$REPO_ROOT/templates/ai-gateway/apiproxy.yaml" \
    --values "$REPO_ROOT/templates/ai-gateway/values.yaml" \
    --set "features.auth.idp_jwt.algorithm=RS256,ES256" \
    --output "$TMP_DIR/bad_jwt_mixed_family" \
    --validate=true >/dev/null 2>&1; then
    echo -e "${RED}✗ Mixing ES256 with RS256 should have failed template rendering!${NC}"
    exit 1
fi

ES_JWT_OUT="$TMP_DIR/es_jwt_bundle"
$APIGEE_GEN render apiproxy \
    --template "$REPO_ROOT/templates/ai-gateway/apiproxy.yaml" \
    --values "$REPO_ROOT/templates/ai-gateway/values.yaml" \
    --set "features.auth.idp_jwt.enabled=true" \
    --set "features.auth.idp_jwt.algorithm=ES256" \
    --set "features.auth.idp_jwt.audience=api://ai-gateway" \
    --output "$ES_JWT_OUT" \
    --validate=true

MULTI_JWT_OUT="$TMP_DIR/multi_jwt_bundle"
$APIGEE_GEN render apiproxy \
    --template "$REPO_ROOT/templates/ai-gateway/apiproxy.yaml" \
    --values "$REPO_ROOT/templates/ai-gateway/values.yaml" \
    --set "features.auth.idp_jwt.enabled=true" \
    --set "features.auth.idp_jwt.algorithm=RS256, PS256" \
    --set "features.auth.idp_jwt.audience=api://ai-gateway,cli-client-*" \
    --output "$MULTI_JWT_OUT" \
    --validate=true

if grep -q '<Algorithm>ES256</Algorithm>' "$ES_JWT_OUT/apiproxy/policies/VJ-VerifyIdpJwt.xml" && \
   grep -q '<Algorithm>RS256,PS256</Algorithm>' "$MULTI_JWT_OUT/apiproxy/policies/VJ-VerifyIdpJwt.xml" && \
   grep -q '<IgnoreUnresolvedVariables>false</IgnoreUnresolvedVariables>' "$MULTI_JWT_OUT/apiproxy/policies/VJ-VerifyIdpJwt.xml" && \
   grep -q 'continueOnError="false"' "$MULTI_JWT_OUT/apiproxy/policies/VJ-VerifyIdpJwt.xml" && \
   ! grep -q '<Audience' "$MULTI_JWT_OUT/apiproxy/policies/VJ-VerifyIdpJwt.xml"; then
    echo -e "${GREEN}✓ VJ-VerifyIdpJwt hardening verified (continueOnError=false, IgnoreUnresolvedVariables=false, asymmetric RSA/ECDSA family allowlist, mandatory Audience).${NC}"
else
    echo -e "${RED}✗ VJ-VerifyIdpJwt multi-algorithm / multi-audience rendering check failed!${NC}"
    exit 1
fi

# 7. Test Custom URL, Distinct Team Personas & Multi-Protocol Model
echo -e "\n${YELLOW}Step 7: Testing Custom Model URL, Distinct Team Personas & sync-personas.sh...${NC}"
cat << 'CUSTOM_EOF' > "$TMP_DIR/test_custom.yaml"
gateway:
  name: "ai-gateway-custom"
  project_id: "test-project"

features:
  auth:
    default_client_id: "shared-default-client-id"
    personas:
      knowledge-worker:
        display_name: "Knowledge Worker Tier"
        match_claims: ["knowledge-worker", "business"]
        models: ["gemini-3.1-flash-lite", "gemini-3.5-flash"]
        quota:
          limit: 50000
          interval: 4
          unit: "hour"
        team_budget:
          limit: 2000000
          interval: 7
          unit: "day"
        rate_limits:
          burst_rate: "60pm"
          concurrency_limit: 5
      developer:
        display_name: "Developer & Data Science Tier"
        match_claims: ["developer", "swe"]
        models: ["gemini-3.1-flash-lite", "gemini-3.5-flash", "claude-sonnet-4-6"]
        quota:
          limit: 250000
          interval: 4
          unit: "hour"
          per_model:
            claude-sonnet-4-6: 50000
        team_budget:
          limit: 10000000
          interval: 7
          unit: "day"
        model_armor:
          request_template: "gap_template"
          response_template: "ai-gw-template"
      developer_team_a:
        display_name: "Developer Team A Tier"
        match_claims: ["grp-eng-team-a", "developer_team_a"]
        models: ["gemini-3.5-flash", "claude-sonnet-4-6"]
        quota:
          limit_usd: 15.00
          interval: 1
          unit: "day"
        team_budget:
          limit_usd: 250.00
          interval: 7
          unit: "day"
      developer_team_b:
        display_name: "Developer Team B Tier"
        match_claims: ["grp-eng-team-b", "developer_team_b"]
        models: ["gemini-3.5-flash"]
        quota:
          limit_usd: 5.00
          interval: 1
          unit: "day"
        team_budget:
          limit_usd: 50.00
          interval: 7
          unit: "day"
      usd-developer:
        display_name: "Virtual USD Wallet Developer Tier"
        match_claims: ["usd-swe"]
        models: ["gemini-3.5-flash", "claude-sonnet-4-6"]
        quota:
          limit_usd: 15.00
          interval: 1
          unit: "day"
          per_model_usd:
            claude-sonnet-4-6: 5.00
        team_budget:
          limit_usd: 250.00
          interval: 30
          unit: "day"
      agent:
        match_claims: ["agent"]
        model_armor:
          request_template: "ai-gw-strict-template"
          response_template: "none"
    exceptions:
      - match: ["alice@company.com"]
        quota_limit: 500000
        expires_at: "2099-01-01T00:00:00Z"
        models: ["*"]
        burst_rate: "1200pm"
        concurrency_limit: 50
      - match: ["team:search-research"]
        team_budget_limit: 50000000
      - match: ["vip-usd@company.com"]
        quota_limit_usd: 50.00
        bypass_team_budget: true
        team_budget_limit_usd: 1000.00
        expires_at: "2099-01-01T00:00:00Z"
  model_armor:
    enabled: true
    location: "us-central1"
    template: "ai-gw-template"
    request_template: "ai-gw-template"
    response_template: "gap_template"
    identity_rules:
      - match: ["finance-*@my-project.iam.gserviceaccount.com", "team:pci-compliance"]
        request_template: "ai-gw-strict-template"
        response_template: "ai-gw-strict-template"
      - match: "principal://agents.global.org-123456789012.system.id.goog/*/reasoningEngines/deep-research-*"
        request_template: "gap_template"
        response_template: "none"

models:
  - name: "custom-vllm"
    displayName: "Llama 3 (vLLM)"
    format: "openai"
    custom_url: "https://vllm.internal.corp/v1/chat/completions"
    auth:
      type: "bearer"
      token_ref: "propertyset.config.vllm_token"
    model_armor:
      request_template: "ai-gw-strict-template"
      response_template: "gap_template"
  - name: "llama3.3:70b"
    displayName: "Llama 3.3 70B (Ollama)"
    format: "openai"
    custom_url: "https://ollama.internal.corp/v1/chat/completions"
    pricing:
      input_rate: 0.40
      output_rate: 0.80
CUSTOM_EOF

CUSTOM_OUT="$TMP_DIR/custom_bundle"
$APIGEE_GEN render apiproxy \
    --template "$REPO_ROOT/templates/ai-gateway/apiproxy.yaml" \
    --values "$TMP_DIR/test_custom.yaml" \
    --output "$CUSTOM_OUT" \
    --validate=true

CUSTOM_PROP="$CUSTOM_OUT/apiproxy/resources/properties/model_locations.properties"
CUSTOM_MONET_PROP="$CUSTOM_OUT/apiproxy/resources/properties/monetization_rates.properties"
CUSTOM_CFG_PROP="$CUSTOM_OUT/apiproxy/resources/properties/config.properties"
if grep -q "custom-vllm.url=https://vllm.internal.corp/v1/chat/completions" "$CUSTOM_PROP" && \
   grep -q "custom-vllm.format=openai" "$CUSTOM_PROP" && \
   grep -q "custom-vllm.auth_type=bearer" "$CUSTOM_PROP" && \
   grep -q "custom-vllm.model_armor_request_template=ai-gw-strict-template" "$CUSTOM_PROP" && \
   grep -q "custom-vllm.model_armor_response_template=gap_template" "$CUSTOM_PROP" && \
   grep -Fq 'llama3.3\:70b.url=https://ollama.internal.corp/v1/chat/completions' "$CUSTOM_PROP" && \
   grep -Fq 'llama3.3\:70b.input_rate_per_m=0.4' "$CUSTOM_MONET_PROP" && \
   grep -q "^auth_agent_allowed_email_suffix=@test-project.iam.gserviceaccount.com$" "$CUSTOM_CFG_PROP" && \
   grep -q "^auth_agent_allowed_trust_domain=$" "$CUSTOM_CFG_PROP" && \
   ! grep -q "^auth_idp_jwt_audience=" "$CUSTOM_CFG_PROP" && \
   grep -q "auth_default_client_id=shared-default-client-id" "$CUSTOM_CFG_PROP" && \
   grep -q "persona.knowledge-worker.client_id=shared-default-client-id" "$CUSTOM_CFG_PROP" && \
   grep -q "persona.knowledge-worker.models=gemini-3.1-flash-lite,gemini-3.5-flash" "$CUSTOM_CFG_PROP" && \
   grep -q "persona.knowledge-worker.quota_limit=50000" "$CUSTOM_CFG_PROP" && \
   grep -q "persona.knowledge-worker.team_quota_limit=2000000" "$CUSTOM_CFG_PROP" && \
   grep -q "persona.knowledge-worker.burst_rate=60pm" "$CUSTOM_CFG_PROP" && \
   grep -q "persona.knowledge-worker.concurrency_limit=5" "$CUSTOM_CFG_PROP" && \
   grep -q "persona.developer.model_quota.claude-sonnet-4-6=50000" "$CUSTOM_CFG_PROP" && \
   grep -q "persona.developer.per_model_quotas=claude-sonnet-4-6:50000" "$CUSTOM_CFG_PROP" && \
   grep -q "persona.developer_team_a.team_quota_limit=250000000" "$CUSTOM_CFG_PROP" && \
   grep -q "persona.developer_team_b.team_quota_limit=50000000" "$CUSTOM_CFG_PROP" && \
   grep -q "persona.usd-developer.quota_mode=usd" "$CUSTOM_CFG_PROP" && \
   grep -q "persona.usd-developer.quota_limit_usd=15" "$CUSTOM_CFG_PROP" && \
   grep -q "persona.usd-developer.quota_limit=15000000" "$CUSTOM_CFG_PROP" && \
   grep -q "persona.usd-developer.model_quota.claude-sonnet-4-6=5000000" "$CUSTOM_CFG_PROP" && \
   grep -q "persona.usd-developer.team_quota_mode=usd" "$CUSTOM_CFG_PROP" && \
   grep -q "persona.usd-developer.team_quota_limit_usd=250" "$CUSTOM_CFG_PROP" && \
   grep -q "persona.usd-developer.team_quota_limit=250000000" "$CUSTOM_CFG_PROP" && \
   grep -q "model_armor.persona.developer.request_template=gap_template" "$CUSTOM_CFG_PROP" && \
   grep -q "model_armor.persona.agent.response_template=none" "$CUSTOM_CFG_PROP" && \
   grep -q "model_armor.rule.0.match=alice@company.com" "$CUSTOM_CFG_PROP" && \
   grep -q "model_armor.rule.0.quota_limit=500000" "$CUSTOM_CFG_PROP" && \
   grep -q "model_armor.rule.0.models=\*" "$CUSTOM_CFG_PROP" && \
   grep -q "model_armor.rule.1.team_budget_limit=50000000" "$CUSTOM_CFG_PROP" && \
   grep -q "model_armor.rule.2.match=vip-usd@company.com" "$CUSTOM_CFG_PROP" && \
   grep -q "model_armor.rule.2.quota_mode=usd" "$CUSTOM_CFG_PROP" && \
   grep -q "model_armor.rule.2.quota_limit=50000000" "$CUSTOM_CFG_PROP" && \
   grep -q "model_armor.rule.2.bypass_team_budget=true" "$CUSTOM_CFG_PROP" && \
   grep -q "model_armor.rule.2.team_budget_mode=usd" "$CUSTOM_CFG_PROP" && \
   grep -q "model_armor.rule.2.team_budget_limit=1000000000" "$CUSTOM_CFG_PROP" && \
   grep -q "model_armor.rule.3.match=finance-\*@my-project.iam.gserviceaccount.com,team:pci-compliance" "$CUSTOM_CFG_PROP" && \
   grep -q "model_armor_identity_rules_count=5" "$CUSTOM_CFG_PROP"; then
    echo -e "${GREEN}✓ Custom model properties, distinct team personas, Virtual USD Spend Wallets, per-model quotas, and exception rules rendered properly.${NC}"
else
    echo -e "${RED}✗ Custom model, persona, or exception properties failed to render!${NC}"
    exit 1
fi

DRY_RUN_OUT=$(bash "$REPO_ROOT/scripts/sync-personas.sh" --bundle "$CUSTOM_OUT/apiproxy" --org "test-project" --env "qa" --dry-run)
if echo "$DRY_RUN_OUT" | grep -q "ai-gateway-custom-knowledge-worker" && \
   echo "$DRY_RUN_OUT" | grep -q "ai-gateway-custom-developer" && \
   echo "$DRY_RUN_OUT" | grep -q "ai-gateway-custom-developer_team_a" && \
   echo "$DRY_RUN_OUT" | grep -q "ai-gateway-custom-developer_team_b" && \
   echo "$DRY_RUN_OUT" | grep -q "ai-gateway-custom-usd-developer" && \
   echo "$DRY_RUN_OUT" | grep -q '"llmOperationGroup"' && \
   echo "$DRY_RUN_OUT" | grep -q '"llmTokenQuota"' && \
   echo "$DRY_RUN_OUT" | grep -q '"limit": "50000"' && \
   echo "$DRY_RUN_OUT" | grep -q '"limit": "250000"' && \
   echo "$DRY_RUN_OUT" | grep -q '"limit": "15000000"' && \
   echo "$DRY_RUN_OUT" | grep -q '"limit": "5000000"' && \
   echo "$DRY_RUN_OUT" | grep -q '"name": "quota_mode"' && \
   echo "$DRY_RUN_OUT" | grep -q '"name": "team_quota_mode"' && \
   echo "$DRY_RUN_OUT" | grep -q '"value": "usd"' && \
   echo "$DRY_RUN_OUT" | grep -q '"model": "claude-sonnet-4-6"' && \
   echo "$DRY_RUN_OUT" | grep -q '"value": "gemini-3.1-flash-lite,gemini-3.5-flash"'; then
    echo -e "${GREEN}✓ Safe upsert script (scripts/sync-personas.sh --dry-run) with distinct team personas, llmOperationGroup, and micro-USD limits verified.${NC}"
else
    echo -e "${RED}✗ scripts/sync-personas.sh --dry-run output validation failed!${NC}"
    exit 1
fi

cat << 'ZERO_PARTIAL_EOF' > "$TMP_DIR/test_zero_partial.yaml"
gateway:
  name: "ai-gateway-zero"
  project_id: "test-project"
features:
  quotas:
    enabled: true
    default_quota: 0
    secondary_window:
      enabled: true
      allow_usd: 0
personas:
  suspended:
    quota:
      limit_usd: 0
    team_budget:
      limit: 0
  mixed-colon:
    quota:
      limit: 50000
      per_model_usd:
        "llama3.3:70b": "$10.00"
      per_model:
        "gemini-2.5-flash": 25000
exceptions:
  - match: "blocked@company.com"
    quota_limit: 0
    team_budget_limit_usd: 0
models:
  - name: "partial-priced-model"
    publisher: "google"
    location: "us-central1"
    pricing:
      input_rate: "$15.00"
  - name: "text-embedding-005"
    publisher: "google"
    location: "us-central1"
    pricing:
      input_rate: 0.025
      output_rate: 0.000
  - name: "llama3.3:70b"
    format: "openai"
    custom_url: "https://ollama.internal.corp/v1/chat/completions"
ZERO_PARTIAL_EOF

ZERO_OUT="$TMP_DIR/zero_partial_bundle"
$APIGEE_GEN render apiproxy \
    --template "$REPO_ROOT/templates/ai-gateway/apiproxy.yaml" \
    --values "$TMP_DIR/test_zero_partial.yaml" \
    --output "$ZERO_OUT" \
    --validate=true

ZERO_MONET="$ZERO_OUT/apiproxy/resources/properties/monetization_rates.properties"
ZERO_CFG="$ZERO_OUT/apiproxy/resources/properties/config.properties"
ZERO_SYNC=$(bash "$REPO_ROOT/scripts/sync-personas.sh" --bundle "$ZERO_OUT/apiproxy" --org "test-project" --env "qa" --dry-run)
if grep -q "^partial-priced-model.input_rate_per_m=15.00$" "$ZERO_MONET" && \
   ! grep -q "^partial-priced-model.output_rate" "$ZERO_MONET" && \
   grep -q "^text-embedding-005.output_rate_per_m=0$" "$ZERO_MONET" && \
   grep -q "^default_quota=0$" "$ZERO_CFG" && \
   grep -q "^secondary_quota_enabled=true$" "$ZERO_CFG" && \
   grep -q "^secondary_default_quota=0$" "$ZERO_CFG" && \
   grep -q "^persona.suspended.quota_mode=usd$" "$ZERO_CFG" && \
   grep -q "^persona.suspended.quota_limit_usd=0$" "$ZERO_CFG" && \
   grep -q "^persona.suspended.quota_limit=0$" "$ZERO_CFG" && \
   grep -q "^persona.suspended.team_quota_limit=0$" "$ZERO_CFG" && \
   grep -Fq 'persona.mixed-colon.model_quota_usd.llama3.3\:70b=10.00' "$ZERO_CFG" && \
   grep -Fq 'persona.mixed-colon.model_quota.llama3.3\:70b=10000000' "$ZERO_CFG" && \
   grep -q "^persona.mixed-colon.model_quota.gemini-2.5-flash=25000$" "$ZERO_CFG" && \
   grep -q "^model_armor.rule.0.quota_limit=0$" "$ZERO_CFG" && \
   grep -q "^model_armor.rule.0.team_budget_limit=0$" "$ZERO_CFG" && \
   grep -q '<Allow count="1" countRef="primary_quota_limit"/>' "$ZERO_OUT/apiproxy/policies/LTQ-EnforceOnly.xml" && \
   grep -q '<Allow count="1" countRef="secondary_quota_limit"/>' "$ZERO_OUT/apiproxy/policies/LTQ-SecondaryEnforceOnly.xml" && \
   echo "$ZERO_SYNC" | grep -q '"model": "llama3.3:70b"' && \
   echo "$ZERO_SYNC" | grep -q '"limit": "10000000"' && \
   echo "$ZERO_SYNC" | grep -q '"limit": "1"'; then
    echo -e "${GREEN}✓ Explicit limit: 0 / limit_usd: 0, partial pricing (omitted output_rate), \$-prefixed USD, and colon-escaped per_model_usd verified.${NC}"
else
    echo -e "${RED}✗ Explicit zero quota, partial pricing, or colon-escaped per_model_usd rendering failed!${NC}"
    exit 1
fi

# Verify Multi-Project Vertex AI Routing properties (Persona + Model + Pin + Exception + has_project_overrides)
cat << 'MULTIPROJ_EOF' > "$TMP_DIR/test_multiproject.yaml"
gateway:
  name: "ai-gateway-hub"
  project_id: "apigee-hub-prod"
personas:
  marketing-ai:
    project_id: "mktg-vertex-prod"
exceptions:
  - match: "alice@company.com"
    project_id: "alice-sandbox-proj"
models:
  - name: "gemini-3.5-flash"
    publisher: "google"
    project_id: "shared-model-proj"
  - name: "medlm-large"
    publisher: "google"
    project_id: "clinical-ml-prod"
    pin_project: true
MULTIPROJ_EOF

MULTIPROJ_OUT="$TMP_DIR/multiproject_bundle"
$APIGEE_GEN render apiproxy \
    --template "$REPO_ROOT/templates/ai-gateway/apiproxy.yaml" \
    --values "$TMP_DIR/test_multiproject.yaml" \
    --output "$MULTIPROJ_OUT" \
    --validate=true

MP_CFG="$MULTIPROJ_OUT/apiproxy/resources/properties/config.properties"
MP_LOC="$MULTIPROJ_OUT/apiproxy/resources/properties/model_locations.properties"
if grep -q "^has_project_overrides=false$" "$MVP_OUT/apiproxy/resources/properties/config.properties" && \
   grep -q "^has_project_overrides=true$" "$MP_CFG" && \
   grep -q "^persona\.marketing-ai\.project_id=mktg-vertex-prod$" "$MP_CFG" && \
   grep -q "^model_armor\.rule\.0\.project_id=alice-sandbox-proj$" "$MP_CFG" && \
   grep -q "^gemini-3\.5-flash\.project_id=shared-model-proj$" "$MP_LOC" && \
   grep -q "^medlm-large\.project_id=clinical-ml-prod$" "$MP_LOC" && \
   grep -q "^medlm-large\.pin_project=true$" "$MP_LOC" && \
   grep -q "{vertex_project_id}" "$MULTIPROJ_OUT/apiproxy/targets/claude.xml" && \
   grep -q "{vertex_project_id}" "$MULTIPROJ_OUT/apiproxy/targets/gemini.xml" && \
   grep -q "{vertex_project_id}" "$MULTIPROJ_OUT/apiproxy/targets/gemini-openai-compat.xml" && \
   grep -q "{gcp_project_id}" "$MULTIPROJ_OUT/apiproxy/policies/SC-LLMJudge.xml"; then
    echo -e "${GREEN}✓ Multi-project Vertex AI routing (persona/model/exception project_id, pin_project, has_project_overrides, and {vertex_project_id} targets) verified.${NC}"
else
    echo -e "${RED}✗ Multi-project Vertex AI routing template rendering failed!${NC}"
    exit 1
fi

EXISTING_PRODS_DIR="$TMP_DIR/existing_products"
mkdir -p "$EXISTING_PRODS_DIR"
cat << 'EXIST_PROD_EOF' > "$EXISTING_PRODS_DIR/ai-gateway-custom-developer.json"
{
  "name": "ai-gateway-custom-developer",
  "displayName": "Old Display Name",
  "description": "Enterprise shared developer product",
  "approvalType": "manual",
  "environments": ["dev", "qa"],
  "operationGroup": {
    "operationConfigs": [
      {
        "apiSource": "mcp-tools-proxy",
        "operations": [{"resource": "/**", "methods": ["GET", "POST"]}]
      }
    ]
  },
  "llmOperationGroup": {
    "operationConfigs": [
      {
        "apiSource": "secondary-llm-gw",
        "llmOperations": [{"resource": "/", "model": "custom-rag-model"}],
        "llmTokenQuota": {"limit": "999999", "interval": "1", "timeUnit": "day"}
      },
      {
        "apiSource": "ai-gateway-custom",
        "llmOperations": [{"resource": "/", "model": "obsolete-model-v0"}],
        "llmTokenQuota": {"limit": "10", "interval": "1", "timeUnit": "hour"}
      }
    ]
  },
  "attributes": [
    {"name": "access", "value": "private"},
    {"name": "openai_api_key_ref", "value": "propertyset.provider_keys.team_openai"},
    {"name": "cost_center", "value": "CC-4242"},
    {"name": "burst_rate", "value": "9999pm"}
  ],
  "createdAt": "1700000000000",
  "lastModifiedAt": "1700000000000"
}
EXIST_PROD_EOF

cat << 'EXIST_AGENT_PROD_EOF' > "$EXISTING_PRODS_DIR/ai-gateway-custom-agent.json"
{
  "name": "ai-gateway-custom-agent",
  "displayName": "Existing Shared Agent Product",
  "environments": ["qa"],
  "proxies": ["legacy-rest-v1"],
  "apiResources": ["/legacy/**"],
  "quota": "7777",
  "quotaInterval": "5",
  "quotaTimeUnit": "minute",
  "quotaCounterScope": "PROXY"
}
EXIST_AGENT_PROD_EOF

MERGE_DRY_OUT=$(bash "$REPO_ROOT/scripts/sync-personas.sh" \
    --bundle "$CUSTOM_OUT/apiproxy" \
    --org "test-project" \
    --env "prod" \
    --existing-products-dir "$EXISTING_PRODS_DIR" \
    --dry-run)

if echo "$MERGE_DRY_OUT" | grep -q '"description": "Enterprise shared developer product"' && \
   echo "$MERGE_DRY_OUT" | grep -q '"approvalType": "manual"' && \
   echo "$MERGE_DRY_OUT" | grep -q '"mcp-tools-proxy"' && \
   echo "$MERGE_DRY_OUT" | grep -q '"secondary-llm-gw"' && \
   echo "$MERGE_DRY_OUT" | grep -q '"custom-rag-model"' && \
   echo "$MERGE_DRY_OUT" | grep -q '"model": "shared_wallet"' && \
   echo "$MERGE_DRY_OUT" | grep -q '"quota": "7777"' && \
   echo "$MERGE_DRY_OUT" | grep -q '"value": "private"' && \
   echo "$MERGE_DRY_OUT" | grep -q '"name": "openai_api_key_ref"' && \
   echo "$MERGE_DRY_OUT" | grep -q '"value": "CC-4242"' && \
   echo "$MERGE_DRY_OUT" | grep -q '"dev"' && \
   echo "$MERGE_DRY_OUT" | grep -q '"qa"' && \
   echo "$MERGE_DRY_OUT" | grep -q '"prod"' && \
   ! echo "$MERGE_DRY_OUT" | grep -q '"legacy-rest-v1"' && \
   ! echo "$MERGE_DRY_OUT" | grep -q '"/legacy/\*\*"' && \
   ! echo "$MERGE_DRY_OUT" | grep -q '"obsolete-model-v0"' && \
   ! echo "$MERGE_DRY_OUT" | grep -q '"9999pm"' && \
   ! echo "$MERGE_DRY_OUT" | grep -q '"createdAt"'; then
    echo -e "${GREEN}✓ Non-destructive API Product merge verified (preserved environments dev/qa+prod, unmanaged top-level quota*, REST & external LLM ops, shared_wallet op, manual approval, and custom attributes while stripping legacy proxies/apiResources & stale managed keys).${NC}"
else
    echo -e "${RED}✗ Non-destructive API Product merge validation failed!${NC}"
    echo "$MERGE_DRY_OUT"
    exit 1
fi

# 7b. Live-mode REST state-machine & credential edge-case verification via local mock Apigee API server
MOCK_API_SCRIPT="$TMP_DIR/mock_apigee_api.py"
MOCK_API_STATE="$TMP_DIR/mock_apigee_state.json"
MOCK_PORT_FILE="$TMP_DIR/mock_apigee_port.txt"

cat << 'MOCK_PY_EOF' > "$MOCK_API_SCRIPT"
import http.server
import json
import os
import sys
import urllib.parse

state_file = sys.argv[1]
port_file = sys.argv[2]
mode = sys.argv[3]  # "matrix" | "forbid_product_get" | "fail_key_bind" | "token_refresh"

state = {
    "dev_get_calls": 0,
    "kw_prod_get_calls": 0,
    "saw_401_refresh": False,
    "saw_fresh_token": False,
    "calls": [],
    "merged_kw_custom_attr": None,
}

def save_state():
    with open(state_file, "w", encoding="utf-8") as fh:
        json.dump(state, fh)

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        return

    def _send(self, code, obj=None):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        if obj is not None:
            self.wfile.write(json.dumps(obj).encode("utf-8"))

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        p = parsed.path
        auth_hdr = self.headers.get("Authorization", "")
        state["calls"].append(f"GET {p}")
        if mode == "token_refresh":
            if auth_hdr == "Bearer expired-tok-001":
                state["saw_401_refresh"] = True
                save_state()
                return self._send(401, {"error": "UNAUTHENTICATED"})
            if auth_hdr == "Bearer fresh-tok-002":
                state["saw_fresh_token"] = True
        save_state()

        if "/developers/" in p and "/apps/" not in p:
            state["dev_get_calls"] += 1
            save_state()
            if mode == "matrix" and state["dev_get_calls"] == 1:
                return self._send(503, {"error": "transient unavailable"})
            return self._send(200, {"email": "ai-gateway-personas@test-project.iam.gserviceaccount.com"})

        if "/apiproducts/" in p:
            if mode == "forbid_product_get":
                return self._send(403, {"error": "permission denied", "consumerSecret": "TOP-SECRET-DO-NOT-PRINT"})
            prod = p.rsplit("/", 1)[-1]
            if prod == "ai-gateway-custom-knowledge-worker":
                state["kw_prod_get_calls"] += 1
                save_state()
                if mode == "matrix" and state["kw_prod_get_calls"] == 1:
                    return self._send(429, {"error": "rate limited"})
                return self._send(200, {
                    "name": prod,
                    "displayName": "KW Existing",
                    "environments": ["qa"],
                    "attributes": [{"name": "unmanaged_keep", "value": "preserved-across-429"}],
                })
            return self._send(404, {"error": "not found"})

        if "/apps/" in p:
            app = p.rsplit("/", 1)[-1]
            if mode == "fail_key_bind":
                return self._send(200, {
                    "name": app,
                    "status": "approved",
                    "credentials": [{
                        "consumerKey": "bind-fail-key-99999999",
                        "consumerSecret": "SECRET-999",
                        "status": "approved",
                        "expiresAt": "-1",
                        "apiProducts": [],
                    }],
                })
            if app == "ai-gateway-custom-knowledge-worker-app":
                # Empty credentials list: must NOT raise IndexError; must mint new key
                return self._send(200, {"name": app, "status": "approved", "credentials": []})
            if app == "ai-gateway-custom-developer-app":
                # credentials[0] is revoked, credentials[1] is expired, credentials[2] is active+approved
                return self._send(200, {
                    "name": app,
                    "status": "approved",
                    "credentials": [
                        {"consumerKey": "DEAD-REVOKED-KEY-0000", "status": "revoked", "expiresAt": "-1",
                         "apiProducts": [{"apiproduct": "ai-gateway-custom-developer", "status": "approved"}]},
                        {"consumerKey": "DEAD-EXPIRED-KEY-0000", "status": "approved", "expiresAt": "1600000000000",
                         "apiProducts": [{"apiproduct": "ai-gateway-custom-developer", "status": "approved"}]},
                        {"consumerKey": "LIVE-APPROVED-KEY-2222", "status": "approved", "expiresAt": "-1",
                         "apiProducts": [{"apiproduct": "ai-gateway-custom-developer", "status": "approved"}]},
                    ],
                })
            if app == "ai-gateway-custom-developer_team_a-app":
                # Only revoked/expired keys -> must mint new credential
                return self._send(200, {
                    "name": app,
                    "status": "approved",
                    "credentials": [
                        {"consumerKey": "OLD-TEAM-A-REVOKED", "status": "revoked", "expiresAt": "-1"},
                    ],
                })
            if app == "ai-gateway-custom-developer_team_b-app":
                # Active key, but product association was revoked -> must re-approve via ?action=approve
                return self._send(200, {
                    "name": app,
                    "status": "approved",
                    "credentials": [{
                        "consumerKey": "TEAM-B-ACTIVE-KEY-4444",
                        "status": "approved",
                        "expiresAt": "-1",
                        "apiProducts": [{"apiproduct": "ai-gateway-custom-developer_team_b", "status": "revoked"}],
                    }],
                })
            return self._send(404, {"error": "app not found"})

        return self._send(404, {})

    def do_PUT(self):
        parsed = urllib.parse.urlparse(self.path)
        p = parsed.path
        length = int(self.headers.get("Content-Length", "0"))
        body = json.loads(self.rfile.read(length).decode("utf-8")) if length > 0 else {}
        state["calls"].append(f"PUT {p}")
        if p.endswith("/apiproducts/ai-gateway-custom-knowledge-worker"):
            attrs = {a["name"]: a["value"] for a in body.get("attributes", []) if isinstance(a, dict)}
            state["merged_kw_custom_attr"] = attrs.get("unmanaged_keep")
        save_state()
        return self._send(200, body)

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        p = parsed.path
        q = parsed.query
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length).decode("utf-8") if length > 0 else ""
        body = json.loads(raw) if raw.strip().startswith("{") else {}
        state["calls"].append(f"POST {p}" + (f"?{q}" if q else ""))
        save_state()

        if p.endswith("/apiproducts") and "/keys/" not in p:
            return self._send(201, body)
        if "/keys/" in p and "/apiproducts/" in p and "action=approve" in q:
            return self._send(204, None)
        if "/keys/" in p:
            if mode == "fail_key_bind":
                return self._send(500, {"error": "backend key bind failure", "consumerSecret": "SECRET-999"})
            prods = [{"apiproduct": x, "status": "approved"} for x in body.get("apiProducts", [])]
            return self._send(200, {"consumerKey": p.rsplit("/", 1)[-1], "status": "approved", "apiProducts": prods})
        if p.endswith("/apps"):
            app_name = body.get("name", "created-app")
            prods = [{"apiproduct": x, "status": "pending"} for x in body.get("apiProducts", [])]
            return self._send(201, {
                "name": app_name,
                "status": "approved",
                "credentials": [{
                    "consumerKey": "USD-CREATED-KEY-5555",
                    "status": "approved",
                    "expiresAt": "-1",
                    "apiProducts": prods,
                }],
            })
        if "/apps/" in p:
            app_name = p.rsplit("/", 1)[-1]
            minted_key = "KW-MINTED-KEY-1111" if "knowledge-worker" in app_name else "TEAMA-MINTED-KEY-3333"
            prods = [{"apiproduct": x, "status": "approved"} for x in body.get("apiProducts", [])]
            return self._send(200, {
                "name": app_name,
                "status": "approved",
                "credentials": [
                    {"consumerKey": "OLD-REVOKED-IGNORED", "status": "revoked", "expiresAt": "-1"},
                    {"consumerKey": minted_key, "status": "approved", "expiresAt": "-1", "apiProducts": prods},
                ],
            })
        return self._send(200, {})

httpd = http.server.HTTPServer(("127.0.0.1", 0), Handler)
with open(port_file, "w", encoding="utf-8") as pf:
    pf.write(str(httpd.server_port))
save_state()
httpd.serve_forever()
MOCK_PY_EOF

run_mock_sync_case() {
    local mode="$1"
    shift
    rm -f "$MOCK_PORT_FILE" "$MOCK_API_STATE"
    python3 "$MOCK_API_SCRIPT" "$MOCK_API_STATE" "$MOCK_PORT_FILE" "$mode" &
    local srv_pid=$!
    for _ in $(seq 1 50); do
        [[ -s "$MOCK_PORT_FILE" ]] && break
        sleep 0.02
    done
    local port
    port=$(cat "$MOCK_PORT_FILE")
    local rc=0
    MOCK_SYNC_OUT=$(CI="${MOCK_CI:-false}" \
        APIGEE_API_BASE="http://127.0.0.1:${port}" \
        APIGEE_MAX_RETRIES=3 \
        APIGEE_RETRY_BASE_SLEEP=0.01 \
        bash "$REPO_ROOT/scripts/sync-personas.sh" \
            --bundle "$CUSTOM_OUT/apiproxy" \
            --org "test-project" \
            --env "qa" \
            --token "mock-bearer-token" "$@" 2>&1) || rc=$?
    kill "$srv_pid" 2>/dev/null || true
    wait "$srv_pid" 2>/dev/null || true
    return $rc
}

if run_mock_sync_case "matrix" && \
   echo "$MOCK_SYNC_OUT" | grep -q 'client_id: "KW-MINTED-KEY-1111"' && \
   echo "$MOCK_SYNC_OUT" | grep -q 'client_id: "LIVE-APPROVED-KEY-2222"' && \
   echo "$MOCK_SYNC_OUT" | grep -q 'client_id: "TEAMA-MINTED-KEY-3333"' && \
   echo "$MOCK_SYNC_OUT" | grep -q 'client_id: "TEAM-B-ACTIVE-KEY-4444"' && \
   echo "$MOCK_SYNC_OUT" | grep -q 'client_id: "USD-CREATED-KEY-5555"' && \
   ! echo "$MOCK_SYNC_OUT" | grep -q 'DEAD-REVOKED-KEY-0000' && \
   ! echo "$MOCK_SYNC_OUT" | grep -q 'DEAD-EXPIRED-KEY-0000' && \
   ! echo "$MOCK_SYNC_OUT" | grep -q 'OLD-TEAM-A-REVOKED' && \
   python3 -c '
import json, sys
s = json.load(open(sys.argv[1]))
assert s["dev_get_calls"] == 2, f"Expected 503->200 retry on developer GET, got {s}"
assert s["kw_prod_get_calls"] == 2, f"Expected 429->200 retry on product GET, got {s}"
assert s["merged_kw_custom_attr"] == "preserved-across-429", f"Expected non-destructive PUT merge after 429 retry, got {s}"
assert "POST /v1/organizations/test-project/developers/ai-gateway-personas@test-project.iam.gserviceaccount.com/apps/ai-gateway-custom-developer_team_b-app/keys/TEAM-B-ACTIVE-KEY-4444/apiproducts/ai-gateway-custom-developer_team_b?action=approve" in s["calls"], "Missing ?action=approve for revoked product binding"
assert "POST /v1/organizations/test-project/developers/ai-gateway-personas@test-project.iam.gserviceaccount.com/apps/ai-gateway-custom-usd-developer-app/keys/USD-CREATED-KEY-5555/apiproducts/ai-gateway-custom-usd-developer?action=approve" in s["calls"], "Missing ?action=approve for pending manual-approval product"
' "$MOCK_API_STATE"; then
    echo -e "${GREEN}✓ sync-personas.sh live REST matrix verified (429/503 retries, PUT merge preservation, empty credentials[], revoked/expired key filtering, and ?action=approve).${NC}"
else
    echo -e "${RED}✗ sync-personas.sh live REST matrix failed!${NC}"
    echo "${MOCK_SYNC_OUT:-}"
    exit 1
fi

SNIPPET_OUT_FILE="$TMP_DIR/persona_snippet.yaml"
if MOCK_CI=true run_mock_sync_case "matrix" --write-snippet "$SNIPPET_OUT_FILE" && \
   ! echo "$MOCK_SYNC_OUT" | grep -q 'KW-MINTED-KEY-1111' && \
   echo "$MOCK_SYNC_OUT" | grep -q 'KW-MINTE...<masked-in-ci>' && \
   grep -q 'client_id: "KW-MINTED-KEY-1111"' "$SNIPPET_OUT_FILE" && \
   python3 -c 'import os, stat, sys; mode = stat.S_IMODE(os.stat(sys.argv[1]).st_mode); assert mode == 0o600, f"Expected 0600 on snippet file, got {oct(mode)}"' "$SNIPPET_OUT_FILE" && \
   MOCK_CI=true run_mock_sync_case "matrix" --show-keys && \
   echo "$MOCK_SYNC_OUT" | grep -q 'client_id: "KW-MINTED-KEY-1111"'; then
    echo -e "${GREEN}✓ sync-personas.sh umask 077, CI=true stdout masking, --show-keys, and --write-snippet (0600) verified.${NC}"
else
    echo -e "${RED}✗ sync-personas.sh CI masking / --write-snippet check failed!${NC}"
    echo "${MOCK_SYNC_OUT:-}"
    exit 1
fi

if ! run_mock_sync_case "forbid_product_get" && \
   ! echo "$MOCK_SYNC_OUT" | grep -q "TOP-SECRET-DO-NOT-PRINT" && \
   python3 -c 'import json, sys; s=json.load(open(sys.argv[1])); assert not any(c.startswith("POST ") and c.endswith("/apiproducts") for c in s["calls"]), f"Must not POST /apiproducts on 403 GET: {s}"' "$MOCK_API_STATE"; then
    echo -e "${GREEN}✓ sync-personas.sh fails closed on non-404 GET (403) without attempting POST /apiproducts and redacts consumerSecret.${NC}"
else
    echo -e "${RED}✗ sync-personas.sh failed to abort cleanly on 403 GET /apiproducts!${NC}"
    echo "${MOCK_SYNC_OUT:-}"
    exit 1
fi

if ! run_mock_sync_case "fail_key_bind" && \
   ! echo "$MOCK_SYNC_OUT" | grep -q "SECRET-999"; then
    echo -e "${GREEN}✓ sync-personas.sh fails closed when key-to-product binding POST returns 500 (no silent || true swallow).${NC}"
else
    echo -e "${RED}✗ sync-personas.sh failed to abort on key-product binding error!${NC}"
    echo "${MOCK_SYNC_OUT:-}"
    exit 1
fi

TOK_COUNTER_FILE="$TMP_DIR/tok_counter.txt"
echo "0" > "$TOK_COUNTER_FILE"
rm -f "$MOCK_PORT_FILE" "$MOCK_API_STATE"
python3 "$MOCK_API_SCRIPT" "$MOCK_API_STATE" "$MOCK_PORT_FILE" "token_refresh" &
TOK_SRV_PID=$!
for _ in $(seq 1 50); do
    [[ -s "$MOCK_PORT_FILE" ]] && break
    sleep 0.02
done
TOK_PORT=$(cat "$MOCK_PORT_FILE")
TOK_RC=0
TOK_OUT=$(APIGEE_API_BASE="http://127.0.0.1:${TOK_PORT}" \
    APIGEE_MAX_RETRIES=2 \
    APIGEE_RETRY_BASE_SLEEP=0.01 \
    APIGEE_TOKEN_REFRESH_SEC=0 \
    GCLOUD_TOKEN_CMD="python3 -c 'import sys; p=sys.argv[1]; n=int(open(p).read().strip())+1; open(p,\"w\").write(str(n)); print(\"expired-tok-001\" if n==1 else \"fresh-tok-002\")' \"$TOK_COUNTER_FILE\"" \
    bash "$REPO_ROOT/scripts/sync-personas.sh" \
        --bundle "$CUSTOM_OUT/apiproxy" \
        --org "test-project" \
        --env "qa" 2>&1) || TOK_RC=$?
kill "$TOK_SRV_PID" 2>/dev/null || true
wait "$TOK_SRV_PID" 2>/dev/null || true

if [[ "$TOK_RC" -eq 0 ]] && \
   python3 -c 'import json, sys; s=json.load(open(sys.argv[1])); assert s["saw_401_refresh"] and s["saw_fresh_token"], f"Expected 401->fresh token recovery, got {s}"' "$MOCK_API_STATE"; then
    echo -e "${GREEN}✓ sync-personas.sh automatically refreshes expired gcloud OAuth tokens on HTTP 401 and across persona iterations.${NC}"
else
    echo -e "${RED}✗ sync-personas.sh automatic gcloud token refresh failed (rc=$TOK_RC)!${NC}"
    echo "${TOK_OUT:-}"
    exit 1
fi


# 8. Execute JUnit 5 Java Callout Suite & Modular Unit, Performance Skill & Security Skill Test Suites
echo -e "\n${YELLOW}Step 8: Running JUnit 5 Callout Suite & Modular Unit/Performance/Security Skill Suites...${NC}"
if command -v mvn &>/dev/null; then
    M2_DIR="${M2_REPO:-$HOME/.m2/repository}"
    MVN_ARGS=()
    if [ "${MAVEN_PUBLIC_APIGEE_REPO:-auto}" = "true" ]; then
        MVN_ARGS=(-Ppublic-apigee-repo)
    elif [ "${MAVEN_PUBLIC_APIGEE_REPO:-auto}" = "auto" ] && \
         [ ! -f "$M2_DIR/com/apigee/gateway/libraries/message-flow/1.0.0/message-flow-1.0.0.jar" ] && \
         ! grep -qi "<mirror>" "$HOME/.m2/settings.xml" 2>/dev/null; then
        MVN_ARGS=(-Ppublic-apigee-repo)
    fi
    mvn -q -f "$REPO_ROOT/callout/pom.xml" "${MVN_ARGS[@]}" package
    cp "$REPO_ROOT/callout/target/ai-gateway-callouts.jar" "$REPO_ROOT/templates/ai-gateway/resources/java/ai-gateway-callouts.jar"
    cp "$REPO_ROOT/callout/target/ai-gateway-callouts.jar" "$MVP_OUT/apiproxy/resources/java/ai-gateway-callouts.jar"
    echo -e "${GREEN}✓ JUnit 5 Java Callout concurrency, StrictJson & BaseCallout test suite passed.${NC}"
else
    echo -e "${RED}✗ Error: 'mvn' command not found in PATH.${NC}"
    exit 1
fi
if command -v node &>/dev/null; then
    RENDERED_BUNDLE_DIR="$MVP_OUT/apiproxy" node "$REPO_ROOT/tests/unit/run_unit_tests.js"
else
    echo -e "${RED}✗ Error: 'node' command not found in PATH.${NC}"
    exit 1
fi

# Clean Up
rm -rf "$TMP_DIR"

echo -e "\n${BLUE}======================================================${NC}"
echo -e "${GREEN}ALL 8 TEMPLATE & RUNTIME VALIDATION TESTS PASSED!${NC}"
echo -e "${BLUE}======================================================${NC}"
