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

const {
    runScript,
    suite,
    test,
    assert,
    assertEqual
} = require('./helpers/harness');

suite('Authentication, Personas & Team Attribution Suite', () => {
    const personaConfigProps = {
        'propertyset.config.auth_allow_bearer_api_key': 'true',
        'propertyset.config.auth_agent_token_enabled': 'true',
        'propertyset.config.auth_agent_allowed_trust_domain': '.system.id.goog',
        'propertyset.config.auth_agent_allowed_email_suffix': '.iam.gserviceaccount.com',
        'propertyset.config.auth_agent_persona': 'agent',
        'propertyset.config.auth_agent_token_ttl_ms': '3600000',
        'propertyset.config.auth_idp_opaque_enabled': 'true',
        'propertyset.config.auth_idp_opaque_user_claim': 'email',
        'propertyset.config.auth_idp_opaque_persona_claim': 'role',
        'propertyset.config.auth_idp_opaque_team_claim': 'department',
        'propertyset.config.auth_idp_opaque_quota_override_claim': 'ai_quota_override',
        'propertyset.config.auth_idp_jwt_enabled': 'true',
        'propertyset.config.auth_idp_jwt_audience': 'api://ai-gateway',
        'propertyset.config.auth_idp_jwt_user_claim': 'email',
        'propertyset.config.auth_idp_jwt_persona_claim': 'role',
        'propertyset.config.auth_idp_jwt_team_claim': 'department',
        'propertyset.config.auth_idp_jwt_quota_override_claim': 'ai_quota_override',
        'propertyset.config.auth_personas_list': 'agent,data-pipeline-services,developer,finance-automation,it,knowledge-worker,ml-project-agents,research-agent',
        'propertyset.config.auth_persona_default': '',
        'propertyset.config.persona.knowledge-worker.match_claims': 'knowledge-worker,general,business-*',
        'propertyset.config.persona.knowledge-worker.client_id': 'app_kw_tier_key',
        'propertyset.config.persona.developer.match_claims': 'developer,engineering,swe-*,*-data-science',
        'propertyset.config.persona.developer.client_id': 'app_developer_tier_key',
        'propertyset.config.persona.it.match_claims': 'it,platform-admin,sre-*,devops,secops',
        'propertyset.config.persona.it.client_id': 'app_it_tier_key',
        'propertyset.config.persona.research-agent.match_claims': 'principal://agents.global.org-123456789012.system.id.goog/resources/aiplatform/projects/9876543210/locations/us-central1/reasoningEngines/deep-research-*',
        'propertyset.config.persona.research-agent.client_id': 'app_research_agent_key',
        'propertyset.config.persona.ml-project-agents.match_claims': 'principalSet://agents.global.org-123456789012.system.id.goog/attribute.platformContainer/aiplatform/projects/9876543210',
        'propertyset.config.persona.ml-project-agents.client_id': 'app_ml_project_agent_key',
        'propertyset.config.persona.finance-automation.match_claims': 'finance-*@my-project.iam.gserviceaccount.com',
        'propertyset.config.persona.finance-automation.client_id': 'app_finance_sa_key',
        'propertyset.config.persona.data-pipeline-services.match_claims': '*@my-data-project.iam.gserviceaccount.com',
        'propertyset.config.persona.data-pipeline-services.client_id': 'app_data_project_sa_key',
        'propertyset.config.persona.agent.match_claims': 'principalSet://agents.global.org-123456789012.system.id.goog/*,*@*.iam.gserviceaccount.com,agent',
        'propertyset.config.persona.agent.client_id': 'app_agent_tier_key'
    };

    test('AUTH-01: Option 1 Alternative API Key Header (anthropic-api-key) & Dual-Header Extraction', () => {
        const opt1Vars = Object.assign({}, personaConfigProps, {
            'request.header.anthropic-api-key': 'apigee-product-key-123',
            'request.header.Authorization': 'Bearer ya29.c.b0Aaekm1K_agent_token'
        });
        runScript('extract_auth_credentials.js', opt1Vars);
        assertEqual(opt1Vars['request.header.x-apikey'], 'apigee-product-key-123');
        assertEqual(opt1Vars['auth_has_apikey'], 'true');
        assertEqual(opt1Vars['auth_bearer_token'], 'ya29.c.b0Aaekm1K_agent_token');
        assertEqual(opt1Vars['auth_token_type'], 'agent_identity');
        assertEqual(opt1Vars['auth_try_bearer_as_apikey'], 'false');
    });

    test('AUTH-02: Option 3a Google Cloud Agent Identity (SPIFFE principal://) 3-Level Hierarchy & Glob Specificity', () => {
        // Level 1: Single Agent glob match (deep-research-01 beats project 9876543210 and org wildcard)
        const spiffeSingleVars = Object.assign({}, personaConfigProps, {
            'request.header.Authorization': 'Bearer ya29.spiffe_research_agent',
            'agentTokenVerifyResponse.status.code': 200,
            'agentTokenVerifyResponse.content': JSON.stringify({
                principal: 'principal://agents.global.org-123456789012.system.id.goog/resources/aiplatform/projects/9876543210/locations/us-central1/reasoningEngines/deep-research-01'
            })
        });
        runScript('extract_auth_credentials.js', spiffeSingleVars);
        runScript('resolve_auth_persona.js', spiffeSingleVars);
        assertEqual(spiffeSingleVars['auth_ready_to_import'], 'true');
        assertEqual(spiffeSingleVars['auth_persona'], 'research-agent');
        assertEqual(spiffeSingleVars['request.formparam.client_id'], 'app_research_agent_key');
        assertEqual(spiffeSingleVars['auth_team'], 'project:9876543210');

        // Level 2: Project PrincipalSet match (general-assistant in project 9876543210 beats org wildcard)
        const spiffeProjVars = Object.assign({}, personaConfigProps, {
            'request.header.Authorization': 'Bearer ya29.spiffe_project_agent',
            'agentTokenVerifyResponse.status.code': 200,
            'agentTokenVerifyResponse.content': JSON.stringify({
                spiffe_id: 'spiffe://agents.global.org-123456789012.system.id.goog/resources/aiplatform/projects/9876543210/locations/us-central1/reasoningEngines/general-assistant'
            })
        });
        runScript('extract_auth_credentials.js', spiffeProjVars);
        runScript('resolve_auth_persona.js', spiffeProjVars);
        assertEqual(spiffeProjVars['auth_ready_to_import'], 'true');
        assertEqual(spiffeProjVars['auth_persona'], 'ml-project-agents');
        assertEqual(spiffeProjVars['request.formparam.client_id'], 'app_ml_project_agent_key');
        assertEqual(spiffeProjVars['auth_team'], 'project:9876543210');

        // Level 3: Organization PrincipalSet wildcard match
        const spiffeOrgVars = Object.assign({}, personaConfigProps, {
            'request.header.Authorization': 'Bearer ya29.spiffe_org_agent',
            'agentTokenVerifyResponse.status.code': 200,
            'agentTokenVerifyResponse.content': JSON.stringify({
                principal: 'principal://agents.global.org-123456789012.system.id.goog/resources/aiplatform/projects/5555555555/locations/europe-west1/reasoningEngines/eu-bot'
            })
        });
        runScript('extract_auth_credentials.js', spiffeOrgVars);
        runScript('resolve_auth_persona.js', spiffeOrgVars);
        assertEqual(spiffeOrgVars['auth_ready_to_import'], 'true');
        assertEqual(spiffeOrgVars['auth_persona'], 'agent');
        assertEqual(spiffeOrgVars['request.formparam.client_id'], 'app_agent_tier_key');
        assertEqual(spiffeOrgVars['auth_team'], 'project:5555555555');
    });

    test('AUTH-03: Option 3b Google Cloud IAM Service Accounts (*.iam.gserviceaccount.com) Glob Specificity & Payload Restoration', () => {
        // Prefix + project glob
        const saFinanceVars = Object.assign({}, personaConfigProps, {
            'request.header.Authorization': 'Bearer ya29.sa_finance_bot',
            'agentTokenVerifyResponse.status.code': 200,
            'agentTokenVerifyResponse.content': JSON.stringify({
                email: 'finance-ap-bot@my-project.iam.gserviceaccount.com',
                email_verified: 'true',
                sub: '100200300'
            })
        });
        runScript('extract_auth_credentials.js', saFinanceVars);
        runScript('resolve_auth_persona.js', saFinanceVars);
        assertEqual(saFinanceVars['auth_persona'], 'finance-automation');
        assertEqual(saFinanceVars['request.formparam.client_id'], 'app_finance_sa_key');
        assertEqual(saFinanceVars['auth_team'], 'project:my-project');

        // Project-wide glob
        const saDataProjVars = Object.assign({}, personaConfigProps, {
            'request.header.Authorization': 'Bearer ya29.sa_data_pipeline',
            'agentTokenVerifyResponse.status.code': 200,
            'agentTokenVerifyResponse.content': JSON.stringify({
                email: 'etl-runner@my-data-project.iam.gserviceaccount.com',
                email_verified: 'true',
                sub: '500600700'
            })
        });
        runScript('extract_auth_credentials.js', saDataProjVars);
        runScript('resolve_auth_persona.js', saDataProjVars);
        assertEqual(saDataProjVars['auth_persona'], 'data-pipeline-services');
        assertEqual(saDataProjVars['request.formparam.client_id'], 'app_data_project_sa_key');
        assertEqual(saDataProjVars['auth_team'], 'project:my-data-project');

        // Org-wide fallback SA + payload restoration after OA-ImportExternalToken
        const origPayload = JSON.stringify({ model: 'gemini-3.1-pro-preview', messages: [{ role: 'user', content: 'Run ADK agent' }] });
        const opt3Vars = Object.assign({}, personaConfigProps, {
            'request.header.Authorization': 'Bearer ya29.c.b0Aaekm1K_adk_agent',
            'request.header.Content-Type': 'application/json',
            'request.content': origPayload,
            'agentTokenVerifyResponse.status.code': 200,
            'agentTokenVerifyResponse.content': JSON.stringify({
                email: 'coding-agent@demo-proj.iam.gserviceaccount.com',
                email_verified: 'true',
                sub: '10987654321',
                azp: 'adk-orchestrator'
            })
        });
        runScript('extract_auth_credentials.js', opt3Vars);
        runScript('resolve_auth_persona.js', opt3Vars);
        assertEqual(opt3Vars['auth_ready_to_import'], 'true');
        assertEqual(opt3Vars['request.formparam.client_id'], 'app_agent_tier_key');
        assertEqual(opt3Vars['request.formparam.grant_type'], 'client_credentials');
        assertEqual(opt3Vars['oauth_external_authorization_status'], 'true');
        assertEqual(opt3Vars['auth_user_id'], 'coding-agent@demo-proj.iam.gserviceaccount.com');
        assertEqual(opt3Vars['auth_persona'], 'agent');

        runScript('restore_request_payload.js', opt3Vars);
        assertEqual(opt3Vars['request.content'], origPayload);
        assertEqual(opt3Vars['request.header.Content-Type'], 'application/json');
        assertEqual(opt3Vars['request.formparam.client_id'], undefined);
    });

    test('AUTH-04: Option 4a Enterprise IdP Opaque Token (/userinfo) + Cached OAuth Token Per-User Quota Bridging', () => {
        const opt4aVars = Object.assign({}, personaConfigProps, {
            'request.header.Authorization': 'Bearer okta_opaque_token_xyz987',
            'idpOpaqueVerifyResponse.status.code': 200,
            'idpOpaqueVerifyResponse.content': JSON.stringify({
                email: 'alice@corp.com',
                role: ['swe-backend'],
                department: 'core-platform',
                ai_quota_override: '5000000'
            })
        });
        runScript('extract_auth_credentials.js', opt4aVars);
        runScript('resolve_auth_persona.js', opt4aVars);
        assertEqual(opt4aVars['auth_ready_to_import'], 'true');
        assertEqual(opt4aVars['request.formparam.client_id'], 'app_developer_tier_key');
        assertEqual(opt4aVars['auth_user_id'], 'alice@corp.com');
        assertEqual(opt4aVars['auth_persona'], 'developer');
        assertEqual(opt4aVars['auth_team'], 'core-platform');
        assertEqual(opt4aVars['auth_quota_override'], '5000000');

        // Simulate 2nd+ request (<1ms OA-VerifyAccessToken hit) -> verify resolve_model_location.js isolates quota & rate-limit bucket per user
        const cachedOauthVars = {
            'model': 'claude-haiku-4-5',
            'client_id': 'app_developer_tier_key',
            'apiproduct.name': 'ai-developer-product',
            'apiproduct.developer.quota.limit': '1000000',
            'apiproduct.developer.quota.interval': '1',
            'apiproduct.developer.quota.timeunit': 'day',
            'accesstoken.user_id': 'alice@corp.com',
            'accesstoken.persona': 'developer',
            'accesstoken.team': 'core-platform',
            'accesstoken.auth_source': 'idp_opaque',
            'accesstoken.quota_override': '5000000'
        };
        runScript('resolve_model_location.js', cachedOauthVars);
        assertEqual(cachedOauthVars['identity_user_id'], 'alice@corp.com');
        assertEqual(cachedOauthVars['identity_persona'], 'developer');
        assertEqual(cachedOauthVars['identity_team'], 'core-platform');
        assertEqual(cachedOauthVars['verifyapikey.VA-ApiKey.client_id'], 'alice@corp.com');
        assertEqual(cachedOauthVars['rate_limit_client_id'], 'alice@corp.com');
        assertEqual(cachedOauthVars['verifyapikey.VA-ApiKey.apiproduct.developer.quota.limit'], '5000000');
    });

    test('AUTH-05: Option 4b Enterprise IdP JWT + Default Client ID Fallback + 403 Permission Denied for Unmapped Role', () => {
        const opt4bJwtVars = Object.assign({}, personaConfigProps, {
            'request.header.Authorization': 'Bearer eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJib2IifQ.c2lnbmF0dXJl',
            'jwt.VJ-VerifyIdpJwt.failed': 'false',
            'jwt.VJ-VerifyIdpJwt.valid': 'true',
            'jwt.VJ-VerifyIdpJwt.claim.email': 'bob@corp.com',
            'jwt.VJ-VerifyIdpJwt.claim.role': 'sre-platform',
            'jwt.VJ-VerifyIdpJwt.claim.department': 'infra',
            'jwt.VJ-VerifyIdpJwt.claim.audience': 'api://ai-gateway'
        });
        runScript('extract_auth_credentials.js', opt4bJwtVars);
        runScript('resolve_auth_persona.js', opt4bJwtVars);
        assertEqual(opt4bJwtVars['auth_token_type'], 'idp_jwt');
        assertEqual(opt4bJwtVars['auth_ready_to_import'], 'true');
        assertEqual(opt4bJwtVars['request.formparam.client_id'], 'app_it_tier_key');
        assertEqual(opt4bJwtVars['auth_persona'], 'it');

        // Default client_id fallback when persona does not specify its own client_id
        const defaultClientIdAuthVars = {
            'auth_token_type': 'idp_jwt',
            'jwt.VJ-VerifyIdpJwt.valid': 'true',
            'jwt.VJ-VerifyIdpJwt.claim.email': 'bob@company.com',
            'jwt.VJ-VerifyIdpJwt.claim.role': 'business',
            'jwt.VJ-VerifyIdpJwt.claim.department': 'sales',
            'jwt.VJ-VerifyIdpJwt.claim.audience': 'api://ai-gateway',
            'propertyset.config.auth_idp_jwt_audience': 'api://ai-gateway',
            'propertyset.config.auth_personas_list': 'knowledge-worker,developer',
            'propertyset.config.auth_default_client_id': 'shared-gw-app-client-id',
            'propertyset.config.persona.knowledge-worker.match_claims': 'knowledge-worker,business'
        };
        runScript('resolve_auth_persona.js', defaultClientIdAuthVars);
        assertEqual(defaultClientIdAuthVars['auth_ready_to_import'], 'true');
        assertEqual(defaultClientIdAuthVars['auth_persona'], 'knowledge-worker');
        assertEqual(defaultClientIdAuthVars['auth_persona_client_id'], 'shared-gw-app-client-id');

        // Unmapped role -> 403 permission_error
        const unmappedVars = Object.assign({}, personaConfigProps, {
            'request.header.Authorization': 'Bearer eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJndWVzdCJ9.c2ln',
            'jwt.VJ-VerifyIdpJwt.failed': 'false',
            'jwt.VJ-VerifyIdpJwt.valid': 'true',
            'jwt.VJ-VerifyIdpJwt.claim.email': 'guest@external.com',
            'jwt.VJ-VerifyIdpJwt.claim.role': 'unassigned-contractor',
            'jwt.VJ-VerifyIdpJwt.claim.audience': 'api://ai-gateway'
        });
        runScript('extract_auth_credentials.js', unmappedVars);
        runScript('resolve_auth_persona.js', unmappedVars);
        const errPayload = JSON.parse(unmappedVars['auth_error_payload']);
        assertEqual(unmappedVars['auth_ready_to_import'], 'false');
        assertEqual(unmappedVars['auth_error_status'], '403');
        assertEqual(errPayload.error.type, 'permission_error');
    });

    test('AUTH-06: Distinct Team Personas (developer_team_a vs developer_team_b) & Longest-Suffix API Product Resolution', () => {
        const teamPersonaBase = {
            'model': 'gemini-3.5-flash',
            'propertyset.model_locations.models.catalog': 'gemini-3.5-flash,claude-sonnet-4-6',
            'propertyset.config.auth_personas_list': 'team_a,developer_team_a,developer_team_b',
            'propertyset.config.persona.developer_team_a.quota_limit': '100000',
            'propertyset.config.persona.developer_team_a.team_quota_limit': '5000000',
            'propertyset.config.persona.developer_team_b.quota_limit': '100000',
            'propertyset.config.persona.developer_team_b.team_quota_limit': '1000000'
        };

        // API Key on ai-gateway-developer-team-a vs ai-gateway-developer-team-b (note 'team_a' is a shorter suffix of 'developer_team_a'!)
        const devTeamAVars = Object.assign({}, teamPersonaBase, {
            'verifyapikey.VA-ApiKey.client_id': 'app-team-a-1',
            'verifyapikey.VA-ApiKey.apiproduct.name': 'ai-gateway-developer-team-a'
        });
        const devTeamBVars = Object.assign({}, teamPersonaBase, {
            'verifyapikey.VA-ApiKey.client_id': 'app-team-b-1',
            'verifyapikey.VA-ApiKey.apiproduct.name': 'ai-gateway-developer-team-b'
        });
        runScript('resolve_model_location.js', devTeamAVars);
        runScript('resolve_model_location.js', devTeamBVars);

        assertEqual(devTeamAVars['identity_persona'], 'developer_team_a');
        assertEqual(devTeamAVars['identity_team'], 'developer_team_a');
        assertEqual(devTeamAVars['secondary_quota_identifier'], 'team:developer_team_a');
        assertEqual(devTeamAVars['secondary_quota_limit'], '5000000');

        assertEqual(devTeamBVars['identity_persona'], 'developer_team_b');
        assertEqual(devTeamBVars['identity_team'], 'developer_team_b');
        assertEqual(devTeamBVars['secondary_quota_identifier'], 'team:developer_team_b');
        assertEqual(devTeamBVars['secondary_quota_limit'], '1000000');

        // SSO JWT with developer_team_a role and NO department claim -> auth_team falls back to developer_team_a
        const ssoTeamPersonaVars = {
            'auth_token_type': 'idp_jwt',
            'jwt.VJ-VerifyIdpJwt.valid': 'true',
            'jwt.VJ-VerifyIdpJwt.claim.email': 'carol@company.com',
            'jwt.VJ-VerifyIdpJwt.claim.role': 'developer_team_a',
            'jwt.VJ-VerifyIdpJwt.claim.audience': 'api://ai-gateway',
            'propertyset.config.auth_idp_jwt_audience': 'api://ai-gateway',
            'propertyset.config.auth_personas_list': 'developer_team_a,developer_team_b',
            'propertyset.config.auth_default_client_id': 'shared-gw-app-client-id',
            'propertyset.config.persona.developer_team_a.match_claims': 'developer_team_a'
        };
        runScript('resolve_auth_persona.js', ssoTeamPersonaVars);
        assertEqual(ssoTeamPersonaVars['auth_persona'], 'developer_team_a');
        assertEqual(ssoTeamPersonaVars['auth_team'], 'developer_team_a');

        // Unrelated API Product ending in '-team-a' (not anchored to '<gateway_name>-<persona>') must NOT escalate
        const unrelatedProdVars = Object.assign({}, teamPersonaBase, {
            'propertyset.config.gateway_name': 'ai-gateway',
            'propertyset.config.auth_persona_default': 'knowledge-worker',
            'verifyapikey.VA-ApiKey.client_id': 'foreign-app-1',
            'verifyapikey.VA-ApiKey.apiproduct.name': 'partner-portal-developer-team-a'
        });
        runScript('resolve_model_location.js', unrelatedProdVars);
        assertEqual(unrelatedProdVars['identity_persona'], 'knowledge-worker');

        // Narrowed match_claims on privileged persona must NOT implicitly match bare persona key
        const narrowedClaimVars = {
            'auth_token_type': 'idp_jwt',
            'jwt.VJ-VerifyIdpJwt.valid': 'true',
            'jwt.VJ-VerifyIdpJwt.claim.email': 'intern@company.com',
            'jwt.VJ-VerifyIdpJwt.claim.role': 'developer_team_a',
            'jwt.VJ-VerifyIdpJwt.claim.audience': 'api://ai-gateway',
            'propertyset.config.auth_idp_jwt_audience': 'api://ai-gateway',
            'propertyset.config.auth_personas_list': 'developer_team_a',
            'propertyset.config.auth_default_client_id': 'shared-gw-app-client-id',
            'propertyset.config.persona.developer_team_a.match_claims': 'secops-lead-only'
        };
        runScript('resolve_auth_persona.js', narrowedClaimVars);
        assertEqual(narrowedClaimVars['auth_ready_to_import'], 'false');
        assertEqual(narrowedClaimVars['auth_error_status'], '403');
    });
});
