(function () {
'use strict';

try {
    var bodyStr = context.getVariable("request.content");
    var basePath = context.getVariable("proxy.basepath") || "";
    var pathSuffix = context.getVariable("proxy.pathsuffix") || "";

    if (bodyStr) {
        var body = JSON.parse(bodyStr);
        
        if (body.model) {
            var modelName = body.model;
            context.setVariable("model", modelName);
            
            // Determine publisher prefix dynamically instead of hardcoding google/
            // Supports Vertex AI Model Garden MaaS publishers (e.g. meta/, mistralai/, deepseek-ai/, qwen/, google/)
            var slashIdx = modelName.indexOf("/");
            var explicitPub = null;
            var bareModel = modelName;

            if (slashIdx !== -1) {
                var prefix = modelName.substring(0, slashIdx);
                if (prefix !== "gateway" && prefix !== "auto") {
                    explicitPub = prefix;
                    bareModel = modelName.substring(slashIdx + 1);
                    context.setVariable("input_publisher_prefix", explicitPub);
                }
            }

            var configuredPub = context.getVariable("propertyset.model_locations." + bareModel + ".publisher") ||
                                context.getVariable("propertyset.model_locations." + modelName + ".publisher") ||
                                explicitPub ||
                                context.getVariable("propertyset.model_locations.default.publisher") ||
                                "google";

            var fullModel = (slashIdx !== -1 && explicitPub) ? (configuredPub + "/" + bareModel) : (configuredPub + "/" + modelName);
            context.setVariable("original_model", fullModel);
        }
        
        var isEmbeddings = (body.input !== undefined && !body.messages) ||
                           (basePath.indexOf("/embeddings") !== -1) ||
                           (pathSuffix.indexOf("/embeddings") !== -1);
        if (isEmbeddings) {
            context.setVariable("is_embeddings", "true");
            context.setVariable("stream", false);
        } else {
            var stream = body.stream === true || body.stream === "true";
            context.setVariable("stream", stream);
        }
        context.setVariable("request_format", "openai");
        
        // Extract prompt from chat messages or embeddings input
        var prompts = [];
        if (body.messages && Array.isArray(body.messages)) {
            for (var i = 0; i < body.messages.length; i++) {
                var msg = body.messages[i];
                if (msg.role === "user" || msg.role === "system") {
                    if (typeof msg.content === "string") {
                        prompts.push(msg.content);
                    } else if (Array.isArray(msg.content)) {
                        for (var j = 0; j < msg.content.length; j++) {
                            var block = msg.content[j];
                            if (block.type === "text" && block.text) {
                                prompts.push(block.text);
                            }
                        }
                    }
                }
            }
        } else if (body.input !== undefined) {
            if (typeof body.input === "string") {
                prompts.push(body.input);
            } else if (Array.isArray(body.input)) {
                for (var k = 0; k < body.input.length; k++) {
                    if (typeof body.input[k] === "string") {
                        prompts.push(body.input[k]);
                    }
                }
            }
        }
        if (prompts.length > 0) {
            context.setVariable("extracted_prompt", prompts.join("\n"));
        }
    }
} catch (e) {
    print("Error extracting OpenAI compat variables: " + e);
}

})();
