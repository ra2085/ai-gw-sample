try {
    var customUrl = context.getVariable("model_custom_url");
    if (customUrl) {
        context.setVariable("target.url", customUrl);
    }
    var requestFormat = context.getVariable("request_format") || "claude";
    var content = context.getVariable("request.content");
    if (content) {
        var body = JSON.parse(content);

        if (requestFormat === "openai") {
            // Transcode OpenAI request -> Anthropic schema
            var anthropicBody = {
                anthropic_version: "vertex-2023-10-16",
                max_tokens: body.max_tokens || body.max_completion_tokens || 4096,
                messages: []
            };

            if (body.temperature !== undefined) {
                anthropicBody.temperature = body.temperature;
            }
            if (body.top_p !== undefined) {
                anthropicBody.top_p = body.top_p;
            }
            if (body.stop) {
                anthropicBody.stop_sequences = Array.isArray(body.stop) ? body.stop : [body.stop];
            }

            var systemPrompt = "";
            var inMessages = body.messages || [];

            for (var i = 0; i < inMessages.length; i++) {
                var msg = inMessages[i];
                if (msg.role === "system") {
                    systemPrompt += (systemPrompt ? "\n" : "") + (typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content));
                } else if (msg.role === "user" || msg.role === "assistant") {
                    var anthropicContent = msg.content;
                    if (Array.isArray(msg.content)) {
                        anthropicContent = [];
                        for (var c = 0; c < msg.content.length; c++) {
                            var part = msg.content[c];
                            if (part.type === "text") {
                                anthropicContent.push({ type: "text", text: part.text });
                            } else if (part.type === "image_url" && part.image_url && part.image_url.url) {
                                var imgUrl = part.image_url.url;
                                if (imgUrl.indexOf("data:") === 0) {
                                    var commaIdx = imgUrl.indexOf(",");
                                    var headerPart = imgUrl.substring(5, commaIdx);
                                    var mediaType = headerPart.split(";")[0];
                                    var base64Data = imgUrl.substring(commaIdx + 1);
                                    anthropicContent.push({
                                        type: "image",
                                        source: {
                                            type: "base64",
                                            media_type: mediaType,
                                            data: base64Data
                                        }
                                    });
                                }
                            }
                        }
                    }
                    anthropicBody.messages.push({
                        role: msg.role,
                        content: anthropicContent
                    });
                }
            }

            if (systemPrompt) {
                anthropicBody.system = systemPrompt;
            }

            // Convert OpenAI tools -> Anthropic tools
            if (body.tools && Array.isArray(body.tools)) {
                anthropicBody.tools = [];
                for (var t = 0; t < body.tools.length; t++) {
                    var tool = body.tools[t];
                    if (tool.type === "function" && tool.function) {
                        anthropicBody.tools.push({
                            name: tool.function.name,
                            description: tool.function.description || "",
                            input_schema: tool.function.parameters || { type: "object", properties: {} }
                        });
                    }
                }
            }

            // If non-streaming and no customUrl, route to :rawPredict on Vertex AI
            var isStream = body.stream === true || body.stream === "true" || context.getVariable("stream") === "true";
            if (!customUrl && !isStream) {
                var project = context.getVariable("propertyset.config.project_id");
                var endpointHost = context.getVariable("endpoint_host") || "aiplatform.googleapis.com";
                var modelLocation = context.getVariable("model_location") || "us-east5";
                var model = context.getVariable("model") || "claude-haiku-4-5";
                var targetUrl = "https://" + endpointHost + "/v1/projects/" + project + "/locations/" + modelLocation + "/publishers/anthropic/models/" + model + ":rawPredict";
                context.setVariable("target.url", targetUrl);
            }

            context.setVariable("request.content", JSON.stringify(anthropicBody));

        } else {
            // Remove gateway/non-standard top-level fields not accepted by Anthropic
            if (!customUrl) {
                delete body.model;
            }
            delete body.models;
            delete body.plugins;
            delete body.provider;

            // Ensure required anthropic_version is present
            body.anthropic_version = "vertex-2023-10-16";

            context.setVariable("request.content", JSON.stringify(body));
        }
    }
} catch (e) {
    print("Error in inject_anthropic_version: " + e);
}


