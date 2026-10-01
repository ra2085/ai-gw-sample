# Analytics & Looker Studio Reporting Guide

Because the AI Gateway sits in the path of every model call, it captures granular telemetry on **tokenomics, identity attribution, quota enforcement, content safety, and routing decisions**.

Apigee provides an **out-of-the-box [Looker Studio (Data Studio) Integration](https://docs.cloud.google.com/apigee/docs/api-platform/analytics/data-studio)** as well as built-in **Apigee Console Custom Reports**—no external database or manual BigQuery export is required.

---

## 1. What You Can Measure (The 5 Core Reporting Views)

| Report View | Target Audience | Key Questions Answered | Primary Apigee Telemetry Fields |
| :--- | :--- | :--- | :--- |
| **1. FinOps & Tokenomics Chargeback** | FinOps, Platform Leads, Engineering VPs | • What is our exact USD spend per department (`dc_identity_team`) and AI Product (`dc_identity_persona`)?<br>• Which models drive the most cost?<br>• What is our prompt-to-completion token ratio? | `dc_identity_team`, `dc_identity_persona`, `dc_model`, `dc_tx_cost_usd`, `dc_prompt_token_count`, `dc_completion_token_count` |
| **2. Team & Peer Consumption** | Engineering Managers, Team Leads | • How is our shared team token budget distributed among peers on the team?<br>• Which peers are heavily using frontier reasoning models (`claude-opus-4-6`, `gemini-3.1-pro-preview`) vs. fast models (`gemini-3.5-flash`)? | `dc_identity_team`, `dc_identity_user_id`, `dc_model`, `dc_total_token_count`, `dc_tx_cost_usd` |
| **3. Personal Developer Insights** | Individual Engineers | • How many tokens have I consumed today/this week?<br>• How often am I hitting my quota limits (`429`)?<br>• What is my average response latency by model? | `dc_identity_user_id` *(filtered by viewer email)*, `dc_model`, `dc_total_token_count`, `response_status_code` |
| **4. Security, Guardrails & Quota Health** | Security (CISO), Platform Operations | • How many prompts were blocked by **Model Armor** (`HTTP 400`)?<br>• Which users or teams are being throttled by **Token Quotas / Rate Limits** (`HTTP 429`)?<br>• Who needs a temporary quota exception? | `response_status_code`, `dc_identity_user_id`, `dc_identity_team`, `dc_identity_persona`, `proxy_basepath` |
| **5. Smart Router & LLM Judge ROI** | AI Platform Architects, FinOps | • How much money did `"model": "auto:judge"` and cost tiers save compared to routing all calls to `gemini-3.1-pro-preview` or `gpt-5.4`?<br>• How much did latency improve? | `dc_requested_model`, `dc_model`, `dc_tx_cost_usd`, `Average Latency` (`total_response_time`) |

---

## 2. Connect Looker Studio Directly to Apigee (Out-of-the-Box)

### Prerequisites

1. **Required IAM Role:** To connect Looker Studio to Apigee, your Google Cloud user account must have the **[`roles/apigee.analyticsEditor`](https://docs.cloud.google.com/apigee/docs/api-platform/analytics/data-studio#required-role)** role on your Google Cloud project:
   ```bash
   gcloud projects add-iam-policy-binding "$PROJECT_ID" \
     --member="user:YOUR_EMAIL@example.com" \
     --role="roles/apigee.analyticsEditor"
   ```
2. **Data Collectors Provisioned:** Ensure you have created the 9 custom `dc_*` Data Collectors from [Deployment & Verification](./deployment.md#step-1-provision-analytics-data-collectors) and sent at least a few requests through the gateway so the fields appear in your Apigee analytics schema.

> [!NOTE]
> **VPC Service Controls (VPC-SC) & Data Residency:**
> Per the [Apigee Data Studio Integration documentation](https://docs.cloud.google.com/apigee/docs/api-platform/analytics/data-studio), if your organization uses VPC Service Controls, add ingress/egress rules for the Looker Studio service account to allow `bigquery.googleapis.com` and `bigquerydatatransfer.googleapis.com`. Note that Looker Studio Integration is not supported for Apigee organizations with data residency enabled.

### Step 1: Connect the `Apigee` Data Source in Looker Studio

You can connect Looker Studio to Apigee either directly from Looker Studio or from the Apigee Console UI:

=== "Option A: From Looker Studio (Recommended for Custom Dashboards)"
    1. Open **[Looker Studio](https://lookerstudio.google.com/)**.
    2. Click **+ Create** (top left) &rarr; select **Data source**.
    3. In the Google Connectors list, scroll down and click **Apigee**.
    4. Click **Authorize** to allow Looker Studio to connect to your Apigee data.
    5. In the **Apigee Organization Name** field, enter your **Apigee Organization ID** *(this is the same as your Google Cloud Project ID)*.
    6. Click **Connect** in the top-right corner. Looker Studio will display the **Apigee Data Source Fields** page.

=== "Option B: From the Apigee Console UI (Prebuilt Template)"
    1. In the Google Cloud Console, go to **[Apigee &rarr; Analytics &rarr; Custom reports](https://console.cloud.google.com/apigee/analytics/custom-reports)**.
    2. Click **Create More Reports Using Data Studio** in the top-right corner to open the **Apigee API Platform** template.
    3. Click **Use my own data** at the top-right of the page.
    4. In the **Apigee Organization Name** field, enter your **Apigee Organization ID** *(your Google Cloud Project ID)* and click **Add**.

---

### Step 2: Configure Field Types & Calculated Fields in the Data Source

When you click **Connect** in Step 1, Looker Studio opens the **Data Source Fields** list containing Apigee's built-in metrics (`Traffic`, `Average Latency`, `API Product`, `Application`, `response_status_code`) and your 9 custom `dc_*` Data Collectors.

1. **Format `dc_tx_cost_usd` as Currency:**
   Locate **`dc_tx_cost_usd`** in the field list, click its **Type** dropdown (`Numeric > Number`), and select **Numeric &rarr; Currency &rarr; USD - $ US Dollar**.
2. **Add Calculated Dimensions & Metrics:**
   Click **+ Add a field** &rarr; **Add calculated field** in the top-right corner of the Data Source page and add the fields below.

> [!TIP]
> **Why These Formulas Never Fail in Looker Studio:**
> Looker Studio does not allow mixing non-aggregated **Dimensions** (like `dc_requested_model`) and aggregated **Metrics** (like `dc_tx_cost_usd`) inside the same `CASE WHEN` expression.
>
> Below, **Dimension formulas** only reference Dimensions, and **Metric formulas** only reference Metrics. To scope a metric to a specific subset of traffic (such as `429` responses or `Auto-Routed` requests), we apply a simple **Chart Filter** in Step 4.

#### Calculated Dimensions (Click `+ Add a field` &rarr; `Add calculated field`)

| Field Name to Enter | Formula to Paste |
| :--- | :--- |
| **`Workload Type`** | `CASE WHEN REGEXP_CONTAINS(LOWER(dc_identity_persona), "agent") OR ENDS_WITH(LOWER(dc_identity_user_id), ".iam.gserviceaccount.com") THEN "Google Cloud Agent (Agent Identity, Service Account)" ELSE "Human Developer" END` |
| **`Model Provider`** | `CASE WHEN REGEXP_CONTAINS(LOWER(dc_model), "gemini|text-embedding-005") THEN "Google Vertex AI (Gemini)" WHEN REGEXP_CONTAINS(LOWER(dc_model), "claude") THEN "Anthropic (Claude)" WHEN REGEXP_CONTAINS(LOWER(dc_model), "gpt|o3|text-embedding-3") THEN "OpenAI" WHEN REGEXP_CONTAINS(LOWER(dc_model), "llama|mistral") THEN "Vertex Model Garden (MaaS)" ELSE "Custom / Self-Hosted" END` |
| **`Routing Strategy`** | `CASE WHEN REGEXP_CONTAINS(LOWER(dc_requested_model), "auto") THEN "Auto-Routed (Smart Router / Judge)" ELSE "Direct Model Request" END` |
| **`Cost Tier`** | `CASE WHEN REGEXP_CONTAINS(LOWER(dc_model), "flash-lite") THEN "Tier Low (Gemini 3.1 Flash-Lite)" WHEN REGEXP_CONTAINS(LOWER(dc_model), "flash") THEN "Tier Medium (Gemini 3.5 Flash)" WHEN REGEXP_CONTAINS(LOWER(dc_model), "pro") THEN "Tier High (Gemini 3.1 Pro)" WHEN REGEXP_CONTAINS(LOWER(dc_model), "claude|gpt-5") THEN "Tier Max (Claude 4.6 / GPT-5.4)" ELSE "Other / Custom" END` |
| **`Enforcement Status`** | `CASE WHEN response_status_code = 200 THEN "Allowed (200 OK)" WHEN response_status_code = 429 THEN "Throttled: Quota / Rate Limit (429)" WHEN response_status_code = 400 THEN "Blocked: Model Armor / Validation (400)" WHEN response_status_code IN (401, 403) THEN "Rejected: Unauthorized (401/403)" ELSE "Other / Provider Error" END` |

#### Calculated Metrics (Click `+ Add a field` &rarr; `Add calculated field`)

| Field Name to Enter | Formula to Paste | Display Type (`Type` Dropdown) |
| :--- | :--- | :--- |
| **`Cost per 1K Tokens ($)`** | `SUM(dc_tx_cost_usd) / (SUM(dc_total_token_count) / 1000)` | **Numeric &rarr; Currency (USD)** |
| **`Prompt-to-Completion Ratio`** | `SUM(dc_prompt_token_count) / SUM(dc_completion_token_count)` | **Numeric &rarr; Number** |
| **`Baseline Cost: Gemini 3.1 Pro ($)`** | `(SUM(dc_prompt_token_count) * 0.00000200) + (SUM(dc_completion_token_count) * 0.00001200)` | **Numeric &rarr; Currency (USD)** |
| **`Baseline Cost: GPT-5.4 ($)`** | `(SUM(dc_prompt_token_count) * 0.00000250) + (SUM(dc_completion_token_count) * 0.00001500)` | **Numeric &rarr; Currency (USD)** |
| **`Smart Router Net Savings ($)`** | `((SUM(dc_prompt_token_count) * 0.00000200) + (SUM(dc_completion_token_count) * 0.00001200)) - SUM(dc_tx_cost_usd)` | **Numeric &rarr; Currency (USD)** |
| **`Smart Router Cost Reduction %`** | `(((SUM(dc_prompt_token_count) * 0.00000200) + (SUM(dc_completion_token_count) * 0.00001200)) - SUM(dc_tx_cost_usd)) / ((SUM(dc_prompt_token_count) * 0.00000200) + (SUM(dc_completion_token_count) * 0.00001200))` | **Numeric &rarr; Percent** |

---

### Step 3: Create the Report & Add Global Controls

1. In the top-right corner of the Data Source page, click **Create Report** &rarr; click **Add to Report**.
2. **Scope the Report to `ai-gateway`:**
   * In the top menu bar, click **File** &rarr; **Report settings**.
   * In the right-hand **Report Settings** pane, click **+ Add a filter** &rarr; **Create a filter**:
     * **Name:** `AI Gateway Proxy Filter`
     * **Condition:** `Include` &rarr; **Field:** `apiproxy` *(or `API Proxy`)* &rarr; **Condition:** `Equals (=)` &rarr; **Value:** `ai-gateway`
     * Click **Save**.
3. **Add Top-Bar Interactive Controls:**
   * Click **Insert** &rarr; **Date range control** and place it in the top-right header.
   * Click **Insert** &rarr; **Drop-down list** three times and place them across the top header with **Control field** set to:
     1. `dc_identity_team` *(Department / Team filter)*
     2. `dc_identity_persona` *(AI Product / Persona filter)*
     3. `dc_model` *(Routed Model filter)*

---

## 3. Step-by-Step Chart Configuration for All 5 Views

Select a tab below to build each page in your Looker Studio report (click **Page &rarr; New page** in the top menu to add pages):

=== "1. FinOps & Tokenomics Chargeback"

    **Goal:** Track invoice-accurate USD spend per department (`dc_identity_team`), AI Product (`dc_identity_persona`), and model provider, while diagnosing prompt vs. completion token efficiency.

    | Chart / Widget | Menu Action (`Insert > ...`) | Dimension(s) | Metric(s) | Setup Panel Configuration |
    | :--- | :--- | :--- | :--- | :--- |
    | **Total Spend ($)** | `Insert > Scorecard` | — | `dc_tx_cost_usd` (Sum) | Enable **Comparison date range: Previous period** |
    | **Total Tokens** | `Insert > Scorecard` | — | `dc_total_token_count` (Sum) | Enable **Comparison date range: Previous period** |
    | **Cost / 1K Tokens** | `Insert > Scorecard` | — | `Cost per 1K Tokens ($)` | — |
    | **Prompt : Completion Ratio** | `Insert > Scorecard` | — | `Prompt-to-Completion Ratio` | High ratios (`>10:1`) indicate large context windows or agent tool loops |
    | **Department Chargeback Table** | `Insert > Table` | `dc_identity_team`, `dc_identity_persona` | `Traffic`, `dc_prompt_token_count`, `dc_completion_token_count`, `dc_total_token_count`, `dc_tx_cost_usd` | Sort by `dc_tx_cost_usd` **Descending**; check **Show summary row** |
    | **Daily Spend by Model** | `Insert > Stacked column chart` | `Time` *(or `Date`)* | `dc_tx_cost_usd` (Sum) | Set **Breakdown Dimension** = `dc_model` (or `Model Provider`) |

=== "2. Team & Peer Consumption"

    **Goal:** Let engineering managers and team members filter by their `dc_identity_team` (e.g., `eng-ml`) to see how peers (`dc_identity_user_id`) share the team's token budget and which models each peer uses.

    | Chart / Widget | Menu Action (`Insert > ...`) | Dimension(s) | Metric(s) | Setup Panel Configuration |
    | :--- | :--- | :--- | :--- | :--- |
    | **Team Selector** | `Insert > Drop-down list` | **Control field:** `dc_identity_team` | `dc_total_token_count` (Sum) | Select a team (e.g., `eng-ml`) to scope the page to peers on that team |
    | **Peer Share of Team Tokens** | `Insert > Bar chart` | `dc_identity_user_id` | `dc_total_token_count` (Sum) | Sort by `dc_total_token_count` **Descending** |
    | **Peer Model Mix (100% Stacked)** | `Insert > 100% stacked bar chart` | `dc_identity_user_id` | `dc_total_token_count` (Sum) | **Breakdown Dimension:** `dc_model` *(spots if one peer is using `claude-opus-4-6` while teammates use `gemini-3.5-flash`)* |
    | **Peer Consumption Matrix** | `Insert > Table` | `dc_identity_user_id`, `dc_identity_persona`, `dc_model` | `Traffic`, `dc_total_token_count`, `dc_tx_cost_usd`, `Average Latency` | Click the pencil icon on `dc_total_token_count` &rarr; **Comparison calculation: Percent of total** to show each peer's % of the team pool |

=== "3. Personal Developer Self-Service View"

    **Goal:** Give every developer a self-service page that automatically filters to their own logged-in corporate email (`dc_identity_user_id`), showing their personal token burn, cost, and quota throttles.

    ### How to Enable Automatic Viewer Email Filtering
    1. Click **Page** (top menu) &rarr; **New page** and name it **"My AI Usage"**.
    2. Click **Resource** &rarr; **Manage added data sources** &rarr; click **Edit** next to your Apigee data source.
    3. In the top-left toolbar of the data source editor, click **Filter by email**.
    4. Check **Filter data by viewer's email**, select **`dc_identity_user_id`**, and click **Done**. *(Every engineer who opens this report now sees only their own rows).*

    | Chart / Widget | Menu Action (`Insert > ...`) | Dimension(s) | Metric(s) | Setup Panel Configuration |
    | :--- | :--- | :--- | :--- | :--- |
    | **My Total Tokens** | `Insert > Scorecard` | — | `dc_total_token_count` (Sum) | — |
    | **My Total Spend ($)** | `Insert > Scorecard` | — | `dc_tx_cost_usd` (Sum) | — |
    | **My Quota Throttles (429)** | `Insert > Scorecard` | — | `Traffic` | **Chart Filter:** `Include` &rarr; `response_status_code` &rarr; `Equals (=)` &rarr; `429` |
    | **My Token Usage Over Time** | `Insert > Time series chart` | `Time` *(or `Date`)* | `dc_total_token_count` (Sum) | **Breakdown Dimension:** `dc_model` |
    | **My Latency & Model Breakdown** | `Insert > Table` | `dc_model`, `proxy_basepath` | `Traffic`, `dc_prompt_token_count`, `dc_completion_token_count`, `Average Latency` | Sort by `Traffic` **Descending** |

=== "4. Security, Guardrails & Quota Governance"

    **Goal:** Audit every enforcement action taken by the AI Gateway: **Model Armor content safety blocks (`HTTP 400`)**, **Token Quota & Rate-Limit throttling (`HTTP 429`)**, and **Unauthorized calls (`HTTP 401/403`)**.

    | Chart / Widget | Menu Action (`Insert > ...`) | Dimension(s) | Metric(s) | Setup Panel Configuration |
    | :--- | :--- | :--- | :--- | :--- |
    | **Quota Throttled Calls (429)** | `Insert > Scorecard` | — | `Traffic` | **Chart Filter:** `Include` &rarr; `response_status_code` &rarr; `Equals (=)` &rarr; `429` |
    | **Model Armor / Safety Blocks (400)** | `Insert > Scorecard` | — | `Traffic` | **Chart Filter:** `Include` &rarr; `response_status_code` &rarr; `Equals (=)` &rarr; `400` |
    | **Enforcement Trend Over Time** | `Insert > Stacked column chart` | `Time` *(or `Date`)* | `Traffic` | **Breakdown Dimension:** `Enforcement Status` |
    | **Users & Teams Hitting Quotas (429)** | `Insert > Table` | `dc_identity_user_id`, `dc_identity_team`, `dc_identity_persona`, `dc_requested_model` | `Traffic` | **Chart Filter:** `Include` &rarr; `response_status_code` &rarr; `Equals (=)` &rarr; `429`. Identifies who may need a temporary `quota_override_tokens` exception |
    | **Model Armor Blocks by User** | `Insert > Table` | `dc_identity_user_id`, `dc_identity_team`, `proxy_basepath`, `dc_requested_model` | `Traffic` | **Chart Filter:** `Include` &rarr; `response_status_code` &rarr; `Equals (=)` &rarr; `400` |

=== "5. Smart Router & LLM Judge ROI"

    **Goal:** Quantify the dollar savings and latency reduction achieved when using `"model": "auto:judge"` or cost tiers (`auto:low`, `auto:medium`, `auto:high`) compared to routing all requests to `gemini-3.1-pro-preview` (`$2.00 / $12.00`) or `gpt-5.4` (`$2.50 / $15.00`).

    *Tip:* Add a **Page-level Filter** (`Page > Current page settings > + Add a filter`) with `Include` &rarr; `Routing Strategy` &rarr; `Equals (=)` &rarr; `Auto-Routed (Smart Router / Judge)` so all cards on this page measure auto-routed traffic.

    | Chart / Widget | Menu Action (`Insert > ...`) | Dimension(s) | Metric(s) | Setup Panel Configuration |
    | :--- | :--- | :--- | :--- | :--- |
    | **Total Net Savings ($)** | `Insert > Scorecard` | — | `Smart Router Net Savings ($)` | — |
    | **Cost Reduction %** | `Insert > Scorecard` | — | `Smart Router Cost Reduction %` | — |
    | **Unrouted Baseline vs. Actual Spend** | `Insert > Time series chart` | `Time` *(or `Date`)* | `Baseline Cost: Gemini 3.1 Pro ($)`, `dc_tx_cost_usd` (Sum) | In **Style**, set `Baseline Cost: Gemini 3.1 Pro ($)` to a dashed red line and `dc_tx_cost_usd` to a solid blue line |
    | **Judge Triage Distribution** | `Insert > Pie chart` (Donut) | `Cost Tier` | `Traffic` | Shows the % of auto-routed prompts handled by low/medium/high tiers |
    | **Latency & Economics by Tier** | `Insert > Table` | `Cost Tier`, `dc_model` | `Traffic`, `dc_total_token_count`, `dc_tx_cost_usd`, `Baseline Cost: Gemini 3.1 Pro ($)`, `Smart Router Net Savings ($)`, `Average Latency` | Sort by `Smart Router Net Savings ($)` **Descending** |

---

## 4. Bonus: Provision All 5 Reports in the Apigee Console via CLI

In addition to Looker Studio, you can provision all 5 reports directly inside **[Google Cloud Console &rarr; Apigee &rarr; Analytics &rarr; Custom reports](https://console.cloud.google.com/apigee/analytics/custom-reports)** with a single CLI snippet:

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
