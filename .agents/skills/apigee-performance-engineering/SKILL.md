---
name: apigee-performance-engineering
description: Generates highly optimized, thread-safe, and zero-waste Apigee API Proxies, SharedFlows, JavaScript callouts, and Java callouts. Enforces best practices covering Message Templates, JSONPath/XPath, variable extraction, Rhino JS scope isolation, BaseCallout Java patterns, out-of-the-box policy selection, error handling, FaultRules, NIO streaming, and metrics cardinality reduction.
---

# AI Assistant Skill: High-Performance Apigee Proxy, SharedFlow, JavaScript & Java Callout Engineering

Use this skill whenever designing, generating, reviewing, or refactoring Apigee API Proxies, SharedFlows, JavaScript callouts, Java callouts, FaultRules, or TargetEndpoints to maximize throughput, minimize tail latency, and eliminate unnecessary heap allocations.

---

## 1. Core Runtime Architecture & The "Zero-Waste" Mental Model

Account for three mechanical realities of the Apigee Message Processor before adding policies or custom code:

### 1.1 Threading Model: Non-Blocking NIO Event Loop vs. Worker Thread Pool
- **Two Primary Execution Contexts**:
  1. **Non-Blocking NIO Event Loop Threads**: Handle TCP/TLS handshakes, socket reads/writes, outbound connection pool checkout/checkin, and lightweight synchronous policies (`AssignMessage`, `CORS`, `BasicAuthentication`, `FlowCallout`, `DecodeJWT`, and local non-distributed `SpikeArrest`).
  2. **Main Worker Thread Pool**: Fixed-size worker pool used for flow resumptions and heavier policies (`JavaScript`, `JavaCallout`, `ExtractVariables`, `KeyValueMapOperations`, `LookupCache`/`PopulateCache`/`ResponseCache`, `OAuthV2`/`VerifyAPIKey`, `Quota`, distributed `SpikeArrest`, `JSONThreatProtection`, `OASValidation`).
- **Rule**: Prefer lightweight NIO-compatible policies (such as `AssignMessage` and direct `{propertyset.*}` references) over worker-pool policies (`JavaScript`, `JavaCallout`) when equivalent, and **never block a runtime thread** with synchronous network I/O, `Thread.sleep()`, or Rhino `exchange.waitForComplete()`.

### 1.2 Step Count & Per-Policy Telemetry Cardinality Multiplier
- **What Happens on Every Executed Step**:
  Every executed policy step records `apigee.metrics.policy.<policyName>.timeTaken` in `MessageContext`, allocates per-step execution statistics, and updates policy latency histograms tagged by `{policy_name, proxy_name, revision}`.
- **The SharedFlow / FlowHook Cardinality Multiplier**:
  Steps inside a SharedFlow are tagged with the **calling API Proxy's** `proxy_name` and `revision`:
  $$\text{Series per Step} = \text{Deployed Proxies} \times \text{Active Revisions} \times (\text{Histogram Buckets} + 3)$$
- **Rule**: **Consolidate steps aggressively**, especially inside SharedFlows attached to FlowHooks (`PreProxyFlowHook`, `PreTargetFlowHook`, `PostTargetFlowHook`, `PostProxyFlowHook`). Never use 5 separate `AssignMessage` or `ExtractVariables` policies when 1 consolidated policy with 5 `<AssignVariable>` or `<Variable>` blocks can do the job.

### 1.3 Streaming vs. Full Heap Payload Buffering (`byte[]` Churn)
- **How Streaming Works**:
  When streaming is active (or when Apigee X `<EventFlow>` processes SSE chunks), bytes pipe from the inbound channel to the outbound channel in bounded chunks without materializing the full body in heap.
- **What Breaks Streaming / Causes Contiguous Heap Allocations**:
  1. Policies that parse the full body (`JSONThreatProtection`, `XMLThreatProtection`, `OASValidation`, `ExtractVariables` on JSON/XML payloads) drain the stream into heap buffers.
  2. Reading `request.content`, `response.content`, `message.content`, or `error.content` in any `<Condition>`, `MessageTemplate`, or callout materializes a contiguous `byte[]` copy plus a full UTF-8 `String` on heap.
  3. On Apigee X SSE endpoints using `<EventFlow>` (`content.event.type = MESSAGE_CHUNK`), **omit** legacy `response.streaming.enabled = true` on `ProxyEndpoint` and `TargetEndpoint` so `<EventFlow>` can inspect and transform chunks cleanly.

---

## 2. Decision Matrix: Choose Out-of-the-Box Capabilities Before Custom Code

Always follow this strict preference order (**fastest / lowest-overhead first**):

| Gateway Requirement | Optimal Out-of-the-Box Solution | Avoid (Anti-Pattern) | Why (Runtime Mechanics) |
| :--- | :--- | :--- | :--- |
| **Static or environment-specific config (URLs, timeouts, flags, non-secret keys)** | Direct `{propertyset.<set>.<key>}` variable reference in any policy/template/condition | `<KeyValueMapOperations>`, `<ReadPropertySet>` step, or `<Javascript>` config maps | Direct $O(1)$ lookup from an immutable in-memory map loaded at deployment time with zero step overhead. |
| **Default values / null-coalescing across variables** | `AssignMessage` `<Template>{firstnonnull(var1, var2, 'default')}</Template>` or `{var:default}` | `<Javascript>` `if/else` fallback scripts | Lazily evaluates arguments left-to-right on the NIO thread with zero Rhino scope allocation. |
| **UUIDs, SHA/MD5 digests, HMAC signatures, Base64, URL/JSON/XML escaping, Date formatting** | `AssignMessage` `<AssignVariable><Template>` built-in functions (`{createUuid()}`, `{hmacSha256(...)}`, `{sha256Hex(...)}`, `{encodeBase64(...)}`, `{timeFormatUTC(...)}`) or `<HMAC>` / `<BasicAuthentication>` | `<Javascript>` `crypto.*`, custom UUID regex generators, or custom `<JavaCallout>` | Template function AST nodes are pre-compiled at deployment time and execute native JVM hashing, JCA `Mac`, and `UUID.randomUUID()` directly. |
| **Extracting 1–2 JSON fields to build headers/payloads/variables** | `AssignMessage` `<Template>{jsonPath($.path, request.content)}</Template>` | `<Javascript>` `request.content.asJSON` or adding a separate `<ExtractVariables>` step | Caches compiled `JsonPath` expressions in memory and runs inline without an extra policy step or worker-pool hop. |
| **Extracting $\ge 3$ fields from a JSON Object (`{...}`) or typed extraction (`integer`, `boolean`)** | Single consolidated `<ExtractVariables>` policy with `<JSONPayload>` | Multiple `<ExtractVariables>` steps or `<Javascript>` `response.content.asJSON` | Parses the root JSON object once and evaluates all `<Variable>` queries against the same parsed structure. |
| **Extracting fields from a root JSON Array (`[...]`)** | `<JavaCallout>` streaming/DOM parse (or `<Javascript>` `JSON.parse(context.getVariable('request.content'))` inside an IIFE) | `<ExtractVariables>` with multiple `<Variable>` tags on a root JSON array | **Runtime Trap**: On root JSON arrays (`[...]`), `<ExtractVariables>` re-serializes and re-parses the array per `<Variable>` entry. |
| **Extracting XML elements/attributes** | Single `<ExtractVariables>` with `<XMLPayload stopPayloadProcessing="true">` | `xpath()` in `MessageTemplate` for multiple fields, or DOM parsing in JS | Compiles XPaths into a single streaming SAX pass and halts parsing immediately once all targets match. |
| **Extracting URI path segments, headers, or query params** | `<ExtractVariables>` with simple `{var}` patterns (e.g., `<Pattern ignoreCase="true">/v1/users/{userId}/orders/{orderId}</Pattern>`) | `<Javascript>` `split('/')` / regex or `{var:regex}` when `{var}` suffices | Simple `{var}` path templates compile to fast region-matching nodes with zero `java.util.regex` allocation. |
| **Asserting a condition and raising a fault if false** | `<AssertCondition>` policy | Conditional `<RaiseFault>` with boilerplate payload when standard fault suffices | Evaluates the pre-compiled condition AST and raises `steps.assertcondition.AssertionFailed` directly. |
| **Reading JWT claims after `<VerifyJWT>`** | Reference `jwt.<VerifyJWT-Policy-Name>.claim.<name>` and `jwt.<VerifyJWT-Policy-Name>.header.<name>` directly | Adding `<DecodeJWT>` before/after `<VerifyJWT>` or Base64 decoding in `<Javascript>` | `<VerifyJWT>` automatically populates all decoded header and payload claim flow variables. |
| **Reading App, Developer, or API Product custom attributes after `<VerifyAPIKey>` or `<OAuthV2>`** | Reference `verifyapikey.<Policy>.<custom_attr>`, `app.<custom_attr>`, `apiproduct.<custom_attr>`, `developer.<custom_attr>` directly | Adding an `<AccessEntity>` policy after `<VerifyAPIKey>` or `<OAuthV2>` | `<VerifyAPIKey>` and `<OAuthV2>` automatically populate App, Developer, Product, and Token custom attributes from the in-memory entity cache. |
| **Formatting error responses inside `<FaultRules>` or `<DefaultFaultRule>`** | `<AssignMessage>` | `<RaiseFault>` inside `<FaultRules>` | Calling `<RaiseFault>` inside `<FaultRules>` throws a second fault and aborts error handling (`FlowState.ABORT`), skipping `<DefaultFaultRule>` (`<AlwaysEnforce>`) and response CORS headers. |

---

## 3. Mastering Message Templates, Expressions & Variable Extraction

### 3.1 Complete Catalog of All 38 Built-in `MessageTemplate` Functions
Every template string in `<AssignMessage>`, `<ServiceCallout>`, `<RaiseFault>`, `<MessageLogging>`, `<PublishMessage>`, and `<TargetEndpoint>` (`<URL>`) is compiled **once at deployment time** into an AST and evaluated into a `StringBuilder` with **zero runtime template parsing**:

| Category | Built-in Functions (Exact Signatures) | Runtime Mechanics & Notes |
| :--- | :--- | :--- |
| **Null Coalescing & Fallbacks** | • `{firstnonnull(var1, var2, ..., 'literalFallback')}`<br>• `{variable.name:defaultLiteral}`<br>• `{target.url:https://host:8443/path}` (in `<URL>`) | `firstnonnull` **lazily resolves** arguments left-to-right and treats unresolved variables as `null` regardless of `<IgnoreUnresolvedVariables>`. |
| **String & Regex Manipulation** | • `{toLowerCase(var)}`<br>• `{toUpperCase(var)}`<br>• `{substring(var, startIdx, endIdx)}`<br>• `{substring(var, startIdx)}`<br>• `{replaceAll(var, regexStr, replacement)}`<br>• `{replaceFirst(var, regexStr, replacement)}` | `substring` supports **negative indices** (e.g., `-4` = 4 chars from end) and safely clamps out-of-bounds indices without throwing. `replaceAll`/`replaceFirst` cache compiled `Pattern` instances. |
| **Cryptographic Hashes** | • `{md5Hex(var)}` / `{md5Base64(var)}`<br>• `{sha1Hex(var)}` / `{sha1Base64(var)}`<br>• `{sha256Hex(var)}` / `{sha256Base64(var)}`<br>• `{sha384Hex(var)}` / `{sha384Base64(var)}`<br>• `{sha512Hex(var)}` / `{sha512Base64(var)}` | Executes native JVM cryptographic hashing on the NIO thread. |
| **Cryptographic HMACs** | • `{hmacMd5(key, val, [keyEnc], [outEnc])}`<br>• `{hmacSha1(key, val, [keyEnc], [outEnc])}`<br>• `{hmacSha224(key, val, [keyEnc], [outEnc])}`<br>• `{hmacSha256(key, val, [keyEnc], [outEnc])}`<br>• `{hmacSha384(key, val, [keyEnc], [outEnc])}`<br>• `{hmacSha512(key, val, [keyEnc], [outEnc])}` | Backed by `javax.crypto.Mac`. `keyEnc` accepts `utf-8`/`utf8` (default), `base16`/`hex`, `base64`. `outEnc` accepts `base64` (default), `base16`/`hex`. |
| **Encoding & Escaping** | • `{encodeBase64(var)}` / `{decodeBase64(var)}`<br>• `{escapeJSON(var)}`<br>• `{escapeXML(var)}` / `{escapeXML11(var)}`<br>• `{encodeHTML(var)}` | Uses thread-safe `java.util.Base64` encoders and standard JSON/XML/HTML escapers. |
| **JSON & XML Path Extraction** | • `{jsonPath(query, jsonVar)}`<br>• `{jsonPath(query, jsonVar, 'true')}`<br>• `{xpath(xpathExpr, xmlVar, [returnType], [ns1...ns10])}`<br>• `{xPath(xpathExpr, xmlVar, [returnType], [ns1...ns10])}` | `jsonPath` caches compiled expressions and automatically unwraps 1-element `JsonArray` results unless the 3rd arg is `'true'`. |
| **UUID & Random Generation** | • `{createUuid()}`<br>• `{randomLong()}` / `{randomLong(max)}` / `{randomLong(min, max)}`<br>• `{xeger(regexStr)}` | `createUuid()` uses `UUID.randomUUID().toString()`. |
| **Date / Time Formatting** | • `{timeFormat(pattern, epochSecVar)}`<br>• `{timeFormatMs(pattern, epochMsVar)}`<br>• `{timeFormatUTC(pattern, epochSecVar)}`<br>• `{timeFormatUTCMs(pattern, epochMsVar)}` | Uses cached `java.time.format.DateTimeFormatter` instances. |

### 3.2 Chaining `<AssignVariable>` in `AssignMessage` to Eliminate JavaScript Policies
- **Key Constraint**: `MessageTemplate` does **not** support nested function calls inside a single `{...}` tag (e.g., `{toLowerCase(firstnonnull(a, b))}` is invalid syntax).
- **The Solution**: All `<AssignVariable>`, `<Set>`, `<Add>`, `<Copy>`, and `<Remove>` blocks inside a single `<AssignMessage>` execute **sequentially in declaration order** on the NIO thread:
  ```xml
  <AssignMessage name="AM-SetLayer1Metadata">
    <IgnoreUnresolvedVariables>true</IgnoreUnresolvedVariables>
    <AssignVariable>
      <Name>layer1.sso.raw_url</Name>
      <Template>{firstnonnull(propertyset.iam_config.sso_url,propertyset.env_defaults.sso_url)}</Template>
    </AssignVariable>
    <AssignVariable>
      <Name>layer1.sso.host</Name>
      <Template>{replaceAll(layer1.sso.raw_url,'^https?://([^/]+).*$','$1')}</Template>
    </AssignVariable>
    <AssignVariable>
      <Name>generated.uuid</Name>
      <Template>AG-{createUuid()}</Template>
    </AssignVariable>
    <Set>
      <Headers>
        <Header name="X-Correlation-ID">{firstnonnull(request.header.X-Request-ID,generated.uuid)}</Header>
      </Headers>
    </Set>
  </AssignMessage>
  ```

### 3.3 Optimizing `<Condition>` Expressions
Condition expressions compile to an AST evaluated on every step/flow transition:
1. **Use the Fastest Operator Available**:
   - **Tier 1 (Zero Allocation, Fastest)**: `=` / `==`, `!=`, and `=|` / `StartsWith` (direct `String.startsWith()`).
   - **Tier 2 (Very Fast, Case-Insensitive)**: `:=` / `EqualsCaseInsensitive` (`regionMatches(true, ...)`). *Note: RHS must be a constant string literal.*
   - **Tier 3 (Fast Glob/Path Matching)**: `~/` / `MatchesPath` and `~` / `Matches` (wildcard glob matcher without `java.util.regex`).
   - **Tier 4 (Slowest — Avoid When Tier 1–3 Can Work)**: `~~` / `JavaRegex` (allocates a `java.util.regex.Matcher` on every evaluation, causing heavy `Matcher` churn under high RPS).
2. **Order Boolean Clauses for Short-Circuiting**:
   - `and` and `or` short-circuit left-to-right. Always place exact equality (`request.verb = "POST"`) or `StartsWith` (`proxy.pathsuffix =| "/v1/orders"`) **before** any `MatchesPath` or `JavaRegex` check, and **never** reference `request.content` or `response.content` in a `<Condition>`.

---

## 4. High-Performance JavaScript Callouts (Mozilla Rhino Rules)

When procedural logic requires a `<Javascript>` policy (such as `<EventFlow>` SSE chunk handling), enforce all six rules below:

### Rule 1: Always Wrap Every Script in an IIFE with `'use strict'`
- **Why**: Top-level `var` or `function` declarations bind properties onto the Rhino execution scope on every invocation, and passing non-plain Rhino objects (`Array`, `Function`, `Date`) to `context.setVariable()` can retain the entire scope via parent-scope references.
- **Pattern**:
  ```javascript
  (function () {
    'use strict';
    // All vars and helper functions live in the local activation frame
    // and are immediately eligible for GC when })(); completes.
  })();
  ```

### Rule 2: Cache `context.getVariable()` Reads Locally and Batch `context.setVariable()` Writes
- **Why**: Every `context.getVariable(name)` crosses the Rhino-to-Java security bridge (and non-`String` values incur an extra `toString()` bridge conversion).
- **Pattern**:
  - Read each required flow variable **at most once** into a local `var` inside the IIFE.
  - Never call `context.getVariable()` or `context.setVariable()` inside a loop; accumulate results locally and write **once** at the end.
  - Never store raw JS `Array` or `Function` objects into `context.setVariable()` (serialize to a JSON `String` or primitive/String values instead).

### Rule 3: Never Use `.content.asJSON` or `.content.asXML` for Read-Only Payload Access
- **Why**: Rhino's `.content.asJSON` / `.content.asXML` wrapper has **no dirty flag**: merely reading `request.content.asJSON.foo` or `response.content.asJSON.bar` causes the policy exit hook to walk the entire Rhino object tree, serialize it back to a JSON/XML `String`, and overwrite the message payload via `setContent(...)`! Furthermore, `request` and `context.proxyRequest` (or `response` and `context.targetResponse`) are separate wrapper instances—accessing `.asJSON` on both parses and re-serializes the payload twice!
- **Pattern**:
  ```javascript
  // BAD (triggers unconditional payload re-serialization and setContent on policy exit):
  var id = request.content.asJSON.user.id;

  // GOOD (read-only: parses once, zero re-serialization on exit):
  var rawBody = context.getVariable('request.content');
  var payload = rawBody ? JSON.parse(rawBody) : null;
  var id = payload && payload.user ? payload.user.id : null;
  ```

### Rule 4: Zero `<Properties>` on `<Javascript>` Policies — Use PropertySets Instead
- **Why**: Every `<Property>` configured in `<Javascript>` XML is eagerly materialized into Rhino wrapper maps on every request before line 1 of JS runs.
- **Pattern**: Store static properties in a `PropertySet` and read only the keys needed via `context.getVariable('propertyset.my_config.key')`.

### Rule 5: Avoid Heavy Loops, Mega-Functions & CPU-Intensive Processing in JS
- **Why**: Rhino injects periodic instruction-count observer callbacks to enforce `timeLimit`, and functions exceeding HotSpot's 8,000-byte bytecode limit (`HugeMethodLimit`) cannot be JIT-compiled by C2.
- **Pattern**: Decompose scripts into small focused helper functions inside the IIFE, avoid character-by-character loops in JS, and use `<JavaCallout>` or `MessageTemplate` functions for CPU-heavy work.

### Rule 6: Never Use `httpClient` + `exchange.waitForComplete()`
- **Why**: Blocking on `exchange.waitForComplete()` or `exchange.getResponse()` pins worker threads and contends on a bounded wait queue under load.
- **Pattern**: Use `<ServiceCallout>` (with `<Request clearPayload="true">`) for external HTTP calls.

---

## 5. High-Performance Java Callouts (`BaseCallout` Blueprint & Runtime Internals)

Custom Java callouts implement `com.apigee.flow.execution.spi.Execution` (see `callout/src/main/java/com/google/apigee/callouts/BaseCallout.java`).

### 5.1 Core Principles for Java Callouts
1. **Environment Sandbox Awareness**:
   - **Apigee X**: Custom `.policy` security files are not supported; avoid raw sockets, local filesystem I/O, `System.setProperty`, and restricted reflection. Use `<ServiceCallout>` or `<ExternalCallout>` for external network calls.
   - **Apigee Hybrid**: Supports custom `.policy` files when elevated permissions are explicitly required.
2. **Strict Thread Safety & Singleton Lifecycle**:
   - Apigee instantiates each `<JavaCallout>` `Execution` class **once per `<Step>` attachment at deployment time** via its `(Map<String, String> properties)` constructor and invokes `execute(MessageContext, ExecutionContext)` concurrently across worker threads.
   - **Rule**: Never store request-specific mutable state in instance fields. Unlike `<Javascript>`, `<JavaCallout>` `<Properties>` are passed once to the constructor with **zero per-request map allocation**.
3. **Pre-Compilation in Constructor / Static Initializers**:
   - Pre-compile `Pattern` instances, static Jackson `JsonFactory` / `ObjectMapper` / `ObjectReader` / `ObjectWriter` instances, `DateTimeFormatter` instances, and Base64-embedded PropertySet maps once at initialization—never instantiate heavy parsers or regexes per request.
4. **Minimizing `MessageContext` Bridge Overhead (`VarCache`)**:
   - Every `messageContext.getVariable(name)` crosses the Apigee security-manager bridge (and reading non-`String` values incurs an extra privileged `toString()` conversion).
   - **Rules**:
     1. Memoize per-request reads through a request-local `VarCache` so each flow variable is read from `MessageContext` **at most once** per callout execution.
     2. Prefer storing `String` values in `MessageContext` when downstream steps or templates will read them back as strings.
5. **Payload Streaming & Non-Blocking Execution**:
   - Stream large payloads when possible, and never perform blocking network I/O inside `execute()`.
   - **Classloader Boundary Warning**: Never reference `com.apigee.flow.message.TransportMessage` in a Java Callout (`com.apigee.nio.channels.InputChannel` is not exposed on the callout sandbox classpath and will throw `NoClassDefFoundError` at runtime). Always interact with messages via the public `com.apigee.flow.message.Message` SPI.
6. **`ExecutionResult.ABORT` vs. `continueOnError`**:
   - Returning `ExecutionResult.ABORT` without a `Throwable` cause aborts the flow directly regardless of `continueOnError="true"`. Inside `<FaultRules>` or `<DefaultFaultRule>`, catch all exceptions and return `ExecutionResult.SUCCESS` / `CONTINUE` with a safe fallback error body so Apigee never enters raw `FlowState.ABORT`.

---

## 6. Optimal Configuration of Out-of-the-Box Policies

### 6.1 Configuration & Caching Tier Hierarchy
1. **Tier 1 — `PropertySet` (Zero-Latency In-Memory Map)**:
   - Use `{propertyset.<set_name>.<key>}` for bundle/environment configuration—never add `<ReadPropertySet>` steps when direct variable references suffice.
2. **Tier 2 — `KeyValueMapOperations` (When Used in General Apigee Proxies)**:
   - Always set `<ExpiryTimeInSecs>` $\ge 300$ (never `0` or `-1`, which disables L1 caching and forces a remote lookup on every request), and consolidate `<Get>` entries per `<MapName>`. *(Note: In this AI Gateway repository, KVMs are intentionally never used—see `project-guardrails.md`.)*
3. **Tier 3 — `LookupCache` / `PopulateCache` / `ResponseCache`**:
   - Keep cached entries well below **256 KB** (entries exceeding 256 KB are silently skipped by L2 distributed cache).

### 6.2 Security & Rate-Limiting Policies
- **`VerifyJWT`**: Automatically caches remote `<JWKS uri="..."/>` keysets and parsed keys in memory—never build manual `<ServiceCallout>` + `<LookupCache>` JWKS fetchers, and never chain `<DecodeJWT>` before `<VerifyJWT>` unless selecting an issuer dynamically.
- **`VerifyAPIKey` & `OAuthV2`**: Backed by an in-memory L1 entity cache and automatically populate custom attributes—never add `<AccessEntity>` afterwards.
- **`SpikeArrest`**: `<UseEffectiveCount>false</UseEffectiveCount>` runs lock-free on the NIO thread with zero network I/O; enable `<UseEffectiveCount>true</UseEffectiveCount>` only when cross-pod distributed burst synchronization is required.
- **`Quota` / `LLMTokenQuota`**: Configure `<Distributed>true</Distributed>`; choose `<Synchronous>true</Synchronous>` when strict cross-pod budget accuracy is required (such as shared USD wallets) or `<Synchronous>false</Synchronous>` when prioritizing lowest latency via async batch flushing.

### 6.3 `ServiceCallout`, `ExternalCallout` & `<PostClientFlow>`
- **`ServiceCallout`**: Always set `<Request clearPayload="true">` unless explicitly forwarding the client's request body (omitting `clearPayload="true"` forces Apigee to buffer the request stream). Omit `<Response>` for fire-and-forget async callouts.
- **`ExternalCallout` (gRPC)**: Keep `with.request.content` and `with.response.content` `false` unless required, and restrict `<FlowVariable>` prefixes.
- **`<PostClientFlow>`**: Execute logging/telemetry (`<MessageLogging>`, `<PublishMessage>`, `<StatisticsCollector>`) in `<PostClientFlow>` after the client response has been written, and avoid buffering full streaming payloads for logging.

---

## 7. Error Handling, Fault Rules & Target Transport Tuning

### 7.1 `ProxyEndpoint` (Bottom-Up!) vs. `TargetEndpoint` (Top-Down!) `<FaultRules>` Order
Both endpoints execute **only the first matching `<FaultRule>`**, in opposite XML order:
- **In `ProxyEndpoint`**: `<FaultRules>` are evaluated **BOTTOM-UP (from the last `<FaultRule>` in the XML to the first)**—place your most specific `<FaultRule>` conditions at the **bottom**.
- **In `TargetEndpoint`**: `<FaultRules>` are evaluated **TOP-DOWN (from the first `<FaultRule>` in the XML to the last)**—place your most specific `<FaultRule>` conditions at the **top**.

### 7.2 Never Use `<RaiseFault>` Inside `<FaultRules>` or `<DefaultFaultRule>` — Always Use `<AssignMessage>`
1. Executing `<RaiseFault>` in normal flows already incurs fault normalization before applying `<FaultResponse>`.
2. Executing `<RaiseFault>` when already inside `<FaultRules>` throws a **second** fault (`faults.size() == 2`), transitioning the flow to **`FlowState.ABORT`**, which **aborts remaining steps in the `<FaultRule>`** and **skips `<DefaultFaultRule>` even when `<AlwaysEnforce>true</AlwaysEnforce>` is set**!
- **Rule**: Use `<RaiseFault>` only in normal Request/Response flows; inside `<FaultRules>` and `<DefaultFaultRule>`, **always use `<AssignMessage>`**.

### 7.3 Checking Failures After `continueOnError="true"`
- When `continueOnError="true"` is set on a policy, global `fault.name` is **not** populated on failure. Always check `<stepPrefix>.<PolicyName>.failed = true` (e.g., `servicecallout.SC-Enrich.failed = true`).

### 7.4 Target Transport & Connection Pooling
- Configure `<Property name="success.codes">` on `<HTTPTargetConnection>` when backend 4xx responses should traverse normal response flows rather than triggering target error unwinding (which also closes pooled sockets when streaming is active).
- Never set `keepalive.timeout.millis <= 0` (which disables keep-alive reuse and forces TCP+TLS handshakes per request). Set explicit `connect.timeout.millis` and `io.timeout.millis` (tunable per request via `target.connect.timeout.millis` and `target.io.timeout.millis`).
- On Apigee Hybrid Kubernetes deployments, size container memory limits to at least `1.25x–1.35x` JVM `-Xmx` (or `-Xmx + 2.5–3.5 GB`) to cover off-heap NIO buffers, Metaspace, CodeCache, and thread stacks without OOMKills.
