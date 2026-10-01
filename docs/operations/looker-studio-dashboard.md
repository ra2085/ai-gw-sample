# Analytics & Looker Studio Reporting Guide

Because the AI Gateway sits in the path of every model call, it captures granular telemetry on **tokenomics, identity attribution, quota enforcement, content safety, and routing decisions**.

This guide provides two ways to build and view reports on your AI Gateway traffic:

1. **Method 1: Instant Apigee Console Custom Reports (5-Second CLI Setup)** — View real-time charts and export CSVs directly inside the Google Cloud Console (`Apigee > Analytics > Custom reports`) with zero external infrastructure.
2. **Method 2: Multi-Page Looker Studio Dashboards (via BigQuery)** — Export Apigee Analytics to BigQuery and connect Looker Studio to a pre-computed SQL View for executive FinOps, peer benchmarking, personal developer insights, and LLM Judge ROI dashboards.

> [!IMPORTANT]
> **Why Looker Studio Uses BigQuery Instead of the Legacy `Apigee` Connector:**
> Looker Studio's built-in **Apigee** connector (`Create More Reports Using Data Studio`) only imports 10 legacy proxy metrics (`Traffic`, `Average Latency`, `API Product`, `Application`) and **does not import custom `dc_*` Data Collectors**.
>
> * To view `dc_*` metrics **immediately without BigQuery**, use **Method 1 (Apigee Console Custom Reports)** below.
> * To build **Looker Studio** dashboards with `dc_tx_cost_usd`, `dc_total_token_count`, `dc_identity_team`, and `dc_identity_user_id`, use **Method 2 (BigQuery + Looker Studio)** below.

---

## 1. What You Can Measure (The 5 Core Reporting Views)

| Report View | Target Audience | Key Questions Answered | Primary Telemetry Fields |
| :--- | :--- | :--- | :--- |
| **1. FinOps & Tokenomics Chargeback** | FinOps, Platform Leads, Engineering VPs | • What is our exact USD spend per department (`dc_identity_team`) and AI Product (`dc_identity_persona`)?<br>• Which models drive the most cost?<br>• What is our prompt-to-completion token ratio? | `dc_identity_team`, `dc_identity_persona`, `dc_model`, `dc_tx_cost_usd`, `dc_prompt_token_count`, `dc_completion_token_count` |
| **2. Team & Peer Consumption** | Engineering Managers, Team Leads | • How is our shared team token budget distributed among peers on the team?<br>• Which peers are heavily using frontier reasoning models (`claude-opus-4-6`, `gemini-3.1-pro-preview`) vs. fast models (`gemini-3.5-flash`)? | `dc_identity_team`, `dc_identity_user_id`, `dc_model`, `dc_total_token_count`, `dc_tx_cost_usd` |
| **3. Personal Developer Insights** | Individual Engineers | • How many tokens have I consumed today/this week?<br>• How often am I hitting my quota limits (`429`)?<br>• What is my average response latency by model? | `dc_identity_user_id` *(filtered by viewer email)*, `dc_model`, `dc_total_token_count`, `response_status_code` |
| **4. Security, Guardrails & Quota Health** | Security (CISO), Platform Operations | • How many prompts were blocked by **Model Armor** (`HTTP 400`)?<br>• Which users or teams are being throttled by **Token Quotas / Rate Limits** (`HTTP 429`)?<br>• Who needs a temporary quota exception? | `response_status_code`, `dc_identity_user_id`, `dc_identity_team`, `dc_identity_persona`, `proxy_basepath` |
| **5. Smart Router & LLM Judge ROI** | AI Platform Architects, FinOps | • How much money did `"model": "auto:judge"` and cost tiers save compared to routing all calls to `gemini-3.1-pro-preview` or `gpt-5.4`?<br>• How much did latency improve? | `dc_requested_model`, `dc_model`, `dc_tx_cost_usd`, `total_response_time` |

---

## 2. Method 1: Instant Apigee Console Custom Reports (Recommended First Step)

Apigee's built-in **Custom Reports** engine natively indexes all 9 `dc_*` Data Collectors as soon as traffic flows through the gateway.

### Option A: Create All 5 Reports Automatically via CLI (5 Seconds)

Run the following script to provision all 5 Custom Reports directly into your Apigee organization. Once created, open **[Google Cloud Console &rarr; Apigee &rarr; Analytics &rarr; Custom reports](https://console.cloud.google.com/apigee/analytics/custom-reports)** to view them immediately:

```bash
export PROJECT_ID="your-gcp-project-id"
TOKEN=$(gcloud auth print-access-token)

# 1. FinOps & Tokenomics Chargeback by Team, AI Product & Model
curl -s -X POST "https://apigee.googleapis.com/v1/organizations/$PROJECT_ID/reports" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "displayName": "1. AI Gateway - FinOps & Tokenomics Chargeback",
    "chartType": "column",
    "metrics": [
      {"name": "dc_tx_cost_usd", "function": "sum"},
      {"name": "dc_total_token_count", "function": "sum"},
      {"name": "dc_prompt_token_count", "function": "sum"},
      {"name": "dc_completion_token_count", "function": "sum"},
      {"name": "message_count", "function": "sum"}
    ],
    "dimensions": ["dc_identity_team", "dc_identity_persona", "dc_model"],
    "filter": "(apiproxy eq '\''ai-gateway'\'')"
  }'

# 2. Team & Peer Token Consumption Breakdown
curl -s -X POST "https://apigee.googleapis.com/v1/organizations/$PROJECT_ID/reports" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "displayName": "2. AI Gateway - Team & Peer Consumption",
    "chartType": "column",
    "metrics": [
      {"name": "dc_total_token_count", "function": "sum"},
      {"name": "dc_tx_cost_usd", "function": "sum"},
      {"name": "message_count", "function": "sum"}
    ],
    "dimensions": ["dc_identity_team", "dc_identity_user_id", "dc_model"],
    "filter": "(apiproxy eq '\''ai-gateway'\'')"
  }'

# 3. Individual Developer & Agent Insights
curl -s -X POST "https://apigee.googleapis.com/v1/organizations/$PROJECT_ID/reports" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "displayName": "3. AI Gateway - Individual Developer & Agent Usage",
    "chartType": "line",
    "metrics": [
      {"name": "dc_total_token_count", "function": "sum"},
      {"name": "dc_tx_cost_usd", "function": "sum"},
      {"name": "total_response_time", "function": "avg"},
      {"name": "message_count", "function": "sum"}
    ],
    "dimensions": ["dc_identity_user_id", "dc_model", "response_status_code"],
    "filter": "(apiproxy eq '\''ai-gateway'\'')"
  }'

# 4. Security (Model Armor 400s) & Quota Enforcement (429s)
curl -s -X POST "https://apigee.googleapis.com/v1/organizations/$PROJECT_ID/reports" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "displayName": "4. AI Gateway - Security & Quota Enforcement (400 / 429)",
    "chartType": "column",
    "metrics": [
      {"name": "message_count", "function": "sum"}
    ],
    "dimensions": ["response_status_code", "dc_identity_user_id", "dc_identity_team", "dc_identity_persona"],
    "filter": "(apiproxy eq '\''ai-gateway'\'')"
  }'

# 5. Smart Router & LLM Judge Triage (Requested vs. Routed Model)
curl -s -X POST "https://apigee.googleapis.com/v1/organizations/$PROJECT_ID/reports" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "displayName": "5. AI Gateway - Smart Router & LLM Judge Triage",
    "chartType": "column",
    "metrics": [
      {"name": "dc_tx_cost_usd", "function": "sum"},
      {"name": "dc_total_token_count", "function": "sum"},
      {"name": "total_response_time", "function": "avg"},
      {"name": "message_count", "function": "sum"}
    ],
    "dimensions": ["dc_requested_model", "dc_model"],
    "filter": "(apiproxy eq '\''ai-gateway'\'')"
  }'
```

### Option B: Create or View Custom Reports in the Google Cloud Console UI

1. Open **[Google Cloud Console &rarr; Apigee &rarr; Analytics &rarr; Custom reports](https://console.cloud.google.com/apigee/analytics/custom-reports)**.
2. If you ran the CLI script above, click any of the **5 AI Gateway reports** in the list, select your **Environment** (top left) and **Time Period**, and use the **Dimension** dropdown to pivot between `dc_identity_team`, `dc_identity_user_id`, and `dc_model`.
3. To create a new report manually in the UI:
   * Click **+ Create** &rarr; **Custom Report**.
   * **Chart Type:** Select **Column** (to compare groups) or **Line** (to view trends over time).
   * **Metrics:** Click **+ Add Metric**, choose a Data Collector (e.g., `dc_tx_cost_usd` or `dc_total_token_count`), set **Aggregate function** to **Sum**, and click **Done**.
   * **Dimensions:** Click **+ Add Dimension** and add `dc_identity_team`, `dc_identity_user_id`, and `dc_model`.
   * **Filter:** Click **Add a Filter**, select **Entity:** `apiproxy`, **Operator:** `=`, **Value:** `ai-gateway`, and click **Done** &rarr; **Save**.

---

## 3. Method 2: Building Looker Studio Dashboards (Step-by-Step)

To build multi-chart **Looker Studio** dashboards with counterfactual cost-savings math, side-by-side peer comparisons, and viewer email filtering, export Apigee Analytics to **BigQuery** and create a pre-computed SQL View.

### Step 1: Create a BigQuery Dataset & Grant Apigee Export Permissions

Run this once in your Google Cloud project:

```bash
export PROJECT_ID="your-gcp-project-id"
export APIGEE_ENV="eval"
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format="value(projectNumber)")

# 1. Create a multi-region US (or EU) BigQuery dataset for Apigee Analytics
bq --location=US mk -d \
  --description "Apigee AI Gateway Analytics Export" \
  "${PROJECT_ID}:apigee_ai_analytics"

# 2. Grant the Apigee Service Agent permission to write analytics jobs to BigQuery
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:service-${PROJECT_NUMBER}@gcp-sa-apigee.iam.gserviceaccount.com" \
  --role="roles/bigquery.jobUser"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:service-${PROJECT_NUMBER}@gcp-sa-apigee.iam.gserviceaccount.com" \
  --role="roles/bigquery.dataEditor"
```

### Step 2: Register the BigQuery Datastore & Export Analytics Data

```bash
TOKEN=$(gcloud auth print-access-token)

# 1. Register the BigQuery dataset as an Apigee Analytics Datastore
DATASTORE_RESP=$(curl -s -X POST "https://apigee.googleapis.com/v1/organizations/$PROJECT_ID/analytics/datastores" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "displayName": "AI Gateway BigQuery Datastore",
    "targetType": "bigquery",
    "datastoreConfig": {
      "projectId": "'"$PROJECT_ID"'",
      "datasetName": "apigee_ai_analytics",
      "tablePrefix": "apigee_tx"
    }
  }')
echo "$DATASTORE_RESP"
DATASTORE_ID=$(echo "$DATASTORE_RESP" | jq -r '.self | split("/")[-1]')

# 2. Trigger an export job for your date range (YYYY-MM-DD)
curl -s -X POST "https://apigee.googleapis.com/v1/organizations/$PROJECT_ID/environments/$APIGEE_ENV/analytics/exports" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "AI Gateway Analytics Export",
    "description": "Export AI Gateway tokenomics and governance data to BigQuery",
    "dateRange": {
      "start": "2026-09-01",
      "end": "2026-10-01"
    },
    "outputFormat": "delimited",
    "datastoreName": "'"$DATASTORE_ID"'"
  }'
```

### Step 3: Create the Enriched BigQuery Reporting View (`v_ai_gateway_reports`)

Instead of manually typing complex `CASE WHEN` formulas inside Looker Studio (where mixing Dimensions and Metrics causes syntax errors), create a single BigQuery View (`v_ai_gateway_reports`) that pre-calculates every dimension and cost-savings metric automatically:

```bash
bq query --use_legacy_sql=false "
CREATE OR REPLACE VIEW \`${PROJECT_ID}.apigee_ai_analytics.v_ai_gateway_reports\` AS
SELECT
  TIMESTAMP_MILLIS(client_received_start_timestamp) AS request_timestamp,
  DATE(TIMESTAMP_MILLIS(client_received_start_timestamp)) AS request_date,
  apiproxy,
  proxy_basepath,
  response_status_code,
  total_response_time,
  target_response_time,
  developer_app,
  api_product,

  -- 1. Identity & Tenancy Dimensions
  COALESCE(NULLIF(dc_identity_user_id, ''), developer_app, 'anonymous') AS user_id,
  COALESCE(NULLIF(dc_identity_persona, ''), api_product, 'unassigned') AS ai_product_persona,
  COALESCE(NULLIF(dc_identity_team, ''), 'unassigned') AS team,
  CASE
    WHEN REGEXP_CONTAINS(LOWER(COALESCE(dc_identity_persona, '')), r'agent')
      OR ENDS_WITH(LOWER(COALESCE(dc_identity_user_id, '')), '.iam.gserviceaccount.com')
    THEN 'Google Cloud Agent (Agent Identity, Service Account)'
    ELSE 'Human Developer'
  END AS workload_type,

  -- 2. Model, Provider & Routing Dimensions
  COALESCE(NULLIF(dc_requested_model, ''), 'default') AS requested_model,
  COALESCE(NULLIF(dc_model, ''), 'unknown') AS routed_model,
  CASE
    WHEN REGEXP_CONTAINS(LOWER(COALESCE(dc_model, '')), r'gemini|text-embedding-005') THEN 'Google Vertex AI (Gemini)'
    WHEN REGEXP_CONTAINS(LOWER(COALESCE(dc_model, '')), r'claude') THEN 'Anthropic (Claude)'
    WHEN REGEXP_CONTAINS(LOWER(COALESCE(dc_model, '')), r'gpt|o3|text-embedding-3') THEN 'OpenAI'
    WHEN REGEXP_CONTAINS(LOWER(COALESCE(dc_model, '')), r'llama|mistral') THEN 'Vertex Model Garden (MaaS)'
    ELSE 'Custom / Self-Hosted'
  END AS model_provider,
  CASE
    WHEN REGEXP_CONTAINS(LOWER(COALESCE(dc_requested_model, '')), r'auto') THEN 'Auto-Routed (Smart Router / Judge)'
    ELSE 'Direct Model Request'
  END AS routing_strategy,
  CASE
    WHEN REGEXP_CONTAINS(LOWER(COALESCE(dc_model, '')), r'flash-lite') THEN 'Tier Low (Gemini 3.1 Flash-Lite)'
    WHEN REGEXP_CONTAINS(LOWER(COALESCE(dc_model, '')), r'flash') THEN 'Tier Medium (Gemini 3.5 / 3.7 Flash)'
    WHEN REGEXP_CONTAINS(LOWER(COALESCE(dc_model, '')), r'pro') THEN 'Tier High (Gemini 3.1 Pro)'
    WHEN REGEXP_CONTAINS(LOWER(COALESCE(dc_model, '')), r'claude|gpt-5') THEN 'Tier Max (Claude 4.6 / GPT-5.4)'
    ELSE 'Other / Custom'
  END AS cost_tier,

  -- 3. Governance & Security Enforcement Dimensions
  CASE
    WHEN response_status_code = 200 THEN 'Allowed (200 OK)'
    WHEN response_status_code = 429 THEN 'Throttled: Quota / Rate Limit (429)'
    WHEN response_status_code = 400 THEN 'Blocked: Model Armor / Validation (400)'
    WHEN response_status_code IN (401, 403) THEN 'Rejected: Unauthorized (401/403)'
    WHEN response_status_code >= 500 THEN 'Upstream Provider Error (5xx)'
    ELSE CAST(response_status_code AS STRING)
  END AS enforcement_status,
  IF(response_status_code = 429, 1, 0) AS throttled_429_count,
  IF(response_status_code = 400, 1, 0) AS security_blocked_400_count,
  IF(response_status_code IN (401, 403), 1, 0) AS unauthorized_count,

  -- 4. Tokenomics & Invoice-Accurate Cost Attribution Metrics
  COALESCE(SAFE_CAST(dc_prompt_token_count AS INT64), 0) AS prompt_tokens,
  COALESCE(SAFE_CAST(dc_completion_token_count AS INT64), 0) AS completion_tokens,
  COALESCE(SAFE_CAST(dc_total_token_count AS INT64), 0) AS total_tokens,
  COALESCE(SAFE_CAST(dc_tx_cost_usd AS FLOAT64), 0.0) AS actual_cost_usd,

  -- 5. Counterfactual Baselines & Smart Router / Judge Savings (USD)
  -- Gemini 3.1 Pro Preview Baseline ($2.00 / 1M input + $12.00 / 1M output)
  (COALESCE(SAFE_CAST(dc_prompt_token_count AS FLOAT64), 0.0) * 0.00000200)
    + (COALESCE(SAFE_CAST(dc_completion_token_count AS FLOAT64), 0.0) * 0.00001200) AS baseline_gemini_3_1_pro_cost_usd,

  -- OpenAI GPT-5.4 Baseline ($2.50 / 1M input + $15.00 / 1M output)
  (COALESCE(SAFE_CAST(dc_prompt_token_count AS FLOAT64), 0.0) * 0.00000250)
    + (COALESCE(SAFE_CAST(dc_completion_token_count AS FLOAT64), 0.0) * 0.00001500) AS baseline_gpt_5_4_cost_usd,

  -- Net Savings vs. Gemini 3.1 Pro Preview for Auto-Routed / Judge Traffic
  CASE
    WHEN REGEXP_CONTAINS(LOWER(COALESCE(dc_requested_model, '')), r'auto') THEN
      GREATEST(
        0.0,
        ((COALESCE(SAFE_CAST(dc_prompt_token_count AS FLOAT64), 0.0) * 0.00000200)
          + (COALESCE(SAFE_CAST(dc_completion_token_count AS FLOAT64), 0.0) * 0.00001200))
        - COALESCE(SAFE_CAST(dc_tx_cost_usd AS FLOAT64), 0.0)
      )
    ELSE 0.0
  END AS net_cost_savings_usd
FROM
  \`${PROJECT_ID}.apigee_ai_analytics.apigee_tx_*\`
WHERE
  apiproxy = 'ai-gateway'
"
```

### Step 4: Connect Looker Studio to `v_ai_gateway_reports`

1. Open **[Looker Studio](https://lookerstudio.google.com/)** and click **+ Create** &rarr; **Report**.
2. In the **Add data to report** panel, select **BigQuery**.
3. Select **My Projects** &rarr; your GCP Project ID &rarr; **Dataset:** `apigee_ai_analytics` &rarr; **Table:** `v_ai_gateway_reports`.
4. Click **Add** (bottom right) &rarr; **Add to Report**.
5. In the top menu bar, click **Resource** &rarr; **Manage added data sources** &rarr; click **Edit** next to `v_ai_gateway_reports`:
   * Set the display **Type** of `actual_cost_usd`, `baseline_gemini_3_1_pro_cost_usd`, `baseline_gpt_5_4_cost_usd`, and `net_cost_savings_usd` to **Numeric &rarr; Currency (USD - $ US Dollar)**.
   * *(Optional)* Click **+ Add a field** (top right) to add these 3 aggregated ratio metrics:

| Field Name | Formula to Paste | Display Type |
| :--- | :--- | :--- |
| **`Cost per 1K Tokens ($)`** | `SUM(actual_cost_usd) / (SUM(total_tokens) / 1000)` | **Currency (USD)** |
| **`Prompt-to-Completion Ratio`** | `SUM(prompt_tokens) / SUM(completion_tokens)` | **Number** |
| **`Cost Reduction %`** | `SUM(net_cost_savings_usd) / SUM(baseline_gemini_3_1_pro_cost_usd)` | **Percent** |

6. Click **Done** (top right) and **Close** to return to your report canvas.

---

## 4. Step-by-Step Chart Configuration for All 5 Views

Add a **Date range control** (`Insert > Date range control`) and three **Drop-down list controls** (`Insert > Drop-down list`) at the top of your report with **Control field** set to `team`, `ai_product_persona`, and `routed_model`. Then select a tab below and configure each chart using the right-hand **Setup** panel:

=== "1. FinOps & Tokenomics Chargeback"

    **Goal:** Track invoice-accurate USD spend per department (`team`), AI Product (`ai_product_persona`), and model provider, while diagnosing prompt vs. completion token efficiency.

    | Chart / Widget | Menu Action (`Insert > ...`) | Dimension(s) | Metric(s) | Additional Setup |
    | :--- | :--- | :--- | :--- | :--- |
    | **Total Spend ($)** | `Insert > Scorecard` | — | `actual_cost_usd` (Sum) | Enable **Comparison date range: Previous period** |
    | **Total Tokens** | `Insert > Scorecard` | — | `total_tokens` (Sum) | Enable **Comparison date range: Previous period** |
    | **Cost / 1K Tokens** | `Insert > Scorecard` | — | `Cost per 1K Tokens ($)` | — |
    | **Prompt : Completion Ratio** | `Insert > Scorecard` | — | `Prompt-to-Completion Ratio` | High ratios (`>10:1`) indicate large context windows or agent tool loops |
    | **Department Chargeback Table** | `Insert > Table` | `team`, `ai_product_persona` | `Record Count`, `prompt_tokens`, `completion_tokens`, `total_tokens`, `actual_cost_usd` | Sort by `actual_cost_usd` **Descending**; check **Show summary row** |
    | **Spend by Provider & Model** | `Insert > Stacked column chart` | `request_date` | `actual_cost_usd` (Sum) | Set **Breakdown Dimension** = `routed_model` (or `model_provider`) |

=== "2. Team & Peer Consumption"

    **Goal:** Let engineering managers and team members filter by their `team` (e.g., `eng-ml`) to see how peers (`user_id`) share the team's token budget and which models each peer uses.

    | Chart / Widget | Menu Action (`Insert > ...`) | Dimension(s) | Metric(s) | Additional Setup |
    | :--- | :--- | :--- | :--- | :--- |
    | **Team Selector Filter** | `Insert > Drop-down list` | **Control field:** `team` | `total_tokens` (Sum) | Select your team (e.g., `eng-ml`) to scope the page to your peers |
    | **Peer Share of Team Tokens** | `Insert > Bar chart` | `user_id` | `total_tokens` (Sum) | Sort by `total_tokens` **Descending** |
    | **Peer Model Mix (100% Stacked)** | `Insert > 100% stacked bar chart` | `user_id` | `total_tokens` (Sum) | **Breakdown Dimension:** `routed_model` *(spots if one peer is using `claude-opus-4-6` while teammates use `gemini-3.5-flash`)* |
    | **Peer Consumption Matrix** | `Insert > Table` | `user_id`, `ai_product_persona`, `routed_model` | `Record Count`, `total_tokens`, `actual_cost_usd`, `total_response_time` (Avg) | Click the pencil icon on `total_tokens` &rarr; **Comparison calculation: Percent of total** to display each peer's % of the team pool |

=== "3. Personal Developer Self-Service View"

    **Goal:** Give every developer a self-service page that automatically filters to their own logged-in corporate email (`user_id`), showing their personal token burn, cost, and quota throttles.

    ### How to Enable Automatic Viewer Email Filtering
    1. Click **Page** (top menu) &rarr; **Duplicate page** to create a dedicated **"My AI Usage"** page.
    2. Click **Resource** &rarr; **Manage added data sources** &rarr; click **Edit** on `v_ai_gateway_reports`.
    3. In the top-left toolbar of the data source editor, click **Filter by email**.
    4. Check **Filter data by viewer's email**, select **`user_id`**, and click **Done**. *(Every engineer who opens this report now sees only their own rows).*

    | Chart / Widget | Menu Action (`Insert > ...`) | Dimension(s) | Metric(s) | Additional Setup |
    | :--- | :--- | :--- | :--- | :--- |
    | **My Total Tokens** | `Insert > Scorecard` | — | `total_tokens` (Sum) | — |
    | **My Total Spend ($)** | `Insert > Scorecard` | — | `actual_cost_usd` (Sum) | — |
    | **My Quota Throttles (429)** | `Insert > Scorecard` | — | `throttled_429_count` (Sum) | Shows how many times the user hit their rolling quota or burst limit |
    | **My Daily Token Usage** | `Insert > Time series chart` | `request_date` | `total_tokens` (Sum) | **Breakdown Dimension:** `routed_model` |
    | **My Latency & Model Breakdown** | `Insert > Table` | `routed_model`, `proxy_basepath` | `Record Count`, `prompt_tokens`, `completion_tokens`, `total_response_time` (Avg) | Sort by `Record Count` **Descending** |

=== "4. Security, Guardrails & Quota Governance"

    **Goal:** Audit every enforcement action taken by the AI Gateway: **Model Armor content safety blocks (`HTTP 400`)**, **Token Quota & Rate-Limit throttling (`HTTP 429`)**, and **Unauthorized calls (`HTTP 401/403`)**.

    | Chart / Widget | Menu Action (`Insert > ...`) | Dimension(s) | Metric(s) | Additional Setup |
    | :--- | :--- | :--- | :--- | :--- |
    | **Quota Throttled Calls (429)** | `Insert > Scorecard` | — | `throttled_429_count` (Sum) | Comparison: Previous period |
    | **Model Armor / Safety Blocks (400)** | `Insert > Scorecard` | — | `security_blocked_400_count` (Sum) | Comparison: Previous period |
    | **Unauthorized Rejects (401/403)** | `Insert > Scorecard` | — | `unauthorized_count` (Sum) | Comparison: Previous period |
    | **Enforcement Trend Over Time** | `Insert > Stacked column chart` | `request_date` | `Record Count` | **Breakdown Dimension:** `enforcement_status` |
    | **Users & Teams Hitting Quotas (429)** | `Insert > Table` | `user_id`, `team`, `ai_product_persona`, `requested_model` | `throttled_429_count` (Sum) | Sort by `throttled_429_count` **Descending**. Identifies who may need a temporary `quota_override_tokens` exception |
    | **Model Armor Blocks by User** | `Insert > Table` | `user_id`, `team`, `proxy_basepath`, `requested_model` | `security_blocked_400_count` (Sum) | Sort by `security_blocked_400_count` **Descending** |

=== "5. Smart Router & LLM Judge ROI"

    **Goal:** Quantify the dollar savings and latency reduction achieved when using `"model": "auto:judge"` or cost tiers (`auto:low`, `auto:medium`, `auto:high`) compared to routing all requests to `gemini-3.1-pro-preview` (`$2.00 / $12.00`) or `gpt-5.4` (`$2.50 / $15.00`).

    | Chart / Widget | Menu Action (`Insert > ...`) | Dimension(s) | Metric(s) | Additional Setup |
    | :--- | :--- | :--- | :--- | :--- |
    | **Total Net Savings ($)** | `Insert > Scorecard` | — | `net_cost_savings_usd` (Sum) | — |
    | **Cost Reduction %** | `Insert > Scorecard` | — | `Cost Reduction %` | — |
    | **Unrouted Baseline vs. Actual Spend** | `Insert > Time series chart` | `request_date` | `baseline_gemini_3_1_pro_cost_usd` (Sum), `actual_cost_usd` (Sum) | In **Style**, set `baseline_gemini_3_1_pro_cost_usd` to a dashed red line and `actual_cost_usd` to a solid blue line |
    | **Judge Triage Distribution** | `Insert >Pie chart` (Donut) | `cost_tier` | `Record Count` | Add a **Chart Filter**: `Include` &rarr; `routing_strategy` &rarr; `Equals` &rarr; `Auto-Routed (Smart Router / Judge)` |
    | **Latency & Economics by Tier** | `Insert > Table` | `cost_tier`, `routed_model` | `Record Count`, `total_tokens`, `actual_cost_usd`, `baseline_gemini_3_1_pro_cost_usd`, `net_cost_savings_usd`, `total_response_time` (Avg) | Sort by `net_cost_savings_usd` **Descending** |
