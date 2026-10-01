(function () {
'use strict';

// ============================================================================
// Resolve External Identity -> Persona API Product & Prepare Token Import
// Uses the battle-tested Apigee ExternalAuthorization + SetOAuthV2Info pattern:
//   1. Verify external token result (GCP tokeninfo, IdP /userinfo, or VerifyJWT)
//   2. Map role/group/identity to Persona Developer App client_id
//   3. Set FormParams (client_id, grant_type=client_credentials) and
//      oauth_external_authorization_status=true for OA-ImportExternalToken
// ============================================================================

function normalizeClaimValues(rawClaim) {
    if (!rawClaim) return [];
    if (Array.isArray(rawClaim)) {
        var out = [];
        for (var i = 0; i < rawClaim.length; i++) {
            if (rawClaim[i] !== null && rawClaim[i] !== undefined) {
                out.push(String(rawClaim[i]).trim().toLowerCase());
            }
        }
        return out;
    }
    var str = String(rawClaim).trim();
    if (str === "") return [];
    if (str.charAt(0) === "[" && str.charAt(str.length - 1) === "]") {
        try {
            var parsed = JSON.parse(str);
            if (Array.isArray(parsed)) {
                return normalizeClaimValues(parsed);
            }
        } catch (ignore) {}
    }
    var parts = str.split(",");
    var res = [];
    for (var j = 0; j < parts.length; j++) {
        var clean = parts[j].replace(/^[\[\]"\s]+|[\[\]"\s]+$/g, "").toLowerCase();
        if (clean !== "") res.push(clean);
    }
    return res;
}

try {
    context.setVariable("auth_ready_to_import", "false");

    var tokenType = context.getVariable("auth_token_type");
    var isVerified = false;
    var userId = "";
    var userEmail = "";
    var rawPersonaClaim = "";
    var team = "default";
    var quotaOverride = "";
    var quotaOverrideExpiresAt = "";
    var tokenTtlMs = "3600000";

    // -------------------------------------------------------------------------
    // Option 3: Google Cloud Agent Identity (ya29.* via GCP tokeninfo)
    // -------------------------------------------------------------------------
    if (tokenType === "agent_identity") {
        var agentStatus = Number(context.getVariable("agentTokenVerifyResponse.status.code") || 0);
        var agentContent = context.getVariable("agentTokenVerifyResponse.content");
        if (agentStatus === 200 && agentContent) {
            var agentData = JSON.parse(agentContent);
            var email = agentData.email || "";
            var sub = agentData.sub || agentData.azp || "";
            var allowedSuffix = context.getVariable("propertyset.config.auth_agent_allowed_email_suffix");
            if (allowedSuffix === null || allowedSuffix === undefined || allowedSuffix === "") {
                allowedSuffix = ".iam.gserviceaccount.com";
            }

            var suffixValid = false;
            if (allowedSuffix === "*") {
                suffixValid = Boolean(email || sub);
            } else if (email && email.toLowerCase().indexOf(String(allowedSuffix).toLowerCase()) !== -1 &&
                       email.toLowerCase().lastIndexOf(String(allowedSuffix).toLowerCase()) === email.length - String(allowedSuffix).length) {
                suffixValid = true;
            }

            if (suffixValid) {
                isVerified = true;
                userId = email || sub;
                userEmail = email || sub;
                rawPersonaClaim = context.getVariable("propertyset.config.auth_agent_persona") || "agent";
                team = agentData.azp || "agents";
                tokenTtlMs = String(context.getVariable("propertyset.config.auth_agent_token_ttl_ms") || "3600000");
            }
        }
    }
    // -------------------------------------------------------------------------
    // Option 4a: Enterprise IdP Opaque Token (via IdP /userinfo endpoint)
    // -------------------------------------------------------------------------
    else if (tokenType === "idp_opaque") {
        var idpStatus = Number(context.getVariable("idpOpaqueVerifyResponse.status.code") || 0);
        var idpContent = context.getVariable("idpOpaqueVerifyResponse.content");
        if (idpStatus === 200 && idpContent) {
            var idpData = JSON.parse(idpContent);
            var uClaim = context.getVariable("propertyset.config.auth_idp_opaque_user_claim") || "email";
            var pClaim = context.getVariable("propertyset.config.auth_idp_opaque_persona_claim") || "role";
            var tClaim = context.getVariable("propertyset.config.auth_idp_opaque_team_claim") || "department";
            var qClaim = context.getVariable("propertyset.config.auth_idp_opaque_quota_override_claim") || "ai_quota_override";
            var qExpClaim = context.getVariable("propertyset.config.auth_idp_opaque_quota_override_expires_at_claim") || "ai_quota_override_expires_at";

            userId = idpData[uClaim] || idpData.email || idpData.sub || "";
            if (userId) {
                isVerified = true;
                userEmail = idpData.email || String(userId);
                rawPersonaClaim = idpData[pClaim] !== undefined ? idpData[pClaim] : (idpData.role || idpData.groups || "");
                team = idpData[tClaim] || idpData.department || idpData.cost_center || "default";
                quotaOverride = idpData[qClaim] ? String(idpData[qClaim]) : "";
                quotaOverrideExpiresAt = idpData[qExpClaim] ? String(idpData[qExpClaim]) : "";
                tokenTtlMs = String(context.getVariable("propertyset.config.auth_idp_opaque_token_ttl_ms") || "3600000");
            }
        }
    }
    // -------------------------------------------------------------------------
    // Option 4b: Enterprise IdP JWT (verified locally via cached JWKS)
    // -------------------------------------------------------------------------
    else if (tokenType === "idp_jwt") {
        var jwtFailed = context.getVariable("jwt.VJ-VerifyIdpJwt.failed");
        var jwtValid = context.getVariable("jwt.VJ-VerifyIdpJwt.valid");
        if (String(jwtValid) === "true" || (jwtFailed !== null && String(jwtFailed) === "false")) {
            var juClaim = context.getVariable("propertyset.config.auth_idp_jwt_user_claim") || "email";
            var jpClaim = context.getVariable("propertyset.config.auth_idp_jwt_persona_claim") || "role";
            var jtClaim = context.getVariable("propertyset.config.auth_idp_jwt_team_claim") || "department";
            var jqClaim = context.getVariable("propertyset.config.auth_idp_jwt_quota_override_claim") || "ai_quota_override";
            var jqExpClaim = context.getVariable("propertyset.config.auth_idp_jwt_quota_override_expires_at_claim") || "ai_quota_override_expires_at";

            userId = context.getVariable("jwt.VJ-VerifyIdpJwt.claim." + juClaim) ||
                     context.getVariable("jwt.VJ-VerifyIdpJwt.claim.email") ||
                     context.getVariable("jwt.VJ-VerifyIdpJwt.claim.sub") || "";
            if (userId) {
                isVerified = true;
                userEmail = context.getVariable("jwt.VJ-VerifyIdpJwt.claim.email") || String(userId);
                rawPersonaClaim = context.getVariable("jwt.VJ-VerifyIdpJwt.claim." + jpClaim) ||
                                  context.getVariable("jwt.VJ-VerifyIdpJwt.claim.role") ||
                                  context.getVariable("jwt.VJ-VerifyIdpJwt.claim.groups") || "";
                team = context.getVariable("jwt.VJ-VerifyIdpJwt.claim." + jtClaim) || "default";
                quotaOverride = context.getVariable("jwt.VJ-VerifyIdpJwt.claim." + jqClaim) || "";
                quotaOverrideExpiresAt = context.getVariable("jwt.VJ-VerifyIdpJwt.claim." + jqExpClaim) || "";
                tokenTtlMs = String(context.getVariable("propertyset.config.auth_idp_jwt_token_ttl_ms") || "3600000");
            }
        }
    }

    // -------------------------------------------------------------------------
    // Map Verified Identity Claim -> Persona Developer App client_id
    // -------------------------------------------------------------------------
    if (isVerified) {
        var claimValues = normalizeClaimValues(rawPersonaClaim);
        var personasCsv = context.getVariable("propertyset.config.auth_personas_list") || "knowledge-worker,developer,it,agent";
        var personas = personasCsv.split(",");
        var matchedPersona = "";
        var personaClientId = "";

        for (var i = 0; i < personas.length; i++) {
            var pName = personas[i].trim();
            if (!pName) continue;

            var matchClaimsCsv = context.getVariable("propertyset.config.persona." + pName + ".match_claims") || pName;
            var matchCandidates = normalizeClaimValues(matchClaimsCsv);
            if (matchCandidates.indexOf(pName.toLowerCase()) === -1) {
                matchCandidates.push(pName.toLowerCase());
            }

            var isMatch = false;
            for (var c = 0; c < claimValues.length; c++) {
                if (matchCandidates.indexOf(claimValues[c]) !== -1) {
                    isMatch = true;
                    break;
                }
            }

            if (isMatch) {
                var candidateClientId = context.getVariable("propertyset.config.persona." + pName + ".client_id") ||
                                        context.getVariable("propertyset.config.persona_" + pName + "_client_id");
                if (candidateClientId && String(candidateClientId).trim() !== "") {
                    matchedPersona = pName;
                    personaClientId = String(candidateClientId).trim();
                    break;
                }
            }
        }

        // Fallback to default persona if configured
        if (!personaClientId) {
            var defaultPersona = context.getVariable("propertyset.config.auth_persona_default");
            if (defaultPersona && String(defaultPersona).trim() !== "") {
                var defName = String(defaultPersona).trim();
                var defClientId = context.getVariable("propertyset.config.persona." + defName + ".client_id") ||
                                  context.getVariable("propertyset.config.persona_" + defName + "_client_id");
                if (defClientId && String(defClientId).trim() !== "") {
                    matchedPersona = defName;
                    personaClientId = String(defClientId).trim();
                }
            }
        }

        if (personaClientId) {
            // Backup original JSON request payload before setting OAuthV2 FormParams
            var origContent = context.getVariable("request.content");
            var origContentType = context.getVariable("request.header.Content-Type");
            if (origContent !== null && origContent !== undefined) {
                context.setVariable("orig_request_content", origContent);
            }
            if (origContentType !== null && origContentType !== undefined) {
                context.setVariable("orig_request_content_type", origContentType);
            }

            // Set OAuthV2 ExternalAuthorization required form parameters & status flag
            context.setVariable("request.formparam.client_id", personaClientId);
            context.setVariable("request.formparam.grant_type", "client_credentials");
            context.setVariable("oauth_external_authorization_status", "true");

            // Store token metadata attributes for OA-SaveTokenAttributes (SetOAuthV2Info)
            context.setVariable("auth_user_id", String(userId));
            context.setVariable("auth_user_email", String(userEmail || userId));
            context.setVariable("auth_persona", matchedPersona);
            context.setVariable("auth_team", String(team || "default"));
            context.setVariable("auth_quota_override", String(quotaOverride || ""));
            context.setVariable("auth_quota_override_expires_at", String(quotaOverrideExpiresAt || ""));
            context.setVariable("auth_persona_client_id", personaClientId);
            context.setVariable("auth_token_ttl_ms", tokenTtlMs);
            context.setVariable("auth_ready_to_import", "true");
        } else {
            // Identity is authentic, but role/group is not mapped to any authorized Persona tier
            context.setVariable("auth_error_status", "403");
            context.setVariable("auth_error_payload", JSON.stringify({
                error: {
                    type: "permission_error",
                    message: "Authenticated identity ('" + userId + "') is not mapped to an authorized AI Gateway Persona or API Product.",
                    code: 403
                }
            }));
        }
    }
} catch (e) {
    print("Error in resolve_auth_persona.js: " + e);
}

})();
