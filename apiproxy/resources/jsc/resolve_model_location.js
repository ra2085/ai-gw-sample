try {
    var model = context.getVariable("model");
    var format = context.getVariable("request_format");
    
    var endpointLocation = null;
    var modelLocation = null;
    
    if (format === "openai") {
        endpointLocation = context.getVariable("propertyset.model_locations.default_openai.endpoint") || "global";
        modelLocation = context.getVariable("propertyset.model_locations.default_openai.model") || "us";
    } else if (model) {
        endpointLocation = context.getVariable("propertyset.model_locations." + model + ".endpoint");
        modelLocation = context.getVariable("propertyset.model_locations." + model + ".model");
    }
    
    if (!endpointLocation || !modelLocation) {
        // Fallbacks
        if (model && model.indexOf("claude") !== -1) {
            endpointLocation = endpointLocation || context.getVariable("propertyset.model_locations.default_claude.endpoint") || "us-east5";
            modelLocation = modelLocation || context.getVariable("propertyset.model_locations.default_claude.model") || "us-east5";
        } else {
            endpointLocation = endpointLocation || context.getVariable("propertyset.model_locations.default_gemini.endpoint") || "us-central1";
            modelLocation = modelLocation || context.getVariable("propertyset.model_locations.default_gemini.model") || "us-central1";
        }
    }
    
    var endpointHost = (endpointLocation && endpointLocation !== "global") ? endpointLocation + "-aiplatform.googleapis.com" : "aiplatform.googleapis.com";
    
    context.setVariable("endpoint_host", endpointHost);
    context.setVariable("endpoint_location", endpointLocation);
    context.setVariable("model_location", modelLocation);
} catch (e) {
    context.setVariable("endpoint_host", "us-central1-aiplatform.googleapis.com");
    context.setVariable("endpoint_location", "us-central1");
    context.setVariable("model_location", "us-central1");
}
