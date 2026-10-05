(function () {
'use strict';

try {
    var rawContent = context.getVariable("response.content");
    if (rawContent) {
        var anthropicResp = JSON.parse(rawContent);
        var modelName = context.getVariable("model") || "claude";

        // Extract text content from Anthropic content blocks
        var textContent = "";
        var toolCalls = [];

        if (anthropicResp.content && Array.isArray(anthropicResp.content)) {
            for (var i = 0; i < anthropicResp.content.length; i++) {
                var block = anthropicResp.content[i];
                if (block.type === "text") {
                    textContent += block.text || "";
                } else if (block.type === "tool_use") {
                    toolCalls.push({
                        id: block.id || ("call_" + Math.random().toString(36).substring(2, 10)),
                        type: "function",
                        function: {
                            name: block.name,
                            arguments: JSON.stringify(block.input || {})
                        }
                    });
                }
            }
        }

        var uncachedInTokens = (anthropicResp.usage && anthropicResp.usage.input_tokens) || 0;
        var cacheReadTokens = (anthropicResp.usage && anthropicResp.usage.cache_read_input_tokens) || 0;
        var cacheWriteTokens = (anthropicResp.usage && anthropicResp.usage.cache_creation_input_tokens) || 0;
        var inTokens = uncachedInTokens + cacheReadTokens + cacheWriteTokens;
        var outTokens = (anthropicResp.usage && anthropicResp.usage.output_tokens) || 0;
        var totalTokens = inTokens + outTokens;

        var finishReason = "stop";
        if (toolCalls.length > 0) {
            finishReason = "tool_calls";
        } else if (anthropicResp.stop_reason === "max_tokens") {
            finishReason = "length";
        }

        var messageObj = {
            role: "assistant",
            content: textContent || null
        };
        if (toolCalls.length > 0) {
            messageObj.tool_calls = toolCalls;
        }

        var msgId = anthropicResp.id ? anthropicResp.id.replace("msg_", "chatcmpl-") : ("chatcmpl-" + Math.random().toString(36).substring(2, 12));

        var openAiResp = {
            id: msgId,
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model: modelName,
            choices: [
                {
                    index: 0,
                    message: messageObj,
                    finish_reason: finishReason
                }
            ],
            usage: {
                prompt_tokens: inTokens,
                completion_tokens: outTokens,
                total_tokens: totalTokens,
                prompt_tokens_details: {
                    cached_tokens: cacheReadTokens
                },
                cache_creation_input_tokens: cacheWriteTokens
            }
        };

        // Populate token counts for downstream monetization & quota policies
        var cacheWriteStr = String(cacheWriteTokens);
        context.setVariable("usage_prompt_tokens", String(inTokens));
        context.setVariable("usage_uncached_prompt_tokens", String(uncachedInTokens));
        context.setVariable("usage_cache_read_tokens", String(cacheReadTokens));
        context.setVariable("usage_cache_write_tokens", cacheWriteStr);
        context.setVariable("cache_creation_input_tokens", cacheWriteStr);
        context.setVariable("usage_completion_tokens", String(outTokens));
        context.setVariable("usage_total_tokens", totalTokens.toFixed(0));

        context.setVariable("response.content", JSON.stringify(openAiResp));
    }
} catch (e) {
    print("Error in anthropic_to_openai_resp: " + e);
}

})();
