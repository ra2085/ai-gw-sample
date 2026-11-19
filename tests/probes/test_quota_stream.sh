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

# Terminal Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
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
ITERATIONS=10

echo -e "${CYAN}Starting streaming quota test loop ($ITERATIONS iterations)...${NC}"
echo -e "${YELLOW}URL: $URL${NC}"

for i in $(seq 1 $ITERATIONS); do
  echo -e "\n${YELLOW}[Request $i/$ITERATIONS] Sending...${NC}"

  # Prompt asking for a very short answer
  json_payload=$(cat <<EOF
{
  "model": "claude-haiku-4-5",
  "max_tokens": 10,
  "messages": [
    {
      "role": "user",
      "content": "Respond with only one word: hello"
    }
  ],
  "stream": true
}
EOF
)

  # Execute request and capture response + HTTP code
  response=$(curl -s -w "\n%{http_code}" -X POST "$URL" \
    -H "Content-Type: application/json" \
    -H "x-apikey: $API_KEY" \
    -H "X-Claude-Code-Session-Id: sess_quota_test_$i" \
    -d "$json_payload")

  http_code=$(echo "$response" | tail -n 1)
  body=$(echo "$response" | sed '$d')

  if [ "$http_code" -eq 200 ] || [ "$http_code" -eq 201 ]; then
    echo -e "${GREEN}✓ SUCCESS (HTTP $http_code)${NC}"
    # Extract text from the delta chunks
    preview=$(echo "$body" | grep -o '"text":"[^"]*' | head -n 2 | cut -d'"' -f4 | tr -d '\n')
    echo "Response: $preview"
  elif [ "$http_code" -eq 429 ]; then
    echo -e "${RED}✗ QUOTA EXCEEDED (HTTP $http_code)${NC}"
    echo "Body: $body"
  else
    echo -e "${RED}✗ ERROR / RESPONSE (HTTP $http_code)${NC}"
    echo "Body: $body"
  fi

  # Sleep briefly between calls
  sleep 0.2
done

echo -e "\n${CYAN}Quota test loop complete.${NC}"
