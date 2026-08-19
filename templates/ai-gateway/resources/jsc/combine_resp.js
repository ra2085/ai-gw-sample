var rawContent = context.getVariable("response.event.current.content");
var targetName = context.getVariable("route.target") || context.getVariable("target.name");
var bufferSize = context.getVariable("buffer_size");
if (!bufferSize) {
    bufferSize = parseInt(context.getVariable("propertyset.extract_expressions.buffer_size")) || 10;
    context.setVariable("buffer_size", bufferSize);
}

// Clear per-chunk export variables at the start of each event chunk processing
context.removeVariable("usage_prompt_tokens");
context.removeVariable("usage_completion_tokens");
context.removeVariable("usage_total_tokens");
context.removeVariable("tx_cost_usd");
context.removeVariable("perUnitPriceMultiplier");
context.removeVariable("buff_ready");
context.removeVariable("response_partial");

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

            if (requestFormat === "gemini") {
                // -------------------------------------------------------------
                // Branch 1: Native Gemini Request Format (/ai-gateway)
                // -------------------------------------------------------------
                if (parsedEvent.usageMetadata) {
                    var inT = parsedEvent.usageMetadata.promptTokenCount || 0;
                    var outT = parsedEvent.usageMetadata.candidatesTokenCount || 0;
                    if (inT > 0 || outT > 0) {
                        context.setVariable("saved_stream_prompt_tokens", inT);
                        context.setVariable("saved_stream_completion_tokens", outT);
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
                    completionTokens = parseInt(context.getVariable("saved_stream_completion_tokens") || (parsedEvent.usageMetadata ? parsedEvent.usageMetadata.candidatesTokenCount : 0) || 0, 10);
                    var totalT = promptTokens + completionTokens;
                    if (totalT > 0) {
                        context.setVariable("usage_prompt_tokens", promptTokens);
                        context.setVariable("usage_completion_tokens", completionTokens);
                        context.setVariable("usage_total_tokens", totalT.toFixed(0));
                        context.setVariable("stream_tokens_already_counted", "true");
                    }
                }

            } else if (requestFormat === "openai") {
                // -------------------------------------------------------------
                // Branch 2: OpenAI Request Format (/v1/chat/completions)
                // -------------------------------------------------------------
                if (parsedEvent.usage) {
                    var inT = parsedEvent.usage.prompt_tokens || 0;
                    var outT = parsedEvent.usage.completion_tokens || 0;
                    if (inT > 0 || outT > 0) {
                        context.setVariable("saved_stream_prompt_tokens", inT);
                        context.setVariable("saved_stream_completion_tokens", outT);
                    }
                }

                var choice = parsedEvent.choices ? parsedEvent.choices[0] : null;
                eventText = (choice && choice.delta) ? (choice.delta.content || "") : "";
                finishReason = choice ? choice.finish_reason : null;
                if (finishReason || (parsedEvent.choices && parsedEvent.choices.length === 0 && parsedEvent.usage)) {
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
                    promptTokens = parseInt(context.getVariable("saved_stream_prompt_tokens") || (parsedEvent.usage ? parsedEvent.usage.prompt_tokens : 0) || 0, 10);
                    completionTokens = parseInt(context.getVariable("saved_stream_completion_tokens") || (parsedEvent.usage ? parsedEvent.usage.completion_tokens : 0) || 0, 10);
                    var totalT = promptTokens + completionTokens;
                    if (totalT > 0) {
                        context.setVariable("usage_prompt_tokens", promptTokens);
                        context.setVariable("usage_completion_tokens", completionTokens);
                        context.setVariable("usage_total_tokens", totalT.toFixed(0));
                        context.setVariable("stream_tokens_already_counted", "true");
                    }
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

                    if (parsedEvent.usage) {
                        var outT = parsedEvent.usage.output_tokens || 0;
                        var inT = parsedEvent.usage.input_tokens || 0;
                        if (outT > 0 || inT > 0) {
                            context.setVariable("saved_stream_prompt_tokens", inT);
                            context.setVariable("saved_stream_completion_tokens", outT);
                        }
                    }

                    if (parsedEvent.type === "message_delta" || parsedEvent.type === "message_stop") {
                        isFinished = true;
                    }

                    if (isFinished && !tokensAlreadyCounted) {
                        promptTokens = parseInt(context.getVariable("saved_stream_prompt_tokens") || (parsedEvent.usage ? parsedEvent.usage.input_tokens : 0) || 0, 10);
                        completionTokens = parseInt(context.getVariable("saved_stream_completion_tokens") || (parsedEvent.usage ? parsedEvent.usage.output_tokens : 0) || 0, 10);
                        var totalT = promptTokens + completionTokens;
                        if (totalT > 0) {
                            context.setVariable("usage_prompt_tokens", promptTokens);
                            context.setVariable("usage_completion_tokens", completionTokens);
                            context.setVariable("usage_total_tokens", totalT.toFixed(0));
                            context.setVariable("stream_tokens_already_counted", "true");
                        }
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
                            var outT = parsedEvent.usageMetadata.candidatesTokenCount || 0;
                            if (inT > 0 || outT > 0) {
                                context.setVariable("saved_stream_prompt_tokens", inT);
                                context.setVariable("saved_stream_completion_tokens", outT);
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
                            var outT = parsedEvent.usage.completion_tokens || 0;
                            if (inT > 0 || outT > 0) {
                                context.setVariable("saved_stream_prompt_tokens", inT);
                                context.setVariable("saved_stream_completion_tokens", outT);
                            }
                        }
                        if (finishReason) {
                            isFinished = true;
                        }
                        modelName = parsedEvent.model || modelName;
                    }

                    // Retrieve latest token counts for SSE translation headers
                    promptTokens = parseInt(context.getVariable("saved_stream_prompt_tokens") || 0, 10);
                    completionTokens = parseInt(context.getVariable("saved_stream_completion_tokens") || 0, 10);

                    // Translate chunk to Claude SSE format
                    var outputChunks = [];
                    var msgId = parsedEvent.id ? parsedEvent.id.replace("chatcmpl-", "msg_") : "msg_stream";
                    
                    var sentStart = context.getVariable("sent_message_start");
                    if (!sentStart) {
                        context.setVariable("sent_message_start", true);
                        
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
                                    "input_tokens": promptTokens,
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

                    // 4. Handle streaming functionCall from Gemini
                    var streamFuncCall = (candidate && candidate.content && candidate.content.parts && candidate.content.parts[0]) 
                                         ? candidate.content.parts[0].functionCall 
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
                    }
                    
                    // 5. content_block_stop & message_delta & message_stop (if finished)
                    if (isFinished) {
                        var blockStop = {
                            "type": "content_block_stop",
                            "index": 0
                        };
                        outputChunks.push("event: content_block_stop\ndata: " + JSON.stringify(blockStop));
                        
                        var stopReasonMapped = "end_turn";
                        if (finishReason === "tool_use" || streamFuncCall) {
                            stopReasonMapped = "tool_use";
                        } else if (finishReason === "MAX_TOKENS") {
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
                                "output_tokens": completionTokens
                            }
                        };
                        outputChunks.push("event: message_delta\ndata: " + JSON.stringify(msgDelta));
                        
                        var msgStop = {
                            "type": "message_stop"
                        };
                        outputChunks.push("event: message_stop\ndata: " + JSON.stringify(msgStop));

                        // Emit tokens ONCE upon stream completion
                        if (!tokensAlreadyCounted) {
                            var totalT = promptTokens + completionTokens;
                            if (totalT > 0) {
                                context.setVariable("usage_prompt_tokens", promptTokens);
                                context.setVariable("usage_completion_tokens", completionTokens);
                                context.setVariable("usage_total_tokens", totalT.toFixed(0));
                                context.setVariable("stream_tokens_already_counted", "true");
                            }
                        }
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
            
        } catch (e) {
            print("JSON Error: " + e);
        }
    } else {
        // If target is not Claude and we get [DONE], clear it so it's not sent
        if (targetName !== "claude") {
            context.setVariable("response.event.current.content", "");
        }
    }
}
