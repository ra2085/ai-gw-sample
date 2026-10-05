(function () {
'use strict';

try {
    var extractedModel = context.getVariable("model");
    var bodyStr = context.getVariable("request.content") || "";
    
    var defaultModel = context.getVariable("propertyset.model_locations.default.model") || "gemini-3.5-flash";
    var defaultFallback = context.getVariable("propertyset.model_locations.default.fallback") || "gemini-3.1-flash-lite";
    var defaultPublisher = context.getVariable("propertyset.model_locations.default.publisher") || "google";
    var defaultTarget = context.getVariable("propertyset.model_locations.default.target") || "gemini";
    var defaultFormat = context.getVariable("propertyset.model_locations.default.format") || "gemini";

    var requestedModel = extractedModel || "default";
    var primaryModel = extractedModel || defaultModel;
    var fallbackModel = null;
    var costTier = null;
    var allowFallbacks = true;
    var explicitPublisher = context.getVariable("input_publisher_prefix") || null;

    // Normalize slash-prefixed extractedModel (e.g. meta/llama-3.3-70b-instruct-maas)
    var bareExtractedModel = extractedModel;
    if (extractedModel && extractedModel.indexOf("/") !== -1) {
        var extSlashIdx = extractedModel.indexOf("/");
        var extPrefix = extractedModel.substring(0, extSlashIdx);
        if (extPrefix !== "gateway" && extPrefix !== "auto") {
            explicitPublisher = explicitPublisher || extPrefix;
            bareExtractedModel = extractedModel.substring(extSlashIdx + 1);
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

    function matchesArmorGlob(str, pattern) {
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

    var varMemo = {};
    function getVarOnce(k) {
        if (!Object.prototype.hasOwnProperty.call(varMemo, k)) {
            varMemo[k] = context.getVariable(k);
        }
        return varMemo[k];
    }

    function getProductAllowedModels() {
        return getVarOnce("apiproduct.allowed_models");
    }

    var hasClientOpenAiKeyCached = null;
    function hasClientOpenAiKey() {
        if (hasClientOpenAiKeyCached === null) {
            hasClientOpenAiKeyCached = !!(
                getVarOnce("verifyapikey.VA-ApiKey.openai_api_key") ||
                getVarOnce("verifyapikey.VA-ApiKey.openai_api_key_ref") ||
                getVarOnce("apiproduct.openai_api_key") ||
                getVarOnce("apiproduct.openai_api_key_ref") ||
                getVarOnce("request.header.X-Upstream-Provider") === "openai"
            );
        }
        return hasClientOpenAiKeyCached;
    }

    function shouldBypassAlias(m, pubPrefix) {
        if (!m) return false;
        if (pubPrefix === "openai") return true;
        if (getVarOnce("propertyset.model_locations." + m + ".publisher")) return true;
        if (getVarOnce("verifyapikey.VA-ApiKey." + m + "_api_key") ||
            getVarOnce("verifyapikey.VA-ApiKey." + m + "_api_key_ref")) return true;
        if (isOpenAiModelName(m) && hasClientOpenAiKey()) return true;
        return false;
    }

    function resolveModelAlias(m, pubPrefix) {
        if (!m || pubPrefix === "openai") return null;
        var candidateAlias = getVarOnce("propertyset.model_locations.alias." + m);
        if (!candidateAlias) return null;
        return shouldBypassAlias(m, pubPrefix) ? null : candidateAlias;
    }

    // Preserve raw client payload for multi-model fallback chains before any target transcoding
    var rawBodyStr = context.getVariable("raw_client_payload");
    if (!rawBodyStr && bodyStr) {
        rawBodyStr = bodyStr;
        context.setVariable("raw_client_payload", bodyStr);
    }
    var effectiveBodyStr = rawBodyStr || bodyStr;

    var isCircuitBreakerSecondPass = (context.getVariable("circuit_breaker_checked") === "true");
    if (isCircuitBreakerSecondPass) {
        var cbAllowed = parseInt(context.getVariable("ratelimit.LTQ-CircuitBreakerCheck.allowed.count") || "0", 10);
        var cbUsed = parseInt(context.getVariable("ratelimit.LTQ-CircuitBreakerCheck.used.count") || "0", 10);
        var cbFailed = context.getVariable("ratelimit.LTQ-CircuitBreakerCheck.failed");
        var cbTripped = (
            cbFailed === true ||
            cbFailed === "true" ||
            parseInt(context.getVariable("ratelimit.LTQ-CircuitBreakerCheck.exceed.count") || "0", 10) > 0 ||
            (cbAllowed > 0 && cbUsed >= cbAllowed)
        );
        if (!cbTripped) {
            return;
        }
        var savedCands = JSON.parse(context.getVariable("resolved_candidates_json") || "[]");
        var savedPrefixes = JSON.parse(context.getVariable("resolved_prefixes_json") || "[]");
        requestedModel = context.getVariable("requested_model") || requestedModel;
        allowFallbacks = context.getVariable("allow_fallbacks") !== "false";
        primaryModel = savedCands[1] || context.getVariable("fallback_model") || defaultFallback;
        fallbackModel = (savedCands.length > 2 && savedCands[2] !== primaryModel) ? savedCands[2] : null;
        explicitPublisher = savedPrefixes[1] || null;

        // Clear any Pass 1 target URL and auth overrides from the tripped primary model
        context.removeVariable("model_custom_url");
        context.removeVariable("target.url");
        context.removeVariable("upstream_auth_source");
        context.removeVariable("openai_org_id");
        context.removeVariable("response.header.X-Gateway-Auth-Source");
        context.removeVariable("response.header.X-Gateway-Provider-Account");
        context.removeVariable("request.header.OpenAI-Organization");
        context.removeVariable("request.header.OpenAI-Project");
        context.removeVariable("request.header.Authorization");

        context.setVariable("circuit_breaker_state", "OPEN");
        context.setVariable("fallback_triggered", "true");
        context.setVariable("response.header.X-Gateway-Circuit-Breaker", "OPEN");
        context.setVariable("response.header.X-Gateway-Fallback-Triggered", "true");
    } else {
        // -------------------------------------------------------------------------
        // 1. Fast Path: Standard Direct Single-Model Requests (Zero JSON Parse)
        // -------------------------------------------------------------------------
        var hasAdvancedFeatures = (effectiveBodyStr.indexOf('"models"') !== -1 || 
                                   effectiveBodyStr.indexOf('"plugins"') !== -1 || 
                                   effectiveBodyStr.indexOf('"auto"') !== -1 ||
                                   (extractedModel && (extractedModel.indexOf("auto") === 0 || extractedModel.indexOf("gateway/") === 0)));

        if (!hasAdvancedFeatures && bareExtractedModel) {
            // Fast-path: Direct or aliased single model already extracted by EV-Model / JS-extract-vars
            var directAlias = resolveModelAlias(bareExtractedModel, explicitPublisher);
            requestedModel = extractedModel;
            primaryModel = directAlias || bareExtractedModel;
        } else {
            // ---------------------------------------------------------------------
            // 2. Deep Path: Multi-Model Fallback Arrays, Auto-Router & Cost Tiers
            // ---------------------------------------------------------------------
            var body = effectiveBodyStr ? JSON.parse(effectiveBodyStr) : {};
            var requestedCandidates = [];

            if (Array.isArray(body.models) && body.models.length > 0) {
                requestedCandidates = body.models;
                requestedModel = "models:[" + body.models.join(",") + "]";
            } else if (body.model) {
                requestedCandidates = [body.model];
                requestedModel = body.model;
            } else if (bareExtractedModel && bareExtractedModel !== "unknown") {
                requestedCandidates = [bareExtractedModel];
                requestedModel = extractedModel;
            } else {
                requestedCandidates = [defaultModel];
                requestedModel = "default";
            }

            // Smart Auto-Router & LLM Judge plugin
            var plugins = body.plugins || [];
            var autoRouterPlugin = null;
            var judgePlugin = null;
            for (var i = 0; i < plugins.length; i++) {
                if (plugins[i]) {
                    if (plugins[i].id === "auto-router" && plugins[i].enabled !== false) {
                        autoRouterPlugin = plugins[i];
                    }
                    if (plugins[i].id === "judge" || (plugins[i].id === "auto-router" && (plugins[i].judge || plugins[i].mode === "judge"))) {
                        judgePlugin = plugins[i];
                    }
                }
            }

            var primaryCandidate = requestedCandidates[0] || "";
            var judgeTier = context.getVariable("judge_tier");
            var isJudgeRequest = !!(judgePlugin || judgeTier || primaryCandidate === "auto:judge" || primaryCandidate === "gateway/judge");
            var isAutoRouter = !!(autoRouterPlugin || primaryCandidate === "gateway/auto" || primaryCandidate === "auto" || primaryCandidate.indexOf("auto") === 0);

            if (isJudgeRequest || isAutoRouter) {
                costTier = (autoRouterPlugin && autoRouterPlugin.cost_tier) || judgeTier || "medium";
                requestedModel = judgeTier ? ("auto:judge:" + costTier) : ("auto:" + costTier);
                var tierModel = context.getVariable("propertyset.model_locations.tier." + costTier) || 
                                context.getVariable("propertyset.model_locations.tier.medium") || 
                                defaultModel;
                requestedCandidates = [tierModel, defaultFallback];
                context.setVariable("cost_tier", costTier);
                context.setVariable("response.header.X-Gateway-Cost-Tier", costTier);
            }

            // Fast string prefix normalization & alias lookup
            var resolvedEntries = [];
            for (var c = 0; c < requestedCandidates.length; c++) {
                var rawModel = requestedCandidates[c];
                if (!rawModel) continue;
                var slashIdx = rawModel.indexOf('/');
                var candPrefix = null;
                if (slashIdx !== -1) {
                    candPrefix = rawModel.substring(0, slashIdx);
                    if (c === 0 && candPrefix !== "gateway" && candPrefix !== "auto") {
                        explicitPublisher = explicitPublisher || candPrefix;
                    }
                }
                var normalized = (slashIdx !== -1) ? rawModel.substring(slashIdx + 1) : rawModel;
                var effPrefix = (candPrefix && candPrefix !== "gateway" && candPrefix !== "auto")
                    ? candPrefix
                    : (c === 0 ? explicitPublisher : null);
                var alias = resolveModelAlias(normalized, effPrefix);
                resolvedEntries.push({
                    model: alias || normalized,
                    prefix: effPrefix
                });
            }

            // Optional API Product Entitlements Filter (only needed when filtering multi-model candidate arrays)
            if (resolvedEntries.length > 1) {
                var allowedByProduct = getProductAllowedModels();
                if (allowedByProduct) {
                    var rawProdParts = allowedByProduct.split(",");
                    var filteredEntries = [];
                    for (var fe = 0; fe < resolvedEntries.length; fe++) {
                        var candItem = resolvedEntries[fe];
                        var lowerCandModel = String(candItem.model || "").toLowerCase();
                        for (var ap = 0; ap < rawProdParts.length; ap++) {
                            var cleanAllowed = rawProdParts[ap].replace(/^[\[\]"\s]+|[\[\]"\s]+$/g, "").toLowerCase();
                            if (cleanAllowed && matchesArmorGlob(lowerCandModel, cleanAllowed)) {
                                filteredEntries.push(candItem);
                                break;
                            }
                        }
                    }
                    if (filteredEntries.length > 0) {
                        resolvedEntries = filteredEntries;
                    }
                }
            }

            var resolvedCandidates = [];
            var resolvedPrefixes = [];
            for (var reIdx = 0; reIdx < resolvedEntries.length; reIdx++) {
                resolvedCandidates.push(resolvedEntries[reIdx].model);
                resolvedPrefixes.push(resolvedEntries[reIdx].prefix);
            }

            primaryModel = resolvedCandidates[0] || defaultModel;
            fallbackModel = (resolvedCandidates.length > 1 && resolvedCandidates[1] !== primaryModel) ? resolvedCandidates[1] : null;
            explicitPublisher = resolvedPrefixes[0] || explicitPublisher;

            var providerPrefs = body.provider || {};
            allowFallbacks = providerPrefs.allow_fallbacks !== false;

            if (fallbackModel) {
                context.setVariable("resolved_candidates_json", JSON.stringify(resolvedCandidates));
                context.setVariable("resolved_prefixes_json", JSON.stringify(resolvedPrefixes));
            }
        }

        context.setVariable("circuit_breaker_checked", "true");
        context.setVariable("tried_primary_model", primaryModel);
        context.setVariable("cb_error_weight", "1");
        context.setVariable("circuit_breaker_state", "CLOSED");
        context.setVariable("fallback_triggered", "false");
        context.setVariable("response.header.X-Gateway-Circuit-Breaker", "CLOSED");
        context.setVariable("response.header.X-Gateway-Fallback-Triggered", "false");
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

    if (explicitPublisher && !isSafeSegment(explicitPublisher)) {
        explicitPublisher = null;
    }
    if (!isSafeSegment(primaryModel)) {
        primaryModel = defaultModel;
    }
    if (fallbackModel && !isSafeSegment(fallbackModel)) {
        fallbackModel = defaultFallback;
    }

    // -------------------------------------------------------------------------
    // 3. Dynamic Target, Publisher, Region & Custom URL Resolution
    // -------------------------------------------------------------------------
    var isEmbeddings = context.getVariable("is_embeddings") === "true" || primaryModel.indexOf("embedding") !== -1;
    var defaultLoc = isEmbeddings ? "us-central1" : "global";

    var configuredPublisher = getVarOnce("propertyset.model_locations." + primaryModel + ".publisher");
    var publisher = configuredPublisher || explicitPublisher || (isOpenAiModelName(primaryModel) ? "openai" : defaultPublisher);

    var customUrl = context.getVariable("verifyapikey.VA-ApiKey." + primaryModel + "_url") ||
                    context.getVariable("verifyapikey.VA-ApiKey.upstream_custom_url") ||
                    context.getVariable("propertyset.model_locations." + primaryModel + ".url");

    if (publisher === "openai" && !customUrl) {
        var openAiBaseUrl = context.getVariable("verifyapikey.VA-ApiKey.openai_base_url") ||
                            context.getVariable("propertyset.config.openai_base_url") ||
                            "https://api.openai.com/v1";
        openAiBaseUrl = openAiBaseUrl.replace(/\/+$/, "");
        customUrl = openAiBaseUrl + (isEmbeddings ? "/embeddings" : "/chat/completions");
    } else if (isEmbeddings && customUrl && customUrl.indexOf("/chat/completions") !== -1) {
        customUrl = customUrl.replace(/\/chat\/completions\/?$/, "/embeddings");
    }

    var configuredFormat = context.getVariable("propertyset.model_locations." + primaryModel + ".format");
    var modelFormat = configuredFormat || (publisher === "anthropic" ? "anthropic" : ((publisher !== "google" || customUrl) ? "openai" : defaultFormat));

    var fallbackEndpointLoc = defaultLoc;
    var fallbackModelLoc = defaultLoc;
    if (publisher === "anthropic") {
        fallbackEndpointLoc = context.getVariable("propertyset.model_locations.default_claude.endpoint") || "us-east5";
        fallbackModelLoc = context.getVariable("propertyset.model_locations.default_claude.model") || "us-east5";
    } else if (modelFormat === "openai" && publisher !== "google" && !customUrl) {
        fallbackEndpointLoc = context.getVariable("propertyset.model_locations.default_openai.endpoint") || defaultLoc;
        fallbackModelLoc = context.getVariable("propertyset.model_locations.default_openai.model") || defaultLoc;
    }

    var endpointLocation = context.getVariable("propertyset.model_locations." + primaryModel + ".endpoint") || fallbackEndpointLoc;
    var modelLocation = context.getVariable("propertyset.model_locations." + primaryModel + ".model") || fallbackModelLoc;
    if (!/^[a-z0-9-]+$/i.test(endpointLocation)) endpointLocation = defaultLoc;
    if (!/^[a-z0-9-]+$/i.test(modelLocation)) modelLocation = defaultLoc;

    var authType = context.getVariable("verifyapikey.VA-ApiKey." + primaryModel + "_auth_type") ||
                   context.getVariable("verifyapikey.VA-ApiKey.upstream_auth_type") ||
                   context.getVariable("propertyset.model_locations." + primaryModel + ".auth_type");

    var isGoogleUrl = isGoogleCloudUrl(customUrl);
    var useExternalTarget = (modelFormat === "openai") && (publisher === "openai" || (customUrl && !isGoogleUrl && authType !== "google_iam"));

    var configuredTarget = context.getVariable("propertyset.model_locations." + primaryModel + ".target");
    var targetName = defaultTarget;
    if (useExternalTarget) {
        targetName = "openai-custom";
    } else if (configuredTarget) {
        targetName = configuredTarget;
    } else if (publisher === "anthropic" || modelFormat === "anthropic") {
        targetName = "claude";
    } else if (modelFormat === "openai") {
        targetName = "gemini-openai-compat";
    }

    var endpointHost = (endpointLocation && endpointLocation !== "global") ? (endpointLocation + "-aiplatform.googleapis.com") : "aiplatform.googleapis.com";

    // -------------------------------------------------------------------------
    // 4. Set Gateway & Observability Variables
    // -------------------------------------------------------------------------
    context.setVariable("model", primaryModel);
    context.setVariable("primary_model", primaryModel);
    context.setVariable("fallback_model", fallbackModel || "");
    context.setVariable("requested_model", requestedModel);
    context.setVariable("allow_fallbacks", allowFallbacks ? "true" : "false");

    context.setVariable("model_publisher", publisher);
    context.setVariable("model_format", modelFormat);
    context.setVariable("route_format", modelFormat);
    context.setVariable("route_target", targetName);
    context.setVariable("endpoint_host", endpointHost);
    context.setVariable("endpoint_location", endpointLocation);
    context.setVariable("model_location", modelLocation);

    var requestFormat = context.getVariable("request_format");
    if (requestFormat === "openai") {
        if (useExternalTarget) {
            context.setVariable("original_model", primaryModel);
        } else {
            context.setVariable("original_model", publisher + "/" + primaryModel);
        }
    }

    if (customUrl) {
        context.setVariable("model_custom_url", customUrl);
        context.setVariable("target.url", customUrl);
    } else if (requestFormat === "gemini") {
        var pathSuffix = context.getVariable("proxy.pathsuffix") || "";
        if (pathSuffix && (isEmbeddings || primaryModel !== bareExtractedModel || isCircuitBreakerSecondPass)) {
            var locMatch = pathSuffix.match(/\/locations\/([a-z0-9-]+)\//i);
            var pathLoc = (locMatch && locMatch[1]) ? locMatch[1] : endpointLocation;
            var embHost = (pathLoc && pathLoc !== "global") ? (pathLoc + "-aiplatform.googleapis.com") : endpointHost;
            var rewrittenPath = pathSuffix.replace(/\/models\/[^\/:]+/, "/models/" + primaryModel);
            context.setVariable("target.copy.pathsuffix", "false");
            context.setVariable("target.url", "https://" + embHost + rewrittenPath);
        }
    }

    // -------------------------------------------------------------------------
    // 5. Per-Client Provider Account Isolation & Upstream Auth Resolution
    // -------------------------------------------------------------------------
    function isSafeTokenRef(ref) {
        if (!ref) return false;
        var r = String(ref).trim();
        if (r.indexOf("..") !== -1 || /[\r\n\0\s]/.test(r)) return false;
        return /^(propertyset\.[a-zA-Z0-9_.-]+|private\.[a-zA-Z0-9_.-]+|(?:verifyapikey\.VA-ApiKey\.)?apiproduct\.[a-zA-Z0-9_.-]+)$/.test(r);
    }

    function isSafeHeaderName(hdr) {
        if (!hdr) return false;
        var h = String(hdr).trim();
        if (!/^[a-zA-Z0-9_-]{1,64}$/.test(h)) return false;
        var lh = h.toLowerCase();
        return lh !== "host" && lh !== "content-length" && lh !== "transfer-encoding" && lh !== "connection";
    }

    var normAuthType = authType ? String(authType).toLowerCase() : "";
    var useGoogleIam = isGoogleUrl && ((publisher !== "openai" && normAuthType !== "bearer" && normAuthType !== "header" && normAuthType !== "apikey" && normAuthType !== "api_key") || normAuthType === "google_iam");
    var isExternalEndpoint = Boolean(useExternalTarget || (customUrl && !isGoogleUrl));

    if (!useGoogleIam) {
        var authHeader = context.getVariable("verifyapikey.VA-ApiKey." + primaryModel + "_auth_header") ||
                         context.getVariable("verifyapikey.VA-ApiKey.upstream_auth_header") ||
                         context.getVariable("propertyset.model_locations." + primaryModel + ".auth_header");

        var tokenVal = null;
        var authSource = null;

        var clientKeyRef = getVarOnce("verifyapikey.VA-ApiKey." + primaryModel + "_api_key_ref") ||
                           getVarOnce("verifyapikey.VA-ApiKey." + publisher + "_api_key_ref") ||
                           getVarOnce("verifyapikey.VA-ApiKey.upstream_api_key_ref");
        var clientKeyDirect = (isSafeTokenRef(clientKeyRef) ? getVarOnce(String(clientKeyRef).trim()) : null) ||
                              getVarOnce("verifyapikey.VA-ApiKey." + primaryModel + "_api_key") ||
                              getVarOnce("verifyapikey.VA-ApiKey." + publisher + "_api_key") ||
                              getVarOnce("verifyapikey.VA-ApiKey.upstream_api_key");

        if (clientKeyDirect) {
            tokenVal = clientKeyDirect;
            authSource = "client_app";
        } else {
            var productKeyRef = getVarOnce("apiproduct." + primaryModel + "_api_key_ref") ||
                                getVarOnce("apiproduct." + publisher + "_api_key_ref") ||
                                getVarOnce("apiproduct.upstream_api_key_ref");
            var productKeyDirect = (isSafeTokenRef(productKeyRef) ? getVarOnce(String(productKeyRef).trim()) : null) ||
                                   getVarOnce("apiproduct." + primaryModel + "_api_key") ||
                                   getVarOnce("apiproduct." + publisher + "_api_key") ||
                                   getVarOnce("apiproduct.upstream_api_key");
            if (productKeyDirect) {
                tokenVal = productKeyDirect;
                authSource = "api_product";
            } else {
                var authTokenRef = getVarOnce("propertyset.model_locations." + primaryModel + ".auth_token_ref");
                var modelKeyVal = (isSafeTokenRef(authTokenRef) ? getVarOnce(String(authTokenRef).trim()) : null) ||
                                  getVarOnce("propertyset.model_locations." + primaryModel + ".auth_token");
                if (modelKeyVal) {
                    tokenVal = modelKeyVal;
                    authSource = "model_config";
                } else {
                    var globalKeyVal = getVarOnce("propertyset.config." + publisher + "_api_key");
                    if (globalKeyVal) {
                        tokenVal = globalKeyVal;
                        authSource = "global_config";
                    }
                }
            }
        }

        var isCustomHeader = Boolean(isSafeHeaderName(authHeader) && String(authHeader).toLowerCase() !== "authorization");
        if (tokenVal && normAuthType !== "none") {
            if (isCustomHeader) {
                context.setVariable("request.header." + String(authHeader).trim(), tokenVal);
                if (isExternalEndpoint) {
                    context.setVariable("request.header.Authorization", "");
                }
            } else if (normAuthType === "header" && isSafeHeaderName(authHeader)) {
                context.setVariable("request.header." + String(authHeader).trim(), tokenVal);
            } else if (normAuthType === "" || normAuthType === "bearer" || normAuthType === "api_key" || normAuthType === "apikey") {
                context.setVariable("request.header.Authorization", "Bearer " + tokenVal);
            }
            context.setVariable("upstream_auth_source", authSource);
            context.setVariable("response.header.X-Gateway-Auth-Source", authSource);
        } else if (isExternalEndpoint && normAuthType === "none") {
            context.setVariable("request.header.Authorization", "");
        }

        if (isExternalEndpoint) {
            if (!authHeader || String(authHeader).toLowerCase() !== "x-apikey") {
                context.setVariable("request.header.x-apikey", "");
            }
        }
    }

    // Per-Client OpenAI Organization & Project Header Isolation (evaluated only on OpenAI / external routes)
    if (publisher === "openai" || useExternalTarget) {
        var openaiOrgId = context.getVariable("verifyapikey.VA-ApiKey.openai_org_id") ||
                          context.getVariable("apiproduct.openai_org_id") ||
                          context.getVariable("propertyset.model_locations." + primaryModel + ".openai_org_id") ||
                          context.getVariable("propertyset.config.openai_org_id");
        if (openaiOrgId) {
            context.setVariable("openai_org_id", openaiOrgId);
            context.setVariable("request.header.OpenAI-Organization", openaiOrgId);
            context.setVariable("response.header.X-Gateway-Provider-Account", openaiOrgId);
        }

        var openaiProjectId = context.getVariable("verifyapikey.VA-ApiKey.openai_project_id") ||
                              context.getVariable("apiproduct.openai_project_id") ||
                              context.getVariable("propertyset.model_locations." + primaryModel + ".openai_project_id") ||
                              context.getVariable("propertyset.config.openai_project_id");
        if (openaiProjectId) {
            context.setVariable("request.header.OpenAI-Project", openaiProjectId);
        }
    }

    // Identity & Persona Normalization (API Key / OAuth / Imported Agent & IdP Tokens)
    function cleanTokenAttr(val) {
        if (!val) return "";
        var s = String(val).trim();
        return (s === "unset" || s === "null" || s === "undefined") ? "" : s;
    }

    function isTimestampExpired(expVal) {
        if (!expVal || String(expVal).trim() === "") return false;
        var expStr = String(expVal).trim();
        var expMs = /^[0-9]+$/.test(expStr) ? parseInt(expStr, 10) : Date.parse(expStr);
        if (!isNaN(expMs) && expMs < 100000000000) {
            expMs = expMs * 1000; // Convert Unix seconds to milliseconds if needed
        }
        return (!isNaN(expMs) && Date.now() >= expMs);
    }

    function computeArmorRuleScore(candidate, pattern) {
        var isExact = (pattern.indexOf("*") === -1);
        var literalLen = pattern.replace(/\*/g, "").length;
        if (candidate.indexOf("principal://") === 0 || candidate.indexOf("spiffe://") === 0) {
            if (pattern.indexOf("reasoningengines/") !== -1) return 40000 + (isExact ? 500 : 0) + literalLen;
            if (pattern.indexOf("/locations/") !== -1) return 30000 + (isExact ? 500 : 0) + literalLen;
            if (pattern.indexOf("/projects/") !== -1) return 20000 + (isExact ? 500 : 0) + literalLen;
            return 10000 + (isExact ? 500 : 0) + literalLen;
        }
        if (candidate.indexOf(".iam.gserviceaccount.com") !== -1 && pattern.indexOf("@") !== -1) {
            if (isExact) return 40500 + literalLen;
            var atIdx = pattern.indexOf("@");
            var localLit = pattern.substring(0, atIdx).replace(/\*/g, "");
            var domainLit = pattern.substring(atIdx + 1).replace(/\.iam\.gserviceaccount\.com$/i, "").replace(/\*/g, "");
            if (localLit.length > 0 && domainLit.length > 0) return 35000 + literalLen;
            if (localLit.length > 0) return 30000 + literalLen;
            if (domainLit.length > 0) return 20000 + literalLen;
            return 10000 + literalLen;
        }
        if (candidate.indexOf("team:") === 0 || candidate.indexOf("project:") === 0) {
            return 20000 + (isExact ? 500 : 0) + literalLen;
        }
        return (isExact ? 40500 : 30000) + literalLen;
    }

    var vaClientId = context.getVariable("verifyapikey.VA-ApiKey.client_id");
    var oauthClientId = context.getVariable("client_id");
    var devAppName = context.getVariable("developer.app.name");
    var apiProductName = context.getVariable("apiproduct.name");

    var oauthUserId = cleanTokenAttr(context.getVariable("accesstoken.user_id")) || cleanTokenAttr(context.getVariable("auth_user_id"));
    var identityUserId = oauthUserId ||
                         context.getVariable("verifyapikey.VA-ApiKey.developer.email") ||
                         context.getVariable("developer.email") ||
                         vaClientId ||
                         oauthClientId ||
                         "anonymous";
    var identityPersona = cleanTokenAttr(context.getVariable("accesstoken.persona")) ||
                          cleanTokenAttr(context.getVariable("auth_persona")) ||
                          context.getVariable("verifyapikey.VA-ApiKey.persona") ||
                          context.getVariable("verifyapikey.VA-ApiKey.developer.persona") ||
                          context.getVariable("verifyapikey.VA-ApiKey.apiproduct.persona") ||
                          context.getVariable("apiproduct.persona") ||
                          context.getVariable("verifyapikey.VA-ApiKey.apiproduct.name") ||
                          apiProductName ||
                          context.getVariable("propertyset.config.auth_persona_default") ||
                          "default";

    // Normalize API Product name "<gateway>-<persona>" to "<persona>" if matching configured persona
    if (identityPersona && !context.getVariable("propertyset.config.persona." + identityPersona + ".match_claims")) {
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

    var identityTeam = cleanTokenAttr(context.getVariable("accesstoken.team")) ||
                       cleanTokenAttr(context.getVariable("auth_team")) ||
                       context.getVariable("verifyapikey.VA-ApiKey.team") ||
                       context.getVariable("verifyapikey.VA-ApiKey.developer.team") ||
                       context.getVariable("verifyapikey.VA-ApiKey.apiproduct.team") ||
                       context.getVariable("apiproduct.team") ||
                       "default";
    var identityAuthType = cleanTokenAttr(context.getVariable("accesstoken.auth_source")) ||
                           cleanTokenAttr(context.getVariable("auth_token_type")) ||
                           (vaClientId ? "apikey" : (oauthClientId ? "oauth" : "none"));

    var safePersona = isSafeSegment(identityPersona) ? identityPersona : "default";
    context.setVariable("identity_user_id", identityUserId);
    context.setVariable("identity_persona", identityPersona);
    context.setVariable("identity_team", identityTeam);
    context.setVariable("identity_auth_type", identityAuthType);
    context.setVariable("response.header.X-Gateway-Identity-Persona", safePersona);

    // Evaluate Unified Identity & Exception Rules (Quotas, Team Budgets, Models, Rate Limits, Model Armor)
    var ruleQuotaLimit = "";
    var ruleTeamBudgetLimit = "";
    var ruleAllowedModels = "";
    var ruleBurstRate = "";
    var ruleConcurrencyLimit = "";
    var ruleReqTemplate = "";
    var ruleRespTemplate = "";
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
        if (lowerTeam && lowerTeam !== "default") {
            identityCandidates.push("team:" + lowerTeam);
            if (lowerTeam.indexOf("project:") === 0) {
                identityCandidates.push(lowerTeam);
            }
        }
        if (lowerPersona && lowerPersona !== "default") {
            identityCandidates.push("persona:" + lowerPersona);
        }

        var bestQuotaScore = -1;
        var bestTeamBudgetScore = -1;
        var bestModelsScore = -1;
        var bestBurstScore = -1;
        var bestConcurrencyScore = -1;
        var bestReqScore = -1;
        var bestRespScore = -1;

        for (var r = 0; r < rulesCount; r++) {
            var rulePrefix = "propertyset.config.model_armor.rule." + r + ".";
            var ruleMatchCsv = context.getVariable(rulePrefix + "match") || "";
            if (!ruleMatchCsv) continue;
            var rawRulePatterns = ruleMatchCsv.split(",");
            var normRulePatterns = [];
            for (var rpi = 0; rpi < rawRulePatterns.length; rpi++) {
                var cleanPat = rawRulePatterns[rpi].replace(/^[\[\]"\s]+|[\[\]"\s]+$/g, "").toLowerCase();
                if (cleanPat) normRulePatterns.push(cleanPat);
            }
            if (normRulePatterns.length === 0) continue;

            var rQuota = context.getVariable(rulePrefix + "quota_limit") || "";
            var rExpiresAt = context.getVariable(rulePrefix + "expires_at") || "";
            var rTeamBudget = context.getVariable(rulePrefix + "team_budget_limit") || "";
            var rModels = context.getVariable(rulePrefix + "models") || "";
            var rBurst = context.getVariable(rulePrefix + "burst_rate") || "";
            var rConcurrency = context.getVariable(rulePrefix + "concurrency_limit") || "";
            var rShared = context.getVariable(rulePrefix + "template") || "";
            var rReq = context.getVariable(rulePrefix + "request_template") || rShared;
            var rResp = context.getVariable(rulePrefix + "response_template") || rShared;
            var rQuotaValid = Boolean(rQuota) && !isTimestampExpired(rExpiresAt);

            for (var ic = 0; ic < identityCandidates.length; ic++) {
                var idCand = identityCandidates[ic];
                if (!idCand) continue;
                for (var rp = 0; rp < normRulePatterns.length; rp++) {
                    var pat = normRulePatterns[rp];
                    if (matchesArmorGlob(idCand, pat)) {
                        var rScore = computeArmorRuleScore(idCand, pat);
                        if (rQuotaValid && rScore > bestQuotaScore) {
                            bestQuotaScore = rScore;
                            ruleQuotaLimit = String(rQuota).trim();
                        }
                        if (rTeamBudget && rScore > bestTeamBudgetScore) {
                            bestTeamBudgetScore = rScore;
                            ruleTeamBudgetLimit = String(rTeamBudget).trim();
                        }
                        if (rModels && rScore > bestModelsScore) {
                            bestModelsScore = rScore;
                            ruleAllowedModels = String(rModels).trim();
                        }
                        if (rBurst && rScore > bestBurstScore) {
                            bestBurstScore = rScore;
                            ruleBurstRate = String(rBurst).trim();
                        }
                        if (rConcurrency && rScore > bestConcurrencyScore) {
                            bestConcurrencyScore = rScore;
                            ruleConcurrencyLimit = String(rConcurrency).trim();
                        }
                        if (rReq && rScore > bestReqScore) {
                            bestReqScore = rScore;
                            ruleReqTemplate = rReq;
                        }
                        if (rResp && rScore > bestRespScore) {
                            bestRespScore = rScore;
                            ruleRespTemplate = rResp;
                        }
                    }
                }
            }
        }
    }

    // Enforce Persona / Exception / API Product Model Allowlist
    var personaPrefix = "propertyset.config.persona." + safePersona + ".";
    var effectiveAllowedModels = cleanTokenAttr(context.getVariable("accesstoken.allowed_models")) ||
                                 ruleAllowedModels ||
                                 context.getVariable("verifyapikey.VA-ApiKey.allowed_models") ||
                                 context.getVariable("verifyapikey.VA-ApiKey.developer.allowed_models") ||
                                 context.getVariable(personaPrefix + "models") ||
                                 context.getVariable("verifyapikey.VA-ApiKey.apiproduct.allowed_models") ||
                                 getProductAllowedModels() ||
                                 context.getVariable("apiproduct.allowed-models") ||
                                 context.getVariable("apiproduct.custom.allowed_models") || "";

    var trimmedAllowedModels = effectiveAllowedModels ? String(effectiveAllowedModels).trim() : "";
    if (trimmedAllowedModels !== "") {
        context.setVariable("allowed_models_list", trimmedAllowedModels);
        if (trimmedAllowedModels === "*") {
            context.setVariable("model_access_denied", "false");
        } else {
            var rawAllowParts = trimmedAllowedModels.split(",");
            var normAllowPatterns = [];
            var hasWildcardAll = false;
            for (var ami = 0; ami < rawAllowParts.length; ami++) {
                var aPat = rawAllowParts[ami].replace(/^[\[\]"\s]+|[\[\]"\s]+$/g, "").toLowerCase();
                if (!aPat) continue;
                if (aPat === "*") {
                    hasWildcardAll = true;
                    break;
                }
                normAllowPatterns.push(aPat);
            }
            function isModelInPrecomputedList(modelId) {
                if (hasWildcardAll || normAllowPatterns.length === 0) return true;
                var lowerModel = String(modelId || "").trim().toLowerCase();
                for (var mi = 0; mi < normAllowPatterns.length; mi++) {
                    if (matchesArmorGlob(lowerModel, normAllowPatterns[mi])) return true;
                }
                return false;
            }
            if (!isModelInPrecomputedList(primaryModel) && !isModelInPrecomputedList(requestedModel)) {
                context.setVariable("model_access_denied", "true");
                context.setVariable("private.auth.denied_detail", "Model '" + primaryModel + "' not in allowed_models (" + trimmedAllowedModels + ") for persona '" + safePersona + "'");
                context.setVariable("auth_error_status", "403");
                context.setVariable("auth_error_payload", JSON.stringify({
                    error: {
                        type: "permission_error",
                        message: "Model '" + primaryModel + "' is not authorized for persona '" + safePersona + "'.",
                        code: 403
                    }
                }));
            } else {
                context.setVariable("model_access_denied", "false");
                if (fallbackModel && !isModelInPrecomputedList(fallbackModel)) {
                    fallbackModel = "";
                    context.setVariable("fallback_model", "");
                    context.setVariable("allow_fallbacks", "false");
                }
            }
        }
    } else {
        context.setVariable("model_access_denied", "false");
    }

    // Bridge OAuth / Imported Token identity & API Product quotas to VA-ApiKey variables
    // so LLMTokenQuota (which references stepName="VA-ApiKey") enforces per-user buckets under the Persona product
    if (oauthUserId || !vaClientId) {
        var effectiveQuotaClientId = oauthUserId || vaClientId || oauthClientId || devAppName;
        if (effectiveQuotaClientId) {
            context.setVariable("verifyapikey.VA-ApiKey.client_id", effectiveQuotaClientId);
            vaClientId = effectiveQuotaClientId;
        }
    }

    var rawQuotaOverride = cleanTokenAttr(context.getVariable("accesstoken.quota_override")) ||
                           cleanTokenAttr(context.getVariable("auth_quota_override")) ||
                           context.getVariable("verifyapikey.VA-ApiKey.quota_override") ||
                           context.getVariable("verifyapikey.VA-ApiKey.quota_limit") ||
                           context.getVariable("verifyapikey.VA-ApiKey.developer.quota_override") ||
                           context.getVariable("verifyapikey.VA-ApiKey.developer.quota_limit");
    var quotaOverrideExpiresAt = cleanTokenAttr(context.getVariable("accesstoken.quota_override_expires_at")) ||
                                 cleanTokenAttr(context.getVariable("auth_quota_override_expires_at")) ||
                                 context.getVariable("verifyapikey.VA-ApiKey.quota_override_expires_at") ||
                                 context.getVariable("verifyapikey.VA-ApiKey.developer.quota_override_expires_at");
    var primaryQuotaOverride = "";
    var quotaExceptionActive = false;
    if (rawQuotaOverride && !isTimestampExpired(quotaOverrideExpiresAt)) {
        primaryQuotaOverride = String(rawQuotaOverride);
        quotaExceptionActive = true;
    } else if (ruleQuotaLimit) {
        primaryQuotaOverride = String(ruleQuotaLimit);
        quotaExceptionActive = true;
    }
    context.setVariable("quota_exception_active", quotaExceptionActive ? "true" : "false");

    var personaModelQuotaLimit = isSafeSegment(primaryModel)
        ? context.getVariable(personaPrefix + "model_quota." + primaryModel)
        : null;
    var personaQuotaLimit = personaModelQuotaLimit || context.getVariable(personaPrefix + "quota_limit");
    var personaQuotaInterval = context.getVariable(personaPrefix + "quota_interval");
    var personaQuotaUnit = context.getVariable(personaPrefix + "quota_unit");

    var vaProdQuotaLimit = context.getVariable("verifyapikey.VA-ApiKey.apiproduct.developer.quota.limit");
    var vaLlmQuotaLimit = context.getVariable("verifyapikey.VA-ApiKey.apiproduct.developer.llmQuota.limit");
    var oauthProductQuotaLimit = context.getVariable("apiproduct.developer.quota.limit");
    var oauthLlmQuotaLimit = context.getVariable("apiproduct.developer.llmQuota.limit");
    if (primaryQuotaOverride) {
        context.setVariable("verifyapikey.VA-ApiKey.apiproduct.developer.quota.limit", String(primaryQuotaOverride));
        context.setVariable("verifyapikey.VA-ApiKey.apiproduct.developer.llmQuota.limit", String(primaryQuotaOverride));
    } else if (personaQuotaLimit) {
        context.setVariable("verifyapikey.VA-ApiKey.apiproduct.developer.quota.limit", String(personaQuotaLimit));
        context.setVariable("verifyapikey.VA-ApiKey.apiproduct.developer.llmQuota.limit", String(personaQuotaLimit));
    } else {
        if (oauthProductQuotaLimit && !vaProdQuotaLimit) {
            context.setVariable("verifyapikey.VA-ApiKey.apiproduct.developer.quota.limit", String(oauthProductQuotaLimit));
        }
        if (oauthLlmQuotaLimit && !vaLlmQuotaLimit) {
            context.setVariable("verifyapikey.VA-ApiKey.apiproduct.developer.llmQuota.limit", String(oauthLlmQuotaLimit));
        }
    }
    var vaProdQuotaInterval = context.getVariable("verifyapikey.VA-ApiKey.apiproduct.developer.quota.interval");
    var oauthProductQuotaInterval = personaQuotaInterval || context.getVariable("apiproduct.developer.quota.interval");
    if (oauthProductQuotaInterval && (personaQuotaInterval || !vaProdQuotaInterval)) {
        context.setVariable("verifyapikey.VA-ApiKey.apiproduct.developer.quota.interval", String(oauthProductQuotaInterval));
    }
    var vaLlmQuotaInterval = context.getVariable("verifyapikey.VA-ApiKey.apiproduct.developer.llmQuota.interval");
    var oauthLlmQuotaInterval = personaQuotaInterval || context.getVariable("apiproduct.developer.llmQuota.interval");
    if (oauthLlmQuotaInterval && (personaQuotaInterval || !vaLlmQuotaInterval)) {
        context.setVariable("verifyapikey.VA-ApiKey.apiproduct.developer.llmQuota.interval", String(oauthLlmQuotaInterval));
    }
    var vaProdQuotaTimeunit = context.getVariable("verifyapikey.VA-ApiKey.apiproduct.developer.quota.timeunit");
    var oauthProductQuotaTimeunit = personaQuotaUnit || context.getVariable("apiproduct.developer.quota.timeunit");
    if (oauthProductQuotaTimeunit && (personaQuotaUnit || !vaProdQuotaTimeunit)) {
        context.setVariable("verifyapikey.VA-ApiKey.apiproduct.developer.quota.timeunit", String(oauthProductQuotaTimeunit));
    }
    var vaLlmQuotaTimeunit = context.getVariable("verifyapikey.VA-ApiKey.apiproduct.developer.llmQuota.timeunit");
    var oauthLlmQuotaTimeunit = personaQuotaUnit || context.getVariable("apiproduct.developer.llmQuota.timeunit");
    if (oauthLlmQuotaTimeunit && (personaQuotaUnit || !vaLlmQuotaTimeunit)) {
        context.setVariable("verifyapikey.VA-ApiKey.apiproduct.developer.llmQuota.timeunit", String(oauthLlmQuotaTimeunit));
    }

    // Burst Rate & Concurrency Client Identifier Resolution
    var rateLimitClientId = oauthUserId ||
                            vaClientId ||
                            oauthClientId ||
                            devAppName ||
                            context.getVariable("client.ip") ||
                            "default_client";
    context.setVariable("rate_limit_client_id", rateLimitClientId);

    // Secondary Quota Window / Shared Team Budget Resolution (Token Claim -> Exception Rule -> App -> Persona -> API Product)
    var teamQuotaLimit = ruleTeamBudgetLimit ||
                         context.getVariable("verifyapikey.VA-ApiKey.team_quota_limit") ||
                         context.getVariable("verifyapikey.VA-ApiKey.developer.team_quota_limit") ||
                         context.getVariable(personaPrefix + "team_quota_limit") ||
                         context.getVariable("verifyapikey.VA-ApiKey.apiproduct.team_quota_limit") ||
                         context.getVariable("apiproduct.team_quota_limit");
    var secScope = context.getVariable("verifyapikey.VA-ApiKey.secondary_quota_scope") ||
                   context.getVariable("verifyapikey.VA-ApiKey.apiproduct.secondary_quota_scope") ||
                   context.getVariable("apiproduct.secondary_quota_scope") ||
                   (teamQuotaLimit ? "team" : "user");
    context.setVariable("secondary_quota_scope", secScope);

    // If configured as a shared Team Budget (secScope === "team"), all team members share bucket "team:<identity_team>"
    // unless the user has an active individual exception (quotaExceptionActive), which isolates their bucket so they
    // can continue working even when the shared team budget is exhausted.
    var secondaryQuotaIdentifier = (secScope === "team" && !quotaExceptionActive)
                                   ? ("team:" + identityTeam)
                                   : rateLimitClientId;
    context.setVariable("secondary_quota_identifier", secondaryQuotaIdentifier);

    var secLimit = (quotaExceptionActive ? primaryQuotaOverride : "") ||
                   context.getVariable("accesstoken.secondary_quota_limit") ||
                   context.getVariable("verifyapikey.VA-ApiKey.secondary_quota_limit") ||
                   context.getVariable("verifyapikey.VA-ApiKey.developer.secondary_quota_limit") ||
                   teamQuotaLimit ||
                   context.getVariable("verifyapikey.VA-ApiKey.apiproduct.secondary_quota_limit") ||
                   context.getVariable("apiproduct.secondary_quota_limit");
    if (secLimit) {
        var secLimitStr = String(secLimit);
        context.setVariable("verifyapikey.VA-ApiKey.apiproduct.secondary_quota_limit", secLimitStr);
        context.setVariable("secondary_quota_limit", secLimitStr);
    }
    var secInterval = context.getVariable("accesstoken.secondary_quota_interval") ||
                      context.getVariable("verifyapikey.VA-ApiKey.secondary_quota_interval") ||
                      context.getVariable("verifyapikey.VA-ApiKey.developer.secondary_quota_interval") ||
                      context.getVariable(personaPrefix + "team_quota_interval") ||
                      context.getVariable("verifyapikey.VA-ApiKey.apiproduct.team_quota_interval") ||
                      context.getVariable("apiproduct.team_quota_interval") ||
                      context.getVariable("verifyapikey.VA-ApiKey.apiproduct.secondary_quota_interval") ||
                      context.getVariable("apiproduct.secondary_quota_interval");
    if (secInterval) {
        var secIntervalStr = String(secInterval);
        context.setVariable("verifyapikey.VA-ApiKey.apiproduct.secondary_quota_interval", secIntervalStr);
        context.setVariable("secondary_quota_interval", secIntervalStr);
    }
    var secUnit = context.getVariable("accesstoken.secondary_quota_unit") ||
                  context.getVariable("verifyapikey.VA-ApiKey.secondary_quota_unit") ||
                  context.getVariable("verifyapikey.VA-ApiKey.developer.secondary_quota_unit") ||
                  context.getVariable(personaPrefix + "team_quota_unit") ||
                  context.getVariable("verifyapikey.VA-ApiKey.apiproduct.team_quota_unit") ||
                  context.getVariable("apiproduct.team_quota_unit") ||
                  context.getVariable("verifyapikey.VA-ApiKey.apiproduct.secondary_quota_unit") ||
                  context.getVariable("apiproduct.secondary_quota_unit");
    if (secUnit) {
        var secUnitStr = String(secUnit);
        context.setVariable("verifyapikey.VA-ApiKey.apiproduct.secondary_quota_unit", secUnitStr);
        context.setVariable("secondary_quota_unit", secUnitStr);
    }

    var burstRateLimit = context.getVariable("accesstoken.burst_rate") ||
                         ruleBurstRate ||
                         context.getVariable("verifyapikey.VA-ApiKey.burst_rate") ||
                         context.getVariable("verifyapikey.VA-ApiKey.burst_rate_limit") ||
                         context.getVariable("verifyapikey.VA-ApiKey.developer.burst_rate") ||
                         context.getVariable("verifyapikey.VA-ApiKey.developer.burst_rate_limit") ||
                         context.getVariable(personaPrefix + "burst_rate") ||
                         context.getVariable("verifyapikey.VA-ApiKey.apiproduct.burst_rate") ||
                         context.getVariable("verifyapikey.VA-ApiKey.apiproduct.burst_rate_limit") ||
                         context.getVariable("apiproduct.burst_rate") ||
                         context.getVariable("apiproduct.burst_rate_limit") ||
                         context.getVariable("propertyset.config.default_burst_rate") ||
                         "600pm";
    context.setVariable("burst_rate_limit", burstRateLimit);

    var concurrencyLimit = context.getVariable("accesstoken.concurrency_limit") ||
                           ruleConcurrencyLimit ||
                           context.getVariable("verifyapikey.VA-ApiKey.concurrency_limit") ||
                           context.getVariable("verifyapikey.VA-ApiKey.developer.concurrency_limit") ||
                           context.getVariable(personaPrefix + "concurrency_limit") ||
                           context.getVariable("verifyapikey.VA-ApiKey.apiproduct.concurrency_limit") ||
                           context.getVariable("apiproduct.concurrency_limit") ||
                           context.getVariable("propertyset.config.default_concurrency_limit") ||
                           "20";
    context.setVariable("concurrency_limit", String(concurrencyLimit));

    // -------------------------------------------------------------------------
    // 6. Context-Aware Model Armor Template Resolution (Request vs. Response)
    // Precedence (evaluated independently for Request & Response phases):
    //   1a. Identity Token Claim (OAuth/JWT/Agent token attribute)
    //   1b. Identity Glob Rules (exceptions / features.model_armor.identity_rules)
    //   2.  Developer App / Developer Custom Attributes
    //   3a. Persona Configuration (personas / features.model_armor.personas)
    //   3b. API Product Custom Attributes
    //   4.  Model-Specific Configuration (models.<model>.model_armor)
    //   5.  Global Default Configuration (features.model_armor)
    // -------------------------------------------------------------------------
    function parseArmorTemplateSpec(rawSpec, defaultProj, defaultLoc) {
        var clean = rawSpec ? String(rawSpec).trim() : "";
        var lower = clean.toLowerCase();
        if (!clean || lower === "none" || lower === "disabled" || lower === "off" || lower === "false" || lower === "skip") {
            return {
                enabled: false,
                projectId: defaultProj,
                location: defaultLoc,
                template: "none"
            };
        }
        var fullMatch = clean.match(/^projects\/([^\/]+)\/locations\/([^\/]+)\/templates\/([^\/]+)$/i);
        if (fullMatch) {
            return {
                enabled: true,
                projectId: fullMatch[1],
                location: fullMatch[2],
                template: fullMatch[3]
            };
        }
        var locMatch = clean.match(/^([^\/]+)\/([^\/]+)$/);
        if (locMatch) {
            return {
                enabled: true,
                projectId: defaultProj,
                location: locMatch[1],
                template: locMatch[2]
            };
        }
        return {
            enabled: true,
            projectId: defaultProj,
            location: defaultLoc,
            template: clean
        };
    }

    var globalArmorEnabled = String(context.getVariable("propertyset.config.model_armor_enabled") || "true").toLowerCase() !== "false";
    var defaultArmorProj = context.getVariable("propertyset.config.model_armor_project_id") ||
                           context.getVariable("propertyset.config.gcp_project_id") || "";
    var defaultArmorLoc = context.getVariable("propertyset.config.model_armor_location") || "us-central1";
    var globalArmorTemplate = context.getVariable("propertyset.config.model_armor_template") || "ai-gw-template";
    var globalArmorReqTemplate = context.getVariable("propertyset.config.model_armor_request_template") || globalArmorTemplate;
    var globalArmorRespTemplate = context.getVariable("propertyset.config.model_armor_response_template") || globalArmorTemplate;

    // Resolve Request & Response Phase Templates via lazy short-circuiting with cached shared fallbacks
    var sharedClaimArmor = cleanTokenAttr(context.getVariable("accesstoken.model_armor_template"));
    var sharedAppArmor;
    function getSharedAppArmor() {
        if (sharedAppArmor === undefined) {
            sharedAppArmor = context.getVariable("verifyapikey.VA-ApiKey.model_armor_template") ||
                             context.getVariable("verifyapikey.VA-ApiKey.developer.model_armor_template") || "";
        }
        return sharedAppArmor;
    }
    var sharedPersonaArmor;
    function getSharedPersonaArmor() {
        if (sharedPersonaArmor === undefined) {
            sharedPersonaArmor = context.getVariable("propertyset.config.model_armor.persona." + identityPersona + ".template") || "";
        }
        return sharedPersonaArmor;
    }
    var sharedProductArmor;
    function getSharedProductArmor() {
        if (sharedProductArmor === undefined) {
            sharedProductArmor = context.getVariable("verifyapikey.VA-ApiKey.apiproduct.model_armor_template") ||
                                 context.getVariable("apiproduct.model_armor_template") || "";
        }
        return sharedProductArmor;
    }
    var sharedModelArmor;
    function getSharedModelArmor() {
        if (sharedModelArmor === undefined) {
            sharedModelArmor = context.getVariable("propertyset.model_locations." + primaryModel + ".model_armor_template") || "";
        }
        return sharedModelArmor;
    }

    var claimReqTemplate = cleanTokenAttr(context.getVariable("accesstoken.model_armor_request_template")) ||
                           cleanTokenAttr(context.getVariable("auth_model_armor_request_template")) ||
                           sharedClaimArmor;

    var rawReqTemplate = globalArmorReqTemplate;
    var reqArmorSource = "global_default";
    if (claimReqTemplate && String(claimReqTemplate).trim() !== "") {
        rawReqTemplate = claimReqTemplate;
        reqArmorSource = "identity_claim";
    } else if (ruleReqTemplate && String(ruleReqTemplate).trim() !== "") {
        rawReqTemplate = ruleReqTemplate;
        reqArmorSource = "identity_rule";
    } else {
        var appReqTemplate = context.getVariable("verifyapikey.VA-ApiKey.model_armor_request_template") ||
                             context.getVariable("verifyapikey.VA-ApiKey.developer.model_armor_request_template") ||
                             getSharedAppArmor();
        if (appReqTemplate && String(appReqTemplate).trim() !== "") {
            rawReqTemplate = appReqTemplate;
            reqArmorSource = "app_attribute";
        } else {
            var personaReqTemplate = context.getVariable("propertyset.config.model_armor.persona." + identityPersona + ".request_template") ||
                                     getSharedPersonaArmor();
            if (personaReqTemplate && String(personaReqTemplate).trim() !== "") {
                rawReqTemplate = personaReqTemplate;
                reqArmorSource = "persona:" + identityPersona;
            } else {
                var productReqTemplate = context.getVariable("verifyapikey.VA-ApiKey.apiproduct.model_armor_request_template") ||
                                         context.getVariable("apiproduct.model_armor_request_template") ||
                                         getSharedProductArmor();
                if (productReqTemplate && String(productReqTemplate).trim() !== "") {
                    rawReqTemplate = productReqTemplate;
                    reqArmorSource = "api_product";
                } else {
                    var modelReqTemplate = context.getVariable("propertyset.model_locations." + primaryModel + ".model_armor_request_template") ||
                                           getSharedModelArmor();
                    if (modelReqTemplate && String(modelReqTemplate).trim() !== "") {
                        rawReqTemplate = modelReqTemplate;
                        reqArmorSource = "model_config";
                    }
                }
            }
        }
    }

    var claimRespTemplate = cleanTokenAttr(context.getVariable("accesstoken.model_armor_response_template")) ||
                            cleanTokenAttr(context.getVariable("auth_model_armor_response_template")) ||
                            sharedClaimArmor;

    var rawRespTemplate = globalArmorRespTemplate;
    var respArmorSource = "global_default";
    if (claimRespTemplate && String(claimRespTemplate).trim() !== "") {
        rawRespTemplate = claimRespTemplate;
        respArmorSource = "identity_claim";
    } else if (ruleRespTemplate && String(ruleRespTemplate).trim() !== "") {
        rawRespTemplate = ruleRespTemplate;
        respArmorSource = "identity_rule";
    } else {
        var appRespTemplate = context.getVariable("verifyapikey.VA-ApiKey.model_armor_response_template") ||
                              context.getVariable("verifyapikey.VA-ApiKey.developer.model_armor_response_template") ||
                              getSharedAppArmor();
        if (appRespTemplate && String(appRespTemplate).trim() !== "") {
            rawRespTemplate = appRespTemplate;
            respArmorSource = "app_attribute";
        } else {
            var personaRespTemplate = context.getVariable("propertyset.config.model_armor.persona." + identityPersona + ".response_template") ||
                                      getSharedPersonaArmor();
            if (personaRespTemplate && String(personaRespTemplate).trim() !== "") {
                rawRespTemplate = personaRespTemplate;
                respArmorSource = "persona:" + identityPersona;
            } else {
                var productRespTemplate = context.getVariable("verifyapikey.VA-ApiKey.apiproduct.model_armor_response_template") ||
                                          context.getVariable("apiproduct.model_armor_response_template") ||
                                          getSharedProductArmor();
                if (productRespTemplate && String(productRespTemplate).trim() !== "") {
                    rawRespTemplate = productRespTemplate;
                    respArmorSource = "api_product";
                } else {
                    var modelRespTemplate = context.getVariable("propertyset.model_locations." + primaryModel + ".model_armor_response_template") ||
                                            getSharedModelArmor();
                    if (modelRespTemplate && String(modelRespTemplate).trim() !== "") {
                        rawRespTemplate = modelRespTemplate;
                        respArmorSource = "model_config";
                    }
                }
            }
        }
    }

    var reqSpec = parseArmorTemplateSpec(rawReqTemplate, defaultArmorProj, defaultArmorLoc);
    var respSpec = parseArmorTemplateSpec(rawRespTemplate, defaultArmorProj, defaultArmorLoc);
    var reqEnabled = globalArmorEnabled && reqSpec.enabled;
    var respEnabled = globalArmorEnabled && respSpec.enabled;

    context.setVariable("model_armor_request_enabled", reqEnabled ? "true" : "false");
    context.setVariable("model_armor_request_project_id", reqSpec.projectId);
    context.setVariable("model_armor_request_location", reqSpec.location);
    context.setVariable("model_armor_request_template", reqSpec.template);
    context.setVariable("model_armor_request_source", reqArmorSource);

    context.setVariable("model_armor_response_enabled", respEnabled ? "true" : "false");
    context.setVariable("model_armor_response_project_id", respSpec.projectId);
    context.setVariable("model_armor_response_location", respSpec.location);
    context.setVariable("model_armor_response_template", respSpec.template);
    context.setVariable("model_armor_response_source", respArmorSource);

    var combinedArmorSource = (reqArmorSource === respArmorSource) ? reqArmorSource : (reqArmorSource + "/" + respArmorSource);
    context.setVariable("model_armor_source", combinedArmorSource);
    context.setVariable("response.header.X-Gateway-Model-Armor-Request-Template", reqEnabled ? reqSpec.template : "none");
    context.setVariable("response.header.X-Gateway-Model-Armor-Response-Template", respEnabled ? respSpec.template : "none");
    context.setVariable("response.header.X-Gateway-Model-Armor-Source", combinedArmorSource);

    context.setVariable("response.header.X-Gateway-Requested-Model", requestedModel);
    context.setVariable("response.header.X-Gateway-Routed-Model", primaryModel);
    context.setVariable("response.header.X-Gateway-Fallback-Model", fallbackModel || "none");

} catch (e) {
    print("Error resolving Smart Router model and location: " + e);
    context.setVariable("model", defaultModel || "gemini-3.5-flash");
    context.setVariable("primary_model", defaultModel || "gemini-3.5-flash");
    context.setVariable("route_target", defaultTarget || "gemini");
    context.setVariable("endpoint_host", "aiplatform.googleapis.com");
    context.setVariable("endpoint_location", "global");
    context.setVariable("model_location", "global");
    context.setVariable("rate_limit_client_id", vaClientId || "default_client");
    context.setVariable("burst_rate_limit", "600pm");
    context.setVariable("concurrency_limit", "20");
    context.setVariable("model_armor_request_enabled", "true");
    context.setVariable("model_armor_request_project_id", defaultArmorProj || "");
    context.setVariable("model_armor_request_location", defaultArmorLoc || "us-central1");
    context.setVariable("model_armor_request_template", globalArmorTemplate || "ai-gw-template");
    context.setVariable("model_armor_response_enabled", "true");
    context.setVariable("model_armor_response_project_id", defaultArmorProj || "");
    context.setVariable("model_armor_response_location", defaultArmorLoc || "us-central1");
    context.setVariable("model_armor_response_template", globalArmorTemplate || "ai-gw-template");
}

})();
