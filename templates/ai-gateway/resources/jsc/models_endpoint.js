(function () {
'use strict';

try {
    var pathSuffix = context.getVariable("proxy.pathsuffix") || "";
    
    // 1. Dynamically load model catalog from propertyset
    var catalogStr = context.getVariable("propertyset.model_locations.models.catalog") || "";
    var catalogIds = catalogStr ? catalogStr.split(",") : [];

    function cleanAttr(val) {
        if (!val) return "";
        var s = String(val).trim();
        return (s === "unset" || s === "null" || s === "undefined") ? "" : s;
    }

    function isSafeSegment(seg) {
        return Boolean(seg) && /^[A-Za-z0-9._:@\/-]+$/.test(String(seg)) && String(seg).indexOf("..") === -1;
    }

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
        for (var gi = 1; gi < segments.length - 1; gi++) {
            var seg = segments[gi];
            if (seg === "") continue;
            var idx = str.indexOf(seg, pos);
            if (idx === -1 || idx + seg.length > endLimit) return false;
            pos = idx + seg.length;
        }
        return true;
    }

    var vaClientId = context.getVariable("verifyapikey.VA-ApiKey.client_id");
    var oauthClientId = context.getVariable("client_id");
    var apiProductName = context.getVariable("apiproduct.name");
    var identityUserId = cleanAttr(context.getVariable("accesstoken.user_id")) ||
                         cleanAttr(context.getVariable("auth_user_id")) ||
                         context.getVariable("verifyapikey.VA-ApiKey.developer.email") ||
                         context.getVariable("developer.email") ||
                         vaClientId ||
                         oauthClientId ||
                         "anonymous";
    var identityPersona = cleanAttr(context.getVariable("accesstoken.persona")) ||
                          cleanAttr(context.getVariable("auth_persona")) ||
                          context.getVariable("verifyapikey.VA-ApiKey.persona") ||
                          context.getVariable("verifyapikey.VA-ApiKey.developer.persona") ||
                          context.getVariable("verifyapikey.VA-ApiKey.apiproduct.persona") ||
                          context.getVariable("apiproduct.persona") ||
                          context.getVariable("verifyapikey.VA-ApiKey.apiproduct.name") ||
                          apiProductName ||
                          context.getVariable("propertyset.config.auth_persona_default") ||
                          "default";
    if (identityPersona && isSafeSegment(identityPersona) && !context.getVariable("propertyset.config.persona." + identityPersona + ".match_claims")) {
        var knownPersonasCsv = context.getVariable("propertyset.config.auth_personas_list") || "";
        if (knownPersonasCsv) {
            var knownPersonas = knownPersonasCsv.split(",");
            var lowerIdPersona = String(identityPersona).toLowerCase();
            for (var kp = 0; kp < knownPersonas.length; kp++) {
                var candPersona = knownPersonas[kp].trim();
                if (!candPersona) continue;
                var suffix = "-" + candPersona.toLowerCase();
                if (lowerIdPersona.length > suffix.length &&
                    lowerIdPersona.lastIndexOf(suffix) === lowerIdPersona.length - suffix.length) {
                    identityPersona = candPersona;
                    break;
                }
            }
        }
    }
    var safePersona = isSafeSegment(identityPersona) ? identityPersona : "default";
    var identityTeam = cleanAttr(context.getVariable("accesstoken.team")) ||
                       cleanAttr(context.getVariable("auth_team")) ||
                       context.getVariable("verifyapikey.VA-ApiKey.team") ||
                       context.getVariable("verifyapikey.VA-ApiKey.developer.team") ||
                       context.getVariable("verifyapikey.VA-ApiKey.apiproduct.team") ||
                       context.getVariable("apiproduct.team") ||
                       "default";

    context.setVariable("response.header.X-Gateway-Identity-Persona", safePersona);

    var ruleAllowedModels = "";
    var rulesCount = parseInt(context.getVariable("propertyset.config.model_armor_identity_rules_count") || "0", 10);
    if (rulesCount > 0) {
        var lowerUserId = String(identityUserId || "").toLowerCase();
        var lowerTeam = String(identityTeam || "").toLowerCase();
        var lowerPersona = String(safePersona || "").toLowerCase();
        var identityCandidates = [lowerUserId];
        if (lowerUserId.indexOf("principal://") === 0) {
            identityCandidates.push(lowerUserId.replace(/^principal:\/\//, "spiffe://"));
        } else if (lowerUserId.indexOf("spiffe://") === 0) {
            identityCandidates.push(lowerUserId.replace(/^spiffe:\/\//, "principal://"));
        }
        if (lowerTeam && lowerTeam !== "default") identityCandidates.push("team:" + lowerTeam);
        if (lowerPersona && lowerPersona !== "default") identityCandidates.push("persona:" + lowerPersona);

        var bestScore = -1;
        for (var r = 0; r < rulesCount; r++) {
            var rulePrefix = "propertyset.config.model_armor.rule." + r + ".";
            var ruleMatchCsv = context.getVariable(rulePrefix + "match") || "";
            var rModels = context.getVariable(rulePrefix + "models") || "";
            if (!ruleMatchCsv || !rModels) continue;
            var rawRulePatterns = ruleMatchCsv.split(",");
            var normRulePatterns = [];
            for (var rpi = 0; rpi < rawRulePatterns.length; rpi++) {
                var cleanPat = rawRulePatterns[rpi].replace(/^[\[\]"\s]+|[\[\]"\s]+$/g, "").toLowerCase();
                if (cleanPat) normRulePatterns.push(cleanPat);
            }
            if (normRulePatterns.length === 0) continue;

            for (var ic = 0; ic < identityCandidates.length; ic++) {
                var idCand = identityCandidates[ic];
                if (!idCand) continue;
                for (var rp = 0; rp < normRulePatterns.length; rp++) {
                    var pat = normRulePatterns[rp];
                    if (matchesGlob(idCand, pat)) {
                        var isExact = (pat.indexOf("*") === -1);
                        var score = (isExact ? 40500 : 30000) + pat.replace(/\*/g, "").length;
                        if (score > bestScore) {
                            bestScore = score;
                            ruleAllowedModels = String(rModels).trim();
                        }
                    }
                }
            }
        }
    }

    // Optional filtering by Exception / Persona / Developer App / API Product entitlements
    var allowedByProduct = cleanAttr(context.getVariable("accesstoken.allowed_models")) ||
                           ruleAllowedModels ||
                           context.getVariable("verifyapikey.VA-ApiKey.allowed_models") ||
                           context.getVariable("verifyapikey.VA-ApiKey.developer.allowed_models") ||
                           context.getVariable("propertyset.config.persona." + safePersona + ".models") ||
                           context.getVariable("verifyapikey.VA-ApiKey.apiproduct.allowed_models") ||
                           context.getVariable("apiproduct.allowed_models") || 
                           context.getVariable("apiproduct.allowed-models") ||
                           context.getVariable("apiproduct.custom.allowed_models");
    var trimmedAllowed = allowedByProduct ? String(allowedByProduct).trim() : "";
    if (trimmedAllowed !== "" && trimmedAllowed !== "*") {
        var rawAllowedList = trimmedAllowed.split(",");
        var allowedList = [];
        var hasWildcardAll = false;
        for (var ali = 0; ali < rawAllowedList.length; ali++) {
            var aPat = rawAllowedList[ali].replace(/^[\[\]"\s]+|[\[\]"\s]+$/g, "").toLowerCase();
            if (!aPat) continue;
            if (aPat === "*") {
                hasWildcardAll = true;
                break;
            }
            allowedList.push(aPat);
        }
        if (!hasWildcardAll) {
            catalogIds = catalogIds.filter(function(id) {
                var cleanId = id.trim().toLowerCase();
                for (var ai = 0; ai < allowedList.length; ai++) {
                    if (matchesGlob(cleanId, allowedList[ai])) return true;
                }
                return false;
            });
        }
    }

    function buildModelObject(id, dispOverride) {
        var safeId = isSafeSegment(id) ? id : "unknown";
        var displayName = dispOverride || context.getVariable("propertyset.model_locations." + safeId + ".display_name") || id;
        var createdAt = context.getVariable("propertyset.model_locations." + safeId + ".created_at") || "2025-01-01T00:00:00Z";
        var publisher = context.getVariable("propertyset.model_locations." + safeId + ".publisher") || "google";
        return {
            "type": "model",
            "id": id,
            "display_name": displayName,
            "created_at": createdAt,
            "owned_by": publisher
        };
    }

    if (pathSuffix === "" || pathSuffix === "/") {
        // Build model list dynamically from propertyset definitions only when listing all models
        var models = [];
        for (var i = 0; i < catalogIds.length; i++) {
            var modelId = catalogIds[i].trim();
            if (modelId) {
                models.push(buildModelObject(modelId, null));
            }
        }

        // List Models
        var responsePayload = {
            "object": "list",
            "data": models,
            "has_more": false,
            "first_id": models.length > 0 ? models[0].id : null,
            "last_id": models.length > 0 ? models[models.length - 1].id : null
        };
        
        context.setVariable("response.content", JSON.stringify(responsePayload));
        context.setVariable("response.header.Content-Type", "application/json");
        context.setVariable("response.status.code", 200);
    } else {
        // Retrieve Single Model Details
        var requestedId = pathSuffix.substring(1).replace(/^\/+|\/+$/g, "").trim();
        
        // Check for alias (e.g. gemini-1.5-flash -> gemini-3.5-flash)
        var aliasTarget = isSafeSegment(requestedId)
            ? context.getVariable("propertyset.model_locations.alias." + requestedId)
            : null;
        var effectiveId = aliasTarget || requestedId;

        var foundModel = null;
        for (var j = 0; j < catalogIds.length; j++) {
            if (catalogIds[j].trim() === effectiveId) {
                foundModel = buildModelObject(effectiveId, null);
                break;
            }
        }

        // If not found in catalog list, check direct propertyset definition
        if (!foundModel && !trimmedAllowed && isSafeSegment(effectiveId)) {
            var dispName = context.getVariable("propertyset.model_locations." + effectiveId + ".display_name");
            if (dispName) {
                foundModel = buildModelObject(effectiveId, dispName);
            }
        }

        if (foundModel) {
            context.setVariable("response.content", JSON.stringify(foundModel));
            context.setVariable("response.header.Content-Type", "application/json");
            context.setVariable("response.status.code", 200);
        } else {
            var errorPayload = {
                "error": {
                    "type": "not_found_error",
                    "message": "Model not found: " + requestedId
                }
            };
            context.setVariable("response.content", JSON.stringify(errorPayload));
            context.setVariable("response.header.Content-Type", "application/json");
            context.setVariable("response.status.code", 404);
        }
    }
} catch (e) {
    context.setVariable("private.models.error", String(e));
    var errPayload = {
        "error": {
            "type": "api_error",
            "message": "Internal gateway error processing models request"
        }
    };
    context.setVariable("response.content", JSON.stringify(errPayload));
    context.setVariable("response.header.Content-Type", "application/json");
    context.setVariable("response.status.code", 500);
}

})();
