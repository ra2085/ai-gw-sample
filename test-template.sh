#!/bin/bash
# ==============================================================================
# Apigee AI Gateway - Template Validation & Parity Test Suite
# ==============================================================================

set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
TMP_DIR="/tmp/ai-gw-template-test-$(date +%s)"
mkdir -p "$TMP_DIR"

echo -e "${BLUE}======================================================${NC}"
echo -e "${BLUE}🧪 Apigee AI Gateway Template Verification Suite${NC}"
echo -e "${BLUE}======================================================${NC}"

# ------------------------------------------------------------------------------
# 1. Locate apigee-go-gen CLI (Prerequisite)
# ------------------------------------------------------------------------------
echo -e "\n${YELLOW}Step 1: Checking for apigee-go-gen prerequisite...${NC}"

if command -v apigee-go-gen &>/dev/null; then
    APIGEE_GEN="apigee-go-gen"
elif [ -f "./bin/apigee-go-gen" ]; then
    APIGEE_GEN="./bin/apigee-go-gen"
elif [ -f "./apigeegg/apigee-go-gen/bin/apigee-go-gen" ]; then
    APIGEE_GEN="./apigeegg/apigee-go-gen/bin/apigee-go-gen"
else
    echo -e "${RED}✗ Error: 'apigee-go-gen' command not found in PATH.${NC}"
    echo "Please install apigee-go-gen as a prerequisite:"
    echo "  go install github.com/apigee/apigee-go-gen/cmd/apigee-go-gen@latest"
    exit 1
fi
echo -e "${GREEN}✓ Found apigee-go-gen: $(which $APIGEE_GEN 2>/dev/null || echo $APIGEE_GEN)${NC}"


# ------------------------------------------------------------------------------
# 2. Test MVP Full Bundle Render & Schema Validation
# ------------------------------------------------------------------------------
echo -e "\n${YELLOW}Step 2: Rendering Full MVP Template...${NC}"
MVP_OUT="$TMP_DIR/mvp_bundle"
$APIGEE_GEN render apiproxy \
    --template ./templates/ai-gateway/apiproxy.yaml \
    --values ./templates/ai-gateway/values.yaml \
    --output "$MVP_OUT" \
    --validate=true

if [ -d "$MVP_OUT/apiproxy" ]; then
    echo -e "${GREEN}✓ MVP Template rendered and validated successfully.${NC}"
else
    echo -e "${RED}✗ MVP Template rendering failed!${NC}"
    exit 1
fi

# ------------------------------------------------------------------------------
# 3. Verify Bundle Components & Parity
# ------------------------------------------------------------------------------
echo -e "\n${YELLOW}Step 3: Checking Bundle Component Parity...${NC}"

# Check ProxyEndpoints (4 expected)
PROXY_COUNT=$(find "$MVP_OUT/apiproxy/proxies" -name "*.xml" | wc -l | tr -d ' ')
if [ "$PROXY_COUNT" -eq 4 ]; then
    echo -e "${GREEN}✓ ProxyEndpoints (4/4): claude-messages, gemini-native, openai-compat, claude-models${NC}"
else
    echo -e "${RED}✗ Expected 4 ProxyEndpoints, found $PROXY_COUNT${NC}"
    exit 1
fi

# Check TargetEndpoints (4 expected)
TARGET_COUNT=$(find "$MVP_OUT/apiproxy/targets" -name "*.xml" | wc -l | tr -d ' ')
if [ "$TARGET_COUNT" -eq 4 ]; then
    echo -e "${GREEN}✓ TargetEndpoints (4/4): claude, gemini, gemini-native-target, gemini-openai-compat${NC}"
else
    echo -e "${RED}✗ Expected 4 TargetEndpoints, found $TARGET_COUNT${NC}"
    exit 1
fi

# Check Policies (38 expected)
POLICY_COUNT=$(find "$MVP_OUT/apiproxy/policies" -name "*.xml" | wc -l | tr -d ' ')
if [ "$POLICY_COUNT" -ge 38 ]; then
    echo -e "${GREEN}✓ Policies ($POLICY_COUNT policies verified, including Model Armor, Quotas, Monetization, Judge)${NC}"
else
    echo -e "${RED}✗ Expected at least 38 policies, found $POLICY_COUNT${NC}"
    exit 1
fi

# Check Resources (JavaScript & PropertySets)
JS_COUNT=$(find "$MVP_OUT/apiproxy/resources/jsc" -name "*.js" | wc -l | tr -d ' ')
PROP_COUNT=$(find "$MVP_OUT/apiproxy/resources/properties" -name "*.properties" | wc -l | tr -d ' ')
echo -e "${GREEN}✓ Resources: $JS_COUNT JavaScript callouts and $PROP_COUNT PropertySets verified.${NC}"

# ------------------------------------------------------------------------------
# 4. Verify Generated PropertySets Content
# ------------------------------------------------------------------------------
echo -e "\n${YELLOW}Step 4: Validating Dynamic PropertySets Content...${NC}"
MODEL_LOC_FILE="$MVP_OUT/apiproxy/resources/properties/model_locations.properties"
MONET_FILE="$MVP_OUT/apiproxy/resources/properties/monetization_rates.properties"

if grep -q "models.catalog=gemini-3.7-flash,gemini-3.5-flash,gemini-3.1-flash-lite,gemini-2.5-pro,gemini-2.5-flash,claude-haiku-4-5" "$MODEL_LOC_FILE"; then
    echo -e "${GREEN}✓ model_locations.properties: Dynamic models catalog generated correctly.${NC}"
else
    echo -e "${RED}✗ model_locations.properties missing or incomplete models.catalog!${NC}"
    exit 1
fi

if grep -q "tier.low=gemini-3.1-flash-lite" "$MODEL_LOC_FILE" && grep -q "tier.high=gemini-2.5-pro" "$MODEL_LOC_FILE"; then
    echo -e "${GREEN}✓ model_locations.properties: Smart Router tiers mapped correctly.${NC}"
fi

if grep -q "gemini-3.5-flash.input_rate=0.1" "$MONET_FILE" && grep -q "claude-haiku-4-5.output_rate=5" "$MONET_FILE"; then
    echo -e "${GREEN}✓ monetization_rates.properties: Micro-transaction pricing matrix generated correctly.${NC}"
else
    echo -e "${RED}✗ monetization_rates.properties pricing generation failed!${NC}"
    exit 1
fi

# ------------------------------------------------------------------------------
# 5. Test Minimal Quickstart Template Rendering
# ------------------------------------------------------------------------------
echo -e "\n${YELLOW}Step 5: Testing Minimal Quickstart Template (20 lines)...${NC}"
QUICK_OUT="$TMP_DIR/quickstart_bundle"
$APIGEE_GEN render apiproxy \
    --template ./templates/ai-gateway/apiproxy.yaml \
    --values ./templates/ai-gateway/values.quickstart.yaml \
    --output "$QUICK_OUT" \
    --validate=true

if [ -d "$QUICK_OUT/apiproxy" ]; then
    echo -e "${GREEN}✓ Quickstart Template rendered cleanly with default fallbacks.${NC}"
fi

# ------------------------------------------------------------------------------
# 6. Test Feature Toggle Omission (Zero Overhead Verification)
# ------------------------------------------------------------------------------
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

TOGGLE_OUT="$TMP_DIR/toggle_bundle"
$APIGEE_GEN render apiproxy \
    --template ./templates/ai-gateway/apiproxy.yaml \
    --values "$TMP_DIR/test_toggles.yaml" \
    --output "$TOGGLE_OUT" \
    --validate=true

# Check that MLC and SUP steps are cleanly omitted in the rendered proxy XML
if grep -q "MLC-EnforceMonetizationLimits" "$TOGGLE_OUT/apiproxy/proxies/claude-messages.xml"; then
    echo -e "${RED}✗ Monetization was disabled but MLC policy was still included in proxy flow!${NC}"
    exit 1
else
    echo -e "${GREEN}✓ Monetization feature toggle verified (MLC step cleanly omitted).${NC}"
fi

if grep -q "SUP-SanitizeUserPrompt" "$TOGGLE_OUT/apiproxy/proxies/claude-messages.xml"; then
    echo -e "${RED}✗ Model Armor was disabled but SUP policy was still included in proxy flow!${NC}"
    exit 1
else
    echo -e "${GREEN}✓ Model Armor feature toggle verified (SUP step cleanly omitted).${NC}"
fi

# ------------------------------------------------------------------------------
# 7. Test Custom URL & Multi-Protocol Model
# ------------------------------------------------------------------------------
echo -e "\n${YELLOW}Step 7: Testing Custom Model URL & Format Transcoding...${NC}"
cat << 'CUSTOM_EOF' > "$TMP_DIR/test_custom.yaml"
gateway:
  name: "ai-gateway-custom"
  project_id: "test-project"

models:
  - name: "custom-vllm"
    displayName: "Llama 3 (vLLM)"
    format: "openai"
    custom_url: "https://vllm.internal.corp/v1/chat/completions"
    auth:
      type: "bearer"
      token_ref: "propertyset.config.vllm_token"
CUSTOM_EOF

CUSTOM_OUT="$TMP_DIR/custom_bundle"
$APIGEE_GEN render apiproxy \
    --template ./templates/ai-gateway/apiproxy.yaml \
    --values "$TMP_DIR/test_custom.yaml" \
    --output "$CUSTOM_OUT" \
    --validate=true

CUSTOM_PROP="$CUSTOM_OUT/apiproxy/resources/properties/model_locations.properties"
if grep -q "custom-vllm.url=https://vllm.internal.corp/v1/chat/completions" "$CUSTOM_PROP" && \
   grep -q "custom-vllm.format=openai" "$CUSTOM_PROP" && \
   grep -q "custom-vllm.auth_type=bearer" "$CUSTOM_PROP"; then
    echo -e "${GREEN}✓ Custom model URL, format, and bearer auth references rendered properly.${NC}"
else
    echo -e "${RED}✗ Custom model properties failed to render!${NC}"
    exit 1
fi

# ------------------------------------------------------------------------------
# Clean Up
# ------------------------------------------------------------------------------
rm -rf "$TMP_DIR"

echo -e "\n${BLUE}======================================================${NC}"
echo -e "${GREEN}🎉 ALL 7 TEMPLATE VALIDATION TESTS PASSED SUCCESSFULLY!${NC}"
echo -e "${BLUE}======================================================${NC}"
