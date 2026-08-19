try {
    var promptTokens = parseInt(context.getVariable("prompt_tokens") || context.getVariable("usage_prompt_tokens") || 0, 10);
    var completionTokens = parseInt(context.getVariable("completion_tokens") || context.getVariable("usage_completion_tokens") || 0, 10);
    var totalTokens = promptTokens + completionTokens;
    var model = context.getVariable("model") || "default";

    // 1. Fetch model pricing rates per 1,000,000 tokens from propertyset
    var inputRateStr = context.getVariable("propertyset.monetization_rates." + model + ".input_rate_per_m");
    var outputRateStr = context.getVariable("propertyset.monetization_rates." + model + ".output_rate_per_m");

    if (!inputRateStr) {
        inputRateStr = context.getVariable("propertyset.monetization_rates.default.input_rate_per_m") || "0.10";
    }
    if (!outputRateStr) {
        outputRateStr = context.getVariable("propertyset.monetization_rates.default.output_rate_per_m") || "0.40";
    }

    var inputRate = parseFloat(inputRateStr);
    var outputRate = parseFloat(outputRateStr);

    // 2. Long context tiering (> 128k prompt tokens doubles the rate on Gemini models)
    if (promptTokens > 128000 && model.indexOf("gemini") !== -1) {
        inputRate = inputRate * 2.0;
        outputRate = outputRate * 2.0;
    }

    // 3. Fetch platform markup multiplier
    var markupStr = context.getVariable("propertyset.monetization_rates.platform.markup_multiplier") || "1.0";
    var markupMultiplier = parseFloat(markupStr);
    if (isNaN(markupMultiplier) || markupMultiplier <= 0) {
        markupMultiplier = 1.0;
    }

    var currency = context.getVariable("propertyset.monetization_rates.platform.currency") || "USD";

    // 4. Compute micro-transaction costs in USD
    var promptCost = (promptTokens / 1000000.0) * inputRate * markupMultiplier;
    var completionCost = (completionTokens / 1000000.0) * outputRate * markupMultiplier;
    var totalCost = promptCost + completionCost;

    // 5. Export context variables for headers, analytics data collectors, and Apigee Monetization Rating Engine
    context.setVariable("tx_cost_usd", totalCost.toFixed(6));
    context.setVariable("tx_prompt_cost_usd", promptCost.toFixed(6));
    context.setVariable("tx_completion_cost_usd", completionCost.toFixed(6));
    context.setVariable("tx_currency", currency);

    // Apigee Monetization Data Collector variables (used by Monetization Rating Engine to deduct from prepaid wallet)
    context.setVariable("perUnitPriceMultiplier", totalCost.toFixed(6));
    context.setVariable("currency", currency);
    context.setVariable("transactionSuccess", "true");

    // Apigee Monetization standard transaction variables
    context.setVariable("mint.tx_cost", totalCost.toFixed(6));
    context.setVariable("mint.tx_volume", totalTokens.toString());
    context.setVariable("mint.tx_currency", currency);

} catch (e) {
    print("Error calculating monetization micro-transaction cost: " + e);
}
