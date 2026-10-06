(function () {
'use strict';

try {
    var fbStatus = parseInt(context.getVariable("fallbackResponse.status.code") || "0", 10);
    var fbContent = context.getVariable("fallbackResponse.content");

    if (!(fbStatus >= 200 && fbStatus < 300 && fbContent)) {
        context.setVariable("fallback_succeeded", "false");
        return;
    }

    var fbModel = context.getVariable("fallback_model") || context.getVariable("model") || "gemini-3.5-flash";
    var fbFormat = (context.getVariable("fallback_format") || "gemini").toLowerCase();
    var fbPublisher = context.getVariable("fallback_publisher") || "google";
    var reqFormat = (context.getVariable("request_format") || "claude").toLowerCase();
    var isEmbeddings = context.getVariable("is_embeddings") === "true";

    var fbBody = JSON.parse(fbContent);

    // Extract normalized response text, tool calls, and token usage from fallback response
    var normText = "";
    var normToolCalls = []; // [{ id, name, argsObj }]
    var uncachedIn = 0;
    var cacheRead = 0;
    var cacheWrite = 0;
    var outTokens = 0;
    var thinkingTokens = 0;

    if (fbFormat === "gemini" || Array.isArray(fbBody.candidates)) {
        var cand = (Array.isArray(fbBody.candidates) && fbBody.candidates[0]) ? fbBody.candidates[0] : {};
        var parts = (cand.content && Array.isArray(cand.content.parts)) ? cand.content.parts : [];
        var tParts = [];
        for (var gp = 0; gp < parts.length; gp++) {
            if (parts[gp].text) {
                tParts.push(parts[gp].text);
            } else if (parts[gp].functionCall) {
                normToolCalls.push({
                    id: "call_" + Math.random().toString(36).substring(2, 10),
                    name: parts[gp].functionCall.name,
                    argsObj: parts[gp].functionCall.args || {}
                });
            }
        }
        normText = tParts.join("");
        var uMeta = fbBody.usageMetadata || {};
        var totalPrompt = uMeta.promptTokenCount || 0;
        cacheRead = uMeta.cachedContentTokenCount || 0;
        uncachedIn = Math.max(0, totalPrompt - cacheRead);
        thinkingTokens = uMeta.thoughtsTokenCount || 0;
        outTokens = (uMeta.candidatesTokenCount || 0) + thinkingTokens;
    } else if (fbFormat === "anthropic" || fbBody.type === "message") {
        if (Array.isArray(fbBody.content)) {
            var aParts = [];
            for (var ap = 0; ap < fbBody.content.length; ap++) {
                var blk = fbBody.content[ap];
                if (blk && blk.type === "text" && blk.text) {
                    aParts.push(blk.text);
                } else if (blk && blk.type === "tool_use") {
                    normToolCalls.push({
                        id: blk.id || ("toolu_" + Math.random().toString(36).substring(2, 10)),
                        name: blk.name,
                        argsObj: blk.input || {}
                    });
                }
            }
            normText = aParts.join("");
        }
        var aUsage = fbBody.usage || {};
        uncachedIn = aUsage.input_tokens || 0;
        cacheRead = aUsage.cache_read_input_tokens || 0;
        cacheWrite = aUsage.cache_creation_input_tokens || 0;
        outTokens = aUsage.output_tokens || 0;
    } else {
        // OpenAI format
        var choice = (Array.isArray(fbBody.choices) && fbBody.choices[0]) ? fbBody.choices[0] : {};
        var msg = choice.message || {};
        if (typeof msg.content === "string") {
            normText = msg.content;
        } else if (Array.isArray(msg.content)) {
            var oParts = [];
            for (var op = 0; op < msg.content.length; op++) {
                if (msg.content[op] && msg.content[op].text) {
                    oParts.push(msg.content[op].text);
                }
            }
            normText = oParts.join("");
        }
        if (Array.isArray(msg.tool_calls)) {
            for (var tc = 0; tc < msg.tool_calls.length; tc++) {
                var tCall = msg.tool_calls[tc];
                var fn = tCall.function || {};
                var parsedArgs = {};
                if (typeof fn.arguments === "string") {
                    try { parsedArgs = JSON.parse(fn.arguments); } catch (e) { parsedArgs = { raw: fn.arguments }; }
                } else if (fn.arguments) {
                    parsedArgs = fn.arguments;
                }
                normToolCalls.push({
                    id: tCall.id || ("call_" + Math.random().toString(36).substring(2, 10)),
                    name: fn.name || "tool",
                    argsObj: parsedArgs
                });
            }
        }
        var oUsage = fbBody.usage || {};
        var oTotalPrompt = (oUsage.prompt_tokens !== undefined) ? oUsage.prompt_tokens : (oUsage.input_tokens || 0);
        cacheRead = (oUsage.prompt_tokens_details && oUsage.prompt_tokens_details.cached_tokens) || oUsage.cache_read_input_tokens || 0;
        cacheWrite = oUsage.cache_creation_input_tokens || 0;
        uncachedIn = Math.max(0, oTotalPrompt - cacheRead - cacheWrite);
        outTokens = oUsage.completion_tokens || oUsage.output_tokens || 0;
        thinkingTokens = (oUsage.completion_tokens_details && oUsage.completion_tokens_details.reasoning_tokens) || 0;
    }

    var totalPromptTokens = uncachedIn + cacheRead + cacheWrite;
    var totalTokens = totalPromptTokens + outTokens;

    // Transcode into client's requested format (reqFormat)
    var finalBody = fbBody;
    if (isEmbeddings && reqFormat === "openai") {
        if (Array.isArray(fbBody.predictions)) {
            context.setVariable("vertex_predict_embeddings", "true");
            finalBody = fbBody; // calculate_tokens_non_streaming.js converts predictions -> OpenAI list
        } else {
            finalBody = fbBody;
            finalBody.model = fbModel;
        }
    } else if (reqFormat === "openai") {
        if (fbFormat === "openai" && Array.isArray(fbBody.choices)) {
            finalBody = fbBody;
            finalBody.model = fbModel;
        } else {
            var oaiMsgObj = {
                role: "assistant",
                content: normText || null
            };
            if (normToolCalls.length > 0) {
                oaiMsgObj.tool_calls = [];
                for (var otc = 0; otc < normToolCalls.length; otc++) {
                    oaiMsgObj.tool_calls.push({
                        id: normToolCalls[otc].id,
                        type: "function",
                        function: {
                            name: normToolCalls[otc].name,
                            arguments: JSON.stringify(normToolCalls[otc].argsObj)
                        }
                    });
                }
            }
            var oaiUsage = {
                prompt_tokens: totalPromptTokens,
                completion_tokens: outTokens,
                total_tokens: totalTokens
            };
            if (cacheRead > 0) {
                oaiUsage.prompt_tokens_details = { cached_tokens: cacheRead };
            }
            if (thinkingTokens > 0) {
                oaiUsage.completion_tokens_details = { reasoning_tokens: thinkingTokens };
            }
            if (cacheWrite > 0) {
                oaiUsage.cache_creation_input_tokens = cacheWrite;
            }
            finalBody = {
                id: "chatcmpl-fb-" + Math.random().toString(36).substring(2, 12),
                object: "chat.completion",
                created: Math.floor(Date.now() / 1000),
                model: fbModel,
                choices: [
                    {
                        index: 0,
                        message: oaiMsgObj,
                        finish_reason: normToolCalls.length > 0 ? "tool_calls" : "stop"
                    }
                ],
                usage: oaiUsage
            };
        }
    } else if (reqFormat === "gemini") {
        if (fbFormat === "gemini" && Array.isArray(fbBody.candidates)) {
            finalBody = fbBody;
            finalBody.modelVersion = fbModel;
        } else {
            var gemParts = [];
            if (normText) {
                gemParts.push({ text: normText });
            }
            for (var gtc = 0; gtc < normToolCalls.length; gtc++) {
                gemParts.push({
                    functionCall: {
                        name: normToolCalls[gtc].name,
                        args: normToolCalls[gtc].argsObj
                    }
                });
            }
            finalBody = {
                candidates: [
                    {
                        content: {
                            role: "model",
                            parts: gemParts
                        },
                        finishReason: "STOP",
                        index: 0
                    }
                ],
                usageMetadata: {
                    promptTokenCount: totalPromptTokens,
                    candidatesTokenCount: Math.max(0, outTokens - thinkingTokens),
                    totalTokenCount: totalTokens,
                    cachedContentTokenCount: cacheRead > 0 ? cacheRead : undefined,
                    thoughtsTokenCount: thinkingTokens > 0 ? thinkingTokens : undefined
                },
                modelVersion: fbModel
            };
        }
    } else {
        // reqFormat === "claude"
        if (fbFormat === "anthropic" && fbBody.type === "message") {
            finalBody = fbBody;
            finalBody.model = fbModel;
        } else {
            var antBlocks = [];
            if (normText) {
                antBlocks.push({ type: "text", text: normText });
            }
            for (var atc = 0; atc < normToolCalls.length; atc++) {
                antBlocks.push({
                    type: "tool_use",
                    id: normToolCalls[atc].id,
                    name: normToolCalls[atc].name,
                    input: normToolCalls[atc].argsObj
                });
            }
            finalBody = {
                id: "msg_fb_" + Math.random().toString(36).substring(2, 14),
                type: "message",
                role: "assistant",
                model: fbModel,
                content: antBlocks,
                stop_reason: normToolCalls.length > 0 ? "tool_use" : "end_turn",
                stop_sequence: null,
                usage: {
                    input_tokens: uncachedIn,
                    cache_read_input_tokens: cacheRead,
                    cache_creation_input_tokens: cacheWrite,
                    output_tokens: outTokens
                }
            };
        }
    }

    // Overwrite main response with recovered fallback response
    context.setVariable("response.status.code", 200);
    context.setVariable("response.reason.phrase", "OK");
    context.setVariable("response.header.Content-Type", "application/json");
    context.setVariable("response.content", JSON.stringify(finalBody));

    // Update active model & metadata for downstream Token Extraction, Model Armor, Monetization & Quotas
    context.setVariable("model", fbModel);
    context.setVariable("primary_model", fbModel);
    context.setVariable("model_publisher", fbPublisher);
    context.setVariable("model_format", fbFormat);
    context.setVariable("route_format", fbFormat);
    context.setVariable("stream", false);
    context.setVariable("fallback_triggered", "true");
    context.setVariable("fallback_succeeded", "true");

    context.setVariable("response.header.X-Gateway-Routed-Model", fbModel);
    context.setVariable("response.header.X-Gateway-Fallback-Triggered", "true");
    context.setVariable("response.header.X-Gateway-Circuit-Breaker", context.getVariable("circuit_breaker_state") || "CLOSED");

} catch (e) {
    print("Error applying fallback response: " + e);
    context.setVariable("fallback_succeeded", "false");
}

})();
