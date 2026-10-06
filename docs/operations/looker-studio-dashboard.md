# Analytics & Looker Studio Dashboards

Because the AI Gateway sits in the path of every model call, it captures **18 granular telemetry fields** covering **multi-bucket tokenomics (uncached, cache-read, cache-write, thinking, completion), per-token-type USD cost attribution, identity & team attribution, quota enforcement, content safety, and routing decisions**.

Apigee provides an **out-of-the-box [Looker Studio (Data Studio) Integration](https://docs.cloud.google.com/apigee/docs/api-platform/analytics/data-studio)** as well as built-in **Apigee Console Custom Reports**—no external database or manual BigQuery export is required.

---

## 1. What You Can Measure (The 6 Core Persona Dashboards)

| Dashboard View | Target Persona | Key Questions Answered | Primary Apigee Telemetry Fields |
| :--- | :--- | :--- | :--- |
| **1. FinOps & Multi-Bucket Cost Chargeback** | FinOps, Platform Leads, Engineering VPs | • What is our exact USD spend per department (`dc_identity_team`) and AI Product (`dc_identity_persona`)?<br>• How much of our bill comes from uncached input (`dc_tx_uncached_prompt_cost_usd`), cached input (`dc_tx_cache_read_cost_usd` / `dc_tx_cache_write_cost_usd`), vs. output & reasoning (`dc_tx_completion_cost_usd`)?<br>• What share of output tokens is consumed by internal chain-of-thought reasoning (`dc_thinking_token_count`)? | `dc_identity_team`, `dc_identity_persona`, `dc_model`, `dc_tx_cost_usd`, `dc_tx_uncached_prompt_cost_usd`, `dc_tx_cache_read_cost_usd`, `dc_tx_cache_write_cost_usd`, `dc_tx_completion_cost_usd`, `dc_thinking_token_count` |
| **2. Prompt Caching & Context Optimization ROI** | FinOps, AI Platform Architects, Tooling Leads | • How many dollars (`Prompt Cache Net Savings ($)`) and what percentage of input spend (`Prompt Cache Cost Reduction (%)`) did prompt caching save across `Claude Code`, `Codex`, and agent loops?<br>• What is our **Prompt Cache Hit Rate (%)** by team, AI Product, and model?<br>• Which teams or workloads are sending large uncached prompts (`dc_uncached_prompt_token_count`) and missing out on 75%–90% cache discounts? | `dc_prompt_token_count`, `dc_uncached_prompt_token_count`, `dc_cache_read_token_count`, `dc_cache_write_token_count`, `dc_tx_prompt_cost_usd`, `dc_tx_uncached_prompt_cost_usd`, `dc_tx_cache_read_cost_usd`, `dc_tx_cache_write_cost_usd` |
| **3. Team & Peer Consumption** | Engineering Managers, Team Leads | • How is our shared team token/USD budget (`dc_identity_team`) distributed among peers (`dc_identity_user_id`)?<br>• Which peers are heavily using frontier reasoning models (`claude-opus-4-6`, `gemini-3.1-pro-preview`) vs. fast models (`gemini-3.5-flash`), and who has the highest prompt cache efficiency? | `dc_identity_team`, `dc_identity_user_id`, `dc_model`, `dc_total_token_count`, `dc_cache_read_token_count`, `dc_thinking_token_count`, `dc_tx_cost_usd` |
| **4. Personal Developer Self-Service View** | Individual Engineers & Consumers | • How many tokens and dollars have I consumed today/this week across uncached, cached, and reasoning buckets?<br>• How much of my personal quota/budget did prompt caching save me?<br>• How often am I hitting my quota limits (`429`) and what is my latency by model? | `dc_identity_user_id` *(filtered by viewer email)*, `dc_model`, `dc_total_token_count`, `dc_cache_read_token_count`, `dc_tx_cost_usd`, `response_status_code` |
| **5. Security, Guardrails & Quota Governance** | Security (CISO), Platform Operations | • How many prompts were blocked by **Model Armor** (`HTTP 400`)?<br>• Which users, agents, or teams are being throttled by **Token / USD Spend Quotas** (`HTTP 429`)?<br>• Who needs a temporary quota exception? | `response_status_code`, `dc_identity_user_id`, `dc_identity_team`, `dc_identity_persona`, `proxy_basepath`, `dc_requested_model` |
| **6. Smart Router & LLM Judge ROI** | AI Platform Architects, FinOps | • How much money did `"model": "auto:judge"` and cost tiers save compared to routing all calls to `gemini-3.1-pro-preview` or `gpt-5.4`?<br>• How much did response latency improve? | `dc_requested_model`, `dc_model`, `dc_tx_cost_usd`, `Average Latency` (`total_response_time`) |

---

## 2. Connect Looker Studio Directly to Apigee (Out-of-the-Box)

### Prerequisites

1. **Required IAM Role:** To connect Looker Studio to Apigee, your Google Cloud user account must have the **[`roles/apigee.analyticsEditor`](https://docs.cloud.google.com/apigee/docs/api-platform/analytics/data-studio#required-role)** role on your Google Cloud project:
   ```bash
   gcloud projects add-iam-policy-binding "$PROJECT_ID" \
     --member="user:YOUR_EMAIL@example.com" \
     --role="roles/apigee.analyticsEditor"
   ```
2. **Data Collectors Provisioned:** Ensure you have created the **18 custom `dc_*` Data Collectors** from [Telemetry & Headers](./telemetry.md#2-apigee-analytics-data-collectors-all-18-captured-metrics) (or [CI/CD & Deployment](./deployment.md#1-create-required-data-collectors-once-per-organization)) and sent at least a few requests through the gateway so the fields appear in your Apigee analytics schema.

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

When you click **Connect** in Step 1, Looker Studio opens the **Data Source Fields** list containing Apigee's built-in metrics (`Traffic`, `Average Latency`, `API Product`, `Application`, `response_status_code`) and your **18 custom `dc_*` Data Collectors**.

1. **Format All 6 USD Cost Metrics as Currency:**
   Locate each of the following 6 cost fields in the field list, click its **Type** dropdown (`Numeric > Number`), and select **Numeric &rarr; Currency &rarr; USD - $ US Dollar**:
   * **`dc_tx_cost_usd`** *(Total Transaction Cost USD)*
   * **`dc_tx_prompt_cost_usd`** *(Total Prompt Input Cost USD)*
   * **`dc_tx_uncached_prompt_cost_usd`** *(Uncached Prompt Input Cost USD)*
   * **`dc_tx_cache_read_cost_usd`** *(Cache Read Cost USD)*
   * **`dc_tx_cache_write_cost_usd`** *(Cache Write Cost USD)*
   * **`dc_tx_completion_cost_usd`** *(Completion & Reasoning Output Cost USD)*
2. **Add Calculated Dimensions & Metrics:**
   Click **+ Add a field** &rarr; **Add calculated field** in the top-right corner of the Data Source page and add the fields below.

> [!TIP]
> **Why These Formulas Never Fail in Looker Studio:**
> Looker Studio does not allow mixing non-aggregated **Dimensions** (like `dc_requested_model`) and aggregated **Metrics** (like `dc_tx_cost_usd`) inside the same `CASE WHEN` expression.
>
> Below, **Dimension formulas** only reference Dimensions, and **Metric formulas** only reference aggregated Metrics (`SUM(...)`). Notice how **`Prompt Cache Net Savings ($)`** derives the effective uncached token rate directly from `SUM(dc_tx_uncached_prompt_cost_usd) / SUM(dc_uncached_prompt_token_count)`, so it automatically adapts to every model's exact pricing and markup without hardcoding model prices.

#### Calculated Dimensions (Click `+ Add a field` &rarr; `Add calculated field`)

| Field Name to Enter | Formula to Paste |
| :--- | :--- |
| **`Workload Type`** | `CASE WHEN REGEXP_CONTAINS(LOWER(dc_identity_user_id), "principal://|spiffe://|\\.system\\.id\\.goog") THEN "Google Cloud Agent (Agent Identity)" WHEN ENDS_WITH(LOWER(dc_identity_user_id), ".iam.gserviceaccount.com") OR REGEXP_CONTAINS(LOWER(dc_identity_persona), "agent") THEN "Google Cloud Agent (Service Account)" ELSE "Human Developer" END` |
| **`Model Provider`** | `CASE WHEN REGEXP_CONTAINS(LOWER(dc_model), "gemini|text-embedding-005") THEN "Google Vertex AI (Gemini)" WHEN REGEXP_CONTAINS(LOWER(dc_model), "claude") THEN "Anthropic (Claude)" WHEN REGEXP_CONTAINS(LOWER(dc_model), "gpt|o3|text-embedding-3") THEN "OpenAI" WHEN REGEXP_CONTAINS(LOWER(dc_model), "llama|mistral") THEN "Vertex Model Garden (MaaS)" ELSE "Custom / Self-Hosted" END` |
| **`Routing Strategy`** | `CASE WHEN REGEXP_CONTAINS(LOWER(dc_requested_model), "auto") THEN "Auto-Routed (Smart Router / Judge)" ELSE "Direct Model Request" END` |
| **`Cost Tier`** | `CASE WHEN REGEXP_CONTAINS(LOWER(dc_model), "flash-lite") THEN "Tier Low (Gemini 3.1 Flash-Lite)" WHEN REGEXP_CONTAINS(LOWER(dc_model), "flash") THEN "Tier Medium (Gemini 3.5 Flash)" WHEN REGEXP_CONTAINS(LOWER(dc_model), "pro") THEN "Tier High (Gemini 3.1 Pro)" WHEN REGEXP_CONTAINS(LOWER(dc_model), "claude|gpt-5") THEN "Tier Max (Claude 4.6 / GPT-5.4)" ELSE "Other / Custom" END` |
| **`Enforcement Status`** | `CASE WHEN response_status_code = 200 THEN "Allowed (200 OK)" WHEN response_status_code = 429 THEN "Throttled: Quota / Rate Limit (429)" WHEN response_status_code = 400 THEN "Blocked: Model Armor / Validation (400)" WHEN response_status_code IN (401, 403) THEN "Rejected: Unauthorized (401/403)" ELSE "Other / Provider Error" END` |

#### Calculated Metrics (Click `+ Add a field` &rarr; `Add calculated field`)

| Field Name to Enter | Formula to Paste | Display Type (`Type` Dropdown) | What It Measures |
| :--- | :--- | :--- | :--- |
| **`Prompt Cache Hit Rate (%)`** | `SUM(dc_cache_read_token_count) / SUM(dc_prompt_token_count)` | **Numeric &rarr; Percent** | Share of input prompt tokens served from cache at discounted rates (75%–90% off). |
| **`Uncached Baseline Prompt Cost ($)`** | `SUM(dc_prompt_token_count) * (SUM(dc_tx_uncached_prompt_cost_usd) / SUM(dc_uncached_prompt_token_count))` | **Numeric &rarr; Currency (USD)** | What total prompt tokens would have cost if every input token were billed at the uncached rate. |
| **`Prompt Cache Net Savings ($)`** | `(SUM(dc_prompt_token_count) * (SUM(dc_tx_uncached_prompt_cost_usd) / SUM(dc_uncached_prompt_token_count))) - SUM(dc_tx_prompt_cost_usd)` | **Numeric &rarr; Currency (USD)** | Net dollar savings from prompt caching (cache-read discount minus any cache-write surcharge). |
| **`Prompt Cache Cost Reduction (%)`** | `((SUM(dc_prompt_token_count) * (SUM(dc_tx_uncached_prompt_cost_usd) / SUM(dc_uncached_prompt_token_count))) - SUM(dc_tx_prompt_cost_usd)) / (SUM(dc_prompt_token_count) * (SUM(dc_tx_uncached_prompt_cost_usd) / SUM(dc_uncached_prompt_token_count)))` | **Numeric &rarr; Percent** | Percentage reduction in total input token spend achieved through prompt caching. |
| **`Reasoning Token Share (%)`** | `SUM(dc_thinking_token_count) / SUM(dc_completion_token_count)` | **Numeric &rarr; Percent** | Share of output completion tokens spent on internal chain-of-thought reasoning (`thinking_tokens`). |
| **`Output Cost Share (%)`** | `SUM(dc_tx_completion_cost_usd) / SUM(dc_tx_cost_usd)` | **Numeric &rarr; Percent** | Share of total USD spend driven by completion and reasoning output tokens vs. input context. |
| **`Cost per 1K Tokens ($)`** | `SUM(dc_tx_cost_usd) / (SUM(dc_total_token_count) / 1000)` | **Numeric &rarr; Currency (USD)** | Blended effective cost per 1,000 tokens after caching and model mix. |
| **`Prompt-to-Completion Ratio`** | `SUM(dc_prompt_token_count) / SUM(dc_completion_token_count)` | **Numeric &rarr; Number** | Ratio of input context tokens to output tokens (`>10:1` indicates large repository context or agent loops). |
| **`Baseline Cost: Gemini 3.1 Pro ($)`** | `(SUM(dc_prompt_token_count) * 0.00000200) + (SUM(dc_completion_token_count) * 0.00001200)` | **Numeric &rarr; Currency (USD)** | Unrouted baseline cost if all requests had gone to `gemini-3.1-pro-preview`. |
| **`Baseline Cost: GPT-5.4 ($)`** | `(SUM(dc_prompt_token_count) * 0.00000250) + (SUM(dc_completion_token_count) * 0.00001500)` | **Numeric &rarr; Currency (USD)** | Unrouted baseline cost if all requests had gone to `gpt-5.4`. |
| **`Smart Router Net Savings ($)`** | `((SUM(dc_prompt_token_count) * 0.00000200) + (SUM(dc_completion_token_count) * 0.00001200)) - SUM(dc_tx_cost_usd)` | **Numeric &rarr; Currency (USD)** | Dollar savings from routing eligible requests to lower cost tiers via `auto:judge`. |
| **`Smart Router Cost Reduction %`** | `(((SUM(dc_prompt_token_count) * 0.00000200) + (SUM(dc_completion_token_count) * 0.00001200)) - SUM(dc_tx_cost_usd)) / ((SUM(dc_prompt_token_count) * 0.00000200) + (SUM(dc_completion_token_count) * 0.00001200))` | **Numeric &rarr; Percent** | Percentage cost reduction achieved by Smart Routing compared to `gemini-3.1-pro-preview`. |

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
     1. `dc_identity_team` *(Department / Team filter — e.g., `eng-ml`, `developer_team_a`, `developer_team_b`)*
     2. `dc_identity_persona` *(AI Product / Persona filter)*
     3. `dc_model` *(Routed Model filter)*

---

## 3. Step-by-Step Chart Configuration for All 6 Views

Select a tab below to build each page in your Looker Studio report (click **Page &rarr; New page** in the top menu to add pages):

=== "1. FinOps & Multi-Bucket Chargeback"

    **Goal:** Track invoice-accurate USD spend per department (`dc_identity_team`), AI Product (`dc_identity_persona`), and model provider, with complete visibility into **uncached input cost, cache-read/write cost, completion cost, and internal reasoning token overhead**.

    | Chart / Widget | Menu Action (`Insert > ...`) | Dimension(s) | Metric(s) | Setup Panel Configuration |
    | :--- | :--- | :--- | :--- | :--- |
    | **Total Spend ($)** | `Insert > Scorecard` | — | `dc_tx_cost_usd` (Sum) | Enable **Comparison date range: Previous period** |
    | **Input Prompt Spend ($)** | `Insert > Scorecard` | — | `dc_tx_prompt_cost_usd` (Sum) | Enable **Comparison date range: Previous period** |
    | **Output & Reasoning Spend ($)** | `Insert > Scorecard` | — | `dc_tx_completion_cost_usd` (Sum) | Enable **Comparison date range: Previous period** |
    | **Cost / 1K Tokens ($)** | `Insert > Scorecard` | — | `Cost per 1K Tokens ($)` | Blended unit cost across all token buckets |
    | **Reasoning Token Share (%)** | `Insert > Scorecard` | — | `Reasoning Token Share (%)` | Share of output tokens consumed by internal chain-of-thought (`dc_thinking_token_count`) |
    | **Daily Spend by Token Cost Bucket** | `Insert > Stacked column chart` | `Time` *(or `Date`)* | `dc_tx_uncached_prompt_cost_usd`, `dc_tx_cache_read_cost_usd`, `dc_tx_cache_write_cost_usd`, `dc_tx_completion_cost_usd` | Visualizes how daily spend splits across uncached prompts, cache hits, cache writes, and completions |
    | **Department & AI Product Chargeback Table** | `Insert > Table` | `dc_identity_team`, `dc_identity_persona`, `dc_model` | `Traffic`, `dc_tx_uncached_prompt_cost_usd`, `dc_tx_cache_read_cost_usd`, `dc_tx_cache_write_cost_usd`, `dc_tx_completion_cost_usd`, `dc_tx_cost_usd` | Sort by `dc_tx_cost_usd` **Descending**; check **Show summary row** for exact department chargeback |
    | **Reasoning vs. Visible Output by Model** | `Insert > Stacked bar chart` | `dc_model` | `dc_thinking_token_count` (Sum), `dc_completion_token_count` (Sum) | Identifies frontier reasoning models where `thinking_tokens` drive output spend |

=== "2. Prompt Cache & Context ROI"

    **Goal:** Quantify the dollar savings achieved by prompt caching (`dc_cache_read_token_count` / `dc_tx_cache_read_cost_usd`) and identify teams, personas, or coding tools sending large uncached contexts (`dc_uncached_prompt_token_count`) that could save 75%–90% by enabling prompt caching.

    | Chart / Widget | Menu Action (`Insert > ...`) | Dimension(s) | Metric(s) | Setup Panel Configuration |
    | :--- | :--- | :--- | :--- | :--- |
    | **Prompt Cache Net Savings ($)** | `Insert > Scorecard` | — | `Prompt Cache Net Savings ($)` | Enable **Comparison date range: Previous period** |
    | **Prompt Cache Cost Reduction (%)** | `Insert > Scorecard` | — | `Prompt Cache Cost Reduction (%)` | Percentage reduction in total prompt input cost |
    | **Prompt Cache Hit Rate (%)** | `Insert > Scorecard` | — | `Prompt Cache Hit Rate (%)` | Target `>60%` for coding CLI tools (`Claude Code`, `Codex`) and multi-turn agents |
    | **Total Cache Read Tokens** | `Insert > Scorecard` | — | `dc_cache_read_token_count` (Sum) | Total input tokens served from cache |
    | **Uncached Baseline vs. Actual Input Spend ($)** | `Insert > Time series chart` | `Time` *(or `Date`)* | `Uncached Baseline Prompt Cost ($)`, `dc_tx_prompt_cost_usd` (Sum) | In **Style**, set `Uncached Baseline Prompt Cost ($)` to a dashed red line and `dc_tx_prompt_cost_usd` to a solid green line; the gap between lines is your daily cache savings |
    | **Input Token Mix Over Time** | `Insert > Stacked area chart` | `Time` *(or `Date`)* | `dc_cache_read_token_count`, `dc_uncached_prompt_token_count`, `dc_cache_write_token_count` | Shows growth in cached context reuse vs. raw uncached input tokens |
    | **Cache Efficiency & Optimization Opportunities by Team** | `Insert > Table` | `dc_identity_team`, `dc_identity_persona`, `dc_model` | `dc_uncached_prompt_token_count`, `dc_cache_read_token_count`, `Prompt Cache Hit Rate (%)`, `dc_tx_uncached_prompt_cost_usd`, `dc_tx_cache_read_cost_usd`, `Prompt Cache Net Savings ($)` | Sort by `dc_tx_uncached_prompt_cost_usd` **Descending**. Rows with high uncached spend and low `Prompt Cache Hit Rate (%)` are immediate FinOps optimization targets |

=== "3. Team & Peer Consumption"

    **Goal:** Let engineering managers and team leads filter by their `dc_identity_team` (e.g., `eng-ml`, `developer_team_a`, `developer_team_b`) to see how peers (`dc_identity_user_id`) share the team's token/USD pool, which models each peer uses, and how effectively each peer leverages prompt caching.

    | Chart / Widget | Menu Action (`Insert > ...`) | Dimension(s) | Metric(s) | Setup Panel Configuration |
    | :--- | :--- | :--- | :--- | :--- |
    | **Team Selector** | `Insert > Drop-down list` | **Control field:** `dc_identity_team` | `dc_tx_cost_usd` (Sum) | Select a team (`eng-ml`, `developer_team_a`, etc.) to scope the page to peers on that team |
    | **Peer Share of Team Spend ($)** | `Insert > Bar chart` | `dc_identity_user_id` | `dc_tx_cost_usd` (Sum) | Sort by `dc_tx_cost_usd` **Descending** |
    | **Peer Model Mix (100% Stacked)** | `Insert > 100% stacked bar chart` | `dc_identity_user_id` | `dc_total_token_count` (Sum) | **Breakdown Dimension:** `dc_model` *(spots if one peer is exclusively calling `claude-opus-4-6` while teammates use `gemini-3.5-flash`)* |
    | **Peer Tokenomics & Cache Efficiency Matrix** | `Insert > Table` | `dc_identity_user_id`, `dc_identity_persona`, `dc_model` | `Traffic`, `dc_uncached_prompt_token_count`, `dc_cache_read_token_count`, `Prompt Cache Hit Rate (%)`, `dc_thinking_token_count`, `dc_total_token_count`, `dc_tx_cost_usd` | Click the pencil icon on `dc_tx_cost_usd` &rarr; **Comparison calculation: Percent of total** to show each peer's % of the shared team budget |

=== "4. Personal Developer Self-Service View"

    **Goal:** Give every developer a self-service page that automatically filters to their own logged-in corporate email (`dc_identity_user_id`), showing their personal token/USD burn, how much budget they saved via prompt caching, and any quota throttles (`429`).

    ### How to Enable Automatic Viewer Email Filtering
    1. Click **Page** (top menu) &rarr; **New page** and name it **"My AI Usage"**.
    2. Click **Resource** &rarr; **Manage added data sources** &rarr; click **Edit** next to your Apigee data source.
    3. In the top-left toolbar of the data source editor, click **Filter by email**.
    4. Check **Filter data by viewer's email**, select **`dc_identity_user_id`**, and click **Done**. *(Every engineer who opens this report now sees only their own rows).*

    | Chart / Widget | Menu Action (`Insert > ...`) | Dimension(s) | Metric(s) | Setup Panel Configuration |
    | :--- | :--- | :--- | :--- | :--- |
    | **My Total Spend ($)** | `Insert > Scorecard` | — | `dc_tx_cost_usd` (Sum) | — |
    | **My Cache Savings ($)** | `Insert > Scorecard` | — | `Prompt Cache Net Savings ($)` | Shows how much personal/team budget the developer saved by reusing cached context |
    | **My Cache Hit Rate (%)** | `Insert > Scorecard` | — | `Prompt Cache Hit Rate (%)` | — |
    | **My Total Tokens** | `Insert > Scorecard` | — | `dc_total_token_count` (Sum) | — |
    | **My Quota Throttles (429)** | `Insert > Scorecard` | — | `Traffic` | **Chart Filter:** `Include` &rarr; `response_status_code` &rarr; `Equals (=)` &rarr; `429` |
    | **My Token Usage by Bucket Over Time** | `Insert > Stacked column chart` | `Time` *(or `Date`)* | `dc_uncached_prompt_token_count`, `dc_cache_read_token_count`, `dc_thinking_token_count`, `dc_completion_token_count` | Shows personal daily consumption across cached vs. uncached vs. reasoning tokens |
    | **My Model & Cost Breakdown** | `Insert > Table` | `dc_model`, `proxy_basepath` | `Traffic`, `dc_prompt_token_count`, `Prompt Cache Hit Rate (%)`, `dc_completion_token_count`, `dc_tx_cost_usd`, `Average Latency` | Sort by `dc_tx_cost_usd` **Descending** |

=== "5. Security, Guardrails & Quota Governance"

    **Goal:** Audit every enforcement action taken by the AI Gateway: **Model Armor content safety blocks (`HTTP 400`)**, **Token & USD Quota throttling (`HTTP 429`)**, and **Unauthorized calls (`HTTP 401/403`)**.

    | Chart / Widget | Menu Action (`Insert > ...`) | Dimension(s) | Metric(s) | Setup Panel Configuration |
    | :--- | :--- | :--- | :--- | :--- |
    | **Quota Throttled Calls (429)** | `Insert > Scorecard` | — | `Traffic` | **Chart Filter:** `Include` &rarr; `response_status_code` &rarr; `Equals (=)` &rarr; `429` |
    | **Model Armor / Safety Blocks (400)** | `Insert > Scorecard` | — | `Traffic` | **Chart Filter:** `Include` &rarr; `response_status_code` &rarr; `Equals (=)` &rarr; `400` |
    | **Unauthorized Attempts (401/403)** | `Insert > Scorecard` | — | `Traffic` | **Chart Filter:** `Include` &rarr; `response_status_code` &rarr; `In` &rarr; `401, 403` |
    | **Enforcement Trend Over Time** | `Insert > Stacked column chart` | `Time` *(or `Date`)* | `Traffic` | **Breakdown Dimension:** `Enforcement Status` |
    | **Users & Teams Hitting Quotas (429)** | `Insert > Table` | `dc_identity_user_id`, `dc_identity_team`, `dc_identity_persona`, `dc_requested_model` | `Traffic` | **Chart Filter:** `Include` &rarr; `response_status_code` &rarr; `Equals (=)` &rarr; `429`. Identifies who may need a temporary `quota_override_tokens` or `quota_override_spend_micro_usd` exception |
    | **Model Armor Blocks by User & Endpoint** | `Insert > Table` | `dc_identity_user_id`, `dc_identity_team`, `proxy_basepath`, `dc_requested_model` | `Traffic` | **Chart Filter:** `Include` &rarr; `response_status_code` &rarr; `Equals (=)` &rarr; `400` |

=== "6. Smart Router & LLM Judge ROI"

    **Goal:** Quantify the dollar savings and latency reduction achieved when using `"model": "auto:judge"` or cost tiers (`auto:low`, `auto:medium`, `auto:high`) compared to routing all requests to `gemini-3.1-pro-preview` (`$2.00 / $12.00`) or `gpt-5.4` (`$2.50 / $15.00`).

    *Tip:* Add a **Page-level Filter** (`Page > Current page settings > + Add a filter`) with `Include` &rarr; `Routing Strategy` &rarr; `Equals (=)` &rarr; `Auto-Routed (Smart Router / Judge)` so all cards on this page measure auto-routed traffic.

    | Chart / Widget | Menu Action (`Insert > ...`) | Dimension(s) | Metric(s) | Setup Panel Configuration |
    | :--- | :--- | :--- | :--- | :--- |
    | **Smart Router Net Savings ($)** | `Insert > Scorecard` | — | `Smart Router Net Savings ($)` | — |
    | **Smart Router Cost Reduction (%)** | `Insert > Scorecard` | — | `Smart Router Cost Reduction %` | — |
    | **Unrouted Baseline vs. Actual Spend** | `Insert > Time series chart` | `Time` *(or `Date`)* | `Baseline Cost: Gemini 3.1 Pro ($)`, `dc_tx_cost_usd` (Sum) | In **Style**, set `Baseline Cost: Gemini 3.1 Pro ($)` to a dashed red line and `dc_tx_cost_usd` to a solid blue line |
    | **Judge Triage Distribution** | `Insert > Pie chart` (Donut) | `Cost Tier` | `Traffic` | Shows the % of auto-routed prompts handled by low/medium/high tiers |
    | **Latency & Economics by Tier** | `Insert > Table` | `Cost Tier`, `dc_model` | `Traffic`, `dc_total_token_count`, `dc_tx_cost_usd`, `Baseline Cost: Gemini 3.1 Pro ($)`, `Smart Router Net Savings ($)`, `Average Latency` | Sort by `Smart Router Net Savings ($)` **Descending** |

---

## 4. Bonus: Provision All 6 Reports in the Apigee Console via CLI

In addition to Looker Studio, you can provision all 6 reports directly inside **[Google Cloud Console &rarr; Apigee &rarr; Analytics &rarr; Custom reports](https://console.cloud.google.com/apigee/analytics/custom-reports)** with a single CLI snippet:

```bash
export PROJECT_ID="your-gcp-project-id"
TOKEN=$(gcloud auth print-access-token)

# 1. FinOps & Multi-Bucket Cost Chargeback by Team, AI Product & Model
curl -s -X POST "https://apigee.googleapis.com/v1/organizations/$PROJECT_ID/reports" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "displayName": "1. AI Gateway - FinOps & Multi-Bucket Cost Chargeback",
    "chartType": "column",
    "metrics": [
      {"name": "dc_tx_cost_usd", "function": "sum"},
      {"name": "dc_tx_uncached_prompt_cost_usd", "function": "sum"},
      {"name": "dc_tx_cache_read_cost_usd", "function": "sum"},
      {"name": "dc_tx_cache_write_cost_usd", "function": "sum"},
      {"name": "dc_tx_completion_cost_usd", "function": "sum"},
      {"name": "dc_total_token_count", "function": "sum"}
    ],
    "dimensions": ["dc_identity_team", "dc_identity_persona", "dc_model"],
    "filter": "(apiproxy eq '\''ai-gateway'\'')"
  }'

# 2. Prompt Caching & Context Optimization ROI by Team & Model
curl -s -X POST "https://apigee.googleapis.com/v1/organizations/$PROJECT_ID/reports" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "displayName": "2. AI Gateway - Prompt Caching & Context Optimization",
    "chartType": "column",
    "metrics": [
      {"name": "dc_cache_read_token_count", "function": "sum"},
      {"name": "dc_uncached_prompt_token_count", "function": "sum"},
      {"name": "dc_cache_write_token_count", "function": "sum"},
      {"name": "dc_tx_cache_read_cost_usd", "function": "sum"},
      {"name": "dc_tx_uncached_prompt_cost_usd", "function": "sum"},
      {"name": "dc_tx_prompt_cost_usd", "function": "sum"}
    ],
    "dimensions": ["dc_identity_team", "dc_identity_persona", "dc_model"],
    "filter": "(apiproxy eq '\''ai-gateway'\'')"
  }'

# 3. Team & Peer Consumption Breakdown (Including Cache & Reasoning Tokens)
curl -s -X POST "https://apigee.googleapis.com/v1/organizations/$PROJECT_ID/reports" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "displayName": "3. AI Gateway - Team & Peer Consumption",
    "chartType": "column",
    "metrics": [
      {"name": "dc_tx_cost_usd", "function": "sum"},
      {"name": "dc_total_token_count", "function": "sum"},
      {"name": "dc_cache_read_token_count", "function": "sum"},
      {"name": "dc_thinking_token_count", "function": "sum"},
      {"name": "message_count", "function": "sum"}
    ],
    "dimensions": ["dc_identity_team", "dc_identity_user_id", "dc_model"],
    "filter": "(apiproxy eq '\''ai-gateway'\'')"
  }'

# 4. Individual Developer & Agent Usage
curl -s -X POST "https://apigee.googleapis.com/v1/organizations/$PROJECT_ID/reports" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "displayName": "4. AI Gateway - Individual Developer & Agent Usage",
    "chartType": "line",
    "metrics": [
      {"name": "dc_tx_cost_usd", "function": "sum"},
      {"name": "dc_total_token_count", "function": "sum"},
      {"name": "dc_cache_read_token_count", "function": "sum"},
      {"name": "dc_uncached_prompt_token_count", "function": "sum"},
      {"name": "total_response_time", "function": "avg"}
    ],
    "dimensions": ["dc_identity_user_id", "dc_model", "response_status_code"],
    "filter": "(apiproxy eq '\''ai-gateway'\'')"
  }'

# 5. Security (Model Armor 400s) & Quota Enforcement (429s)
curl -s -X POST "https://apigee.googleapis.com/v1/organizations/$PROJECT_ID/reports" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "displayName": "5. AI Gateway - Security & Quota Enforcement (400 / 429)",
    "chartType": "column",
    "metrics": [
      {"name": "message_count", "function": "sum"}
    ],
    "dimensions": ["response_status_code", "dc_identity_user_id", "dc_identity_team", "dc_identity_persona"],
    "filter": "(apiproxy eq '\''ai-gateway'\'')"
  }'

# 6. Smart Router & LLM Judge Triage (Requested vs. Routed Model)
curl -s -X POST "https://apigee.googleapis.com/v1/organizations/$PROJECT_ID/reports" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "displayName": "6. AI Gateway - Smart Router & LLM Judge Triage",
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
