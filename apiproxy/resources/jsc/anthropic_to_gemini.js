try {
    var contentStr = context.getVariable("request.content");
    if (contentStr) {
        var body = JSON.parse(contentStr);
        var geminiContents = [];
        
        // 1. System instruction mapping
        var systemInstruction = null;
        if (body.system) {
            var systemContent = "";
            if (typeof body.system === "string") {
                systemContent = body.system;
            } else if (Array.isArray(body.system)) {
                for (var i = 0; i < body.system.length; i++) {
                    if (body.system[i].text) {
                        systemContent += body.system[i].text + "\n";
                    }
                }
                systemContent = systemContent.trim();
            }
            if (systemContent) {
                systemInstruction = {
                    "parts": [
                        { "text": systemContent }
                    ]
                };
            }
        }
        
        // 2. Contents mapping (messages)
        if (body.messages && Array.isArray(body.messages)) {
            for (var j = 0; j < body.messages.length; j++) {
                var msg = body.messages[j];
                var contentText = "";
                
                if (typeof msg.content === "string") {
                    contentText = msg.content;
                } else if (Array.isArray(msg.content)) {
                    for (var k = 0; k < msg.content.length; k++) {
                        var block = msg.content[k];
                        if (block.type === "text" && block.text) {
                            contentText += block.text;
                        }
                    }
                }
                
                // Map role 'assistant' to 'model'
                var role = msg.role === "assistant" ? "model" : msg.role;
                
                geminiContents.push({
                    "role": role,
                    "parts": [
                        { "text": contentText }
                    ]
                });
            }
        }
        
        // 3. Create Gemini Request Payload
        var geminiBody = {
            "contents": geminiContents
        };
        
        if (systemInstruction) {
            geminiBody.systemInstruction = systemInstruction;
        }
        
        // 4. Generation Config
        var genConfig = {};
        if (body.max_tokens !== undefined) {
            genConfig.maxOutputTokens = body.max_tokens;
        }
        if (body.temperature !== undefined) {
            genConfig.temperature = body.temperature;
        }
        if (Object.keys(genConfig).length > 0) {
            geminiBody.generationConfig = genConfig;
        }
        
        context.setVariable("request.content", JSON.stringify(geminiBody));
        
        // 5. Dynamic URL generation based on model and stream preference
        var model = body.model || "gemini-1.5-flash";
        // Convert Anthropic model mapping to Gemini model if needed
        if (model.indexOf("gemini") === -1) {
            model = "gemini-1.5-flash";
        }
        
        var stream = body.stream === true || body.stream === "true";
        var action = stream ? "streamGenerateContent" : "generateContent";
        
        var project = context.getVariable("propertyset.config.project_id") || "your-project-id";
        var endpointHost = context.getVariable("endpoint_host") || "us-central1-aiplatform.googleapis.com";
        var modelLocation = context.getVariable("model_location") || "us-central1";
        var url = "https://" + endpointHost + "/v1/projects/" + project + "/locations/" + modelLocation + "/publishers/google/models/" + model + ":" + action;
        context.setVariable("target.url", url);
    }
} catch (e) {
    print("Error translating Anthropic to Gemini request: " + e);
}
