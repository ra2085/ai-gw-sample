# 📈 Looker Studio Auto-Router Cost Benefits Dashboard

This guide provides an end-to-end walkthrough for creating a **Looker Studio** executive dashboard that quantifies and visualizes the cost savings, workload triage, and financial ROI achieved by using the **Apigee AI Gateway Auto-Router & LLM Judge**.

By connecting Looker Studio directly to Apigee through the **native Apigee Analytics data connector**, you consume real-time telemetry from Apigee Data Collectors without requiring custom data pipelines or ETL infrastructure.

---

## 1. Executive Cost Model & Value Proposition

### Without Auto-Router (Legacy / Static Default)
Applications traditionally default to a single flagship or reasoning model (such as `gemini-2.5-pro` or `gpt-4o`) for all prompts.
* **Gemini 2.5 Pro Baseline**: \$1.25 / 1M input tokens + \$5.00 / 1M output tokens (Blended: ~\$2.75 / 1M tokens)
* **Flagship / GPT-4o Baseline**: \$2.50 / 1M input tokens + \$10.00 / 1M output tokens (Blended: ~\$5.50 / 1M tokens)
* **Problem**: Over 80% of enterprise requests are low-complexity queries (summarization, sentiment, extraction, simple Q&A, formatting) that do not require expensive reasoning weights.

### With Auto-Router & LLM Judge
The gateway dynamically classifies prompt complexity using a lightweight judge call (`gemini-3.1-flash-lite`, costing ~\$0.00002) and routes to the most cost-effective tier:
* **Tier Low (`gemini-3.1-flash-lite`)**: \$0.075 / 1M input, \$0.300 / 1M output (**~94% cheaper** than Gemini Pro)
* **Tier Medium (`gemini-3.5-flash`)**: \$0.100 / 1M input, \$0.400 / 1M output (**~92% cheaper** than Gemini Pro)
* **Tier High (`gemini-2.5-pro`)**: \$1.250 / 1M input, \$5.000 / 1M output (Preserved for complex coding and multi-step logic)
* **Tier Max (`claude-haiku-4-5`)**: \$1.000 / 1M input, \$5.000 / 1M output (Specialized tasks)

### Typical Financial Impact
Across standard enterprise traffic:
* **Blended Cost Reduction**: **75% – 90%**
* **Average Cost per 1,000 Tokens**: Reduced from **\$0.00285** to **\$0.00024**
* **Judge Classifier ROI**: **~94x** (Each \$1 spent on judge classification saves \$94 in backend LLM costs)
* **Latency Reduction**: 60%–70% drop in Time-to-First-Token (TTFT) for low/medium workloads

---

## 2. Apigee Telemetry Data Source

The AI Gateway emits metrics captured by the 6 standard Data Collectors on every non-streaming and streaming transaction:

| Data Collector / Dimension | Type | Description |
| :--- | :--- | :--- |
| **`dc_requested_model`** | `STRING` | Original consumer request intent (`auto:judge`, `auto:low`, `auto:medium`, `gpt-4o`, etc.) |
| **`dc_model`** | `STRING` | Effective model that processed the request (`gemini-3.1-flash-lite`, `gemini-3.5-flash`, etc.) |
| **`dc_tx_cost_usd`** | `FLOAT` | Micro-transaction cost in USD calculated by the gateway |
| **`dc_total_token_count`** | `INTEGER` | Total token consumption (Prompt + Completion) |
| **`dc_prompt_token_count`** | `INTEGER` | Billed prompt input token count |
| **`dc_completion_token_count`**| `INTEGER` | Billed completion output token count |
| **`developer_app`** | `STRING` | Consumer developer application name |
| **`developer_email`** | `STRING` | Consumer developer contact email |
| **`apiproxy`** | `STRING` | Proxy name (`ai-gateway`) |
| **`response_status_code`** | `INTEGER` | HTTP status code (200, 4xx, 5xx) |
| **`total_response_time`** | `INTEGER` | Round-trip latency in milliseconds |

---

## 3. Connecting Looker Studio to Apigee Analytics

Follow these steps to connect Looker Studio directly to your Apigee organization:

### Method A: From the Apigee Cloud Console (Recommended)
1. Open the [Google Cloud Console - Apigee Custom Reports](https://console.cloud.google.com/apigee/analytics/custom-reports).
2. Ensure your active Google Cloud project is selected.
3. In the top-right toolbar, click **Create More Reports Using Data Studio**.
4. In the template preview, click **Use my own data**.
5. In the **Apigee Organization Name** prompt, enter your Apigee organization ID (matches your GCP project ID, e.g. `your-project-id`).
6. Click **Add** to create the report.

### Method B: From Looker Studio Directly
1. Navigate to [Looker Studio](https://lookerstudio.google.com/).
2. Click **+ Create** &rarr; **Data Source**.
3. Under Google Connectors, locate and select the **Apigee** connector (or search for `Apigee - Analytics`).
4. Click **Authorize** to grant Looker Studio permission to query Apigee Analytics via your Google Account.
   *(Requires role `roles/apigee.analyticsEditor` or `roles/apigee.analyticsViewer`).*
5. In the **Apigee Organization Name** field, enter your organization name (e.g. `your-org-name`).
6. Select your environment (e.g. `eval`, `dev`, `qa`, or `prod`).
7. Click **Connect** in the top right.

---

## 4. Looker Studio Calculated Fields

Once the Apigee data source is connected in Looker Studio, add the following **Calculated Fields** (`+ Add a Field` in the Data pane) to calculate the counterfactual baseline costs and net savings:

### 1. `Routing Strategy` (Dimension)
Categorizes requests into Auto-Routed vs. Direct Model requests:
```sql
CASE 
  WHEN REGEXP_MATCH(dc_requested_model, '.*auto.*') THEN 'Auto-Routed (Smart Router / Judge)'
  ELSE 'Direct Model Request'
END
```

### 2. `Cost Tier` (Dimension)
Maps transactions to their respective cost tier:
```sql
CASE 
  WHEN REGEXP_MATCH(dc_requested_model, '.*low.*') OR dc_model = 'gemini-3.1-flash-lite' THEN 'Tier Low (Flash-Lite)'
  WHEN REGEXP_MATCH(dc_requested_model, '.*medium.*') OR dc_model = 'gemini-3.5-flash' THEN 'Tier Medium (Flash)'
  WHEN REGEXP_MATCH(dc_requested_model, '.*high.*') OR dc_model = 'gemini-2.5-pro' THEN 'Tier High (Pro)'
  WHEN REGEXP_MATCH(dc_requested_model, '.*max.*') OR dc_model = 'claude-haiku-4-5' THEN 'Tier Max (Claude)'
  ELSE 'Direct / Default'
END
```

### 3. `Baseline Cost - Pro Tier ($)` (Metric, Type: Currency USD)
Calculates what each auto-routed request would have cost if routed to the standard reasoning baseline (`gemini-2.5-pro` @ \$1.25 / 1M prompt and \$5.00 / 1M completion):
```sql
CASE 
  WHEN REGEXP_MATCH(dc_requested_model, '.*auto.*') THEN 
    (dc_prompt_token_count * 0.00000125) + (dc_completion_token_count * 0.00000500)
  ELSE dc_tx_cost_usd
END
```

### 4. `Baseline Cost - Flagship GPT-4o ($)` (Metric, Type: Currency USD)
Alternative baseline for comparison against OpenAI flagship pricing (\$2.50 / 1M prompt and \$10.00 / 1M completion):
```sql
CASE 
  WHEN REGEXP_MATCH(dc_requested_model, '.*auto.*') THEN 
    (dc_prompt_token_count * 0.00000250) + (dc_completion_token_count * 0.00001000)
  ELSE dc_tx_cost_usd
END
```

### 5. `Net Cost Savings ($)` (Metric, Type: Currency USD)
Net dollar amount saved by the Auto-Router per request:
```sql
CASE 
  WHEN REGEXP_MATCH(dc_requested_model, '.*auto.*') THEN 
    ((dc_prompt_token_count * 0.00000125) + (dc_completion_token_count * 0.00000500)) - dc_tx_cost_usd
  ELSE 0
END
```

### 6. `Cost Savings %` (Metric, Type: Percent)
Overall percentage reduction in LLM spend:
```sql
(SUM(
  CASE 
    WHEN REGEXP_MATCH(dc_requested_model, '.*auto.*') THEN 
      (dc_prompt_token_count * 0.00000125) + (dc_completion_token_count * 0.00000500)
    ELSE dc_tx_cost_usd
  END
) - SUM(dc_tx_cost_usd)) / 
SUM(
  CASE 
    WHEN REGEXP_MATCH(dc_requested_model, '.*auto.*') THEN 
      (dc_prompt_token_count * 0.00000125) + (dc_completion_token_count * 0.00000500)
    ELSE dc_tx_cost_usd
  END
)
```

### 7. `Cost per 1K Tokens ($)` (Metric, Type: Currency USD)
Effective blended cost per 1,000 tokens:
```sql
SUM(dc_tx_cost_usd) / (SUM(dc_total_token_count) / 1000)
```

---

## 5. Dashboard Layout Architecture

The recommended Looker Studio report layout consists of 4 distinct analytical sections:

```
+-----------------------------------------------------------------------------------------------+
|  Apigee AI Gateway: Auto-Router Cost Benefits & Savings Dashboard                             |
|  Filters: [ Date Range: Last 30 Days ] [ Developer App: All ] [ Routing Strategy: All ]       |
+-----------------------------------------------------------------------------------------------+
|  [ SCORECARD ]         [ SCORECARD ]         [ SCORECARD ]         [ SCORECARD ]              |
|  Total Net Savings     Cost Reduction %      Auto-Routed Calls     Cost / 1K Tokens           |
|  $12,480.50            78.4%                 450,210               $0.00024                   |
+-----------------------------------------------------------------------------------------------+
|  CHART 1: Cumulative Cost Over Time         |  CHART 2: Daily Cost Savings by Tier           |
|  (Baseline Pro Cost vs. Actual Cost)         |  (Stacked Bar: Low vs. Med vs. High)           |
+-----------------------------------------------------------------------------------------------+
|  CHART 3: Traffic Triage Distribution        |  CHART 4: Net Savings by Developer App        |
|  (Donut: Flash-Lite 55%, Flash 30%, Pro 15%) |  (Horizontal Bar: App A, App B, App C)        |
+-----------------------------------------------------------------------------------------------+
|  TABLE: Detailed Model Economics & Performance Matrix                                         |
|  [Model] [Calls] [Tokens] [Actual Cost] [Baseline Cost] [Net Savings] [Savings %] [Avg Latency]|
+-----------------------------------------------------------------------------------------------+
```

### Component Details

#### Row 1: Executive KPI Scorecards
* **Scorecard 1: Total Net Savings ($)**
  * Metric: `Net Cost Savings ($)`
  * Comparison: Previous Period (Show percentage increase in savings)
* **Scorecard 2: Overall Cost Reduction (%)**
  * Metric: `Cost Savings %`
  * Format: Percentage (`78.4%`)
* **Scorecard 3: Auto-Routed Traffic**
  * Metric: `message_count`
  * Filter: `Routing Strategy = 'Auto-Routed (Smart Router / Judge)'`
* **Scorecard 4: Blended Unit Cost**
  * Metric: `Cost per 1K Tokens ($)`
  * Format: Currency USD (`$0.00024`)

#### Row 2: Financial Trend Visualizations
* **Chart 1: Cumulative Cost Comparison (Time Series)**
  * Dimension: `Date`
  * Metric 1: `Baseline Cost - Pro Tier ($)` (Style: Red dashed line, label: "Un-routed Baseline")
  * Metric 2: `Actual Cost ($)` (Style: Solid blue line, label: "With Auto-Router")
  * *Insight*: The widening gap between the two curves visually depicts accumulating financial savings.
* **Chart 2: Daily Savings Breakdown (Stacked Column)**
  * Dimension: `Date`
  * Breakdown Dimension: `Cost Tier`
  * Metric: `Net Cost Savings ($)`
  * *Insight*: Demonstrates that 85% of daily savings stem from Tier Low and Tier Medium triage.

#### Row 3: Workload Triage & Attribution
* **Chart 3: Traffic Triage Breakdown (Donut Chart)**
  * Dimension: `Cost Tier`
  * Metric: `message_count`
  * *Expected distribution*: Tier Low (50%–60%), Tier Medium (25%–35%), Tier High (10%–15%), Tier Max (2%–5%).
* **Chart 4: Savings Leaderboard by Application (Bar Chart)**
  * Dimension: `developer_app`
  * Metric: `Net Cost Savings ($)`
  * Sort: Descending by `Net Cost Savings ($)`
  * *Insight*: Identifies which developer teams and applications are driving the highest ROI.

#### Row 4: Model Economics Matrix (Interactive Table)
* Dimensions: `dc_model`
* Metrics:
  * `message_count` (Volume)
  * `dc_total_token_count` (Tokens)
  * `Actual Cost ($)`
  * `Baseline Cost - Pro Tier ($)`
  * `Net Cost Savings ($)`
  * `Cost Savings %`
  * `total_response_time` (Avg Latency in ms)

---

## 6. Verifying Telemetry with `apigeecli`

You can verify that your AI Gateway is actively populating telemetry and data collectors using `apigeecli` (`~/.apigeecli/bin/apigeecli`):

```bash
# Verify the 6 required Data Collectors exist in your Apigee org
~/.apigeecli/bin/apigeecli datacollectors list \
  --org "$PROJECT_ID" \
  --default-token

# Inspect the deployed AI Gateway proxy revisions
~/.apigeecli/bin/apigeecli apis get \
  -n ai-gateway \
  --org "$PROJECT_ID" \
  --default-token

# List existing custom reports
~/.apigeecli/bin/apigeecli reports list \
  --org "$PROJECT_ID" \
  --default-token
```

To generate live test transactions across all auto-router tiers and observe real-time telemetry headers:

```bash
# Run the Smart Routing test suite
./tests/scripts/test_smart_routing.sh "$APIGEE_HOST" "$API_KEY"

# Run the LLM Judge complexity classifier test suite
./tests/scripts/test_judge.sh "$APIGEE_HOST" "$API_KEY" "$PROJECT_ID"
```
