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
# Apigee AI Gateway - Quickstart Template Verification Test
# Tests rendering and validating templates/ai-gateway/values.quickstart.yaml
# ==============================================================================

set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TMP_DIR="/tmp/ai-gw-quickstart-test-$(date +%s)"
mkdir -p "$TMP_DIR"

echo -e "${BLUE}======================================================${NC}"
echo -e "${BLUE}🧪 Running Quickstart Template Verification Test${NC}"
echo -e "${BLUE}======================================================${NC}"

# 1. Locate apigee-go-gen
echo -e "\n${YELLOW}Step 1: Locating apigee-go-gen generator...${NC}"
if command -v apigee-go-gen &>/dev/null; then
    APIGEE_GEN="apigee-go-gen"
elif [ -f "$REPO_ROOT/bin/apigee-go-gen" ]; then
    APIGEE_GEN="$REPO_ROOT/bin/apigee-go-gen"
else
    echo -e "${RED}✗ Error: 'apigee-go-gen' command not found in PATH.${NC}"
    echo "Please install apigee-go-gen: curl -s https://apigee.github.io/apigee-go-gen/install | sh"
    exit 1
fi
echo -e "${GREEN}✓ Using generator: $($APIGEE_GEN version 2>/dev/null || which $APIGEE_GEN)${NC}"

# 2. Render Minimal Quickstart Template
echo -e "\n${YELLOW}Step 2: Rendering Quickstart Template (values.quickstart.yaml)...${NC}"
QUICK_OUT="$TMP_DIR/quickstart_bundle"
$APIGEE_GEN render apiproxy \
    --template "$REPO_ROOT/templates/ai-gateway/apiproxy.yaml" \
    --values "$REPO_ROOT/templates/ai-gateway/values.quickstart.yaml" \
    --output "$QUICK_OUT" \
    --validate=true

if [ -d "$QUICK_OUT/apiproxy" ]; then
    echo -e "${GREEN}✓ Quickstart Template rendered and schema-validated successfully.${NC}"
else
    echo -e "${RED}✗ Quickstart Template rendering failed!${NC}"
    exit 1
fi

# 3. Verify Proxy and Target Endpoints
echo -e "\n${YELLOW}Step 3: Checking Generated Endpoints...${NC}"
PROXY_COUNT=$(find "$QUICK_OUT/apiproxy/proxies" -name "*.xml" | wc -l | tr -d ' ')
TARGET_COUNT=$(find "$QUICK_OUT/apiproxy/targets" -name "*.xml" | wc -l | tr -d ' ')

if [ "$PROXY_COUNT" -eq 5 ] && [ "$TARGET_COUNT" -eq 5 ]; then
    echo -e "${GREEN}✓ Endpoints verified: $PROXY_COUNT ProxyEndpoints and $TARGET_COUNT TargetEndpoints.${NC}"
else
    echo -e "${RED}✗ Unexpected endpoint counts: $PROXY_COUNT Proxies, $TARGET_COUNT Targets.${NC}"
    exit 1
fi

# 4. Verify Generated PropertySets Content for Quickstart Models
echo -e "\n${YELLOW}Step 4: Validating Dynamic PropertySets for Quickstart Models...${NC}"
MODEL_LOC_FILE="$QUICK_OUT/apiproxy/resources/properties/model_locations.properties"

# Check model catalog contains the quickstart models (including gemini-embedding-001)
if grep -q "models.catalog=gemini-4-hydrogen,claude-haiku-5-5,gemini-embedding-001,my-vllm-model" "$MODEL_LOC_FILE"; then
    echo -e "${GREEN}✓ model_locations.properties: Quickstart catalog (with gemini-embedding-001) generated correctly.${NC}"
else
    echo -e "${RED}✗ model_locations.properties missing quickstart models.catalog!${NC}"
    echo "Found catalog: $(grep "models.catalog" "$MODEL_LOC_FILE" || echo "none")"
    exit 1
fi

# Check claude-haiku-5-5 global endpoint & placeholder project_id sanitization
CONFIG_PROP_FILE="$QUICK_OUT/apiproxy/resources/properties/config.properties"
if grep -q "claude-haiku-5-5.endpoint=global" "$MODEL_LOC_FILE" && \
   ! grep -q "your-gcp-project-id" "$CONFIG_PROP_FILE"; then
    echo -e "${GREEN}✓ claude-haiku-5-5 region (global) and placeholder project_id sanitization verified.${NC}"
else
    echo -e "${RED}✗ Quickstart region or project_id sanitization failed!${NC}"
    exit 1
fi

# Check that omitting features: enables quotas, monetization cost calculation, and headers by default
CLAUDE_PROXY_XML="$QUICK_OUT/apiproxy/proxies/claude-messages.xml"
CLAUDE_TARGET_XML="$QUICK_OUT/apiproxy/targets/claude.xml"
if grep -q "<Name>LTQ-EnforceOnly</Name>" "$CLAUDE_PROXY_XML" && \
   grep -q "<Name>LTQ-CountOnly</Name>" "$CLAUDE_PROXY_XML" && \
   grep -q "<Name>JS-calculate-monetization-cost</Name>" "$CLAUDE_PROXY_XML" && \
   grep -q "<Name>AM-SetQuotaHeaders</Name>" "$CLAUDE_PROXY_XML" && \
   grep -q "<Name>AM-SetMonetizationHeaders</Name>" "$CLAUDE_PROXY_XML" && \
   grep -q "<Name>LTQ-CountOnly</Name>" "$CLAUDE_TARGET_XML"; then
    echo -e "${GREEN}✓ Omitting features: enables quotas (PreFlow/PostFlow/EventFlow), cost attribution, and telemetry headers by default.${NC}"
else
    echo -e "${RED}✗ Quickstart omitted default-true quota or monetization steps!${NC}"
    exit 1
fi

# Check default model fallback
if grep -q "default.model=gemini-4-hydrogen" "$MODEL_LOC_FILE"; then
    echo -e "${GREEN}✓ default.model correctly inferred as 'gemini-4-hydrogen'.${NC}"
else
    echo -e "${RED}✗ default.model fallback check failed!${NC}"
    exit 1
fi

# Check custom URL resolution for my-vllm-model
if grep -q "my-vllm-model.url=https://vllm.internal.corp/v1/chat/completions" "$MODEL_LOC_FILE" && \
   grep -q "my-vllm-model.format=openai" "$MODEL_LOC_FILE"; then
    echo -e "${GREEN}✓ Custom model 'my-vllm-model' URL and format mapped correctly.${NC}"
else
    echo -e "${RED}✗ Custom model properties missing or incorrect!${NC}"
    exit 1
fi

# 5. Clean Up
rm -rf "$TMP_DIR"

echo -e "\n${BLUE}======================================================${NC}"
echo -e "${GREEN}🎉 QUICKSTART TEMPLATE TEST PASSED SUCCESSFULLY!${NC}"
echo -e "${BLUE}======================================================${NC}"
