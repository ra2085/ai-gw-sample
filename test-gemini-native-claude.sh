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
PROJECT_ID="${2:-$PROJECT_ID}"
API_KEY="${3:-$API_KEY}"

if [ -z "$APIGEE_HOST" ] || [ -z "$PROJECT_ID" ] || [ -z "$API_KEY" ]; then
  echo "Error: APIGEE_HOST, PROJECT_ID, and API_KEY are required."
  echo "Usage: $0 <apigee-host> <project-id> <api-key>"
  echo "   or: APIGEE_HOST=... PROJECT_ID=... API_KEY=... $0"
  exit 1
fi

echo -e "${BOLD}${CYAN}======================================================================"
echo -e "   Testing Claude routing from Gemini Native endpoint (/ai-gateway)   "
echo -e "======================================================================${NC}"

# Test Case 1: Non-Streaming rawPredict
URL_NON_STREAM="https://${APIGEE_HOST}/ai-gateway/v1/projects/${PROJECT_ID}/locations/us-central1/publishers/anthropic/models/claude-haiku-4-5:rawPredict"
echo -e "\n${BOLD}${YELLOW}[Test 1: Non-Streaming rawPredict]${NC}"
echo -e "${CYAN}URL:${NC} $URL_NON_STREAM"

json_payload_non_stream=$(cat <<EOF
{
  "max_tokens": 1024,
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
  -H "X-Claude-Code-Session-Id: sess_gemini_native_claude_nonstream" \
  -d "$json_payload_non_stream")

http_code_ns=$(echo "$response_non_stream" | tail -n 1)
body_ns=$(echo "$response_non_stream" | sed '$d')

echo -e "HTTP Code: $http_code_ns"
if [ "$http_code_ns" -eq 200 ]; then
  echo -e "${GREEN}${BOLD}✓ SUCCESS${NC}"
  preview_ns=$(echo "$body_ns" | grep -o '"text":"[^"]*' | head -n 1 | cut -d'"' -f4 | cut -c1-120)
  if [ -z "$preview_ns" ]; then
    preview_ns=$(echo "$body_ns" | cut -c1-120)
  fi
  echo -e "${BLUE}Response Preview:${NC} $preview_ns"
else
  echo -e "${RED}${BOLD}✗ FAILED${NC}"
  echo -e "${RED}Response Body:${NC} $body_ns"
fi

# Test Case 2: Streaming streamRawPredict
URL_STREAM="https://${APIGEE_HOST}/ai-gateway/v1/projects/${PROJECT_ID}/locations/us-central1/publishers/anthropic/models/claude-haiku-4-5:streamRawPredict"
echo -e "\n${BOLD}${YELLOW}[Test 2: Streaming streamRawPredict]${NC}"
echo -e "${CYAN}URL:${NC} $URL_STREAM"

json_payload_stream=$(cat <<EOF
{
  "max_tokens": 1024,
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
  -H "X-Claude-Code-Session-Id: sess_gemini_native_claude_stream" \
  -d "$json_payload_stream")

http_code_stream=$(echo "$response_stream" | tail -n 1)
body_stream=$(echo "$response_stream" | sed '$d')

echo -e "HTTP Code: $http_code_stream"
if [ "$http_code_stream" -eq 200 ]; then
  echo -e "${GREEN}${BOLD}✓ SUCCESS${NC}"
  preview_stream=$(echo "$body_stream" | grep -o '"text":"[^"]*' | head -n 1 | cut -d'"' -f4 | cut -c1-120)
  if [ -z "$preview_stream" ]; then
    preview_stream=$(echo "$body_stream" | cut -c1-120)
  fi
  echo -e "${BLUE}Response Preview:${NC} $preview_stream"
else
  echo -e "${RED}${BOLD}✗ FAILED${NC}"
  echo -e "${RED}Response Body:${NC} $body_stream"
fi
