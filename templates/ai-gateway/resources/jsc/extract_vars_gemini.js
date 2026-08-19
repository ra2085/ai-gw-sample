try {
    var path = context.getVariable("proxy.pathsuffix");
    var requestFormat = "gemini"; // default
    var stream = false;
    var modelName = "unknown";

    if (path) {
        // Extract model name from the URI path
        // e.g. /projects/your-project-id/locations/us-central1/publishers/google/models/gemini-2.5-flash:streamGenerateContent
        var modelsIdx = path.indexOf("/models/");
        if (modelsIdx !== -1) {
            var modelPart = path.substring(modelsIdx + 8); // after "/models/"
            var colonIdx = modelPart.indexOf(":");
            modelName = colonIdx !== -1 ? modelPart.substring(0, colonIdx) : modelPart;
            context.setVariable("model", modelName);
        }

        // Detect if request is routing to anthropic/claude target
        var pub = context.getVariable("propertyset.model_locations." + modelName + ".publisher");
        if (path.indexOf("/publishers/anthropic/") !== -1 || pub === "anthropic" || modelName.indexOf("claude") !== -1) {
            requestFormat = "claude";
        }

        // Determine if it is streaming
        if (path.indexOf(":streamGenerateContent") !== -1 || path.indexOf(":streamRawPredict") !== -1) {
            stream = true;
        }
    }
    
    context.setVariable("stream", stream);
    context.setVariable("request_format", requestFormat);

    // Extract text prompts for sanitization
    var bodyStr = context.getVariable("request.content");
    if (bodyStr) {
        var body = JSON.parse(bodyStr);
        if (requestFormat === "claude") {
            var prompts = [];
            
            // Extract from system prompt (Anthropic format)
            if (body.system) {
                if (typeof body.system === "string") {
                    prompts.push(body.system);
                } else if (Array.isArray(body.system)) {
                    for (var i = 0; i < body.system.length; i++) {
                        if (body.system[i].text) {
                            prompts.push(body.system[i].text);
                        }
                    }
                }
            }
            
            // Extract from messages (Anthropic format)
            if (body.messages && Array.isArray(body.messages)) {
                for (var j = 0; j < body.messages.length; j++) {
                    var msg = body.messages[j];
                    if (msg.role === "user" || msg.role === "system") {
                        if (typeof msg.content === "string") {
                            prompts.push(msg.content);
                        } else if (Array.isArray(msg.content)) {
                            for (var k = 0; k < msg.content.length; k++) {
                                var block = msg.content[k];
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
        } else {
            // Gemini format
            if (body.contents && body.contents.length > 0) {
                var lastContent = body.contents[body.contents.length - 1];
                if (lastContent.parts) {
                    var textParts = [];
                    for (var i = 0; i < lastContent.parts.length; i++) {
                        if (lastContent.parts[i].text) {
                            textParts.push(lastContent.parts[i].text);
                        }
                    }
                    if (textParts.length > 0) {
                        context.setVariable("gemini_text_prompt", textParts.join("\n"));
                    }
                }
            }
        }

        // Clean any gateway plugins before sending to Vertex AI
        if (body.plugins || body.models || body.provider) {
            delete body.plugins;
            delete body.models;
            delete body.provider;
            context.setVariable("request.content", JSON.stringify(body));
        }
    }
} catch (e) {
    print("Error extracting Gemini native/Claude vars: " + e);
}
