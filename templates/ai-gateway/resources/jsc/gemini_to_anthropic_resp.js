(function () {
'use strict';

try {
    var responseStr = context.getVariable("response.content");
    if (responseStr) {
        var body = JSON.parse(responseStr);
        
        if (body.candidates && Array.isArray(body.candidates) && body.candidates[0]) {
            var candidate = body.candidates[0];
            var parts = (candidate.content && Array.isArray(candidate.content.parts)) ? candidate.content.parts : [];
            var contentBlocks = [];
            var hasToolUse = false;
            
            for (var i = 0; i < parts.length; i++) {
                var part = parts[i];
                if (part.text) {
                    contentBlocks.push({
                        "type": "text",
                        "text": part.text
                    });
                } else if (part.functionCall) {
                    hasToolUse = true;
                    contentBlocks.push({
                        "type": "tool_use",
                        "id": "call_" + (Math.random().toString(36).substring(2, 12)),
                        "name": part.functionCall.name,
                        "input": part.functionCall.args || {}
                    });
                }
            }
            
            var totalPromptTokens = body.usageMetadata ? (body.usageMetadata.promptTokenCount || 0) : 0;
            var cachedTokens = body.usageMetadata ? (body.usageMetadata.cachedContentTokenCount || 0) : 0;
            var uncachedPromptTokens = Math.max(0, totalPromptTokens - cachedTokens);
            var candidateTokens = body.usageMetadata ? (body.usageMetadata.candidatesTokenCount || 0) : 0;
            var thoughtsTokens = body.usageMetadata ? (body.usageMetadata.thoughtsTokenCount || 0) : 0;
            var completionTokens = candidateTokens + thoughtsTokens;
            
            var stopReason = "end_turn";
            if (hasToolUse) {
                stopReason = "tool_use";
            } else if (candidate.finishReason === "MAX_TOKENS") {
                stopReason = "max_tokens";
            } else if (candidate.finishReason === "SAFETY") {
                stopReason = "stop_sequence";
            }
            
            var anthropicResp = {
                "id": "msg_gemini_" + (Math.random().toString(36).substring(2, 15)),
                "type": "message",
                "role": "assistant",
                "content": contentBlocks,
                "model": context.getVariable("model") || "gemini-3.5-flash",
                "stop_reason": stopReason,
                "stop_sequence": null,
                "usage": {
                    "input_tokens": uncachedPromptTokens,
                    "cache_read_input_tokens": cachedTokens,
                    "cache_creation_input_tokens": 0,
                    "output_tokens": completionTokens
                }
            };
            
            var thoughtsStr = String(thoughtsTokens);
            context.setVariable("thinking_tokens", thoughtsStr);
            context.setVariable("usage_thinking_tokens", thoughtsStr);
            context.setVariable("response.content", JSON.stringify(anthropicResp));
        } else if (body.choices && Array.isArray(body.choices) && body.choices[0]) {
            var choice = body.choices[0];
            var message = choice.message || {};
            var oaiContentBlocks = [];
            var oaiHasToolUse = false;

            if (typeof message.content === "string" && message.content.length > 0) {
                oaiContentBlocks.push({
                    "type": "text",
                    "text": message.content
                });
            } else if (Array.isArray(message.content)) {
                for (var c = 0; c < message.content.length; c++) {
                    var partBlock = message.content[c];
                    if (partBlock && partBlock.type === "text" && partBlock.text) {
                        oaiContentBlocks.push({
                            "type": "text",
                            "text": partBlock.text
                        });
                    }
                }
            }

            if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
                oaiHasToolUse = true;
                for (var tc = 0; tc < message.tool_calls.length; tc++) {
                    var toolCall = message.tool_calls[tc];
                    var func = toolCall.function || {};
                    var parsedArgs = {};
                    if (typeof func.arguments === "string") {
                        try {
                            parsedArgs = JSON.parse(func.arguments);
                        } catch (argErr) {
                            parsedArgs = { raw: func.arguments };
                        }
                    } else if (func.arguments && typeof func.arguments === "object") {
                        parsedArgs = func.arguments;
                    }
                    oaiContentBlocks.push({
                        "type": "tool_use",
                        "id": toolCall.id || ("toolu_" + Math.random().toString(36).substring(2, 12)),
                        "name": func.name || "tool",
                        "input": parsedArgs
                    });
                }
            }

            var oaiTotalPromptTokens = body.usage ? (body.usage.prompt_tokens !== undefined ? body.usage.prompt_tokens : (body.usage.input_tokens || 0)) : 0;
            var oaiCachedTokens = (body.usage && body.usage.prompt_tokens_details && body.usage.prompt_tokens_details.cached_tokens) || (body.usage && body.usage.cache_read_input_tokens) || 0;
            var oaiCacheWriteTokens = (body.usage && body.usage.cache_creation_input_tokens) || 0;
            var oaiUncachedPromptTokens = (body.usage && body.usage.prompt_tokens !== undefined) ? Math.max(0, oaiTotalPromptTokens - oaiCachedTokens - oaiCacheWriteTokens) : ((body.usage && body.usage.input_tokens) || 0);
            var oaiCompletionTokens = body.usage ? (body.usage.completion_tokens || body.usage.output_tokens || 0) : 0;
            var oaiReasoningTokens = (body.usage && body.usage.completion_tokens_details && body.usage.completion_tokens_details.reasoning_tokens) || 0;

            var oaiStopReason = "end_turn";
            if (oaiHasToolUse || choice.finish_reason === "tool_calls") {
                oaiStopReason = "tool_use";
            } else if (choice.finish_reason === "length" || choice.finish_reason === "max_tokens") {
                oaiStopReason = "max_tokens";
            } else if (choice.finish_reason === "stop_sequence") {
                oaiStopReason = "stop_sequence";
            }

            var oaiAnthropicResp = {
                "id": body.id ? body.id.replace(/^chatcmpl-/, "msg_") : ("msg_openai_" + (Math.random().toString(36).substring(2, 15))),
                "type": "message",
                "role": "assistant",
                "content": oaiContentBlocks,
                "model": context.getVariable("model") || body.model || "openai",
                "stop_reason": oaiStopReason,
                "stop_sequence": null,
                "usage": {
                    "input_tokens": oaiUncachedPromptTokens,
                    "cache_read_input_tokens": oaiCachedTokens,
                    "cache_creation_input_tokens": oaiCacheWriteTokens,
                    "output_tokens": oaiCompletionTokens
                }
            };

            var oaiEffectivePromptTokens = oaiUncachedPromptTokens + oaiCachedTokens + oaiCacheWriteTokens;
            var oaiReasoningStr = String(oaiReasoningTokens);
            context.setVariable("usage_prompt_tokens", String(oaiEffectivePromptTokens));
            context.setVariable("usage_uncached_prompt_tokens", String(oaiUncachedPromptTokens));
            context.setVariable("usage_cache_read_tokens", String(oaiCachedTokens));
            context.setVariable("usage_cache_write_tokens", String(oaiCacheWriteTokens));
            context.setVariable("usage_completion_tokens", String(oaiCompletionTokens));
            context.setVariable("thinking_tokens", oaiReasoningStr);
            context.setVariable("usage_thinking_tokens", oaiReasoningStr);
            context.setVariable("usage_total_tokens", (oaiEffectivePromptTokens + oaiCompletionTokens).toFixed(0));
            context.setVariable("response.content", JSON.stringify(oaiAnthropicResp));
        }
    }
} catch (e) {
    print("Error translating Gemini/OpenAI to Anthropic response: " + e);
}

})();
