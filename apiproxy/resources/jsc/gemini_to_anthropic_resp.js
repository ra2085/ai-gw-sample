try {
    var responseStr = context.getVariable("response.content");
    if (responseStr) {
        var body = JSON.parse(responseStr);
        
        if (body.candidates && Array.isArray(body.candidates) && body.candidates[0]) {
            var candidate = body.candidates[0];
            var parts = candidate.content ? candidate.content.parts : [];
            var text = "";
            for (var i = 0; i < parts.length; i++) {
                if (parts[i].text) {
                    text += parts[i].text;
                }
            }
            
            var promptTokens = body.usageMetadata ? (body.usageMetadata.promptTokenCount || 0) : 0;
            var completionTokens = body.usageMetadata ? (body.usageMetadata.candidatesTokenCount || 0) : 0;
            
            var anthropicResp = {
                "id": "msg_gemini_" + (Math.random().toString(36).substring(2, 15)),
                "type": "message",
                "role": "assistant",
                "content": [
                    {
                        "type": "text",
                        "text": text
                    }
                ],
                "model": context.getVariable("model") || "gemini-1.5-flash",
                "stop_reason": candidate.finishReason === "STOP" ? "end_turn" : (candidate.finishReason || "end_turn"),
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
