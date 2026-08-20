# End-to-End Walkthrough
 
Deploy the complete Apigee AI Gateway in 3 simple steps using declarative templates.

> [!NOTE]
> **Prerequisites:** Ensure you have `apigee-go-gen` and `apigeecli` installed and Google Cloud authenticated. If you haven't completed this yet, see the [Installation & Setup Guide](installation.md).

---

## Step 1: Customize `values.yaml`


Navigate to [`templates/ai-gateway/values.yaml`](../template-guide/configuration.md) and configure your project ID, enabled models, and features:

```yaml
gateway:
  name: "ai-gateway"
  displayName: "Apigee Enterprise AI Gateway"
  project_id: "your-gcp-project-id"

features:
  monetization:
    enabled: true
  model_armor:
    enabled: true
    template_id: "projects/your-gcp-project-id/locations/global/templates/ai-gateway-filter"
  llm_judge:
    enabled: true
  quotas:
    enabled: true
```

---

## Step 2: Render the API Proxy Bundle

Use `apigee-go-gen` to render the bundle from the template:

```bash
apigee-go-gen render apiproxy \
    --template ./templates/ai-gateway/apiproxy.yaml \
    --values ./templates/ai-gateway/values.yaml \
    --output ./out/ai-gateway.zip
```

> [!TIP]
> You can also preview the rendered XML before bundling using `--dry-run xml`:
> ```bash
> apigee-go-gen render apiproxy \
>     --template ./templates/ai-gateway/apiproxy.yaml \
>     --values ./templates/ai-gateway/values.yaml \
>     --dry-run xml
> ```

---

## Step 3: Deploy to Apigee

Deploy the generated `.zip` bundle to your Apigee environment. A Service Account with `roles/aiplatform.user` is required at deploy time because the TargetEndpoints authenticate against Vertex AI using Google IAM tokens:

```bash
export SERVICE_ACCOUNT="ai-gateway-sa@${PROJECT_ID}.iam.gserviceaccount.com"

apigeecli apis create bundle \
    --proxy-zip ./out/ai-gateway.zip \
    --name ai-gateway \
    --org "$PROJECT_ID" \
    --env "$APIGEE_ENV" \
    -s "$SERVICE_ACCOUNT" \
    --ovr \
    --wait \
    --default-token
```


---

## Step 4: Test Your Gateway

Send a request using your favorite SDK or `curl`:

=== "Claude Messages (/v1/messages)"
    ```bash
    curl -X POST "https://$APIGEE_HOSTNAME/v1/messages" \
      -H "x-apikey: $API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "model": "claude-haiku-4-5",
        "max_tokens": 1024,
        "messages": [{"role": "user", "content": "Explain quantum computing in one sentence."}]
      }'
    ```

=== "Gemini Native (/ai-gateway)"
    ```bash
    curl -X POST "https://$APIGEE_HOSTNAME/ai-gateway" \
      -H "x-apikey: $API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "contents": [{"role": "user", "parts": [{"text": "Hello Gemini!"}]}]
      }'
    ```

=== "OpenAI Compatibility (/v1/chat/completions)"
    ```bash
    curl -X POST "https://$APIGEE_HOSTNAME/v1/chat/completions" \
      -H "x-apikey: $API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "model": "gpt-4o",
        "messages": [{"role": "user", "content": "Hello!"}]
      }'
    ```
