try {
    var bodyStr = context.getVariable("request.content");
    if (bodyStr) {
        var body = JSON.parse(bodyStr);
        
        if (body.model) {
            var modelName = body.model;
            context.setVariable("model", modelName);
            
            // Prepend google/ prefix for Vertex AI
            var fullModel = modelName;
            if (modelName.indexOf("google/") === -1) {
                fullModel = "google/" + modelName;
            }
            context.setVariable("original_model", fullModel);
        }
        
        var stream = body.stream === true || body.stream === "true";
        context.setVariable("stream", stream);
        context.setVariable("request_format", "openai");
        
        // Extract prompt
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
        }
        if (prompts.length > 0) {
            context.setVariable("extracted_prompt", prompts.join("\n"));
        }
    }
} catch (e) {
    print("Error extracting OpenAI compat variables: " + e);
}
