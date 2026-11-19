# Apigee AI Gateway Test Architecture

This directory contains the automated test suites, skill validation checks, template parity verifiers, and live endpoint probes for the Apigee AI Gateway.

---

## Directory Layout

```text
tests/
├── run.sh                                     # Unified CLI test runner
├── README.md                                  # Test suite documentation
├── unit/                                      # Offline Rhino JS, policy XML & skill validation suites
│   ├── run_unit_tests.js                      # Node.js test runner (supports suite filtering)
│   ├── helpers/
│   │   └── harness.js                         # Rhino sandbox simulator & static/template parity verifier
│   ├── 01_performance_skill.test.js           # Validates .agents/skills/apigee-performance-engineering
│   ├── 02_security_skill.test.js              # Validates .agents/skills/apigee-security-engineering
│   ├── 03_auth_personas.test.js               # Validates 4-option auth, SPIFFE/SA globs, team personas
│   ├── 04_routing_transcoding.test.js         # Validates MaaS, OpenAI/Anthropic/Gemini transcoding & failover
│   └── 05_quotas_monetization_armor.test.js   # Validates token/cost buckets, Virtual USD Wallets & Model Armor
├── scripts/                                   # Primary integration & template rendering suites
│   ├── test_template.sh                       # 8-step Helm template render, feature toggle & parity suite
│   ├── test_quickstart.sh                     # Offline minimal 20-line values.quickstart.yaml verifier
│   ├── test_quickstart_live.sh                # Live Apigee quickstart deployment & E2E verification
│   └── test_byo_models.sh                     # Live BYO model & multi-provider integration suite
├── probes/                                    # Targeted curl probes for manual live gateway debugging
│   ├── test_claude.sh
│   ├── test_claude_models.sh
│   ├── test_claude_stream.sh
│   ├── test_gemini_native.sh
│   ├── test_gemini_native_claude.sh
│   ├── test_gemini_native_stream.sh
│   ├── test_judge.sh
│   ├── test_judge_prompts.sh
│   ├── test_openai_compat.sh
│   ├── test_quota_stream.sh
│   ├── test_smart_routing.sh
│   └── test_smart_stream.sh
└── env/                                       # Environment configuration templates for live suites
    └── example.env
```

---

## Building the Java Callouts (`callout/`)

`./tests/run.sh` automatically compiles `callout/` (`mvn package`), runs all 31 JUnit 5 tests, and syncs the shaded JAR to `templates/ai-gateway/resources/java/ai-gateway-callouts.jar`.

- **Environments using an internal Maven mirror**:
  ```bash
  mvn -f callout/pom.xml package
  ```
- **Clean external clones / CI runners** (fetches Apigee's `message-flow` and `expressions` SPI JARs from `https://us-maven.pkg.dev/apigee-release/apigee-java-callout-dependencies`; auto-detected by `./tests/run.sh`):
  ```bash
  mvn -f callout/pom.xml package -Ppublic-apigee-repo
  ```

---

## Quick Start Commands

Run all offline test suites (requires `java` 11+, `mvn`, `node`, and `apigee-go-gen`; zero cloud credentials needed):

```bash
./tests/run.sh offline
```

Run specific offline suites:

```bash
# Run all 31 JUnit 5 tests + all 5 modular Java/Rhino/policy unit suites (64 test groups)
./tests/run.sh unit

# Run only the apigee-performance-engineering skill validation suite
./tests/run.sh performance

# Run only the apigee-security-engineering skill validation suite
./tests/run.sh security

# Filter unit suites by substring (e.g. auth, routing, quotas)
./tests/run.sh unit auth

# Run the 8-step template rendering, feature toggle & sync-personas dry-run suite
./tests/run.sh template

# Validate the minimal 20-line values.quickstart.yaml template
./tests/run.sh quickstart
```

Run live end-to-end suites against a deployed Apigee X / Hybrid environment (copy `tests/env/example.env` to a gitignored `tests/env/dev.env` first):

```bash
# Run live quickstart verification against an existing deployment
./tests/run.sh live --env tests/env/dev.env --skip-deploy

# Run the 72-test BYO model & multi-provider live suite
./tests/run.sh byo --env tests/env/dev.env --skip-deploy

# List or run individual diagnostic curl probes in tests/probes/
./tests/run.sh probe
./tests/run.sh probe claude_stream
```

---

## How Rhino Sandbox Invariants Are Enforced (`tests/unit/helpers/harness.js`)

Every time any unit test executes a JavaScript callout via `runScript(scriptName, vars)`, the test harness automatically enforces four runtime and repository invariants:

1. **Static vs. Template Byte-for-Byte Parity**: Compares `apiproxy/resources/jsc/<script>` against `templates/ai-gateway/resources/jsc/<script>` and fails immediately if the two copies drift.
2. **Rhino `TopLevelScope` Leak Detection**: Executes the script inside an isolated Node `vm` context and verifies that zero global properties are added to the scope outside the IIFE.
3. **Zero Duplicate `context.getVariable(k)` Reads**: Tracks every `context.getVariable(k)` call within a single script execution and fails if any key is read more than once (enforcing local variable caching per `apigee-performance-engineering` Rule 2).
4. **NativeObjectWrapper Bypass Prevention**: Fails if a script passes a raw JavaScript `Array` or `Function` to `context.setVariable(k, v)`, which would pin Rhino's `TopLevelScope` in `MessageContext`.

---

## Skill Validation Coverage Matrix

### 1. `apigee-performance-engineering` (`tests/unit/01_performance_skill.test.js`)

| Test ID | Skill Rule Validated | Verification Mechanism |
| :--- | :--- | :--- |
| `PERF-SKILL-01` | Rule 1: Rhino `TopLevelScope` & IIFE isolation | Inspects all 22 JS callouts for `(function() { 'use strict'; ... })();` wrapper and byte-for-byte template parity |
| `PERF-SKILL-02` | Rule 3: Never touch `.content.asJSON` or `.content.asXML` | Static AST/source scan across all 22 JS callouts for `.asJSON` and `.asXML` |
| `PERF-SKILL-03` | Rule 4: Zero `<Properties>` on `<Javascript>` & zero `<ReadPropertySet>` steps | Scans all `<Javascript>` XML/YAML policies and verifies direct `propertyset.*` O(1) resolution |
| `PERF-SKILL-04` | Rule 5: Never use Rhino `httpClient` or `waitForComplete()` | Scans all JS callouts for `httpClient` and `waitForComplete` |
| `PERF-SKILL-05` | Rule 2: Cache `context.getVariable()` locally (zero duplicate reads) | Executes all 22 JS callouts through `runScript()` with per-key read-count assertions |
| `PERF-SKILL-06` | Rule 7: Never reference `*.content` or slow regexes in `<Condition>` | Parses every `<Condition>` in all 5 `ProxyEndpoints` and 5 `TargetEndpoints` |
| `PERF-SKILL-07` | Rule 8: Never use `<RaiseFault>` inside `<FaultRules>` or `<DefaultFaultRule>` | Parses `<FaultRules>` and `<DefaultFaultRule>` across all proxies and targets |
| `PERF-SKILL-08` | Rule 9: Set `clearPayload="true"` on `<ServiceCallout>` policies | Verifies all 5 `SC-*.xml` policies and YAML templates |
| `PERF-SKILL-09` | Rule 10: Conditional SSE streaming & 5-step `<EventFlow>` ceiling | Verifies `gemini-native-target.xml` and `gemini.xml` omit global streaming and stay within `<= 5` EventFlow steps |
| `PERF-SKILL-10` | Hot-path JSON parse & external key lookup avoidance | Verifies Vertex AI requests skip external API key reads and `prepare_judge_request.js` reuses `gemini_text_prompt` |
| `PERF-SKILL-11` | Flat `<DataCapture>` variable binding & bounded JS `timeLimit` | Verifies `DC-*.xml` `<Collect>` refs never re-parse payloads and all `JS-*.xml` set `timeLimit="200"` |

### 2. `apigee-security-engineering` (`tests/unit/02_security_skill.test.js`)

| Test ID | Skill Rule Validated | Verification Mechanism |
| :--- | :--- | :--- |
| `SEC-SKILL-01` | Section 1.1: Fail-closed `continueOnError="false"` on security policies | Verifies OAS, Model Armor (`SUP-*`, `SMR-*`), Quota (`LTQ-EnforceOnly`), and Monetization (`MLC-*`) policies |
| `SEC-SKILL-02` | Section 1.4 & 3.1: JWT hardening & pre-verification claim trap defense | Verifies `RS256`, `IgnoreCriticalHeaders=false`, static JWKS `uriRef`, and rejects forged JWTs even when `jwt.*.claim.*` is populated |
| `SEC-SKILL-03` | Section 1.5 & 3.2: Secret isolation in `private.*` & query-param key stripping | Verifies `private.fallback_header_*` isolation, `request.queryparam.apikey`/`key` removal, and `Authorization: Bearer` in `SC-VerifyAgentToken` |
| `SEC-SKILL-04` | Section 5.4 & 7.2: Confused-deputy `token_ref` allowlist, header injection & rate-limit spoofing | Blocks `request.header.cookie` exfiltration, blocks `Host` header override, ignores client `X-Gateway-*` rate headers, and strips CRLF |
| `SEC-SKILL-05` | Section 5.3: SSRF & path traversal prevention in model, team & target URLs | Tests `../../` traversal payloads in `model` and `accesstoken.team`, plus `target.copy.pathsuffix=false` |
| `SEC-SKILL-06` | Section 3.6: Outbound TLS `<Enforce>true</Enforce>` on all targets & callouts | Verifies `<SSLInfo><Enforce>true</Enforce></SSLInfo>` across all 5 `TargetEndpoints` and all 5 `ServiceCallouts` |
| `SEC-SKILL-07` | Section 7.2: Prototype pollution & object-key injection resilience | Tests `__proto__`, `constructor`, and `toString` in role claims and model names |
| `SEC-SKILL-08` | Section 4.5: Rate-limit `<Identifier>` binding to verified server variables | Verifies `LTQ-EnforceOnly` and `LTQ-SecondaryEnforceOnly` bind `<Identifier>` to `rate_limit_client_id` / `secondary_quota_identifier` |
| `SEC-SKILL-09` | Section 5.4: Zero empty `<Remove><Headers/></Remove>` blocks | Scans all `AM-*.xml` policies to prevent accidental header/payload wipeout |
| `SEC-SKILL-10` | Section 6 & 7.2: Zero-leak error responses & malformed JSON fuzzing resilience | Verifies fault policies never leak `error.content`/`fault.reason`/`private.*` and fuzzes all 15 parser callouts with malformed payloads |
