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

// Linear-time O(N) glob matcher supporting '*' wildcards without RegExp/ReDoS overhead
function matchesGlob(str, pattern) {
    if (pattern === "*" || str === pattern) return true;
    if (pattern.indexOf("*") === -1) return false;

    var segments = pattern.split("*");
    var pos = 0;

    if (segments[0] !== "") {
        if (str.indexOf(segments[0]) !== 0) return false;
        pos = segments[0].length;
    }

    var endLimit = str.length;
    var lastSeg = segments[segments.length - 1];
    if (lastSeg !== "") {
        if (str.length - pos < lastSeg.length) return false;
        if (str.lastIndexOf(lastSeg) !== str.length - lastSeg.length) return false;
        endLimit = str.length - lastSeg.length;
    }

    for (var i = 1; i < segments.length - 1; i++) {
        var seg = segments[i];
        if (seg === "") continue;
        var idx = str.indexOf(seg, pos);
        if (idx === -1 || idx + seg.length > endLimit) return false;
        pos = idx + seg.length;
    }

    return true;
}

// Computes specificity score so more specific exact/glob rules always win over broader wildcards
function computeMatchScore(claim, pattern, defaultAgentPersona) {
    var isExact = (pattern.indexOf("*") === -1);
    var literalLen = pattern.replace(/\*/g, "").length;

    if (defaultAgentPersona && pattern === defaultAgentPersona.toLowerCase()) {
        return 1000 + literalLen;
    }

    // SPIFFE / Agent Identity patterns (principal://, spiffe://, principalSet://)
    if (claim.indexOf("principal://") === 0 || claim.indexOf("spiffe://") === 0 || claim.indexOf("principalset://") === 0) {
        if (pattern.indexOf("reasoningengines/") !== -1) {
            return 40000 + (isExact ? 500 : 0) + literalLen;
        }
        if (pattern.indexOf("/locations/") !== -1) {
            return 30000 + (isExact ? 500 : 0) + literalLen;
        }
        if (pattern.indexOf("/projects/") !== -1) {
            return 20000 + (isExact ? 500 : 0) + literalLen;
        }
        return 10000 + (isExact ? 500 : 0) + literalLen;
    }

    // Google Cloud Service Account email patterns (<name>@<project>.iam.gserviceaccount.com)
    if (claim.indexOf(".iam.gserviceaccount.com") !== -1 && pattern.indexOf("@") !== -1) {
        if (isExact) {
            return 40500 + literalLen;
        }
        var atIdx = pattern.indexOf("@");
        var localLit = pattern.substring(0, atIdx).replace(/\*/g, "");
        var domainLit = pattern.substring(atIdx + 1).replace(/\.iam\.gserviceaccount\.com$/i, "").replace(/\*/g, "");
        if (localLit.length > 0 && domainLit.length > 0) {
            return 35000 + literalLen; // Prefix + specific project (e.g. finance-*@my-proj.iam.gserviceaccount.com)
        }
        if (localLit.length > 0) {
            return 30000 + literalLen; // Prefix across projects (e.g. finance-*@*.iam.gserviceaccount.com)
        }
        if (domainLit.length > 0) {
            return 20000 + literalLen; // Project-wide wildcard (e.g. *@my-proj.iam.gserviceaccount.com)
        }
        return 10000 + literalLen;     // Org-wide wildcard (e.g. *@*.iam.gserviceaccount.com)
    }

    if (claim.indexOf("project:") === 0 || pattern.indexOf("project:") === 0) {
        return 20000 + (isExact ? 500 : 0) + literalLen;
    }

    // Corporate IdP claims or shorthand prefixes
    return (isExact ? 40500 : 30000) + literalLen;
}

try {
    context.setVariable("auth_ready_to_import", "false");

    var tokenType = context.getVariable("auth_token_type");
    var isVerified = false;
    var userId = "";
    var userEmail = "";
    var rawPersonaClaim = "";
    var defaultAgentPersona = "";
    var team = "default";
    var quotaOverride = "";
    var quotaOverrideExpiresAt = "";
    var modelArmorRequestTemplate = "";
    var modelArmorResponseTemplate = "";
    var tokenTtlMs = "3600000";

    // -------------------------------------------------------------------------
    // Option 3: Google Cloud Agents — Agent Identity (SPIFFE) & Service Accounts
    // -------------------------------------------------------------------------
    if (tokenType === "agent_identity") {
        var agentStatus = Number(context.getVariable("agentTokenVerifyResponse.status.code") || 0);
        var agentContent = context.getVariable("agentTokenVerifyResponse.content");
        if (agentStatus === 200 && agentContent) {
            var agentData = JSON.parse(agentContent);
            var email = agentData.email || "";
            var sub = agentData.sub || agentData.azp || "";
            var rawPrincipal = agentData.principal || agentData.spiffe_id ||
                               ((sub.indexOf("spiffe://") === 0 || sub.indexOf("principal://") === 0 || sub.indexOf(".system.id.goog") !== -1) ? sub : "") ||
                               ((email.indexOf("spiffe://") === 0 || email.indexOf("principal://") === 0 || email.indexOf(".system.id.goog") !== -1) ? email : "");

            var allowedSuffix = context.getVariable("propertyset.config.auth_agent_allowed_email_suffix");
            if (allowedSuffix === null || allowedSuffix === undefined || allowedSuffix === "") {
                allowedSuffix = ".iam.gserviceaccount.com";
            }
            var allowedTrustDomain = context.getVariable("propertyset.config.auth_agent_allowed_trust_domain");
            if (allowedTrustDomain === null || allowedTrustDomain === undefined || allowedTrustDomain === "") {
                allowedTrustDomain = ".system.id.goog";
            }
            defaultAgentPersona = context.getVariable("propertyset.config.auth_agent_persona") || "agent";
            tokenTtlMs = String(context.getVariable("propertyset.config.auth_agent_token_ttl_ms") || "3600000");
            modelArmorRequestTemplate = agentData.model_armor_request_template || agentData.model_armor_template || "";
            modelArmorResponseTemplate = agentData.model_armor_response_template || agentData.model_armor_template || "";

            // Case 3a: SPIFFE-based Google Cloud Agent Identity (spiffe:// or principal:// under *.system.id.goog)
            if (rawPrincipal) {
                var normalizedPrincipal = rawPrincipal.replace(/^spiffe:\/\//i, "principal://");
                if (normalizedPrincipal.indexOf("principal://") !== 0 && normalizedPrincipal.indexOf(".system.id.goog") !== -1) {
                    normalizedPrincipal = "principal://" + normalizedPrincipal.replace(/^\/+/, "");
                }
                var spiffeMatch = normalizedPrincipal.match(/^principal:\/\/([^\/]+)\/resources\/([^\/]+)\/projects\/([^\/]+)\/locations\/([^\/]+)\/(.+)$/i);
                var trustDomain = spiffeMatch ? spiffeMatch[1] : "";
                var lowerPrincipal = normalizedPrincipal.toLowerCase();
                var lowerTrust = String(allowedTrustDomain).toLowerCase();
                var trustValid = (allowedTrustDomain === "*") ||
                                 (lowerTrust.indexOf("*") !== -1 ? (matchesGlob(lowerPrincipal, lowerTrust) || (trustDomain && matchesGlob(trustDomain.toLowerCase(), lowerTrust))) : (lowerPrincipal.indexOf(lowerTrust) !== -1));

                if (trustValid) {
                    isVerified = true;
                    userId = normalizedPrincipal;
                    userEmail = normalizedPrincipal;
                    rawPersonaClaim = [
                        normalizedPrincipal,
                        normalizedPrincipal.replace(/^principal:\/\//i, "spiffe://")
                    ];
                    if (spiffeMatch) {
                        var svcName = spiffeMatch[2];
                        var projNum = spiffeMatch[3];
                        var tailPath = spiffeMatch[5];
                        var tailSegments = tailPath.split("/");
                        var engineId = tailSegments[tailSegments.length - 1];
                        var projectPrincipalSet = "principalSet://" + trustDomain + "/attribute.platformContainer/" + svcName + "/projects/" + projNum;
                        var orgPrincipalSet = "principalSet://" + trustDomain + "/*";
                        if (engineId) rawPersonaClaim.push(engineId);
                        rawPersonaClaim.push(projectPrincipalSet);
                        rawPersonaClaim.push("project:" + projNum);
                        rawPersonaClaim.push(orgPrincipalSet);
                        rawPersonaClaim.push(trustDomain);
                        team = "project:" + projNum;
                    } else {
                        team = agentData.azp || "agents";
                    }
                    rawPersonaClaim.push(defaultAgentPersona);
                }
            }
            // Case 3b: Google Cloud IAM Service Account (*.iam.gserviceaccount.com)
            else {
                var suffixValid = false;
                var lowerEmail = email.toLowerCase();
                var lowerSuffix = String(allowedSuffix).toLowerCase();
                if (allowedSuffix === "*") {
                    suffixValid = Boolean(email || sub);
                } else if (email && lowerSuffix.indexOf("*") !== -1 && matchesGlob(lowerEmail, lowerSuffix)) {
                    suffixValid = true;
                } else if (email && lowerEmail.indexOf(lowerSuffix) !== -1 &&
                           lowerEmail.lastIndexOf(lowerSuffix) === lowerEmail.length - lowerSuffix.length) {
                    suffixValid = true;
                }

                if (suffixValid) {
                    isVerified = true;
                    userId = email || sub;
                    userEmail = email || sub;
                    var emailPrefix = (email && email.indexOf("@") !== -1) ? email.split("@")[0] : "";
                    var saProjMatch = email.match(/@([^.]+)\.iam\.gserviceaccount\.com$/i);
                    var saProject = (saProjMatch && saProjMatch[1]) ? saProjMatch[1] : "";
                    rawPersonaClaim = [];
                    if (email) rawPersonaClaim.push(email);
                    if (emailPrefix) rawPersonaClaim.push(emailPrefix);
                    if (saProject) rawPersonaClaim.push("project:" + saProject);
                    if (sub && sub !== email) rawPersonaClaim.push(sub);
                    rawPersonaClaim.push(defaultAgentPersona);
                    team = saProject ? ("project:" + saProject) : (agentData.azp || "agents");
                }
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
                modelArmorRequestTemplate = idpData.model_armor_request_template || idpData.model_armor_template || "";
                modelArmorResponseTemplate = idpData.model_armor_response_template || idpData.model_armor_template || "";
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
                modelArmorRequestTemplate = context.getVariable("jwt.VJ-VerifyIdpJwt.claim.model_armor_request_template") ||
                                            context.getVariable("jwt.VJ-VerifyIdpJwt.claim.model_armor_template") || "";
                modelArmorResponseTemplate = context.getVariable("jwt.VJ-VerifyIdpJwt.claim.model_armor_response_template") ||
                                             context.getVariable("jwt.VJ-VerifyIdpJwt.claim.model_armor_template") || "";
                tokenTtlMs = String(context.getVariable("propertyset.config.auth_idp_jwt_token_ttl_ms") || "3600000");
            }
        }
    }

    // -------------------------------------------------------------------------
    // Map Verified Identity Claim -> Persona Developer App client_id
    // Supports exact match & linear-time '*' glob patterns, ranked by specificity
    // -------------------------------------------------------------------------
    if (isVerified) {
        var claimValues = normalizeClaimValues(rawPersonaClaim);
        var personasCsv = context.getVariable("propertyset.config.auth_personas_list") || "knowledge-worker,developer,it,agent";
        var personas = personasCsv.split(",");
        var matchedPersona = "";
        var personaClientId = "";
        var bestScore = -1;

        for (var i = 0; i < personas.length; i++) {
            var pName = personas[i].trim();
            if (!pName) continue;

            var candidateClientId = context.getVariable("propertyset.config.persona." + pName + ".client_id") ||
                                    context.getVariable("propertyset.config.persona_" + pName + "_client_id");
            if (!candidateClientId || String(candidateClientId).trim() === "") continue;

            var matchClaimsCsv = context.getVariable("propertyset.config.persona." + pName + ".match_claims") || pName;
            var matchCandidates = normalizeClaimValues(matchClaimsCsv);
            if (matchCandidates.indexOf(pName.toLowerCase()) === -1) {
                matchCandidates.push(pName.toLowerCase());
            }

            for (var c = 0; c < claimValues.length; c++) {
                var claimVal = claimValues[c];
                for (var m = 0; m < matchCandidates.length; m++) {
                    var pattern = matchCandidates[m];
                    if (matchesGlob(claimVal, pattern)) {
                        var score = computeMatchScore(claimVal, pattern, defaultAgentPersona);
                        if (score > bestScore) {
                            bestScore = score;
                            matchedPersona = pName;
                            personaClientId = String(candidateClientId).trim();
                        }
                    }
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
            context.setVariable("auth_quota_override", String(quotaOverride || "unset"));
            context.setVariable("auth_quota_override_expires_at", String(quotaOverrideExpiresAt || "unset"));
            context.setVariable("auth_model_armor_request_template", String(modelArmorRequestTemplate || "unset"));
            context.setVariable("auth_model_armor_response_template", String(modelArmorResponseTemplate || "unset"));
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
