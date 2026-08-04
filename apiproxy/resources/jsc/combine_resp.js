var rawContent = context.getVariable("response.event.current.content");
var targetName = context.getVariable("route.target") || context.getVariable("target.name");
var bufferSize = context.getVariable("buffer_size");
if (!bufferSize) {
    bufferSize = parseInt(context.getVariable("propertyset.extract_expressions.buffer_size")) || 10;
    context.setVariable("buffer_size", bufferSize);
}

// Clear token variables at the start of each event chunk processing to prevent duplicate counts
context.removeVariable("usage_prompt_tokens");
context.removeVariable("usage_completion_tokens");
context.removeVariable("usage_total_tokens");



var dataIdx = rawContent ? rawContent.indexOf("data:") : -1;
if (rawContent && dataIdx !== -1) {
    var eventStr = rawContent.substring(dataIdx + 5).trim();
    
    if (eventStr.indexOf("[DONE]") === -1) {
        try {
            var parsedEvent = JSON.parse(eventStr);
            
            var requestFormat = context.getVariable("request_format") || "claude";
            if (requestFormat === "gemini") {
                if (parsedEvent.usageMetadata) {
                    if (parsedEvent.usageMetadata.candidatesTokenCount !== undefined) {
                        context.setVariable("usage_completion_tokens", parsedEvent.usageMetadata.candidatesTokenCount);
                    }
                    if (parsedEvent.usageMetadata.promptTokenCount !== undefined) {
                        context.setVariable("usage_prompt_tokens", parsedEvent.usageMetadata.promptTokenCount);
                    }
                    if (parsedEvent.usageMetadata.candidatesTokenCount !== undefined && parsedEvent.usageMetadata.promptTokenCount !== undefined) {
                        context.setVariable("usage_total_tokens", (parsedEvent.usageMetadata.candidatesTokenCount + parsedEvent.usageMetadata.promptTokenCount).toFixed(0));
                    }
                }

                var candidate = parsedEvent.candidates ? parsedEvent.candidates[0] : null;
                var eventText = (candidate && candidate.content && candidate.content.parts && candidate.content.parts[0]) ? (candidate.content.parts[0].text || "") : "";
                var finishReason = candidate ? candidate.finishReason : null;
                
                var idx = context.getVariable("response.event.current.count");
                
                if (idx % bufferSize === 0 || finishReason === "stop" || finishReason === "STOP") {
                    var currentBuffer = context.getVariable("tmp_buffer_pre");
                    context.setVariable("response_partial", currentBuffer);
                    context.setVariable("buff_ready", true);
                    context.setVariable("tmp_buffer_pre", "");
                } else {
                    context.setVariable("buff_ready", false);
                    context.setVariable("response_partial", "");
                    var previousBufferVal = context.getVariable("tmp_buffer_pre");
                    var newBuffer = (previousBufferVal || "") + (eventText || "");
                    context.setVariable("tmp_buffer_pre", newBuffer);
                }
            } else if (requestFormat === "openai") {
                if (parsedEvent.usage) {
                    var outT = parsedEvent.usage.completion_tokens || 0;
                    var inT = parsedEvent.usage.prompt_tokens || 0;
                    context.setVariable("usage_completion_tokens", outT);
                    context.setVariable("usage_prompt_tokens", inT);
                    context.setVariable("usage_total_tokens", (outT + inT).toFixed(0));
                }
                
                var choice = parsedEvent.choices ? parsedEvent.choices[0] : null;
                var eventText = (choice && choice.delta) ? (choice.delta.content || "") : "";
                var finishReason = choice ? choice.finish_reason : null;
                
                // Buffer management for Model Armor sanitization (shared)
                var idx = context.getVariable("response.event.current.count");
                
                if (idx % bufferSize === 0 || finishReason === "stop" || finishReason === "STOP") {
                    var currentBuffer = context.getVariable("tmp_buffer_pre");
                    context.setVariable("response_partial", currentBuffer);
                    context.setVariable("buff_ready", true);
                    context.setVariable("tmp_buffer_pre", "");
                } else {
                    context.setVariable("buff_ready", false);
                    context.setVariable("response_partial", "");
                    var previousBufferVal = context.getVariable("tmp_buffer_pre");
                    var newBuffer = (previousBufferVal || "") + (eventText || "");
                    context.setVariable("tmp_buffer_pre", newBuffer);
                }
            } else {
                var eventText = "";
                var finishReason = "";
                
                var promptTokens = 0;
                var completionTokens = 0;
                var modelName = context.getVariable("model") || "unknown";
                var isFinished = false;

                if (targetName === "claude") {
                    // Target is Claude: parses Claude SSE events to buffer for Model Armor
                    if (parsedEvent.delta && parsedEvent.delta.text !== undefined) {
                        eventText = parsedEvent.delta.text;
                    } else if (parsedEvent.type === "message_delta") {
                        if (parsedEvent.delta && parsedEvent.delta.stop_reason) {
                            finishReason = "stop";
                        }
                    }
                    
                    // Extract usage
                    if (parsedEvent.usage) {
                        var outT = 0;
                        var inT = 0;
                        if (parsedEvent.usage.output_tokens !== undefined) {
                            outT = parsedEvent.usage.output_tokens;
                            context.setVariable("usage_completion_tokens", outT);
                        }
                        if (parsedEvent.usage.input_tokens !== undefined) {
                            inT = parsedEvent.usage.input_tokens;
                            context.setVariable("usage_prompt_tokens", inT);
                        }
                        context.setVariable("usage_total_tokens", (outT + inT).toFixed(0));
                    }
                } else {
                    // Non-Claude targets: we need to translate their chunks to Claude SSE
                    if (targetName === "gemini") {
                        // Native Gemini target
                        var candidate = parsedEvent.candidates ? parsedEvent.candidates[0] : null;
                        var parts = (candidate && candidate.content) ? candidate.content.parts : null;
                        eventText = (parts && parts[0]) ? (parts[0].text || "") : "";
                        finishReason = candidate ? candidate.finishReason : null;
                        
                        if (parsedEvent.usageMetadata) {
                            promptTokens = parsedEvent.usageMetadata.promptTokenCount || 0;
                            completionTokens = parsedEvent.usageMetadata.candidatesTokenCount || 0;
                            context.setVariable("usage_completion_tokens", completionTokens);
                            context.setVariable("usage_prompt_tokens", promptTokens);
                            context.setVariable("usage_total_tokens", (promptTokens + completionTokens).toFixed(0));
                        }
                        if (finishReason) {
                            isFinished = true;
                        }
                    } else {
                        // OpenAI target (or gemini-compat targets)
                        var choice = parsedEvent.choices ? parsedEvent.choices[0] : null;
                        eventText = (choice && choice.delta) ? (choice.delta.content || "") : "";
                        finishReason = choice ? choice.finish_reason : null;
                        
                        if (parsedEvent.usage) {
                            promptTokens = parsedEvent.usage.prompt_tokens || 0;
                            completionTokens = parsedEvent.usage.completion_tokens || 0;
                            context.setVariable("usage_completion_tokens", completionTokens);
                            context.setVariable("usage_prompt_tokens", promptTokens);
                            context.setVariable("usage_total_tokens", (promptTokens + completionTokens).toFixed(0));
                        }
                        if (finishReason) {
                            isFinished = true;
                        }
                        modelName = parsedEvent.model || modelName;
                    }

                    // Translate to Claude SSE format!
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
                        
                        // 2. content_block_start
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
                    
                    // 3. content_block_delta
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
                    
                    // 4. content_block_stop & message_delta & message_stop (if finished)
                    if (isFinished) {
                        var blockStop = {
                            "type": "content_block_stop",
                            "index": 0
                        };
                        outputChunks.push("event: content_block_stop\ndata: " + JSON.stringify(blockStop));
                        
                        var msgDelta = {
                            "type": "message_delta",
                            "delta": {
                                "stop_reason": finishReason === "STOP" || finishReason === "stop" ? "end_turn" : finishReason,
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
                    }
                    
                    if (outputChunks.length > 0) {
                        context.setVariable("response.event.current.content", outputChunks.join("\n\n") + "\n\n");
                    } else {
                        context.setVariable("response.event.current.content", "");
                    }
                }
                
                // Buffer management for Model Armor sanitization (shared)
                var idx = context.getVariable("response.event.current.count");
                
                if (idx % bufferSize === 0 || finishReason === "stop" || finishReason === "STOP") {
                    var currentBuffer = context.getVariable("tmp_buffer_pre");
                    context.setVariable("response_partial", currentBuffer);
                    context.setVariable("buff_ready", true);
                    context.setVariable("tmp_buffer_pre", "");
                } else {
                    context.setVariable("buff_ready", false);
                    context.setVariable("response_partial", "");
                    var previousBufferVal = context.getVariable("tmp_buffer_pre");
                    var newBuffer = (previousBufferVal || "") + (eventText || "");
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
