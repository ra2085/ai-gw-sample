(function () {
'use strict';

/**
 * Formats HTTP 429 Too Many Requests responses and rate-limit headers
 * across Anthropic (/v1/messages), OpenAI (/v1/chat/completions, /v1/embeddings),
 * and Gemini (/ai-gateway) protocols when burst rate, concurrency, or token quotas trip.
 */
try {
    var requestFormat = context.getVariable("request_format") || "";
    var proxyName = context.getVariable("proxy.name") || "";
    if (!requestFormat) {
        if (proxyName.indexOf("openai") !== -1) {
            requestFormat = "openai";
        } else if (proxyName.indexOf("gemini") !== -1) {
            requestFormat = "gemini";
        } else {
            requestFormat = "claude";
        }
    }

    var saFailed = String(context.getVariable("ratelimit.SA-BurstRateLimit.failed")) === "true" ||
                   context.getVariable("fault.name") === "SpikeArrestViolation";
    var concFailed = String(context.getVariable("ratelimit.Q-ConcurrencyLimit.failed")) === "true";
    var secQuotaFailed = String(context.getVariable("ratelimit.LTQ-SecondaryEnforceOnly.failed")) === "true";
    var priQuotaFailed = String(context.getVariable("ratelimit.LTQ-EnforceOnly.failed")) === "true";

    var constraint = "rate_limit";
    var retryAfterSec = 1;
    var message = "";

    var burstRate = context.getVariable("burst_rate_limit") ||
                    context.getVariable("propertyset.config.default_burst_rate") ||
                    "600pm";
    var concAllowed = context.getVariable("ratelimit.Q-ConcurrencyLimit.allowed.count") ||
                      context.getVariable("concurrency_limit") ||
                      context.getVariable("propertyset.config.default_concurrency_limit") ||
                      "20";
    var concAvail = context.getVariable("ratelimit.Q-ConcurrencyLimit.available.count") || "0";

    var tokenAllowed = context.getVariable("ratelimit.LTQ-EnforceOnly.allowed.count") || "0";
    var tokenAvail = context.getVariable("ratelimit.LTQ-EnforceOnly.available.count") || "0";
    var expiryTime = parseInt(context.getVariable("ratelimit.LTQ-EnforceOnly.expiry.time") || "0", 10);

    if (saFailed) {
        constraint = "burst_rate_limit";
        retryAfterSec = 1;
        message = "Burst rate limit exceeded (" + burstRate + "). Too many requests sent in a short interval; please back off and retry after " + retryAfterSec + "s.";
    } else if (concFailed) {
        constraint = "concurrency_limit";
        retryAfterSec = 2;
        concAvail = "0";
        message = "Concurrency limit exceeded (max " + concAllowed + " simultaneous active requests per application). Please wait for an in-flight request to complete and retry after " + retryAfterSec + "s.";
    } else if (secQuotaFailed) {
        var secScope = context.getVariable("secondary_quota_scope") || "user";
        var identityTeam = context.getVariable("identity_team") || "default";
        tokenAllowed = context.getVariable("ratelimit.LTQ-SecondaryEnforceOnly.allowed.count") || tokenAllowed;
        tokenAvail = "0";
        var secExpiry = parseInt(context.getVariable("ratelimit.LTQ-SecondaryEnforceOnly.expiry.time") || "0", 10);
        if (secExpiry > Date.now()) {
            retryAfterSec = Math.max(1, Math.ceil((secExpiry - Date.now()) / 1000));
        } else {
            retryAfterSec = 3600;
        }
        if (secScope === "team") {
            constraint = "team_budget_quota";
            message = "Team token budget exceeded for team '" + identityTeam + "' (limit: " + tokenAllowed + " tokens). Please retry after " + retryAfterSec + "s.";
        } else {
            constraint = "token_quota_secondary";
            message = "Secondary rolling-window token quota exceeded (limit: " + tokenAllowed + " tokens). Please retry after " + retryAfterSec + "s.";
        }
    } else {
        var llmModelQuota = context.getVariable("verifyapikey.VA-ApiKey.apiproduct.developer.llmQuota.limit") ||
                            context.getVariable("apiproduct.developer.llmQuota.limit");
        var exceptionActive = String(context.getVariable("quota_exception_active")) === "true";
        var targetModel = context.getVariable("model") || "requested model";
        tokenAvail = "0";
        if (expiryTime > Date.now()) {
            retryAfterSec = Math.max(1, Math.ceil((expiryTime - Date.now()) / 1000));
        } else {
            retryAfterSec = 60;
        }
        if (exceptionActive) {
            constraint = "individual_exception_quota";
            message = "Individual exception token quota exceeded (limit: " + tokenAllowed + " tokens). Please retry after " + retryAfterSec + "s.";
        } else if (llmModelQuota) {
            constraint = "per_model_quota";
            message = "Per-model token quota exceeded for model '" + targetModel + "' (limit: " + tokenAllowed + " tokens). Please retry after " + retryAfterSec + "s.";
        } else {
            constraint = "token_quota_primary";
            message = "Rolling-window token quota exceeded (limit: " + tokenAllowed + " tokens). Please retry after " + retryAfterSec + "s.";
        }
    }

    var errorPayloadObj;
    if (requestFormat === "openai") {
        errorPayloadObj = {
            error: {
                message: message,
                type: "rate_limit_error",
                param: constraint,
                code: "rate_limit_exceeded",
                retry_after_seconds: retryAfterSec
            }
        };
    } else if (requestFormat === "gemini") {
        errorPayloadObj = {
            error: {
                code: 429,
                message: message,
                status: "RESOURCE_EXHAUSTED",
                details: [
                    {
                        "@type": "type.googleapis.com/google.rpc.ErrorInfo",
                        reason: "RATE_LIMIT_EXCEEDED",
                        domain: "apigee.googleapis.com",
                        metadata: {
                            constraint: constraint,
                            retry_after_seconds: String(retryAfterSec)
                        }
                    }
                ]
            }
        };
    } else {
        errorPayloadObj = {
            type: "error",
            error: {
                type: "rate_limit_error",
                message: message,
                constraint: constraint,
                retry_after_seconds: retryAfterSec
            }
        };
    }

    context.setVariable("ratelimit_constraint", constraint);
    context.setVariable("ratelimit_retry_after", String(retryAfterSec));
    context.setVariable("ratelimit_limit_requests", String(concAllowed));
    context.setVariable("ratelimit_remaining_requests", String(concAvail));
    context.setVariable("ratelimit_limit_tokens", String(tokenAllowed));
    context.setVariable("ratelimit_remaining_tokens", String(tokenAvail));
    context.setVariable("ratelimit_error_payload", JSON.stringify(errorPayloadObj));
} catch (e) {
    print("Error formatting 429 rate limit response: " + e);
}

})();
