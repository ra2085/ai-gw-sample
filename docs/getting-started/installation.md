# Installation & Setup

To configure, generate, and deploy the **Apigee AI Gateway**, install the required CLI tools on your workstation or CI/CD environment.

---

## 1. Prerequisites Overview

| Tool | Purpose | Installation Method |
| :--- | :--- | :--- |
| **`apigee-go-gen`** | Declarative YAML &rarr; Apigee Proxy compiler | Binary download, Homebrew, or `go install` |
| **`apigeecli`** | Apigee deployment & management CLI | `curl \| bash` or Homebrew |
| **`gcloud`** | Google Cloud authentication & IAM | Google Cloud SDK |

---

## 2. Install CLI Tools

### Install `apigee-go-gen` (Template Generator)

=== "Automated Install Script (Recommended)"
    ```bash
    # Install latest version into /usr/local/bin
    curl -s https://apigee.github.io/apigee-go-gen/install | sh
    ```

    To install to a custom directory (e.g. `~/.local/bin`):
    ```bash
    curl -s https://apigee.github.io/apigee-go-gen/install | sh -s latest ~/.local/bin
    ```

=== "From Source (with Go)"
    ```bash
    go install github.com/apigee/apigee-go-gen/cmd/...@latest
    ```

=== "Manual Download"
    Download the pre-compiled binary tarball for your OS and architecture from [GitHub Releases](https://github.com/apigee/apigee-go-gen/releases), extract it, and place `apigee-go-gen` into your `$PATH`.

Verify installation:
```bash
apigee-go-gen --help
```


---

### Install `apigeecli` (Deployment CLI)

=== "Automated Install Script (Recommended)"
    ```bash
    # Install latest version into ~/.apigeecli/bin
    curl -L https://raw.githubusercontent.com/apigee/apigeecli/main/downloadLatest.sh | sh -
    export PATH=$PATH:$HOME/.apigeecli/bin
    ```

    To install to a custom directory or specific version:
    ```bash
    curl -L https://raw.githubusercontent.com/apigee/apigeecli/main/downloadLatest.sh | sh -s -- -v <version> -b /usr/local/bin
    ```

=== "Homebrew (macOS / Linux)"
    ```bash
    brew install apigeecli
    ```


=== "From Source (with Go)"
    ```bash
    go install github.com/apigee/apigeecli/cmd/apigeecli@latest
    ```

=== "Manual Download"
    Download the pre-compiled binary package for your operating system from [apigeecli GitHub Releases](https://github.com/apigee/apigeecli/releases), extract it, and add it to your `$PATH`.

Verify installation:
```bash
apigeecli version
```


---

## 3. Google Cloud Authentication

Authenticate with Google Cloud and set your target project:

```bash
export PROJECT_ID="your-gcp-project-id"
export APIGEE_ENV="eval"

gcloud config set project "$PROJECT_ID"
gcloud auth login
gcloud auth application-default login
```

---

## 4. Service Account & IAM Setup (Required for Deployment)

Because the AI Gateway template configures Google Cloud IAM authentication (`<GoogleAccessToken>`) across its TargetEndpoints and communicates with Vertex AI / Model Armor, **a Google Cloud Service Account is mandatory at deployment time**.

### Create the Service Account

```bash
export SERVICE_ACCOUNT="ai-gateway-sa@${PROJECT_ID}.iam.gserviceaccount.com"

# 1. Create service account
gcloud iam service-accounts create ai-gateway-sa \
    --description="Apigee AI Gateway Runtime Service Account" \
    --display-name="ai-gateway-sa"

# 2. Grant Vertex AI User role (required for Gemini & Claude on Vertex AI)
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:$SERVICE_ACCOUNT" \
    --role="roles/aiplatform.user"

# 3. Grant Model Armor User role (optional: required if Model Armor feature is enabled)
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:$SERVICE_ACCOUNT" \
    --role="roles/modelarmor.user"
```

> [!IMPORTANT]
> Always pass this service account using `-s "$SERVICE_ACCOUNT"` (or `--sa`) when deploying with `apigeecli`. Apigee requires an attached service account whenever `<Authentication>` elements exist in the proxy bundle.

---

## 5. Create Data Collectors (Required One-Time Organization Setup)

Apigee captures real-time token metrics, micro-transaction costs, and identity attribution (`user_id`, `persona`, `team`) into **Data Collectors**. If these Data Collectors do not exist in your Apigee organization, Apigee will reject the proxy deployment.

Run this loop once per organization to create all **18 required Data Collectors** (covering granular token types, per-type USD costs, model routing, and identity attribution):

```bash
for dc in \
  "dc_prompt_token_count:INTEGER" \
  "dc_uncached_prompt_token_count:INTEGER" \
  "dc_cache_read_token_count:INTEGER" \
  "dc_cache_write_token_count:INTEGER" \
  "dc_thinking_token_count:INTEGER" \
  "dc_completion_token_count:INTEGER" \
  "dc_total_token_count:INTEGER" \
  "dc_model:STRING" \
  "dc_requested_model:STRING" \
  "dc_tx_uncached_prompt_cost_usd:FLOAT" \
  "dc_tx_cache_read_cost_usd:FLOAT" \
  "dc_tx_cache_write_cost_usd:FLOAT" \
  "dc_tx_prompt_cost_usd:FLOAT" \
  "dc_tx_completion_cost_usd:FLOAT" \
  "dc_tx_cost_usd:FLOAT" \
  "dc_identity_user_id:STRING" \
  "dc_identity_persona:STRING" \
  "dc_identity_team:STRING"; do
  IFS=":" read -r name type <<< "$dc"
  apigeecli datacollectors create -o "$PROJECT_ID" -n "$name" -p "$type" --default-token || true
done
```

---

## 6. Provision AI Products & Persona Apps (`scripts/sync-personas.sh`)

To enforce per-model token counters (`LLMTokenQuota`) and authenticate API Keys or SSO/Agent tokens, Apigee requires **API Products** (configured with `llmOperationGroup` model quotas), a **Developer**, and **Developer Apps** (`client_id` / Consumer Keys).

Instead of creating these manually in the Apigee UI, run [`scripts/sync-personas.sh`](https://github.com/ra2085/ai-gw-sample/blob/main/scripts/sync-personas.sh) to automatically provision or update them directly from your `values.yaml`:

```bash
# 1. Preview the API Products (llmOperationGroup) & Developer Apps (zero network calls)
bash ./scripts/sync-personas.sh \
    --values ./templates/ai-gateway/values.yaml \
    --org "$PROJECT_ID" \
    --env "$APIGEE_ENV" \
    --dry-run

# 2. Create or update the Developer, API Products, and Developer Apps in Apigee
bash ./scripts/sync-personas.sh \
    --values ./templates/ai-gateway/values.yaml \
    --org "$PROJECT_ID" \
    --env "$APIGEE_ENV"
```

* **What it creates:**
  1. A dedicated Persona owner Developer (`ai-gateway-personas@<PROJECT_ID>.iam.gserviceaccount.com`).
  2. An Apigee **API Product** per persona (`<proxy>-<persona>`, e.g., `ai-gateway-developer`, `ai-gateway-knowledge-worker`) with `llmOperationGroup.operationConfigs` populated for every concrete allowed model in your catalog and any `per_model` token quota limits.
  3. A **Developer App** per persona (`<proxy>-<persona>-app`) and prints a ready-to-paste `values.yaml` snippet containing each app's `client_id` (Consumer Key), which also serves as an `$API_KEY` for direct CLI testing.
* **Safe to re-run at any time:** The script is strictly additive (create-or-update only), never deletes existing products or apps, and preserves existing Consumer Keys without rotating them.

