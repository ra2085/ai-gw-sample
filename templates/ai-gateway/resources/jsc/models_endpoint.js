(function () {
'use strict';

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

    function buildModelObject(id, dispOverride) {
        var displayName = dispOverride || context.getVariable("propertyset.model_locations." + id + ".display_name") || id;
        var createdAt = context.getVariable("propertyset.model_locations." + id + ".created_at") || "2025-01-01T00:00:00Z";
        var publisher = context.getVariable("propertyset.model_locations." + id + ".publisher") || "google";
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
        var aliasTarget = context.getVariable("propertyset.model_locations.alias." + requestedId);
        var effectiveId = aliasTarget || requestedId;

        var foundModel = null;
        for (var j = 0; j < catalogIds.length; j++) {
            if (catalogIds[j].trim() === effectiveId) {
                foundModel = buildModelObject(effectiveId, null);
                break;
            }
        }

        // If not found in catalog list, check direct propertyset definition
        if (!foundModel && !allowedByProduct) {
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

})();
