try {
    var promptTokens = parseInt(context.getVariable("prompt_tokens") || 0, 10);
    var completionTokens = parseInt(context.getVariable("completion_tokens") || 0, 10);
    context.setVariable("usage_total_tokens", (promptTokens + completionTokens).toFixed(0));
} catch (e) {
    print("Error calculating non-streaming tokens: " + e);
}
