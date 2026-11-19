/*
 * Copyright 2027 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const {
    JSC_DIR,
    TMPL_JSC_DIR,
    CALLOUT_SRC_DIR,
    BUNDLE_DIR,
    TMPL_DIR,
    runScript,
    suite,
    test,
    assert,
    assertEqual
} = require('./helpers/harness');

suite('apigee-performance-engineering Skill Validation Suite', () => {
    const jsFiles = fs.readdirSync(JSC_DIR).filter(f => f.endsWith('.js')).sort();
    const tmplJsFiles = fs.readdirSync(TMPL_JSC_DIR).filter(f => f.endsWith('.js')).sort();
    const javaJarPath = path.join(BUNDLE_DIR, 'resources/java/ai-gateway-callouts.jar');
    const tmplJavaJarPath = path.join(TMPL_DIR, 'resources/java/ai-gateway-callouts.jar');
    const calloutSrcDir = CALLOUT_SRC_DIR;

    test('PERF-SKILL-01: Hybrid Java Callout + EventFlow Rhino JS architecture parity & thread-safety invariants', () => {
        // 1. Verify ai-gateway-callouts.jar exists in both apiproxy and templates/ai-gateway and matches byte-for-byte
        assert(fs.existsSync(javaJarPath), 'Expected apiproxy/resources/java/ai-gateway-callouts.jar to exist');
        assert(fs.existsSync(tmplJavaJarPath), 'Expected templates/ai-gateway/resources/java/ai-gateway-callouts.jar to exist');
        const proxyJar = fs.readFileSync(javaJarPath);
        const tmplJar = fs.readFileSync(tmplJavaJarPath);
        assert(proxyJar.equals(tmplJar), 'ai-gateway-callouts.jar byte-for-byte parity mismatch between apiproxy and templates/ai-gateway');

        // 2. Verify all 4 consolidated Java Callout classes are declared public final class X extends BaseCallout
        const expectedCalloutClasses = [
            'AuthAndPersonaCallout.java',
            'RequestRouterAndTranscoderCallout.java',
            'ResponseTranscoderAndCostCallout.java',
            'FallbackAndErrorCallout.java'
        ];
        for (const clsFile of expectedCalloutClasses) {
            const javaSrc = fs.readFileSync(path.join(calloutSrcDir, clsFile), 'utf8');
            const clsName = clsFile.replace('.java', '');
            assert(
                new RegExp(`public\\s+final\\s+class\\s+${clsName}\\s+extends\\s+BaseCallout`).test(javaSrc),
                `${clsFile} must be declared public final class ${clsName} extends BaseCallout`
            );
        }

        // 3. Verify only combine_resp.js remains in resources/jsc (for <EventFlow> SSE) wrapped in IIFE with 'use strict'
        assertEqual(JSON.stringify(jsFiles), JSON.stringify(['combine_resp.js']), 'Only combine_resp.js should remain in apiproxy/resources/jsc');
        assertEqual(JSON.stringify(jsFiles), JSON.stringify(tmplJsFiles), 'JS file list mismatch between apiproxy and templates/ai-gateway');

        for (const file of jsFiles) {
            const proxySrc = fs.readFileSync(path.join(JSC_DIR, file), 'utf8');
            const tmplSrc = fs.readFileSync(path.join(TMPL_JSC_DIR, file), 'utf8');
            const trimmed = proxySrc
                .replace(/^(\s*(\/\*[\s\S]*?\*\/|\/\/[^\n]*))*\s*/, '')
                .trim();

            assert(
                trimmed.startsWith('(function') && trimmed.endsWith('})();'),
                `${file} must be wrapped in an IIFE (function() { ... })(); to prevent Rhino TopLevelScope slot leaks`
            );
            assert(
                proxySrc.includes("'use strict'") || proxySrc.includes('"use strict"'),
                `${file} must enable 'use strict' inside its IIFE`
            );
            assertEqual(proxySrc, tmplSrc, `File parity mismatch for ${file}`);

            // Guard against Apigee Rhino Codegen 32KB signed jump-offset compilation failure ("Program too complex: too big jump offset"):
            // Ensure no individual named function body exceeds 300 lines and top-level IIFE control flow stays compact.
            const fnMatches = proxySrc.split(/\nfunction\s+[a-zA-Z0-9_]+\s*\(/);
            assert(fnMatches.length >= 8, `${file} must decompose SSE branches into modular helper functions for Rhino Codegen & HotSpot C2 JIT`);
            for (let idx = 0; idx < fnMatches.length; idx++) {
                const segLines = fnMatches[idx].split('\n').length;
                assert(
                    segLines <= 320,
                    `${file} segment #${idx} has ${segLines} lines (>320), risking Rhino Codegen 'Program too complex: too big jump offset'`
                );
            }
        }
    });

    test('PERF-SKILL-02: Zero .content.asJSON / .asXML in JS and VarCache single-read memoization in all Java Callout classes', () => {
        for (const file of jsFiles) {
            const src = fs.readFileSync(path.join(JSC_DIR, file), 'utf8');
            assert(!src.includes('.asJSON'), `${file} must not use .asJSON (triggers unconditional unwrapObject + JSONSerializer on exit)`);
            assert(!src.includes('.asXML'), `${file} must not use .asXML (E4X)`);
        }

        const expectedCalloutClasses = [
            'AuthAndPersonaCallout.java',
            'RequestRouterAndTranscoderCallout.java',
            'ResponseTranscoderAndCostCallout.java',
            'FallbackAndErrorCallout.java'
        ];
        for (const clsFile of expectedCalloutClasses) {
            const javaSrc = fs.readFileSync(path.join(calloutSrcDir, clsFile), 'utf8');
            assert(
                javaSrc.includes('new VarCache(msgCtxt)'),
                `${clsFile} must instantiate stack-local VarCache(msgCtxt) per execute() invocation`
            );
            assert(
                !javaSrc.includes('msgCtxt.getVariable('),
                `${clsFile} must read flow variables exclusively through VarCache.get() to guarantee at-most-once MessageContext reads`
            );
        }
    });

    test('PERF-SKILL-03: 22 non-EventFlow policies use <JavaCallout>, EventFlow uses <Javascript> with zero <Properties>, and zero <ReadPropertySet>', () => {
        const policyDir = path.join(BUNDLE_DIR, 'policies');
        const tmplPolicyDir = path.join(TMPL_DIR, 'policies');

        let javaCalloutCount = 0;
        let jsCalloutCount = 0;

        for (const f of fs.readdirSync(policyDir).filter(x => x.endsWith('.xml'))) {
            const xml = fs.readFileSync(path.join(policyDir, f), 'utf8');
            if (f === 'JS-combine-resp.xml') {
                jsCalloutCount++;
                assert(xml.includes('<Javascript '), `${f} must remain a <Javascript> policy for <EventFlow> SSE`);
                assert(
                    !/<Properties>\s*<Property\b/.test(xml),
                    `${f} must not define <Property> on <Javascript> (eagerly allocates ScriptableMapEntry + MemberBox per request)`
                );
            } else if (f.startsWith('JS-')) {
                javaCalloutCount++;
                assert(xml.includes('<JavaCallout '), `${f} must be migrated to <JavaCallout>`);
                assert(xml.includes('<ResourceURL>java://ai-gateway-callouts.jar</ResourceURL>'), `${f} must reference java://ai-gateway-callouts.jar`);
                assert(/<Property name="action">[a-z0-9_]+<\/Property>/.test(xml), `${f} must declare <Property name="action">`);
            }
            assert(!xml.includes('<ReadPropertySet'), `${f} must not use <ReadPropertySet> step when direct {propertyset.*} lookup is O(1)`);
        }

        assertEqual(javaCalloutCount, 22, 'Expected 22 <JavaCallout> policies in apiproxy/policies');
        assertEqual(jsCalloutCount, 1, 'Expected 1 <Javascript> policy (JS-combine-resp.xml) in apiproxy/policies');

        const combineYaml = fs.readFileSync(path.join(tmplPolicyDir, 'JS-combine-resp.yaml'), 'utf8');
        assert(!/\bProperty\s*:/.test(combineYaml), 'Template JS-combine-resp.yaml must not define Property entries on Javascript policy');
    });

    test('PERF-SKILL-04: Zero blocking httpClient / HttpURLConnection / Socket I/O in any JS or Java callout', () => {
        for (const file of jsFiles) {
            const src = fs.readFileSync(path.join(JSC_DIR, file), 'utf8');
            assert(!src.includes('httpClient'), `${file} must not use Rhino httpClient (use ServiceCallout instead)`);
            assert(!src.includes('waitForComplete'), `${file} must never call exchange.waitForComplete() (blocks Apigee-Main worker threads)`);
        }

        for (const clsFile of fs.readdirSync(calloutSrcDir).filter(f => f.endsWith('.java'))) {
            const javaSrc = fs.readFileSync(path.join(calloutSrcDir, clsFile), 'utf8');
            assert(!javaSrc.includes('HttpURLConnection'), `${clsFile} must never perform blocking HttpURLConnection I/O inside a JavaCallout`);
            assert(!javaSrc.includes('java.net.Socket'), `${clsFile} must never open raw Sockets inside a JavaCallout`);
            assert(!javaSrc.includes('ProcessBuilder'), `${clsFile} must never spawn processes inside a JavaCallout`);
        }
    });

    test('PERF-SKILL-05: All 23 JS/Java callout actions execute with zero duplicate context.getVariable() reads and zero global leaks', () => {
        // Exercise every single JS callout through runScript() which enforces getVarCounts[k] <= 1 and zero leaked globals
        runScript('anthropic_to_gemini.js', {
            'request.content': JSON.stringify({
                model: 'gemini-3.5-flash',
                max_tokens: 128,
                system: 'Be helpful.',
                messages: [{ role: 'user', content: 'Hello' }]
            })
        });
        runScript('anthropic_to_openai_resp.js', {
            'response.content': JSON.stringify({
                id: 'msg_1',
                model: 'claude-sonnet-4-6',
                stop_reason: 'end_turn',
                content: [{ type: 'text', text: 'Hi' }],
                usage: { input_tokens: 10, output_tokens: 5 }
            })
        });
        runScript('apply_fallback_response.js', {
            'original_request_format': 'openai',
            'fallback_format': 'gemini',
            'fallback_model': 'gemini-3.5-flash',
            'fallbackResponse.status.code': 200,
            'fallbackResponse.content': JSON.stringify({
                candidates: [{ content: { role: 'model', parts: [{ text: 'OK' }] }, finishReason: 'STOP' }],
                usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2, totalTokenCount: 7 }
            })
        });
        runScript('calculate_monetization_cost.js', {
            'model': 'gemini-3.5-flash',
            'usage_prompt_tokens': '100',
            'usage_completion_tokens': '50'
        });
        runScript('calculate_tokens_non_streaming.js', {
            'request_format': 'openai',
            'prompt_tokens': '100',
            'completion_tokens': '50'
        });
        runScript('combine_resp.js', {
            'request_format': 'claude',
            'route_target': 'claude',
            'response.event.current.content': 'event: message_stop\ndata: {"type":"message_stop"}'
        });
        runScript('extract_auth_credentials.js', {
            'request.header.x-api-key': 'test-key-123'
        });
        runScript('extract_prompt.js', {
            'request.content': JSON.stringify({
                messages: [{ role: 'user', content: 'Check prompt safety' }]
            })
        });
        runScript('extract_vars_claude.js', {
            'request.header.Content-Type': 'application/json',
            'request.content': JSON.stringify({
                model: 'claude-haiku-4-5',
                max_tokens: 64,
                messages: [{ role: 'user', content: 'Hello Claude' }]
            })
        });
        runScript('extract_vars_gemini.js', {
            'proxy.pathsuffix': '/v1/projects/p/locations/us-central1/publishers/google/models/gemini-3.5-flash:generateContent',
            'request.content': JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: 'Hello Gemini' }] }]
            })
        });
        runScript('extract_vars_openai.js', {
            'proxy.pathsuffix': '/',
            'request.content': JSON.stringify({
                model: 'gemini-3.5-flash',
                messages: [{ role: 'user', content: 'Hello OpenAI' }]
            })
        });
        runScript('format_rate_limit_error.js', {
            'proxy.name': 'claude-messages',
            'ratelimit.LTQ-EnforceOnly.failed': true,
            'ratelimit.LTQ-EnforceOnly.allowed.count': '10000'
        });
        runScript('gemini_to_anthropic_resp.js', {
            'response.content': JSON.stringify({
                candidates: [{ content: { role: 'model', parts: [{ text: 'Hello' }] }, finishReason: 'STOP' }],
                usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 4, totalTokenCount: 12 }
            })
        });
        runScript('inject_anthropic_version.js', {
            'request_format': 'claude',
            'model': 'claude-haiku-4-5',
            'request.content': JSON.stringify({
                model: 'claude-haiku-4-5',
                max_tokens: 64,
                messages: [{ role: 'user', content: 'Hi' }]
            })
        });
        runScript('inject_deidentified_finding.js', {
            'error.content': JSON.stringify({ sanitizationResult: { filterMatchState: 'MATCH_FOUND' } }),
            'SanitizeUserPrompt.SUP-SanitizeUserPrompt.filterMatchState': 'MATCH_FOUND'
        });
        runScript('models_endpoint.js', {
            'proxy.pathsuffix': '',
            'propertyset.model_locations.models.catalog': 'gemini-3.5-flash,claude-haiku-4-5'
        });
        runScript('prepare_fallback_request.js', {
            'fallback_model': 'gemini-3.5-flash',
            'fallback_triggered': 'false',
            'response.status.code': 503,
            'original_request_format': 'openai',
            'original_request_body': JSON.stringify({
                model: 'claude-sonnet-4-6',
                messages: [{ role: 'user', content: 'Fallback test' }]
            })
        });
        runScript('prepare_judge_request.js', {
            'model': 'auto:judge',
            'request.content': JSON.stringify({
                model: 'auto:judge',
                messages: [{ role: 'user', content: 'Classify this task' }]
            })
        });
        runScript('process_judge_response.js', {
            'judgeResponse.status.code': 200,
            'judgeResponse.content': JSON.stringify({
                candidates: [{ content: { parts: [{ text: '{"complexity":"LOW"}' }] } }]
            })
        });
        runScript('resolve_auth_persona.js', {
            'auth_token_type': 'idp_jwt',
            'jwt.VJ-VerifyIdpJwt.valid': 'true',
            'jwt.VJ-VerifyIdpJwt.claim.email': 'user@corp.com',
            'jwt.VJ-VerifyIdpJwt.claim.role': 'developer',
            'jwt.VJ-VerifyIdpJwt.claim.audience': 'api://ai-gateway',
            'propertyset.config.auth_idp_jwt_audience': 'api://ai-gateway',
            'propertyset.config.auth_personas_list': 'developer',
            'propertyset.config.auth_default_client_id': 'default-app-id',
            'propertyset.config.persona.developer.match_claims': 'developer'
        });
        runScript('resolve_model_location.js', {
            'model': 'gemini-3.5-flash',
            'request_format': 'openai'
        });
        runScript('restore_model_openai.js', {
            'model': 'gemini-3.5-flash',
            'model_publisher': 'google',
            'request.content': JSON.stringify({
                model: 'gemini-3.5-flash',
                messages: [{ role: 'user', content: 'Hi' }]
            })
        });
        runScript('restore_request_payload.js', {
            'saved_request_content': '{"model":"gemini-3.5-flash"}',
            'saved_request_content_type': 'application/json'
        });
    });

    test('PERF-SKILL-06: Flow <Condition> expressions never read request.content/response.content and avoid slow regex/wildcard operators', () => {
        const proxyDir = path.join(BUNDLE_DIR, 'proxies');
        const targetDir = path.join(BUNDLE_DIR, 'targets');
        const apiproxyYaml = fs.readFileSync(path.join(TMPL_DIR, 'apiproxy.yaml'), 'utf8');

        const xmlFiles = [
            ...fs.readdirSync(proxyDir).map(f => path.join(proxyDir, f)),
            ...fs.readdirSync(targetDir).map(f => path.join(targetDir, f))
        ];

        for (const file of xmlFiles) {
            const content = fs.readFileSync(file, 'utf8');
            const conditions = content.match(/<Condition>[\s\S]*?<\/Condition>/g) || [];
            for (const cond of conditions) {
                assert(
                    !/\b(request|response|message|error)\.content\b/.test(cond),
                    `${path.basename(file)} references *.content inside <Condition>, forcing double heap allocation via Bytes.toString(): ${cond}`
                );
                assert(
                    !cond.includes('~~'),
                    `${path.basename(file)} uses slow Tier-4 JavaRegex (~~) inside <Condition>: ${cond}`
                );
                assert(
                    !cond.includes('Matches "*judge*"'),
                    `${path.basename(file)} uses wildcard Matches "*judge*" instead of exact Tier-1 equality: ${cond}`
                );
            }
        }
        assert(!apiproxyYaml.includes('Matches "*judge*"'), 'templates/ai-gateway/apiproxy.yaml must not use Matches "*judge*"');
    });

    test('PERF-SKILL-07: <FaultRules> and <DefaultFaultRule> never execute <RaiseFault> (use <AssignMessage> to avoid FlowState.ABORT)', () => {
        const proxyDir = path.join(BUNDLE_DIR, 'proxies');
        const targetDir = path.join(BUNDLE_DIR, 'targets');
        const xmlFiles = [
            ...fs.readdirSync(proxyDir).map(f => path.join(proxyDir, f)),
            ...fs.readdirSync(targetDir).map(f => path.join(targetDir, f))
        ];

        for (const file of xmlFiles) {
            const content = fs.readFileSync(file, 'utf8');
            const faultBlocks = [
                ...(content.match(/<FaultRules>[\s\S]*?<\/FaultRules>/g) || []),
                ...(content.match(/<DefaultFaultRule[\s\S]*?<\/DefaultFaultRule>/g) || [])
            ];
            for (const block of faultBlocks) {
                assert(
                    !/<Name>RF-[^<]+<\/Name>/.test(block),
                    `${path.basename(file)} executes a <RaiseFault> (RF-*) inside FaultRules/DefaultFaultRule, which triggers FlowState.ABORT!`
                );
            }
        }
    });

    test('PERF-SKILL-08: All <ServiceCallout> policies set clearPayload="true" to prevent unnecessary request stream buffering', () => {
        const policyDir = path.join(BUNDLE_DIR, 'policies');
        const scFiles = fs.readdirSync(policyDir).filter(f => f.startsWith('SC-'));
        assert(scFiles.length >= 5, 'Expected at least 5 ServiceCallout policies');
        for (const f of scFiles) {
            const xml = fs.readFileSync(path.join(policyDir, f), 'utf8');
            assert(
                xml.includes('clearPayload="true"'),
                `${f} must set clearPayload="true" on <Request> so ServiceCalloutStepDefinition.doBufferRequest() is false`
            );
        }
    });

    test('PERF-SKILL-09: ProxyEndpoints and TargetEndpoints omit legacy response.streaming.enabled and EventFlow stays within 5-step limit', () => {
        const proxyDirCheck = path.join(BUNDLE_DIR, 'proxies');
        const targetDir = path.join(BUNDLE_DIR, 'targets');
        for (const f of fs.readdirSync(proxyDirCheck).filter(x => x.endsWith('.xml'))) {
            const xml = fs.readFileSync(path.join(proxyDirCheck, f), 'utf8');
            assert(
                !xml.includes('response.streaming.enabled'),
                `ProxyEndpoint ${f} must omit legacy BodyPipe response.streaming.enabled (EventFlow handles SSE natively)`
            );
        }
        for (const f of fs.readdirSync(targetDir).filter(x => x.endsWith('.xml'))) {
            const xml = fs.readFileSync(path.join(targetDir, f), 'utf8');
            assert(
                !xml.includes('response.streaming.enabled'),
                `TargetEndpoint ${f} must omit response.streaming.enabled`
            );
            const efMatch = xml.match(/<EventFlow[\s\S]*?<\/EventFlow>/);
            if (efMatch) {
                const stepCount = (efMatch[0].match(/<Step>/g) || []).length;
                assert(stepCount <= 5, `Target ${f} EventFlow has ${stepCount} steps (exceeds Apigee 5-policy EventFlow ceiling)`);
            }
        }

        // Verify embedding upstream_model alias forces stream=false before RouteRule evaluation
        const embAliasVars = {
            'model': 'byo-gemini-model',
            'stream': true,
            'propertyset.model_locations.byo-gemini-model.upstream_model': 'text-embedding-005',
            'request.content': '{"model":"byo-gemini-model","input":"hello","stream":true}'
        };
        assertEqual(runScript('resolve_model_location.js', embAliasVars), 'CONTINUE');
        assertEqual(embAliasVars['is_embeddings'], 'true');
        assertEqual(embAliasVars['stream'], false);

        // Verify every RQ-ReleaseConcurrencySlot step across proxies & targets enforces single-release via timeTaken = null,
        // and apiproxy.yaml PostFlow releases slots on non-SSE stream=true responses (e.g. JSON :streamGenerateContent)
        const proxyDir = path.join(BUNDLE_DIR, 'proxies');
        for (const dir of [proxyDir, targetDir]) {
            for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.xml'))) {
                const xml = fs.readFileSync(path.join(dir, f), 'utf8');
                const stepBlocks = xml.match(/<Step>[\s\S]*?<\/Step>/g) || [];
                for (const block of stepBlocks) {
                    if (block.includes('<Name>RQ-ReleaseConcurrencySlot</Name>')) {
                        assert(
                            block.includes('ratelimit.Q-ConcurrencyLimit.used.count != null') &&
                            block.includes('apigee.metrics.policy.RQ-ReleaseConcurrencySlot.timeTaken = null'),
                            `${f} RQ-ReleaseConcurrencySlot step missing used.count or single-release timeTaken guard: ${block}`
                        );
                    }
                }
            }
        }
        const apiproxyYaml = fs.readFileSync(path.join(TMPL_DIR, 'apiproxy.yaml'), 'utf8');
        assert(
            apiproxyYaml.includes('!(response.header.Content-Type =| "text/event-stream")'),
            'apiproxy.yaml PostFlow must release concurrency slot when response Content-Type is not text/event-stream'
        );
    });

    test('PERF-SKILL-10: Vertex AI hot path skips external API key lookups and Judge reuses extracted Gemini prompt without double JSON.parse', () => {
        const vertexHotPathVars = {
            'model': 'gemini-3.5-flash',
            'request_format': 'gemini',
            'apiproduct.allowed_models': '["gemini-*"]',
            'request.content': JSON.stringify({
                models: ['claude-sonnet-4-6', 'gemini-3.5-flash'],
                contents: [{ role: 'user', parts: [{ text: 'Hello Gemini' }] }]
            })
        };
        let hotPathCounts = {};
        runScript('resolve_model_location.js', vertexHotPathVars, {
            onComplete: (counts) => { hotPathCounts = counts; }
        });
        const externalKeyReads = Object.keys(hotPathCounts).filter(k =>
            k.endsWith('_api_key') || k.endsWith('_api_key_ref') || k.endsWith('openai_org_id') || k.endsWith('openai_project_id')
        );
        assertEqual(vertexHotPathVars['primary_model'], 'gemini-3.5-flash');
        assertEqual(vertexHotPathVars['model_access_denied'], 'false');
        assertEqual(externalKeyReads.length, 0, `Vertex AI hot path performed unnecessary external key reads: ${externalKeyReads.join(', ')}`);

        // Verify heuristic auto-router does NOT set has_judge_payload, whereas mode='judge' does and prepare_judge_request reuses gemini_text_prompt
        const nonJudgeGemVars = {
            'request.content': JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: 'Simple heuristic auto-router request' }] }],
                plugins: [{ id: 'auto-router' }]
            })
        };
        runScript('extract_vars_gemini.js', nonJudgeGemVars);
        assert(nonJudgeGemVars['has_judge_payload'] !== 'true', 'Heuristic auto-router must not set has_judge_payload');

        const judgeGemVars = {
            'request.content': JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: 'Design a distributed consensus algorithm' }] }],
                plugins: [{ id: 'auto-router', mode: 'judge' }]
            })
        };
        runScript('extract_vars_gemini.js', judgeGemVars);
        assertEqual(judgeGemVars['has_judge_payload'], 'true');
        assertEqual(judgeGemVars['gemini_text_prompt'], 'Design a distributed consensus algorithm');

        // Replace request.content with unparseable string to prove prepare_judge_request.js reuses gemini_text_prompt without JSON.parse
        judgeGemVars['request.content'] = '{unparseable-if-reparsed';
        runScript('prepare_judge_request.js', judgeGemVars);
        assertEqual(judgeGemVars['trigger_judge'], 'true');
        assert(
            judgeGemVars['judge_request_payload'].includes('Design a distributed consensus algorithm'),
            'prepare_judge_request.js must reuse gemini_text_prompt without re-parsing request.content'
        );
    });

    test('PERF-SKILL-11: DataCapture policies bind only pre-computed flat variables, EventFlow Javascript enforces timeLimit="200", and JavaCallout policies bind ClassName + ResourceURL', () => {
        const policyDir = path.join(BUNDLE_DIR, 'policies');
        for (const f of fs.readdirSync(policyDir).filter(x => x.endsWith('.xml'))) {
            const xml = fs.readFileSync(path.join(policyDir, f), 'utf8');
            if (f.startsWith('DC-')) {
                assert(xml.includes('<IgnoreUnresolvedVariables>true</IgnoreUnresolvedVariables>'), `${f} must set IgnoreUnresolvedVariables=true`);
                const refs = [...xml.matchAll(/<Collect\s+ref="([^"]+)"/g)].map(m => m[1]);
                assert(refs.length >= 15, `${f} should capture comprehensive token and cost telemetry`);
                for (const r of refs) {
                    assert(
                        !r.includes('content') && !r.includes('$') && !r.includes('/'),
                        `${f} Collect ref="${r}" must reference a flat pre-computed flow variable, not payload content or paths`
                    );
                }
            }
            if (f === 'JS-combine-resp.xml') {
                assert(xml.includes('timeLimit="200"'), `${f} must enforce bounded timeLimit="200"`);
            } else if (f.startsWith('JS-')) {
                assert(xml.includes('<ClassName>com.google.apigee.callouts.'), `${f} must bind to a com.google.apigee.callouts.* Callout class`);
                assert(xml.includes('<ResourceURL>java://ai-gateway-callouts.jar</ResourceURL>'), `${f} must bind to java://ai-gateway-callouts.jar`);
            }
        }
    });

    test('PERF-SKILL-12: "tool_choice":"auto" avoids duplicate DOM parse, EV-ExtractMetadataNonStreaming* skips already-extracted responses, and openai-custom avoids 2-hop response transcoding', () => {
        // 1. OpenAI payload with "tool_choice":"auto" and "detail":"auto" must NOT trigger re-parse in resolve_model_location
        const oaiAutoToolVars = {
            'request.header.Content-Type': 'application/json',
            'request.content': JSON.stringify({
                model: 'gpt-4o-mini',
                tool_choice: 'auto',
                messages: [{
                    role: 'user',
                    content: [
                        { type: 'text', text: 'Inspect chart' },
                        { type: 'image_url', image_url: { url: 'https://example.com/chart.png', detail: 'auto' } }
                    ]
                }]
            })
        };
        runScript('extract_vars_openai.js', oaiAutoToolVars);
        assertEqual(oaiAutoToolVars['has_routing_features'], 'false');
        assertEqual(oaiAutoToolVars['payload_strict_validated'], 'true');
        oaiAutoToolVars['request.content'] = '{unparseable-if-reparsed';
        oaiAutoToolVars['raw_client_payload'] = '{unparseable-if-reparsed';
        assertEqual(runScript('resolve_model_location.js', oaiAutoToolVars), 'CONTINUE');
        assertEqual(oaiAutoToolVars['primary_model'], 'gpt-4o-mini');

        // 2. Direct single-hop Gemini -> OpenAI transcoding via anthropic_to_openai_resp & gemini_to_openai_resp
        const gemToOaiVars = {
            'request_format': 'openai',
            'model': 'byo-gemini-model',
            'response.content': JSON.stringify({
                modelVersion: 'gemini-2.5-flash',
                candidates: [{
                    content: { role: 'model', parts: [{ thought: true, text: 'Chain of thought' }, { text: 'Direct OpenAI OK' }] },
                    finishReason: 'STOP'
                }],
                usageMetadata: { promptTokenCount: 50, cachedContentTokenCount: 20, candidatesTokenCount: 10, thoughtsTokenCount: 15 }
            })
        };
        assertEqual(runScript('anthropic_to_openai_resp.js', gemToOaiVars), 'CONTINUE');
        assertEqual(gemToOaiVars['response_tokens_extracted'], 'true');
        assertEqual(gemToOaiVars['reasoning_tokens'], '15');
        const parsedOai = JSON.parse(gemToOaiVars['response.content']);
        assertEqual(parsedOai.object, 'chat.completion');
        assertEqual(parsedOai.choices[0].message.content, 'Direct OpenAI OK');
        assertEqual(parsedOai.usage.prompt_tokens, 50);
        assertEqual(parsedOai.usage.completion_tokens, 25);
        assertEqual(parsedOai.usage.prompt_tokens_details.cached_tokens, 20);
        assertEqual(parsedOai.usage.completion_tokens_details.reasoning_tokens, 15);

        // 3. Verify apiproxy.yaml gates EV-ExtractMetadataNonStreaming* and removes 2-hop chain on openai-custom
        const apiproxyYaml = fs.readFileSync(path.join(TMPL_DIR, 'apiproxy.yaml'), 'utf8');
        assert(
            apiproxyYaml.includes('response_tokens_extracted != "true"'),
            'apiproxy.yaml must gate EV-ExtractMetadataNonStreaming* with response_tokens_extracted != "true"'
        );
        assert(
            !apiproxyYaml.includes('or ((model_format = "gemini") and (request_format = "openai"))'),
            'openai-custom PostFlow must not chain JS-gemini-to-anthropic-resp before JS-anthropic-to-openai-resp'
        );
    });

    test('PERF-SKILL-13: StrictJson BigDecimal fidelity, conditional prompt materialization when Armor/Judge inactive, Boolean stream consistency, and models_endpoint auth_* parity', () => {
        // 1. >53-bit decimal preserved byte-for-byte across anthropic_to_gemini tool_use transcoding
        const preciseToolVars = {
            'primary_model': 'gemini-2.5-flash',
            'request.content': JSON.stringify({
                model: 'gemini-2.5-flash',
                max_tokens: 64,
                messages: [
                    { role: 'user', content: 'Send wire transfer' },
                    {
                        role: 'assistant',
                        content: [{
                            type: 'tool_use',
                            id: 'toolu_prec1',
                            name: 'wire_transfer',
                            input: { placeholder: 1 }
                        }]
                    }
                ]
            }).replace('"placeholder":1', '"amount":12345678901234567890.1234567890')
        };
        assertEqual(runScript('anthropic_to_gemini.js', preciseToolVars), 'CONTINUE');
        assert(
            preciseToolVars['request.content'].includes('12345678901234567890.1234567890'),
            'StrictJson BigDecimal must preserve >53-bit decimals without IEEE-754 rounding'
        );

        // 2. Conditional prompt skipping when model_armor_enabled=false and Judge is not requested
        const fastNoArmorVars = {
            'request.header.Content-Type': 'application/json',
            'propertyset.config.model_armor_enabled': 'false',
            'propertyset.config.llm_judge_enabled': 'false',
            'request.content': JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: 'Zero StringBuilder fast path' }]
            })
        };
        assertEqual(runScript('extract_vars_openai.js', fastNoArmorVars), 'CONTINUE');
        assertEqual(fastNoArmorVars['prompt_char_len'], '28');
        assertEqual(fastNoArmorVars['extracted_prompt'], undefined);
        assertEqual(fastNoArmorVars['prompt'], undefined);

        // 3. restore_model_openai keeps stream strictly boolean true
        const streamCheckVars = {
            'gcp_project_id': 'my-gcp-project',
            'request_format': 'openai',
            'model': 'gemini-2.5-flash',
            'model_publisher': 'google',
            'model_location': 'global',
            'request.content': JSON.stringify({
                model: 'gemini-2.5-flash',
                stream: true,
                messages: [{ role: 'user', content: 'hi' }]
            })
        };
        assertEqual(runScript('restore_model_openai.js', streamCheckVars), 'CONTINUE');
        assertEqual(streamCheckVars['stream'], true);

        // 4. models_endpoint honors same-request auth_user_email and auth_allowed_models
        const modelsAuthVars = {
            'request.verb': 'GET',
            'auth_user_email': 'sre@cymbal.io',
            'auth_persona': 'it',
            'auth_allowed_models': 'gemini-*',
            'propertyset.model_locations.models.catalog': 'gemini-2.5-flash,claude-haiku-4-5'
        };
        assertEqual(runScript('models_endpoint.js', modelsAuthVars), 'CONTINUE');
        assertEqual(modelsAuthVars['identity_user_id'], 'sre@cymbal.io');
        assertEqual(modelsAuthVars['response.status.code'], 200);
        const modelsData = JSON.parse(modelsAuthVars['response.content']).data;
        assertEqual(modelsData.length, 1);
        assertEqual(modelsData[0].id, 'gemini-2.5-flash');
    });
});


