(function () {
'use strict';

var rawContent = context.getVariable("response.event.current.content");
var targetName = context.getVariable("route.target") || context.getVariable("target.name") || context.getVariable("route_target");
var bufferSize = context.getVariable("buffer_size");
if (!bufferSize) {
    bufferSize = parseInt(context.getVariable("propertyset.extract_expressions.buffer_size")) || 10;
    context.setVariable("buffer_size", String(bufferSize));
}

// Clear per-chunk export variables only if they were populated on the previous chunk
if (context.getVariable("usage_total_tokens") !== null) {
    context.removeVariable("usage_prompt_tokens");
    context.removeVariable("usage_completion_tokens");
    context.removeVariable("usage_total_tokens");
    context.removeVariable("tx_cost_usd");
    context.removeVariable("perUnitPriceMultiplier");
}
if (context.getVariable("buff_ready") === "true") {
    context.removeVariable("buff_ready");
    context.removeVariable("response_partial");
}
if (context.getVariable("release_concurrency_slot") === "true") {
    context.removeVariable("release_concurrency_slot");
}

var dataIdx = rawContent ? rawContent.indexOf("data:") : -1;
if (rawContent && dataIdx !== -1) {
    var eventStr = rawContent.substring(dataIdx + 5).trim();
    
    if (eventStr.indexOf("[DONE]") === -1) {
        try {
            var parsedEvent = JSON.parse(eventStr);
            var requestFormat = context.getVariable("request_format") || "claude";
            var tokensAlreadyCounted = context.getVariable("stream_tokens_already_counted") === "true";
            
            var promptTokens = 0;
            var completionTokens = 0;
            var isFinished = false;
            var finishReason = null;
            var eventText = "";

            function emitStreamTokenVariables(uncachedIn, cacheRead, cacheWrite, outTokens, thinkingTokens) {
                var totalIn = uncachedIn + cacheRead + cacheWrite;
                var totalT = totalIn + outTokens;
                if (totalT > 0) {
                    var totalInStr = String(totalIn);
                    var uncachedInStr = String(uncachedIn);
                    var cacheReadStr = String(cacheRead);
                    var cacheWriteStr = String(cacheWrite);
                    var thinkingStr = String(thinkingTokens);
                    var outTokensStr = String(outTokens);
                    context.setVariable("prompt_tokens", totalInStr);
                    context.setVariable("usage_prompt_tokens", totalInStr);
                    context.setVariable("uncached_prompt_tokens", uncachedInStr);
                    context.setVariable("usage_uncached_prompt_tokens", uncachedInStr);
                    context.setVariable("cache_read_tokens", cacheReadStr);
                    context.setVariable("usage_cache_read_tokens", cacheReadStr);
                    context.setVariable("cache_write_tokens", cacheWriteStr);
                    context.setVariable("usage_cache_write_tokens", cacheWriteStr);
                    context.setVariable("thinking_tokens", thinkingStr);
                    context.setVariable("usage_thinking_tokens", thinkingStr);
                    context.setVariable("completion_tokens", outTokensStr);
                    context.setVariable("usage_completion_tokens", outTokensStr);
                    context.setVariable("usage_total_tokens", totalT.toFixed(0));
                    context.setVariable("stream_tokens_already_counted", "true");
                }
            }

            if (requestFormat === "gemini") {
                // -------------------------------------------------------------
                // Branch 1: Native Gemini Request Format (/ai-gateway)
                // -------------------------------------------------------------
                if (parsedEvent.usageMetadata) {
                    var inT = parsedEvent.usageMetadata.promptTokenCount || 0;
                    var cachedT = parsedEvent.usageMetadata.cachedContentTokenCount || 0;
                    var outT = parsedEvent.usageMetadata.candidatesTokenCount || 0;
                    var thoughtsT = parsedEvent.usageMetadata.thoughtsTokenCount || 0;
                    if (inT > 0 || outT > 0 || cachedT > 0 || thoughtsT > 0) {
                        context.setVariable("saved_stream_prompt_tokens", String(inT));
                        context.setVariable("saved_stream_cached_tokens", String(cachedT));
                        context.setVariable("saved_stream_completion_tokens", String(outT));
                        context.setVariable("saved_stream_thinking_tokens", String(thoughtsT));
                    }
                }

                var candidate = parsedEvent.candidates ? parsedEvent.candidates[0] : null;
                eventText = (candidate && candidate.content && candidate.content.parts && candidate.content.parts[0]) ? (candidate.content.parts[0].text || "") : "";
                finishReason = candidate ? candidate.finishReason : null;
                if (finishReason || (candidate === null && parsedEvent.usageMetadata)) {
                    isFinished = true;
                }

                // Buffer management for Model Armor sanitization
                var idx = context.getVariable("response.event.current.count");
                var previousBufferVal = context.getVariable("tmp_buffer_pre") || "";
                var newBuffer = previousBufferVal + (eventText || "");
                
                if ((idx % bufferSize === 0 || isFinished) && newBuffer.length > 0) {
                    context.setVariable("response_partial", newBuffer);
                    context.setVariable("buff_ready", "true");
                    context.setVariable("tmp_buffer_pre", "");
                } else {
                    context.setVariable("buff_ready", "false");
                    context.setVariable("tmp_buffer_pre", newBuffer);
                }

                // Emit tokens ONCE upon stream completion
                if (isFinished && !tokensAlreadyCounted) {
                    promptTokens = parseInt(context.getVariable("saved_stream_prompt_tokens") || (parsedEvent.usageMetadata ? parsedEvent.usageMetadata.promptTokenCount : 0) || 0, 10);
                    var geminiCachedTokens = parseInt(context.getVariable("saved_stream_cached_tokens") || (parsedEvent.usageMetadata ? parsedEvent.usageMetadata.cachedContentTokenCount : 0) || 0, 10);
                    var geminiUncachedPrompt = Math.max(0, promptTokens - geminiCachedTokens);
                    var geminiCandidateTokens = parseInt(context.getVariable("saved_stream_completion_tokens") || (parsedEvent.usageMetadata ? parsedEvent.usageMetadata.candidatesTokenCount : 0) || 0, 10);
                    var geminiThinkingTokens = parseInt(context.getVariable("saved_stream_thinking_tokens") || (parsedEvent.usageMetadata ? parsedEvent.usageMetadata.thoughtsTokenCount : 0) || 0, 10);
                    completionTokens = geminiCandidateTokens + geminiThinkingTokens;
                    emitStreamTokenVariables(geminiUncachedPrompt, geminiCachedTokens, 0, completionTokens, geminiThinkingTokens);
                }

            } else if (requestFormat === "openai") {
                // -------------------------------------------------------------
                // Branch 2: OpenAI Request Format (/v1/chat/completions)
                // -------------------------------------------------------------
                var modelName = context.getVariable("model") || "claude";

                if (targetName === "claude" || parsedEvent.type) {
                    // Target is Anthropic Claude -> Translate Anthropic SSE chunk to OpenAI SSE!
                    if (parsedEvent.type === "message_start") {
                        var msgStartUsage = (parsedEvent.message && parsedEvent.message.usage) ? parsedEvent.message.usage : {};
                        if (msgStartUsage.input_tokens !== undefined) {
                            context.setVariable("saved_stream_uncached_prompt_tokens", String(msgStartUsage.input_tokens));
                        }
                        if (msgStartUsage.cache_read_input_tokens !== undefined) {
                            context.setVariable("saved_stream_cached_tokens", String(msgStartUsage.cache_read_input_tokens));
                        }
                        if (msgStartUsage.cache_creation_input_tokens !== undefined) {
                            context.setVariable("saved_stream_cache_write_tokens", String(msgStartUsage.cache_creation_input_tokens));
                        }
                        if (parsedEvent.message && parsedEvent.message.id) {
                            context.setVariable("stream_msg_id", parsedEvent.message.id.replace("msg_", "chatcmpl-"));
                        }
                    } else if (parsedEvent.type === "content_block_delta") {
                        eventText = (parsedEvent.delta && parsedEvent.delta.text) ? parsedEvent.delta.text : "";
                    } else if (parsedEvent.type === "message_delta") {
                        if (parsedEvent.usage) {
                            if (parsedEvent.usage.input_tokens !== undefined) {
                                context.setVariable("saved_stream_uncached_prompt_tokens", String(parsedEvent.usage.input_tokens));
                            }
                            if (parsedEvent.usage.cache_read_input_tokens !== undefined) {
                                context.setVariable("saved_stream_cached_tokens", String(parsedEvent.usage.cache_read_input_tokens));
                            }
                            if (parsedEvent.usage.cache_creation_input_tokens !== undefined) {
                                context.setVariable("saved_stream_cache_write_tokens", String(parsedEvent.usage.cache_creation_input_tokens));
                            }
                            if (parsedEvent.usage.output_tokens !== undefined) {
                                context.setVariable("saved_stream_completion_tokens", String(parsedEvent.usage.output_tokens));
                            }
                        }
                        finishReason = "stop";
                        isFinished = true;
                    } else if (parsedEvent.type === "message_stop") {
                        isFinished = true;
                    }

                    var msgId = context.getVariable("stream_msg_id") || ("chatcmpl-" + Math.random().toString(36).substring(2, 12));
                    var outputChunks = [];

                    if (eventText) {
                        var openAiChunk = {
                            id: msgId,
                            object: "chat.completion.chunk",
                            created: Math.floor(Date.now() / 1000),
                            model: modelName,
                            choices: [
                                {
                                    index: 0,
                                    delta: {
                                        content: eventText
                                    },
                                    finish_reason: null
                                }
                            ]
                        };
                        outputChunks.push("data: " + JSON.stringify(openAiChunk));
                    }

                    if (isFinished) {
                        var finalChunk = {
                            id: msgId,
                            object: "chat.completion.chunk",
                            created: Math.floor(Date.now() / 1000),
                            model: modelName,
                            choices: [
                                {
                                    index: 0,
                                    delta: {},
                                    finish_reason: "stop"
                                }
                            ]
                        };
                        outputChunks.push("data: " + JSON.stringify(finalChunk));
                        outputChunks.push("data: [DONE]");
                    }

                    if (outputChunks.length > 0) {
                        context.setVariable("response.event.current.content", outputChunks.join("\n\n") + "\n\n");
                    } else {
                        context.setVariable("response.event.current.content", "");
                    }

                } else {
                    if (parsedEvent.usage) {
                        var inT = parsedEvent.usage.prompt_tokens || 0;
                        var cachedT = (parsedEvent.usage.prompt_tokens_details && parsedEvent.usage.prompt_tokens_details.cached_tokens) || 0;
                        var outT = parsedEvent.usage.completion_tokens || 0;
                        var reasoningT = (parsedEvent.usage.completion_tokens_details && parsedEvent.usage.completion_tokens_details.reasoning_tokens) || 0;
                        if (inT > 0 || outT > 0 || cachedT > 0 || reasoningT > 0) {
                            context.setVariable("saved_stream_prompt_tokens", String(inT));
                            context.setVariable("saved_stream_uncached_prompt_tokens", String(Math.max(0, inT - cachedT)));
                            context.setVariable("saved_stream_cached_tokens", String(cachedT));
                            context.setVariable("saved_stream_completion_tokens", String(outT));
                            context.setVariable("saved_stream_thinking_tokens", String(reasoningT));
                        }
                    }

                    var choice = parsedEvent.choices ? parsedEvent.choices[0] : null;
                    eventText = (choice && choice.delta) ? (choice.delta.content || "") : "";
                    finishReason = choice ? choice.finish_reason : null;
                    if (finishReason || (parsedEvent.choices && parsedEvent.choices.length === 0 && parsedEvent.usage)) {
                        isFinished = true;
                    }
                }

                // Buffer management for Model Armor sanitization
                var idx = context.getVariable("response.event.current.count");
                var previousBufferVal = context.getVariable("tmp_buffer_pre") || "";
                var newBuffer = previousBufferVal + (eventText || "");
                
                if ((idx % bufferSize === 0 || isFinished) && newBuffer.length > 0) {
                    context.setVariable("response_partial", newBuffer);
                    context.setVariable("buff_ready", "true");
                    context.setVariable("tmp_buffer_pre", "");
                } else {
                    context.setVariable("buff_ready", "false");
                    context.setVariable("tmp_buffer_pre", newBuffer);
                }

                // Emit tokens ONCE upon stream completion
                if (isFinished && !tokensAlreadyCounted) {
                    var oaiCacheRead = parseInt(context.getVariable("saved_stream_cached_tokens") || 0, 10);
                    var oaiCacheWrite = parseInt(context.getVariable("saved_stream_cache_write_tokens") || 0, 10);
                    var savedUncachedStr = context.getVariable("saved_stream_uncached_prompt_tokens");
                    var oaiUncachedIn = savedUncachedStr !== null
                        ? parseInt(savedUncachedStr, 10)
                        : Math.max(0, parseInt(context.getVariable("saved_stream_prompt_tokens") || (parsedEvent.usage ? parsedEvent.usage.prompt_tokens : 0) || 0, 10) - oaiCacheRead - oaiCacheWrite);
                    var oaiThinking = parseInt(context.getVariable("saved_stream_thinking_tokens") || 0, 10);
                    completionTokens = parseInt(context.getVariable("saved_stream_completion_tokens") || (parsedEvent.usage ? parsedEvent.usage.completion_tokens : 0) || 0, 10);
                    emitStreamTokenVariables(oaiUncachedIn, oaiCacheRead, oaiCacheWrite, completionTokens, oaiThinking);
                }


            } else {
                // -------------------------------------------------------------
                // Branch 3: Anthropic Claude Request Format (/v1/messages)
                // -------------------------------------------------------------
                var modelName = context.getVariable("model") || "unknown";

                if (targetName === "claude") {
                    // Target is Native Claude:
                    if (parsedEvent.delta && parsedEvent.delta.text !== undefined) {
                        eventText = parsedEvent.delta.text;
                    } else if (parsedEvent.type === "message_delta") {
                        if (parsedEvent.delta && parsedEvent.delta.stop_reason) {
                            finishReason = "stop";
                        }
                    }

                    var claudeUsage = parsedEvent.usage || (parsedEvent.message && parsedEvent.message.usage);
                    if (claudeUsage) {
                        if (claudeUsage.input_tokens !== undefined) {
                            context.setVariable("saved_stream_uncached_prompt_tokens", String(claudeUsage.input_tokens));
                        }
                        if (claudeUsage.cache_read_input_tokens !== undefined) {
                            context.setVariable("saved_stream_cached_tokens", String(claudeUsage.cache_read_input_tokens));
                        }
                        if (claudeUsage.cache_creation_input_tokens !== undefined) {
                            context.setVariable("saved_stream_cache_write_tokens", String(claudeUsage.cache_creation_input_tokens));
                        }
                        if (claudeUsage.output_tokens !== undefined) {
                            context.setVariable("saved_stream_completion_tokens", String(claudeUsage.output_tokens));
                        }
                    }

                    if (parsedEvent.type === "message_delta" || parsedEvent.type === "message_stop") {
                        isFinished = true;
                    }

                    if (isFinished && !tokensAlreadyCounted) {
                        var claudeUncachedIn = parseInt(context.getVariable("saved_stream_uncached_prompt_tokens") || (claudeUsage ? claudeUsage.input_tokens : 0) || 0, 10);
                        var claudeCacheRead = parseInt(context.getVariable("saved_stream_cached_tokens") || (claudeUsage ? claudeUsage.cache_read_input_tokens : 0) || 0, 10);
                        var claudeCacheWrite = parseInt(context.getVariable("saved_stream_cache_write_tokens") || (claudeUsage ? claudeUsage.cache_creation_input_tokens : 0) || 0, 10);
                        completionTokens = parseInt(context.getVariable("saved_stream_completion_tokens") || (claudeUsage ? claudeUsage.output_tokens : 0) || 0, 10);
                        emitStreamTokenVariables(claudeUncachedIn, claudeCacheRead, claudeCacheWrite, completionTokens, 0);
                    }

                } else {
                    // Non-Claude target (Gemini or OpenAI): Translate chunks to Claude SSE!
                    if (targetName === "gemini") {
                        var candidate = parsedEvent.candidates ? parsedEvent.candidates[0] : null;
                        var parts = (candidate && candidate.content) ? candidate.content.parts : null;
                        eventText = (parts && parts[0]) ? (parts[0].text || "") : "";
                        finishReason = candidate ? candidate.finishReason : null;

                        if (parsedEvent.usageMetadata) {
                            var inT = parsedEvent.usageMetadata.promptTokenCount || 0;
                            var cachedT = parsedEvent.usageMetadata.cachedContentTokenCount || 0;
                            var outT = parsedEvent.usageMetadata.candidatesTokenCount || 0;
                            var thoughtsT = parsedEvent.usageMetadata.thoughtsTokenCount || 0;
                            if (inT > 0 || outT > 0 || cachedT > 0 || thoughtsT > 0) {
                                context.setVariable("saved_stream_prompt_tokens", String(inT));
                                context.setVariable("saved_stream_uncached_prompt_tokens", String(Math.max(0, inT - cachedT)));
                                context.setVariable("saved_stream_cached_tokens", String(cachedT));
                                context.setVariable("saved_stream_completion_tokens", String(outT + thoughtsT));
                                context.setVariable("saved_stream_thinking_tokens", String(thoughtsT));
                            }
                        }
                        if (finishReason) {
                            isFinished = true;
                        }
                    } else {
                        // OpenAI target
                        var choice = parsedEvent.choices ? parsedEvent.choices[0] : null;
                        eventText = (choice && choice.delta) ? (choice.delta.content || "") : "";
                        finishReason = choice ? choice.finish_reason : null;

                        if (parsedEvent.usage) {
                            var inT = parsedEvent.usage.prompt_tokens || 0;
                            var cachedT = (parsedEvent.usage.prompt_tokens_details && parsedEvent.usage.prompt_tokens_details.cached_tokens) || 0;
                            var outT = parsedEvent.usage.completion_tokens || 0;
                            var reasoningT = (parsedEvent.usage.completion_tokens_details && parsedEvent.usage.completion_tokens_details.reasoning_tokens) || 0;
                            if (inT > 0 || outT > 0 || cachedT > 0 || reasoningT > 0) {
                                context.setVariable("saved_stream_prompt_tokens", String(inT));
                                context.setVariable("saved_stream_uncached_prompt_tokens", String(Math.max(0, inT - cachedT)));
                                context.setVariable("saved_stream_cached_tokens", String(cachedT));
                                context.setVariable("saved_stream_completion_tokens", String(outT));
                                context.setVariable("saved_stream_thinking_tokens", String(reasoningT));
                            }
                        }
                        if (finishReason) {
                            isFinished = true;
                        }
                        modelName = parsedEvent.model || modelName;
                    }

                    // Retrieve latest token counts only on start/finish/usage chunks to avoid per-delta Rhino bridge overhead
                    var sentStart = context.getVariable("sent_message_start");
                    var isTrailingUsageChunk = Boolean(parsedEvent.choices && parsedEvent.choices.length === 0 && parsedEvent.usage);
                    var transCacheRead = 0;
                    var transUncachedIn = 0;
                    var transThinking = 0;
                    if (!sentStart || isFinished || isTrailingUsageChunk) {
                        transCacheRead = parseInt(context.getVariable("saved_stream_cached_tokens") || 0, 10);
                        var transUncachedInStr = context.getVariable("saved_stream_uncached_prompt_tokens");
                        transUncachedIn = transUncachedInStr !== null
                            ? parseInt(transUncachedInStr, 10)
                            : Math.max(0, parseInt(context.getVariable("saved_stream_prompt_tokens") || 0, 10) - transCacheRead);
                        transThinking = parseInt(context.getVariable("saved_stream_thinking_tokens") || 0, 10);
                        promptTokens = transUncachedIn + transCacheRead;
                        completionTokens = parseInt(context.getVariable("saved_stream_completion_tokens") || 0, 10);
                    }

                    // Translate chunk to Claude SSE format
                    var outputChunks = [];
                    var msgId = parsedEvent.id ? parsedEvent.id.replace("chatcmpl-", "msg_") : "msg_stream";
                    
                    if (!sentStart) {
                        context.setVariable("sent_message_start", "true");
                        
                        // 1. message_start
                        var msgStart = {
                            "type": "message_start",
                            "message": {
                                "id": msgId,
                                "type": "message",
                                "role": "assistant",
                                "content": [],
                                "model": modelName,
                                "stop_reason": null,
                                "stop_sequence": null,
                                "usage": {
                                    "input_tokens": transUncachedIn,
                                    "cache_read_input_tokens": transCacheRead,
                                    "cache_creation_input_tokens": 0,
                                    "output_tokens": 0
                                }
                            }
                        };
                        outputChunks.push("event: message_start\ndata: " + JSON.stringify(msgStart));
                        
                        // 2. content_block_start for initial text block
                        var blockStart = {
                            "type": "content_block_start",
                            "index": 0,
                            "content_block": {
                                "type": "text",
                                "text": ""
                            }
                        };
                        outputChunks.push("event: content_block_start\ndata: " + JSON.stringify(blockStart));
                    }
                    
                    // 3. content_block_delta for text
                    if (eventText) {
                        var blockDelta = {
                            "type": "content_block_delta",
                            "index": 0,
                            "delta": {
                                "type": "text_delta",
                                "text": eventText
                            }
                        };
                        outputChunks.push("event: content_block_delta\ndata: " + JSON.stringify(blockDelta));
                    }

                    // 4. Handle streaming functionCall from Gemini or tool_calls from OpenAI
                    var streamFuncCall = (candidate && candidate.content && candidate.content.parts && candidate.content.parts[0]) 
                                         ? candidate.content.parts[0].functionCall 
                                         : null;
                    var openAiToolCalls = (typeof choice !== "undefined" && choice && choice.delta && Array.isArray(choice.delta.tool_calls))
                                          ? choice.delta.tool_calls
                                          : null;
                    if (streamFuncCall) {
                        var toolCallId = "call_" + Math.random().toString(36).substring(2, 12);
                        var toolBlockStart = {
                            "type": "content_block_start",
                            "index": 1,
                            "content_block": {
                                "type": "tool_use",
                                "id": toolCallId,
                                "name": streamFuncCall.name,
                                "input": {}
                            }
                        };
                        outputChunks.push("event: content_block_start\ndata: " + JSON.stringify(toolBlockStart));

                        var toolBlockDelta = {
                            "type": "content_block_delta",
                            "index": 1,
                            "delta": {
                                "type": "input_json_delta",
                                "partial_json": JSON.stringify(streamFuncCall.args || {})
                            }
                        };
                        outputChunks.push("event: content_block_delta\ndata: " + JSON.stringify(toolBlockDelta));

                        outputChunks.push("event: content_block_stop\ndata: " + JSON.stringify({ "type": "content_block_stop", "index": 1 }));
                        finishReason = "tool_use";
                    } else if (openAiToolCalls && openAiToolCalls.length > 0) {
                        for (var tcIdx = 0; tcIdx < openAiToolCalls.length; tcIdx++) {
                            var oaiTc = openAiToolCalls[tcIdx];
                            var blockIndex = (oaiTc.index !== undefined ? oaiTc.index : tcIdx) + 1;
                            if (oaiTc.function && oaiTc.function.name) {
                                var oaiToolStart = {
                                    "type": "content_block_start",
                                    "index": blockIndex,
                                    "content_block": {
                                        "type": "tool_use",
                                        "id": oaiTc.id || ("toolu_" + Math.random().toString(36).substring(2, 12)),
                                        "name": oaiTc.function.name,
                                        "input": {}
                                    }
                                };
                                outputChunks.push("event: content_block_start\ndata: " + JSON.stringify(oaiToolStart));
                                context.setVariable("open_tool_block_idx", String(blockIndex));
                            }
                            if (oaiTc.function && oaiTc.function.arguments) {
                                var oaiToolDelta = {
                                    "type": "content_block_delta",
                                    "index": blockIndex,
                                    "delta": {
                                        "type": "input_json_delta",
                                        "partial_json": oaiTc.function.arguments
                                    }
                                };
                                outputChunks.push("event: content_block_delta\ndata: " + JSON.stringify(oaiToolDelta));
                            }
                        }
                    }
                    
                    // 5. content_block_stop & message_delta & message_stop (if finished)
                    var sentStop = context.getVariable("sent_message_stop") === "true";
                    if (isFinished && !sentStop) {
                        context.setVariable("sent_message_stop", "true");
                        var openToolIdx = context.getVariable("open_tool_block_idx");
                        if (openToolIdx) {
                            outputChunks.push("event: content_block_stop\ndata: " + JSON.stringify({ "type": "content_block_stop", "index": parseInt(openToolIdx, 10) }));
                        }
                        var blockStop = {
                            "type": "content_block_stop",
                            "index": 0
                        };
                        outputChunks.push("event: content_block_stop\ndata: " + JSON.stringify(blockStop));
                        
                        var stopReasonMapped = "end_turn";
                        if (finishReason === "tool_use" || finishReason === "tool_calls" || streamFuncCall || openToolIdx) {
                            stopReasonMapped = "tool_use";
                        } else if (finishReason === "MAX_TOKENS" || finishReason === "length") {
                            stopReasonMapped = "max_tokens";
                        } else if (finishReason === "STOP" || finishReason === "stop") {
                            stopReasonMapped = "end_turn";
                        }
                        
                        var msgDelta = {
                            "type": "message_delta",
                            "delta": {
                                "stop_reason": stopReasonMapped,
                                "stop_sequence": null
                            },
                            "usage": {
                                "input_tokens": transUncachedIn,
                                "cache_read_input_tokens": transCacheRead,
                                "cache_creation_input_tokens": 0,
                                "output_tokens": completionTokens
                            }
                        };
                        outputChunks.push("event: message_delta\ndata: " + JSON.stringify(msgDelta));
                        
                        var msgStop = {
                            "type": "message_stop"
                        };
                        outputChunks.push("event: message_stop\ndata: " + JSON.stringify(msgStop));
                    }

                    // Emit tokens ONCE upon stream completion or trailing usage chunk
                    if ((isFinished || (parsedEvent.choices && parsedEvent.choices.length === 0 && parsedEvent.usage)) && !tokensAlreadyCounted) {
                        emitStreamTokenVariables(transUncachedIn, transCacheRead, 0, completionTokens, transThinking);
                    }
                    
                    if (outputChunks.length > 0) {
                        context.setVariable("response.event.current.content", outputChunks.join("\n\n") + "\n\n");
                    } else {
                        context.setVariable("response.event.current.content", "");
                    }
                }
                
                // Buffer management for Model Armor sanitization (shared)
                var idx = context.getVariable("response.event.current.count");
                var previousBufferVal = context.getVariable("tmp_buffer_pre") || "";
                var newBuffer = previousBufferVal + (eventText || "");
                
                if ((idx % bufferSize === 0 || finishReason === "stop" || finishReason === "STOP" || isFinished) && newBuffer.length > 0) {
                    context.setVariable("response_partial", newBuffer);
                    context.setVariable("buff_ready", "true");
                    context.setVariable("tmp_buffer_pre", "");
                } else {
                    context.setVariable("buff_ready", "false");
                    context.setVariable("tmp_buffer_pre", newBuffer);
                }
            }

            if (isFinished && context.getVariable("concurrency_slot_released") !== "true") {
                context.setVariable("release_concurrency_slot", "true");
                context.setVariable("concurrency_slot_released", "true");
            }
            
        } catch (e) {
            print("JSON Error: " + e);
        }
    } else {
        if (context.getVariable("concurrency_slot_released") !== "true") {
            context.setVariable("release_concurrency_slot", "true");
            context.setVariable("concurrency_slot_released", "true");
        }
        // If request format is not OpenAI and target is not Claude, clear [DONE] so it's not sent to Claude/Gemini clients
        var reqFmt = context.getVariable("request_format") || "claude";
        if (reqFmt !== "openai" && targetName !== "claude") {
            context.setVariable("response.event.current.content", "");
        }
    }
}

})();
