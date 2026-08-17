try {
    var pathSuffix = context.getVariable("proxy.pathsuffix") || "";
    
    // 1. Dynamically load model catalog from propertyset
    var catalogStr = context.getVariable("propertyset.model_locations.models.catalog") || "";
    var catalogIds = catalogStr ? catalogStr.split(",") : [];
    
    // Optional filtering by API product entitlements
    var allowedByProduct = context.getVariable("apiproduct.allowed_models") || 
                           context.getVariable("apiproduct.allowed-models") ||
                           context.getVariable("apiproduct.custom.allowed_models");
    if (allowedByProduct) {
        var allowedList = allowedByProduct.split(",").map(function(s) { return s.trim(); });
        catalogIds = catalogIds.filter(function(id) {
            return allowedList.indexOf(id.trim()) !== -1;
        });
    }

    // Build model list dynamically from propertyset definitions
    var models = [];
    for (var i = 0; i < catalogIds.length; i++) {
        var modelId = catalogIds[i].trim();
        if (modelId) {
            var displayName = context.getVariable("propertyset.model_locations." + modelId + ".display_name") || modelId;
            var createdAt = context.getVariable("propertyset.model_locations." + modelId + ".created_at") || "2025-01-01T00:00:00Z";
            var publisher = context.getVariable("propertyset.model_locations." + modelId + ".publisher") || "google";
            
            models.push({
                "type": "model",
                "id": modelId,
                "display_name": displayName,
                "created_at": createdAt,
                "owned_by": publisher
            });
        }
    }

    if (pathSuffix === "" || pathSuffix === "/") {
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
        var aliasTarget = context.getVariable("propertyset.model_locations.alias." + requestedId);
        var effectiveId = aliasTarget || requestedId;

        var foundModel = null;
        for (var j = 0; j < models.length; j++) {
            if (models[j].id === effectiveId) {
                foundModel = models[j];
                break;
            }
        }

        // If not found in catalog list, check direct propertyset definition
        if (!foundModel) {
            var dispName = context.getVariable("propertyset.model_locations." + effectiveId + ".display_name");
            if (dispName) {
                foundModel = {
                    "type": "model",
                    "id": effectiveId,
                    "display_name": dispName,
                    "created_at": context.getVariable("propertyset.model_locations." + effectiveId + ".created_at") || "2025-01-01T00:00:00Z",
                    "owned_by": context.getVariable("propertyset.model_locations." + effectiveId + ".publisher") || "google"
                };
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
    var errPayload = {
        "error": {
            "type": "api_error",
            "message": "Internal gateway error processing models request: " + e.toString()
        }
    };
    context.setVariable("response.content", JSON.stringify(errPayload));
    context.setVariable("response.header.Content-Type", "application/json");
    context.setVariable("response.status.code", 500);
}
