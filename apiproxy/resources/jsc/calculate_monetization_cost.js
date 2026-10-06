(function () {
'use strict';

try {
    var promptTokens = parseInt(context.getVariable("prompt_tokens") || context.getVariable("usage_prompt_tokens") || 0, 10);
    if (isNaN(promptTokens) || promptTokens < 0) promptTokens = 0;

    var completionTokens = parseInt(context.getVariable("completion_tokens") || context.getVariable("usage_completion_tokens") || 0, 10);
    if (isNaN(completionTokens) || completionTokens < 0) completionTokens = 0;

    var cacheReadTokens = parseInt(context.getVariable("cache_read_tokens") || context.getVariable("usage_cache_read_tokens") || 0, 10);
    if (isNaN(cacheReadTokens) || cacheReadTokens < 0) cacheReadTokens = 0;

    var cacheWriteTokens = parseInt(context.getVariable("cache_write_tokens") || context.getVariable("usage_cache_write_tokens") || 0, 10);
    if (isNaN(cacheWriteTokens) || cacheWriteTokens < 0) cacheWriteTokens = 0;

    var thinkingTokens = parseInt(context.getVariable("thinking_tokens") || context.getVariable("usage_thinking_tokens") || 0, 10);
    if (isNaN(thinkingTokens) || thinkingTokens < 0) thinkingTokens = 0;

    var uncachedStr = context.getVariable("uncached_prompt_tokens") || context.getVariable("usage_uncached_prompt_tokens");
    var uncachedPromptTokens = uncachedStr !== null
        ? parseInt(uncachedStr, 10)
        : Math.max(0, promptTokens - cacheReadTokens - cacheWriteTokens);
    if (isNaN(uncachedPromptTokens) || uncachedPromptTokens < 0) uncachedPromptTokens = 0;

    if (promptTokens < uncachedPromptTokens + cacheReadTokens + cacheWriteTokens) {
        promptTokens = uncachedPromptTokens + cacheReadTokens + cacheWriteTokens;
    }
    var totalTokens = promptTokens + completionTokens;

    var model = context.getVariable("model") || "default";
    var isDefaultModel = (model === "default");
    var bareModel = model.indexOf("/") !== -1 ? model.split("/").slice(1).join("/") : model;
    var hasBarePrefix = (bareModel !== model && bareModel !== "default");

    // 1. Fetch model pricing rates per 1,000,000 tokens from propertyset
    //    Supports both <model>.input_rate_per_m (static propertyset) and <model>.input_rate (values.yaml template)
    var inputRateStr = context.getVariable("propertyset.monetization_rates." + model + ".input_rate_per_m") ||
                       context.getVariable("propertyset.monetization_rates." + model + ".input_rate") ||
                       (hasBarePrefix ? (context.getVariable("propertyset.monetization_rates." + bareModel + ".input_rate_per_m") ||
                                         context.getVariable("propertyset.monetization_rates." + bareModel + ".input_rate")) : null) ||
                       (!isDefaultModel ? (context.getVariable("propertyset.monetization_rates.default.input_rate_per_m") ||
                                           context.getVariable("propertyset.monetization_rates.default.input_rate")) : null) ||
                       "0.10";

    var outputRateStr = context.getVariable("propertyset.monetization_rates." + model + ".output_rate_per_m") ||
                        context.getVariable("propertyset.monetization_rates." + model + ".output_rate") ||
                        (hasBarePrefix ? (context.getVariable("propertyset.monetization_rates." + bareModel + ".output_rate_per_m") ||
                                          context.getVariable("propertyset.monetization_rates." + bareModel + ".output_rate")) : null) ||
                        (!isDefaultModel ? (context.getVariable("propertyset.monetization_rates.default.output_rate_per_m") ||
                                            context.getVariable("propertyset.monetization_rates.default.output_rate")) : null) ||
                        "0.40";

    var inputRate = parseFloat(inputRateStr);
    var outputRate = parseFloat(outputRateStr);

    var cacheReadRate = inputRate;
    if (cacheReadTokens > 0) {
        var cacheReadRateStr = context.getVariable("propertyset.monetization_rates." + model + ".cache_read_rate_per_m") ||
                               context.getVariable("propertyset.monetization_rates." + model + ".cache_read_rate") ||
                               (hasBarePrefix ? (context.getVariable("propertyset.monetization_rates." + bareModel + ".cache_read_rate_per_m") ||
                                                 context.getVariable("propertyset.monetization_rates." + bareModel + ".cache_read_rate")) : null) ||
                               (!isDefaultModel ? (context.getVariable("propertyset.monetization_rates.default.cache_read_rate_per_m") ||
                                                   context.getVariable("propertyset.monetization_rates.default.cache_read_rate")) : null);
        if (cacheReadRateStr) cacheReadRate = parseFloat(cacheReadRateStr);
    }

    var cacheWriteRate = inputRate;
    if (cacheWriteTokens > 0) {
        var cacheWriteRateStr = context.getVariable("propertyset.monetization_rates." + model + ".cache_write_rate_per_m") ||
                                context.getVariable("propertyset.monetization_rates." + model + ".cache_write_rate") ||
                                (hasBarePrefix ? (context.getVariable("propertyset.monetization_rates." + bareModel + ".cache_write_rate_per_m") ||
                                                  context.getVariable("propertyset.monetization_rates." + bareModel + ".cache_write_rate")) : null) ||
                                (!isDefaultModel ? (context.getVariable("propertyset.monetization_rates.default.cache_write_rate_per_m") ||
                                                    context.getVariable("propertyset.monetization_rates.default.cache_write_rate")) : null);
        if (cacheWriteRateStr) cacheWriteRate = parseFloat(cacheWriteRateStr);
    }

    // 3. Fetch per-model or platform markup multiplier
    var markupStr = context.getVariable("propertyset.monetization_rates." + model + ".markup") ||
                    (hasBarePrefix ? context.getVariable("propertyset.monetization_rates." + bareModel + ".markup") : null) ||
                    context.getVariable("propertyset.monetization_rates.platform.markup_multiplier") ||
                    (!isDefaultModel ? context.getVariable("propertyset.monetization_rates.default.markup") : null) ||
                    "1.0";
    var markupMultiplier = parseFloat(markupStr);
    if (isNaN(markupMultiplier) || markupMultiplier <= 0) {
        markupMultiplier = 1.0;
    }

    var currency = context.getVariable("propertyset.monetization_rates.platform.currency") ||
                   context.getVariable("propertyset.monetization_rates.default.currency") ||
                   "USD";

    // 4. Compute micro-transaction costs in USD and integer micro-USD ($1.00 = 1,000,000 micro-USD)
    var uncachedPromptCost = (uncachedPromptTokens / 1000000.0) * inputRate * markupMultiplier;
    var cacheReadCost = (cacheReadTokens / 1000000.0) * cacheReadRate * markupMultiplier;
    var cacheWriteCost = (cacheWriteTokens / 1000000.0) * cacheWriteRate * markupMultiplier;
    var promptCost = uncachedPromptCost + cacheReadCost + cacheWriteCost;
    var completionCost = (completionTokens / 1000000.0) * outputRate * markupMultiplier;
    var totalCost = promptCost + completionCost;
    var totalCostStr = totalCost.toFixed(6);
    var totalCostMicro = totalCost > 0 ? Math.max(1, Math.round(totalCost * 1000000)) : 0;
    var totalCostMicroStr = totalCostMicro.toFixed(0);
    var totalTokensStr = totalTokens.toFixed(0);

    var primaryQuotaMode = context.getVariable("primary_quota_mode") || "tokens";
    var secondaryQuotaMode = context.getVariable("secondary_quota_mode") || "tokens";

    // 5. Export context variables for headers, analytics data collectors, Virtual USD Spend Wallets, and Apigee Monetization Rating Engine
    context.setVariable("uncached_prompt_tokens", uncachedPromptTokens.toFixed(0));
    context.setVariable("cache_read_tokens", cacheReadTokens.toFixed(0));
    context.setVariable("cache_write_tokens", cacheWriteTokens.toFixed(0));
    context.setVariable("thinking_tokens", thinkingTokens.toFixed(0));
    context.setVariable("tx_cost_usd", totalCostStr);
    context.setVariable("tx_cost_micro_usd", totalCostMicroStr);
    context.setVariable("tx_prompt_cost_usd", promptCost.toFixed(6));
    context.setVariable("tx_uncached_prompt_cost_usd", uncachedPromptCost.toFixed(6));
    context.setVariable("tx_cache_read_cost_usd", cacheReadCost.toFixed(6));
    context.setVariable("tx_cache_write_cost_usd", cacheWriteCost.toFixed(6));
    context.setVariable("tx_completion_cost_usd", completionCost.toFixed(6));
    context.setVariable("tx_currency", currency);
    context.setVariable("primary_quota_usage", primaryQuotaMode === "usd" ? totalCostMicroStr : totalTokensStr);
    context.setVariable("secondary_quota_usage", secondaryQuotaMode === "usd" ? totalCostMicroStr : totalTokensStr);

    // Apigee Monetization Data Collector variables (used by Monetization Rating Engine to deduct from prepaid wallet)
    context.setVariable("perUnitPriceMultiplier", totalCostStr);
    context.setVariable("currency", currency);
    context.setVariable("transactionSuccess", "true");

    // Apigee Monetization standard transaction variables
    context.setVariable("mint.tx_cost", totalCostStr);
    context.setVariable("mint.tx_volume", totalTokensStr);
    context.setVariable("mint.tx_currency", currency);

} catch (e) {
    print("Error calculating monetization micro-transaction cost: " + e);
}

})();
