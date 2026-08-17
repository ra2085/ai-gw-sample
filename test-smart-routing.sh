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
echo -e "         Apigee AI Gateway Smart Routing Test Suite (15 runs)         "
echo -e "======================================================================${NC}"
echo -e "${YELLOW}Target Endpoint:${NC} ${BOLD}${URL}${NC}"
echo -e "${YELLOW}API Key Prefix:${NC} ${BOLD}${API_KEY:0:8}...${NC}"
echo -e "----------------------------------------------------------------------"

# 15 Test Cases: [Test Name] | [JSON Payload Description] | [JSON Payload Body]
declare -a test_names=(
  "1. Standard Routing - Claude Haiku 4.5"
  "2. Modern Model Routing - Gemini 3.7 Flash"
  "3. Modern Model Routing - Gemini 3.5 Flash"
  "4. Modern Model Routing - Gemini 2.5 Pro"
  "5. Modern Model Routing - Gemini 3.1 Flash-Lite"
  "6. Smart Fallback Array (Sonnet -> Gemini 3.5 Flash)"
  "7. Provider-Prefixed Array (anthropic/ -> google/)"
  "8. Smart Auto-Router (Cost Tier: Low -> 3.1 Flash-Lite)"
  "9. Smart Auto-Router (Cost Tier: Medium -> 3.5 Flash)"
  "10. LLM as a Judge (Coding & Algorithm Task -> Auto-Classifier)"
  "11. LLM as a Judge (Simple Query -> Auto-Classifier)"
  "12. Legacy Model Alias (gemini-1.5-flash -> gemini-3.5-flash)"
  "13. OpenAI Model Alias (gpt-4o -> gemini-2.5-pro)"
  "14. Tool Calling & Function Declarations (get_weather tool)"
  "15. Multimodal Vision (Inline 1x1 GIF Base64)"
)

declare -a test_payloads=(
  # 1. Claude Haiku 4.5
  '{"model":"claude-haiku-4-5","max_tokens":128,"messages":[{"role":"user","content":"Say hello in one short sentence."}]}'
  
  # 2. Gemini 3.7 Flash
  '{"model":"gemini-3.7-flash","max_tokens":128,"messages":[{"role":"user","content":"Name three primary colors."}]}'
  
  # 3. Gemini 3.5 Flash
  '{"model":"gemini-3.5-flash","max_tokens":128,"messages":[{"role":"user","content":"What is 15 multiplied by 4?"}]}'
  
  # 4. Gemini 2.5 Pro
  '{"model":"gemini-2.5-pro","max_tokens":128,"messages":[{"role":"user","content":"Write a 3-line poem about the sea."}]}'
  
  # 5. Gemini 3.1 Flash-Lite
  '{"model":"gemini-3.1-flash-lite","max_tokens":128,"messages":[{"role":"user","content":"Translate \"Thank you\" to Spanish."}]}'
  
  # 6. Fallback Array (models: [...])
  '{"models":["claude-3-5-sonnet","gemini-3.5-flash"],"max_tokens":128,"messages":[{"role":"user","content":"What is the capital of France?"}]}'
  
  # 7. Provider-Prefixed Array
  '{"models":["anthropic/claude-3-5-haiku","google/gemini-3.5-flash"],"max_tokens":128,"messages":[{"role":"user","content":"Name two mammals that lay eggs."}]}'
  
  # 8. Auto-Router (cost_tier: low)
  '{"plugins":[{"id":"auto-router","cost_tier":"low"}],"max_tokens":128,"messages":[{"role":"user","content":"What is the boiling point of water?"}]}'
  
  # 9. Auto-Router (cost_tier: medium)
  '{"plugins":[{"id":"auto-router","cost_tier":"medium"}],"max_tokens":128,"messages":[{"role":"user","content":"Explain photosynthesis in one sentence."}]}'
  
  # 10. LLM as a Judge (Coding & Algorithm Task)
  '{"plugins":[{"id":"auto-router","judge":true}],"max_tokens":128,"messages":[{"role":"user","content":"Write a Python algorithm for Dijkstra shortest path with a priority queue."}]}'
  
  # 11. LLM as a Judge (Simple Query)
  '{"plugins":[{"id":"auto-router","judge":true}],"max_tokens":128,"messages":[{"role":"user","content":"What is the capital city of Japan?"}]}'
  
  # 12. Legacy Alias gemini-1.5-flash
  '{"model":"gemini-1.5-flash","max_tokens":128,"messages":[{"role":"user","content":"What is the speed of light?"}]}'
  
  # 13. OpenAI Alias gpt-4o
  '{"model":"gpt-4o","max_tokens":128,"messages":[{"role":"user","content":"What planet is closest to the sun?"}]}'
  
  # 14. Tool Calling Declaration
  '{"model":"gemini-3.5-flash","max_tokens":256,"messages":[{"role":"user","content":"What is the weather in Seattle?"}],"tools":[{"name":"get_weather","description":"Get current weather for a city","input_schema":{"type":"object","properties":{"location":{"type":"string"}},"required":["location"]}}]}'
  
  # 15. Multimodal Vision
  '{"model":"gemini-3.5-flash","max_tokens":128,"messages":[{"role":"user","content":[{"type":"text","text":"What is in this image?"},{"type":"image","source":{"type":"base64","media_type":"image/gif","data":"R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"}}]}]}'
)

# Trackers
passed=0
failed=0

# Loop through all 15 test cases
for i in "${!test_names[@]}"; do
  name="${test_names[i]}"
  payload="${test_payloads[i]}"
  count=$((i+1))
  
  echo -e "\n${BOLD}${YELLOW}[Test $count/15] ${name}${NC}"
  echo -e "${CYAN}Payload:${NC} $(echo "$payload" | cut -c1-100)..."
  
  # Execute request capturing HTTP code and response headers
  response_file=$(mktemp)
  headers_file=$(mktemp)
  
  http_code=$(curl -s -D "$headers_file" -o "$response_file" -w "%{http_code}" -X POST "$URL" \
    -H "Content-Type: application/json" \
    -H "x-apikey: $API_KEY" \
    -H "X-Client: apigee-smart-routing-test" \
    -d "$payload")
  
  body=$(cat "$response_file")
  requested_model=$(grep -i "^x-gateway-requested-model:" "$headers_file" | tr -d '\r' | awk '{print $2}')
  routed_model=$(grep -i "^x-gateway-routed-model:" "$headers_file" | tr -d '\r' | awk '{print $2}')
  cost_tier=$(grep -i "^x-gateway-cost-tier:" "$headers_file" | tr -d '\r' | awk '{print $2}')
  fallback_model=$(grep -i "^x-gateway-fallback-model:" "$headers_file" | tr -d '\r' | awk '{print $2}')
  
  judge_task=$(grep -i "^x-gateway-judge-task:" "$headers_file" | tr -d '\r' | awk '{$1=""; print $0}' | sed 's/^ //')
  judge_complexity=$(grep -i "^x-gateway-judge-complexity:" "$headers_file" | tr -d '\r' | awk '{print $2}')
  judge_tier=$(grep -i "^x-gateway-judge-tier:" "$headers_file" | tr -d '\r' | awk '{print $2}')
  
  rm -f "$response_file" "$headers_file"

  # Evaluation
  if [ "$http_code" -eq 200 ] || [ "$http_code" -eq 201 ]; then
    echo -e "${GREEN}${BOLD}✓ SUCCESS (HTTP $http_code)${NC}"
    
    if [ -n "$requested_model" ]; then
      echo -e "${BLUE}Requested Model Header:${NC} $requested_model"
    fi
    if [ -n "$routed_model" ]; then
      echo -e "${BLUE}Routed Model Header:${NC} ${BOLD}$routed_model${NC}"
    fi
    if [ -n "$cost_tier" ]; then
      echo -e "${BLUE}Cost Tier Header:${NC} $cost_tier"
    fi
    if [ -n "$fallback_model" ] && [ "$fallback_model" != "none" ]; then
      echo -e "${BLUE}Configured Fallback:${NC} $fallback_model"
    fi
    
    # Print judge evaluation if triggered
    if [ -n "$judge_task" ]; then
      echo -e "${PURPLE}Judge Verdict:${NC} Task='${BOLD}$judge_task${NC}', Complexity=${BOLD}${judge_complexity}/10${NC}, Recommended Tier='${BOLD}${judge_tier}${NC}'"
    fi
    
    # Extract preview text
    preview=$(echo "$body" | grep -o '"text":"[^"]*' | head -n 1 | cut -d'"' -f4 | cut -c1-120)
    if [ -z "$preview" ]; then
      # Check if tool_use was invoked
      tool_preview=$(echo "$body" | grep -o '"name":"[^"]*' | head -n 1 | cut -d'"' -f4)
      if [ -n "$tool_preview" ]; then
        preview="Tool Call Invocation: $tool_preview"
      else
        preview=$(echo "$body" | cut -c1-120)
      fi
    fi
    echo -e "${BLUE}Response Preview:${NC} $preview..."
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
echo -e "                         TEST EXECUTION SUMMARY                       "
echo -e "======================================================================${NC}"
printf "%-30s : ${GREEN}${BOLD}%-5d${NC}\n" "Passed Tests" "$passed"
printf "%-30s : ${RED}${BOLD}%-5d${NC}\n" "Failed / Errors" "$failed"
echo -e "${CYAN}======================================================================${NC}"

if [ "$passed" -eq 15 ]; then
  echo -e "${BOLD}${GREEN}All 15 Smart Routing test transactions completed successfully!${NC}"
else
  echo -e "${BOLD}${YELLOW}Completed with $passed passed, $failed failed out of 15 tests.${NC}"
fi
