#!/bin/bash

# ==============================================================================
# Apigee AI Gateway - LLM Judge Prompt Benchmark Test Suite (15 Crafty Prompts)
# ==============================================================================
# Tests `{"model": "auto:judge"}` and `{"model": "gateway/judge"}` against 15
# diverse, challenging, and crafty prompts to benchmark the Judge classifier:
#   - Adversarial / Gateway Jailbreak Attempts
#   - Complex Distributed Systems & Architecture
#   - Recursive SQL CTEs & Deadlock Debugging
#   - Multi-Hop Logical & Mathematical Puzzles
#   - Sarcasm Detection & Polyglot Legal Translation
#   - Low-Complexity Conversational & Conversion Queries
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

URL="https://${APIGEE_HOST}/v1/messages"

echo -e "${BOLD}${CYAN}======================================================================"
echo -e "   Apigee AI Gateway - LLM Judge 15 Crafty Prompts Benchmark Suite   "
echo -e "======================================================================${NC}"
echo -e "${YELLOW}Target Endpoint:${NC} ${BOLD}${URL}${NC}"
echo -e "${YELLOW}API Key Prefix:${NC} ${BOLD}${API_KEY:0:8}...${NC}"
echo -e "----------------------------------------------------------------------"

# 15 Crafty Test Cases specifically using `auto:judge` and `gateway/judge`
declare -a test_names=(
  "1. Zero-Knowledge Cryptography & zk-SNARKs Circuit Verification (auto:judge)"
  "2. Multi-Region Active-Active Cloud Architecture (gateway/judge)"
  "3. Subtle Go Concurrency Deadlock & Race Condition (auto:judge)"
  "4. Encoded Cipher / Cryptographic Puzzle (gateway/judge)"
  "5. Simple One-Liner Bash Command (auto:judge)"
  "6. Recursive PostgreSQL CTE Tree Generation (gateway/judge)"
  "7. Sarcasm & Nuanced Tone Sentiment Analysis (auto:judge)"
  "8. Complex Mortgage Amortization & Compounding Math (gateway/judge)"
  "9. Multilingual Legal Contract Clause Translation (auto:judge)"
  "10. Strict RFC 5322 Regular Expression Synthesis (gateway/judge)"
  "11. Philosophy vs Cloud Identity Paradox (auto:judge)"
  "12. Trivial Spelling & Grammar Fix (gateway/judge)"
  "13. Distributed Raft Consensus Algorithm Breakdown (auto:judge)"
  "14. Fast Temperature Unit Conversion (gateway/judge)"
  "15. Linux Kernel Slab vs Fragmentation Analysis (auto:judge)"
)

declare -a test_payloads=(
  # 1. Zero-Knowledge Cryptography
  '{"model":"auto:judge","max_tokens":128,"messages":[{"role":"user","content":"Explain how zero-knowledge Succinct Non-Interactive Arguments of Knowledge (zk-SNARKs) verify arithmetic circuits without revealing private witness inputs."}]}'
  
  # 2. Cloud Architecture
  '{"model":"gateway/judge","max_tokens":128,"messages":[{"role":"user","content":"Architect an active-active multi-region event-driven data pipeline on Google Cloud using Pub/Sub, Dataflow, and BigQuery with zero data loss guarantee."}]}'
  
  # 3. Concurrency Deadlock Debugging
  '{"model":"auto:judge","max_tokens":128,"messages":[{"role":"user","content":"In Go, if a goroutine publishes to a channel after sync.WaitGroup.Wait() without closing the channel, explain the exact deadlock mechanics and provide the fix."}]}'
  
  # 4. Cipher Puzzle
  '{"model":"gateway/judge","max_tokens":128,"messages":[{"role":"user","content":"Decode this Caesar cipher shifted by 13: \"Uryyb jbeyq\" and explain how ROT13 works mathematically."}]}'
  
  # 5. Simple Bash
  '{"model":"auto:judge","max_tokens":64,"messages":[{"role":"user","content":"What is the single bash command to count lines in a text file?"}]}'
  
  # 6. Recursive SQL CTE
  '{"model":"gateway/judge","max_tokens":128,"messages":[{"role":"user","content":"Write a recursive PostgreSQL CTE query that traverses an employee-manager hierarchy table and prints the org hierarchy tree."}]}'
  
  # 7. Sarcasm Detection
  '{"model":"auto:judge","max_tokens":128,"messages":[{"role":"user","content":"Evaluate the underlying sentiment and explain any sarcasm in: \"Oh fantastic, the prod server crashed during Black Friday. 10/10 would deploy again!\""}]}'
  
  # 8. Financial Math
  '{"model":"gateway/judge","max_tokens":128,"messages":[{"role":"user","content":"Calculate the monthly payment on a $500,000 fixed mortgage at 6.5% interest for 30 years using the standard annuity formula: M = P[r(1+r)^n]/[(1+r)^n - 1]."}]}'
  
  # 9. Multilingual Legal Translation
  '{"model":"auto:judge","max_tokens":128,"messages":[{"role":"user","content":"Translate this legal indemnity clause into German and Spanish: \"The party shall hold harmless and indemnify the operator against all third-party claims.\""}]}'
  
  # 10. Complex Regex
  '{"model":"gateway/judge","max_tokens":128,"messages":[{"role":"user","content":"Write a robust regular expression to validate semver 2.0.0 strings (major.minor.patch-prerelease+buildmetadata) with full group breakdown."}]}'
  
  # 11. Philosophy vs Cloud
  '{"model":"auto:judge","max_tokens":128,"messages":[{"role":"user","content":"Compare the Ship of Theseus paradox with immutable infrastructure and container lifecycle in Kubernetes."}]}'
  
  # 12. Trivial Grammar
  '{"model":"gateway/judge","max_tokens":64,"messages":[{"role":"user","content":"Correct spelling and grammar: \"they is going to there house with two dogs\""}]}'
  
  # 13. Raft Consensus
  '{"model":"auto:judge","max_tokens":128,"messages":[{"role":"user","content":"Explain how the Raft consensus algorithm guarantees safety during network partitions in 3 succinct points."}]}'
  
  # 14. Unit Conversion
  '{"model":"gateway/judge","max_tokens":64,"messages":[{"role":"user","content":"Convert 98.6 degrees Fahrenheit to Celsius."}]}'
  
  # 15. Kernel Memory Analysis
  '{"model":"auto:judge","max_tokens":128,"messages":[{"role":"user","content":"Compare Linux kernel SLUB allocator cache leakage with user-space heap memory fragmentation."}]}'
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
  echo -e "${CYAN}Payload:${NC} $(echo "$payload" | cut -c1-110)..."
  
  # Execute request capturing HTTP code and response headers
  response_file=$(mktemp)
  headers_file=$(mktemp)
  
  http_code=$(curl -s -D "$headers_file" -o "$response_file" -w "%{http_code}" -X POST "$URL" \
    -H "Content-Type: application/json" \
    -H "x-apikey: $API_KEY" \
    -H "X-Client: apigee-judge-prompts-benchmark" \
    -d "$payload")
  
  body=$(cat "$response_file")
  
  # Extract Judge & Gateway response headers
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
    
    # Print Judge Verdict
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
    
    # Extract preview text
    preview=$(echo "$body" | grep -o '"text":"[^"]*' | head -n 1 | cut -d'"' -f4 | cut -c1-120)
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
echo -e "                LLM JUDGE PROMPTS BENCHMARK SUMMARY                   "
echo -e "======================================================================${NC}"
printf "%-30s : ${GREEN}${BOLD}%-5d${NC}\n" "Passed Tests" "$passed"
printf "%-30s : ${RED}${BOLD}%-5d${NC}\n" "Failed / Errors" "$failed"
echo -e "${CYAN}======================================================================${NC}"

if [ "$passed" -eq 15 ]; then
  echo -e "${BOLD}${GREEN}All 15 Crafty Judge Benchmark test transactions completed successfully!${NC}"
else
  echo -e "${BOLD}${YELLOW}Completed with $passed passed, $failed failed out of 15 tests.${NC}"
fi
