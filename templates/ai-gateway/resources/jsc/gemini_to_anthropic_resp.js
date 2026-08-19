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
            
            var promptTokens = body.usageMetadata ? (body.usageMetadata.promptTokenCount || 0) : 0;
            var completionTokens = body.usageMetadata ? (body.usageMetadata.candidatesTokenCount || 0) : 0;
            
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
                    "input_tokens": promptTokens,
                    "output_tokens": completionTokens
                }
            };
            
            context.setVariable("response.content", JSON.stringify(anthropicResp));
        }
    }
} catch (e) {
    print("Error translating Gemini to Anthropic response: " + e);
}
