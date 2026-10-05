(function () {
'use strict';

try {
    var bodyStr = context.getVariable("request.content") || "";
    var headerJudge = context.getVariable("request.header.X-Gateway-Judge") || 
                      context.getVariable("request.header.x-enable-judge");
    var extractedModel = context.getVariable("model") || "";
    var hasJudgePayload = context.getVariable("has_judge_payload") === "true";
    var judgePluginId = context.getVariable("judge_plugin_id") || "";

    var shouldTrigger = (headerJudge === "true" ||
                         hasJudgePayload ||
                         judgePluginId === "judge" ||
                         judgePluginId === "task-classifier" ||
                         extractedModel === "auto:judge" ||
                         extractedModel === "gateway/judge" ||
                         bodyStr.indexOf('"judge"') !== -1 || 
                         bodyStr.indexOf('auto:judge') !== -1 ||
                         bodyStr.indexOf('gateway/judge') !== -1);

    var parsedBody = null;
    // Also check plugins in body if not obvious from string match
    if (!shouldTrigger && (bodyStr.indexOf('"plugins"') !== -1 || bodyStr.indexOf('"auto"') !== -1)) {
        try {
            parsedBody = JSON.parse(bodyStr);
            if (parsedBody.model === "auto:judge" || parsedBody.model === "gateway/judge") {
                shouldTrigger = true;
            } else if (Array.isArray(parsedBody.plugins)) {
                for (var p = 0; p < parsedBody.plugins.length; p++) {
                    if (parsedBody.plugins[p] && (parsedBody.plugins[p].id === "judge" || parsedBody.plugins[p].id === "task-classifier" || (parsedBody.plugins[p].id === "auto-router" && (parsedBody.plugins[p].mode === "judge" || parsedBody.plugins[p].judge === true || parsedBody.plugins[p].judge === "true")))) {
                        shouldTrigger = true;
                        break;
                    }
                }
            }
        } catch (pe) {
            // Ignore parse errors on fast path
        }
    }

    if (shouldTrigger) {
        // Extract prompt text
        var promptText = context.getVariable("extracted_prompt") || 
                         context.getVariable("gemini_text_prompt") || "";

        if (!promptText && bodyStr) {
            try {
                var jsonBody = parsedBody || JSON.parse(bodyStr);
                if (Array.isArray(jsonBody.messages)) {
                    var userMsgs = jsonBody.messages.filter(function(m) { return m.role === "user"; });
                    if (userMsgs.length > 0) {
                        var lastMsg = userMsgs[userMsgs.length - 1];
                        promptText = typeof lastMsg.content === "string" ? lastMsg.content : JSON.stringify(lastMsg.content);
                    }
                } else if (Array.isArray(jsonBody.contents)) {
                    var userContents = jsonBody.contents.filter(function(c) { return c.role === "user"; });
                    if (userContents.length > 0 && Array.isArray(userContents[0].parts)) {
                        promptText = userContents[0].parts.map(function(p) { return p.text || ""; }).join(" ");
                    }
                }
            } catch (e) {
                promptText = bodyStr.substring(0, 500);
            }
        }

        // Limit prompt length sent to judge for efficiency
        if (promptText.length > 1500) {
            promptText = promptText.substring(0, 1500) + "... [truncated]";
        }

        var judgePrompt = "You are an AI Gateway Judge and Prompt Complexity Classifier.\n" +
            "Analyze the following user prompt and classify it:\n\n" +
            "1. Task Category: choose one of ['coding', 'reasoning', 'summarization', 'simple_chat'].\n" +
            "2. Complexity Score: integer between 1 (trivial lookup/greeting) and 10 (intricate algorithm, large system design, complex logic).\n" +
            "3. Recommended Tier: choose one of:\n" +
            "   - 'low': (complexity 1-3) -> flash-lite\n" +
            "   - 'medium': (complexity 4-6) -> flash\n" +
            "   - 'high': (complexity 7-8) -> pro\n" +
            "   - 'max': (complexity 9-10) -> sonnet\n\n" +
            "Return strictly a JSON object with keys: task, complexity, recommended_tier, confidence, reasoning.\n\n" +
            "User Prompt:\n" + promptText;

        var judgePayload = {
            contents: [
                {
                    role: "user",
                    parts: [{ text: judgePrompt }]
                }
            ],
            generationConfig: {
                temperature: 0.1,
                maxOutputTokens: 256,
                responseMimeType: "application/json"
            }
        };

        context.setVariable("judge_request_payload", JSON.stringify(judgePayload));
        context.setVariable("trigger_judge", "true");
    } else {
        context.setVariable("trigger_judge", "false");
    }
} catch (e) {
    print("Error in prepare_judge_request: " + e);
    context.setVariable("trigger_judge", "false");
}

})();
