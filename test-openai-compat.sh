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

echo -e "${BOLD}${CYAN}======================================================================"
echo -e "         Testing OpenAI compatibility endpoint (/openai/v1)           "
echo -e "======================================================================${NC}"

# Test Case 1: Non-Streaming chat/completions
URL_NON_STREAM="https://${APIGEE_HOST}/v1/chat/completions"
echo -e "\n${BOLD}${YELLOW}[Test 1: Non-Streaming chat/completions]${NC}"
echo -e "${CYAN}URL:${NC} $URL_NON_STREAM"

json_payload_non_stream=$(cat <<EOF
{
  "model": "gemini-3.1-flash-lite",
  "messages": [
    {
      "role": "user",
      "content": "Describe gravity in one short sentence."
    }
  ]
}
EOF
)

response_non_stream=$(curl -s -w "\n%{http_code}" -X POST "$URL_NON_STREAM" \
  -H "Content-Type: application/json" \
  -H "x-apikey: $API_KEY" \
  -H "X-Claude-Code-Session-Id: sess_openai_compat_nonstream" \
  -d "$json_payload_non_stream")

http_code_ns=$(echo "$response_non_stream" | tail -n 1)
body_ns=$(echo "$response_non_stream" | sed '$d')

echo -e "HTTP Code: $http_code_ns"
if [ "$http_code_ns" -eq 200 ]; then
  echo -e "${GREEN}${BOLD}✓ SUCCESS${NC}"
  preview_ns=$(echo "$body_ns" | grep -o '"content":"[^"]*' | head -n 1 | cut -d'"' -f4 | cut -c1-120)
  if [ -z "$preview_ns" ]; then
    preview_ns=$(echo "$body_ns" | cut -c1-120)
  fi
  echo -e "${BLUE}Response Preview:${NC} $preview_ns"
else
  echo -e "${RED}${BOLD}✗ FAILED${NC}"
  echo -e "${RED}Response Body:${NC} $body_ns"
fi

# Test Case 2: Streaming chat/completions
URL_STREAM="https://${APIGEE_HOST}/v1/chat/completions"
echo -e "\n${BOLD}${YELLOW}[Test 2: Streaming chat/completions]${NC}"
echo -e "${CYAN}URL:${NC} $URL_STREAM"

json_payload_stream=$(cat <<EOF
{
  "model": "gemini-3.1-flash-lite",
  "messages": [
    {
      "role": "user",
      "content": "Describe entropy in one short sentence."
    }
  ],
  "stream": true
}
EOF
)

response_stream=$(curl -s -w "\n%{http_code}" -X POST "$URL_STREAM" \
  -H "Content-Type: application/json" \
  -H "x-apikey: $API_KEY" \
  -H "X-Claude-Code-Session-Id: sess_openai_compat_stream" \
  -d "$json_payload_stream")

http_code_stream=$(echo "$response_stream" | tail -n 1)
body_stream=$(echo "$response_stream" | sed '$d')

echo -e "HTTP Code: $http_code_stream"
if [ "$http_code_stream" -eq 200 ]; then
  echo -e "${GREEN}${BOLD}✓ SUCCESS${NC}"
  preview_stream=$(echo "$body_stream" | grep -o '"content":"[^"]*' | head -n 1 | cut -d'"' -f4 | cut -c1-120)
  if [ -z "$preview_stream" ]; then
    preview_stream=$(echo "$body_stream" | cut -c1-120)
  fi
  echo -e "${BLUE}Response Preview:${NC} $preview_stream"
else
  echo -e "${RED}${BOLD}✗ FAILED${NC}"
  echo -e "${RED}Response Body:${NC} $body_stream"
fi
