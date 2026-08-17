try {
    var extractedModel = context.getVariable("model");
    var bodyStr = context.getVariable("request.content") || "";
    
    var defaultModel = context.getVariable("propertyset.model_locations.default.model") || "gemini-3.5-flash";
    var defaultFallback = context.getVariable("propertyset.model_locations.default.fallback") || "gemini-3.1-flash-lite";
    var defaultPublisher = context.getVariable("propertyset.model_locations.default.publisher") || "google";
    var defaultTarget = context.getVariable("propertyset.model_locations.default.target") || "gemini";

    var requestedModel = extractedModel || "default";
    var primaryModel = extractedModel || defaultModel;
    var fallbackModel = null;
    var costTier = null;
    var allowFallbacks = true;

    // -------------------------------------------------------------------------
    // 1. Fast Path: Standard Direct Single-Model Requests (Zero JSON Parse)
    // -------------------------------------------------------------------------
    var directAlias = extractedModel ? context.getVariable("propertyset.model_locations.alias." + extractedModel) : null;
    var hasAdvancedFeatures = (bodyStr.indexOf('"models"') !== -1 || 
                               bodyStr.indexOf('"plugins"') !== -1 || 
                               bodyStr.indexOf('"auto"') !== -1 ||
                               directAlias !== null);

    if (!hasAdvancedFeatures && extractedModel) {
        // Fast-path: Direct model already extracted by EV-Model
        requestedModel = extractedModel;
        primaryModel = extractedModel;
    } else {
        // ---------------------------------------------------------------------
        // 2. Deep Path: Multi-Model Fallback Arrays, Auto-Router & Cost Tiers
        // ---------------------------------------------------------------------
        var body = bodyStr ? JSON.parse(bodyStr) : {};
        var requestedCandidates = [];

        if (Array.isArray(body.models) && body.models.length > 0) {
            requestedCandidates = body.models;
            requestedModel = "models:[" + body.models.join(",") + "]";
        } else if (body.model) {
            requestedCandidates = [body.model];
            requestedModel = body.model;
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
            context.setVariable("response.header.X-Gateway-Cost-Tier", costTier);
        }

        // Fast string prefix normalization & alias lookup
        var resolvedCandidates = [];
        for (var c = 0; c < requestedCandidates.length; c++) {
            var rawModel = requestedCandidates[c];
            if (!rawModel) continue;
            var slashIdx = rawModel.indexOf('/');
            var normalized = (slashIdx !== -1) ? rawModel.substring(slashIdx + 1) : rawModel;
            
            var alias = context.getVariable("propertyset.model_locations.alias." + normalized);
            resolvedCandidates.push(alias || normalized);
        }

        // Optional API Product Entitlements Filter
        var allowedByProduct = context.getVariable("apiproduct.allowed_models");
        if (allowedByProduct) {
            var allowedList = allowedByProduct.split(",").map(function(s) { return s.trim(); });
            var filtered = resolvedCandidates.filter(function(m) {
                return allowedList.indexOf(m) !== -1;
            });
            if (filtered.length > 0) {
                resolvedCandidates = filtered;
            }
        }

        primaryModel = resolvedCandidates[0] || defaultModel;
        fallbackModel = (resolvedCandidates.length > 1 && resolvedCandidates[1] !== primaryModel) ? resolvedCandidates[1] : null;

        var providerPrefs = body.provider || {};
        allowFallbacks = providerPrefs.allow_fallbacks !== false;
    }

    // -------------------------------------------------------------------------
    // 3. Dynamic Target, Publisher & Region Resolution via PropertySet
    // -------------------------------------------------------------------------
    var publisher = context.getVariable("propertyset.model_locations." + primaryModel + ".publisher") || defaultPublisher;
    var targetName = context.getVariable("propertyset.model_locations." + primaryModel + ".target") || defaultTarget;
    var endpointLocation = context.getVariable("propertyset.model_locations." + primaryModel + ".endpoint") || "global";
    var modelLocation = context.getVariable("propertyset.model_locations." + primaryModel + ".model") || "global";

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
    context.setVariable("route_target", targetName);
    context.setVariable("endpoint_host", endpointHost);
    context.setVariable("endpoint_location", endpointLocation);
    context.setVariable("model_location", modelLocation);

    context.setVariable("response.header.X-Gateway-Requested-Model", requestedModel);
    context.setVariable("response.header.X-Gateway-Routed-Model", primaryModel);
    context.setVariable("response.header.X-Gateway-Fallback-Model", fallbackModel || "none");

} catch (e) {
    print("Error resolving Smart Router model and location: " + e);
    var defModel = context.getVariable("propertyset.model_locations.default.model") || "gemini-3.5-flash";
    var defTarget = context.getVariable("propertyset.model_locations.default.target") || "gemini";
    context.setVariable("model", defModel);
    context.setVariable("primary_model", defModel);
    context.setVariable("route_target", defTarget);
    context.setVariable("endpoint_host", "aiplatform.googleapis.com");
    context.setVariable("endpoint_location", "global");
    context.setVariable("model_location", "global");
}
