(function () {
'use strict';

try {
    context.setVariable("original_host", context.getVariable("request.header.host"));
    var bodyStr = context.getVariable("request.content");
    if (bodyStr) {
        var body = JSON.parse(bodyStr);
        var prompts = [];
        
        // 1. Extract from top-level system prompt (Anthropic format)
        if (body.system) {
            if (typeof body.system === "string") {
                prompts.push(body.system);
            } else if (Array.isArray(body.system)) {
                for (var i = 0; i < body.system.length; i++) {
                    if (body.system[i].text) {
                        prompts.push(body.system[i].text);
                    }
                }
            }
        }
        
        // 2. Extract from messages array (both OpenAI and Anthropic formats)
        if (body.messages && Array.isArray(body.messages)) {
            for (var j = 0; j < body.messages.length; j++) {
                var msg = body.messages[j];
                if (msg.role === "user" || msg.role === "system" || msg.role === "developer" || msg.role === "tool") {
                    if (typeof msg.content === "string") {
                        prompts.push(msg.content);
                    } else if (Array.isArray(msg.content)) {
                        for (var k = 0; k < msg.content.length; k++) {
                            var block = msg.content[k];
                            if (!block) continue;
                            if (block.type === "text" && block.text) {
                                prompts.push(block.text);
                            } else if (block.type === "tool_result" && block.content) {
                                if (typeof block.content === "string") {
                                    prompts.push(block.content);
                                } else if (Array.isArray(block.content)) {
                                    for (var m = 0; m < block.content.length; m++) {
                                        if (block.content[m] && block.content[m].text) {
                                            prompts.push(block.content[m].text);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        
        // Combine all extracted prompt text for Model Armor sanitization
        var combinedPrompt = prompts.join("\n");
        context.setVariable("extracted_prompt", combinedPrompt);
    }
} catch (e) {
    print("Error extracting prompt: " + e);
}

})();
