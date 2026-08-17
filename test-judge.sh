#!/bin/bash

# ==============================================================================
# Apigee AI Gateway - LLM as a Judge Test Suite (15 runs)
# ==============================================================================
# Evaluates the fast LLM Judge (Gemini 3.1 Flash-Lite) prompt classifier:
#   1. Automatic Task Domain Detection (simple_chat, coding, reasoning, summarization)
#   2. Dynamic Complexity Scoring (1-10 scale)
#   3. Cost-Tier & Route Selection (low -> gemini-3.1-flash-lite, medium -> gemini-3.5-flash, high -> gemini-2.5-pro)
#   4. Multi-Protocol Support (Claude Messages, Gemini Native, OpenAI Compat, Streaming)
# ==============================================================================

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
PROJECT_ID="${3:-$PROJECT_ID}"

if [ -z "$APIGEE_HOST" ] || [ -z "$API_KEY" ]; then
  echo -e "${RED}Error: APIGEE_HOST and API_KEY are required.${NC}"
  echo -e "Usage: $0 <apigee-host> <api-key> [project-id]"
  echo -e "   or: APIGEE_HOST=... API_KEY=... $0"
  exit 1
fi

echo -e "${BOLD}${CYAN}======================================================================"
echo -e "         Apigee AI Gateway LLM as a Judge Test Suite (15 runs)        "
echo -e "======================================================================${NC}"
echo -e "${YELLOW}Host:${NC} ${BOLD}${APIGEE_HOST}${NC}"
echo -e "${YELLOW}API Key Prefix:${NC} ${BOLD}${API_KEY:0:8}...${NC}"
echo -e "----------------------------------------------------------------------"

# 15 Specific Test Cases for LLM Judge
declare -a test_names=(
  "1. Simple Conversational Query (Low Complexity -> Low Tier)"
  "2. Factual Knowledge Lookup (Low Complexity -> Low Tier)"
  "3. Text Summarization Task (Summarization -> Low/Medium Tier)"
  "4. Basic Scripting (Coding Task -> Medium Tier)"
  "5. Complex Graph Algorithm with Heap (Coding Task -> High Tier)"
  "6. Mathematical & Algebraic Problem (Reasoning -> High Tier)"
  "7. Multi-Step Logic Deduction Puzzle (Reasoning -> High Tier)"
  "8. Advanced SQL Query & Index Optimization (Coding -> Medium/High Tier)"
  "9. Multilingual Cultural Translation (General -> Low/Medium Tier)"
  "10. Direct Plugin Invocation format (id: judge)"
  "11. Model Alias format (model: auto:judge)"
  "12. Gemini Native Endpoint (/ai-gateway)"
  "13. OpenAI Compatibility Endpoint (/v1/chat/completions)"
  "14. Streaming Message Evaluation (stream: true)"
  "15. Multi-Turn Conversational Context Evaluation"
)

declare -a test_endpoints=(
  "https://${APIGEE_HOST}/v1/messages"
  "https://${APIGEE_HOST}/v1/messages"
  "https://${APIGEE_HOST}/v1/messages"
  "https://${APIGEE_HOST}/v1/messages"
  "https://${APIGEE_HOST}/v1/messages"
  "https://${APIGEE_HOST}/v1/messages"
  "https://${APIGEE_HOST}/v1/messages"
  "https://${APIGEE_HOST}/v1/messages"
  "https://${APIGEE_HOST}/v1/messages"
  "https://${APIGEE_HOST}/v1/messages"
  "https://${APIGEE_HOST}/v1/messages"
  "https://${APIGEE_HOST}/ai-gateway/v1/projects/${PROJECT_ID}/locations/global/publishers/google/models/gemini-3.5-flash:generateContent"
  "https://${APIGEE_HOST}/v1/chat/completions"
  "https://${APIGEE_HOST}/v1/messages"
  "https://${APIGEE_HOST}/v1/messages"
)

declare -a test_payloads=(
  # 1. Simple Conversational
  '{"plugins":[{"id":"auto-router","judge":true}],"max_tokens":128,"messages":[{"role":"user","content":"Good morning! How are you doing today?"}]}'
  
  # 2. Factual Knowledge
  '{"plugins":[{"id":"auto-router","judge":true}],"max_tokens":128,"messages":[{"role":"user","content":"What is the boiling point of water in Celsius and Fahrenheit?"}]}'
  
  # 3. Text Summarization
  '{"plugins":[{"id":"auto-router","judge":true}],"max_tokens":128,"messages":[{"role":"user","content":"Summarize the following in one sentence: Photosynthesis is a biological process utilized by green plants and certain photosynthetic organisms to transform light energy into chemical energy stored in glucose."}]}'
  
  # 4. Basic Scripting
  '{"plugins":[{"id":"auto-router","judge":true}],"max_tokens":128,"messages":[{"role":"user","content":"Write a quick Python function that accepts a list of integers and returns only the even numbers sorted."}]}'
  
  # 5. Complex Graph Algorithm
  '{"plugins":[{"id":"auto-router","judge":true}],"max_tokens":128,"messages":[{"role":"user","content":"Implement Dijkstra shortest path algorithm in Python using heapq with time and space complexity analysis."}]}'
  
  # 6. Mathematical Reasoning
  '{"plugins":[{"id":"auto-router","judge":true}],"max_tokens":128,"messages":[{"role":"user","content":"A train leaves Station A travelling at 60 mph. Two hours later, a second train leaves Station A travelling at 90 mph on a parallel track. How long will it take for the second train to overtake the first?"}]}'
  
  # 7. Logic Deduction
  '{"plugins":[{"id":"auto-router","judge":true}],"max_tokens":128,"messages":[{"role":"user","content":"Three boxes are labeled: Apples, Oranges, and Mixed. Every box is mislabeled. You pick one fruit from the box labeled Mixed. How do you determine the correct labels for all three boxes?"}]}'
  
  # 8. SQL Optimization
  '{"plugins":[{"id":"auto-router","judge":true}],"max_tokens":128,"messages":[{"role":"user","content":"Write an optimized PostgreSQL query using window functions (ROW_NUMBER) to find the top 3 highest-earning employees per department, including suggested composite B-Tree indexes."}]}'
  
  # 9. Multilingual Translation
  '{"plugins":[{"id":"auto-router","judge":true}],"max_tokens":128,"messages":[{"role":"user","content":"Translate the idiom It is raining cats and dogs into idiomatic conversational Spanish and French with explanations."}]}'
  
  # 10. Plugin format: id="judge"
  '{"plugins":[{"id":"judge"}],"max_tokens":128,"messages":[{"role":"user","content":"Explain how public-key cryptography (RSA) functions mathematically."}]}'
  
  # 11. Model alias: auto:judge
  '{"model":"auto:judge","max_tokens":128,"messages":[{"role":"user","content":"Explain how quantum superposition differs from classical probability."}]}'
  
  # 12. Gemini Native Endpoint (/ai-gateway)
  '{"plugins":[{"id":"auto-router","judge":true}],"contents":[{"role":"user","parts":[{"text":"Write a quick binary search function in Go."}]}]}'
  
  # 13. OpenAI Compatibility Endpoint (/v1/chat/completions)
  '{"plugins":[{"id":"auto-router","judge":true}],"max_tokens":128,"messages":[{"role":"user","content":"Write a JavaScript function to debounce an API input handler."}]}'
  
  # 14. Streaming Message Evaluation
  '{"plugins":[{"id":"auto-router","judge":true}],"stream":true,"max_tokens":128,"messages":[{"role":"user","content":"List 3 reasons why unit testing is essential in software engineering."}]}'
  
  # 15. Multi-Turn Conversational Context
  '{"plugins":[{"id":"auto-router","judge":true}],"max_tokens":128,"messages":[{"role":"user","content":"We are building a distributed cache in Go."},{"role":"assistant","content":"Sounds great! What cache replacement policy do you plan to use?"},{"role":"user","content":"Please write the implementation of a concurrent thread-safe LRU cache using mutexes and doubly-linked lists."}]}'
)

# Trackers
passed=0
failed=0

# Loop through all 15 test cases
for i in "${!test_names[@]}"; do
  name="${test_names[i]}"
  url="${test_endpoints[i]}"
  payload="${test_payloads[i]}"
  count=$((i+1))
  
  echo -e "\n${BOLD}${YELLOW}[Test $count/15] ${name}${NC}"
  echo -e "${CYAN}Target URL:${NC} $url"
  echo -e "${CYAN}Payload:${NC} $(echo "$payload" | cut -c1-110)..."
  
  # Execute request capturing HTTP code and response headers
  response_file=$(mktemp)
  headers_file=$(mktemp)
  
  http_code=$(curl -s -D "$headers_file" -o "$response_file" -w "%{http_code}" -X POST "$url" \
    -H "Content-Type: application/json" \
    -H "x-apikey: $API_KEY" \
    -H "X-Client: apigee-llm-judge-test" \
    -d "$payload")
  
  body=$(cat "$response_file")
  
  # Extract Judge & Gateway headers
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
    
    # Print judge evaluation
    if [ -n "$judge_task" ]; then
      echo -e "${PURPLE}${BOLD}Judge Verdict:${NC} Task='${BOLD}${CYAN}$judge_task${NC}', Complexity=${BOLD}${YELLOW}${judge_complexity}/10${NC}, Recommended Tier='${BOLD}${GREEN}${judge_tier}${NC}'"
    fi
    
    if [ -n "$requested_model" ]; then
      echo -e "${BLUE}Requested Model Header:${NC} $requested_model"
    fi
    if [ -n "$routed_model" ]; then
      echo -e "${BLUE}Routed Model Header:${NC} ${BOLD}$routed_model${NC}"
    fi
    if [ -n "$cost_tier" ]; then
      echo -e "${BLUE}Cost Tier Applied:${NC} $cost_tier"
    fi
    if [ -n "$fallback_model" ] && [ "$fallback_model" != "none" ]; then
      echo -e "${BLUE}Configured Fallback:${NC} $fallback_model"
    fi
    
    # Extract preview text depending on format (Claude vs OpenAI vs Gemini vs Stream)
    if echo "$payload" | grep -q '"stream":true'; then
      preview=$(echo "$body" | grep -o '"text":"[^"]*' | head -n 3 | cut -d'"' -f4 | tr '\n' ' ' | cut -c1-120)
      if [ -z "$preview" ]; then
        preview="SSE Stream Received"
      fi
    elif echo "$url" | grep -q "/ai-gateway"; then
      preview=$(echo "$body" | grep -o '"text": "[^"]*' | head -n 1 | cut -d'"' -f4 | cut -c1-120)
    elif echo "$url" | grep -q "/v1/chat/completions"; then
      preview=$(echo "$body" | grep -o '"content": "[^"]*' | head -n 1 | cut -d'"' -f4 | cut -c1-120)
    else
      preview=$(echo "$body" | grep -o '"text":"[^"]*' | head -n 1 | cut -d'"' -f4 | cut -c1-120)
    fi
    
    if [ -z "$preview" ]; then
      preview=$(echo "$body" | tr '\n' ' ' | cut -c1-120)
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
echo -e "                 LLM AS A JUDGE TEST EXECUTION SUMMARY                "
echo -e "======================================================================${NC}"
printf "%-30s : ${GREEN}${BOLD}%-5d${NC}\n" "Passed Tests" "$passed"
printf "%-30s : ${RED}${BOLD}%-5d${NC}\n" "Failed / Errors" "$failed"
echo -e "${CYAN}======================================================================${NC}"

if [ "$passed" -eq 15 ]; then
  echo -e "${BOLD}${GREEN}All 15 LLM as a Judge test transactions completed successfully!${NC}"
else
  echo -e "${BOLD}${YELLOW}Completed with $passed passed, $failed failed out of 15 tests.${NC}"
fi
