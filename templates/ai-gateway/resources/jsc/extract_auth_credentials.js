(function () {
'use strict';

// ============================================================================
// Extract & Normalize Authentication Credentials (API Key, OAuth, External)
// Supports:
//   Option 1: Apigee API Key (x-apikey, x-api-key, anthropic-api-key, x-goog-api-key, Bearer <api-key>)
//   Option 2: Apigee OAuth Token (Authorization: Bearer <apigee-token>)
//   Option 3: GCP Agent Identity Opaque Token (Authorization: Bearer ya29.*)
//   Option 4: Enterprise IdP Opaque Token or JWT (Authorization: Bearer <token>)
// ============================================================================

try {
    // Default fail-closed 401 error payload
    context.setVariable("auth_error_status", "401");
    context.setVariable("auth_error_payload", JSON.stringify({
        error: {
            type: "authentication_error",
            message: "Missing or invalid authentication credentials. Provide a valid Apigee API Key or Bearer token.",
            code: 401
        }
    }));

    // 1. Normalize explicit API Key headers / query parameters into request.header.x-apikey
    var qpApiKey = context.getVariable("request.queryparam.apikey") ||
                   context.getVariable("request.queryparam.key");
    var explicitApiKey = context.getVariable("request.header.x-apikey") ||
                         context.getVariable("request.header.x-api-key") ||
                         context.getVariable("request.header.anthropic-api-key") ||
                         context.getVariable("request.header.x-goog-api-key") ||
                         context.getVariable("request.header.api-key") ||
                         qpApiKey;
    if (qpApiKey) {
        context.removeVariable("request.queryparam.apikey");
        context.removeVariable("request.queryparam.key");
    }

    var hasApiKey = false;
    if (explicitApiKey && String(explicitApiKey).trim() !== "") {
        var cleanKey = String(explicitApiKey).trim();
        context.setVariable("request.header.x-apikey", cleanKey);
        context.setVariable("client_id", cleanKey);
        context.setVariable("auth_has_apikey", "true");
        hasApiKey = true;
    } else {
        context.setVariable("auth_has_apikey", "false");
    }

    // 2. Extract Bearer token if Authorization header is present
    var authHeader = context.getVariable("request.header.Authorization") ||
                     context.getVariable("request.header.authorization");
    if (authHeader && /^Bearer\s+/i.test(String(authHeader).trim())) {
        var bearerToken = String(authHeader).trim().replace(/^Bearer\s+/i, "").trim();
        if (bearerToken !== "") {
            context.setVariable("auth_bearer_token", bearerToken);

            // Classify token format for first-request external verification routing
            var parts = bearerToken.split(".");
            var tokenType = "idp_opaque";
            if (bearerToken.indexOf("ya29.") === 0) {
                tokenType = "agent_identity";
            } else if (parts.length === 3 && bearerToken.indexOf("eyJ") === 0) {
                tokenType = "idp_jwt";
            }
            context.setVariable("auth_token_type", tokenType);

            // Allow passing an Apigee API key inside Authorization: Bearer <api-key>
            // (used by OpenAI SDK, Codex, Cursor, or claude-cli with ANTHROPIC_AUTH_TOKEN)
            if (!hasApiKey && tokenType === "idp_opaque") {
                var allowBearerApiKey = context.getVariable("propertyset.config.auth_allow_bearer_api_key");
                if (allowBearerApiKey !== "false") {
                    context.setVariable("request.header.x-apikey", bearerToken);
                    context.setVariable("client_id", bearerToken);
                    context.setVariable("auth_try_bearer_as_apikey", "true");
                } else {
                    context.setVariable("auth_try_bearer_as_apikey", "false");
                }
            } else {
                context.setVariable("auth_try_bearer_as_apikey", "false");
            }
        }
    }
} catch (e) {
    print("Error in extract_auth_credentials.js: " + e);
}

})();
