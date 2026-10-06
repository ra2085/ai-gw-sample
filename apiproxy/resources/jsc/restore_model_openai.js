(function () {
'use strict';

try {
    var customUrl = context.getVariable("model_custom_url");
    var isEmbeddings = context.getVariable("is_embeddings") === "true";
    var requestFormat = context.getVariable("request_format") || "claude";
    var resolvedModel = context.getVariable("model");
    var publisher = context.getVariable("model_publisher") || context.getVariable("input_publisher_prefix") || "google";
    var originalModel = context.getVariable("original_model");
    var upstreamModel = resolvedModel ? context.getVariable("propertyset.model_locations." + resolvedModel + ".upstream_model") : null;
    var projectId = context.getVariable("propertyset.config.project_id");
    var endpointHost = context.getVariable("endpoint_host") || "aiplatform.googleapis.com";
    var modelLocation = context.getVariable("model_location") || "global";

    var bodyStr = context.getVariable("request.content");
    var body = bodyStr ? JSON.parse(bodyStr) : {};

    // Remove gateway-specific routing fields before forwarding upstream
    delete body.models;
    delete body.plugins;
    delete body.provider;

    // If request arrived in Anthropic format (/v1/messages) targeting an OpenAI-format model
    // (hosted in Vertex Model Garden, Direct OpenAI, or external custom_url), transcode to OpenAI Chat Completions
    if (!isEmbeddings && requestFormat !== "openai" && !Array.isArray(body.instances)) {
        var openAiMessages = [];

        if (body.system) {
            var sysText = "";
            if (typeof body.system === "string") {
                sysText = body.system;
            } else if (Array.isArray(body.system)) {
                var sysParts = [];
                for (var s = 0; s < body.system.length; s++) {
                    var sBlock = body.system[s];
                    if (typeof sBlock === "string") {
                        sysParts.push(sBlock);
                    } else if (sBlock && sBlock.text) {
                        sysParts.push(sBlock.text);
                    }
                }
                sysText = sysParts.join("\n");
            }
            if (sysText) {
                openAiMessages.push({ role: "system", content: sysText });
            }
        }

        if (Array.isArray(body.messages)) {
            for (var m = 0; m < body.messages.length; m++) {
                var msg = body.messages[m];
                if (!msg) continue;

                if (typeof msg.content === "string") {
                    openAiMessages.push({ role: msg.role, content: msg.content });
                } else if (Array.isArray(msg.content)) {
                    var contentParts = [];
                    var toolCalls = [];
                    var toolResults = [];

                    for (var k = 0; k < msg.content.length; k++) {
                        var block = msg.content[k];
                        if (!block) continue;

                        if (block.type === "text" && block.text !== undefined) {
                            contentParts.push({ type: "text", text: block.text });
                        } else if (block.type === "image" && block.source) {
                            if (block.source.type === "base64" && block.source.data) {
                                var mediaType = block.source.media_type || "image/jpeg";
                                contentParts.push({
                                    type: "image_url",
                                    image_url: { url: "data:" + mediaType + ";base64," + block.source.data }
                                });
                            } else if (block.source.type === "url" && block.source.url) {
                                contentParts.push({
                                    type: "image_url",
                                    image_url: { url: block.source.url }
                                });
                            }
                        } else if (block.type === "tool_use") {
                            toolCalls.push({
                                id: block.id || ("call_" + k),
                                type: "function",
                                function: {
                                    name: block.name,
                                    arguments: typeof block.input === "string" ? block.input : JSON.stringify(block.input || {})
                                }
                            });
                        } else if (block.type === "tool_result") {
                            var resultStr = "";
                            if (typeof block.content === "string") {
                                resultStr = block.content;
                            } else if (Array.isArray(block.content)) {
                                var rTexts = [];
                                for (var r = 0; r < block.content.length; r++) {
                                    if (block.content[r] && block.content[r].text) {
                                        rTexts.push(block.content[r].text);
                                    }
                                }
                                resultStr = rTexts.length > 0 ? rTexts.join("\n") : JSON.stringify(block.content);
                            } else if (block.content !== undefined) {
                                resultStr = JSON.stringify(block.content);
                            }
                            toolResults.push({
                                role: "tool",
                                tool_call_id: block.tool_use_id || "call_0",
                                content: resultStr
                            });
                        }
                    }

                    if (contentParts.length > 0 || toolCalls.length > 0) {
                        var openAiMsg = { role: msg.role };
                        if (contentParts.length === 1 && contentParts[0].type === "text") {
                            openAiMsg.content = contentParts[0].text;
                        } else if (contentParts.length > 0) {
                            openAiMsg.content = contentParts;
                        } else {
                            openAiMsg.content = null;
                        }
                        if (toolCalls.length > 0) {
                            openAiMsg.tool_calls = toolCalls;
                        }
                        openAiMessages.push(openAiMsg);
                    }

                    for (var tr = 0; tr < toolResults.length; tr++) {
                        openAiMessages.push(toolResults[tr]);
                    }
                }
            }
        }

        var openAiBody = {
            messages: openAiMessages
        };

        if (body.max_tokens !== undefined) {
            openAiBody.max_tokens = body.max_tokens;
        }
        if (body.temperature !== undefined) {
            openAiBody.temperature = body.temperature;
        }
        if (body.top_p !== undefined) {
            openAiBody.top_p = body.top_p;
        }
        if (Array.isArray(body.stop_sequences) && body.stop_sequences.length > 0) {
            openAiBody.stop = body.stop_sequences;
        }
        if (Array.isArray(body.tools) && body.tools.length > 0) {
            openAiBody.tools = [];
            for (var t = 0; t < body.tools.length; t++) {
                var tool = body.tools[t];
                if (tool && tool.name) {
                    openAiBody.tools.push({
                        type: "function",
                        function: {
                            name: tool.name,
                            description: tool.description || "",
                            parameters: tool.input_schema || { type: "object", properties: {} }
                        }
                    });
                }
            }
        }
        if (body.tool_choice) {
            if (body.tool_choice.type === "auto") {
                openAiBody.tool_choice = "auto";
            } else if (body.tool_choice.type === "any") {
                openAiBody.tool_choice = "required";
            } else if (body.tool_choice.type === "tool" && body.tool_choice.name) {
                openAiBody.tool_choice = { type: "function", function: { name: body.tool_choice.name } };
            }
        }

        var isStream = body.stream === true || body.stream === "true";
        if (isStream) {
            openAiBody.stream = true;
            openAiBody.stream_options = { include_usage: true };
            context.setVariable("stream", "true");
        }

        body = openAiBody;
    }

    if (isEmbeddings) {
        if (customUrl) {
            var embedUrl = customUrl.replace(/\/chat\/completions\/?$/, "/embeddings");
            context.setVariable("target.url", embedUrl);
            body.model = upstreamModel || resolvedModel;
            context.setVariable("request.content", JSON.stringify(body));
        } else if (publisher === "google") {
            var loc = (modelLocation && modelLocation !== "global") ? modelLocation : "us-central1";
            var predictHost = (endpointHost === "aiplatform.googleapis.com") ? (loc + "-aiplatform.googleapis.com") : endpointHost;
            var predictUrl = "https://" + predictHost + "/v1/projects/" + projectId + "/locations/" + loc + "/publishers/google/models/" + (upstreamModel || resolvedModel) + ":predict";
            context.setVariable("target.url", predictUrl);
            context.setVariable("vertex_predict_embeddings", "true");

            var instances = [];
            if (Array.isArray(body.input)) {
                for (var i = 0; i < body.input.length; i++) {
                    var item = body.input[i];
                    var textVal = (typeof item === "string") ? item : JSON.stringify(item);
                    var inst = { content: textVal };
                    if (body.task_type) inst.task_type = body.task_type;
                    instances.push(inst);
                }
            } else if (body.input !== undefined && body.input !== null) {
                var singleInst = { content: String(body.input) };
                if (body.task_type) singleInst.task_type = body.task_type;
                instances.push(singleInst);
            }

            var predictBody = { instances: instances };
            if (body.dimensions) {
                predictBody.parameters = { outputDimensionality: parseInt(body.dimensions, 10) };
            }
            context.setVariable("request.content", JSON.stringify(predictBody));
        } else {
            var maasEmbedUrl = "https://" + endpointHost + "/v1/projects/" + projectId + "/locations/" + modelLocation + "/endpoints/openapi/embeddings";
            context.setVariable("target.url", maasEmbedUrl);
            body.model = upstreamModel || ((resolvedModel && resolvedModel.indexOf("/") !== -1) ? resolvedModel : (publisher + "/" + resolvedModel));
            context.setVariable("request.content", JSON.stringify(body));
        }
    } else {
        if (customUrl) {
            context.setVariable("target.url", customUrl);
            var isVertexOpenApiUrl = (customUrl.indexOf("googleapis.com") !== -1 && customUrl.indexOf("/endpoints/openapi/") !== -1);
            if (isVertexOpenApiUrl) {
                body.model = upstreamModel || ((resolvedModel && resolvedModel.indexOf("/") !== -1) ? resolvedModel : (publisher + "/" + resolvedModel));
            } else {
                body.model = upstreamModel || resolvedModel;
            }
        } else {
            var vertexOpenAiUrl = "https://" + endpointHost + "/v1/projects/" + projectId + "/locations/" + modelLocation + "/endpoints/openapi/chat/completions";
            context.setVariable("target.url", vertexOpenAiUrl);
            if (!originalModel) {
                originalModel = (resolvedModel && resolvedModel.indexOf("/") !== -1) ? resolvedModel : (publisher + "/" + resolvedModel);
            }
            body.model = upstreamModel || originalModel;
        }
        if (body.stream === true || body.stream === "true") {
            if (!body.stream_options) {
                body.stream_options = { include_usage: true };
            } else if (body.stream_options.include_usage === undefined) {
                body.stream_options.include_usage = true;
            }
        }
        if (bodyStr) {
            context.setVariable("request.content", JSON.stringify(body));
        }
    }
} catch (e) {
    print("Error restoring original OpenAI model prefix: " + e);
}

})();
