---
trigger: always_on
---

# Apigee Enterprise AI Gateway — Mandatory Project Guardrails

Follow these repository invariants on every task unless the user explicitly instructs otherwise:

1. **Repository & Secret Boundaries (`.gitignore`)**:
   - `callout/target/`, `tests/env/*` (except `tests/env/example.env`), local `*.env` / `/values.yaml` files, and optional local mock directories (`cloud-run-mocks/`) are **intentionally gitignored**. **Never** un-ignore them or commit live Consumer Keys, GCP project IDs, Apigee hostnames, Service Account emails, local workstation paths/usernames (`/Users/...`, `/home/...`, `file:///...`), or internal environment files to Git.
   - Tracked deliverables are `templates/ai-gateway/` (including `templates/ai-gateway/resources/java/ai-gateway-callouts.jar`), `callout/` (`pom.xml` + `src/`), `tests/` (excluding `tests/env/*` other than `tests/env/example.env`), `.agents/`, `scripts/sync-personas.sh`, `docs/`, `openapi.yaml`, `mkdocs.yml`, `.github/workflows/deploy-docs.yml`, `README.md`, and `LICENSE`.
   - In `callout/pom.xml`, **never** add unconditional top-level `<repositories>`—keep `https://us-maven.pkg.dev/apigee-release/apigee-java-callout-dependencies` strictly inside the opt-in `<profile><id>public-apigee-repo</id></profile>` so environments routing through an internal Maven mirror never contact external registries directly.
   - Whenever any `.java` file in `callout/` is modified, rebuild and sync `callout/target/ai-gateway-callouts.jar` to `templates/ai-gateway/resources/java/ai-gateway-callouts.jar` (`./tests/run.sh` handles this via `ensure_callout_jar`).

2. **Strict Policy, Resource & Telemetry Footprint**:
   - **No Apigee KVMs**: Never introduce `KeyValueMapOperations` policies or KVMs. Secrets use bundle/environment `PropertySet`s (`token_ref: "propertyset.provider_keys.<key>"`) isolated into `private.*` flow variables at runtime.
   - **No `<CORS>` Policy**: Never add `CORS-Preflight.yaml` or `<CORS>` policies.
   - **Exact Bundle Counts**: Default rendered bundle (`templates/ai-gateway/values.yaml`) must preserve **`57` policies**, **`22` `<JavaCallout>` XMLs**, **`1` `<Javascript>` XML** (`templates/ai-gateway/resources/jsc/combine_resp.js` for `<EventFlow>` SSE), **`5` `ProxyEndpoint`s**, **`5` `TargetEndpoint`s**, and the exact **`18` `dc_*` `DataCollector`s** (enforced by `tests/unit/01_performance_skill.test.js` and `tests/scripts/test_template.sh`).
   - **OpenAPI Relative Paths**: Never prefix paths in `openapi.yaml` or `templates/ai-gateway/resources/oas/gemini.yaml` with `/ai-gateway` (Apigee `<OASValidation>` matches against `proxy.pathsuffix`, which is relative to `<BasePath>/ai-gateway</BasePath>`).

3. **Zero-Regression, Configuration Lifecycle & Hot-Path Verification**:
   - Activate skill `ai-gateway-config-lifecycle` whenever configuring `values.yaml` overrides (models, personas, quotas, pricing, auth, Model Armor), rendering/deploying environment configurations, or creating GitHub Issues / Pull Requests. During configuration/ops tasks, treat `templates/ai-gateway/` and `callout/` as strictly read-only—never hand-edit Go templates or tracked `templates/ai-gateway/values.yaml` with live environment values.
   - Activate skill `ai-gateway-architecture` before modifying `callout/` or `templates/ai-gateway/` for approved core gateway feature work.
   - Activate skill `ai-gateway-testing-and-ops` before running live tests, modifying `tests/` or `scripts/sync-personas.sh`, or editing `.github/workflows/deploy-docs.yml`.
   - Always run `./tests/run.sh offline` and verify 100% pass before concluding any code or template change.
