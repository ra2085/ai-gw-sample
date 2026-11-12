(function () {
'use strict';

var varMemo = {};
function getVar(k) {
    if (Object.prototype.hasOwnProperty.call(varMemo, k)) {
        return varMemo[k];
    }
    var val = context.getVariable(k);
    varMemo[k] = val;
    return val;
}
function setVar(k, val) {
    varMemo[k] = val;
    context.setVariable(k, val);
}
function remVar(k) {
    varMemo[k] = null;
    context.removeVariable(k);
}

var rawContent = getVar("response.event.current.content");
var targetName = getVar("route.target") || getVar("target.name") || getVar("route_target");
var routeFormat = getVar("route_format") || "";
var bufferSize = parseInt(getVar("buffer_size") || "0", 10);
if (!bufferSize || isNaN(bufferSize)) {
    bufferSize = parseInt(getVar("propertyset.extract_expressions.buffer_size") || "10", 10) || 10;
    setVar("buffer_size", String(bufferSize));
    remVar("raw_client_payload");
}

// Clear per-chunk export variables only if they were populated on the previous chunk
if (getVar("usage_total_tokens") !== null) {
    remVar("usage_prompt_tokens");
    remVar("usage_completion_tokens");
    remVar("usage_total_tokens");
    remVar("tx_cost_usd");
    remVar("tx_cost_micro_usd");
    remVar("primary_quota_usage");
    remVar("secondary_quota_usage");
    remVar("perUnitPriceMultiplier");
}
if (getVar("buff_ready") === "true") {
    remVar("buff_ready");
    remVar("response_partial");
}
if (getVar("release_concurrency_slot") === "true") {
    remVar("release_concurrency_slot");
}

function emitStreamTokenVariables(uncachedIn, cacheRead, cacheWrite, outTokens, thinkingTokens, isCheckpointOnly) {
    var totalIn = uncachedIn + cacheRead + cacheWrite;
    var totalT = totalIn + outTokens;
    if (totalT > 0) {
        var rawModel = getVar("model");
        var totalInStr = String(totalIn);
        var uncachedInStr = String(uncachedIn);
        var cacheReadStr = String(cacheRead);
        var cacheWriteStr = String(cacheWrite);
        var thinkingStr = String(thinkingTokens);
        var outTokensStr = String(outTokens);
        var totalTStr = totalT.toFixed(0);
        setVar("prompt_tokens", totalInStr);
        setVar("usage_prompt_tokens", totalInStr);
        setVar("uncached_prompt_tokens", uncachedInStr);
        setVar("usage_uncached_prompt_tokens", uncachedInStr);
        setVar("cache_read_tokens", cacheReadStr);
        setVar("usage_cache_read_tokens", cacheReadStr);
        setVar("cache_write_tokens", cacheWriteStr);
        setVar("usage_cache_write_tokens", cacheWriteStr);
        setVar("thinking_tokens", thinkingStr);
        setVar("usage_thinking_tokens", thinkingStr);
        setVar("completion_tokens", outTokensStr);
        setVar("usage_completion_tokens", outTokensStr);
        setVar("usage_total_tokens", totalTStr);
        if (isCheckpointOnly) {
            setVar("stream_prompt_checkpointed", "true");
        } else {
            setVar("stream_tokens_already_counted", "true");
        }

        // Inline Monetization & Virtual USD Spend Wallet Calculation (keeps EventFlow <= 5 policies)
        var model = rawModel || "default";
        var isDefaultModel = (model === "default");
        var bareModel = model.indexOf("/") !== -1 ? model.split("/").slice(1).join("/") : model;
        var hasBarePrefix = (bareModel !== model && bareModel !== "default");

        var inputRateStr = getVar("propertyset.monetization_rates." + model + ".input_rate_per_m") ||
                           getVar("propertyset.monetization_rates." + model + ".input_rate") ||
                           (hasBarePrefix ? (getVar("propertyset.monetization_rates." + bareModel + ".input_rate_per_m") ||
                                             getVar("propertyset.monetization_rates." + bareModel + ".input_rate")) : null) ||
                           (!isDefaultModel ? (getVar("propertyset.monetization_rates.default.input_rate_per_m") ||
                                               getVar("propertyset.monetization_rates.default.input_rate")) : null) ||
                           "0.10";

        var outputRateStr = getVar("propertyset.monetization_rates." + model + ".output_rate_per_m") ||
                            getVar("propertyset.monetization_rates." + model + ".output_rate") ||
                            (hasBarePrefix ? (getVar("propertyset.monetization_rates." + bareModel + ".output_rate_per_m") ||
                                              getVar("propertyset.monetization_rates." + bareModel + ".output_rate")) : null) ||
                            (!isDefaultModel ? (getVar("propertyset.monetization_rates.default.output_rate_per_m") ||
                                                getVar("propertyset.monetization_rates.default.output_rate")) : null) ||
                            "0.40";

        var inputRate = parseFloat(String(inputRateStr).replace(/^\$/, ""));
        if (isNaN(inputRate) || inputRate < 0) inputRate = 0.10;
        var outputRate = parseFloat(String(outputRateStr).replace(/^\$/, ""));
        if (isNaN(outputRate) || outputRate < 0) outputRate = 0.40;

        var cacheReadRate = inputRate;
        if (cacheRead > 0) {
            var cacheReadRateStr = getVar("propertyset.monetization_rates." + model + ".cache_read_rate_per_m") ||
                                   getVar("propertyset.monetization_rates." + model + ".cache_read_rate") ||
                                   (hasBarePrefix ? (getVar("propertyset.monetization_rates." + bareModel + ".cache_read_rate_per_m") ||
                                                     getVar("propertyset.monetization_rates." + bareModel + ".cache_read_rate")) : null) ||
                                   (!isDefaultModel ? (getVar("propertyset.monetization_rates.default.cache_read_rate_per_m") ||
                                                       getVar("propertyset.monetization_rates.default.cache_read_rate")) : null);
            if (cacheReadRateStr) {
                var parsedCr = parseFloat(String(cacheReadRateStr).replace(/^\$/, ""));
                if (!isNaN(parsedCr) && parsedCr >= 0) cacheReadRate = parsedCr;
            }
        }

        var cacheWriteRate = inputRate;
        if (cacheWrite > 0) {
            var cacheWriteRateStr = getVar("propertyset.monetization_rates." + model + ".cache_write_rate_per_m") ||
                                    getVar("propertyset.monetization_rates." + model + ".cache_write_rate") ||
                                    (hasBarePrefix ? (getVar("propertyset.monetization_rates." + bareModel + ".cache_write_rate_per_m") ||
                                                      getVar("propertyset.monetization_rates." + bareModel + ".cache_write_rate")) : null) ||
                                    (!isDefaultModel ? (getVar("propertyset.monetization_rates.default.cache_write_rate_per_m") ||
                                                        getVar("propertyset.monetization_rates.default.cache_write_rate")) : null);
            if (cacheWriteRateStr) {
                var parsedCw = parseFloat(String(cacheWriteRateStr).replace(/^\$/, ""));
                if (!isNaN(parsedCw) && parsedCw >= 0) cacheWriteRate = parsedCw;
            }
        }

        var markupStr = getVar("propertyset.monetization_rates." + model + ".markup") ||
                        (hasBarePrefix ? getVar("propertyset.monetization_rates." + bareModel + ".markup") : null) ||
                        getVar("propertyset.monetization_rates.platform.markup_multiplier") ||
                        (!isDefaultModel ? getVar("propertyset.monetization_rates.default.markup") : null) ||
                        "1.0";
        var markupMultiplier = parseFloat(markupStr);
        if (isNaN(markupMultiplier) || markupMultiplier <= 0) {
            markupMultiplier = 1.0;
        }

        var currency = getVar("propertyset.monetization_rates.platform.currency") ||
                       getVar("propertyset.monetization_rates.default.currency") ||
                       "USD";

        var uncachedPromptCost = (uncachedIn / 1000000.0) * inputRate * markupMultiplier;
        var cacheReadCost = (cacheRead / 1000000.0) * cacheReadRate * markupMultiplier;
        var cacheWriteCost = (cacheWrite / 1000000.0) * cacheWriteRate * markupMultiplier;
        var promptCost = uncachedPromptCost + cacheReadCost + cacheWriteCost;
        var completionCost = (outTokens / 1000000.0) * outputRate * markupMultiplier;
        var totalCost = promptCost + completionCost;
        var totalCostStr = totalCost.toFixed(6);
        var totalCostMicro = totalCost > 0 ? Math.max(1, Math.round(totalCost * 1000000)) : 0;
        var totalCostMicroStr = totalCostMicro.toFixed(0);

        var primaryQuotaMode = getVar("primary_quota_mode") || "tokens";
        var secondaryQuotaMode = getVar("secondary_quota_mode") || "tokens";
        var rawPrimaryUsage = primaryQuotaMode === "usd" ? totalCostMicro : totalT;
        var rawSecondaryUsage = secondaryQuotaMode === "usd" ? totalCostMicro : totalT;
        var prevPrimary = parseInt(getVar("billed_primary_quota") || "0", 10);
        var prevSecondary = parseInt(getVar("billed_secondary_quota") || "0", 10);
        var deltaPrimary = prevPrimary > 0 ? Math.max(0, rawPrimaryUsage - prevPrimary) : rawPrimaryUsage;
        var deltaSecondary = prevSecondary > 0 ? Math.max(0, rawSecondaryUsage - prevSecondary) : rawSecondaryUsage;

        setVar("tx_cost_usd", totalCostStr);
        setVar("tx_cost_micro_usd", totalCostMicroStr);
        setVar("tx_prompt_cost_usd", promptCost.toFixed(6));
        setVar("tx_uncached_prompt_cost_usd", uncachedPromptCost.toFixed(6));
        setVar("tx_cache_read_cost_usd", cacheReadCost.toFixed(6));
        setVar("tx_cache_write_cost_usd", cacheWriteCost.toFixed(6));
        setVar("tx_completion_cost_usd", completionCost.toFixed(6));
        setVar("tx_currency", currency);
        setVar("primary_quota_usage", deltaPrimary.toFixed(0));
        setVar("secondary_quota_usage", deltaSecondary.toFixed(0));
        setVar("billed_primary_quota", Math.max(prevPrimary, rawPrimaryUsage).toFixed(0));
        setVar("billed_secondary_quota", Math.max(prevSecondary, rawSecondaryUsage).toFixed(0));

        setVar("perUnitPriceMultiplier", totalCostStr);
        setVar("currency", currency);
        setVar("transactionSuccess", "true");
        setVar("mint.tx_cost", totalCostStr);
        setVar("mint.tx_volume", totalTStr);
        setVar("mint.tx_currency", currency);
    }
}

function appendBoundedScan(base, extra) {
    if (!extra) return base;
    if (base.length >= 32768) return base;
    var sep = (base.length > 0 && base.charAt(base.length - 1) !== " " && extra.charAt(0) !== " ") ? "" : "";
    var rem = 32768 - base.length - sep.length;
    if (rem <= 0) return base;
    return base + sep + (extra.length <= rem ? extra : extra.substring(0, rem));
}

function updateArmorBuffer(scanDelta, forceFlush) {
    if (getVar("model_armor_response_enabled") === "false") {
        return;
    }
    var prevBuf = getVar("tmp_buffer_pre") || "";
    var hasDelta = Boolean(scanDelta && scanDelta.length > 0);
    if (hasDelta) {
        setVar("tmp_buffer_has_new", "true");
    }
    var hasNew = hasDelta || (getVar("tmp_buffer_has_new") === "true");
    var newBuf = hasDelta ? appendBoundedScan(prevBuf, scanDelta) : prevBuf;
    var idx = parseInt(getVar("response.event.current.count") || "0", 10);

    if (((idx > 0 && idx % bufferSize === 0) || newBuf.length >= 8192 || forceFlush) && newBuf.length > 0 && hasNew) {
        setVar("response_partial", newBuf);
        setVar("buff_ready", "true");
        var overlap = (!forceFlush && newBuf.length > 200) ? newBuf.substring(newBuf.length - 200) : "";
        setVar("tmp_buffer_pre", overlap);
        setVar("tmp_buffer_has_new", "false");
    } else {
        setVar("buff_ready", "false");
        setVar("tmp_buffer_pre", newBuf);
    }
}

function recordStreamOutChars(charCount) {
    if (charCount > 0 && getVar("stream_tokens_already_counted") !== "true") {
        var prev = parseInt(getVar("stream_out_chars") || "0", 10);
        setVar("stream_out_chars", String(prev + charCount));
    }
}

function isSafetyStopHint(hint) {
    return hint === "SAFETY" || hint === "RECITATION" || hint === "BLOCKLIST" ||
           hint === "PROHIBITED_CONTENT" || hint === "SPII" || hint === "IMAGE_SAFETY" ||
           hint === "MODEL_ARMOR" || hint === "content_filter" || hint === "refusal";
}

function buildDeferredClaudeStopChunks(stopReasonHint, uncachedIn, cacheRead, outTokens) {
    var chunks = [];
    var hadOpenToolIdx = Boolean(getVar("open_tool_block_idx"));
    if (getVar("anthropic_thinking_requested") === "true") {
        var openThinkIdx = getVar("open_thinking_block_idx");
        if (openThinkIdx !== null) {
            var stopThinkIdx = parseInt(openThinkIdx, 10);
            if (getVar("sent_thinking_sig") !== "true") {
                chunks.push("event: content_block_delta\ndata: " + JSON.stringify({
                    "type": "content_block_delta",
                    "index": stopThinkIdx,
                    "delta": { "type": "signature_delta", "signature": "gem_ts:none" }
                }));
            }
            remVar("sent_thinking_sig");
            chunks.push("event: content_block_stop\ndata: " + JSON.stringify({ "type": "content_block_stop", "index": stopThinkIdx }));
            remVar("open_thinking_block_idx");
        }
        var openToolIdxThink = getVar("open_tool_block_idx");
        if (openToolIdxThink) {
            chunks.push("event: content_block_stop\ndata: " + JSON.stringify({ "type": "content_block_stop", "index": parseInt(openToolIdxThink, 10) }));
            remVar("open_tool_block_idx");
        }
        var openTxtIdx = getVar("open_text_block_idx");
        if (openTxtIdx !== null) {
            chunks.push("event: content_block_stop\ndata: " + JSON.stringify({ "type": "content_block_stop", "index": parseInt(openTxtIdx, 10) }));
            remVar("open_text_block_idx");
        } else if (getVar("next_claude_block_idx") === null) {
            chunks.push("event: content_block_start\ndata: " + JSON.stringify({
                "type": "content_block_start",
                "index": 0,
                "content_block": { "type": "text", "text": "" }
            }));
            chunks.push("event: content_block_stop\ndata: " + JSON.stringify({ "type": "content_block_stop", "index": 0 }));
            setVar("next_claude_block_idx", "1");
        }
    } else {
        var openToolIdx = getVar("open_tool_block_idx");
        if (openToolIdx) {
            chunks.push("event: content_block_stop\ndata: " + JSON.stringify({ "type": "content_block_stop", "index": parseInt(openToolIdx, 10) }));
        }
        chunks.push("event: content_block_stop\ndata: " + JSON.stringify({ "type": "content_block_stop", "index": 0 }));
    }

    var prevStreamToolCount = parseInt(getVar("stream_tool_count") || "0", 10);
    var stopReasonMapped = "end_turn";
    if (stopReasonHint === "tool_use" || stopReasonHint === "tool_calls" || prevStreamToolCount > 0 || hadOpenToolIdx) {
        stopReasonMapped = "tool_use";
    } else if (stopReasonHint === "MAX_TOKENS" || stopReasonHint === "length") {
        stopReasonMapped = "max_tokens";
    } else if (isSafetyStopHint(stopReasonHint)) {
        stopReasonMapped = "refusal";
    }

    chunks.push("event: message_delta\ndata: " + JSON.stringify({
        "type": "message_delta",
        "delta": {
            "stop_reason": stopReasonMapped,
            "stop_sequence": null
        },
        "usage": {
            "input_tokens": uncachedIn,
            "cache_read_input_tokens": cacheRead,
            "cache_creation_input_tokens": 0,
            "output_tokens": outTokens
        }
    }));
    chunks.push("event: message_stop\ndata: " + JSON.stringify({ "type": "message_stop" }));
    return chunks;
}

function handleNativeGeminiFrame(parsedEvent, eventStr, tokensAlreadyCounted, frameState) {
    var eventText = "";
    var toolScanText = "";
    var isFinished = false;
    if (parsedEvent.usageMetadata) {
        var inT = parsedEvent.usageMetadata.promptTokenCount || 0;
        var cachedT = parsedEvent.usageMetadata.cachedContentTokenCount || 0;
        var outT = parsedEvent.usageMetadata.candidatesTokenCount || 0;
        var thoughtsT = parsedEvent.usageMetadata.thoughtsTokenCount || 0;
        if (inT > 0 || outT > 0 || cachedT > 0 || thoughtsT > 0) {
            setVar("saved_stream_prompt_tokens", String(inT));
            setVar("saved_stream_cached_tokens", String(cachedT));
            setVar("saved_stream_completion_tokens", String(outT));
            setVar("saved_stream_thinking_tokens", String(thoughtsT));
        }
    }

    var candidate = parsedEvent.candidates ? parsedEvent.candidates[0] : null;
    var nativeParts = (candidate && candidate.content && Array.isArray(candidate.content.parts))
                      ? candidate.content.parts
                      : null;
    if (nativeParts) {
        var nativeTxtArr = [];
        var nativeToolArr = [];
        for (var npIdx = 0; npIdx < nativeParts.length; npIdx++) {
            var np = nativeParts[npIdx];
            if (!np || np.thought === true) {
                continue;
            }
            if (np.text) {
                nativeTxtArr.push(np.text);
            }
            if (np.functionCall) {
                nativeToolArr.push((np.functionCall.name || "tool") + ": " + JSON.stringify(np.functionCall.args || {}));
            }
        }
        eventText = nativeTxtArr.join("");
        if (nativeToolArr.length > 0) {
            toolScanText = (eventText ? " " : "") + nativeToolArr.join(" ");
        }
    }
    recordStreamOutChars(eventText.length + toolScanText.length);
    var finishReason = candidate ? candidate.finishReason : null;
    if (finishReason || (candidate === null && parsedEvent.usageMetadata)) {
        isFinished = true;
    }

    updateArmorBuffer(eventText + toolScanText, isFinished);

    if (isFinished && !tokensAlreadyCounted) {
        var promptTokens = parseInt(getVar("saved_stream_prompt_tokens") || (parsedEvent.usageMetadata ? parsedEvent.usageMetadata.promptTokenCount : 0) || 0, 10);
        var geminiCachedTokens = parseInt(getVar("saved_stream_cached_tokens") || (parsedEvent.usageMetadata ? parsedEvent.usageMetadata.cachedContentTokenCount : 0) || 0, 10);
        var geminiUncachedPrompt = Math.max(0, promptTokens - geminiCachedTokens);
        var geminiCandidateTokens = parseInt(getVar("saved_stream_completion_tokens") || (parsedEvent.usageMetadata ? parsedEvent.usageMetadata.candidatesTokenCount : 0) || 0, 10);
        var geminiThinkingTokens = parseInt(getVar("saved_stream_thinking_tokens") || (parsedEvent.usageMetadata ? parsedEvent.usageMetadata.thoughtsTokenCount : 0) || 0, 10);
        emitStreamTokenVariables(geminiUncachedPrompt, geminiCachedTokens, 0, geminiCandidateTokens + geminiThinkingTokens, geminiThinkingTokens);
    }
    if (frameState.hasSecondData) {
        frameState.multiFrameOut.push("data: " + eventStr);
    }
    return isFinished;
}

function handleAnthropicToOpenAiFrame(parsedEvent, modelName, tokensAlreadyCounted, frameState) {
    var anthToolStart = null;
    var anthToolJsonDelta = null;
    var anthStopReason = null;
    var finishReason = null;
    var isFinished = false;
    var eventText = "";
    var toolScanText = "";

    if (parsedEvent.type === "message_start") {
        var msgStartUsage = (parsedEvent.message && parsedEvent.message.usage) ? parsedEvent.message.usage : {};
        if (msgStartUsage.input_tokens !== undefined) {
            setVar("saved_stream_uncached_prompt_tokens", String(msgStartUsage.input_tokens));
        }
        if (msgStartUsage.cache_read_input_tokens !== undefined) {
            setVar("saved_stream_cached_tokens", String(msgStartUsage.cache_read_input_tokens));
        }
        if (msgStartUsage.cache_creation_input_tokens !== undefined) {
            setVar("saved_stream_cache_write_tokens", String(msgStartUsage.cache_creation_input_tokens));
        }
        if (parsedEvent.message && parsedEvent.message.id) {
            setVar("stream_msg_id", parsedEvent.message.id.replace("msg_", "chatcmpl-"));
        }
    } else if (parsedEvent.type === "content_block_start") {
        if (parsedEvent.content_block && parsedEvent.content_block.type === "tool_use") {
            anthToolStart = parsedEvent.content_block;
            toolScanText = " " + (anthToolStart.name || "tool") + ": ";
        }
    } else if (parsedEvent.type === "content_block_delta") {
        if (parsedEvent.delta) {
            if (parsedEvent.delta.type === "input_json_delta" && parsedEvent.delta.partial_json !== undefined) {
                anthToolJsonDelta = parsedEvent.delta.partial_json;
                toolScanText = anthToolJsonDelta;
            } else if (parsedEvent.delta.type !== "thinking_delta" && parsedEvent.delta.text) {
                eventText = parsedEvent.delta.text;
            }
        }
    } else if (parsedEvent.type === "message_delta") {
        if (parsedEvent.usage) {
            if (parsedEvent.usage.input_tokens !== undefined) {
                setVar("saved_stream_uncached_prompt_tokens", String(parsedEvent.usage.input_tokens));
            }
            if (parsedEvent.usage.cache_read_input_tokens !== undefined) {
                setVar("saved_stream_cached_tokens", String(parsedEvent.usage.cache_read_input_tokens));
            }
            if (parsedEvent.usage.cache_creation_input_tokens !== undefined) {
                setVar("saved_stream_cache_write_tokens", String(parsedEvent.usage.cache_creation_input_tokens));
            }
            if (parsedEvent.usage.output_tokens !== undefined) {
                setVar("saved_stream_completion_tokens", String(parsedEvent.usage.output_tokens));
            }
        }
        anthStopReason = (parsedEvent.delta && parsedEvent.delta.stop_reason) ? parsedEvent.delta.stop_reason : null;
        finishReason = anthStopReason === "tool_use" ? "tool_calls" : (anthStopReason === "max_tokens" ? "length" : (isSafetyStopHint(anthStopReason) ? "content_filter" : "stop"));
        isFinished = true;
    } else if (parsedEvent.type === "message_stop") {
        isFinished = true;
    }
    recordStreamOutChars(eventText.length + toolScanText.length);

    var msgId = getVar("stream_msg_id") || ("chatcmpl-" + Math.random().toString(36).substring(2, 12));
    var oaiToolIdxRaw = (anthToolStart || anthToolJsonDelta !== null || isFinished) ? getVar("oai_tool_idx") : null;
    var outputChunks = [];
    var nowSec = Math.floor(Date.now() / 1000);

    if (eventText) {
        outputChunks.push("data: " + JSON.stringify({
            id: msgId,
            object: "chat.completion.chunk",
            created: nowSec,
            model: modelName,
            choices: [{ index: 0, delta: { content: eventText }, finish_reason: null }]
        }));
    }

    if (anthToolStart) {
        var nextToolIdx = oaiToolIdxRaw !== null ? (parseInt(oaiToolIdxRaw, 10) + 1) : 0;
        setVar("oai_tool_idx", String(nextToolIdx));
        oaiToolIdxRaw = String(nextToolIdx);
        var oaiStartTc = {
            index: nextToolIdx,
            id: anthToolStart.id || ("call_" + Math.random().toString(36).substring(2, 12)),
            type: "function",
            function: { name: anthToolStart.name || "tool", arguments: "" }
        };
        if (anthToolStart.thought_signature) {
            oaiStartTc.thought_signature = anthToolStart.thought_signature;
        }
        outputChunks.push("data: " + JSON.stringify({
            id: msgId,
            object: "chat.completion.chunk",
            created: nowSec,
            model: modelName,
            choices: [{ index: 0, delta: { tool_calls: [oaiStartTc] }, finish_reason: null }]
        }));
    } else if (anthToolJsonDelta !== null) {
        var activeToolIdx = oaiToolIdxRaw !== null ? parseInt(oaiToolIdxRaw, 10) : 0;
        outputChunks.push("data: " + JSON.stringify({
            id: msgId,
            object: "chat.completion.chunk",
            created: nowSec,
            model: modelName,
            choices: [{ index: 0, delta: { tool_calls: [{ index: activeToolIdx, function: { arguments: anthToolJsonDelta } }] }, finish_reason: null }]
        }));
    }

    if (!getVar("oai_sent_final") && (parsedEvent.type === "message_delta" || parsedEvent.type === "message_stop")) {
        setVar("oai_sent_final", "true");
        var finalFinishReason = finishReason || (oaiToolIdxRaw !== null ? "tool_calls" : "stop");
        if (oaiToolIdxRaw !== null && finalFinishReason === "stop") {
            finalFinishReason = "tool_calls";
        }
        outputChunks.push("data: " + JSON.stringify({
            id: msgId,
            object: "chat.completion.chunk",
            created: nowSec,
            model: modelName,
            choices: [{ index: 0, delta: {}, finish_reason: finalFinishReason }]
        }));
        outputChunks.push("data: [DONE]");
    }

    if (frameState.hasSecondData) {
        frameState.modifiedMultiFrame = true;
        for (var ocIdx = 0; ocIdx < outputChunks.length; ocIdx++) {
            frameState.multiFrameOut.push(outputChunks[ocIdx]);
        }
    } else {
        setVar("response.event.current.content", outputChunks.length > 0 ? (outputChunks.join("\n\n") + "\n\n") : "");
    }

    if (isFinished && !tokensAlreadyCounted) {
        var aUncached = parseInt(getVar("saved_stream_uncached_prompt_tokens") || "0", 10);
        var aCached = parseInt(getVar("saved_stream_cached_tokens") || "0", 10);
        var aCacheW = parseInt(getVar("saved_stream_cache_write_tokens") || "0", 10);
        var aOut = parseInt(getVar("saved_stream_completion_tokens") || "0", 10);
        emitStreamTokenVariables(aUncached, aCached, aCacheW, aOut, 0);
    }

    updateArmorBuffer(eventText + toolScanText, isFinished);
    return isFinished;
}

function handleGeminiToOpenAiFrame(parsedEvent, modelName, tokensAlreadyCounted, frameState) {
    var eventText = "";
    var toolScanText = "";
    var isFinished = false;

    if (parsedEvent.usageMetadata) {
        var gInT = parsedEvent.usageMetadata.promptTokenCount || 0;
        var gCachedT = parsedEvent.usageMetadata.cachedContentTokenCount || 0;
        var gOutT = parsedEvent.usageMetadata.candidatesTokenCount || 0;
        var gThoughtsT = parsedEvent.usageMetadata.thoughtsTokenCount || 0;
        if (gInT > 0 || gOutT > 0 || gCachedT > 0 || gThoughtsT > 0) {
            setVar("saved_stream_prompt_tokens", String(gInT));
            setVar("saved_stream_uncached_prompt_tokens", String(Math.max(0, gInT - gCachedT)));
            setVar("saved_stream_cached_tokens", String(gCachedT));
            setVar("saved_stream_completion_tokens", String(gOutT + gThoughtsT));
            setVar("saved_stream_thinking_tokens", String(gThoughtsT));
        }
    }
    var gCand = parsedEvent.candidates ? parsedEvent.candidates[0] : null;
    var gParts = (gCand && gCand.content && Array.isArray(gCand.content.parts)) ? gCand.content.parts : [];
    var gTxtParts = [];
    var gFuncCalls = [];
    for (var gpIdx = 0; gpIdx < gParts.length; gpIdx++) {
        var gp = gParts[gpIdx];
        if (!gp || gp.thought === true) {
            continue;
        }
        if (gp.text) {
            gTxtParts.push(gp.text);
        }
        if (gp.functionCall) {
            gFuncCalls.push({ fc: gp.functionCall, sig: gp.thoughtSignature || null });
        }
    }
    eventText = gTxtParts.join("");
    var finishReason = gCand ? gCand.finishReason : null;
    if (finishReason || (gCand === null && parsedEvent.usageMetadata)) {
        isFinished = true;
    }

    var gOutChunks = [];
    var gNowSec = Math.floor(Date.now() / 1000);
    var gMsgId = "chatcmpl-gem";
    var gPrevTcIdxStr = (gFuncCalls.length > 0 || isFinished) ? getVar("oai_gem_tool_idx") : null;
    var gToolCount = gPrevTcIdxStr !== null ? parseInt(gPrevTcIdxStr, 10) : 0;

    if (eventText) {
        gOutChunks.push("data: " + JSON.stringify({
            id: gMsgId,
            object: "chat.completion.chunk",
            created: gNowSec,
            model: modelName,
            choices: [{ index: 0, delta: { content: eventText }, finish_reason: null }]
        }));
    }
    if (gFuncCalls.length > 0) {
        var oaiDeltaTcs = [];
        var gToolScanParts = [];
        for (var gfcIdx = 0; gfcIdx < gFuncCalls.length; gfcIdx++) {
            var gfcWrap = gFuncCalls[gfcIdx];
            var gfc = gfcWrap.fc;
            var gfcArgsStr = JSON.stringify(gfc.args || {});
            gToolScanParts.push((gfc.name || "tool") + ": " + gfcArgsStr);
            var gTcEntry = {
                index: gToolCount,
                id: gfc.id || ("call_" + Math.random().toString(36).substring(2, 12)),
                type: "function",
                function: { name: gfc.name || "tool", arguments: gfcArgsStr }
            };
            if (gfcWrap.sig) {
                gTcEntry.thought_signature = gfcWrap.sig;
            }
            oaiDeltaTcs.push(gTcEntry);
            gToolCount++;
        }
        toolScanText = (eventText ? " " : "") + gToolScanParts.join(" ");
        setVar("oai_gem_tool_idx", String(gToolCount));
        gOutChunks.push("data: " + JSON.stringify({
            id: gMsgId,
            object: "chat.completion.chunk",
            created: gNowSec,
            model: modelName,
            choices: [{ index: 0, delta: { tool_calls: oaiDeltaTcs }, finish_reason: null }]
        }));
    }
    recordStreamOutChars(eventText.length + toolScanText.length);
    if (isFinished && !getVar("oai_sent_final")) {
        setVar("oai_sent_final", "true");
        var gFinish = gToolCount > 0 ? "tool_calls" : (finishReason === "MAX_TOKENS" ? "length" : (isSafetyStopHint(finishReason) ? "content_filter" : "stop"));
        gOutChunks.push("data: " + JSON.stringify({
            id: gMsgId,
            object: "chat.completion.chunk",
            created: gNowSec,
            model: modelName,
            choices: [{ index: 0, delta: {}, finish_reason: gFinish }]
        }));
        gOutChunks.push("data: [DONE]");
    }
    if (frameState.hasSecondData) {
        frameState.modifiedMultiFrame = true;
        for (var gcIdx = 0; gcIdx < gOutChunks.length; gcIdx++) {
            frameState.multiFrameOut.push(gOutChunks[gcIdx]);
        }
    } else {
        setVar("response.event.current.content", gOutChunks.length > 0 ? (gOutChunks.join("\n\n") + "\n\n") : "");
    }

    if (isFinished && !tokensAlreadyCounted) {
        var goCacheRead = parseInt(getVar("saved_stream_cached_tokens") || "0", 10);
        var goUncachedStr = getVar("saved_stream_uncached_prompt_tokens");
        var goUncached = goUncachedStr !== null
            ? parseInt(goUncachedStr, 10)
            : Math.max(0, parseInt(getVar("saved_stream_prompt_tokens") || "0", 10) - goCacheRead);
        var goThinking = parseInt(getVar("saved_stream_thinking_tokens") || "0", 10);
        var goComp = parseInt(getVar("saved_stream_completion_tokens") || "0", 10);
        emitStreamTokenVariables(goUncached, goCacheRead, 0, goComp, goThinking);
    }

    updateArmorBuffer(eventText + toolScanText, isFinished);
    return isFinished;
}

function handleNativeOpenAiFrame(parsedEvent, eventStr, tokensAlreadyCounted, frameState) {
    var isTrailingEmptyChoicesUsage = Boolean(parsedEvent.choices && parsedEvent.choices.length === 0 && parsedEvent.usage);
    var hasInlineCompleteUsage = false;
    var suppressOpenAiFrame = false;
    var isFinished = false;
    var toolScanText = "";

    if (parsedEvent.usage) {
        var inT = parsedEvent.usage.prompt_tokens || 0;
        var cachedT = (parsedEvent.usage.prompt_tokens_details && parsedEvent.usage.prompt_tokens_details.cached_tokens) || 0;
        var outT = parsedEvent.usage.completion_tokens || 0;
        var reasoningT = (parsedEvent.usage.completion_tokens_details && parsedEvent.usage.completion_tokens_details.reasoning_tokens) || 0;
        if (inT > 0 || outT > 0 || cachedT > 0 || reasoningT > 0) {
            setVar("saved_stream_prompt_tokens", String(inT));
            setVar("saved_stream_uncached_prompt_tokens", String(Math.max(0, inT - cachedT)));
            setVar("saved_stream_cached_tokens", String(cachedT));
            setVar("saved_stream_completion_tokens", String(outT));
            setVar("saved_stream_thinking_tokens", String(reasoningT));
        }
        if (outT > 0 || (parsedEvent.usage.total_tokens || 0) > 0) {
            hasInlineCompleteUsage = true;
        }
    }

    var choice = parsedEvent.choices ? parsedEvent.choices[0] : null;
    var eventText = (choice && choice.delta) ? (choice.delta.content || "") : "";
    if (choice && choice.delta && Array.isArray(choice.delta.tool_calls)) {
        var oaiNatTcScan = [];
        for (var ntcIdx = 0; ntcIdx < choice.delta.tool_calls.length; ntcIdx++) {
            var ntc = choice.delta.tool_calls[ntcIdx];
            if (ntc && ntc.function) {
                if (ntc.function.name) {
                    oaiNatTcScan.push(" " + ntc.function.name + ": ");
                }
                if (ntc.function.arguments) {
                    oaiNatTcScan.push(ntc.function.arguments);
                }
            }
        }
        toolScanText = oaiNatTcScan.join("");
    }
    recordStreamOutChars(eventText.length + toolScanText.length);
    var finishReason = choice ? choice.finish_reason : null;
    if (finishReason || isTrailingEmptyChoicesUsage) {
        isFinished = true;
    }

    var readyToEmitOaiUsage = isTrailingEmptyChoicesUsage || (Boolean(finishReason) && hasInlineCompleteUsage);
    if (Boolean(finishReason) && !readyToEmitOaiUsage) {
        setVar("oai_awaiting_usage", "true");
    }

    if (readyToEmitOaiUsage && !tokensAlreadyCounted) {
        var oaiCacheRead = parseInt(getVar("saved_stream_cached_tokens") || "0", 10);
        var oaiCacheWrite = parseInt(getVar("saved_stream_cache_write_tokens") || "0", 10);
        var savedUncachedStr = getVar("saved_stream_uncached_prompt_tokens");
        var oaiUncachedIn = savedUncachedStr !== null
            ? parseInt(savedUncachedStr, 10)
            : Math.max(0, parseInt(getVar("saved_stream_prompt_tokens") || (parsedEvent.usage ? parsedEvent.usage.prompt_tokens : 0) || "0", 10) - oaiCacheRead - oaiCacheWrite);
        var oaiThinking = parseInt(getVar("saved_stream_thinking_tokens") || "0", 10);
        var completionTokens = parseInt(getVar("saved_stream_completion_tokens") || (parsedEvent.usage ? parsedEvent.usage.completion_tokens : 0) || "0", 10);
        emitStreamTokenVariables(oaiUncachedIn, oaiCacheRead, oaiCacheWrite, completionTokens, oaiThinking);
    }

    if (isTrailingEmptyChoicesUsage && getVar("client_requested_include_usage") !== "true") {
        suppressOpenAiFrame = true;
        if (frameState.hasSecondData) {
            frameState.modifiedMultiFrame = true;
        } else {
            setVar("response.event.current.content", "");
        }
    } else if (frameState.hasSecondData) {
        frameState.multiFrameOut.push("data: " + eventStr);
    }

    updateArmorBuffer(eventText + toolScanText, isFinished && !suppressOpenAiFrame);
    return isFinished;
}

function handleNativeClaudeFrame(parsedEvent, eventStr, tokensAlreadyCounted, frameState) {
    var eventText = "";
    var toolScanText = "";
    var isFinished = false;

    if (parsedEvent.type === "content_block_start" && parsedEvent.content_block && parsedEvent.content_block.type === "tool_use") {
        toolScanText = " " + (parsedEvent.content_block.name || "tool") + ": ";
    } else if (parsedEvent.delta) {
        if (parsedEvent.delta.type === "input_json_delta" && parsedEvent.delta.partial_json !== undefined) {
            toolScanText = parsedEvent.delta.partial_json;
        } else if (parsedEvent.delta.type !== "thinking_delta" && parsedEvent.delta.text !== undefined) {
            eventText = parsedEvent.delta.text;
        }
    }
    recordStreamOutChars(eventText.length + toolScanText.length);

    var claudeUsage = parsedEvent.usage || (parsedEvent.message && parsedEvent.message.usage);
    if (claudeUsage) {
        if (claudeUsage.input_tokens !== undefined) {
            setVar("saved_stream_uncached_prompt_tokens", String(claudeUsage.input_tokens));
        }
        if (claudeUsage.cache_read_input_tokens !== undefined) {
            setVar("saved_stream_cached_tokens", String(claudeUsage.cache_read_input_tokens));
        }
        if (claudeUsage.cache_creation_input_tokens !== undefined) {
            setVar("saved_stream_cache_write_tokens", String(claudeUsage.cache_creation_input_tokens));
        }
        if (claudeUsage.output_tokens !== undefined) {
            setVar("saved_stream_completion_tokens", String(claudeUsage.output_tokens));
        }
    }

    if (parsedEvent.type === "message_delta" || parsedEvent.type === "message_stop") {
        isFinished = true;
    }

    if (isFinished && !tokensAlreadyCounted) {
        var claudeUncachedIn = parseInt(getVar("saved_stream_uncached_prompt_tokens") || (claudeUsage ? claudeUsage.input_tokens : 0) || "0", 10);
        var claudeCacheRead = parseInt(getVar("saved_stream_cached_tokens") || (claudeUsage ? claudeUsage.cache_read_input_tokens : 0) || "0", 10);
        var claudeCacheWrite = parseInt(getVar("saved_stream_cache_write_tokens") || (claudeUsage ? claudeUsage.cache_creation_input_tokens : 0) || "0", 10);
        var completionTokens = parseInt(getVar("saved_stream_completion_tokens") || (claudeUsage ? claudeUsage.output_tokens : 0) || "0", 10);
        emitStreamTokenVariables(claudeUncachedIn, claudeCacheRead, claudeCacheWrite, completionTokens, 0);
    }
    if (frameState.hasSecondData) {
        frameState.multiFrameOut.push("data: " + eventStr);
    }

    updateArmorBuffer(eventText + toolScanText, isFinished);
    return isFinished;
}

function appendClaudeThinkingAndTextChunks(outputChunks, wantThinkingStream, streamThoughts, eventText) {
    if (wantThinkingStream) {
        if (streamThoughts.length > 0) {
            var openTxtBeforeThink = getVar("open_text_block_idx");
            if (openTxtBeforeThink !== null) {
                outputChunks.push("event: content_block_stop\ndata: " + JSON.stringify({ "type": "content_block_stop", "index": parseInt(openTxtBeforeThink, 10) }));
                remVar("open_text_block_idx");
            }
            var thinkIdxStr = getVar("open_thinking_block_idx");
            if (thinkIdxStr === null) {
                var allocThinkIdx = parseInt(getVar("next_claude_block_idx") || "0", 10);
                setVar("next_claude_block_idx", String(allocThinkIdx + 1));
                thinkIdxStr = String(allocThinkIdx);
                setVar("open_thinking_block_idx", thinkIdxStr);
                outputChunks.push("event: content_block_start\ndata: " + JSON.stringify({
                    "type": "content_block_start",
                    "index": allocThinkIdx,
                    "content_block": { "type": "thinking", "thinking": "" }
                }));
            }
            var activeThinkIdx = parseInt(thinkIdxStr, 10);
            for (var stIdx = 0; stIdx < streamThoughts.length; stIdx++) {
                var stItem = streamThoughts[stIdx];
                if (stItem.text) {
                    outputChunks.push("event: content_block_delta\ndata: " + JSON.stringify({
                        "type": "content_block_delta",
                        "index": activeThinkIdx,
                        "delta": { "type": "thinking_delta", "thinking": stItem.text }
                    }));
                }
                if (stItem.sig) {
                    var taggedStreamSig = stItem.sig.indexOf("gem_ts:") === 0 ? stItem.sig : ("gem_ts:" + stItem.sig);
                    setVar("sent_thinking_sig", "true");
                    outputChunks.push("event: content_block_delta\ndata: " + JSON.stringify({
                        "type": "content_block_delta",
                        "index": activeThinkIdx,
                        "delta": { "type": "signature_delta", "signature": taggedStreamSig }
                    }));
                }
            }
        }
        if (eventText) {
            var openThinkBeforeTxt = getVar("open_thinking_block_idx");
            if (openThinkBeforeTxt !== null) {
                var closeThinkIdx = parseInt(openThinkBeforeTxt, 10);
                if (getVar("sent_thinking_sig") !== "true") {
                    outputChunks.push("event: content_block_delta\ndata: " + JSON.stringify({
                        "type": "content_block_delta",
                        "index": closeThinkIdx,
                        "delta": { "type": "signature_delta", "signature": "gem_ts:none" }
                    }));
                }
                remVar("sent_thinking_sig");
                outputChunks.push("event: content_block_stop\ndata: " + JSON.stringify({ "type": "content_block_stop", "index": closeThinkIdx }));
                remVar("open_thinking_block_idx");
            }
            var txtIdxStr = getVar("open_text_block_idx");
            if (txtIdxStr === null) {
                var allocTxtIdx = parseInt(getVar("next_claude_block_idx") || "0", 10);
                setVar("next_claude_block_idx", String(allocTxtIdx + 1));
                txtIdxStr = String(allocTxtIdx);
                setVar("open_text_block_idx", txtIdxStr);
                outputChunks.push("event: content_block_start\ndata: " + JSON.stringify({
                    "type": "content_block_start",
                    "index": allocTxtIdx,
                    "content_block": { "type": "text", "text": "" }
                }));
            }
            outputChunks.push("event: content_block_delta\ndata: " + JSON.stringify({
                "type": "content_block_delta",
                "index": parseInt(txtIdxStr, 10),
                "delta": { "type": "text_delta", "text": eventText }
            }));
        }
    } else if (eventText) {
        outputChunks.push("event: content_block_delta\ndata: " + JSON.stringify({
            "type": "content_block_delta",
            "index": 0,
            "delta": { "type": "text_delta", "text": eventText }
        }));
    }
}

function closeOpenClaudeThinkingAndTextBlocks(outputChunks) {
    var openThink = getVar("open_thinking_block_idx");
    if (openThink !== null) {
        var openThinkNum = parseInt(openThink, 10);
        if (getVar("sent_thinking_sig") !== "true") {
            outputChunks.push("event: content_block_delta\ndata: " + JSON.stringify({
                "type": "content_block_delta",
                "index": openThinkNum,
                "delta": { "type": "signature_delta", "signature": "gem_ts:none" }
            }));
        }
        remVar("sent_thinking_sig");
        outputChunks.push("event: content_block_stop\ndata: " + JSON.stringify({ "type": "content_block_stop", "index": openThinkNum }));
        remVar("open_thinking_block_idx");
    }
    var openTxt = getVar("open_text_block_idx");
    if (openTxt !== null) {
        outputChunks.push("event: content_block_stop\ndata: " + JSON.stringify({ "type": "content_block_stop", "index": parseInt(openTxt, 10) }));
        remVar("open_text_block_idx");
    }
}

function handleTranscodedToClaudeFrame(parsedEvent, modelName, tokensAlreadyCounted, frameState) {
    var wantThinkingStream = (getVar("anthropic_thinking_requested") === "true");
    var streamThoughts = [];
    var streamFuncCalls = [];
    var isOpenAiBackend = false;
    var hasInlineOaiUsage = false;
    var isTrailingUsageChunk = Boolean(parsedEvent.choices && parsedEvent.choices.length === 0 && parsedEvent.usage);
    var isFinished = false;
    var finishReason = null;
    var eventText = "";
    var toolScanText = "";
    var choice = null;

    if (!parsedEvent.choices && (parsedEvent.candidates || parsedEvent.usageMetadata || targetName === "gemini" || routeFormat === "gemini")) {
        var candidate = parsedEvent.candidates ? parsedEvent.candidates[0] : null;
        var parts = (candidate && candidate.content && Array.isArray(candidate.content.parts)) ? candidate.content.parts : null;
        if (parts) {
            var gemVisibleTexts = [];
            var gemToolScans = [];
            for (var pIdx = 0; pIdx < parts.length; pIdx++) {
                var pItem = parts[pIdx];
                if (!pItem) {
                    continue;
                }
                if (pItem.thought === true) {
                    if (wantThinkingStream && (pItem.text || pItem.thoughtSignature)) {
                        streamThoughts.push({ text: pItem.text || "", sig: pItem.thoughtSignature || "" });
                    }
                    continue;
                }
                if (pItem.text) {
                    gemVisibleTexts.push(pItem.text);
                }
                if (pItem.functionCall) {
                    streamFuncCalls.push({ fc: pItem.functionCall, sig: pItem.thoughtSignature || null });
                    gemToolScans.push((pItem.functionCall.name || "tool") + ": " + JSON.stringify(pItem.functionCall.args || {}));
                }
            }
            eventText = gemVisibleTexts.join("");
            if (gemToolScans.length > 0) {
                toolScanText = (eventText ? " " : "") + gemToolScans.join(" ");
            }
        }
        finishReason = candidate ? candidate.finishReason : null;

        if (parsedEvent.usageMetadata) {
            var inT = parsedEvent.usageMetadata.promptTokenCount || 0;
            var cachedT = parsedEvent.usageMetadata.cachedContentTokenCount || 0;
            var outT = parsedEvent.usageMetadata.candidatesTokenCount || 0;
            var thoughtsT = parsedEvent.usageMetadata.thoughtsTokenCount || 0;
            if (inT > 0 || outT > 0 || cachedT > 0 || thoughtsT > 0) {
                setVar("saved_stream_prompt_tokens", String(inT));
                setVar("saved_stream_uncached_prompt_tokens", String(Math.max(0, inT - cachedT)));
                setVar("saved_stream_cached_tokens", String(cachedT));
                setVar("saved_stream_completion_tokens", String(outT + thoughtsT));
                setVar("saved_stream_thinking_tokens", String(thoughtsT));
            }
        }
        if (finishReason || (candidate === null && parsedEvent.usageMetadata)) {
            isFinished = true;
        }
    } else {
        isOpenAiBackend = true;
        choice = parsedEvent.choices ? parsedEvent.choices[0] : null;
        eventText = (choice && choice.delta) ? (choice.delta.content || "") : "";
        finishReason = choice ? choice.finish_reason : null;

        if (parsedEvent.usage) {
            var oInT = parsedEvent.usage.prompt_tokens || 0;
            var oCachedT = (parsedEvent.usage.prompt_tokens_details && parsedEvent.usage.prompt_tokens_details.cached_tokens) || 0;
            var oOutT = parsedEvent.usage.completion_tokens || 0;
            var oReasoningT = (parsedEvent.usage.completion_tokens_details && parsedEvent.usage.completion_tokens_details.reasoning_tokens) || 0;
            if (oInT > 0 || oOutT > 0 || oCachedT > 0 || oReasoningT > 0) {
                setVar("saved_stream_prompt_tokens", String(oInT));
                setVar("saved_stream_uncached_prompt_tokens", String(Math.max(0, oInT - oCachedT)));
                setVar("saved_stream_cached_tokens", String(oCachedT));
                setVar("saved_stream_completion_tokens", String(oOutT));
                setVar("saved_stream_thinking_tokens", String(oReasoningT));
            }
            if (oOutT > 0 || (parsedEvent.usage.total_tokens || 0) > 0) {
                hasInlineOaiUsage = true;
            }
        }
        if (finishReason || isTrailingUsageChunk) {
            isFinished = true;
        }
        modelName = parsedEvent.model || modelName;
    }

    var sentStart = getVar("sent_message_start");
    var transCacheRead = 0;
    var transUncachedIn = 0;
    var transThinking = 0;
    var completionTokens = 0;
    if (!sentStart || isFinished || isTrailingUsageChunk) {
        transCacheRead = parseInt(getVar("saved_stream_cached_tokens") || "0", 10);
        var transUncachedInStr = getVar("saved_stream_uncached_prompt_tokens");
        transUncachedIn = transUncachedInStr !== null
            ? parseInt(transUncachedInStr, 10)
            : Math.max(0, parseInt(getVar("saved_stream_prompt_tokens") || "0", 10) - transCacheRead);
        transThinking = parseInt(getVar("saved_stream_thinking_tokens") || "0", 10);
        completionTokens = parseInt(getVar("saved_stream_completion_tokens") || "0", 10);
    }

    var outputChunks = [];
    var msgId = parsedEvent.id ? parsedEvent.id.replace("chatcmpl-", "msg_") : "msg_stream";

    if (!sentStart) {
        setVar("sent_message_start", "true");
        outputChunks.push("event: message_start\ndata: " + JSON.stringify({
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
                    "input_tokens": transUncachedIn,
                    "cache_read_input_tokens": transCacheRead,
                    "cache_creation_input_tokens": 0,
                    "output_tokens": 0
                }
            }
        }));
        if (!wantThinkingStream) {
            outputChunks.push("event: content_block_start\ndata: " + JSON.stringify({
                "type": "content_block_start",
                "index": 0,
                "content_block": { "type": "text", "text": "" }
            }));
        }
    }

    appendClaudeThinkingAndTextChunks(outputChunks, wantThinkingStream, streamThoughts, eventText);

    var prevStreamToolCount = (streamFuncCalls.length > 0 || isFinished) ? parseInt(getVar("stream_tool_count") || "0", 10) : 0;
    var openAiToolCalls = (choice && choice.delta && Array.isArray(choice.delta.tool_calls)) ? choice.delta.tool_calls : null;
    if (streamFuncCalls.length > 0) {
        if (wantThinkingStream) {
            closeOpenClaudeThinkingAndTextBlocks(outputChunks);
        }
        for (var sfcIdx = 0; sfcIdx < streamFuncCalls.length; sfcIdx++) {
            var sfcWrap = streamFuncCalls[sfcIdx];
            var streamFuncCall = sfcWrap.fc;
            prevStreamToolCount++;
            var gemBlockIdx;
            if (wantThinkingStream) {
                gemBlockIdx = parseInt(getVar("next_claude_block_idx") || "0", 10);
                setVar("next_claude_block_idx", String(gemBlockIdx + 1));
            } else {
                gemBlockIdx = prevStreamToolCount;
            }
            var toolCallId = streamFuncCall.id || ("toolu_" + Math.random().toString(36).substring(2, 12));
            var gemToolBlock = { "type": "tool_use", "id": toolCallId, "name": streamFuncCall.name, "input": {} };
            if (sfcWrap.sig) {
                gemToolBlock.thought_signature = sfcWrap.sig;
            }
            outputChunks.push("event: content_block_start\ndata: " + JSON.stringify({
                "type": "content_block_start",
                "index": gemBlockIdx,
                "content_block": gemToolBlock
            }));
            outputChunks.push("event: content_block_delta\ndata: " + JSON.stringify({
                "type": "content_block_delta",
                "index": gemBlockIdx,
                "delta": { "type": "input_json_delta", "partial_json": JSON.stringify(streamFuncCall.args || {}) }
            }));
            outputChunks.push("event: content_block_stop\ndata: " + JSON.stringify({ "type": "content_block_stop", "index": gemBlockIdx }));
        }
        setVar("stream_tool_count", String(prevStreamToolCount));
        finishReason = "tool_use";
    } else if (openAiToolCalls && openAiToolCalls.length > 0) {
        if (wantThinkingStream) {
            closeOpenClaudeThinkingAndTextBlocks(outputChunks);
            if (getVar("next_claude_block_idx") === null) {
                setVar("next_claude_block_idx", "1");
            }
        }
        var oaiToClaudeScans = [];
        for (var tcIdx = 0; tcIdx < openAiToolCalls.length; tcIdx++) {
            var oaiTc = openAiToolCalls[tcIdx];
            var blockIndex = (oaiTc.index !== undefined ? oaiTc.index : tcIdx) + 1;
            if (oaiTc.function && oaiTc.function.name) {
                var prevOpenIdx = getVar("open_tool_block_idx");
                if (prevOpenIdx && parseInt(prevOpenIdx, 10) !== blockIndex) {
                    outputChunks.push("event: content_block_stop\ndata: " + JSON.stringify({ "type": "content_block_stop", "index": parseInt(prevOpenIdx, 10) }));
                }
                oaiToClaudeScans.push(" " + oaiTc.function.name + ": ");
                var oaiToolStartBlock = {
                    "type": "tool_use",
                    "id": oaiTc.id || ("toolu_" + Math.random().toString(36).substring(2, 12)),
                    "name": oaiTc.function.name,
                    "input": {}
                };
                if (oaiTc.thought_signature) {
                    oaiToolStartBlock.thought_signature = oaiTc.thought_signature;
                }
                outputChunks.push("event: content_block_start\ndata: " + JSON.stringify({
                    "type": "content_block_start",
                    "index": blockIndex,
                    "content_block": oaiToolStartBlock
                }));
                setVar("open_tool_block_idx", String(blockIndex));
            }
            if (oaiTc.function && oaiTc.function.arguments) {
                oaiToClaudeScans.push(oaiTc.function.arguments);
                outputChunks.push("event: content_block_delta\ndata: " + JSON.stringify({
                    "type": "content_block_delta",
                    "index": blockIndex,
                    "delta": { "type": "input_json_delta", "partial_json": oaiTc.function.arguments }
                }));
            }
        }
        toolScanText = oaiToClaudeScans.join("");
    }
    recordStreamOutChars(eventText.length + toolScanText.length);

    var sentStop = getVar("sent_message_stop") === "true";
    var deferClaudeStopForUsage = Boolean(isOpenAiBackend && finishReason && !hasInlineOaiUsage && !isTrailingUsageChunk);
    if (deferClaudeStopForUsage) {
        setVar("pending_oai_finish_reason", finishReason);
        setVar("oai_awaiting_usage", "true");
    }

    var readyForClaudeStop = (isFinished && !deferClaudeStopForUsage) || isTrailingUsageChunk;
    if (readyForClaudeStop && !sentStop) {
        setVar("sent_message_stop", "true");
        var effectiveStopHint = finishReason || getVar("pending_oai_finish_reason") || "end_turn";
        var stopChunks = buildDeferredClaudeStopChunks(effectiveStopHint, transUncachedIn, transCacheRead, completionTokens);
        for (var scIdx = 0; scIdx < stopChunks.length; scIdx++) {
            outputChunks.push(stopChunks[scIdx]);
        }
    }

    if (readyForClaudeStop && !tokensAlreadyCounted) {
        emitStreamTokenVariables(transUncachedIn, transCacheRead, 0, completionTokens, transThinking);
    }

    if (frameState.hasSecondData) {
        frameState.modifiedMultiFrame = true;
        for (var ccIdx = 0; ccIdx < outputChunks.length; ccIdx++) {
            frameState.multiFrameOut.push(outputChunks[ccIdx]);
        }
    } else {
        setVar("response.event.current.content", outputChunks.length > 0 ? (outputChunks.join("\n\n") + "\n\n") : "");
    }

    updateArmorBuffer(eventText + toolScanText, isFinished);
    return isFinished;
}

function handleDoneSentinelFrame(frameState) {
    if (getVar("concurrency_slot_released") !== "true") {
        setVar("release_concurrency_slot", "true");
        setVar("concurrency_slot_released", "true");
    }
    updateArmorBuffer("", true);

    var reqFmt = getVar("request_format") || "claude";
    var pendingFinish = getVar("pending_oai_finish_reason");

    if (getVar("stream_tokens_already_counted") !== "true") {
        var outChars = parseInt(getVar("stream_out_chars") || "0", 10);
        if (getVar("oai_awaiting_usage") === "true" || outChars > 0) {
            var fbCacheRead = parseInt(getVar("saved_stream_cached_tokens") || "0", 10);
            var fbCacheWrite = parseInt(getVar("saved_stream_cache_write_tokens") || "0", 10);
            var fbUncachedStr = getVar("saved_stream_uncached_prompt_tokens");
            var fbUncached = fbUncachedStr !== null
                ? parseInt(fbUncachedStr, 10)
                : Math.max(0, parseInt(getVar("saved_stream_prompt_tokens") || "0", 10) - fbCacheRead - fbCacheWrite);
            var fbComp = parseInt(getVar("saved_stream_completion_tokens") || "0", 10);
            var fbThink = parseInt(getVar("saved_stream_thinking_tokens") || "0", 10);
            if ((fbUncached + fbCacheRead + fbCacheWrite + fbComp) === 0) {
                var pChars = parseInt(getVar("prompt_char_len") || "0", 10);
                fbUncached = Math.max(1, Math.ceil(pChars / 4));
                fbComp = Math.max(1, Math.ceil(Math.max(1, outChars) / 4));
            }
            emitStreamTokenVariables(fbUncached, fbCacheRead, fbCacheWrite, fbComp, fbThink);
        }
    }

    if (reqFmt !== "openai" && targetName !== "claude" && routeFormat !== "anthropic") {
        if (reqFmt === "claude" && pendingFinish && getVar("sent_message_stop") !== "true") {
            setVar("sent_message_stop", "true");
            var doneUncached = parseInt(getVar("uncached_prompt_tokens") || getVar("saved_stream_uncached_prompt_tokens") || "0", 10);
            var doneCached = parseInt(getVar("cache_read_tokens") || getVar("saved_stream_cached_tokens") || "0", 10);
            var doneComp = parseInt(getVar("completion_tokens") || getVar("saved_stream_completion_tokens") || "0", 10);
            var doneStopChunks = buildDeferredClaudeStopChunks(pendingFinish, doneUncached, doneCached, doneComp);
            if (frameState.hasSecondData) {
                frameState.modifiedMultiFrame = true;
                for (var dsIdx = 0; dsIdx < doneStopChunks.length; dsIdx++) {
                    frameState.multiFrameOut.push(doneStopChunks[dsIdx]);
                }
            } else {
                setVar("response.event.current.content", doneStopChunks.join("\n\n") + "\n\n");
            }
        } else if (frameState.hasSecondData) {
            frameState.modifiedMultiFrame = true;
        } else {
            setVar("response.event.current.content", "");
        }
    } else if (frameState.hasSecondData) {
        frameState.multiFrameOut.push("data: [DONE]");
    }
}

var dataIdx = rawContent ? rawContent.indexOf("data:") : -1;
if (rawContent && dataIdx !== -1) {
    var hasSecondData = rawContent.indexOf("\ndata:", dataIdx + 5) !== -1 || rawContent.indexOf("\r\ndata:", dataIdx + 5) !== -1;
    var dataPayloads = [];
    if (!hasSecondData) {
        dataPayloads.push(rawContent.substring(dataIdx + 5).trim());
    } else {
        var rawBlocks = rawContent.split(/\r?\n\r?\n/);
        for (var bIdx = 0; bIdx < rawBlocks.length; bIdx++) {
            var blk = rawBlocks[bIdx];
            var dPos = blk.indexOf("data:");
            if (dPos !== -1) {
                dataPayloads.push(blk.substring(dPos + 5).trim());
            }
        }
    }

    var frameState = {
        hasSecondData: hasSecondData,
        multiFrameOut: [],
        modifiedMultiFrame: false
    };

    for (var fIdx = 0; fIdx < dataPayloads.length; fIdx++) {
        var eventStr = dataPayloads[fIdx];
        if (!eventStr) {
            continue;
        }
        if (eventStr === "[DONE]") {
            handleDoneSentinelFrame(frameState);
        } else {
            try {
                var parsedEvent = JSON.parse(eventStr);
                var requestFormat = getVar("request_format") || "claude";
                var tokensAlreadyCounted = getVar("stream_tokens_already_counted") === "true";
                var rawModel = getVar("model");
                var isFinished = false;

                if (requestFormat === "gemini") {
                    isFinished = handleNativeGeminiFrame(parsedEvent, eventStr, tokensAlreadyCounted, frameState);
                } else if (requestFormat === "openai") {
                    var oaiModelName = rawModel || "claude";
                    if (!parsedEvent.choices && !parsedEvent.candidates && (targetName === "claude" || routeFormat === "anthropic" || parsedEvent.type)) {
                        isFinished = handleAnthropicToOpenAiFrame(parsedEvent, oaiModelName, tokensAlreadyCounted, frameState);
                    } else if (!parsedEvent.choices && (parsedEvent.candidates || parsedEvent.usageMetadata || targetName === "gemini")) {
                        isFinished = handleGeminiToOpenAiFrame(parsedEvent, oaiModelName, tokensAlreadyCounted, frameState);
                    } else {
                        isFinished = handleNativeOpenAiFrame(parsedEvent, eventStr, tokensAlreadyCounted, frameState);
                    }
                } else {
                    var claudeModelName = rawModel || "unknown";
                    if (targetName === "claude" || routeFormat === "anthropic") {
                        isFinished = handleNativeClaudeFrame(parsedEvent, eventStr, tokensAlreadyCounted, frameState);
                    } else {
                        isFinished = handleTranscodedToClaudeFrame(parsedEvent, claudeModelName, tokensAlreadyCounted, frameState);
                    }
                }

                if (isFinished && getVar("concurrency_slot_released") !== "true") {
                    setVar("release_concurrency_slot", "true");
                    setVar("concurrency_slot_released", "true");
                }
            } catch (e) {
                print("JSON Error: " + e);
            }
        }
    }

    if (getVar("stream_prompt_checkpointed") === null && getVar("stream_tokens_already_counted") !== "true") {
        if (getVar("propertyset.config.stream_prompt_checkpoint") !== "true") {
            setVar("stream_prompt_checkpointed", "skip");
        } else if (getVar("saved_stream_uncached_prompt_tokens") !== null || getVar("saved_stream_prompt_tokens") !== null || getVar("saved_stream_cached_tokens") !== null || getVar("saved_stream_cache_write_tokens") !== null) {
            var ckptCacheRead = parseInt(getVar("saved_stream_cached_tokens") || "0", 10);
            var ckptCacheWrite = parseInt(getVar("saved_stream_cache_write_tokens") || "0", 10);
            var ckptUncachedStr = getVar("saved_stream_uncached_prompt_tokens");
            var ckptUncached = ckptUncachedStr !== null
                ? parseInt(ckptUncachedStr, 10)
                : Math.max(0, parseInt(getVar("saved_stream_prompt_tokens") || "0", 10) - ckptCacheRead - ckptCacheWrite);
            if ((ckptUncached + ckptCacheRead + ckptCacheWrite) > 0) {
                emitStreamTokenVariables(ckptUncached, ckptCacheRead, ckptCacheWrite, 0, 0, true);
            }
        }
    }

    if (frameState.hasSecondData && frameState.modifiedMultiFrame) {
        setVar("response.event.current.content", frameState.multiFrameOut.length > 0 ? (frameState.multiFrameOut.join("\n\n") + "\n\n") : "");
    }
}

})();
