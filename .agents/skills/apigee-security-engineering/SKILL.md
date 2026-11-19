---
name: apigee-security-engineering
description: Generates highly secure, zero-trust Apigee API Proxies, SharedFlows, JavaScript callouts, and Java callouts (BaseCallout). Enforces security rules and parser-differential defenses covering silent Content-Type bypass prevention, JSON duplicate-key differentials (first-key-wins vs last-key-wins), HTTP Parameter Pollution, JWT/OAuth2/HMAC/mTLS hardening, MessageTemplate & UrlMessageTemplate injection/SSRF prevention (all 38 built-in functions), FaultRules & DefaultFaultRule zero-leak error handling, Rhino JS sandbox isolation, and thread-safe JCA/Jackson Java callout patterns.
---

# AI Assistant Skill: High-Security Apigee Proxy, SharedFlow, JavaScript & Java Callout Engineering

Use this skill whenever designing, generating, auditing, or refactoring Apigee API Proxies, SharedFlows, security policies, Message Templates, JSONPath/XPath extractions, FaultRules, JavaScript callouts, or Java callouts (`BaseCallout`) to achieve defense-in-depth and eliminate subtle runtime bypasses.

---

## 1. Core Runtime Security Realities & Parser Differentials

Account for five non-obvious runtime behaviors of the Apigee Message Processor before configuring policies or writing callout code:

### 1.1 The Silent `Content-Type` Bypass Across 4 Core Security Policies
- **Runtime Mechanics**:
  - `JSONThreatProtection`, `XMLThreatProtection`, `RegularExpressionProtection` (`<JSONPayload>` / `<XMLPayload>`), and `MessageValidation` gate payload inspection on the message's `Content-Type` media type.
  - If a request omits `Content-Type` or sends `Content-Type: text/plain`, `application/octet-stream`, or `application/x-www-form-urlencoded`, all four policies **immediately succeed without inspecting a single byte of the body**! If the upstream backend auto-detects JSON or defaults to JSON parsing, an attacker bypasses gateway threat protection completely.
- **Mandatory Rule**: Whenever a request carries a body (`request.verb = "POST" or request.verb = "PUT" or request.verb = "PATCH" or request.header.Content-Length > 0 or request.header.Transfer-Encoding != null`), **always enforce an explicit `Content-Type` allowlist** (`415 Unsupported Media Type`) *before* running `JSONThreatProtection`, `XMLThreatProtection`, `RegularExpressionProtection`, or `MessageValidation`.

### 1.2 The JSON Duplicate-Key Parser Differential (First-Key-Wins vs. Last-Key-Wins)
- **Runtime Mechanics**:
  1. **`JSONThreatProtection` Allows Duplicate Keys**: Enforces depth, key length, array size, and string length bounds, but does not track key uniqueness within an object.
  2. **`ExtractVariables` and `RegularExpressionProtection` Use FIRST-KEY-WINS**: Both parse JSON into an intermediate map that retains the **first** occurrence of a duplicate key and drops subsequent duplicates before evaluating JsonPath.
  3. **`AssignMessage` `{jsonPath(...)}`, `OASValidation`, Rhino `JSON.parse()`, and Backends Use LAST-KEY-WINS**: Standard downstream JSON parsers (Jackson, Gson, V8/Node `JSON.parse`, Go, Python `json.loads`) overwrite earlier keys so the **last** key wins.
- **Exploit Scenario**: An attacker sends `{"model": "safe-model", "model": "restricted-model"}` or `{"role": "user", "role": "admin"}`. A first-key-wins check authorizes `"safe-model"` / `"user"`, while a last-key-wins backend executes `"restricted-model"` / `"admin"`.
- **Mandatory Rule**: Never authorize a security-sensitive JSON field via `ExtractVariables` / `RegularExpressionProtection` and forward the raw `request.content` untouched. Either:
  1. **Reject duplicate JSON keys** at the gateway entry using a `<JavaCallout>` configured with Jackson `StreamReadFeature.STRICT_DUPLICATE_DETECTION` / `DeserializationFeature.FAIL_ON_READING_DUP_TREE_KEY`, **or**
  2. **Reconstruct a clean outbound JSON payload** from the exact validated variables using `{escapeJSON(var)}`.

### 1.3 HTTP Parameter & Header Pollution Differentials (`1st Value` vs. `.values` Iteration)
- **Runtime Mechanics**:
  - Reading `request.queryparam.<name>`, `request.formparam.<name>`, or `request.header.<name>` in a `<Condition>` or `MessageTemplate` returns **only the 1st value**.
  - Conversely, `<ExtractVariables>` iterates across **all** `.values` until the first pattern match, and upstream HTTP servers may concatenate or honor the **last** parameter value (e.g., `?alt=json&alt=sse` or `?fields=candidates&fields=usageMetadata`).
- **Mandatory Rule**: Reject multi-value pollution on security-sensitive query parameters or headers (`request.queryparam.<name>.values.count > 1` or `request.header.<name>.values.count > 1`) or inspect the raw `request.querystring`.

### 1.4 Unresolved Variable Persistence & Pre-Verification JWT Claim Population
- **Runtime Mechanics**:
  1. **`ExtractVariables` Does Not Clear Target Variables on Miss**: When a pattern does not match (or `<IgnoreUnresolvedVariables>true</IgnoreUnresolvedVariables>` resolves a path to `null`), any prior value in that target flow variable remains intact.
  2. **`VerifyJWT` Populates Decoded Claims Before Signature Verification Completes**: If `<VerifyJWT>` is misconfigured with `continueOnError="true"`, a forged JWT fails signature verification, suppresses the fault, and leaves **unverified attacker claims** (`jwt.<policy>.claim.*`) populated in `MessageContext`!
- **Mandatory Rule**:
  - Never set `continueOnError="true"` on security-enforcement policies (`VerifyJWT`, `VerifyJWS`, `OAuthV2`, `VerifyAPIKey`, `HMAC`, `OASValidation`, `JSONThreatProtection`, `XMLThreatProtection`, `RegularExpressionProtection`, `SanitizeUserPrompt`, `SanitizeModelResponse`, `LLMTokenQuota` enforce steps).
  - Gate downstream trust on `<VerifyJWT>` having succeeded (`jwt.<policy>.valid = true`) and `continueOnError="false"`.

### 1.5 Secret Isolation (`private.*`) & Debug/Trace Auto-Masking
- **Runtime Mechanics**:
  - Flow variables prefixed with `private.` are automatically masked as `**********` in Apigee Debug/Trace sessions.
  - Copying a `private.*` value into a non-`private.*` variable immediately exposes the plaintext secret in Debug/Trace and potential analytics capture.
- **Mandatory Rule**: Every API key, upstream bearer token, HMAC key, decrypted payload, or internal exception stacktrace must live exclusively in `private.*` flow variables for its entire lifecycle.

---

## 2. Security Decision Matrix: Out-of-the-Box Capabilities vs. Custom Code

| Security Requirement | Optimal Secure Out-of-the-Box Solution | Anti-Pattern to Avoid | Security Rationale |
| :--- | :--- | :--- | :--- |
| **Verify JWT tokens (RS256/PS256/ES256) & read claims** | `<VerifyJWT>` with hardcoded asymmetric `<Algorithm>`, static/trusted `<JWKS uri="..."/>`, `<IgnoreUnresolvedVariables>false</IgnoreUnresolvedVariables>`, and direct `jwt.<Policy>.claim.<name>` references | `<DecodeJWT>` for auth decisions; `<Algorithm ref="..."/>` from token header; `<JWKS uriRef="..."/>` from token `jku`/`iss` claim | `<DecodeJWT>` performs **zero** signature or expiry verification; binding `<JWKS uriRef>` to untrusted claims enables SSRF and arbitrary key injection. |
| **Construct JSON or XML payloads with user input** | `<AssignMessage>` `<Payload>` with `{escapeJSON(var)}` or `{escapeXML11(var)}` (or Jackson serialization in `<JavaCallout>`) | Raw `{var}` interpolation inside `<Payload>` or string concatenation in `<Javascript>` | `<Payload>` templates perform raw string substitution unless wrapped in `{escapeJSON()}` / `{escapeXML11()}`. |
| **Compute HMAC signatures or SHA-256 digests** | `<HMAC>` policy or `MessageTemplate` `{hmacSha256(private.key, msg)}` / `{sha256Hex(str)}` | `<Javascript>` custom hashing | `<HMAC>` enforces `private.*` secret keys at deployment validation time and runs native JCA `Mac`. |
| **Authenticate Apigee to GCP backend services (Cloud Run, Vertex AI, BigQuery)** | TargetEndpoint / ServiceCallout `<Authentication><GoogleIDToken>` or `<GoogleAccessToken>` | Manual OAuth2 JWT assertion flows or storing Service Account JSON keys | Mints, caches, and rotates short-lived Workload Identity tokens in memory with zero static keys, and must **only** be attached on Google-owned / verified IAM targets. |
| **Validate OpenAPI 3.0 request schemas** | `<OASValidation>` with `<AllowUnspecifiedParameters>` explicitly set to `false` for `<Query>` and `<Cookie>` | `<OASValidation>` with default options | By default, `<AllowUnspecifiedParameters>` permits undeclared headers, query parameters, and cookies unless explicitly disabled. |
| **Enforce client IP allowlists/denylists** | `<AccessControl>` with `<IgnoreTrueClientIPHeader>true</IgnoreTrueClientIPHeader>` and `<ValidateBasedOn>X_FORWARDED_FOR_LAST_IP</ValidateBasedOn>` | `<AccessControl>` with default `IgnoreTrueClientIPHeader=false` or `X_FORWARDED_FOR_ALL_IP` | Default `IgnoreTrueClientIPHeader=false` trusts client-spoofable `True-Client-IP` headers unless stripped by an upstream edge proxy. |
| **Enforce CORS policy on browser APIs** | Explicit origin allowlist (`<AllowOrigins>https://app.example.com</AllowOrigins>`) when `<AllowCredentials>true</AllowCredentials>` | `<AllowOrigins>*</AllowOrigins>` combined with `<AllowCredentials>true</AllowCredentials>` | Combining `*` with `AllowCredentials=true` reflects arbitrary caller `Origin` headers with `Access-Control-Allow-Credentials: true`. *(Note: Never add `<CORS>` to this AI Gateway repo per `project-guardrails.md`.)* |
| **Protect GenAI / LLM endpoints against Prompt Injection & PII leakage** | `<SanitizeUserPrompt>`, `<SanitizeModelResponse>`, `<PromptTokenLimit>`, and `<LLMTokenQuota>` | Regex-only prompt filtering or unbounded LLM token/cost consumption | Integrates natively with Google Cloud Model Armor and enforces token/micro-USD budgets per verified identity. |
| **Sanitize error responses in `<FaultRules>` and `<DefaultFaultRule>`** | `<AssignMessage>` inside `<FaultRules>` and `<DefaultFaultRule>` with `<AlwaysEnforce>true</AlwaysEnforce>` | `<RaiseFault>` inside `<FaultRules>` or leaving faults unhandled | Unhandled faults leak policy/variable names or raw backend error bodies; `<RaiseFault>` inside `<FaultRules>` triggers `FlowState.ABORT`, skipping `<DefaultFaultRule>`. |

---

## 3. Authentication, Authorization, Crypto & Transport Hardening

### 3.1 JWT Hardening (`VerifyJWT`)
1. **Never Use `<DecodeJWT>` for Auth Decisions**: `<VerifyJWT>` already populates `jwt.<PolicyName>.header.*` and `jwt.<PolicyName>.claim.*`.
2. **Hardcode Asymmetric Algorithms & Trusted JWKS URIs**:
   - Hardcode `<Algorithm>RS256,PS256,ES256</Algorithm>` (never bind `<Algorithm ref="..."/>` to untrusted headers, preventing `none` / `HS256` algorithm-confusion attacks).
   - Bind `<JWKS>` only to a static HTTPS URI or trusted `{propertyset.*}` key—never to unvalidated `jku`/`iss` claims.
3. **Set `wantFaultIfUnresolved="true"` on Dynamic `<AdditionalClaims>`**:
   - On `<Claim name="tenant" ref="expected_tenant"/>`, `wantFaultIfUnresolved` defaults to `false` even when `<IgnoreUnresolvedVariables>false</IgnoreUnresolvedVariables>` is set at the policy level! Always set `wantFaultIfUnresolved="true"` when `ref="..."` is used:
     ```xml
     <VerifyJWT async="false" continueOnError="false" enabled="true" name="VJ-VerifyAccessToken">
         <Algorithm>RS256,PS256,ES256</Algorithm>
         <Source>private.auth_jwt_token</Source>
         <IgnoreCriticalHeaders>false</IgnoreCriticalHeaders>
         <IgnoreIssuedAt>false</IgnoreIssuedAt>
         <IgnoreUnresolvedVariables>false</IgnoreUnresolvedVariables>
         <TimeAllowance>30s</TimeAllowance>
         <PublicKey>
             <JWKS uri="https://www.googleapis.com/oauth2/v3/certs"/>
         </PublicKey>
         <Issuer ref="propertyset.security.expected_issuer"/>
         <Audience ref="propertyset.security.expected_audience"/>
         <AdditionalClaims>
             <Claim name="hd" ref="propertyset.security.allowed_domain" type="string" wantFaultIfUnresolved="true"/>
         </AdditionalClaims>
     </VerifyJWT>
     ```

### 3.2 OAuthV2 & API Key Hardening (`OAuthV2`, `VerifyAPIKey`)
1. **The `<Scope>` OR-Logic Trap**: `<Scope>read write</Scope>` in `<OAuthV2>` evaluates with **OR** semantics. Enforce simultaneous multi-scope (**AND**) requirements via an explicit `<Condition>` after verification.
2. **PKCE (`S256`) & Refresh Token Rotation**: Require `code_challenge_method = "S256"` on authorization codes and `<ReuseRefreshToken>false</ReuseRefreshToken>` on refresh operations.
3. **Strip Client Credentials Before Forwarding Upstream**: Never accept API keys only via query parameters (strip `apikey` / `key` query params so they never leak upstream), and strip inbound `Authorization` / `x-api-key` headers before forwarding to external targets unless explicitly replaced by the target's configured upstream credential.

### 3.3 `<HMAC>`, `<ValidateSAMLAssertion>` & Outbound `<SSLInfo>`
1. **`<HMAC>`**: Always reference `<SecretKey ref="private.*"/>`, use `SHA-256`+, and never bind `<Output length="..."/>` to untrusted input (truncation attack). For constant-time byte verification in Java callouts, use `MessageDigest.isEqual(expectedBytes, actualBytes)`.
2. **`<ValidateSAMLAssertion>`**: Use strict absolute XPath expressions (never relative `//saml:Assertion`, which permits XML Signature Wrapping) and set `<RemoveAssertion>true</RemoveAssertion>`.
3. **Outbound TLS (`<SSLInfo>`)**: Always enforce `<SSLInfo><Enabled>true</Enabled><Enforce>true</Enforce><IgnoreValidationErrors>false</IgnoreValidationErrors></SSLInfo>` on **every** `<TargetEndpoint>` and `<ServiceCallout>` `<HTTPTargetConnection>` so outbound connections never fall back to permissive certificate validation.

---

## 4. Threat Protection, Schema Validation, Rate Limiting & GenAI Security

1. **Content-Type + Structural Bounds**: Enforce `Content-Type` (`application/json`) and size bounds before `JSONThreatProtection` / `OASValidation`.
2. **`RegularExpressionProtection` Slash-Escaping & Case-Sensitivity**:
   - Set `<JSONPayload escapeSlashCharacter="true">` (when `false`, JSON serialization escapes `/` as `\/`, causing regexes like `<script>` to miss `</script>` written as `<\/script>`!).
   - `<QueryParam name="x">` is case-sensitive (`?X=` bypasses it)—prefer checking `request.querystring` case-insensitively (`(?i)`), and avoid catastrophic backtracking quantifiers (`(a+)+`).
3. **`OASValidation`**: Explicitly set `<AllowUnspecifiedParameters><Header>true</Header><Query>false</Query><Cookie>false</Cookie></AllowUnspecifiedParameters>` so undeclared query parameters cannot smuggle upstream directives (such as `?fields=` or unvalidated `?alt=`).
4. **Rate Limiting & Cache Isolation**:
   - Bind `<SpikeArrest>` and `<Quota>` / `<LLMTokenQuota>` `<Identifier>` exclusively to **verified** server-side identity variables (`client_id`, `rate_limit_client_id`, `secondary_quota_identifier`)—never unverified client headers.
   - Always include verified tenant/user identity in any `<ResponseCache>` `<CacheKey>` and set `<ExcludeErrorResponse>true</ExcludeErrorResponse>`.
5. **GenAI / LLM Guardrails**:
   - Execute RBAC, burst limits, quota pre-checks, and `<SanitizeUserPrompt>` **strictly before** invoking any secondary LLM classifier (e.g., `SC-LLMJudge`) or primary upstream model, and isolate untrusted user prompts inside structured `systemInstruction` + `responseSchema` envelopes.

---

## 5. Message Templates, `UrlMessageTemplate` SSRF Prevention & Header Sanitization

### 5.1 Security Classification of All 38 `MessageTemplate` Built-In Functions

| Category | Built-In Functions | Security Guidance & Rules |
| :--- | :--- | :--- |
| **Context-Aware Output Escaping (MANDATORY for untrusted input)** | `escapeJSON(str)`<br>`escapeXML(str)`<br>`escapeXML11(str)`<br>`encodeHTML(str)` | **Always wrap untrusted variables** in `{escapeJSON(var)}` inside JSON `<Payload>` templates, `{escapeXML11(var)}` inside XML payloads, and `{encodeHTML(var)}` inside HTML responses. |
| **Strong Cryptographic Hashing & HMAC** | `sha256Hex(str)`, `sha256Base64(str)`<br>`sha384Hex(str)`, `sha384Base64(str)`<br>`sha512Hex(str)`, `sha512Base64(str)`<br>`hmacSha256(key, msg)`, `hmacSha384(key, msg)`, `hmacSha512(key, msg)` | Safe for digests, cache keys, and outbound signatures. Always pass a `private.*` variable as `key`. |
| **Weak / Legacy Hashing & HMAC (Avoid for security)** | `md5Hex`, `md5Base64`, `sha1Hex`, `sha1Base64`, `hmacMd5`, `hmacSha1` | Cryptographically weak (`MD5`, `SHA-1`); use only for non-security legacy checksums. |
| **Base64 & Regex Generation** | `encodeBase64(str)`, `decodeBase64(str)`<br>`xeger(regex)` | Never pass untrusted regexes to `xeger()`. Note: `MessageTemplate` has **no** `encodeURIComponent()` function! |
| **JSONPath & XPath Extraction** | `jsonPath(expr, var, [wantArray])`<br>`xpath(expr, var, [ns...])` | Both arguments in `{jsonPath(expr, var)}` are evaluated as sub-templates—**never** pass an untrusted variable as the 1st argument (`expr`), and remember `jsonPath()` uses **last-key-wins**. |
| **Null-Coalescing, String, UUID & Time** | `firstnonnull(...)`, `replaceAll(str, regex, repl)`, `replaceFirst(...)`, `substring(...)`, `toLowerCase(...)`, `toUpperCase(...)`, `createUuid()`, `randomLong(...)`, `timeFormat*` | **Warning**: `randomLong()` is non-cryptographic (`java.util.Random`)—use `{createUuid()}` (`SecureRandom` UUIDv4) or `java.security.SecureRandom` in a `<JavaCallout>` for security nonces. Keep regexes in `replaceAll` static literals. |

### 5.2 Preventing SSRF, Path Traversal & Query Smuggling in `<URL>` (`UrlMessageTemplate`)
- **Runtime Traps**:
  1. `<URL>` templates do **not** support template functions (`{escapeJSON(...)}` is not evaluated in `<URL>`) and perform raw string interpolation without URL encoding.
  2. Interpolating untrusted input into the host/authority (`https://{host}/...`) or unvalidated path segments (`https://api.internal/v1/models/{model}`) enables authority override, encoded path traversal (`..`, `%2e%2e`, `%2f`, `%5c`), and query/fragment smuggling (`?`, `#`, `;`).
  3. `<ExtractVariables>` URL-decodes `<URIPath>` captures *after* pattern matching, so `..%2fadmin` matches `{id}` and decodes to `../admin`!
- **Mandatory Outbound URL Rules**:
  1. Set `target.copy.pathsuffix = false` (via `<AssignMessage>` `AM-DisablePathSuffixCopy`) when constructing explicit backend target URLs, and reject `..`, `%2e`, `%2f`, `%5c`, `;`, `\r`, `\n`, and null bytes on inbound paths.
  2. Validate every dynamic path/region/project/model identifier against a strict character allowlist *after* extraction before interpolating into `<URL>` or `target.url`, and block RFC1918/loopback/link-local/metadata IP literals (`169.254.169.254`, `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `::1`, `fc00::/7`, `fe80::/10`, `metadata.google.internal`, `.internal`, `.local`, `localhost`) on custom URLs.

### 5.3 The Empty `<Remove><Headers/></Remove>` Trap & Header Sanitization
- **Critical Trap**: Writing `<Remove><Headers/></Remove>`, `<Remove><QueryParams/></Remove>`, or `<Remove><FormParams/></Remove>` **without child elements** deletes **ALL headers**, **ALL query parameters**, or the **entire payload**! Always list explicit `<Header name="..."/>` children.
- Strip spoofable client headers (`X-Goog-FieldMask`, `X-Goog-User-Project`, `X-Upstream-Provider`, internal `X-Gateway-*` headers) on ingress, and strip RFC 9113 control characters (`\r`, `\n`, `\0`, `0x00–0x1F`, `0x7F`) from any dynamic response header value.

---

## 6. Zero-Leak Error Handling & `<DefaultFaultRule>` Architecture

1. **Why Unhandled Faults Leak Internals**: Unhandled target `4xx`/`5xx` faults forward raw upstream error bodies and headers directly to the caller, while unhandled policy exceptions serialize internal policy names, flow variable names, and backend host errors into `faultstring`.
2. **Never Use `<RaiseFault>` Inside `<FaultRules>` or `<DefaultFaultRule>`**: Throwing a second fault inside `<FaultRules>` transitions the flow to `FlowState.ABORT`, **skipping `<DefaultFaultRule>` even when `<AlwaysEnforce>true</AlwaysEnforce>` is set**! Always use `<AssignMessage>` (and catch all exceptions inside any error-formatting `<JavaCallout>`, returning `ExecutionResult.SUCCESS`/`CONTINUE` with a static fallback JSON payload).
3. **Attach `<DefaultFaultRule>` (`<AlwaysEnforce>true</AlwaysEnforce>`) on All `ProxyEndpoint`s and `TargetEndpoint`s**:
   - Guard generic sanitization with `sanitized_error_applied != "true"` so intentional protocol-formatted `400`/`401`/`403`/`404`/`405`/`415`/`429` errors and `200` fallback recoveries are preserved, while unexpected runtime faults receive a zero-leak JSON response plus OWASP headers (`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Cache-Control: no-store`).
   - Remember `<FaultRules>` evaluate **bottom-up** in `ProxyEndpoint` and **top-down** in `TargetEndpoint`.

---

## 7. Secure Rhino JavaScript Callouts (`<Javascript>`)

1. **Mandatory `'use strict'` IIFE**: Wrap every `.js` file in `(function () { 'use strict'; ... })();` and declare all variables with `var` so nothing leaks onto the shared Rhino scope across concurrent requests.
2. **Bound Input Sizes, Avoid `.asJSON`/`.asXML` & Block Prototype Pollution**:
   - Never use `request.content.asJSON` or `.asXML`. Enforce explicit character/buffer caps (e.g., `64 KiB` max SSE partial-frame carry buffer) before `JSON.parse()`.
   - Never check untrusted keys via `if (map[untrustedKey])` (which resolves `"__proto__"`, `"constructor"`, `"toString"`, `"valueOf"` to truthy functions!). Always use `Object.prototype.hasOwnProperty.call(map, untrustedKey)` and explicitly reject `"__proto__"`, `"constructor"`, and `"prototype"`.
3. **Keep `timeLimit="200"` Tight**: Never set multi-second `<Javascript timeLimit>` values that allow CPU-bound inputs to starve worker threads.

---

## 8. Secure Java Callouts (`<JavaCallout>` & `BaseCallout`)

1. **Stateless Singletons & JCA Thread Safety**:
   - Each `<JavaCallout>` `<Step>` instantiates a **single shared instance** across all threads.
   - `Cipher`, `Mac`, `MessageDigest`, `Signature`, `DocumentBuilder`, and `Validator` are **not thread-safe**—never store them in instance fields! Share only immutable/thread-safe objects (`SecureRandom`, `SecretKeySpec`, `Pattern`, `DateTimeFormatter`, `JsonFactory`, immutable `ObjectMapper`).
2. **Constant-Time Secret Comparison & `private.*` Exception Masking**:
   - Compare secrets/HMACs with `MessageDigest.isEqual(a, b)`.
   - Store internal exception messages/stacktraces strictly in `private.*` variables (never echo `e.getMessage()` or stacktraces to client payloads), and never mutate `MessageContext` from background threads.
3. **Strict Jackson Parsing (`StrictJson`)**:
   - Enforce `StreamReadFeature.STRICT_DUPLICATE_DETECTION` (rejecting duplicate JSON keys across the entire payload tree), bounded nesting depth, bounded string/number lengths, and exact `BigDecimal` / `BigInteger` numeric fidelity (`USE_BIG_DECIMAL_FOR_FLOATS`), and never enable polymorphic default typing.
   - If XML is ever parsed in Java, enable `XMLConstants.FEATURE_SECURE_PROCESSING` and disallow `DOCTYPE` declarations (`disallow-doctype-decl`) to block XXE.
