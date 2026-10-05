(function () {
'use strict';

try {
    var promptTokens = parseInt(context.getVariable("prompt_tokens") || 0, 10);
    var completionTokens = parseInt(context.getVariable("completion_tokens") || 0, 10);

    var isEmbeddings = context.getVariable("is_embeddings") === "true";
    var isVertexPredict = context.getVariable("vertex_predict_embeddings") === "true";
    var requestFormat = (context.getVariable("request_format") || "").toLowerCase();
    var isOpenAIFormat = requestFormat === "openai";
    var respStr = null;
    var parsedResp = null;

    if (isEmbeddings || isVertexPredict || (promptTokens === 0 && completionTokens === 0)) {
        respStr = context.getVariable("response.content");
        if (respStr && respStr.indexOf('"predictions"') !== -1) {
            parsedResp = JSON.parse(respStr);
            if (Array.isArray(parsedResp.predictions)) {
                var embTokens = 0;
                var dataList = [];
                var buildOpenAIList = isVertexPredict || isOpenAIFormat;
                for (var i = 0; i < parsedResp.predictions.length; i++) {
                    var pred = parsedResp.predictions[i] || {};
                    var emb = pred.embeddings || pred;
                    if (emb.statistics && typeof emb.statistics.token_count === "number") {
                        embTokens += emb.statistics.token_count;
                    }
                    if (buildOpenAIList) {
                        dataList.push({
                            object: "embedding",
                            index: i,
                            embedding: emb.values || []
                        });
                    }
                }
                promptTokens = embTokens;
                context.setVariable("prompt_tokens", promptTokens.toFixed(0));
                context.setVariable("completion_tokens", "0");

                if (buildOpenAIList) {
                    var openaiEmbResp = {
                        object: "list",
                        data: dataList,
                        model: context.getVariable("model") || "text-embedding-005",
                        usage: {
                            prompt_tokens: promptTokens,
                            total_tokens: promptTokens
                        }
                    };
                    context.setVariable("response.content", JSON.stringify(openaiEmbResp));
                }
            }
        }
    }

    if (isNaN(promptTokens) || promptTokens < 0) promptTokens = 0;
    if (isNaN(completionTokens) || completionTokens < 0) completionTokens = 0;

    var cacheReadInputStr = context.getVariable("cache_read_input_tokens");
    var cacheCreationInputStr = context.getVariable("cache_creation_input_tokens");
    var cachedContentStr = context.getVariable("cached_content_tokens");
    var thoughtsTokensStr = context.getVariable("thoughts_tokens");
    var cachedPromptStr = context.getVariable("cached_prompt_tokens");
    var reasoningTokensStr = context.getVariable("reasoning_tokens");
    var existingThinkingStr = context.getVariable("thinking_tokens");

    function toNonNegInt(val) {
        var n = parseInt(val, 10);
        return (isNaN(n) || n < 0) ? 0 : n;
    }

    var uncachedPromptTokens = promptTokens;
    var cacheReadTokens = 0;
    var cacheWriteTokens = 0;
    var thinkingTokens = toNonNegInt(existingThinkingStr);
    var totalCompletionTokens = completionTokens;

    if (cachedContentStr !== null || thoughtsTokensStr !== null || requestFormat === "gemini") {
        // Vertex AI Gemini native format:
        // promptTokenCount includes cachedContentTokenCount; candidatesTokenCount excludes thoughtsTokenCount
        cacheReadTokens = toNonNegInt(cachedContentStr);
        uncachedPromptTokens = Math.max(0, promptTokens - cacheReadTokens);
        thinkingTokens = toNonNegInt(thoughtsTokensStr);
        totalCompletionTokens = completionTokens + thinkingTokens;
    } else if (cachedPromptStr !== null || reasoningTokensStr !== null || isOpenAIFormat) {
        // OpenAI / Codex format:
        // prompt_tokens includes prompt_tokens_details.cached_tokens (and cache_creation_input_tokens when transcoded from Claude);
        // completion_tokens already includes completion_tokens_details.reasoning_tokens
        cacheReadTokens = toNonNegInt(cachedPromptStr);
        cacheWriteTokens = toNonNegInt(cacheCreationInputStr);
        uncachedPromptTokens = Math.max(0, promptTokens - cacheReadTokens - cacheWriteTokens);
        if (reasoningTokensStr !== null) {
            thinkingTokens = toNonNegInt(reasoningTokensStr);
        }
        totalCompletionTokens = completionTokens;
    } else {
        // Anthropic Claude format (default):
        // input_tokens is uncached input tokens only; cache_read_input_tokens and cache_creation_input_tokens are additive;
        // output_tokens already includes thinking tokens
        cacheReadTokens = toNonNegInt(cacheReadInputStr);
        cacheWriteTokens = toNonNegInt(cacheCreationInputStr);
        uncachedPromptTokens = promptTokens;
        totalCompletionTokens = completionTokens;
    }

    var totalPromptTokens = uncachedPromptTokens + cacheReadTokens + cacheWriteTokens;
    var totalTokens = totalPromptTokens + totalCompletionTokens;

    var totalPromptStr = totalPromptTokens.toFixed(0);
    var uncachedPromptStr = uncachedPromptTokens.toFixed(0);
    var cacheReadStr = cacheReadTokens.toFixed(0);
    var cacheWriteStr = cacheWriteTokens.toFixed(0);
    var thinkingStr = thinkingTokens.toFixed(0);
    var totalCompletionStr = totalCompletionTokens.toFixed(0);
    var totalTokensStr = totalTokens.toFixed(0);

    context.setVariable("prompt_tokens", totalPromptStr);
    context.setVariable("usage_prompt_tokens", totalPromptStr);
    context.setVariable("uncached_prompt_tokens", uncachedPromptStr);
    context.setVariable("usage_uncached_prompt_tokens", uncachedPromptStr);
    context.setVariable("cache_read_tokens", cacheReadStr);
    context.setVariable("usage_cache_read_tokens", cacheReadStr);
    context.setVariable("cache_write_tokens", cacheWriteStr);
    context.setVariable("usage_cache_write_tokens", cacheWriteStr);
    context.setVariable("thinking_tokens", thinkingStr);
    context.setVariable("usage_thinking_tokens", thinkingStr);
    context.setVariable("completion_tokens", totalCompletionStr);
    context.setVariable("usage_completion_tokens", totalCompletionStr);
    context.setVariable("usage_total_tokens", totalTokensStr);

    // Extract assistant response text into response_partial for non-streaming Model Armor response sanitization
    if (!isEmbeddings && !isVertexPredict && context.getVariable("model_armor_response_enabled") !== "false") {
        var rawRespContent = respStr !== null ? respStr : context.getVariable("response.content");
        if (rawRespContent) {
            try {
                if (!parsedResp) {
                    parsedResp = JSON.parse(rawRespContent);
                }
                var extractedText = "";
                if (Array.isArray(parsedResp.choices) && parsedResp.choices.length > 0 && parsedResp.choices[0].message) {
                    var msgContent = parsedResp.choices[0].message.content;
                    if (typeof msgContent === "string") {
                        extractedText = msgContent;
                    } else if (Array.isArray(msgContent)) {
                        for (var mc = 0; mc < msgContent.length; mc++) {
                            if (msgContent[mc] && msgContent[mc].text) extractedText += msgContent[mc].text + " ";
                        }
                    }
                } else if (Array.isArray(parsedResp.content)) {
                    for (var cb = 0; cb < parsedResp.content.length; cb++) {
                        if (parsedResp.content[cb] && parsedResp.content[cb].text) {
                            extractedText += parsedResp.content[cb].text + " ";
                        }
                    }
                } else if (Array.isArray(parsedResp.candidates) && parsedResp.candidates.length > 0 &&
                           parsedResp.candidates[0].content && Array.isArray(parsedResp.candidates[0].content.parts)) {
                    var parts = parsedResp.candidates[0].content.parts;
                    for (var gp = 0; gp < parts.length; gp++) {
                        if (parts[gp] && parts[gp].text) {
                            extractedText += parts[gp].text + " ";
                        }
                    }
                }
                if (extractedText.trim() !== "") {
                    context.setVariable("response_partial", extractedText.trim());
                }
            } catch (ignoreErr) {}
        }
    }
} catch (e) {
    print("Error calculating non-streaming tokens: " + e);
}

})();
