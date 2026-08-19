try {
    var triggerJudge = context.getVariable("trigger_judge");
    
    if (triggerJudge === "true") {
        var respContent = context.getVariable("llmJudgeResponse.content");
        if (respContent) {
            var geminiResp = JSON.parse(respContent);
            var candidates = geminiResp.candidates || [];
            
            if (candidates.length > 0 && 
                candidates[0].content && 
                Array.isArray(candidates[0].content.parts) && 
                candidates[0].content.parts.length > 0) {
                
                var rawText = candidates[0].content.parts[0].text || "{}";
                
                // Clean any markdown code blocks if present
                rawText = rawText.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
                
                var verdict = JSON.parse(rawText);
                var task = verdict.task || "general";
                var complexity = verdict.complexity || 5;
                var recommendedTier = String(verdict.recommended_tier || "medium").toLowerCase().trim();
                if (recommendedTier.indexOf("low") !== -1) recommendedTier = "low";
                else if (recommendedTier.indexOf("high") !== -1) recommendedTier = "high";
                else if (recommendedTier.indexOf("max") !== -1) recommendedTier = "max";
                else recommendedTier = "medium";

                var reasoning = verdict.reasoning || "";

                // Set context variables
                context.setVariable("judge_task", task);
                context.setVariable("judge_complexity", String(complexity));
                context.setVariable("judge_tier", recommendedTier);
                context.setVariable("judge_reasoning", reasoning);

                // Set response headers
                context.setVariable("response.header.X-Gateway-Judge-Task", task);
                context.setVariable("response.header.X-Gateway-Judge-Complexity", String(complexity));
                context.setVariable("response.header.X-Gateway-Judge-Tier", recommendedTier);
                if (reasoning) {
                    context.setVariable("response.header.X-Gateway-Judge-Reasoning", reasoning.substring(0, 100));
                }

                // If user opted into dynamic auto-routing without hardcoded tier, apply judge's tier
                var currentReqModel = context.getVariable("requested_model") || "";
                if (currentReqModel === "auto" || currentReqModel === "gateway/auto" || currentReqModel.indexOf("auto:judge") === 0) {
                    context.setVariable("cost_tier", recommendedTier);
                }
            }
        }
    }
} catch (e) {
    print("Error processing LLM judge response: " + e);
}
