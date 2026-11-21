---
name: ai-gateway-config-lifecycle
description: >-
  Guides safe Day-2 configuration management of the Apigee Enterprise AI Gateway via values.yaml overrides
  without modifying apigee-go-gen templates or Java callouts. Enforces secret hygiene, schema/reference
  validation, isolated bundle rendering, non-destructive API Product syncing, blast-radius protection,
  and sanitized GitHub Issue / Pull Request creation when template enhancements are needed. Activate this
  skill whenever configuring models, personas, quotas, pricing, authentication, Model Armor, environments,
  rendering/deploying a values file, or creating GitHub Issues or Pull Requests.
---

# Apigee Enterprise AI Gateway — YAML Configuration Lifecycle & Safe Ops

Activate this skill whenever a user asks to configure, customize, validate, render, or deploy the gateway (models, personas, quotas/wallets, pricing, authentication, Model Armor, routing), or to open a GitHub Issue / Pull Request.

---

## 1. Golden Boundary: Hands Off the Template Engine

During configuration and operational tasks, treat the template engine and Java source as **immutable**:

1. **Read-Only Engine Files**:
   - **Never** edit `templates/ai-gateway/apiproxy.yaml`, `templates/ai-gateway/_helpers.tmpl`, `templates/ai-gateway/policies/*`, `templates/ai-gateway/resources/**`, or `callout/**` to satisfy a configuration change.
   - **Never** hand-edit generated XML, `.properties`, or `.js` files inside `out/`—they are ephemeral build outputs overwritten on every render.
2. **Protect the Tracked Baseline `templates/ai-gateway/values.yaml`**:
   - Keep `templates/ai-gateway/values.yaml` strictly as a sanitized reference template (`project_id: "your-gcp-project-id"`, `client_id: ""`).
   - Write all environment-specific configurations into gitignored override files: `/values.yaml` (repo root) or `tests/templates/values.<env>.local.yaml`.
3. **Prevent `os_writefile` Working-Tree Pollution**:
   - Running `apigee-go-gen render apiproxy` directly against `templates/ai-gateway/apiproxy.yaml` executes `os_writefile` into `templates/ai-gateway/resources/properties/*.properties`, which leaks live `project_id`s and `client_id`s into tracked Git files!
   - **Always** render via [validate-values.sh](./scripts/validate-values.sh) (`--output ./out/<env>`), which stages `templates/ai-gateway/` into a temporary `0700` directory so the Git working tree stays 100% clean.
4. **Zero Local Filesystem Paths in Tracked Files**:
   - **Never** write absolute local filesystem paths (`/Users/...`, `/home/...`, `file:///...`), usernames, or machine-specific directory names into any tracked repository file, `.agents/` skill/rule, `docs/` page, commit message, Issue, or PR. Always use repo-relative paths.

---

## 2. `values.yaml` Schema & Security Invariants

Follow `docs/template-guide/` and enforce these rules whenever authoring or reviewing a values file:

- **Zero Plaintext Upstream Secrets**:
  - **Never** set `models[].auth.token` to a live API key (`sk-ant-...`, `sk-proj-...`, `AIza...`).
  - Always use `auth.token_ref: "propertyset.provider_keys.<key_name>"` and upload actual secrets out-of-band to the Apigee Environment `provider_keys` PropertySet via REST API (`POST/PUT .../environments/{env}/resourcefiles?type=properties&name=provider_keys`).
  - **Never** introduce Apigee KVMs.
- **Model Catalog & Referential Integrity**:
  - Every model ID referenced in `defaults.model`, `defaults.fallback`, `routing.tiers.*`, `routing.tasks.*`, and `routing.aliases.*` **must** exist under `models[].name`.
  - Valid `models[].target` values: `gemini`, `claude`, `gemini-openai-compat`, `openai-custom` (external/non-Vertex `custom_url` endpoints must use `openai-custom` or `claude`—never attach Google IAM tokens to third-party hosts).
  - Valid `models[].format` values: `gemini`, `anthropic`, `openai`.
- **Pricing & Quotas / Virtual Wallets**:
  - `pricing.*_rate` (`input_rate`, `output_rate`, `cache_read_rate`, `cache_write_rate`) must be **non-negative numbers per 1M tokens** (e.g., `1.500`, never `"$1.50"`).
  - Setting `quota.limit: 0` or `quota.limit_usd: 0` intentionally enforces an **immediate `429` hard block** (`zero_primary_quota`); omit the `quota:` block if you want the persona to inherit API Product defaults instead.
- **Model Armor & Authentication**:
  - `features.model_armor.location` **must** be a regional GCP location (e.g., `us-central1`, `europe-west4`)—**never** `"global"`.
  - When `features.auth.idp_jwt.enabled: true`, explicitly set `jwks_uri`, `issuer`, `audience`, and an asymmetric `algorithm` (`RS256`..`PS512` / `ES256`..`ES512`—never `none` or `HS*`).
  - When `features.auth.agent_identity.enabled: true` for Vertex Agent Engine SPIFFE tokens, explicitly set `allowed_trust_domain` (never `*`).

---

## 3. Safe Lifecycle Workflow (Validate -> Dry-Run -> Sync -> Deploy)

### Step 1: Validate & Stage-Render Offline (Mandatory After Every YAML Edit)
Run the bundled validator to verify YAML syntax, secret hygiene, model/persona references, and a clean staged `apigee-go-gen` bundle render:

```bash
bash .agents/skills/ai-gateway-config-lifecycle/scripts/validate-values.sh \
  --values ./values.yaml \
  --output ./out/ai-gateway
```

### Step 2: Preview & Sync Apigee API Products / Personas (`--dry-run` First)
Whenever `models:`, `routing.aliases:`, or `features.auth.personas:` change, you **must** sync Apigee `APIProduct`s (`llmOperationGroup`) via `scripts/sync-personas.sh`—otherwise Apigee's product check will reject newly added models at runtime (`403`):

```bash
# 1. Always preview non-destructively first and review output with the user:
bash scripts/sync-personas.sh --values ./values.yaml --org "$PROJECT_ID" --env "$APIGEE_ENV" --dry-run

# 2. Apply additive upsert (preserves existing Consumer Keys, environments, and external operations):
bash scripts/sync-personas.sh --values ./values.yaml --org "$PROJECT_ID" --env "$APIGEE_ENV" \
  --write-snippet ./tests/env/personas.local.yaml
```

### Step 3: Correct Auth Flags & Blast-Radius Gate Before Live Deployment / Testing
- **Use Active `gcloud` User Token (`-t`), Reserve ADC Only for Headless CI / Workloads**:
  - Interactive / CLI ops (`apigeecli`, REST calls): **always** pass `-t "$(gcloud auth print-access-token)"` (uses active `gcloud auth login`). Never pass `--default-token` interactively (it ignores `gcloud auth login`, demands `gcloud auth application-default login`, and can pick up stale ADC files).
  - **When ADC *is* appropriate**: Only in headless Workload Identity CI/CD without `gcloud` (`apigeecli --default-token`), Terraform, or Option 3 Cloud Run / GKE / Vertex Agent Engine runtime workloads fetching their own attached Service Account / SPIFFE token via metadata server.
- **Zero-ADC Client Gateway Testing**:
  - Test deployed gateway endpoints with the Apigee Consumer Key (`x-api-key: $API_KEY`) or Persona Bearer token—never ask users to run `gcloud auth application-default login` to call the gateway.
  - When writing `google-genai` (`vertexai=True`) or `AnthropicVertex` SDK snippets targeting `/ai-gateway`, pass placeholder credentials (`Credentials("gateway-managed")` or `access_token="gateway-managed"`) alongside `headers={"x-api-key": api_key}` so the client SDK skips local ADC lookup.
- **Stop and ask the user for confirmation** before:
  - Importing/deploying a new revision to a shared `staging` or `prod` Apigee environment.
  - Deleting or revoking any `APIProduct`, `DeveloperApp`, Consumer Key, `DataCollector`, or `PropertySet`.
  - Modifying IAM bindings on the Apigee runtime Service Account.
- Confirm `git status --short` shows **zero** modified files under `templates/ai-gateway/` before concluding.

---

## 4. Stop-and-Escalate Gate: GitHub Issues & Pull Requests

If a user's requirement **cannot** be achieved through `values.yaml` alone (for example, adding a new policy step, a new wire protocol path, a new auth mechanism, or changing callout logic):

1. **STOP—Do Not Silently Patch Templates During a Config Task.**
2. **Explain the Boundary Clearly**: State what `values.yaml` supports today and why the gap requires an upstream template or Java callout change.
3. **Offer Two Explicit Paths**:
   - **Option A — File a GitHub Issue (Default for Operators)**: Draft and/or submit a sanitized feature request or bug report using `gh issue create`.
   - **Option B — Maintainer Feature PR (Only With Explicit User Approval)**: Switch to contributor mode on a feature branch (`git checkout -b feat/<short-name>`), activate `ai-gateway-architecture` + `ai-gateway-testing-and-ops`, run `./tests/run.sh offline` to 100% pass, and open a sanitized PR.
4. **Mandatory Redaction & Templates**:
   - Always read [issue-and-pr-templates.md](./references/issue-and-pr-templates.md) and run its pre-flight secret/path/tenant redaction check **before** executing `git commit`, `git push`, `gh issue create`, or `gh pr create`.
