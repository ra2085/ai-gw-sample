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

URL="https://${APIGEE_HOST}/ai-gateway/v1/projects/${PROJECT_ID}/locations/us-central1/publishers/google/models/gemini-3.5-flash:generateContent"

echo "Sending non-streaming request to native Gemini endpoint..."
echo "URL: $URL"

json_payload=$(cat <<EOF
{
  "contents": [
    {
      "role": "user",
      "parts": [
        {
          "text": "Respond in one short sentence describing gravity."
        }
      ]
    }
  ]
}
EOF
)

response=$(curl -s -w "\n%{http_code}" -X POST "$URL" \
  -H "Content-Type: application/json" \
  -H "x-apikey: $API_KEY" \
  -H "X-Claude-Code-Session-Id: sess_gemini_native_test" \
  -d "$json_payload")

http_code=$(echo "$response" | tail -n 1)
body=$(echo "$response" | sed '$d')

echo "HTTP Code: $http_code"
echo "Response Body:"
echo "$body" | head -n 30
