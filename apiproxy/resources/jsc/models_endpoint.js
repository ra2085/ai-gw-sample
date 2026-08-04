try {
    var pathSuffix = context.getVariable("proxy.pathsuffix");
    var models = [
        {
            "type": "model",
            "id": "claude-haiku-4-5",
            "display_name": "Claude 4.5 Haiku",
            "created_at": "2025-10-01T00:00:00Z"
        },
        {
            "type": "model",
            "id": "claude-3-5-sonnet",
            "display_name": "Claude 3.5 Sonnet",
            "created_at": "2024-06-20T00:00:00Z"
        },
        {
            "type": "model",
            "id": "claude-3-5-haiku",
            "display_name": "Claude 3.5 Haiku",
            "created_at": "2024-10-22T00:00:00Z"
        }
    ];

    if (pathSuffix === "" || pathSuffix === "/") {
        // List Models
        var responsePayload = {
            "data": models,
            "has_more": false,
            "first_id": models[0].id,
            "last_id": models[models.length - 1].id
        };
        
        var productVars = [
            "apiproduct.name",
            "apiproduct.display_name",
            "apiproduct.access",
            "apiproduct.allowed-models",
            "apiproduct.allowed_models",
            "apiproduct.custom.access",
            "apiproduct.custom.allowed-models",
            "apiproduct.custom.allowed_models",
            "apiproduct.attributes.access",
            "apiproduct.attributes.allowed-models",
            "apiproduct.attributes.allowed_models"
        ];
        var result = {};
        for (var i = 0; i < productVars.length; i++) {
            var v = productVars[i];
            var val = context.getVariable(v);
            result[v] = val === undefined ? "undefined" : (val === null ? "null" : val);
        }
        context.setVariable("response.header.X-Product-Variables-New", JSON.stringify(result));

        context.setVariable("response.content", JSON.stringify(responsePayload));
        context.setVariable("response.header.Content-Type", "application/json");
        context.setVariable("response.status.code", 200);
    } else {
        // Retrieve Model
        // Extract model ID from pathSuffix (e.g. "/claude-3-5-sonnet" -> "claude-3-5-sonnet")
        var requestedId = pathSuffix.substring(1);
        
        // Strip any leading/trailing slashes or carriage returns to sanitize input path variable
        requestedId = requestedId.replace(/^\/+|\/+$/g, "").trim();

        var foundModel = null;
        for (var i = 0; i < models.length; i++) {
            if (models[i].id === requestedId) {
                foundModel = models[i];
                break;
            }
        }

        if (foundModel) {
            context.setVariable("response.content", JSON.stringify(foundModel));
            context.setVariable("response.header.Content-Type", "application/json");
            context.setVariable("response.status.code", 200);
        } else {
            // Not Found
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
    var errorPayload = {
        "error": {
            "type": "api_error",
            "message": "Internal gateway error processing models request: " + e.toString()
        }
    };
    context.setVariable("response.content", JSON.stringify(errorPayload));
    context.setVariable("response.header.Content-Type", "application/json");
    context.setVariable("response.status.code", 500);
}
