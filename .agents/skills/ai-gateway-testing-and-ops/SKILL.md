---
name: ai-gateway-testing-and-ops
description: >-
  Runbook for building, testing (offline JUnit + Node/Rhino/Java worker harness and live Apigee X E2E),
  using cloud-run-mocks prompt directives, syncing Apigee API Products/Developer Apps via sync-personas.sh,
  and maintaining MkDocs GitHub Pages CI. Activate this skill whenever running tests, adding unit/E2E test
  cases, debugging failures, running scripts/sync-personas.sh, or editing docs/CI workflows.
---

# Apigee Enterprise AI Gateway — Testing, Mock Harness & Operations Runbook

Use this skill whenever building `callout/`, running `tests/run.sh`, adding unit or live E2E tests, updating `scripts/sync-personas.sh`, or modifying `mkdocs.yml` / `.github/workflows/deploy-docs.yml`.

---

## 1. CLI Test Runner (`tests/run.sh`) & Maven Build Portability

Always run tests through `./tests/run.sh` from the repository root. Its `ensure_callout_jar` helper automatically runs `mvn -q -f callout/pom.xml package` (executing all JUnit 5 tests) and copies `callout/target/ai-gateway-callouts.jar` $\rightarrow$ `templates/ai-gateway/resources/java/ai-gateway-callouts.jar` whenever any file under `callout/src` or `callout/pom.xml` is newer than the shaded JAR.

- **Maven Mirror vs. Clean-Clone Rule (`callout/pom.xml`)**:
  - `callout/pom.xml` intentionally keeps top-level `<repositories>` **empty** so environments using an internal Maven mirror never contact external registries directly.
  - Clean external clones and CI runners resolve `com.apigee.gateway.libraries:message-flow:1.0.0` and `com.apigee.infra.libraries:expressions:1.0.0` via the opt-in `-Ppublic-apigee-repo` profile (`./tests/run.sh` auto-activates `-Ppublic-apigee-repo` **only** when `message-flow-1.0.0.jar` is absent from `${M2_REPO:-~/.m2/repository}` and no `<mirror>` is configured in `~/.m2/settings.xml`, controllable via `MAVEN_PUBLIC_APIGEE_REPO=auto|true|false`).

### 1.1 Offline Suites (Zero Cloud Dependencies — Mandatory Before Finishing Work)
```bash
# Full offline verification (8-step template/parity/sync-personas mock suite + 31 JUnit 5 tests + all 64 unit/skill groups + quickstart render)
./tests/run.sh offline

# Fast targeted offline runs during iteration:
./tests/run.sh unit                        # Force mvn package + JUnit 5 + all 5 Node/Java/Rhino suites (64 groups)
./tests/run.sh unit 04_routing             # Filter unit suite by filename/test group substring
./tests/run.sh performance                 # Run 01_performance_skill.test.js (VarCache, step counts, zero-waste XML)
./tests/run.sh security                    # Run 02_security_skill.test.js (SSRF, StrictJson, JWT, OAS parity, FaultRules)
./tests/run.sh template                    # Run tests/scripts/test_template.sh (feature flags, PropertySets, sync-personas REST mock)
./tests/run.sh quickstart                  # Render & schema-validate values.quickstart.yaml locally
```

### 1.2 Live Apigee X Integration Suites, Auth Selection & Zero-Secret Rule
> **Zero-Secret Rule**: Never hardcode real Consumer Keys, GCP project IDs, Apigee hostnames, or Service Account emails in `tests/templates/*.yaml` or `tests/scripts/*.sh`. Copy `tests/env/example.env` to a gitignored `tests/env/<your-env>.env` file; live scripts substitute `${PROJECT_ID}`, `${APIGEE_HOST}`, `${API_KEY}`, etc. into a temporary rendered values file at runtime. Never run two live `byo` deployments concurrently against the same Apigee environment (`--ovr` revision replacement will cause the first poller to `404`).
>
> **Control-Plane & Client Testing Auth (When vs. When Not to Use ADC)**:
> - **Interactive CLI / Local Runs**: Always prefer `-t "$(gcloud auth print-access-token)"` (`gcloud auth login`) over `--default-token` so operators and agents never require `gcloud auth application-default login` or pick up stale ADC files.
> - **Data-Plane Gateway Probes**: Authenticate with the Apigee Consumer Key (`x-api-key: $API_KEY`) or Persona Bearer token. When testing `/ai-gateway` via `google-genai` (`vertexai=True`) or `AnthropicVertex`, pass placeholder credentials (`Credentials("gateway-managed")` / `access_token="gateway-managed"`) with `x-api-key` in headers so client SDKs skip local ADC lookup.
> - **When ADC *Is* Appropriate**: Only in headless Workload Identity CI/CD without `gcloud` (`apigeecli --default-token`), Terraform, or Option 3 (`agent_identity`) workloads on Cloud Run / GKE / Vertex Agent Engine using metadata-server ADC.

```bash
# Run all 72 live BYO/transcoding/Model Armor/circuit-breaker/wallet-matrix tests against an existing deployment
./tests/run.sh byo --env tests/env/<your-env>.env --skip-deploy

# Compile, deploy to the target Apigee X environment, and run all 72 live E2E tests
./tests/run.sh byo --env tests/env/<your-env>.env

# Run minimal quickstart live test suite (renders from templates/ai-gateway/values.quickstart.yaml)
./tests/run.sh quickstart --live --env tests/env/<your-env>.env --skip-deploy
```

---

## 2. How the Offline Unit Harness Works (`tests/unit/`)

1. **Java Callout Bridge**:
   - `tests/unit/helpers/java_worker.js` spawns a persistent JVM running `CalloutHarnessCli.java` (`callout/src/test/java/com/google/apigee/callouts/CalloutHarnessCli.java`) with the **actual shaded `templates/ai-gateway/resources/java/ai-gateway-callouts.jar`** first on `CLASSPATH`.
   - `InstrumentedMessageContext.java` (`callout/src/test/java/com/google/apigee/callouts/InstrumentedMessageContext.java`) mocks Apigee's `MessageContext` and `Message` SPIs, recording per-variable `readCounts`, `writeCounts`, and `duplicateReads` so `01_performance_skill.test.js` can fail any callout that reads the same `MessageContext` variable twice or exceeds microsecond latency budgets.
   - **Important**:
     - Never reference `com.apigee.flow.message.TransportMessage` in `InstrumentedMessageContext` or any callout class (`com.apigee.nio.channels.InputChannel` is not on the public SPI classpath).
     - When testing multi-step callout sequences in JUnit (`CalloutSecurityAndPerformanceTest.java`), evaluate `getDuplicateReads()` on a fresh `InstrumentedMessageContext` per individual callout step (matching Apigee's per-step `VarCache` lifecycle).
     - `test(...)` blocks in `tests/unit/*.test.js` are synchronous—do not prefix `test(...)` with top-level `await`.
2. **Rhino `<EventFlow>` Bridge**:
   - `tests/unit/helpers/rhino_harness.js` executes `templates/ai-gateway/resources/jsc/combine_resp.js` chunk-by-chunk across simulated TCP boundaries to test SSE transcoding, tool blocks, carry-over buffering, and final token/USD cost calculation.
3. **Direct JUnit 5 Suite**:
   - `CalloutSecurityAndPerformanceTest.java` tests concurrency/thread-safety across worker pools, `StrictJson` limits/duplicate keys/`BigDecimal` precision, SSRF/GCS/Vertex project isolation, OpenAI vs. Vertex OpenAI-compat `reasoning_tokens` parity, and `Message` header population.

---

## 3. Live Mock Harness Directives (`cloud-run-mocks/`)

In a live test environment where `https://<APIGEE_HOSTNAME>/mock/...` fronts the unstaged `cloud-run-mocks/` FastAPI service, deterministic E2E tests can run without external OpenAI/Anthropic/IdP SaaS dependencies:

- **LLM Prompt Directives** (`/mock/v1/chat/completions`, `/mock/v1/messages`):
  - `echo: <text>` — Deterministically echoes `<text>` in non-streaming or SSE delta chunks.
  - `error: <status>: <msg>` (e.g., `error: 503: GPU overloaded`) — Forces HTTP `429`/`500`/`503` to test fallback chains and rolling-window circuit breakers.
  - `tokens: <prompt>,<completion> [cache: <read>] [thinking: <reasoning>]` — Emits exact `usage` counts to test token/micro-USD quota and wallet matrix math.
  - `simulate_response: pii` — Emits a synthetic SSN (`123-45-6789`) in the model response to test Model Armor response-phase DLP (`SMR-SanitizeModelResponse`).
- **Auth & Wire Inspection Endpoints**:
  - `/mock/oauth2/tokeninfo` & `/mock/oauth2/v1/userinfo` — Deterministic SPIFFE (`ya29.spiffe*`), GCP SA (`ya29.sa*`), and IdP (`okta_*`) token introspection mocks.
  - `GET /mock/_debug/history` (`DELETE /mock/_debug/history` to clear) — Returns recorded inbound wire headers/payloads (used to verify zero blank headers and secret stripping on outbound calls).

---

## 4. Persona Provisioning (`scripts/sync-personas.sh`) & Docs / Mermaid Authoring

### 4.1 `scripts/sync-personas.sh`
- Safely upserts the synthetic Developer, per-persona `APIProduct`s (`llmOperationGroup.operationConfigs` including catalog models, aliases, `auto*`, and `shared_wallet`), and `DeveloperApp`s without rotating existing approved `consumerKey`s.
- Preserves existing environments, external proxy operations (`operationGroup` / other `apiSource` entries), unmanaged custom attributes, and unmanaged top-level REST `quota*` fields while stripping legacy `proxies`/`apiResources` on `PUT`.
- Uses `umask 077`, auto-refreshes `gcloud` tokens on HTTP `401`, and masks `client_id` in stdout only when `CI=true` (override via `--show-keys` or `0600` `--write-snippet <file>`). Always test changes with `--dry-run` and `./tests/run.sh template`.

### 4.2 MkDocs, GitHub Pages (`.github/workflows/deploy-docs.yml`) & Mermaid Diagrams
- Because there is no tracked `requirements.txt` or `pyproject.toml` in the repository, **never** add `cache: "pip"` to `actions/setup-python@v5` in `deploy-docs.yml` (it fails when no `requirements.txt` matches).
- CI builds docs with `mkdocs build --strict`—whenever adding, renaming, or moving files under `docs/`, verify all `nav:` entries in `mkdocs.yml`, strict 4-space indentation inside `=== "Tab"` blocks, and all relative markdown links.
- **Mermaid `sequenceDiagram` Gotchas**: Never place `;` inside a `sequenceDiagram` message label (Mermaid treats `;` as a statement separator and fails parsing!), avoid inline HTML tags (`<br/>`, `<token>`), quote `flowchart` labels containing parentheses/brackets (`Node["Label (detail)"]`), and use translucent `rect rgba(r, g, b, 0.12)` backgrounds so diagrams stay legible in both light and dark modes.
