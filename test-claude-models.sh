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

BASE_URL="https://${APIGEE_HOST}/v1/models"

echo -e "${BOLD}${CYAN}======================================================================"
echo -e "       Apigee LLM Gateway Claude Models Endpoint Route Testing Script"
echo -e "======================================================================${NC}"
echo -e "${YELLOW}Base URL:${NC} ${BOLD}${BASE_URL}${NC}"
echo -e "${YELLOW}API Key Prefix:${NC} ${BOLD}${API_KEY:0:8}...${NC}"
echo -e "----------------------------------------------------------------------"

# Test Case 1: List models (Positive)
echo -e "\n${BOLD}${YELLOW}[Test 1] List Available Models (Positive)${NC}"
echo -e "${CYAN}Endpoint:${NC} GET ${BASE_URL}"
response_1=$(curl -s -w "\n%{http_code}" -X GET "${BASE_URL}" \
  -H "x-apikey: ${API_KEY}")
http_code_1=$(echo "$response_1" | tail -n 1)
body_1=$(echo "$response_1" | sed '$d')

echo -e "HTTP Code: ${http_code_1}"
if [ "${http_code_1}" -eq 200 ]; then
  echo -e "${GREEN}${BOLD}✓ SUCCESS${NC}"
  echo -e "${BLUE}Response Body Preview:${NC}"
  echo "$body_1" | python3 -m json.tool 2>/dev/null || echo "$body_1"
else
  echo -e "${RED}${BOLD}✗ FAILED${NC}"
  echo -e "${RED}Response Body:${NC} $body_1"
fi
echo -e "${CYAN}----------------------------------------------------------------------${NC}"

# Test Case 2: Retrieve Claude 3.5 Sonnet (Positive)
echo -e "\n${BOLD}${YELLOW}[Test 2] Retrieve Specific Model - claude-3-5-sonnet (Positive)${NC}"
echo -e "${CYAN}Endpoint:${NC} GET ${BASE_URL}/claude-3-5-sonnet"
response_2=$(curl -s -w "\n%{http_code}" -X GET "${BASE_URL}/claude-3-5-sonnet" \
  -H "x-apikey: ${API_KEY}")
http_code_2=$(echo "$response_2" | tail -n 1)
body_2=$(echo "$response_2" | sed '$d')

echo -e "HTTP Code: ${http_code_2}"
if [ "${http_code_2}" -eq 200 ]; then
  echo -e "${GREEN}${BOLD}✓ SUCCESS${NC}"
  echo -e "${BLUE}Response Body:${NC}"
  echo "$body_2" | python3 -m json.tool 2>/dev/null || echo "$body_2"
else
  echo -e "${RED}${BOLD}✗ FAILED${NC}"
  echo -e "${RED}Response Body:${NC} $body_2"
fi
echo -e "${CYAN}----------------------------------------------------------------------${NC}"

# Test Case 3: Retrieve invalid model (Negative)
echo -e "\n${BOLD}${YELLOW}[Test 3] Retrieve Specific Model - invalid-model-id (Negative)${NC}"
echo -e "${CYAN}Endpoint:${NC} GET ${BASE_URL}/invalid-model-id"
response_3=$(curl -s -w "\n%{http_code}" -X GET "${BASE_URL}/invalid-model-id" \
  -H "x-apikey: ${API_KEY}")
http_code_3=$(echo "$response_3" | tail -n 1)
body_3=$(echo "$response_3" | sed '$d')

echo -e "HTTP Code: ${http_code_3}"
if [ "${http_code_3}" -eq 404 ]; then
  echo -e "${GREEN}${BOLD}✓ SUCCESS (Correctly returned 404)${NC}"
  echo -e "${BLUE}Response Body:${NC}"
  echo "$body_3" | python3 -m json.tool 2>/dev/null || echo "$body_3"
else
  echo -e "${RED}${BOLD}✗ FAILED (Expected 404, got ${http_code_3})${NC}"
  echo -e "${RED}Response Body:${NC} $body_3"
fi
echo -e "${CYAN}----------------------------------------------------------------------${NC}"

# Test Case 4: List models without API key (Negative)
echo -e "\n${BOLD}${YELLOW}[Test 4] List Models Without API Key (Negative)${NC}"
echo -e "${CYAN}Endpoint:${NC} GET ${BASE_URL}"
response_4=$(curl -s -w "\n%{http_code}" -X GET "${BASE_URL}")
http_code_4=$(echo "$response_4" | tail -n 1)
body_4=$(echo "$response_4" | sed '$d')

echo -e "HTTP Code: ${http_code_4}"
if [ "${http_code_4}" -eq 401 ] || [ "${http_code_4}" -eq 403 ] || [ "${http_code_4}" -eq 500 ]; then
  echo -e "${GREEN}${BOLD}✓ SUCCESS (Correctly blocked/failed: HTTP ${http_code_4})${NC}"
else
  echo -e "${RED}${BOLD}✗ FAILED (Expected block/error, got ${http_code_4})${NC}"
  echo -e "${RED}Response Body:${NC} $body_4"
fi
echo -e "${CYAN}======================================================================${NC}"
echo -e "${BOLD}${GREEN}Testing Complete!${NC}"
