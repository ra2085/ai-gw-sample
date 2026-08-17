#!/bin/bash

# Terminal Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Configuration
APIGEE_HOST="${1:-$APIGEE_HOST}"
API_KEY="${2:-$API_KEY}"

if [ -z "$APIGEE_HOST" ] || [ -z "$API_KEY" ]; then
  echo -e "${RED}Error: APIGEE_HOST and API_KEY are required.${NC}"
  echo -e "Usage: $0 <apigee-host> <api-key>"
  echo -e "   or: APIGEE_HOST=... API_KEY=... $0"
  exit 1
fi

URL="https://${APIGEE_HOST}/v1/messages"

echo -e "${BOLD}${CYAN}======================================================================"
echo -e "    Apigee AI Gateway Smart Streaming Route Test Suite (15 runs)      "
echo -e "======================================================================${NC}"
echo -e "${YELLOW}Target Endpoint:${NC} ${BOLD}${URL}${NC}"
echo -e "${YELLOW}API Key Prefix:${NC} ${BOLD}${API_KEY:0:8}...${NC}"
echo -e "----------------------------------------------------------------------"

# 15 Test Cases: [Test Name] | [JSON Payload Body]
declare -a test_names=(
  "1. Streaming - Claude Haiku 4.5"
  "2. Streaming - Gemini 3.7 Flash"
  "3. Streaming - Gemini 3.5 Flash"
  "4. Streaming - Gemini 3.1 Pro"
  "5. Streaming - Gemini 3.1 Flash-Lite"
  "6. Streaming - Fallback Array (Sonnet -> Gemini 3.5 Flash)"
  "7. Streaming - Provider-Prefixed Array (anthropic/ -> google/)"
  "8. Streaming - Smart Auto-Router (Cost Tier: Low)"
  "9. Streaming - Smart Auto-Router (Cost Tier: Medium)"
  "10. Streaming - Smart Auto-Router (Cost Tier: High)"
  "11. Streaming - Smart Auto-Router (Cost Tier: Max)"
  "12. Streaming - Legacy Alias (gemini-1.5-flash -> 3.5 Flash)"
  "13. Streaming - OpenAI Alias (gpt-4o -> 3.1 Pro)"
  "14. Streaming - Tool Calling with SSE Chunk Translation"
  "15. Streaming - Model Armor Token Counting & Buffering"
)

declare -a test_payloads=(
  # 1. Claude Haiku 4.5
  '{"model":"claude-haiku-4-5","max_tokens":128,"stream":true,"messages":[{"role":"user","content":"Count from 1 to 5."}]}'
  
  # 2. Gemini 3.7 Flash
  '{"model":"gemini-3.7-flash","max_tokens":128,"stream":true,"messages":[{"role":"user","content":"List three fruits."}]}'
  
  # 3. Gemini 3.5 Flash
  '{"model":"gemini-3.5-flash","max_tokens":128,"stream":true,"messages":[{"role":"user","content":"What color is the sky?"}]}'
  
  # 4. Gemini 3.1 Pro
  '{"model":"gemini-3.1-pro","max_tokens":128,"stream":true,"messages":[{"role":"user","content":"Write a two-sentence story."}]}'
  
  # 5. Gemini 3.1 Flash-Lite
  '{"model":"gemini-3.1-flash-lite","max_tokens":128,"stream":true,"messages":[{"role":"user","content":"Say \"Hello World\"."}]}'
  
  # 6. Fallback Array
  '{"models":["claude-3-5-sonnet","gemini-3.5-flash"],"max_tokens":128,"stream":true,"messages":[{"role":"user","content":"What is 20 + 20?"}]}'
  
  # 7. Provider-Prefixed Array
  '{"models":["anthropic/claude-3-5-haiku","google/gemini-3.5-flash"],"max_tokens":128,"stream":true,"messages":[{"role":"user","content":"Name two oceans."}]}'
  
  # 8. Auto-Router low
  '{"plugins":[{"id":"auto-router","cost_tier":"low"}],"max_tokens":128,"stream":true,"messages":[{"role":"user","content":"What is the chemical formula of water?"}]}'
  
  # 9. Auto-Router medium
  '{"plugins":[{"id":"auto-router","cost_tier":"medium"}],"max_tokens":128,"stream":true,"messages":[{"role":"user","content":"Define velocity in simple terms."}]}'
  
  # 10. Auto-Router high
  '{"plugins":[{"id":"auto-router","cost_tier":"high"}],"max_tokens":128,"stream":true,"messages":[{"role":"user","content":"What is the square root of 64?"}]}'
  
  # 11. Auto-Router max
  '{"plugins":[{"id":"auto-router","cost_tier":"max"}],"max_tokens":128,"stream":true,"messages":[{"role":"user","content":"Write a haiku about stars."}]}'
  
  # 12. Legacy Alias
  '{"model":"gemini-1.5-flash","max_tokens":128,"stream":true,"messages":[{"role":"user","content":"What is the freezing point of water in Celsius?"}]}'
  
  # 13. OpenAI Alias
  '{"model":"gpt-4o","max_tokens":128,"messages":[{"role":"user","content":"Name the largest planet in our solar system."}],"stream":true}'
  
  # 14. Streaming Tool Calling
  '{"model":"gemini-3.5-flash","max_tokens":256,"stream":true,"messages":[{"role":"user","content":"Get weather for London"}],"tools":[{"name":"get_weather","description":"Get current weather","input_schema":{"type":"object","properties":{"location":{"type":"string"}},"required":["location"]}}]}'
  
  # 15. Streaming with usage counting
  '{"model":"gemini-3.5-flash","max_tokens":128,"stream":true,"messages":[{"role":"user","content":"Tell me a very brief fact about Jupiter."}]}'
)

passed=0
failed=0

for i in "${!test_names[@]}"; do
  name="${test_names[i]}"
  payload="${test_payloads[i]}"
  count=$((i+1))
  
  echo -e "\n${BOLD}${YELLOW}[Test $count/15] ${name}${NC}"
  echo -e "${CYAN}Payload:${NC} $(echo "$payload" | cut -c1-100)..."
  
  response_file=$(mktemp)
  headers_file=$(mktemp)
  
  http_code=$(curl -s -N -D "$headers_file" -o "$response_file" -w "%{http_code}" -X POST "$URL" \
    -H "Content-Type: application/json" \
    -H "x-apikey: $API_KEY" \
    -H "X-Client: apigee-smart-stream-suite" \
    -d "$payload")
  
  body=$(cat "$response_file")
  routed_model=$(grep -i "x-gateway-routed-model" "$headers_file" | tr -d '\r' | awk '{print $2}')
  cost_tier=$(grep -i "x-gateway-cost-tier" "$headers_file" | tr -d '\r' | awk '{print $2}')
  
  rm -f "$response_file" "$headers_file"

  if [ "$http_code" -eq 200 ] || [ "$http_code" -eq 201 ]; then
    echo -e "${GREEN}${BOLD}✓ STREAM SUCCESS (HTTP $http_code)${NC}"
    
    if [ -n "$routed_model" ]; then
      echo -e "${BLUE}Routed Model Header:${NC} ${BOLD}$routed_model${NC}"
    fi
    if [ -n "$cost_tier" ]; then
      echo -e "${BLUE}Cost Tier Header:${NC} $cost_tier"
    fi
    
    event_count=$(echo "$body" | grep -c "^event:" || true)
    delta_sample=$(echo "$body" | grep -o '"text":"[^"]*' | head -n 2 | cut -d'"' -f4 | tr -d '\n')
    echo -e "${BLUE}SSE Events Received:${NC} $event_count events"
    echo -e "${BLUE}Stream Sample:${NC} $delta_sample..."
    passed=$((passed+1))
  else
    echo -e "${RED}${BOLD}✗ FAILED (HTTP $http_code)${NC}"
    echo -e "${RED}Error Body:${NC} $body"
    failed=$((failed+1))
  fi
  
  echo -e "${CYAN}----------------------------------------------------------------------${NC}"
  sleep 0.5
done

# Final Summary Table
echo -e "\n\n${BOLD}${CYAN}======================================================================"
echo -e "                   STREAMING TEST EXECUTION SUMMARY                   "
echo -e "======================================================================${NC}"
printf "%-30s : ${GREEN}${BOLD}%-5d${NC}\n" "Passed Stream Tests" "$passed"
printf "%-30s : ${RED}${BOLD}%-5d${NC}\n" "Failed Stream Tests" "$failed"
echo -e "${CYAN}======================================================================${NC}"

if [ "$passed" -eq 15 ]; then
  echo -e "${BOLD}${GREEN}All 15 Smart Routing streaming test runs completed successfully!${NC}"
else
  echo -e "${BOLD}${YELLOW}Completed with $passed passed, $failed failed out of 15 tests.${NC}"
fi
