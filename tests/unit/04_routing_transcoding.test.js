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
    BUNDLE_DIR,
    runScript,
    suite,
    test,
    assert,
    assertEqual
} = require('./helpers/harness');

suite('Smart Routing, Multi-Provider Transcoding, Streaming & Circuit Breaker Suite', () => {
    test('ROUTE-01: Vertex AI Model Garden MaaS Dynamic Publishers (meta/, mistralai/)', () => {
        // 1. Explicit publisher prefix in request (meta/llama-3.3-70b-instruct-maas)
        const metaVars = {
            'proxy.pathsuffix': '/',
            'propertyset.config.project_id': 'demo-proj',
            'propertyset.model_locations.default.publisher': 'google',
            'request.content': JSON.stringify({
                model: 'meta/llama-3.3-70b-instruct-maas',
                messages: [{ role: 'user', content: 'Hello Llama' }]
            })
        };
        runScript('extract_vars_openai.js', metaVars);
        runScript('resolve_model_location.js', metaVars);
        runScript('restore_model_openai.js', metaVars);
        const metaBody = JSON.parse(metaVars['request.content']);
        assertEqual(metaBody.model, 'meta/llama-3.3-70b-instruct-maas');
        assertEqual(metaVars['model_publisher'], 'meta');

        // 2. Configured MaaS publisher without prefix in request (mistral-large-2411 -> mistralai/mistral-large-2411)
        const mistralVars = {
            'proxy.pathsuffix': '/',
            'propertyset.config.project_id': 'demo-proj',
            'propertyset.model_locations.default.publisher': 'google',
            'propertyset.model_locations.mistral-large-2411.publisher': 'mistralai',
            'propertyset.model_locations.mistral-large-2411.target': 'gemini-openai-compat',
            'propertyset.model_locations.mistral-large-2411.endpoint': 'us-central1',
            'propertyset.model_locations.mistral-large-2411.model': 'us-central1',
            'request.content': JSON.stringify({
                model: 'mistral-large-2411',
                messages: [{ role: 'user', content: 'Bonjour Mistral' }]
            })
        };
        runScript('extract_vars_openai.js', mistralVars);
        runScript('resolve_model_location.js', mistralVars);
        runScript('restore_model_openai.js', mistralVars);
        const mistralBody = JSON.parse(mistralVars['request.content']);
        assertEqual(mistralBody.model, 'mistralai/mistral-large-2411');
    });

    test('ROUTE-02: OpenAI /v1/embeddings & Native Vertex :predict Transcoding', () => {
        const embVars = {
            'proxy.pathsuffix': '/',
            'propertyset.config.project_id': 'demo-proj',
            'propertyset.model_locations.default.publisher': 'google',
            'propertyset.model_locations.alias.text-embedding-3-small': 'text-embedding-005',
            'propertyset.model_locations.text-embedding-005.publisher': 'google',
            'propertyset.model_locations.text-embedding-005.target': 'gemini-openai-compat',
            'propertyset.model_locations.text-embedding-005.endpoint': 'us-central1',
            'propertyset.model_locations.text-embedding-005.model': 'us-central1',
            'request.content': JSON.stringify({
                model: 'text-embedding-3-small',
                input: ['Embed first sentence', 'Embed second sentence'],
                dimensions: 256
            })
        };
        runScript('extract_vars_openai.js', embVars);
        runScript('resolve_model_location.js', embVars);
        runScript('restore_model_openai.js', embVars);

        const predictReq = JSON.parse(embVars['request.content']);
        assert(Array.isArray(predictReq.instances) && predictReq.instances.length === 2, 'Expected 2 Vertex :predict instances');
        assertEqual(predictReq.instances[0].content, 'Embed first sentence');
        assert(embVars['target.url'].endsWith('/locations/us-central1/publishers/google/models/text-embedding-005:predict'));

        // Simulate Vertex :predict response -> OpenAI embeddings list
        embVars['response.content'] = JSON.stringify({
            predictions: [
                { embeddings: { values: [0.1, 0.2], statistics: { truncated: false, token_count: 4 } } },
                { embeddings: { values: [0.3, 0.4], statistics: { truncated: false, token_count: 5 } } }
            ]
        });
        runScript('calculate_tokens_non_streaming.js', embVars);
        const openaiEmbResp = JSON.parse(embVars['response.content']);
        assertEqual(openaiEmbResp.object, 'list');
        assertEqual(openaiEmbResp.data.length, 2);
        assertEqual(openaiEmbResp.usage.total_tokens, 9);
        assertEqual(embVars['usage_total_tokens'], '9');

        // Native Vertex :predict route on /ai-gateway
        const nativePredictVars = {
            'proxy.pathsuffix': '/v1/projects/demo-proj/locations/us-central1/publishers/google/models/text-embedding-005:predict',
            'request.content': JSON.stringify({
                instances: [{ content: 'Native Vertex embedding test' }]
            })
        };
        runScript('extract_vars_gemini.js', nativePredictVars);
        runScript('resolve_model_location.js', nativePredictVars);
        assertEqual(nativePredictVars['is_embeddings'], 'true');
        assertEqual(nativePredictVars['gemini_text_prompt'], 'Native Vertex embedding test');
        assertEqual(
            nativePredictVars['target.url'],
            'https://us-central1-aiplatform.googleapis.com/v1/projects/demo-proj/locations/us-central1/publishers/google/models/text-embedding-005:predict'
        );

        // Google :predict embeddings with upstream_model alias
        const googleEmbAliasVars = {
            'request_format': 'openai',
            'is_embeddings': 'true',
            'model': 'byo-gemini-model',
            'model_publisher': 'google',
            'model_location': 'us-central1',
            'propertyset.config.project_id': 'my-gcp-project',
            'propertyset.model_locations.byo-gemini-model.upstream_model': 'text-embedding-005',
            'request.content': JSON.stringify({ model: 'byo-gemini-model', input: 'Hello world' })
        };
        runScript('restore_model_openai.js', googleEmbAliasVars);
        assertEqual(
            googleEmbAliasVars['target.url'],
            'https://us-central1-aiplatform.googleapis.com/v1/projects/my-gcp-project/locations/us-central1/publishers/google/models/text-embedding-005:predict'
        );
        assertEqual(googleEmbAliasVars['vertex_predict_embeddings'], 'true');
    });

    test('ROUTE-03: Direct OpenAI Connectivity & Per-Client Account Isolation (Client A vs Client B)', () => {
        const clientAVars = {
            'proxy.pathsuffix': '/',
            'request.header.x-apikey': 'apigee-client-a-key',
            'propertyset.model_locations.alias.gpt-4o': 'gemini-2.5-pro',
            'verifyapikey.VA-ApiKey.openai_api_key': 'sk-proj-client-A-isolated',
            'verifyapikey.VA-ApiKey.openai_org_id': 'org-client-A',
            'verifyapikey.VA-ApiKey.openai_project_id': 'proj-client-A',
            'request.content': JSON.stringify({
                model: 'gpt-4o',
                messages: [{ role: 'user', content: 'Hello from Client A' }]
            })
        };
        runScript('extract_vars_openai.js', clientAVars);
        runScript('resolve_model_location.js', clientAVars);
        runScript('restore_model_openai.js', clientAVars);

        const clientABody = JSON.parse(clientAVars['request.content']);
        assertEqual(clientAVars['route_target'], 'openai-custom');
        assertEqual(clientAVars['target.url'], 'https://api.openai.com/v1/chat/completions');
        assertEqual(clientABody.model, 'gpt-4o');
        assertEqual(clientAVars['request.header.Authorization'], 'Bearer sk-proj-client-A-isolated');
        assertEqual(clientAVars['request.header.OpenAI-Organization'], 'org-client-A');
        assertEqual(clientAVars['request.header.OpenAI-Project'], 'proj-client-A');
        assertEqual(clientAVars['request.header.x-apikey'], '');

        const clientBVars = {
            'proxy.pathsuffix': '/',
            'propertyset.config.client_b_openai_secret': 'sk-proj-client-B-secret',
            'verifyapikey.VA-ApiKey.openai_api_key_ref': 'propertyset.config.client_b_openai_secret',
            'verifyapikey.VA-ApiKey.openai_org_id': 'org-client-B',
            'request.content': JSON.stringify({
                model: 'openai/gpt-4o-mini',
                messages: [{ role: 'user', content: 'Hello from Client B' }]
            })
        };
        runScript('extract_vars_openai.js', clientBVars);
        runScript('resolve_model_location.js', clientBVars);
        runScript('restore_model_openai.js', clientBVars);
        assertEqual(clientBVars['request.header.Authorization'], 'Bearer sk-proj-client-B-secret');
        assertEqual(clientBVars['request.header.OpenAI-Organization'], 'org-client-B');
    });

    test('ROUTE-04: Self-Hosted vLLM, Direct Anthropic & Azure OpenAI via Environment PropertySet (provider_keys)', () => {
        // 1. Self-hosted vLLM Bearer
        const vllmVars = {
            'proxy.pathsuffix': '/',
            'request.header.x-apikey': 'apigee-gateway-client-key',
            'propertyset.provider_keys.vllm_api_key': 'vllm-internal-secret',
            'propertyset.model_locations.custom-vllm.publisher': 'custom',
            'propertyset.model_locations.custom-vllm.format': 'openai',
            'propertyset.model_locations.custom-vllm.url': 'https://vllm.internal.corp/v1/chat/completions',
            'propertyset.model_locations.custom-vllm.auth_type': 'api_key',
            'propertyset.model_locations.custom-vllm.auth_token_ref': 'propertyset.provider_keys.vllm_api_key',
            'request.content': JSON.stringify({
                model: 'custom-vllm',
                messages: [{ role: 'user', content: 'Hello self-hosted vLLM' }]
            })
        };
        runScript('extract_vars_openai.js', vllmVars);
        runScript('resolve_model_location.js', vllmVars);
        runScript('restore_model_openai.js', vllmVars);
        assertEqual(vllmVars['route_target'], 'openai-custom');
        assertEqual(vllmVars['target.url'], 'https://vllm.internal.corp/v1/chat/completions');
        assertEqual(vllmVars['request.header.Authorization'], 'Bearer vllm-internal-secret');
        assertEqual(vllmVars['request.header.x-apikey'], '');

        // 2. Direct Anthropic x-api-key + anthropic-version header
        const directAnthropicVars = {
            'proxy.pathsuffix': '/',
            'request_format': 'claude',
            'model': 'claude-sonnet-4-6-direct',
            'request.header.x-apikey': 'apigee-gateway-client-key',
            'propertyset.provider_keys.anthropic_api_key': 'sk-ant-env-propertyset-key',
            'propertyset.model_locations.claude-sonnet-4-6-direct.publisher': 'anthropic',
            'propertyset.model_locations.claude-sonnet-4-6-direct.target': 'claude',
            'propertyset.model_locations.claude-sonnet-4-6-direct.format': 'anthropic',
            'propertyset.model_locations.claude-sonnet-4-6-direct.url': 'https://api.anthropic.com/v1/messages',
            'propertyset.model_locations.claude-sonnet-4-6-direct.upstream_model': 'claude-sonnet-4-6',
            'propertyset.model_locations.claude-sonnet-4-6-direct.auth_type': 'api_key',
            'propertyset.model_locations.claude-sonnet-4-6-direct.auth_header': 'x-api-key',
            'propertyset.model_locations.claude-sonnet-4-6-direct.auth_token_ref': 'propertyset.provider_keys.anthropic_api_key',
            'request.content': JSON.stringify({
                model: 'claude-sonnet-4-6-direct',
                max_tokens: 128,
                messages: [{ role: 'user', content: 'Hello Direct Anthropic' }]
            })
        };
        runScript('resolve_model_location.js', directAnthropicVars);
        runScript('inject_anthropic_version.js', directAnthropicVars);
        const directAntBody = JSON.parse(directAnthropicVars['request.content']);
        assertEqual(directAnthropicVars['route_target'], 'openai-custom');
        assertEqual(directAnthropicVars['route_format'], 'anthropic');
        assertEqual(directAnthropicVars['target.url'], 'https://api.anthropic.com/v1/messages');
        assertEqual(directAnthropicVars['request.header.x-api-key'], 'sk-ant-env-propertyset-key');
        assertEqual(directAnthropicVars['request.header.anthropic-version'], '2023-06-01');
        assertEqual(directAntBody.model, 'claude-sonnet-4-6');
        assertEqual(directAntBody.anthropic_version, undefined);

        // 3. Azure OpenAI api-key header + client Authorization strip
        const azureVars = {
            'proxy.pathsuffix': '/',
            'request.header.x-apikey': 'apigee-gateway-client-key',
            'request.header.Authorization': 'Bearer client-apigee-oauth-token-do-not-leak',
            'propertyset.provider_keys.azure_api_key': 'azure-env-propertyset-key',
            'propertyset.model_locations.azure-gpt-5-4.publisher': 'azure',
            'propertyset.model_locations.azure-gpt-5-4.target': 'openai-custom',
            'propertyset.model_locations.azure-gpt-5-4.format': 'openai',
            'propertyset.model_locations.azure-gpt-5-4.url': 'https://my-resource.openai.azure.com/openai/deployments/gpt-5-4/chat/completions?api-version=2025-01-01-preview',
            'propertyset.model_locations.azure-gpt-5-4.auth_type': 'api_key',
            'propertyset.model_locations.azure-gpt-5-4.auth_header': 'api-key',
            'propertyset.model_locations.azure-gpt-5-4.auth_token_ref': 'propertyset.provider_keys.azure_api_key',
            'request.content': JSON.stringify({
                model: 'azure-gpt-5-4',
                messages: [{ role: 'user', content: 'Hello Azure OpenAI' }]
            })
        };
        runScript('extract_vars_openai.js', azureVars);
        runScript('resolve_model_location.js', azureVars);
        runScript('restore_model_openai.js', azureVars);
        assertEqual(azureVars['route_target'], 'openai-custom');
        assertEqual(azureVars['request.header.api-key'], 'azure-env-propertyset-key');
        assertEqual(azureVars['request.header.x-apikey'], '');
        assertEqual(azureVars['request.header.Authorization'], '');
    });

    test('ROUTE-05: Anthropic /v1/messages <-> OpenAI Tool Calling & Streaming Transcoding', () => {
        const claudeToMaasVars = {
            'proxy.pathsuffix': '/',
            'model': 'meta/llama-3.3-70b-instruct-maas',
            'propertyset.config.project_id': 'demo-proj',
            'propertyset.model_locations.llama-3.3-70b-instruct-maas.publisher': 'meta',
            'propertyset.model_locations.llama-3.3-70b-instruct-maas.target': 'gemini-openai-compat',
            'propertyset.model_locations.llama-3.3-70b-instruct-maas.format': 'openai',
            'propertyset.model_locations.llama-3.3-70b-instruct-maas.endpoint': 'us-central1',
            'propertyset.model_locations.llama-3.3-70b-instruct-maas.model': 'us-central1',
            'request.content': JSON.stringify({
                model: 'meta/llama-3.3-70b-instruct-maas',
                max_tokens: 256,
                system: 'Be concise.',
                messages: [{ role: 'user', content: 'What is the weather in Paris?' }],
                tools: [{
                    name: 'get_weather',
                    description: 'Get weather',
                    input_schema: { type: 'object', properties: { city: { type: 'string' } } }
                }]
            })
        };
        runScript('resolve_model_location.js', claudeToMaasVars);
        runScript('restore_model_openai.js', claudeToMaasVars);

        const transcodedReq = JSON.parse(claudeToMaasVars['request.content']);
        assertEqual(claudeToMaasVars['route_target'], 'gemini-openai-compat');
        assertEqual(transcodedReq.model, 'meta/llama-3.3-70b-instruct-maas');
        assertEqual(transcodedReq.messages.length, 2);
        assertEqual(transcodedReq.messages[0].role, 'system');
        assertEqual(transcodedReq.tools[0].function.name, 'get_weather');

        claudeToMaasVars['response.content'] = JSON.stringify({
            id: 'chatcmpl-12345',
            object: 'chat.completion',
            model: 'meta/llama-3.3-70b-instruct-maas',
            choices: [{
                index: 0,
                message: {
                    role: 'assistant',
                    content: 'Checking weather...',
                    tool_calls: [{
                        id: 'call_abc123',
                        type: 'function',
                        function: { name: 'get_weather', arguments: '{"city":"Paris"}' }
                    }]
                },
                finish_reason: 'tool_calls'
            }],
            usage: { prompt_tokens: 18, completion_tokens: 12, total_tokens: 30 }
        });
        runScript('gemini_to_anthropic_resp.js', claudeToMaasVars);

        const transcodedResp = JSON.parse(claudeToMaasVars['response.content']);
        assertEqual(transcodedResp.type, 'message');
        assertEqual(transcodedResp.stop_reason, 'tool_use');
        assertEqual(transcodedResp.content.length, 2);
        assertEqual(transcodedResp.content[1].type, 'tool_use');
        assertEqual(transcodedResp.content[1].input.city, 'Paris');
        assertEqual(transcodedResp.usage.input_tokens, 18);
        assertEqual(transcodedResp.usage.output_tokens, 12);

        // OpenAI -> Claude streaming & OpenAI stream_options.include_usage=true
        const oaiToClaudeStreamVars = {
            'request_format': 'openai',
            'model': 'claude-on-bedrock',
            'model_custom_url': 'https://mock-llm.example.com/mock/v1/messages',
            'request.content': JSON.stringify({
                model: 'claude-on-bedrock',
                stream: true,
                max_tokens: 64,
                messages: [{ role: 'user', content: 'Stream test' }]
            })
        };
        runScript('inject_anthropic_version.js', oaiToClaudeStreamVars);
        const transcodedClaudeStreamReq = JSON.parse(oaiToClaudeStreamVars['request.content']);
        assertEqual(transcodedClaudeStreamReq.stream, true);
        assertEqual(transcodedClaudeStreamReq.model, 'claude-on-bedrock');
        assertEqual(transcodedClaudeStreamReq.anthropic_version, 'vertex-2023-10-16');

        const oaiStreamOptsVars = {
            'request_format': 'openai',
            'model': 'gemini-2.5-flash',
            'model_publisher': 'google',
            'propertyset.config.project_id': 'my-gcp-project',
            'request.content': JSON.stringify({
                model: 'gemini-2.5-flash',
                stream: true,
                messages: [{ role: 'user', content: 'Stream usage test' }]
            })
        };
        runScript('restore_model_openai.js', oaiStreamOptsVars);
        const restoredOaiStreamBody = JSON.parse(oaiStreamOptsVars['request.content']);
        assertEqual(restoredOaiStreamBody.stream_options.include_usage, true);
    });

    test('ROUTE-06: Claude Code Complex Payload Support & /v1/models Persona Catalog Filtering', () => {
        const oasClaudeXml = fs.readFileSync(path.join(BUNDLE_DIR, 'policies/OAS-VerifyClaude.xml'), 'utf8');
        const oasClaudeSpec = fs.readFileSync(path.join(BUNDLE_DIR, 'resources/oas/claude.yaml'), 'utf8');
        assert(oasClaudeXml.includes('<Header>true</Header>') && oasClaudeXml.includes('<Query>false</Query>'));
        assert(oasClaudeSpec.includes('name: beta') && oasClaudeSpec.includes('additionalProperties: true') && oasClaudeSpec.includes('tool_use_id:') && oasClaudeSpec.includes('thinking:'));

        const claudeCodeVars = {
            'request.header.host': 'ai-gw.example.com',
            'request.content': JSON.stringify({
                model: 'claude-haiku-4-5',
                max_tokens: 4096,
                thinking: { type: 'enabled', budget_tokens: 1024 },
                system: [{ type: 'text', text: 'You are Claude Code.', cache_control: { type: 'ephemeral' } }],
                tools: [{ name: 'bash', description: 'Run command', input_schema: { type: 'object' } }],
                messages: [
                    { role: 'user', content: [{ type: 'text', text: 'List files in src/' }] },
                    {
                        role: 'assistant',
                        content: [
                            { type: 'thinking', thinking: 'Running ls src/', signature: 'sig_123' },
                            { type: 'tool_use', id: 'toolu_01', name: 'bash', input: { command: 'ls src/' } }
                        ]
                    },
                    {
                        role: 'user',
                        content: [{ type: 'tool_result', tool_use_id: 'toolu_01', content: 'index.ts\nutils.ts' }]
                    }
                ]
            })
        };
        runScript('extract_prompt.js', claudeCodeVars);
        assert(claudeCodeVars['extracted_prompt'].includes('You are Claude Code.'));
        assert(claudeCodeVars['extracted_prompt'].includes('List files in src/'));
        assert(claudeCodeVars['extracted_prompt'].includes('index.ts'));

        // /v1/models catalog filtering by Persona allowlist vs Exception allowlist
        const personaBaseProps = {
            'propertyset.model_locations.models.catalog': 'gemini-3.5-flash,gemini-3.1-pro-preview,gemini-3.1-flash-lite,claude-sonnet-4-6,claude-haiku-4-5,text-embedding-005'
        };
        const kwModelsVars = Object.assign({}, personaBaseProps, {
            'proxy.pathsuffix': '',
            'accesstoken.user_id': 'bob@company.com',
            'accesstoken.persona': 'knowledge-worker',
            'propertyset.config.persona.knowledge-worker.models': 'gemini-3.1-flash-lite,gemini-3.5-flash'
        });
        runScript('models_endpoint.js', kwModelsVars);
        const kwModelsList = JSON.parse(kwModelsVars['response.content']).data.map(m => m.id);
        assertEqual(kwModelsList.length, 2);
        assert(!kwModelsList.includes('claude-sonnet-4-6'));

        const aliceModelsVars = Object.assign({}, kwModelsVars, {
            'accesstoken.user_id': 'alice@company.com',
            'propertyset.config.model_armor_identity_rules_count': '1',
            'propertyset.config.model_armor.rule.0.match': 'alice@company.com',
            'propertyset.config.model_armor.rule.0.models': '*'
        });
        runScript('models_endpoint.js', aliceModelsVars);
        const aliceModelsList = JSON.parse(aliceModelsVars['response.content']).data.map(m => m.id);
        assert(aliceModelsList.includes('claude-sonnet-4-6') && aliceModelsList.length >= 5);
    });

    test('ROUTE-07: Multi-Model Fallback Chains & Rolling-Window Circuit Breaker (CLOSED Failover + OPEN PreFlow Promotion)', () => {
        const cbBaseProps = {
            'propertyset.config.project_id': 'my-gcp-project',
            'propertyset.config.cb_error_threshold': '3',
            'propertyset.config.cb_window_interval': '1',
            'propertyset.config.cb_window_unit': 'minute',
            'propertyset.model_locations.default.model': 'gemini-2.5-flash',
            'propertyset.model_locations.default.fallback': 'gemini-2.5-flash-lite',
            'propertyset.model_locations.default.publisher': 'google',
            'propertyset.model_locations.default.target': 'gemini',
            'propertyset.model_locations.default.format': 'gemini',
            'propertyset.model_locations.gemini-2.5-flash.publisher': 'google',
            'propertyset.model_locations.gemini-2.5-flash.target': 'gemini',
            'propertyset.model_locations.gemini-2.5-flash.format': 'gemini',
            'propertyset.model_locations.gemini-2.5-flash.endpoint': 'global',
            'propertyset.model_locations.gemini-2.5-flash.model': 'global',
            'propertyset.model_locations.my-vllm-model.publisher': 'custom',
            'propertyset.model_locations.my-vllm-model.target': 'openai-custom',
            'propertyset.model_locations.my-vllm-model.format': 'openai',
            'propertyset.model_locations.my-vllm-model.url': 'https://mock-llm.example.com/mock/v1/chat/completions',
            'propertyset.model_locations.my-vllm-model.auth_type': 'bearer',
            'propertyset.model_locations.my-vllm-model.auth_token': 'vllm-secret-token'
        };

        // 1. Circuit Breaker CLOSED + PostFlow Failover
        const cbClosedVars = Object.assign({}, cbBaseProps, {
            'request_format': 'openai',
            'model': 'my-vllm-model',
            'request.content': JSON.stringify({
                model: 'my-vllm-model',
                models: ['my-vllm-model', 'gemini-2.5-flash'],
                messages: [{ role: 'user', content: 'Reply with FALLBACK_OK' }],
                max_tokens: 64
            })
        });
        runScript('resolve_model_location.js', cbClosedVars);
        assertEqual(cbClosedVars['primary_model'], 'my-vllm-model');
        assertEqual(cbClosedVars['fallback_model'], 'gemini-2.5-flash');
        assertEqual(cbClosedVars['circuit_breaker_state'], 'CLOSED');
        assertEqual(cbClosedVars['fallback_triggered'], 'false');

        cbClosedVars['ratelimit.LTQ-CircuitBreakerCheck.allowed.count'] = '3';
        cbClosedVars['ratelimit.LTQ-CircuitBreakerCheck.used.count'] = '1';
        cbClosedVars['ratelimit.LTQ-CircuitBreakerCheck.failed'] = false;
        runScript('resolve_model_location.js', cbClosedVars);
        assertEqual(cbClosedVars['primary_model'], 'my-vllm-model');
        assertEqual(cbClosedVars['circuit_breaker_state'], 'CLOSED');

        cbClosedVars['response.status.code'] = 429;
        runScript('prepare_fallback_request.js', cbClosedVars);
        assertEqual(cbClosedVars['fallback_ready'], 'true');
        assertEqual(cbClosedVars['fallback_use_google_iam'], 'true');
        assertEqual(cbClosedVars['fallback_format'], 'gemini');

        cbClosedVars['fallbackResponse.status.code'] = 200;
        cbClosedVars['fallbackResponse.content'] = JSON.stringify({
            candidates: [{ content: { role: 'model', parts: [{ text: 'FALLBACK_OK' }] }, finishReason: 'STOP' }],
            usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 4, totalTokenCount: 16 }
        });
        runScript('apply_fallback_response.js', cbClosedVars);
        const recoveredOaiBody = JSON.parse(cbClosedVars['response.content']);
        assertEqual(cbClosedVars['fallback_succeeded'], 'true');
        assertEqual(cbClosedVars['response.status.code'], 200);
        assertEqual(cbClosedVars['model'], 'gemini-2.5-flash');
        assertEqual(recoveredOaiBody.choices[0].message.content, 'FALLBACK_OK');
        assertEqual(recoveredOaiBody.usage.total_tokens, 16);

        // 2. Circuit Breaker OPEN in PreFlow (Pass 2 promotes fallback_model -> primary_model before RouteRule)
        const cbOpenVars = Object.assign({}, cbBaseProps, {
            'request_format': 'openai',
            'model': 'my-vllm-model',
            'request.content': JSON.stringify({
                model: 'my-vllm-model',
                models: ['my-vllm-model', 'gemini-2.5-flash'],
                messages: [{ role: 'user', content: 'Zero latency circuit breaker test' }]
            })
        });
        runScript('resolve_model_location.js', cbOpenVars);
        cbOpenVars['ratelimit.LTQ-CircuitBreakerCheck.allowed.count'] = '3';
        cbOpenVars['ratelimit.LTQ-CircuitBreakerCheck.used.count'] = '3';
        cbOpenVars['ratelimit.LTQ-CircuitBreakerCheck.available.count'] = '0';
        runScript('resolve_model_location.js', cbOpenVars);
        assertEqual(cbOpenVars['circuit_breaker_state'], 'OPEN');
        assertEqual(cbOpenVars['fallback_triggered'], 'true');
        assertEqual(cbOpenVars['primary_model'], 'gemini-2.5-flash');
        assertEqual(cbOpenVars['model'], 'gemini-2.5-flash');
        assertEqual(cbOpenVars['route_target'], 'gemini');
        assertEqual(cbOpenVars['response.header.X-Gateway-Circuit-Breaker'], 'OPEN');
    });

    test('ROUTE-TRANSCODE-07: :streamGenerateContent without ?alt=sse JSON-Array PostFlow Accounting & Single-Model defaults.fallback Activation', () => {
        // 1. :streamGenerateContent WITHOUT ?alt=sse stays on non-SSE PostFlow (stream=false) and parses cumulative JSON array usage + response_partial
        const jsonArrGemVars = {
            'proxy.pathsuffix': '/v1/projects/my-gcp-project/locations/global/publishers/google/models/gemini-2.5-flash:streamGenerateContent',
            'request.content': JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: 'Stream as JSON array' }] }]
            })
        };
        runScript('extract_vars_gemini.js', jsonArrGemVars);
        assertEqual(jsonArrGemVars['stream'], false, ':streamGenerateContent without ?alt=sse returns application/json array and must keep stream=false so PostFlow runs');
        assertEqual(jsonArrGemVars['gemini_json_array_stream'], 'true');

        jsonArrGemVars['response.content'] = JSON.stringify([
            {
                candidates: [{ content: { role: 'model', parts: [{ thought: true, text: 'internal reasoning' }, { text: 'Hello ' }] } }],
                usageMetadata: { promptTokenCount: 15, candidatesTokenCount: 5, cachedContentTokenCount: 5, thoughtsTokenCount: 8 }
            },
            {
                candidates: [{ content: { role: 'model', parts: [{ text: 'World!' }] }, finishReason: 'STOP' }],
                usageMetadata: { promptTokenCount: 15, candidatesTokenCount: 12, cachedContentTokenCount: 5, thoughtsTokenCount: 8 }
            }
        ]);
        runScript('calculate_tokens_non_streaming.js', jsonArrGemVars);
        assertEqual(jsonArrGemVars['prompt_tokens'], '15');
        assertEqual(jsonArrGemVars['uncached_prompt_tokens'], '10');
        assertEqual(jsonArrGemVars['cache_read_tokens'], '5');
        assertEqual(jsonArrGemVars['thinking_tokens'], '8');
        assertEqual(jsonArrGemVars['completion_tokens'], '20');
        assertEqual(jsonArrGemVars['usage_total_tokens'], '35');
        assertEqual(jsonArrGemVars['response_partial'], 'Hello World!', 'response_partial must concatenate non-thought parts across JSON array chunks for Model Armor');

        // 2. :streamGenerateContent WITH ?alt=sse sets stream=true for EventFlow SSE
        const sseGemVars = {
            'proxy.pathsuffix': '/v1/projects/my-gcp-project/locations/global/publishers/google/models/gemini-2.5-flash:streamGenerateContent',
            'request.queryparam.alt': 'sse',
            'request.content': JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: 'Stream as SSE' }] }]
            })
        };
        runScript('extract_vars_gemini.js', sseGemVars);
        assertEqual(sseGemVars['stream'], true, ':streamGenerateContent with ?alt=sse must set stream=true for EventFlow');
        assertEqual(sseGemVars['gemini_json_array_stream'], undefined);

        // 3. Configured defaults.fallback activates automatically on standard single-model non-streaming requests (and respects allow_fallbacks=false & RBAC)
        const singleModelAutoFbBase = {
            'request_format': 'openai',
            'model': 'my-vllm-model',
            'propertyset.config.gcp_project_id': 'my-gcp-project',
            'propertyset.model_locations.default.model': 'gemini-3.5-flash',
            'propertyset.model_locations.default.fallback': 'gemini-2.5-flash',
            'propertyset.model_locations.my-vllm-model.publisher': 'custom',
            'propertyset.model_locations.my-vllm-model.format': 'openai',
            'propertyset.model_locations.my-vllm-model.url': 'https://vllm.example.com/v1/chat/completions',
            'request.content': JSON.stringify({
                model: 'my-vllm-model',
                messages: [{ role: 'user', content: 'Standard single-model request' }]
            })
        };
        const singleModelAutoFb = Object.assign({}, singleModelAutoFbBase);
        runScript('resolve_model_location.js', singleModelAutoFb);
        assertEqual(singleModelAutoFb['primary_model'], 'my-vllm-model');
        assertEqual(singleModelAutoFb['fallback_model'], 'gemini-2.5-flash', 'Configured defaults.fallback must populate fallback_model on single-model requests');
        assertEqual(singleModelAutoFb['allow_fallbacks'], 'true');

        // Verify Persona allowed_models RBAC clears unauthorized default fallback
        const rbacRestrictedAutoFb = Object.assign({}, singleModelAutoFbBase, {
            'accesstoken.persona': 'restricted-dev',
            'propertyset.config.persona.restricted-dev.models': 'my-vllm-model'
        });
        runScript('resolve_model_location.js', rbacRestrictedAutoFb);
        assertEqual(rbacRestrictedAutoFb['model_access_denied'], 'false');
        assertEqual(rbacRestrictedAutoFb['fallback_model'], '', 'Persona RBAC must strip unauthorized defaults.fallback');
        assertEqual(rbacRestrictedAutoFb['allow_fallbacks'], 'false');
        assertEqual(rbacRestrictedAutoFb['resolved_candidates_json'], undefined);

        // Verify provider.allow_fallbacks = false disables defaults.fallback
        const optOutAutoFb = Object.assign({}, singleModelAutoFbBase, {
            'request.content': JSON.stringify({
                model: 'my-vllm-model',
                provider: { allow_fallbacks: false },
                messages: [{ role: 'user', content: 'Opt out of fallback' }]
            })
        });
        runScript('resolve_model_location.js', optOutAutoFb);
        assertEqual(optOutAutoFb['fallback_model'], '');
        assertEqual(optOutAutoFb['allow_fallbacks'], 'false');
    });

    test('ROUTE-TRANSCODE-08: Cross-Provider Multi-Turn Tool Calling, Multimodal Images/PDFs, $defs/$ref Inlining & o1/o3 Reasoning Models', () => {
        // 1. Anthropic -> Gemini: tool_result functionResponse.name resolution, document/image multimodal, $defs/$ref inlining, tool_choice & thinkingConfig
        const claudeToGemVars = {
            'primary_model': 'gemini-2.5-flash',
            'model': 'gemini-2.5-flash',
            'propertyset.config.project_id': 'my-gcp-project',
            'request.content': JSON.stringify({
                model: 'gemini-2.5-flash',
                max_tokens: 4096,
                temperature: 1.0,
                thinking: { type: 'enabled', budget_tokens: 2048 },
                tool_choice: { type: 'tool', name: 'query_db' },
                tools: [{
                    name: 'query_db',
                    description: 'Run structured query',
                    input_schema: {
                        $schema: 'https://json-schema.org/draft/2020-12/schema',
                        type: 'object',
                        $defs: {
                            FilterSpec: {
                                type: 'object',
                                properties: {
                                    op: { const: 'eq' },
                                    val: { type: ['string', 'null'] },
                                    nested: { $ref: '#/$defs/FilterSpec' }
                                },
                                additionalProperties: false
                            }
                        },
                        properties: {
                            filter: { $ref: '#/$defs/FilterSpec', description: 'Primary filter' }
                        }
                    }
                }],
                messages: [
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: 'Inspect PDF and image' },
                            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERi0xLjQ=' } },
                            { type: 'image', source: { type: 'url', url: 'https://storage.googleapis.com/bucket/chart.png' } }
                        ]
                    },
                    {
                        role: 'assistant',
                        content: [
                            { type: 'thinking', thinking: 'I should query_db first', signature: 'sig_prev' },
                            { type: 'tool_use', id: 'toolu_abc999', name: 'query_db', input: { filter: { op: 'eq', val: 'ok' } } }
                        ]
                    },
                    {
                        role: 'user',
                        content: [
                            { type: 'tool_result', tool_use_id: 'toolu_abc999', content: '{"rows":42}' }
                        ]
                    }
                ]
            })
        };
        runScript('anthropic_to_gemini.js', claudeToGemVars);
        const gemReq = JSON.parse(claudeToGemVars['request.content']);
        assertEqual(claudeToGemVars['anthropic_thinking_requested'], 'true');
        assertEqual(gemReq.contents.length, 3);
        assertEqual(gemReq.contents[0].parts[1].inlineData.mimeType, 'application/pdf');
        assertEqual(gemReq.contents[0].parts[2].fileData.fileUri, 'https://storage.googleapis.com/bucket/chart.png');
        assertEqual(gemReq.contents[1].parts.length, 1, 'Historical Claude thinking block must be omitted while preserving tool_use');
        assertEqual(gemReq.contents[1].parts[0].functionCall.name, 'query_db');
        assertEqual(gemReq.contents[2].parts[0].functionResponse.name, 'query_db', 'functionResponse.name must resolve to function name (not tool_use_id)');
        assertEqual(gemReq.toolConfig.functionCallingConfig.mode, 'ANY');
        assertEqual(gemReq.toolConfig.functionCallingConfig.allowedFunctionNames[0], 'query_db');
        assertEqual(gemReq.generationConfig.thinkingConfig.includeThoughts, true);
        assertEqual(gemReq.generationConfig.thinkingConfig.thinkingBudget, 2048);

        const sanitizedParamsStr = JSON.stringify(gemReq.tools[0].functionDeclarations[0].parameters);
        assert(!sanitizedParamsStr.includes('"$ref"') && !sanitizedParamsStr.includes('"$defs"'), '$ref and $defs must be completely resolved/removed for Vertex Gemini');
        const inlinedFilter = gemReq.tools[0].functionDeclarations[0].parameters.properties.filter;
        assertEqual(inlinedFilter.type, 'object');
        assertEqual(inlinedFilter.description, 'Primary filter');
        assertEqual(inlinedFilter.properties.op.enum[0], 'eq');
        assertEqual(inlinedFilter.properties.val.nullable, true);

        // 2. OpenAI -> Anthropic: assistant tool_calls, parallel role="tool" merging, image_url data URI, tool_choice & native :rawPredict
        const oaiToClaudeVars = {
            'request_format': 'openai',
            'model': 'claude-haiku-4-5',
            'endpoint_host': 'us-east5-aiplatform.googleapis.com',
            'model_location': 'us-east5',
            'propertyset.config.project_id': 'my-gcp-project',
            'request.content': JSON.stringify({
                model: 'claude-haiku-4-5',
                max_completion_tokens: 512,
                tool_choice: 'required',
                tools: [{
                    type: 'function',
                    function: { name: 'get_stock', description: 'Stock lookup', parameters: { type: 'object', properties: { ticker: { type: 'string' } } } }
                }],
                messages: [
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: 'Compare tickers in screenshot' },
                            { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } }
                        ]
                    },
                    {
                        role: 'assistant',
                        content: null,
                        tool_calls: [
                            { id: 'call_1', type: 'function', function: { name: 'get_stock', arguments: '{"ticker":"GOOG"}' } },
                            { id: 'call_2', type: 'function', function: { name: 'get_stock', arguments: '{"ticker":"ANTH"}' } }
                        ]
                    },
                    { role: 'tool', tool_call_id: 'call_1', content: 'GOOG=200' },
                    { role: 'tool', tool_call_id: 'call_2', content: 'ANTH=150' }
                ]
            })
        };
        runScript('inject_anthropic_version.js', oaiToClaudeVars);
        const claudeTransReq = JSON.parse(oaiToClaudeVars['request.content']);
        assert(oaiToClaudeVars['target.url'].endsWith('/publishers/anthropic/models/claude-haiku-4-5:rawPredict'));
        assertEqual(claudeTransReq.tool_choice.type, 'any');
        assertEqual(claudeTransReq.messages.length, 3, 'Consecutive OpenAI role="tool" messages must merge into a single Anthropic user message');
        assertEqual(claudeTransReq.messages[0].content[1].type, 'image');
        assertEqual(claudeTransReq.messages[0].content[1].source.media_type, 'image/png');
        assertEqual(claudeTransReq.messages[1].content.length, 2);
        assertEqual(claudeTransReq.messages[1].content[0].type, 'tool_use');
        assertEqual(claudeTransReq.messages[1].content[0].input.ticker, 'GOOG');
        assertEqual(claudeTransReq.messages[2].role, 'user');
        assertEqual(claudeTransReq.messages[2].content.length, 2);
        assertEqual(claudeTransReq.messages[2].content[0].type, 'tool_result');
        assertEqual(claudeTransReq.messages[2].content[1].tool_use_id, 'call_2');

        // Verify native Claude non-streaming also rewrites target.url to :rawPredict
        const nativeClaudeNonStreamVars = {
            'request_format': 'claude',
            'model': 'claude-haiku-4-5',
            'endpoint_host': 'us-east5-aiplatform.googleapis.com',
            'model_location': 'us-east5',
            'propertyset.config.project_id': 'my-gcp-project',
            'request.content': JSON.stringify({
                model: 'claude-haiku-4-5',
                max_tokens: 64,
                messages: [{ role: 'user', content: 'Hello native non-streaming' }]
            })
        };
        runScript('inject_anthropic_version.js', nativeClaudeNonStreamVars);
        assertEqual(
            nativeClaudeNonStreamVars['target.url'],
            'https://us-east5-aiplatform.googleapis.com/v1/projects/my-gcp-project/locations/us-east5/publishers/anthropic/models/claude-haiku-4-5:rawPredict'
        );

        // 3. Claude -> OpenAI reasoning model (o3-mini): multimodal image/PDF + tool_choice + max_completion_tokens & temperature stripping
        const claudeToO3Vars = {
            'request_format': 'claude',
            'model': 'o3-mini',
            'model_publisher': 'openai',
            'model_custom_url': 'https://api.openai.com/v1/chat/completions',
            'request.content': JSON.stringify({
                model: 'o3-mini',
                max_tokens: 1024,
                temperature: 0.2,
                top_p: 0.9,
                tool_choice: { type: 'tool', name: 'lookup' },
                tools: [{ name: 'lookup', description: 'Lookup', input_schema: { type: 'object', properties: { q: { type: 'string' } } } }],
                messages: [{
                    role: 'user',
                    content: [
                        { type: 'text', text: 'Analyze image' },
                        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } }
                    ]
                }]
            })
        };
        runScript('restore_model_openai.js', claudeToO3Vars);
        const o3Body = JSON.parse(claudeToO3Vars['request.content']);
        assertEqual(o3Body.model, 'o3-mini');
        assertEqual(o3Body.max_completion_tokens, 1024, 'o3-mini must receive max_completion_tokens instead of max_tokens');
        assertEqual(o3Body.max_tokens, undefined);
        assertEqual(o3Body.temperature, undefined, 'o3-mini must strip non-1.0 temperature');
        assertEqual(o3Body.top_p, undefined);
        assertEqual(o3Body.tool_choice.function.name, 'lookup');
        assertEqual(o3Body.messages[0].content[1].type, 'image_url');
        assert(o3Body.messages[0].content[1].image_url.url.startsWith('data:image/png;base64,'));
    });

    test('ROUTE-TRANSCODE-09: Gemini Thought Block Isolation Across Non-Streaming, Fallback & Multi-Part Streaming SSE', () => {
        // 1. Non-streaming Gemini -> Claude/OpenAI strips thought:true by default while preserving text + functionCall
        const gemThoughtRespVars = {
            'request_format': 'claude',
            'model': 'gemini-2.5-flash',
            'response.content': JSON.stringify({
                candidates: [{
                    content: {
                        role: 'model',
                        parts: [
                            { thought: true, text: 'INTERNAL_SECRET_REASONING' },
                            { text: 'Checking weather now.' },
                            { functionCall: { name: 'get_weather', args: { city: 'NYC' } }, thoughtSignature: 'sig_xyz' }
                        ]
                    },
                    finishReason: 'STOP'
                }],
                usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 6, thoughtsTokenCount: 10 }
            })
        };
        runScript('gemini_to_anthropic_resp.js', gemThoughtRespVars);
        assert(!gemThoughtRespVars['response.content'].includes('INTERNAL_SECRET_REASONING'), 'Gemini thought:true must never leak into default Anthropic text blocks');
        assert(!gemThoughtRespVars['response_partial'].includes('INTERNAL_SECRET_REASONING'), 'Gemini thought:true must never enter response_partial');
        assertEqual(gemThoughtRespVars['response_partial'], 'Checking weather now. get_weather: {"city":"NYC"}');
        const parsedAnthResp = JSON.parse(gemThoughtRespVars['response.content']);
        assertEqual(parsedAnthResp.content.length, 2);
        assertEqual(parsedAnthResp.content[0].type, 'text');
        assertEqual(parsedAnthResp.content[1].type, 'tool_use');
        assertEqual(parsedAnthResp.stop_reason, 'tool_use');

        // 2. When anthropic_thinking_requested=true on Claude, thought:true maps to native type:"thinking" block (and still stays out of response_partial)
        const explicitThinkingVars = {
            'request_format': 'claude',
            'anthropic_thinking_requested': 'true',
            'model': 'gemini-2.5-flash',
            'response.content': JSON.stringify({
                candidates: [{
                    content: {
                        role: 'model',
                        parts: [
                            { thought: true, text: 'Explicitly requested reasoning', thoughtSignature: 'sig_gem_1' },
                            { text: '42' }
                        ]
                    },
                    finishReason: 'STOP'
                }],
                usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2, thoughtsTokenCount: 4 }
            })
        };
        runScript('gemini_to_anthropic_resp.js', explicitThinkingVars);
        const explicitThinkingResp = JSON.parse(explicitThinkingVars['response.content']);
        assertEqual(explicitThinkingResp.content[0].type, 'thinking');
        assertEqual(explicitThinkingResp.content[0].thinking, 'Explicitly requested reasoning');
        assertEqual(explicitThinkingResp.content[1].type, 'text');
        assertEqual(explicitThinkingResp.content[1].text, '42');
        assertEqual(explicitThinkingVars['response_partial'], '42');

        // 3. Fallback apply_fallback_response strips Gemini thought:true parts
        const fbThoughtVars = {
            'request_format': 'openai',
            'fallback_model': 'gemini-2.5-flash',
            'fallback_format': 'gemini',
            'fallback_publisher': 'google',
            'fallbackResponse.status.code': 200,
            'fallbackResponse.content': JSON.stringify({
                candidates: [{
                    content: { parts: [{ thought: true, text: 'FALLBACK_INTERNAL_THOUGHT' }, { text: 'Fallback visible reply' }] }
                }],
                usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 3, thoughtsTokenCount: 5 }
            })
        };
        runScript('apply_fallback_response.js', fbThoughtVars);
        assert(!fbThoughtVars['response.content'].includes('FALLBACK_INTERNAL_THOUGHT'));
        assert(fbThoughtVars['response.content'].includes('Fallback visible reply'));

        // 4. Streaming combine_resp.js: Gemini -> Claude SSE strips thought:true, emits multi-part text + functionCall at parts[1], and persists stop_reason="tool_use"
        const sseGemToClaudeState = {
            'request_format': 'claude',
            'route_target': 'gemini',
            'route_format': 'gemini',
            'model': 'gemini-2.5-flash',
            'response.event.current.count': 1,
            'response.event.current.content': 'data: ' + JSON.stringify({
                candidates: [{ content: { role: 'model', parts: [{ thought: true, text: 'STREAM_SECRET_THOUGHT' }] } }]
            })
        };
        runScript('combine_resp.js', sseGemToClaudeState);
        assert(!sseGemToClaudeState['response.event.current.content'].includes('STREAM_SECRET_THOUGHT'), 'Streaming Gemini thought chunk must never leak as text_delta');
        assertEqual(sseGemToClaudeState['tmp_buffer_pre'], '');

        sseGemToClaudeState['response.event.current.count'] = 2;
        sseGemToClaudeState['response.event.current.content'] = 'data: ' + JSON.stringify({
            candidates: [{
                content: {
                    role: 'model',
                    parts: [
                        { text: 'Let me check Tokyo weather. ' },
                        { functionCall: { name: 'get_weather', args: { city: 'Tokyo' } } }
                    ]
                }
            }]
        });
        runScript('combine_resp.js', sseGemToClaudeState);
        assert(sseGemToClaudeState['response.event.current.content'].includes('Let me check Tokyo weather. '));
        assert(sseGemToClaudeState['response.event.current.content'].includes('"name":"get_weather"'), 'functionCall at parts[1] must be transcoded to tool_use SSE');
        assert(sseGemToClaudeState['response.event.current.content'].includes('\\"city\\":\\"Tokyo\\"'));

        sseGemToClaudeState['response.event.current.count'] = 3;
        sseGemToClaudeState['response.event.current.content'] = 'data: ' + JSON.stringify({
            candidates: [{ content: { role: 'model', parts: [] }, finishReason: 'STOP' }],
            usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 10, thoughtsTokenCount: 15 }
        });
        runScript('combine_resp.js', sseGemToClaudeState);
        assert(sseGemToClaudeState['response.event.current.content'].includes('"stop_reason":"tool_use"'), 'stop_reason must remain tool_use when tool call arrived in earlier SSE chunk');
        assertEqual(sseGemToClaudeState['usage_completion_tokens'], '25');

        // 5. Streaming combine_resp.js: Anthropic tool_use + input_json_delta -> OpenAI delta.tool_calls + finish_reason="tool_calls"
        const sseAnthToOaiState = {
            'request_format': 'openai',
            'route_target': 'claude',
            'route_format': 'anthropic',
            'model': 'claude-haiku-4-5',
            'response.event.current.count': 1,
            'response.event.current.content': 'event: content_block_start\ndata: ' + JSON.stringify({
                type: 'content_block_start',
                index: 0,
                content_block: { type: 'tool_use', id: 'toolu_stream_1', name: 'get_weather', input: {} }
            })
        };
        runScript('combine_resp.js', sseAnthToOaiState);
        assert(sseAnthToOaiState['response.event.current.content'].includes('"tool_calls"'));
        assert(sseAnthToOaiState['response.event.current.content'].includes('"name":"get_weather"'));

        sseAnthToOaiState['response.event.current.count'] = 2;
        sseAnthToOaiState['response.event.current.content'] = 'event: content_block_delta\ndata: ' + JSON.stringify({
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'input_json_delta', partial_json: '{"city":"London"}' }
        });
        runScript('combine_resp.js', sseAnthToOaiState);
        assert(sseAnthToOaiState['response.event.current.content'].includes('\\"city\\":\\"London\\"'));

        sseAnthToOaiState['response.event.current.count'] = 3;
        sseAnthToOaiState['response.event.current.content'] = 'event: message_delta\ndata: ' + JSON.stringify({
            type: 'message_delta',
            delta: { stop_reason: 'tool_use' },
            usage: { input_tokens: 14, output_tokens: 9 }
        });
        runScript('combine_resp.js', sseAnthToOaiState);
        assert(sseAnthToOaiState['response.event.current.content'].includes('"finish_reason":"tool_calls"'));
        assert(sseAnthToOaiState['response.event.current.content'].includes('data: [DONE]'));

        // 6. Regression guard: gemini-openai-compat (request_format="openai", route_target="gemini-openai-compat", route_format="gemini")
        //    already emits OpenAI SSE (choices) and MUST pass through untouched without blanking response.event.current.content!
        const rawGemOaiChunk = 'data: ' + JSON.stringify({
            id: 'chatcmpl-vertex-1',
            object: 'chat.completion.chunk',
            model: 'google/gemini-2.5-flash',
            choices: [{ index: 0, delta: { content: 'OK' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 9, completion_tokens: 2, total_tokens: 11 }
        });
        const sseGemOpenAiCompatState = {
            'request_format': 'openai',
            'route_target': 'gemini-openai-compat',
            'route_format': 'gemini',
            'model': 'gemini-2.5-flash',
            'response.event.current.count': 1,
            'response.event.current.content': rawGemOaiChunk
        };
        runScript('combine_resp.js', sseGemOpenAiCompatState);
        assertEqual(sseGemOpenAiCompatState['response.event.current.content'], rawGemOaiChunk, 'gemini-openai-compat OpenAI SSE chunks must pass through untouched');
        assertEqual(sseGemOpenAiCompatState['usage_total_tokens'], '11');
    });

    test('ROUTE-TRANSCODE-10: Judge Task Routing (creative_writing, extraction), gcp_project_id Fallback & Model Armor Regional Normalization', () => {
        // 1. prepare_judge_request includes creative_writing & extraction and populates gcp_project_id from organization.name when project_id is placeholder
        const judgePrepVars = {
            'model': 'auto:judge',
            'organization.name': 'my-gcp-project',
            'propertyset.config.project_id': 'your-gcp-project-id',
            'request.content': JSON.stringify({
                model: 'auto:judge',
                messages: [{ role: 'user', content: 'Write an original villanelle poem about distributed systems.' }]
            })
        };
        runScript('prepare_judge_request.js', judgePrepVars);
        assertEqual(judgePrepVars['trigger_judge'], 'true');
        assertEqual(judgePrepVars['gcp_project_id'], 'my-gcp-project');
        assert(judgePrepVars['judge_request_payload'].includes('creative_writing'), 'Judge prompt must include creative_writing');
        assert(judgePrepVars['judge_request_payload'].includes('extraction'), 'Judge prompt must include extraction');

        // 2. Judge recommended_tier takes priority over task.* when tier.<costTier> is configured,
        //    and falls back to task.<judge_task> when tier.<costTier> is unconfigured
        const lowCodingVars = {
            'model': 'auto:judge',
            'requested_model': 'auto:judge',
            'organization.name': 'my-gcp-project',
            'propertyset.model_locations.models.catalog': 'gemini-3.1-flash-lite,gemini-3.5-flash,gemini-3.1-pro-preview,claude-sonnet-4-6',
            'propertyset.model_locations.tier.low': 'gemini-3.1-flash-lite',
            'propertyset.model_locations.tier.medium': 'gemini-3.5-flash',
            'propertyset.model_locations.tier.high': 'gemini-3.1-pro-preview',
            'propertyset.model_locations.tier.max': 'claude-sonnet-4-6',
            'propertyset.model_locations.task.coding': 'gemini-3.1-pro-preview',
            'propertyset.model_locations.task.summarization': 'gemini-3.1-flash-lite',
            'llmJudgeResponse.content': JSON.stringify({
                candidates: [{
                    content: {
                        parts: [{
                            text: JSON.stringify({
                                task: 'coding',
                                complexity: 2,
                                recommended_tier: 'low',
                                confidence: 0.98,
                                reasoning: 'Trivial one-liner syntax check'
                            })
                        }]
                    }
                }]
            }),
            'request.content': JSON.stringify({
                model: 'auto:judge',
                messages: [{ role: 'user', content: 'What does len("abc") return in Python?' }]
            })
        };
        runScript('process_judge_response.js', lowCodingVars);
        runScript('resolve_model_location.js', lowCodingVars);
        assertEqual(lowCodingVars['judge_tier'], 'low');
        assertEqual(lowCodingVars['cost_tier'], 'low');
        assertEqual(lowCodingVars['model'], 'gemini-3.1-flash-lite', 'Trivial coding prompt with judge_tier=low must route to tier.low, not task.coding');

        // Fallback to task.<judge_task> when tier.<costTier> (tier.max) is omitted, plus model_armor_location=global -> us-central1
        const cwVars = {
            'model': 'auto:judge',
            'requested_model': 'auto:judge',
            'organization.name': 'my-gcp-project',
            'propertyset.config.project_id': 'your-gcp-project-id',
            'propertyset.config.model_armor_location': 'global',
            'propertyset.model_locations.models.catalog': 'gemini-3.1-flash-lite,gemini-3.5-flash,claude-sonnet-4-6',
            'propertyset.model_locations.task.creative_writing': 'claude-sonnet-4-6',
            'propertyset.model_locations.task.extraction': 'gemini-3.1-flash-lite',
            'propertyset.model_locations.tier.medium': 'gemini-3.5-flash',
            'propertyset.model_locations.claude-sonnet-4-6.publisher': 'anthropic',
            'propertyset.model_locations.claude-sonnet-4-6.target': 'claude',
            'propertyset.model_locations.claude-sonnet-4-6.format': 'anthropic',
            'propertyset.model_locations.claude-sonnet-4-6.endpoint': 'us-east5',
            'llmJudgeResponse.content': JSON.stringify({
                candidates: [{
                    content: {
                        parts: [{
                            text: JSON.stringify({
                                task: 'creative_writing',
                                complexity: 9,
                                recommended_tier: 'max',
                                confidence: 0.96,
                                reasoning: 'Complex strict-meter villanelle generation'
                            })
                        }]
                    }
                }]
            }),
            'request.content': JSON.stringify({
                model: 'auto:judge',
                messages: [{ role: 'user', content: 'Write an original villanelle poem about distributed systems.' }]
            })
        };
        runScript('process_judge_response.js', cwVars);
        runScript('resolve_model_location.js', cwVars);
        assertEqual(cwVars['judge_task'], 'creative_writing');
        assertEqual(cwVars['model'], 'claude-sonnet-4-6');
        assertEqual(cwVars['gcp_project_id'], 'my-gcp-project');
        assertEqual(cwVars['model_armor_request_location'], 'us-central1');
        assertEqual(cwVars['model_armor_response_location'], 'us-central1');

        // 3. Direct auto:extraction task shorthand routes to task.extraction ahead of tier.medium
        const extVars = {
            'model': 'auto:extraction',
            'organization.name': 'my-gcp-project',
            'propertyset.model_locations.models.catalog': 'gemini-3.1-flash-lite,gemini-3.5-flash,claude-sonnet-4-6',
            'propertyset.model_locations.task.extraction': 'gemini-3.1-flash-lite',
            'propertyset.model_locations.tier.medium': 'gemini-3.5-flash',
            'request.content': JSON.stringify({
                model: 'auto:extraction',
                messages: [{ role: 'user', content: 'Extract invoice_id and total_usd as JSON.' }]
            })
        };
        runScript('resolve_model_location.js', extVars);
        assertEqual(extVars['model'], 'gemini-3.1-flash-lite');
        assertEqual(extVars['requested_model'], 'auto:extraction');
    });

    test('ROUTE-TRANSCODE-11: Gemini Tool Parameter Preservation (title/default), OpenAI Tool-Before-User Ordering & SSE Payload Cleanup', () => {
        // 1. sanitizeGeminiSchemaNode preserves user tool parameters named title, default, examples, strict, definitions, type, const
        //    while stripping schema meta-keywords inside each parameter schema, merging allOf, and only setting nullable when "null" is present
        const geminiToolSchemaVars = {
            'model': 'gemini-2.5-flash',
            'endpoint_host': 'aiplatform.googleapis.com',
            'model_location': 'global',
            'propertyset.config.project_id': 'my-gcp-project',
            'request.content': JSON.stringify({
                model: 'gemini-2.5-flash',
                max_tokens: 256,
                tools: [{
                    name: 'create_issue',
                    description: 'Create issue ticket',
                    input_schema: {
                        $schema: 'https://json-schema.org/draft/2020-12/schema',
                        title: 'CreateIssueParams',
                        type: 'object',
                        additionalProperties: false,
                        $defs: {
                            MetaFields: {
                                type: 'object',
                                properties: {
                                    priority: { type: ['string', 'integer'] },
                                    assignee: { type: ['string', 'null'], default: null }
                                },
                                required: ['priority']
                            }
                        },
                        allOf: [{ $ref: '#/$defs/MetaFields' }],
                        properties: {
                            title: { type: 'string', title: 'Ticket Title', description: 'Short summary' },
                            default: { type: 'boolean', default: false, description: 'Is default template' },
                            examples: { type: 'array', items: { type: 'string' } },
                            strict: { type: 'boolean' },
                            type: { type: 'string', enum: ['bug', 'feature'] }
                        },
                        required: ['title', 'default', 'priority', 'non_existent_ghost_field']
                    }
                }],
                messages: [{ role: 'user', content: 'Open a bug ticket titled Login timeout' }]
            })
        };
        runScript('anthropic_to_gemini.js', geminiToolSchemaVars);
        const gemReq = JSON.parse(geminiToolSchemaVars['request.content']);
        const params = gemReq.tools[0].functionDeclarations[0].parameters;
        assertEqual(params.title, undefined, 'Schema-level title meta-keyword must be stripped');
        assertEqual(params.additionalProperties, undefined, 'Schema-level additionalProperties must be stripped');
        assert(params.properties.title !== undefined, 'Tool argument named "title" MUST be preserved in properties');
        assertEqual(params.properties.title.type, 'string');
        assertEqual(params.properties.title.title, undefined, 'Meta-keyword title inside parameter schema must be stripped');
        assert(params.properties.default !== undefined, 'Tool argument named "default" MUST be preserved in properties');
        assertEqual(params.properties.default.default, undefined, 'Meta-keyword default inside parameter schema must be stripped');
        assert(params.properties.examples !== undefined, 'Tool argument named "examples" MUST be preserved');
        assert(params.properties.strict !== undefined, 'Tool argument named "strict" MUST be preserved');
        assert(params.properties.type !== undefined, 'Tool argument named "type" MUST be preserved');
        assert(params.properties.priority !== undefined, 'allOf $ref properties must merge into object properties');
        assertEqual(params.properties.priority.nullable, undefined, 'type:["string","integer"] without "null" must NOT set nullable:true');
        assertEqual(params.properties.assignee.nullable, true, 'type:["string","null"] MUST set nullable:true');
        assert(params.required.includes('title') && params.required.includes('default') && params.required.includes('priority'));
        assert(!params.required.includes('non_existent_ghost_field'), 'Dangling required entries absent from properties must be pruned');

        // 2. Anthropic -> OpenAI: user turn with both tool_result and follow-up text emits role:"tool" BEFORE role:"user"
        const anthMixedToolTurnVars = {
            'request_format': 'claude',
            'model': 'gpt-4o-mini',
            'model_publisher': 'openai',
            'model_custom_url': 'https://api.openai.com/v1/chat/completions',
            'request.content': JSON.stringify({
                model: 'gpt-4o-mini',
                max_tokens: 128,
                messages: [
                    { role: 'user', content: 'Check NYC weather' },
                    {
                        role: 'assistant',
                        content: [{ type: 'tool_use', id: 'toolu_nyc_1', name: 'get_weather', input: { city: 'NYC' } }]
                    },
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: '<system-reminder>Be concise.</system-reminder>' },
                            { type: 'tool_result', tool_use_id: 'toolu_nyc_1', content: '72F sunny' },
                            { type: 'text', text: 'Should I wear a coat?' }
                        ]
                    }
                ]
            })
        };
        runScript('restore_model_openai.js', anthMixedToolTurnVars);
        const oaiMixedBody = JSON.parse(anthMixedToolTurnVars['request.content']);
        assertEqual(oaiMixedBody.messages.length, 4);
        assertEqual(oaiMixedBody.messages[1].role, 'assistant');
        assertEqual(oaiMixedBody.messages[2].role, 'tool', 'role:"tool" MUST immediately follow assistant tool_calls');
        assertEqual(oaiMixedBody.messages[2].tool_call_id, 'toolu_nyc_1');
        assertEqual(oaiMixedBody.messages[3].role, 'user', 'Follow-up user text MUST be emitted after role:"tool"');
        assert(oaiMixedBody.messages[3].content.includes('Should I wear a coat?'));

        // 3. Gemini -> OpenAI: user turn with functionResponse + text also emits role:"tool" BEFORE role:"user"
        const gemMixedToolTurnVars = {
            'request_format': 'gemini',
            'model': 'gpt-4o-mini',
            'model_publisher': 'openai',
            'model_custom_url': 'https://api.openai.com/v1/chat/completions',
            'request.content': JSON.stringify({
                contents: [
                    { role: 'user', parts: [{ text: 'Check Tokyo weather' }] },
                    { role: 'model', parts: [{ functionCall: { id: 'call_tok_1', name: 'get_weather', args: { city: 'Tokyo' } } }] },
                    {
                        role: 'user',
                        parts: [
                            { functionResponse: { id: 'call_tok_1', name: 'get_weather', response: { temp: '18C' } } },
                            { text: 'Summarize in 5 words.' }
                        ]
                    }
                ]
            })
        };
        runScript('restore_model_openai.js', gemMixedToolTurnVars);
        const gemOaiBody = JSON.parse(gemMixedToolTurnVars['request.content']);
        assertEqual(gemOaiBody.messages.length, 4);
        assertEqual(gemOaiBody.messages[1].role, 'assistant');
        assertEqual(gemOaiBody.messages[2].role, 'tool', 'Gemini functionResponse -> OpenAI role:"tool" MUST precede role:"user"');
        assertEqual(gemOaiBody.messages[2].tool_call_id, 'call_tok_1');
        assertEqual(gemOaiBody.messages[3].role, 'user');
        assertEqual(gemOaiBody.messages[3].content, 'Summarize in 5 words.');

        // 4. SSE Chunk 1 frees raw_client_payload immediately
        const sseCleanupVars = {
            'request_format': 'openai',
            'route_target': 'openai-custom',
            'route_format': 'openai',
            'raw_client_payload': '{"model":"auto","stream":true,"messages":[{"role":"user","content":"large payload"}]}',
            'response.event.current.count': 1,
            'response.event.current.content': 'data: {"id":"1","choices":[{"index":0,"delta":{"content":"Hi"}}]}\n\n'
        };
        runScript('combine_resp.js', sseCleanupVars);
        assertEqual(sseCleanupVars['raw_client_payload'], undefined, 'combine_resp.js Chunk 1 must free raw_client_payload');
    });

    test('ROUTE-TRANSCODE-12: Multi-Turn thoughtSignature, Streaming Thinking SSE, gpt-5* Reasoning, Embeddings Token Arrays, SAFETY/refusal & response_format', () => {
        // 1. Non-streaming Gemini -> Anthropic -> OpenAI preserves thought_signature on tool_use/tool_calls
        const gemToolSigVars = {
            'request_format': 'claude',
            'model': 'gemini-3-flash-preview',
            'response.content': JSON.stringify({
                candidates: [{
                    content: {
                        role: 'model',
                        parts: [
                            { functionCall: { name: 'lookup_sku', args: { sku: 'ABC-1' } }, thoughtSignature: 'sig_gem3_tool_99' }
                        ]
                    },
                    finishReason: 'STOP'
                }],
                usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 6 }
            })
        };
        runScript('gemini_to_anthropic_resp.js', gemToolSigVars);
        const anthToolSigResp = JSON.parse(gemToolSigVars['response.content']);
        assertEqual(anthToolSigResp.content.length, 1);
        assertEqual(anthToolSigResp.content[0].type, 'tool_use');
        assertEqual(anthToolSigResp.content[0].thought_signature, 'sig_gem3_tool_99');

        // Round-trip Turn 2: Anthropic/OpenAI -> Gemini restores thoughtSignature on thinking & functionCall parts
        const turn2ToGemVars = {
            'gcp_project_id': 'my-gcp-project',
            'primary_model': 'gemini-3-flash-preview',
            'request.content': JSON.stringify({
                model: 'gemini-3-flash-preview',
                max_tokens: 256,
                response_format: {
                    type: 'json_schema',
                    json_schema: {
                        name: 'sku_report',
                        schema: { type: 'object', properties: { in_stock: { type: 'boolean' } }, additionalProperties: false }
                    }
                },
                messages: [
                    { role: 'user', content: 'Check SKU ABC-1' },
                    {
                        role: 'assistant',
                        content: [
                            { type: 'thinking', thinking: 'Need inventory check', signature: 'gem_ts:sig_gem3_think_01' },
                            { type: 'tool_use', id: 'toolu_99', name: 'lookup_sku', input: { sku: 'ABC-1' }, thought_signature: 'sig_gem3_tool_99' }
                        ]
                    },
                    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_99', content: '{"in_stock":true}' }] }
                ]
            })
        };
        runScript('anthropic_to_gemini.js', turn2ToGemVars);
        const gemTurn2Body = JSON.parse(turn2ToGemVars['request.content']);
        assertEqual(gemTurn2Body.contents[1].parts[0].thought, true);
        assertEqual(gemTurn2Body.contents[1].parts[0].thoughtSignature, 'sig_gem3_think_01');
        assertEqual(gemTurn2Body.contents[1].parts[1].functionCall.name, 'lookup_sku');
        assertEqual(gemTurn2Body.contents[1].parts[1].thoughtSignature, 'sig_gem3_tool_99');
        assertEqual(gemTurn2Body.generationConfig.responseMimeType, 'application/json');
        assertEqual(gemTurn2Body.generationConfig.responseSchema.type, 'object');
        assertEqual(gemTurn2Body.generationConfig.responseSchema.additionalProperties, undefined);

        // 2. Streaming combine_resp.js: when anthropic_thinking_requested="true", emits thinking_delta + gem_ts: signature_delta (kept out of tmp_buffer_pre!)
        const sseThinkingState = {
            'request_format': 'claude',
            'anthropic_thinking_requested': 'true',
            'route_target': 'gemini',
            'route_format': 'gemini',
            'model': 'gemini-3-flash-preview',
            'response.event.current.count': 1,
            'response.event.current.content': 'data: ' + JSON.stringify({
                candidates: [{
                    content: {
                        role: 'model',
                        parts: [{ thought: true, text: 'Step-by-step reasoning...', thoughtSignature: 'sig_stream_t1' }]
                    }
                }]
            })
        };
        runScript('combine_resp.js', sseThinkingState);
        assert(sseThinkingState['response.event.current.content'].includes('"type":"thinking"'));
        assert(sseThinkingState['response.event.current.content'].includes('"type":"thinking_delta"'));
        assert(sseThinkingState['response.event.current.content'].includes('"signature":"gem_ts:sig_stream_t1"'));
        assertEqual(sseThinkingState['tmp_buffer_pre'], '', 'Thought text must still stay out of Model Armor buffer');

        sseThinkingState['response.event.current.count'] = 2;
        sseThinkingState['response.event.current.content'] = 'data: ' + JSON.stringify({
            candidates: [{ content: { role: 'model', parts: [{ text: 'Final answer: 42' }] }, finishReason: 'STOP' }],
            usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 4, thoughtsTokenCount: 9 }
        });
        runScript('combine_resp.js', sseThinkingState);
        assert(sseThinkingState['response.event.current.content'].includes('"text":"Final answer: 42"'));
        assert(sseThinkingState['response.event.current.content'].includes('"stop_reason":"end_turn"'));

        // 3. Streaming & Non-Streaming SAFETY / refusal / content_filter mapping
        const sseSafetyToClaude = {
            'request_format': 'claude',
            'route_target': 'gemini',
            'route_format': 'gemini',
            'model': 'gemini-2.5-flash',
            'response.event.current.count': 1,
            'response.event.current.content': 'data: ' + JSON.stringify({
                candidates: [{ content: { role: 'model', parts: [] }, finishReason: 'PROHIBITED_CONTENT' }],
                usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 0 }
            })
        };
        runScript('combine_resp.js', sseSafetyToClaude);
        assert(sseSafetyToClaude['response.event.current.content'].includes('"stop_reason":"refusal"'));

        const sseSafetyToOpenAi = {
            'request_format': 'openai',
            'route_target': 'gemini',
            'route_format': 'gemini',
            'model': 'gemini-2.5-flash',
            'response.event.current.count': 1,
            'response.event.current.content': 'data: ' + JSON.stringify({
                candidates: [{ content: { role: 'model', parts: [] }, finishReason: 'SAFETY' }],
                usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 0 }
            })
        };
        runScript('combine_resp.js', sseSafetyToOpenAi);
        assert(sseSafetyToOpenAi['response.event.current.content'].includes('"finish_reason":"content_filter"'));

        // 4. gpt-5.4 reasoning model normalization (primary & fallback) + /v1/embeddings token-ID array 400 rejection
        const gpt5Vars = {
            'gcp_project_id': 'my-gcp-project',
            'request_format': 'openai',
            'route_target': 'openai-custom',
            'model': 'gpt-5.4',
            'model_publisher': 'openai',
            'model_custom_url': 'https://api.openai.com/v1/chat/completions',
            'request.content': JSON.stringify({
                model: 'gpt-5.4',
                max_tokens: 768,
                temperature: 0.4,
                top_p: 0.8,
                messages: [{ role: 'user', content: 'Solve this' }]
            })
        };
        runScript('restore_model_openai.js', gpt5Vars);
        const gpt5Out = JSON.parse(gpt5Vars['request.content']);
        assertEqual(gpt5Out.max_completion_tokens, 768);
        assertEqual(gpt5Out.max_tokens, undefined);
        assertEqual(gpt5Out.temperature, undefined);
        assertEqual(gpt5Out.top_p, undefined);

        const badEmbedVars = {
            'gcp_project_id': 'my-gcp-project',
            'request_format': 'openai',
            'is_embeddings': 'true',
            'model': 'text-embedding-005',
            'model_publisher': 'google',
            'model_location': 'us-central1',
            'request.content': JSON.stringify({ model: 'text-embedding-005', input: [15339, 1917] })
        };
        runScript('restore_model_openai.js', badEmbedVars);
        assertEqual(badEmbedVars['callout_aborted'], 'true');
        assertEqual(badEmbedVars['auth_error_status'], '400');

        // 5. OpenAI response_format -> Anthropic system JSON constraint (without leaking top-level response_format)
        const oaiJsonToClaudeVars = {
            'gcp_project_id': 'my-gcp-project',
            'request_format': 'openai',
            'primary_model': 'claude-haiku-4-5',
            'request.content': JSON.stringify({
                model: 'claude-haiku-4-5',
                response_format: { type: 'json_object' },
                messages: [{ role: 'user', content: 'Return {"ok":true}' }]
            })
        };
        runScript('inject_anthropic_version.js', oaiJsonToClaudeVars);
        const claudeJsonOut = JSON.parse(oaiJsonToClaudeVars['request.content']);
        assertEqual(claudeJsonOut.response_format, undefined);
        assert(claudeJsonOut.system.includes('Respond strictly with a valid JSON object'));
    });

    test('ROUTE-TRANSCODE-13: TargetEndpoint Transport-Fault Circuit Breaker / Fallback Recovery & Safe $0.00 DataCapture Defaults', () => {
        // 1. Verify both DataCapture policies default perUnitPriceMultiplier to 0.0 and transactionSuccess to false
        for (const dcFile of ['DC-CaptureTokenCountsNonStreaming.xml', 'DC-CaptureTokenCountsStreaming.xml']) {
            const dcXml = fs.readFileSync(path.join(BUNDLE_DIR, 'policies', dcFile), 'utf8');
            assert(!dcXml.includes('default="1.0"'), `${dcFile} must never default perUnitPriceMultiplier to 1.0 ($1.00/call)`);
            assert(dcXml.includes('ref="perUnitPriceMultiplier"') && dcXml.includes('default="0.0"'), `${dcFile} must default perUnitPriceMultiplier to 0.0`);
            assert(dcXml.includes('ref="transactionSuccess"') && dcXml.includes('default="false"'), `${dcFile} must default transactionSuccess to false`);
        }

        // 2. Verify all 5 TargetEndpoints wire FaultRule name="transport-fallback" with LTQ-CircuitBreakerCount + SC-Fallback* + accounting
        const targetDir = path.join(BUNDLE_DIR, 'targets');
        for (const tFile of ['claude.xml', 'gemini-native-target.xml', 'gemini-openai-compat.xml', 'openai-custom.xml', 'gemini.xml']) {
            const tXml = fs.readFileSync(path.join(targetDir, tFile), 'utf8');
            assert(tXml.includes('name="transport-fallback"'), `TargetEndpoint ${tFile} must include FaultRule name="transport-fallback"`);
            assert(tXml.includes('GatewayTimeout') && tXml.includes('ConnectTimeout') && tXml.includes('UnexpectedEOFAtTarget'), `${tFile} transport-fallback must match timeout & connection faults`);
            assert(tXml.includes('<Name>LTQ-CircuitBreakerCount</Name>'), `${tFile} transport-fallback must increment LTQ-CircuitBreakerCount`);
            assert(tXml.includes('<Name>SC-FallbackGoogleIAM</Name>'), `${tFile} transport-fallback must include SC-FallbackGoogleIAM`);
        }

        // 3. Verify FlowState.ERROR transport fault recovery populates error.* + error.header.*
        const transportFbVars = {
            'fault.name': 'ConnectTimeout',
            'request_format': 'openai',
            'requested_model': 'auto',
            'fallback_model': 'gemini-2.5-flash',
            'allow_fallbacks': 'true',
            'identity_persona': 'developer',
            'organization.name': 'my-gcp-project',
            'client.received.start.timestamp': '1700000000000',
            'system.timestamp': '1700000005000',
            'raw_client_payload': JSON.stringify({
                model: 'my-dead-vllm',
                messages: [{ role: 'user', content: 'Recover from ConnectTimeout' }]
            }),
            'fallbackResponse.status.code': 200,
            'fallbackResponse.content': JSON.stringify({
                candidates: [{ content: { role: 'model', parts: [{ text: 'Recovered 200 OK' }] }, finishReason: 'STOP' }],
                usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 10, totalTokenCount: 30 }
            }),
            'propertyset.monetization_rates.gemini-2.5-flash.input_rate_per_m': '0.15',
            'propertyset.monetization_rates.gemini-2.5-flash.output_rate_per_m': '0.60'
        };
        assertEqual(runScript('prepare_fallback_request.js', transportFbVars), 'CONTINUE');
        assertEqual(transportFbVars['fallback_ready'], 'true');
        assertEqual(runScript('apply_fallback_response.js', transportFbVars), 'CONTINUE');
        assertEqual(transportFbVars['fallback_succeeded'], 'true');
        assertEqual(transportFbVars['fault_fallback_recovery'], 'true');
        assertEqual(transportFbVars['error.status.code'], 200);
        assertEqual(transportFbVars['error.header.X-Gateway-Fallback-Triggered'], 'true');
        assertEqual(transportFbVars['error.header.X-Gateway-Routed-Model'], 'gemini-2.5-flash');
        assert(JSON.parse(transportFbVars['error.content']).choices[0].message.content === 'Recovered 200 OK');

        assertEqual(runScript('calculate_tokens_non_streaming.js', transportFbVars), 'CONTINUE');
        assertEqual(runScript('calculate_monetization_cost.js', transportFbVars), 'CONTINUE');
        assertEqual(transportFbVars['error.header.X-Gateway-Total-Tokens'], '30');
        assertEqual(transportFbVars['error.header.X-Gateway-Total-Cost-USD'], '0.000009');

        // 4. Verify >=240s elapsed timeout budget skips ghost fallback calls
        const exhaustedBudgetVars = {
            'fallback_model': 'gemini-2.5-flash',
            'allow_fallbacks': 'true',
            'client.received.start.timestamp': '1700000000000',
            'system.timestamp': '1700000250000',
            'raw_client_payload': '{"model":"hang-model","messages":[{"role":"user","content":"Hi"}]}'
        };
        assertEqual(runScript('prepare_fallback_request.js', exhaustedBudgetVars), 'CONTINUE');
        assertEqual(exhaustedBudgetVars['fallback_ready'], 'false');

        // 5. Verify UnexpectedEOFAtTarget formats as 502 JSON when fallback is unavailable
        const eofErrVars = { 'fault.name': 'UnexpectedEOFAtTarget', 'error.content': '<fault>EOF</fault>' };
        assertEqual(runScript('inject_deidentified_finding.js', eofErrVars), 'CONTINUE');
        assertEqual(eofErrVars['auth_error_status'], '502');
    });

    test('ROUTE-TRANSCODE-14: SSE Partial TCP Carry-Over, Single-Newline Coalescing, Parallel OpenAI->Claude Tool Blocks & Split Usage Finalization', () => {
        // 1. Mid-JSON TCP split across 2 EventFlow reads reassembles cleanly without SyntaxError or dropped usage
        const fullGemJson = JSON.stringify({
            candidates: [{
                content: { role: 'model', parts: [{ functionCall: { name: 'lookup_sku', args: { sku: 'ABC-999' } } }] },
                finishReason: 'STOP'
            }],
            usageMetadata: { promptTokenCount: 45, candidatesTokenCount: 15 }
        });
        const splitPos = Math.floor(fullGemJson.length / 2);
        const splitVars = {
            'request_format': 'openai',
            'route_target': 'gemini',
            'route_format': 'gemini',
            'model': 'gemini-2.5-flash',
            'response.event.current.count': 1,
            'response.event.current.content': 'data: ' + fullGemJson.substring(0, splitPos)
        };
        runScript('combine_resp.js', splitVars);
        assertEqual(splitVars['response.event.current.content'], '', 'Half-JSON TCP read must hold in sse_partial_carry without corrupting wire');
        assert(Boolean(splitVars['sse_partial_carry']), 'sse_partial_carry must hold incomplete frame');

        splitVars['response.event.current.count'] = 2;
        splitVars['response.event.current.content'] = fullGemJson.substring(splitPos) + '\n\n';
        runScript('combine_resp.js', splitVars);
        assertEqual(splitVars['sse_partial_carry'], undefined, 'sse_partial_carry must clear once reassembled');
        assert(splitVars['response.event.current.content'].includes('"lookup_sku"'), 'Reassembled split frame must transcode tool call');
        assert(splitVars['response.event.current.content'].includes('data: [DONE]'));
        assertEqual(splitVars['usage_total_tokens'], '60');

        // 2. Single-newline coalesced vLLM frame (data: {...}\ndata: [DONE]\n) parses both events without SyntaxError
        const singleNlVars = {
            'request_format': 'openai',
            'route_target': 'openai-custom',
            'route_format': 'openai',
            'model': 'my-vllm-model',
            'response.event.current.count': 1,
            'response.event.current.content':
                'data: {"id":"1","choices":[{"index":0,"delta":{"content":"Coalesced OK"},"finish_reason":"stop"}],"usage":{"prompt_tokens":12,"completion_tokens":4,"total_tokens":16}}\n' +
                'data: [DONE]\n'
        };
        runScript('combine_resp.js', singleNlVars);
        assertEqual(singleNlVars['usage_total_tokens'], '16');
        assertEqual(singleNlVars['release_concurrency_slot'], 'true');

        // 3. OpenAI -> Claude concurrent parallel tool calls: closes text index 0 BEFORE tool 1, keeps tool 1 & tool 2 open concurrently for interleaved deltas, and closes both cleanly
        const parToolVars = {
            'request_format': 'claude',
            'route_target': 'openai-custom',
            'route_format': 'openai',
            'model': 'gpt-4o-mini',
            'response.event.current.count': 1,
            'response.event.current.content': 'data: ' + JSON.stringify({
                id: 'chatcmpl-par',
                choices: [{ index: 0, delta: { content: 'Checking both.' }, finish_reason: null }]
            }) + '\n\n'
        };
        runScript('combine_resp.js', parToolVars);
        const chunk1Out = parToolVars['response.event.current.content'];
        assert(chunk1Out.includes('"index":0,"content_block":{"type":"text"'));

        // Chunk 2 starts TWO parallel tool calls (index 0 and index 1)
        parToolVars['response.event.current.count'] = 2;
        parToolVars['response.event.current.content'] = 'data: ' + JSON.stringify({
            id: 'chatcmpl-par',
            choices: [{
                index: 0,
                delta: {
                    tool_calls: [
                        { index: 0, id: 'call_w', type: 'function', function: { name: 'get_weather', arguments: '' } },
                        { index: 1, id: 'call_s', type: 'function', function: { name: 'get_stock', arguments: '' } }
                    ]
                },
                finish_reason: null
            }]
        }) + '\n\n';
        runScript('combine_resp.js', parToolVars);
        const chunk2Out = parToolVars['response.event.current.content'];
        const stop0Pos = chunk2Out.indexOf('"type":"content_block_stop","index":0');
        const start1Pos = chunk2Out.indexOf('"type":"content_block_start","index":1');
        const start2Pos = chunk2Out.indexOf('"type":"content_block_start","index":2');
        assert(stop0Pos !== -1 && stop0Pos < start1Pos, 'Text block index 0 must close BEFORE tool block index 1 opens');
        assert(start1Pos !== -1 && start2Pos > start1Pos, 'Parallel tool blocks 1 and 2 must both open');
        assert(!chunk2Out.includes('"type":"content_block_stop","index":1'), 'Starting parallel tool 2 must NOT prematurely close tool 1');

        // Chunk 3 sends interleaved argument deltas for BOTH tool 0 (-> block 1) and tool 1 (-> block 2)
        parToolVars['response.event.current.count'] = 3;
        parToolVars['response.event.current.content'] = 'data: ' + JSON.stringify({
            id: 'chatcmpl-par',
            choices: [{
                index: 0,
                delta: {
                    tool_calls: [
                        { index: 0, function: { arguments: '{"city":"NYC"}' } },
                        { index: 1, function: { arguments: '{"ticker":"GOOG"}' } }
                    ]
                },
                finish_reason: null
            }]
        }) + '\n\n';
        runScript('combine_resp.js', parToolVars);
        const chunk3Out = parToolVars['response.event.current.content'];
        assert(chunk3Out.includes('"index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"city\\":\\"NYC\\"}"}'));
        assert(chunk3Out.includes('"index":2,"delta":{"type":"input_json_delta","partial_json":"{\\"ticker\\":\\"GOOG\\"}"}'));

        // Chunk 4 finishes with inline usage -> closes block 1 & block 2 cleanly (without re-closing 0!) and sets stop_reason="tool_use"
        parToolVars['response.event.current.count'] = 4;
        parToolVars['response.event.current.content'] = 'data: ' + JSON.stringify({
            id: 'chatcmpl-par',
            choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
            usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 }
        }) + '\n\n';
        runScript('combine_resp.js', parToolVars);
        const chunk4Out = parToolVars['response.event.current.content'];
        assert(chunk4Out.includes('"type":"content_block_stop","index":1'));
        assert(chunk4Out.includes('"type":"content_block_stop","index":2'));
        assert(!chunk4Out.includes('"type":"content_block_stop","index":0'), 'Block 0 was already closed before tools and must not close twice');
        assert(chunk4Out.includes('"stop_reason":"tool_use"'));

        // 4. Split Gemini finishReason (Chunk 1) + trailing usageMetadata (Chunk 2) with client_requested_include_usage="true"
        const splitGemOai = {
            'request_format': 'openai',
            'route_target': 'gemini',
            'route_format': 'gemini',
            'model': 'gemini-2.5-flash',
            'client_requested_include_usage': 'true',
            'primary_quota_mode': 'tokens',
            'response.event.current.count': 1,
            'response.event.current.content': 'data: ' + JSON.stringify({
                candidates: [{ content: { role: 'model', parts: [{ text: 'Done' }] }, finishReason: 'STOP' }]
            }) + '\n\n'
        };
        runScript('combine_resp.js', splitGemOai);
        const gSplit1 = splitGemOai['response.event.current.content'];
        assert(gSplit1.includes('"finish_reason":"stop"'));
        assert(!gSplit1.includes('data: [DONE]'), 'Must wait for trailing usageMetadata when include_usage=true and usageMetadata not yet present');

        splitGemOai['response.event.current.count'] = 2;
        splitGemOai['response.event.current.content'] = 'data: ' + JSON.stringify({
            usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 40 }
        }) + '\n\n';
        runScript('combine_resp.js', splitGemOai);
        const gSplit2 = splitGemOai['response.event.current.content'];
        assert(gSplit2.includes('"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":40,"total_tokens":140}'));
        assertEqual((gSplit2.match(/data: \[DONE\]/g) || []).length, 1, 'Must emit exactly one [DONE]');
        assertEqual(splitGemOai['primary_quota_usage'], '140');
    });

    test('ROUTE-TRANSCODE-15: Cross-Format & Streaming Fallback Synthetic SSE, Multi-Turn Tools/Images/PDFs & Direct Anthropic Headers', () => {
        // 1. Verify SC-FallbackExternal.xml binds variable="fallbackRequest" (dynamic Message headers populated only when non-empty)
        const scExtXml = fs.readFileSync(path.join(BUNDLE_DIR, 'policies', 'SC-FallbackExternal.xml'), 'utf8');
        assert(scExtXml.includes('variable="fallbackRequest"'), 'SC-FallbackExternal.xml must bind fallbackRequest Message');
        assert(!scExtXml.includes('name="anthropic-version"'), 'SC-FallbackExternal.xml must omit static anthropic-version to prevent blank wire headers on OpenAI/vLLM');

        // 2. Claude stream:true with multi-turn tool_use/tool_result + PDF + $defs/$ref tool schema -> Gemini fallback -> Claude SSE
        const claudeStreamToGem = {
            'request_format': 'claude',
            'stream': true,
            'fallback_model': 'gemini-2.5-flash',
            'allow_fallbacks': 'true',
            'propertyset.config.project_id': 'my-gcp-project',
            'raw_client_payload': JSON.stringify({
                model: 'claude-sonnet-4-6',
                stream: true,
                max_tokens: 512,
                thinking: { type: 'enabled', budget_tokens: 1024 },
                tool_choice: { type: 'tool', name: 'query_ledger' },
                tools: [{
                    name: 'query_ledger',
                    description: 'Query ledger',
                    input_schema: {
                        type: 'object',
                        $defs: { Filter: { type: 'object', properties: { acct: { type: 'string' } }, required: ['acct'] } },
                        properties: { filter: { $ref: '#/$defs/Filter' } },
                        required: ['filter'],
                        additionalProperties: false
                    }
                }],
                messages: [
                    {
                        role: 'user',
                        content: [
                            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERi0xLjQK' } },
                            { type: 'text', text: 'Audit account A-1' }
                        ]
                    },
                    {
                        role: 'assistant',
                        content: [{ type: 'tool_use', id: 'toolu_a1', name: 'query_ledger', input: { filter: { acct: 'A-1' } } }]
                    },
                    {
                        role: 'user',
                        content: [{ type: 'tool_result', tool_use_id: 'toolu_a1', content: 'BALANCE=5000' }]
                    }
                ]
            })
        };
        assertEqual(runScript('prepare_fallback_request.js', claudeStreamToGem), 'CONTINUE');
        const gemFbReq = JSON.parse(claudeStreamToGem['fallback_request_payload']);
        assertEqual(gemFbReq.contents[0].parts[0].inlineData.mimeType, 'application/pdf');
        assertEqual(gemFbReq.contents[1].parts[0].functionCall.name, 'query_ledger');
        assertEqual(gemFbReq.contents[2].parts[0].functionResponse.name, 'query_ledger');
        assertEqual(gemFbReq.contents[2].parts[0].functionResponse.response.content, 'BALANCE=5000');
        assertEqual(gemFbReq.tools[0].functionDeclarations[0].parameters.properties.filter.properties.acct.type, 'string');
        assertEqual(gemFbReq.toolConfig.functionCallingConfig.mode, 'ANY');
        assertEqual(gemFbReq.toolConfig.functionCallingConfig.allowedFunctionNames[0], 'query_ledger');

        claudeStreamToGem['fallbackResponse.status.code'] = 200;
        claudeStreamToGem['fallbackResponse.content'] = JSON.stringify({
            candidates: [{
                content: {
                    role: 'model',
                    parts: [
                        { thought: true, text: 'Ledger verified.', thoughtSignature: 'sig_abc' },
                        { functionCall: { name: 'query_ledger', args: { filter: { acct: 'A-2' } } }, thoughtSignature: 'sig_fc' }
                    ]
                },
                finishReason: 'STOP'
            }],
            usageMetadata: { promptTokenCount: 80, candidatesTokenCount: 15, thoughtsTokenCount: 5, totalTokenCount: 100 }
        });
        assertEqual(runScript('apply_fallback_response.js', claudeStreamToGem), 'CONTINUE');
        assertEqual(claudeStreamToGem['response.header.Content-Type'], 'text/event-stream; charset=utf-8');
        assertEqual(claudeStreamToGem['stream'], false, 'Must set stream=false so PostFlow token/cost/Model Armor policies still run');
        const claudeSse = claudeStreamToGem['response.content'];
        assert(claudeSse.includes('event: message_start\n'));
        assert(claudeSse.includes('"type":"thinking_delta","thinking":"Ledger verified."'));
        assert(claudeSse.includes('"type":"tool_use","id":'));
        assert(claudeSse.includes('"type":"input_json_delta","partial_json":"{\\"filter\\":{\\"acct\\":\\"A-2\\"}}"'));
        assert(claudeSse.includes('"stop_reason":"tool_use"'));
        assert(claudeSse.includes('event: message_stop\n'));

        // 3. Direct api.anthropic.com vs Vertex :rawPredict fallback
        const directAntFb = {
            'request_format': 'openai',
            'stream': true,
            'client_requested_include_usage': 'true',
            'fallback_model': 'claude-direct',
            'allow_fallbacks': 'true',
            'propertyset.config.project_id': 'my-gcp-project',
            'propertyset.model_locations.claude-direct.publisher': 'anthropic',
            'propertyset.model_locations.claude-direct.format': 'anthropic',
            'propertyset.model_locations.claude-direct.url': 'https://api.anthropic.com/v1/messages',
            'propertyset.model_locations.claude-direct.upstream_model': 'claude-sonnet-4-6',
            'propertyset.model_locations.claude-direct.auth_type': 'api_key',
            'propertyset.model_locations.claude-direct.auth_header': 'x-api-key',
            'propertyset.model_locations.claude-direct.auth_token': 'sk-ant-123',
            'raw_client_payload': JSON.stringify({
                model: 'gpt-4o',
                stream: true,
                stream_options: { include_usage: true },
                messages: [{ role: 'user', content: 'Hello direct fallback' }]
            })
        };
        assertEqual(runScript('prepare_fallback_request.js', directAntFb), 'CONTINUE');
        const directAntBody = JSON.parse(directAntFb['fallback_request_payload']);
        assertEqual(directAntBody.anthropic_version, undefined, 'Direct api.anthropic.com rejects anthropic_version in JSON body with 400');
        assertEqual(directAntBody.model, 'claude-sonnet-4-6');
        assertEqual(directAntFb['fallback_anthropic_version'], '2023-06-01');

        const vertexAntFb = {
            'request_format': 'openai',
            'fallback_model': 'claude-haiku-4-5',
            'allow_fallbacks': 'true',
            'propertyset.config.project_id': 'my-gcp-project',
            'propertyset.model_locations.claude-haiku-4-5.publisher': 'anthropic',
            'propertyset.model_locations.claude-haiku-4-5.format': 'anthropic',
            'raw_client_payload': JSON.stringify({
                model: 'gpt-4o',
                messages: [{ role: 'user', content: 'Hello Vertex fallback' }]
            })
        };
        assertEqual(runScript('prepare_fallback_request.js', vertexAntFb), 'CONTINUE');
        const vertexAntBody = JSON.parse(vertexAntFb['fallback_request_payload']);
        assertEqual(vertexAntBody.anthropic_version, 'vertex-2023-10-16');
        assertEqual(vertexAntBody.model, undefined, 'Vertex :rawPredict forbids model in JSON body');
        assertEqual(vertexAntFb['fallback_anthropic_version'], undefined);

        // 4. Gemini :streamGenerateContent?alt=sse vs JSON-array stream (:streamGenerateContent without alt=sse)
        const gemSseFb = {
            'request_format': 'gemini',
            'stream': true,
            'fallback_model': 'my-vllm-model',
            'allow_fallbacks': 'true',
            'propertyset.config.project_id': 'my-gcp-project',
            'propertyset.model_locations.my-vllm-model.publisher': 'custom',
            'propertyset.model_locations.my-vllm-model.format': 'openai',
            'propertyset.model_locations.my-vllm-model.url': 'https://mock-llm.example.com/mock/v1/chat/completions',
            'raw_client_payload': JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: 'Stream Gemini SSE' }] }]
            }),
            'fallbackResponse.status.code': 200,
            'fallbackResponse.content': JSON.stringify({
                id: 'chatcmpl-1',
                choices: [{ index: 0, message: { role: 'assistant', content: 'Gem SSE OK' }, finish_reason: 'stop' }],
                usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
            })
        };
        assertEqual(runScript('prepare_fallback_request.js', gemSseFb), 'CONTINUE');
        assertEqual(runScript('apply_fallback_response.js', gemSseFb), 'CONTINUE');
        assertEqual(gemSseFb['response.header.Content-Type'], 'text/event-stream; charset=utf-8');
        assert(gemSseFb['response.content'].startsWith('data: {'));
        assert(!gemSseFb['response.content'].includes('[DONE]'), 'Gemini ?alt=sse must never emit OpenAI [DONE]');

        const gemArrFb = {
            'request_format': 'gemini',
            'stream': false,
            'gemini_json_array_stream': 'true',
            'fallback_model': 'my-vllm-model',
            'fallback_format': 'openai',
            'fallback_publisher': 'custom',
            'fallbackResponse.status.code': 200,
            'fallbackResponse.content': gemSseFb['fallbackResponse.content']
        };
        assertEqual(runScript('apply_fallback_response.js', gemArrFb), 'CONTINUE');
        assertEqual(gemArrFb['response.header.Content-Type'], 'application/json');
        const parsedGemArr = JSON.parse(gemArrFb['response.content']);
        assert(Array.isArray(parsedGemArr) && parsedGemArr.length === 1);
        assertEqual(parsedGemArr[0].candidates[0].content.parts[0].text, 'Gem SSE OK');
    });

    test('ROUTE-TRANSCODE-16: SC-FallbackExternal omits blank static headers while preserving clearPayload="true", and prepare_fallback_request supports custom auth.header_name in private.*', () => {
        const scFbXml = fs.readFileSync(path.join(BUNDLE_DIR, 'policies/SC-FallbackExternal.xml'), 'utf8');
        assert(scFbXml.includes('clearPayload="true"'), 'SC-FallbackExternal.xml must preserve clearPayload="true"');
        assert(scFbXml.includes('variable="fallbackRequest"'), 'SC-FallbackExternal.xml must bind variable="fallbackRequest"');
        for (const removedStaticHdr of [
            'name="Authorization"',
            'name="x-api-key"',
            'name="api-key"',
            'name="OpenAI-Organization"',
            'name="OpenAI-Project"',
            'name="anthropic-version"',
            'name="anthropic-beta"'
        ]) {
            assert(
                !scFbXml.includes(removedStaticHdr),
                `SC-FallbackExternal.xml must not hardcode static ${removedStaticHdr} (sends blank headers when unset)`
            );
        }

        const customHdrVars = {
            'request_format': 'openai',
            'fallback_model': 'azure-apim-gpt4o',
            'allow_fallbacks': 'true',
            'propertyset.model_locations.azure-apim-gpt4o.publisher': 'openai',
            'propertyset.model_locations.azure-apim-gpt4o.format': 'openai',
            'propertyset.model_locations.azure-apim-gpt4o.url': 'https://apim.corp.example.com/openai/v1/chat/completions',
            'propertyset.model_locations.azure-apim-gpt4o.auth_type': 'api_key',
            'propertyset.model_locations.azure-apim-gpt4o.auth_header': 'Ocp-Apim-Subscription-Key',
            'propertyset.model_locations.azure-apim-gpt4o.auth_token': 'apim-secret-key-42',
            'raw_client_payload': JSON.stringify({
                model: 'gemini-2.5-flash',
                messages: [{ role: 'user', content: 'Hello APIM fallback' }]
            })
        };
        assertEqual(runScript('prepare_fallback_request.js', customHdrVars), 'CONTINUE');
        assertEqual(customHdrVars['fallback_ready'], 'true');
        assertEqual(customHdrVars['private.fallback_custom_auth_header'], 'Ocp-Apim-Subscription-Key');
        assertEqual(customHdrVars['private.fallback_custom_auth_value'], 'apim-secret-key-42');
        assertEqual(customHdrVars['fallback_custom_auth_value'], undefined, 'Custom fallback auth secret must stay isolated in private.*');
    });

    test('ROUTE-TRANSCODE-17: Multi-Project Vertex AI Routing (Persona > Model > Gateway Precedence, /ai-gateway Rewrite & Tenant Isolation)', () => {
        // 1. Rendered TargetEndpoints use {vertex_project_id}, while SC-LLMJudge stays on {gcp_project_id}
        const claudeTargetXml = fs.readFileSync(path.join(BUNDLE_DIR, 'targets', 'claude.xml'), 'utf8');
        const geminiTargetXml = fs.readFileSync(path.join(BUNDLE_DIR, 'targets', 'gemini.xml'), 'utf8');
        const openAiTargetXml = fs.readFileSync(path.join(BUNDLE_DIR, 'targets', 'gemini-openai-compat.xml'), 'utf8');
        const judgeXml = fs.readFileSync(path.join(BUNDLE_DIR, 'policies', 'SC-LLMJudge.xml'), 'utf8');
        assert(claudeTargetXml.includes('/v1/projects/{vertex_project_id}/locations/'), 'claude.xml must route to {vertex_project_id}');
        assert(geminiTargetXml.includes('/v1/projects/{vertex_project_id}/locations/'), 'gemini.xml must route to {vertex_project_id}');
        assert(openAiTargetXml.includes('/v1/projects/{vertex_project_id}/locations/'), 'gemini-openai-compat.xml must route to {vertex_project_id}');
        assert(judgeXml.includes('/v1/projects/{gcp_project_id}/locations/'), 'SC-LLMJudge.xml must remain on {gcp_project_id}');

        // 2. Persona project_id ("mktg-vertex-prod") overrides unpinned Model project_id ("shared-vertex-proj")
        const mktgVars = {
            'propertyset.config.project_id': 'my-gcp-project',
            'propertyset.config.has_project_overrides': 'true',
            'propertyset.config.auth_personas_list': 'marketing-ai,developer',
            'propertyset.config.persona.marketing-ai.project_id': 'mktg-vertex-prod',
            'propertyset.model_locations.gemini-3.5-flash.project_id': 'shared-vertex-proj',
            'propertyset.model_locations.gemini-3.5-flash.publisher': 'google',
            'propertyset.model_locations.gemini-3.5-flash.format': 'gemini',
            'verifyapikey.VA-ApiKey.persona': 'marketing-ai',
            'model': 'gemini-3.5-flash',
            'payload_strict_validated': 'true'
        };
        assertEqual(runScript('resolve_model_location.js', mktgVars), 'CONTINUE');
        assertEqual(mktgVars['gcp_project_id'], 'my-gcp-project');
        assertEqual(mktgVars['vertex_project_id'], 'mktg-vertex-prod');
        assertEqual(mktgVars['cb_identifier'], 'gemini-3.5-flash:proj:mktg-vertex-prod');

        // 3. /ai-gateway automatically rewrites gateway project to caller persona project and blocks spoofing
        const gemNativeVars = {
            'propertyset.config.project_id': 'my-gcp-project',
            'propertyset.config.has_project_overrides': 'true',
            'propertyset.config.auth_personas_list': 'marketing-ai,developer',
            'propertyset.config.persona.marketing-ai.project_id': 'mktg-vertex-prod',
            'verifyapikey.VA-ApiKey.persona': 'marketing-ai',
            'proxy.pathsuffix': '/v1/projects/my-gcp-project/locations/global/publishers/google/models/gemini-2.5-flash:generateContent',
            'request.header.content-type': 'application/json',
            'request.content': JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'hi' }] }] })
        };
        assertEqual(runScript('extract_vars_gemini.js', gemNativeVars), 'CONTINUE');
        assertEqual(runScript('resolve_model_location.js', gemNativeVars), 'CONTINUE');
        assertEqual(
            gemNativeVars['gemini_native_target_url'],
            'https://aiplatform.googleapis.com/v1/projects/mktg-vertex-prod/locations/global/publishers/google/models/gemini-2.5-flash:generateContent'
        );

        const spoofVars = {
            'propertyset.config.project_id': 'my-gcp-project',
            'propertyset.config.has_project_overrides': 'true',
            'propertyset.config.auth_personas_list': 'marketing-ai,developer',
            'propertyset.config.persona.marketing-ai.project_id': 'mktg-vertex-prod',
            'verifyapikey.VA-ApiKey.persona': 'developer',
            'proxy.pathsuffix': '/v1/projects/mktg-vertex-prod/locations/global/publishers/google/models/gemini-2.5-flash:generateContent',
            'request.header.content-type': 'application/json',
            'request.content': JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'hi' }] }] })
        };
        assertEqual(runScript('extract_vars_gemini.js', spoofVars), 'ABORT');
        assertEqual(spoofVars['auth_error_status'], '403');
    });
});



