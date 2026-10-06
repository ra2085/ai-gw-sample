(function () {
'use strict';

try {
    var rawFallbackModel = context.getVariable("fallback_model");
    var allowFallbacks = context.getVariable("allow_fallbacks") !== "false";
    if (!rawFallbackModel || String(rawFallbackModel).trim() === "" || !allowFallbacks) {
        context.setVariable("fallback_ready", "false");
        return;
    }

    var fallbackModel = String(rawFallbackModel).trim();
    var candPrefix = null;
    if (fallbackModel.indexOf("/") !== -1) {
        var slashIdx = fallbackModel.indexOf("/");
        candPrefix = fallbackModel.substring(0, slashIdx);
        fallbackModel = fallbackModel.substring(slashIdx + 1);
    } else {
        var savedPrefixesStr = context.getVariable("resolved_prefixes_json");
        if (savedPrefixesStr) {
            try {
                var savedPrefixes = JSON.parse(savedPrefixesStr);
                if (Array.isArray(savedPrefixes) && savedPrefixes[1]) {
                    candPrefix = savedPrefixes[1];
                }
            } catch (ignorePrefErr) {}
        }
    }

    function isOpenAiModelName(m) {
        if (!m) return false;
        return m.indexOf("gpt-") === 0 ||
               m.indexOf("o1") === 0 ||
               m.indexOf("o3") === 0 ||
               m.indexOf("o4") === 0 ||
               m.indexOf("text-embedding-3-") === 0 ||
               m.indexOf("text-embedding-ada-") === 0;
    }

    function isGoogleCloudUrl(url) {
        if (!url) return true;
        var match = String(url).match(/^https:\/\/([a-z0-9-]+)(?::[0-9]+)?(?:\.googleapis\.com)(\/|$)/i);
        if (!match) return false;
        var sub = match[1].toLowerCase();
        return sub === "aiplatform" || sub.slice(-11) === "-aiplatform";
    }

    function isSafeSegment(seg) {
        if (!seg) return false;
        var s = String(seg);
        return s.indexOf("..") === -1 && s.indexOf("/") === -1 && s.indexOf("?") === -1 && s.indexOf("#") === -1 && s.indexOf("\\") === -1 && s.indexOf("%") === -1 && !/[\r\n\0]/.test(s);
    }

    if (candPrefix && !isSafeSegment(candPrefix)) {
        candPrefix = null;
    }
    if (!isSafeSegment(fallbackModel)) {
        context.setVariable("fallback_ready", "false");
        return;
    }

    var defaultPublisher = context.getVariable("propertyset.model_locations.default.publisher") || "google";
    var defaultFormat = context.getVariable("propertyset.model_locations.default.format") || "gemini";
    var projectId = context.getVariable("propertyset.config.project_id") ||
                    context.getVariable("propertyset.config.gcp_project_id") ||
                    context.getVariable("organization.name") || "";
    var requestFormat = (context.getVariable("request_format") || "claude").toLowerCase();
    var isEmbeddings = context.getVariable("is_embeddings") === "true" || fallbackModel.indexOf("embedding") !== -1;
    var defaultLoc = isEmbeddings ? "us-central1" : "global";

    var configuredPublisher = context.getVariable("propertyset.model_locations." + fallbackModel + ".publisher");
    var publisher = configuredPublisher || candPrefix || (isOpenAiModelName(fallbackModel) ? "openai" : defaultPublisher);

    var customUrl = context.getVariable("verifyapikey.VA-ApiKey." + fallbackModel + "_url") ||
                    context.getVariable("propertyset.model_locations." + fallbackModel + ".url");

    if (publisher === "openai" && !customUrl) {
        var openAiBaseUrl = context.getVariable("verifyapikey.VA-ApiKey.openai_base_url") ||
                            context.getVariable("propertyset.config.openai_base_url") ||
                            "https://api.openai.com/v1";
        openAiBaseUrl = openAiBaseUrl.replace(/\/+$/, "");
        customUrl = openAiBaseUrl + (isEmbeddings ? "/embeddings" : "/chat/completions");
    }

    var configuredFormat = context.getVariable("propertyset.model_locations." + fallbackModel + ".format");
    var fallbackFormat = (configuredFormat || (publisher === "anthropic" ? "anthropic" : ((publisher !== "google" || customUrl) ? "openai" : defaultFormat))).toLowerCase();

    var fallbackEndpointLoc = defaultLoc;
    var fallbackModelLoc = defaultLoc;
    if (publisher === "anthropic") {
        fallbackEndpointLoc = context.getVariable("propertyset.model_locations.default_claude.endpoint") || "us-east5";
        fallbackModelLoc = context.getVariable("propertyset.model_locations.default_claude.model") || "us-east5";
    } else if (fallbackFormat === "openai" && publisher !== "google" && !customUrl) {
        fallbackEndpointLoc = context.getVariable("propertyset.model_locations.default_openai.endpoint") || defaultLoc;
        fallbackModelLoc = context.getVariable("propertyset.model_locations.default_openai.model") || defaultLoc;
    }

    var endpointLocation = context.getVariable("propertyset.model_locations." + fallbackModel + ".endpoint") || fallbackEndpointLoc;
    var modelLocation = context.getVariable("propertyset.model_locations." + fallbackModel + ".model") || fallbackModelLoc;
    if (!/^[a-z0-9-]+$/i.test(endpointLocation)) endpointLocation = defaultLoc;
    if (!/^[a-z0-9-]+$/i.test(modelLocation)) modelLocation = defaultLoc;
    var endpointHost = (endpointLocation && endpointLocation !== "global") ? (endpointLocation + "-aiplatform.googleapis.com") : "aiplatform.googleapis.com";

    var authType = context.getVariable("verifyapikey.VA-ApiKey." + fallbackModel + "_auth_type") ||
                   context.getVariable("propertyset.model_locations." + fallbackModel + ".auth_type");

    var normAuthType = authType ? String(authType).toLowerCase() : "";
    var isGoogleUrl = isGoogleCloudUrl(customUrl);
    var useGoogleIam = isGoogleUrl && ((publisher !== "openai" && normAuthType !== "bearer" && normAuthType !== "header" && normAuthType !== "apikey" && normAuthType !== "api_key") || normAuthType === "google_iam");

    // -------------------------------------------------------------------------
    // 1. Build Target URL for Synchronous ServiceCallout (Non-Streaming JSON)
    // -------------------------------------------------------------------------
    var targetUrl = "";
    if (customUrl) {
        targetUrl = customUrl;
        if (fallbackFormat === "anthropic" && targetUrl.indexOf(":streamRawPredict") !== -1) {
            targetUrl = targetUrl.replace(":streamRawPredict", ":rawPredict");
        } else if (fallbackFormat === "gemini" && targetUrl.indexOf(":streamGenerateContent") !== -1) {
            targetUrl = targetUrl.replace(":streamGenerateContent", ":generateContent").replace(/\?alt=sse(&|$)/, "");
        } else if (isEmbeddings && targetUrl.indexOf("/chat/completions") !== -1) {
            targetUrl = targetUrl.replace(/\/chat\/completions\/?$/, "/embeddings");
        }
    } else if (fallbackFormat === "gemini") {
        if (isEmbeddings) {
            var embLoc = (modelLocation && modelLocation !== "global") ? modelLocation : "us-central1";
            var predictHost = (endpointHost === "aiplatform.googleapis.com") ? (embLoc + "-aiplatform.googleapis.com") : endpointHost;
            targetUrl = "https://" + predictHost + "/v1/projects/" + projectId + "/locations/" + embLoc + "/publishers/google/models/" + fallbackModel + ":predict";
        } else {
            targetUrl = "https://" + endpointHost + "/v1/projects/" + projectId + "/locations/" + modelLocation + "/publishers/google/models/" + fallbackModel + ":generateContent";
        }
    } else if (fallbackFormat === "anthropic") {
        targetUrl = "https://" + endpointHost + "/v1/projects/" + projectId + "/locations/" + modelLocation + "/publishers/anthropic/models/" + fallbackModel + ":rawPredict";
    } else {
        targetUrl = "https://" + endpointHost + "/v1/projects/" + projectId + "/locations/" + modelLocation + "/endpoints/openapi/" + (isEmbeddings ? "embeddings" : "chat/completions");
    }

    var hostAndPath = targetUrl.replace(/^https?:\/\//i, "");
    var firstSlashIdx = hostAndPath.indexOf("/");
    var targetHost = (firstSlashIdx !== -1) ? hostAndPath.substring(0, firstSlashIdx) : hostAndPath;
    var targetPath = (firstSlashIdx !== -1) ? hostAndPath.substring(firstSlashIdx + 1) : "";
    context.setVariable("fallback_target_host", targetHost);
    context.setVariable("fallback_target_path", targetPath);
    context.setVariable("fallback_target_host_and_path", hostAndPath);

    // -------------------------------------------------------------------------
    // 2. Resolve Upstream Auth Credentials for External / BYO Fallback Models
    // -------------------------------------------------------------------------
    function isSafeTokenRef(ref) {
        if (!ref) return false;
        var r = String(ref).trim();
        if (r.indexOf("..") !== -1 || /[\r\n\0\s]/.test(r)) return false;
        return /^(propertyset\.[a-zA-Z0-9_.-]+|private\.[a-zA-Z0-9_.-]+|(?:verifyapikey\.VA-ApiKey\.)?apiproduct\.[a-zA-Z0-9_.-]+)$/.test(r);
    }

    if (!useGoogleIam) {
        var authHeader = context.getVariable("verifyapikey.VA-ApiKey." + fallbackModel + "_auth_header") ||
                         context.getVariable("verifyapikey.VA-ApiKey.upstream_auth_header") ||
                         context.getVariable("propertyset.model_locations." + fallbackModel + ".auth_header");

        var clientKeyRef = context.getVariable("verifyapikey.VA-ApiKey." + fallbackModel + "_api_key_ref") ||
                           context.getVariable("verifyapikey.VA-ApiKey." + publisher + "_api_key_ref") ||
                           (publisher === "openai" ? context.getVariable("verifyapikey.VA-ApiKey.openai_api_key_ref") : null) ||
                           context.getVariable("verifyapikey.VA-ApiKey.upstream_api_key_ref");
        var tokenVal = (isSafeTokenRef(clientKeyRef) ? context.getVariable(String(clientKeyRef).trim()) : null) ||
                       context.getVariable("verifyapikey.VA-ApiKey." + fallbackModel + "_api_key") ||
                       context.getVariable("verifyapikey.VA-ApiKey." + publisher + "_api_key") ||
                       (publisher === "openai" ? context.getVariable("verifyapikey.VA-ApiKey.openai_api_key") : null) ||
                       context.getVariable("verifyapikey.VA-ApiKey.upstream_api_key");

        if (!tokenVal) {
            var productKeyRef = context.getVariable("apiproduct." + fallbackModel + "_api_key_ref") ||
                                context.getVariable("apiproduct." + publisher + "_api_key_ref") ||
                                (publisher === "openai" ? context.getVariable("apiproduct.openai_api_key_ref") : null) ||
                                context.getVariable("apiproduct.upstream_api_key_ref");
            tokenVal = (isSafeTokenRef(productKeyRef) ? context.getVariable(String(productKeyRef).trim()) : null) ||
                       context.getVariable("apiproduct." + fallbackModel + "_api_key") ||
                       context.getVariable("apiproduct." + publisher + "_api_key") ||
                       (publisher === "openai" ? context.getVariable("apiproduct.openai_api_key") : null) ||
                       context.getVariable("apiproduct.upstream_api_key");
        }
        if (!tokenVal) {
            var authTokenRef = context.getVariable("propertyset.model_locations." + fallbackModel + ".auth_token_ref");
            tokenVal = (isSafeTokenRef(authTokenRef) ? context.getVariable(String(authTokenRef).trim()) : null) ||
                       context.getVariable("propertyset.model_locations." + fallbackModel + ".auth_token") ||
                       context.getVariable("propertyset.config." + publisher + "_api_key") ||
                       (publisher === "openai" ? context.getVariable("propertyset.config.openai_api_key") : null);
        }

        if (tokenVal && normAuthType !== "none" && normAuthType !== "google_iam") {
            var isCustomHeader = Boolean(authHeader && String(authHeader).toLowerCase() !== "authorization");
            if (isCustomHeader) {
                var lowerH = authHeader.toLowerCase();
                if (lowerH === "x-api-key") {
                    context.setVariable("private.fallback_header_x_api_key", tokenVal);
                } else if (lowerH === "api-key") {
                    context.setVariable("private.fallback_header_api_key", tokenVal);
                }
            } else if (normAuthType === "header" && authHeader && authHeader.toLowerCase() === "authorization") {
                context.setVariable("private.fallback_auth_authorization", tokenVal);
            } else {
                context.setVariable("private.fallback_auth_authorization", "Bearer " + tokenVal);
            }
        }

        var openaiOrgId = context.getVariable("verifyapikey.VA-ApiKey.openai_org_id") ||
                          context.getVariable("apiproduct.openai_org_id") ||
                          context.getVariable("propertyset.model_locations." + fallbackModel + ".openai_org_id") ||
                          context.getVariable("propertyset.config.openai_org_id");
        if (openaiOrgId) {
            context.setVariable("fallback_openai_org", openaiOrgId);
        }

        var openaiProjectId = context.getVariable("verifyapikey.VA-ApiKey.openai_project_id") ||
                              context.getVariable("apiproduct.openai_project_id") ||
                              context.getVariable("propertyset.model_locations." + fallbackModel + ".openai_project_id") ||
                              context.getVariable("propertyset.config.openai_project_id");
        if (openaiProjectId) {
            context.setVariable("fallback_openai_project", openaiProjectId);
        }
    }

    // -------------------------------------------------------------------------
    // 3. Transcode Client Payload (raw_client_payload) -> fallbackFormat
    // -------------------------------------------------------------------------
    var rawPayloadStr = context.getVariable("raw_client_payload") || context.getVariable("request.content") || "{}";
    var rawBody = JSON.parse(rawPayloadStr);
    delete rawBody.models;
    delete rawBody.plugins;
    delete rawBody.provider;
    delete rawBody.stream;
    delete rawBody.stream_options;

    // Extract normalized conversation turns & parameters for cross-format transcoding
    var normSystem = "";
    var normMessages = []; // [{ role: "user" | "assistant", text: "..." }]
    var normMaxTokens = rawBody.max_tokens || rawBody.max_completion_tokens || (rawBody.generationConfig && rawBody.generationConfig.maxOutputTokens);
    var normTemp = (rawBody.temperature !== undefined) ? rawBody.temperature : (rawBody.generationConfig ? rawBody.generationConfig.temperature : undefined);
    var normTopP = (rawBody.top_p !== undefined) ? rawBody.top_p : (rawBody.generationConfig ? rawBody.generationConfig.topP : undefined);

    if (requestFormat === "gemini" || Array.isArray(rawBody.contents)) {
        if (rawBody.systemInstruction && Array.isArray(rawBody.systemInstruction.parts)) {
            var gSys = [];
            for (var gs = 0; gs < rawBody.systemInstruction.parts.length; gs++) {
                if (rawBody.systemInstruction.parts[gs] && rawBody.systemInstruction.parts[gs].text) {
                    gSys.push(rawBody.systemInstruction.parts[gs].text);
                }
            }
            normSystem = gSys.join("\n");
        }
        if (Array.isArray(rawBody.contents)) {
            for (var gc = 0; gc < rawBody.contents.length; gc++) {
                var gTurn = rawBody.contents[gc];
                if (!gTurn || !Array.isArray(gTurn.parts)) continue;
                var gTexts = [];
                for (var gp = 0; gp < gTurn.parts.length; gp++) {
                    if (gTurn.parts[gp] && gTurn.parts[gp].text) {
                        gTexts.push(gTurn.parts[gp].text);
                    }
                }
                normMessages.push({
                    role: gTurn.role === "model" ? "assistant" : "user",
                    text: gTexts.join("\n")
                });
            }
        }
    } else {
        // Anthropic or OpenAI input
        if (rawBody.system) {
            if (typeof rawBody.system === "string") {
                normSystem = rawBody.system;
            } else if (Array.isArray(rawBody.system)) {
                var aSys = [];
                for (var asIdx = 0; asIdx < rawBody.system.length; asIdx++) {
                    var sb = rawBody.system[asIdx];
                    if (typeof sb === "string") aSys.push(sb);
                    else if (sb && sb.text) aSys.push(sb.text);
                }
                normSystem = aSys.join("\n");
            }
        }
        if (Array.isArray(rawBody.messages)) {
            for (var mIdx = 0; mIdx < rawBody.messages.length; mIdx++) {
                var m = rawBody.messages[mIdx];
                if (!m) continue;
                var mText = "";
                if (typeof m.content === "string") {
                    mText = m.content;
                } else if (Array.isArray(m.content)) {
                    var mParts = [];
                    for (var mp = 0; mp < m.content.length; mp++) {
                        if (m.content[mp] && m.content[mp].text) {
                            mParts.push(m.content[mp].text);
                        }
                    }
                    mText = mParts.join("\n");
                }
                if (m.role === "system" || m.role === "developer") {
                    normSystem += (normSystem ? "\n" : "") + mText;
                } else {
                    normMessages.push({
                        role: m.role === "assistant" ? "assistant" : "user",
                        text: mText
                    });
                }
            }
        }
    }

    var fallbackPayload = {};
    var upstreamModel = context.getVariable("propertyset.model_locations." + fallbackModel + ".upstream_model");

    if (fallbackFormat === "openai") {
        var isVertexOpenApi = (targetUrl.indexOf("googleapis.com") !== -1 && targetUrl.indexOf("/endpoints/openapi/") !== -1);
        var oaiModelName = upstreamModel || (isVertexOpenApi ? (publisher + "/" + fallbackModel) : fallbackModel);

        if (requestFormat === "openai") {
            fallbackPayload = rawBody;
            fallbackPayload.model = oaiModelName;
        } else {
            var oaiMsgs = [];
            if (normSystem) {
                oaiMsgs.push({ role: "system", content: normSystem });
            }
            for (var om = 0; om < normMessages.length; om++) {
                oaiMsgs.push({ role: normMessages[om].role, content: normMessages[om].text });
            }
            fallbackPayload = {
                model: oaiModelName,
                messages: oaiMsgs
            };
            if (normMaxTokens !== undefined) fallbackPayload.max_tokens = normMaxTokens;
            if (normTemp !== undefined) fallbackPayload.temperature = normTemp;
            if (normTopP !== undefined) fallbackPayload.top_p = normTopP;
        }
    } else if (fallbackFormat === "anthropic") {
        if (requestFormat === "claude" && !Array.isArray(rawBody.contents)) {
            fallbackPayload = rawBody;
            fallbackPayload.anthropic_version = "vertex-2023-10-16";
            if (!customUrl) {
                delete fallbackPayload.model;
            } else {
                fallbackPayload.model = upstreamModel || fallbackModel;
            }
        } else {
            var antMsgs = [];
            for (var am = 0; am < normMessages.length; am++) {
                antMsgs.push({ role: normMessages[am].role, content: normMessages[am].text });
            }
            fallbackPayload = {
                anthropic_version: "vertex-2023-10-16",
                max_tokens: normMaxTokens || 4096,
                messages: antMsgs
            };
            if (normSystem) fallbackPayload.system = normSystem;
            if (normTemp !== undefined) fallbackPayload.temperature = normTemp;
            if (normTopP !== undefined) fallbackPayload.top_p = normTopP;
            if (customUrl) {
                fallbackPayload.model = upstreamModel || fallbackModel;
            }
        }
    } else {
        // fallbackFormat === "gemini"
        if (isEmbeddings && requestFormat === "openai") {
            var instances = [];
            if (Array.isArray(rawBody.input)) {
                for (var ei = 0; ei < rawBody.input.length; ei++) {
                    instances.push({ content: String(rawBody.input[ei]) });
                }
            } else if (rawBody.input !== undefined) {
                instances.push({ content: String(rawBody.input) });
            }
            fallbackPayload = { instances: instances };
            if (rawBody.dimensions) {
                fallbackPayload.parameters = { outputDimensionality: parseInt(rawBody.dimensions, 10) };
            }
        } else if (requestFormat === "gemini" && Array.isArray(rawBody.contents)) {
            fallbackPayload = rawBody;
        } else {
            var gemContents = [];
            for (var gm = 0; gm < normMessages.length; gm++) {
                gemContents.push({
                    role: normMessages[gm].role === "assistant" ? "model" : "user",
                    parts: [{ text: normMessages[gm].text }]
                });
            }
            fallbackPayload = {
                contents: gemContents
            };
            if (normSystem) {
                fallbackPayload.systemInstruction = { parts: [{ text: normSystem }] };
            }
            var genConfig = {};
            if (normMaxTokens !== undefined) genConfig.maxOutputTokens = normMaxTokens;
            if (normTemp !== undefined) genConfig.temperature = normTemp;
            if (normTopP !== undefined) genConfig.topP = normTopP;
            if (Object.keys(genConfig).length > 0) {
                fallbackPayload.generationConfig = genConfig;
            }
        }
    }

    context.setVariable("fallback_model", fallbackModel);
    context.setVariable("fallback_format", fallbackFormat);
    context.setVariable("fallback_publisher", publisher);
    context.setVariable("fallback_use_google_iam", useGoogleIam ? "true" : "false");
    context.setVariable("fallback_request_payload", JSON.stringify(fallbackPayload));
    context.setVariable("fallback_ready", "true");

} catch (e) {
    print("Error preparing fallback request: " + e);
    context.setVariable("fallback_ready", "false");
}

})();
