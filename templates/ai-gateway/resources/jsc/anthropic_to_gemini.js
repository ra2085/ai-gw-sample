try {
    var contentStr = context.getVariable("request.content");
    if (contentStr) {
        var body = JSON.parse(contentStr);
        var geminiContents = [];
        
        // ---------------------------------------------------------------------
        // 1. System Instruction Mapping
        // ---------------------------------------------------------------------
        var systemInstruction = null;
        if (body.system) {
            var systemParts = [];
            if (typeof body.system === "string") {
                systemParts.push({ "text": body.system });
            } else if (Array.isArray(body.system)) {
                for (var i = 0; i < body.system.length; i++) {
                    var sBlock = body.system[i];
                    if (typeof sBlock === "string") {
                        systemParts.push({ "text": sBlock });
                    } else if (sBlock && sBlock.text) {
                        systemParts.push({ "text": sBlock.text });
                    }
                }
            }
            if (systemParts.length > 0) {
                systemInstruction = { "parts": systemParts };
            }
        }
        
        // ---------------------------------------------------------------------
        // 2. Messages & Content Blocks (Text, Multimodal Images, Tool Invocations)
        // ---------------------------------------------------------------------
        // Map to keep track of tool_use callId -> tool name for functionResponse
        var toolCallNames = {};

        if (body.messages && Array.isArray(body.messages)) {
            for (var j = 0; j < body.messages.length; j++) {
                var msg = body.messages[j];
                var parts = [];
                var role = msg.role === "assistant" ? "model" : msg.role;
                
                if (typeof msg.content === "string") {
                    parts.push({ "text": msg.content });
                } else if (Array.isArray(msg.content)) {
                    for (var k = 0; k < msg.content.length; k++) {
                        var block = msg.content[k];
                        if (!block) continue;
                        
                        if (block.type === "text" && block.text) {
                            parts.push({ "text": block.text });
                        } else if (block.type === "image" && block.source) {
                            // Multimodal Image (base64)
                            if (block.source.type === "base64" && block.source.data) {
                                parts.push({
                                    "inlineData": {
                                        "mimeType": block.source.media_type || "image/jpeg",
                                        "data": block.source.data
                                    }
                                });
                            }
                        } else if (block.type === "tool_use") {
                            // Assistant tool invocation -> Gemini functionCall
                            toolCallNames[block.id] = block.name;
                            parts.push({
                                "functionCall": {
                                    "name": block.name,
                                    "args": block.input || {}
                                }
                            });
                        } else if (block.type === "tool_result") {
                            // User tool response -> Gemini functionResponse
                            var funcName = toolCallNames[block.tool_use_id] || block.tool_use_id;
                            var toolOutput = typeof block.content === "string" ? block.content : JSON.stringify(block.content || {});
                            role = "function";
                            parts.push({
                                "functionResponse": {
                                    "name": funcName,
                                    "response": {
                                        "name": funcName,
                                        "content": toolOutput
                                    }
                                }
                            });
                        }
                    }
                }
                
                if (parts.length > 0) {
                    geminiContents.push({
                        "role": role,
                        "parts": parts
                    });
                }
            }
        }
        
        // ---------------------------------------------------------------------
        // 3. Tool Declarations (Anthropic tools -> Gemini functionDeclarations)
        // ---------------------------------------------------------------------
        var geminiTools = null;
        if (body.tools && Array.isArray(body.tools) && body.tools.length > 0) {
            var funcDeclarations = [];
            for (var t = 0; t < body.tools.length; t++) {
                var tool = body.tools[t];
                funcDeclarations.push({
                    "name": tool.name,
                    "description": tool.description || "",
                    "parameters": tool.input_schema || {}
                });
            }
            if (funcDeclarations.length > 0) {
                geminiTools = [{
                    "functionDeclarations": funcDeclarations
                }];
            }
        }
        
        // ---------------------------------------------------------------------
        // 4. Generation Config & Safety Settings
        // ---------------------------------------------------------------------
        var genConfig = {};
        if (body.max_tokens !== undefined) {
            genConfig.maxOutputTokens = body.max_tokens;
        }
        if (body.temperature !== undefined) {
            genConfig.temperature = body.temperature;
        }
        if (body.top_p !== undefined) {
            genConfig.topP = body.top_p;
        }
        if (body.top_k !== undefined) {
            genConfig.topK = body.top_k;
        }
        if (body.stop_sequences && Array.isArray(body.stop_sequences)) {
            genConfig.stopSequences = body.stop_sequences;
        }
        
        // ---------------------------------------------------------------------
        // 5. Construct Gemini Request Payload
        // ---------------------------------------------------------------------
        var geminiBody = {
            "contents": geminiContents
        };
        
        if (systemInstruction) {
            geminiBody.systemInstruction = systemInstruction;
        }
        if (geminiTools) {
            geminiBody.tools = geminiTools;
        }
        if (Object.keys(genConfig).length > 0) {
            geminiBody.generationConfig = genConfig;
        }
        
        context.setVariable("request.content", JSON.stringify(geminiBody));
        
        // ---------------------------------------------------------------------
        // 6. Dynamic Target URL Generation
        // ---------------------------------------------------------------------
        var defaultModel = context.getVariable("propertyset.model_locations.default.model") || "gemini-3.5-flash";
        var model = context.getVariable("primary_model") || 
                    context.getVariable("model") || 
                    defaultModel;
        
        if (model.indexOf("auto") === 0 || model.indexOf("gateway") === 0) {
            model = defaultModel;
        }
        
        var stream = body.stream === true || body.stream === "true";
        var action = stream ? "streamGenerateContent" : "generateContent";
        
        var project = context.getVariable("propertyset.config.project_id");
        var endpointHost = context.getVariable("endpoint_host") || "aiplatform.googleapis.com";
        var modelLocation = context.getVariable("model_location") || "global";
        
        var customUrl = context.getVariable("model_custom_url");
        if (customUrl) {
            context.setVariable("target.url", customUrl);
        } else {
            var targetUrl = "https://" + endpointHost + "/v1/projects/" + project + "/locations/" + modelLocation + "/publishers/google/models/" + model + ":" + action + (stream ? "?alt=sse" : "");
            context.setVariable("target.url", targetUrl);
        }
    }
} catch (e) {
    print("Error translating Anthropic to Gemini request: " + e);
}
