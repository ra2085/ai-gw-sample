/*
 * Copyright 2027 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package com.google.apigee.callouts;

import com.apigee.flow.execution.ExecutionContext;
import com.apigee.flow.execution.ExecutionResult;
import com.apigee.flow.message.MessageContext;
import com.google.apigee.callouts.util.GlobMatcher;
import com.google.apigee.callouts.util.StrictJson;
import com.google.apigee.callouts.util.VarCache;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ThreadLocalRandom;

/**
 * Stateless, thread-safe Java Callout consolidating the 4 response transcoding, token extraction,
 * and invoice-accurate monetization calculation scripts:
 * <ul>
 *   <li>{@code gemini_to_anthropic_resp} (replaces {@code gemini_to_anthropic_resp.js})</li>
 *   <li>{@code anthropic_to_openai_resp} (replaces {@code anthropic_to_openai_resp.js})</li>
 *   <li>{@code calculate_tokens_non_streaming} (replaces {@code calculate_tokens_non_streaming.js})</li>
 *   <li>{@code calculate_monetization_cost} (replaces {@code calculate_monetization_cost.js})</li>
 * </ul>
 */
public final class ResponseTranscoderAndCostCallout extends BaseCallout {

  public ResponseTranscoderAndCostCallout(Map properties) {
    super(properties);
  }

  @Override
  public String getVarprefix() {
    return "resp_callout_";
  }

  @Override
  public ExecutionResult execute(MessageContext msgCtxt, ExecutionContext exeCtxt) {
    VarCache vars = new VarCache(msgCtxt).withFallbackProperties(this.staticPropertySets);
    String action = resolveAction(msgCtxt, "calculate_tokens_non_streaming");
    try {
      switch (action) {
        case "gemini_to_anthropic_resp":
          executeGeminiToAnthropicResp(vars);
          break;
        case "anthropic_to_openai_resp":
          executeAnthropicToOpenAiResp(vars);
          break;
        case "gemini_to_openai_resp":
          executeGeminiToOpenAiResp(vars);
          break;
        case "calculate_tokens_non_streaming":
          executeCalculateTokensNonStreaming(vars);
          break;
        case "calculate_monetization_cost":
          executeCalculateMonetizationCost(vars);
          break;
        default:
          throw new IllegalStateException("Unsupported ResponseTranscoderAndCostCallout action: " + action);
      }
      return ExecutionResult.SUCCESS;
    } catch (Exception e) {
      setExceptionVariables(e, msgCtxt);
      if ("calculate_monetization_cost".equals(action)) {
        vars.set("tx_cost_usd", "0.000000");
        vars.set("tx_cost_micro_usd", "0");
        vars.set("tx_prompt_cost_usd", "0.000000");
        vars.set("tx_uncached_prompt_cost_usd", "0.000000");
        vars.set("tx_cache_read_cost_usd", "0.000000");
        vars.set("tx_cache_write_cost_usd", "0.000000");
        vars.set("tx_completion_cost_usd", "0.000000");
        vars.set("primary_quota_usage", "0");
        vars.set("secondary_quota_usage", "0");
        vars.set("perUnitPriceMultiplier", "0.000000");
        vars.set("transactionSuccess", "false");
      }
      vars.set("callout_aborted", "true");
      vars.set("auth_error_status", "502");
      Map<String, Object> errOuter = new LinkedHashMap<>();
      Map<String, Object> errInner = new LinkedHashMap<>();
      errInner.put("type", "api_error");
      errInner.put("message", "Invalid or malformed upstream model response.");
      errInner.put("code", 502L);
      errOuter.put("error", errInner);
      vars.set("auth_error_payload", StrictJson.stringify(errOuter));
      return ExecutionResult.ABORT;
    }
  }

  private static final int MAX_ARMOR_SCAN_CHARS = 32768;

  private static void appendScanChunk(StringBuilder sb, String text) {
    if (sb == null || text == null || text.isEmpty() || sb.length() >= MAX_ARMOR_SCAN_CHARS) {
      return;
    }
    if (sb.length() > 0 && sb.charAt(sb.length() - 1) != ' ' && sb.charAt(sb.length() - 1) != '\n') {
      sb.append(' ');
    }
    int remaining = MAX_ARMOR_SCAN_CHARS - sb.length();
    if (remaining <= 0) {
      return;
    }
    if (text.length() <= remaining) {
      sb.append(text);
    } else {
      sb.append(text, 0, remaining);
    }
  }

  private void executeGeminiToAnthropicResp(VarCache vars) {
    String respContent = vars.getNonEmpty("response.content");
    if (respContent == null) {
      return;
    }

    Map<String, Object> resp = StrictJson.parseObject(respContent, false);
    String model = vars.getOrDefault("model", "gemini-2.0-flash-001");
    String reqFmt = vars.getOrDefault("request_format", "claude");
    boolean includeThinkingBlocks =
        "claude".equalsIgnoreCase(reqFmt)
            && "true".equals(vars.getString("anthropic_thinking_requested"));
    boolean scanResp = !"false".equals(vars.getString("model_armor_response_enabled"));

    List<Object> contentBlocks = new ArrayList<>();
    StringBuilder visibleText = scanResp ? new StringBuilder() : null;
    String stopReason = "end_turn";
    long inputTokens = 0L;
    long cacheReadTokens = 0L;
    long cacheWriteTokens = 0L;
    long outputTokens = 0L;
    long thinkingTokens = 0L;
    String msgId = "msg_" + randomId(12);

    List<Object> choices = GlobMatcher.asList(resp.get("choices"));
    List<Object> candidates = GlobMatcher.asList(resp.get("candidates"));

    if (choices != null) {
      if (resp.get("id") != null) {
        msgId = String.valueOf(resp.get("id")).replace("chatcmpl-", "msg_");
      }
      if (resp.get("model") != null) {
        model = String.valueOf(resp.get("model"));
      }
      Map<String, Object> choice = !choices.isEmpty() ? GlobMatcher.asMap(choices.get(0)) : null;
      if (choice != null) {
        Map<String, Object> msg = GlobMatcher.asMap(choice.get("message"));
        if (msg != null) {
          Object msgContent = msg.get("content");
          if (msgContent instanceof String && !((String) msgContent).isEmpty()) {
            Map<String, Object> tb = new LinkedHashMap<>();
            tb.put("type", "text");
            tb.put("text", msgContent);
            contentBlocks.add(tb);
            appendScanChunk(visibleText, (String) msgContent);
          } else if (msgContent instanceof List) {
            for (Object cObj : (List<?>) msgContent) {
              Map<String, Object> cPart = GlobMatcher.asMap(cObj);
              if (cPart != null && "text".equals(cPart.get("type")) && cPart.get("text") != null) {
                Map<String, Object> tb = new LinkedHashMap<>();
                tb.put("type", "text");
                tb.put("text", cPart.get("text"));
                contentBlocks.add(tb);
                appendScanChunk(visibleText, String.valueOf(cPart.get("text")));
              }
            }
          }
          List<Object> toolCalls = GlobMatcher.asList(msg.get("tool_calls"));
          if (toolCalls != null) {
            for (Object tcObj : toolCalls) {
              Map<String, Object> tc = GlobMatcher.asMap(tcObj);
              if (tc == null) {
                continue;
              }
              Map<String, Object> fn = GlobMatcher.asMap(tc.get("function"));
              Object parsedInput = new LinkedHashMap<>();
              String rawArgsStr = null;
              if (fn != null) {
                Object rawArgs = fn.get("arguments");
                if (rawArgs instanceof String) {
                  rawArgsStr = (String) rawArgs;
                  try {
                    parsedInput = StrictJson.parse(rawArgsStr, false);
                  } catch (Exception e) {
                    Map<String, Object> rawMap = new LinkedHashMap<>();
                    rawMap.put("raw", rawArgs);
                    parsedInput = rawMap;
                  }
                } else if (rawArgs != null) {
                  parsedInput = rawArgs;
                }
              }
              String tName = (fn != null && fn.get("name") != null) ? String.valueOf(fn.get("name")) : "tool";
              Map<String, Object> tub = new LinkedHashMap<>();
              tub.put("type", "tool_use");
              tub.put("id", tc.get("id") != null ? tc.get("id") : ("toolu_" + randomId(10)));
              tub.put("name", tName);
              tub.put("input", parsedInput);
              String tcSig =
                  firstNonEmpty(
                      GlobMatcher.asString(tc.get("thought_signature")),
                      GlobMatcher.asString(tc.get("thoughtSignature")));
              if (tcSig != null && !tcSig.isEmpty()) {
                tub.put("thought_signature", tcSig);
              }
              contentBlocks.add(tub);
              if (scanResp) {
                String serializedArgs = rawArgsStr != null ? rawArgsStr : StrictJson.stringify(parsedInput);
                appendScanChunk(visibleText, tName + ": " + serializedArgs);
              }
            }
            stopReason = "tool_use";
          }
        }
        String finishReason = GlobMatcher.asString(choice.get("finish_reason"));
        if ("tool_calls".equals(finishReason)) {
          stopReason = "tool_use";
        } else if ("length".equals(finishReason)) {
          stopReason = "max_tokens";
        } else if ("content_filter".equals(finishReason)) {
          stopReason = "refusal";
        } else if ("stop".equals(finishReason) && !"tool_use".equals(stopReason)) {
          stopReason = "end_turn";
        }
      }
      Map<String, Object> usage = GlobMatcher.asMap(resp.get("usage"));
      if (usage != null) {
        long totalPrompt = usage.get("prompt_tokens") != null
            ? GlobMatcher.asLong(usage.get("prompt_tokens"), 0L)
            : GlobMatcher.asLong(usage.get("input_tokens"), 0L);
        Map<String, Object> pDetails = GlobMatcher.asMap(usage.get("prompt_tokens_details"));
        cacheReadTokens = (pDetails != null && pDetails.get("cached_tokens") != null)
            ? GlobMatcher.asLong(pDetails.get("cached_tokens"), 0L)
            : GlobMatcher.asLong(usage.get("cache_read_input_tokens"), 0L);
        cacheWriteTokens = GlobMatcher.asLong(usage.get("cache_creation_input_tokens"), 0L);
        inputTokens = Math.max(0L, totalPrompt - cacheReadTokens - cacheWriteTokens);
        long rawOut = usage.get("completion_tokens") != null
            ? GlobMatcher.asLong(usage.get("completion_tokens"), 0L)
            : GlobMatcher.asLong(usage.get("output_tokens"), 0L);
        Map<String, Object> cDetails = GlobMatcher.asMap(usage.get("completion_tokens_details"));
        thinkingTokens = cDetails != null ? GlobMatcher.asLong(cDetails.get("reasoning_tokens"), 0L) : 0L;
        long upstreamTotal = GlobMatcher.asLong(usage.get("total_tokens"), 0L);
        outputTokens =
            normalizeOpenAiCompletionTokens(totalPrompt, rawOut, thinkingTokens, upstreamTotal);
      }
    } else if (candidates != null) {
      Map<String, Object> cand = !candidates.isEmpty() ? GlobMatcher.asMap(candidates.get(0)) : null;
      if (cand != null) {
        Map<String, Object> content = GlobMatcher.asMap(cand.get("content"));
        List<Object> parts = content != null ? GlobMatcher.asList(content.get("parts")) : null;
        if (parts != null) {
          for (Object pObj : parts) {
            Map<String, Object> part = GlobMatcher.asMap(pObj);
            if (part == null) {
              continue;
            }
            boolean isThought =
                Boolean.TRUE.equals(part.get("thought"))
                    || "true".equals(String.valueOf(part.get("thought")));
            if (isThought) {
              if (includeThinkingBlocks) {
                String sig = GlobMatcher.asString(part.get("thoughtSignature"));
                if (part.get("text") != null || (sig != null && !sig.isEmpty())) {
                  Map<String, Object> thinkBlock = new LinkedHashMap<>();
                  thinkBlock.put("type", "thinking");
                  thinkBlock.put("thinking", part.get("text") != null ? String.valueOf(part.get("text")) : "");
                  if (sig != null && !sig.isEmpty()) {
                    thinkBlock.put("signature", sig.startsWith("gem_ts:") ? sig : ("gem_ts:" + sig));
                  } else {
                    thinkBlock.put("signature", "gem_ts:none");
                  }
                  contentBlocks.add(thinkBlock);
                }
              }
              continue;
            }
            boolean hasFuncCall = part.get("functionCall") instanceof Map;
            if (part.get("text") != null) {
              String txt = String.valueOf(part.get("text"));
              if (!txt.isEmpty() || !hasFuncCall) {
                Map<String, Object> tb = new LinkedHashMap<>();
                tb.put("type", "text");
                tb.put("text", part.get("text"));
                contentBlocks.add(tb);
                if (!txt.isEmpty()) {
                  appendScanChunk(visibleText, txt);
                }
              }
            }
            if (hasFuncCall) {
              Map<String, Object> fc = GlobMatcher.asMap(part.get("functionCall"));
              String fcName = fc.get("name") != null ? String.valueOf(fc.get("name")) : "tool";
              Object fcArgs = fc.get("args") != null ? fc.get("args") : new LinkedHashMap<>();
              Map<String, Object> tub = new LinkedHashMap<>();
              tub.put("type", "tool_use");
              tub.put("id", fc.get("id") != null ? fc.get("id") : ("toolu_" + randomId(10)));
              tub.put("name", fc.get("name"));
              tub.put("input", fcArgs);
              String fcSig = GlobMatcher.asString(part.get("thoughtSignature"));
              if (fcSig != null && !fcSig.isEmpty()) {
                tub.put("thought_signature", fcSig);
              }
              contentBlocks.add(tub);
              stopReason = "tool_use";
              if (scanResp) {
                appendScanChunk(visibleText, fcName + ": " + StrictJson.stringify(fcArgs));
              }
            }
          }
        }
        String finishReason = GlobMatcher.asString(cand.get("finishReason"));
        if ("MAX_TOKENS".equals(finishReason)) {
          stopReason = "max_tokens";
        } else if (isGeminiSafetyFinishReason(finishReason) && !"tool_use".equals(stopReason)) {
          stopReason = "refusal";
        } else if ("STOP".equals(finishReason) && !"tool_use".equals(stopReason)) {
          stopReason = "end_turn";
        }
      }
      Map<String, Object> uMeta = GlobMatcher.asMap(resp.get("usageMetadata"));
      if (uMeta != null) {
        long gemTotalPrompt = GlobMatcher.asLong(uMeta.get("promptTokenCount"), 0L);
        cacheReadTokens = GlobMatcher.asLong(uMeta.get("cachedContentTokenCount"), 0L);
        inputTokens = Math.max(0L, gemTotalPrompt - cacheReadTokens);
        thinkingTokens = GlobMatcher.asLong(uMeta.get("thoughtsTokenCount"), 0L);
        outputTokens = GlobMatcher.asLong(uMeta.get("candidatesTokenCount"), 0L) + thinkingTokens;
      }
      if (resp.get("modelVersion") != null) {
        model = String.valueOf(resp.get("modelVersion"));
      }
    }

    if ((inputTokens + cacheReadTokens + cacheWriteTokens + outputTokens) == 0L
        && resp.get("error") == null) {
      long promptChars = GlobMatcher.asLong(vars.get("prompt_char_len"), 0L);
      inputTokens = Math.max(1L, (promptChars + 3L) / 4L);
      outputTokens = Math.max(1L, (Math.min(respContent.length(), 131072) + 3L) / 4L);
    }

    if (contentBlocks.isEmpty()) {
      Map<String, Object> emptyText = new LinkedHashMap<>();
      emptyText.put("type", "text");
      emptyText.put("text", "");
      contentBlocks.add(emptyText);
    }

    Map<String, Object> usageMap = new LinkedHashMap<>();
    usageMap.put("input_tokens", inputTokens);
    usageMap.put("cache_read_input_tokens", cacheReadTokens);
    usageMap.put("cache_creation_input_tokens", cacheWriteTokens);
    usageMap.put("output_tokens", outputTokens);

    Map<String, Object> anthropicResp = new LinkedHashMap<>();
    anthropicResp.put("id", msgId);
    anthropicResp.put("type", "message");
    anthropicResp.put("role", "assistant");
    anthropicResp.put("model", model);
    anthropicResp.put("content", contentBlocks);
    anthropicResp.put("stop_reason", stopReason);
    anthropicResp.put("stop_sequence", null);
    anthropicResp.put("usage", usageMap);

    vars.set("response.content", StrictJson.stringify(anthropicResp));
    if (scanResp && visibleText != null) {
      String trimmedVisible = visibleText.toString().trim();
      if (!trimmedVisible.isEmpty()) {
        vars.set("response_partial", trimmedVisible);
      }
    }
    vars.set("response_partial_extracted", "true");
    long totalExtractedTokens = inputTokens + cacheReadTokens + cacheWriteTokens + outputTokens;
    if ("gemini".equalsIgnoreCase(reqFmt)) {
      vars.set("prompt_tokens", String.valueOf(inputTokens + cacheReadTokens + cacheWriteTokens));
      vars.set("cached_content_tokens", String.valueOf(cacheReadTokens));
      vars.set("thoughts_tokens", String.valueOf(thinkingTokens));
      vars.set("completion_tokens", String.valueOf(Math.max(0L, outputTokens - thinkingTokens)));
    } else {
      vars.set("prompt_tokens", String.valueOf(inputTokens));
      vars.set("uncached_prompt_tokens", String.valueOf(inputTokens));
      vars.set("cache_read_input_tokens", String.valueOf(cacheReadTokens));
      vars.set("cache_creation_input_tokens", String.valueOf(cacheWriteTokens));
      vars.set("thinking_tokens", String.valueOf(thinkingTokens));
      vars.set("completion_tokens", String.valueOf(outputTokens));
    }
    vars.set("total_tokens", String.valueOf(totalExtractedTokens));
    vars.set("response_tokens_extracted", "true");
  }

  static String unwrapMarkdownJsonFenceIfRequested(VarCache vars, String content) {
    if (content != null
        && !content.isEmpty()
        && "true".equals(vars.getString("openai_json_response_format"))) {
      String trimmed = content.trim();
      if (trimmed.startsWith("```") && trimmed.endsWith("```") && trimmed.length() >= 6) {
        int firstNl = trimmed.indexOf('\n');
        if (firstNl > 0 && firstNl < trimmed.length() - 3) {
          return trimmed.substring(firstNl + 1, trimmed.length() - 3).trim();
        }
      }
    }
    return content;
  }

  private void executeGeminiToOpenAiResp(VarCache vars) {
    String respContent = vars.getNonEmpty("response.content");
    if (respContent == null) {
      return;
    }
    Map<String, Object> geminiResp = StrictJson.parseObject(respContent, false);
    transcodeGeminiMapToOpenAiResp(vars, geminiResp, respContent);
  }

  private void transcodeGeminiMapToOpenAiResp(
      VarCache vars, Map<String, Object> geminiResp, String respContent) {
    if (geminiResp.get("error") != null) {
      return;
    }

    boolean scanResp = !"false".equals(vars.getString("model_armor_response_enabled"));
    StringBuilder scanBuf = scanResp ? new StringBuilder() : null;
    List<String> textParts = new ArrayList<>();
    List<Object> toolCalls = new ArrayList<>();
    String finishReason = "stop";

    List<Object> candidates = GlobMatcher.asList(geminiResp.get("candidates"));
    Map<String, Object> cand =
        (candidates != null && !candidates.isEmpty())
            ? GlobMatcher.asMap(candidates.get(0))
            : null;
    if (cand != null) {
      Map<String, Object> content = GlobMatcher.asMap(cand.get("content"));
      List<Object> parts = content != null ? GlobMatcher.asList(content.get("parts")) : null;
      if (parts != null) {
        for (Object pObj : parts) {
          Map<String, Object> part = GlobMatcher.asMap(pObj);
          if (part == null) {
            continue;
          }
          boolean isThought =
              Boolean.TRUE.equals(part.get("thought"))
                  || "true".equals(String.valueOf(part.get("thought")));
          if (isThought) {
            continue;
          }
          boolean hasFuncCall = part.get("functionCall") instanceof Map;
          if (part.get("text") != null) {
            String txt = String.valueOf(part.get("text"));
            if (!txt.isEmpty() || !hasFuncCall) {
              textParts.add(txt);
              if (!txt.isEmpty()) {
                appendScanChunk(scanBuf, txt);
              }
            }
          }
          if (hasFuncCall) {
            Map<String, Object> fc = GlobMatcher.asMap(part.get("functionCall"));
            String fcName = fc.get("name") != null ? String.valueOf(fc.get("name")) : "tool";
            Object fcArgs = fc.get("args") != null ? fc.get("args") : new LinkedHashMap<>();
            String argsJson = StrictJson.stringify(fcArgs);
            Map<String, Object> fnObj = new LinkedHashMap<>();
            fnObj.put("name", fc.get("name"));
            fnObj.put("arguments", argsJson);
            Map<String, Object> tcEntry = new LinkedHashMap<>();
            tcEntry.put("id", fc.get("id") != null ? fc.get("id") : ("call_" + randomId(8)));
            tcEntry.put("type", "function");
            tcEntry.put("function", fnObj);
            String fcSig = GlobMatcher.asString(part.get("thoughtSignature"));
            if (fcSig != null && !fcSig.isEmpty()) {
              tcEntry.put("thought_signature", fcSig);
            }
            toolCalls.add(tcEntry);
            appendScanChunk(scanBuf, fcName + ": " + argsJson);
          }
        }
      }
      String gemFinish = GlobMatcher.asString(cand.get("finishReason"));
      if (!toolCalls.isEmpty()) {
        finishReason = "tool_calls";
      } else if ("MAX_TOKENS".equals(gemFinish)) {
        finishReason = "length";
      } else if (isGeminiSafetyFinishReason(gemFinish)) {
        finishReason = "content_filter";
      } else {
        finishReason = "stop";
      }
    }

    Map<String, Object> uMeta = GlobMatcher.asMap(geminiResp.get("usageMetadata"));
    long uncachedInputTokens = 0L;
    long cacheReadTokens = 0L;
    long thinkingTokens = 0L;
    long outputTokens = 0L;
    if (uMeta != null) {
      long gemTotalPrompt = GlobMatcher.asLong(uMeta.get("promptTokenCount"), 0L);
      cacheReadTokens = GlobMatcher.asLong(uMeta.get("cachedContentTokenCount"), 0L);
      uncachedInputTokens = Math.max(0L, gemTotalPrompt - cacheReadTokens);
      thinkingTokens = GlobMatcher.asLong(uMeta.get("thoughtsTokenCount"), 0L);
      outputTokens = GlobMatcher.asLong(uMeta.get("candidatesTokenCount"), 0L) + thinkingTokens;
    }
    long totalPromptTokens = uncachedInputTokens + cacheReadTokens;
    long totalTokens = totalPromptTokens + outputTokens;
    if (totalTokens == 0L) {
      long promptChars = GlobMatcher.asLong(vars.get("prompt_char_len"), 0L);
      uncachedInputTokens = Math.max(1L, (promptChars + 3L) / 4L);
      totalPromptTokens = uncachedInputTokens;
      outputTokens = Math.max(1L, (Math.min(respContent.length(), 131072) + 3L) / 4L);
      totalTokens = totalPromptTokens + outputTokens;
    }

    String joinedContent =
        !textParts.isEmpty() ? String.join("", textParts) : (toolCalls.isEmpty() ? "" : null);
    joinedContent = unwrapMarkdownJsonFenceIfRequested(vars, joinedContent);

    Map<String, Object> messageObj = new LinkedHashMap<>();
    messageObj.put("role", "assistant");
    messageObj.put("content", joinedContent);
    if (!toolCalls.isEmpty()) {
      messageObj.put("tool_calls", toolCalls);
    }

    Map<String, Object> usageObj = new LinkedHashMap<>();
    usageObj.put("prompt_tokens", totalPromptTokens);
    usageObj.put("completion_tokens", outputTokens);
    usageObj.put("total_tokens", totalTokens);
    if (cacheReadTokens > 0L) {
      Map<String, Object> pDetails = new LinkedHashMap<>();
      pDetails.put("cached_tokens", cacheReadTokens);
      usageObj.put("prompt_tokens_details", pDetails);
    }
    if (thinkingTokens > 0L) {
      Map<String, Object> cDetails = new LinkedHashMap<>();
      cDetails.put("reasoning_tokens", thinkingTokens);
      usageObj.put("completion_tokens_details", cDetails);
    }

    Map<String, Object> choice0 = new LinkedHashMap<>();
    choice0.put("index", 0L);
    choice0.put("message", messageObj);
    choice0.put("finish_reason", finishReason);
    List<Object> choicesList = new ArrayList<>();
    choicesList.add(choice0);

    String msgId =
        geminiResp.get("responseId") != null
            ? ("chatcmpl-" + String.valueOf(geminiResp.get("responseId")))
            : ("chatcmpl-" + randomId(10));
    String modelName =
        geminiResp.get("modelVersion") != null
            ? String.valueOf(geminiResp.get("modelVersion"))
            : vars.getOrDefault("model", "gemini-2.0-flash-001");

    Map<String, Object> openAiResp = new LinkedHashMap<>();
    openAiResp.put("id", msgId);
    openAiResp.put("object", "chat.completion");
    openAiResp.put("created", System.currentTimeMillis() / 1000L);
    openAiResp.put("model", modelName);
    openAiResp.put("choices", choicesList);
    openAiResp.put("usage", usageObj);

    vars.set("response.content", StrictJson.stringify(openAiResp));
    if (scanResp && scanBuf != null) {
      String trimmedOaiText = scanBuf.toString().trim();
      if (!trimmedOaiText.isEmpty()) {
        vars.set("response_partial", trimmedOaiText);
      }
    }
    vars.set("response_partial_extracted", "true");
    vars.set("prompt_tokens", String.valueOf(totalPromptTokens));
    vars.set("uncached_prompt_tokens", String.valueOf(uncachedInputTokens));
    vars.set("cached_prompt_tokens", String.valueOf(cacheReadTokens));
    vars.set("cache_read_input_tokens", String.valueOf(cacheReadTokens));
    vars.set("cache_creation_input_tokens", "0");
    vars.set("reasoning_tokens", String.valueOf(thinkingTokens));
    vars.set("completion_tokens", String.valueOf(outputTokens));
    vars.set("total_tokens", String.valueOf(totalTokens));
    vars.set("response_tokens_extracted", "true");
  }

  private void executeAnthropicToOpenAiResp(VarCache vars) {
    String respContent = vars.getNonEmpty("response.content");
    if (respContent == null) {
      return;
    }

    Map<String, Object> claudeResp = StrictJson.parseObject(respContent, false);
    if (claudeResp.get("error") != null) {
      return;
    }
    if (claudeResp.get("candidates") instanceof List) {
      transcodeGeminiMapToOpenAiResp(vars, claudeResp, respContent);
      return;
    }

    boolean scanResp = !"false".equals(vars.getString("model_armor_response_enabled"));
    StringBuilder scanBuf = scanResp ? new StringBuilder() : null;
    List<String> textParts = new ArrayList<>();
    List<Object> toolCalls = new ArrayList<>();
    List<Object> contentBlocks = GlobMatcher.asList(claudeResp.get("content"));
    if (contentBlocks != null) {
      for (Object bObj : contentBlocks) {
        Map<String, Object> block = GlobMatcher.asMap(bObj);
        if (block == null) {
          continue;
        }
        String bType = GlobMatcher.asString(block.get("type"));
        if ("text".equals(bType) && block.get("text") != null) {
          String txt = String.valueOf(block.get("text"));
          textParts.add(txt);
          appendScanChunk(scanBuf, txt);
        } else if ("tool_use".equals(bType)) {
          String argsJson =
              StrictJson.stringify(block.get("input") != null ? block.get("input") : new LinkedHashMap<>());
          String tName = block.get("name") != null ? String.valueOf(block.get("name")) : "tool";
          Map<String, Object> fnObj = new LinkedHashMap<>();
          fnObj.put("name", block.get("name"));
          fnObj.put("arguments", argsJson);
          Map<String, Object> tcEntry = new LinkedHashMap<>();
          tcEntry.put("id", block.get("id") != null ? block.get("id") : ("call_" + randomId(8)));
          tcEntry.put("type", "function");
          tcEntry.put("function", fnObj);
          String tcSig =
              firstNonEmpty(
                  GlobMatcher.asString(block.get("thought_signature")),
                  GlobMatcher.asString(block.get("thoughtSignature")));
          if (tcSig != null && !tcSig.isEmpty()) {
            tcEntry.put("thought_signature", tcSig);
          }
          toolCalls.add(tcEntry);
          appendScanChunk(scanBuf, tName + ": " + argsJson);
        }
      }
    }

    String finishReason = "stop";
    String stopReason = GlobMatcher.asString(claudeResp.get("stop_reason"));
    if ("tool_use".equals(stopReason) || !toolCalls.isEmpty()) {
      finishReason = "tool_calls";
    } else if ("max_tokens".equals(stopReason)) {
      finishReason = "length";
    } else if ("refusal".equals(stopReason)) {
      finishReason = "content_filter";
    }

    Map<String, Object> usage = GlobMatcher.asMap(claudeResp.get("usage"));
    long uncachedInputTokens = usage != null ? GlobMatcher.asLong(usage.get("input_tokens"), 0L) : 0L;
    long cacheReadTokens = usage != null ? GlobMatcher.asLong(usage.get("cache_read_input_tokens"), 0L) : 0L;
    long cacheWriteTokens = usage != null ? GlobMatcher.asLong(usage.get("cache_creation_input_tokens"), 0L) : 0L;
    long totalPromptTokens = uncachedInputTokens + cacheReadTokens + cacheWriteTokens;
    long outputTokens = usage != null ? GlobMatcher.asLong(usage.get("output_tokens"), 0L) : 0L;
    long totalTokens = totalPromptTokens + outputTokens;
    if (totalTokens == 0L) {
      long promptChars = GlobMatcher.asLong(vars.get("prompt_char_len"), 0L);
      uncachedInputTokens = Math.max(1L, (promptChars + 3L) / 4L);
      totalPromptTokens = uncachedInputTokens;
      outputTokens = Math.max(1L, (Math.min(respContent.length(), 131072) + 3L) / 4L);
      totalTokens = totalPromptTokens + outputTokens;
    }

    String joinedContent = !textParts.isEmpty() ? String.join("", textParts) : (toolCalls.isEmpty() ? "" : null);
    joinedContent = unwrapMarkdownJsonFenceIfRequested(vars, joinedContent);

    Map<String, Object> messageObj = new LinkedHashMap<>();
    messageObj.put("role", "assistant");
    messageObj.put("content", joinedContent);
    if (!toolCalls.isEmpty()) {
      messageObj.put("tool_calls", toolCalls);
    }

    Map<String, Object> usageObj = new LinkedHashMap<>();
    usageObj.put("prompt_tokens", totalPromptTokens);
    usageObj.put("completion_tokens", outputTokens);
    usageObj.put("total_tokens", totalTokens);
    if (cacheReadTokens > 0) {
      Map<String, Object> pDetails = new LinkedHashMap<>();
      pDetails.put("cached_tokens", cacheReadTokens);
      usageObj.put("prompt_tokens_details", pDetails);
    }
    if (cacheWriteTokens > 0) {
      usageObj.put("cache_creation_input_tokens", cacheWriteTokens);
    }

    Map<String, Object> choice0 = new LinkedHashMap<>();
    choice0.put("index", 0L);
    choice0.put("message", messageObj);
    choice0.put("finish_reason", finishReason);
    List<Object> choicesList = new ArrayList<>();
    choicesList.add(choice0);

    String msgId = claudeResp.get("id") != null
        ? String.valueOf(claudeResp.get("id")).replace("msg_", "chatcmpl-")
        : ("chatcmpl-" + randomId(10));
    String modelName = claudeResp.get("model") != null
        ? String.valueOf(claudeResp.get("model"))
        : vars.getOrDefault("model", "claude");

    Map<String, Object> openAiResp = new LinkedHashMap<>();
    openAiResp.put("id", msgId);
    openAiResp.put("object", "chat.completion");
    openAiResp.put("created", System.currentTimeMillis() / 1000L);
    openAiResp.put("model", modelName);
    openAiResp.put("choices", choicesList);
    openAiResp.put("usage", usageObj);

    vars.set("response.content", StrictJson.stringify(openAiResp));
    if (scanResp && scanBuf != null) {
      String trimmedOaiText = scanBuf.toString().trim();
      if (!trimmedOaiText.isEmpty()) {
        vars.set("response_partial", trimmedOaiText);
      }
    }
    vars.set("response_partial_extracted", "true");
    vars.set("prompt_tokens", String.valueOf(totalPromptTokens));
    vars.set("uncached_prompt_tokens", String.valueOf(uncachedInputTokens));
    vars.set("cached_prompt_tokens", String.valueOf(cacheReadTokens));
    vars.set("cache_read_input_tokens", String.valueOf(cacheReadTokens));
    vars.set("cache_creation_input_tokens", String.valueOf(cacheWriteTokens));
    vars.set("completion_tokens", String.valueOf(outputTokens));
    vars.set("total_tokens", String.valueOf(totalTokens));
    vars.set("response_tokens_extracted", "true");
  }

  private void executeCalculateTokensNonStreaming(VarCache vars) {
    if ("true".equals(vars.getString("vertex_predict_embeddings"))) {
      String respStr = vars.getNonEmpty("response.content");
      if (respStr != null) {
        try {
          Map<String, Object> vertexResp = StrictJson.parseObject(respStr, false);
          List<Object> predictions = GlobMatcher.asList(vertexResp.get("predictions"));
          if (predictions != null) {
            List<Object> data = new ArrayList<>();
            long totalEmbTokens = 0L;
            for (int i = 0; i < predictions.size(); i++) {
              Map<String, Object> pred = GlobMatcher.asMap(predictions.get(i));
              Map<String, Object> embObj = pred != null ? GlobMatcher.asMap(pred.get("embeddings")) : null;
              if (embObj == null) {
                embObj = pred;
              }
              Object values = (embObj != null && embObj.get("values") != null)
                  ? embObj.get("values")
                  : new ArrayList<>();
              Map<String, Object> stats = embObj != null ? GlobMatcher.asMap(embObj.get("statistics")) : null;
              if (stats != null && stats.get("token_count") != null) {
                totalEmbTokens += GlobMatcher.asLong(stats.get("token_count"), 0L);
              }
              Map<String, Object> item = new LinkedHashMap<>();
              item.put("object", "embedding");
              item.put("embedding", values);
              item.put("index", Long.valueOf(i));
              data.add(item);
            }
            String modelName = vars.getOrDefault("model", "text-embedding-005");
            Map<String, Object> usage = new LinkedHashMap<>();
            usage.put("prompt_tokens", totalEmbTokens);
            usage.put("total_tokens", totalEmbTokens);

            Map<String, Object> openaiEmbResp = new LinkedHashMap<>();
            openaiEmbResp.put("object", "list");
            openaiEmbResp.put("data", data);
            openaiEmbResp.put("model", modelName);
            openaiEmbResp.put("usage", usage);

            vars.set("response.content", StrictJson.stringify(openaiEmbResp));
            vars.set("prompt_tokens", String.valueOf(totalEmbTokens));
          }
        } catch (Exception ignored) {
          // ignore
        }
      }
    }

    String reqFormat = vars.getOrDefault("request_format", "claude").toLowerCase(Locale.ROOT);
    long rawPromptTokens = GlobMatcher.asLong(vars.get("prompt_tokens"), 0L);
    long rawCompletionTokens = GlobMatcher.asLong(vars.get("completion_tokens"), 0L);
    boolean partialAlreadyExtracted = "true".equals(vars.getString("response_partial_extracted"));
    String rawRespContent = null;
    String arrayExtractedText = null;
    long arrayCachedTokens = 0L;
    long arrayThoughtsTokens = 0L;
    boolean parsedGeminiArray = false;

    if ("gemini".equals(reqFormat)) {
      rawRespContent = vars.getNonEmpty("response.content");
      if (rawRespContent != null && rawRespContent.trim().startsWith("[")) {
        try {
          Object arrObj = StrictJson.parse(rawRespContent, false);
          if (arrObj instanceof List) {
            parsedGeminiArray = true;
            long maxPrompt = rawPromptTokens;
            long maxCand = rawCompletionTokens;
            long maxCached = 0L;
            long maxThoughts = 0L;
            StringBuilder sbText = new StringBuilder();
            for (Object elemObj : (List<?>) arrObj) {
              Map<String, Object> elem = GlobMatcher.asMap(elemObj);
              if (elem == null) {
                continue;
              }
              Map<String, Object> usage = GlobMatcher.asMap(elem.get("usageMetadata"));
              if (usage != null) {
                maxPrompt = Math.max(maxPrompt, GlobMatcher.asLong(usage.get("promptTokenCount"), 0L));
                maxCand = Math.max(maxCand, GlobMatcher.asLong(usage.get("candidatesTokenCount"), 0L));
                maxCached = Math.max(maxCached, GlobMatcher.asLong(usage.get("cachedContentTokenCount"), 0L));
                maxThoughts = Math.max(maxThoughts, GlobMatcher.asLong(usage.get("thoughtsTokenCount"), 0L));
              }
              List<Object> cands = GlobMatcher.asList(elem.get("candidates"));
              if (cands != null && !cands.isEmpty()) {
                Map<String, Object> firstCand = GlobMatcher.asMap(cands.get(0));
                Map<String, Object> candContent = firstCand != null ? GlobMatcher.asMap(firstCand.get("content")) : null;
                List<Object> parts = candContent != null ? GlobMatcher.asList(candContent.get("parts")) : null;
                if (parts != null) {
                  for (Object gpObj : parts) {
                    Map<String, Object> gp = GlobMatcher.asMap(gpObj);
                    if (gp == null || Boolean.TRUE.equals(gp.get("thought"))) {
                      continue;
                    }
                    if (gp.get("text") != null && sbText.length() < MAX_ARMOR_SCAN_CHARS) {
                      String chunkTxt = String.valueOf(gp.get("text"));
                      int rem = MAX_ARMOR_SCAN_CHARS - sbText.length();
                      sbText.append(chunkTxt.length() <= rem ? chunkTxt : chunkTxt.substring(0, rem));
                    }
                    if (gp.get("functionCall") instanceof Map) {
                      Map<String, Object> fc = GlobMatcher.asMap(gp.get("functionCall"));
                      String fcName = fc.get("name") != null ? String.valueOf(fc.get("name")) : "tool";
                      Object fcArgs = fc.get("args") != null ? fc.get("args") : new LinkedHashMap<>();
                      appendScanChunk(sbText, fcName + ": " + StrictJson.stringify(fcArgs));
                    }
                  }
                }
              }
            }
            rawPromptTokens = maxPrompt;
            rawCompletionTokens = maxCand;
            arrayCachedTokens = maxCached;
            arrayThoughtsTokens = maxThoughts;
            String trimmedArrText = sbText.toString().trim();
            if (!trimmedArrText.isEmpty()) {
              arrayExtractedText = trimmedArrText;
            }
          }
        } catch (Exception ignored) {
          // Fallback to standard variable extraction
        }
      }
    }

    long uncachedPromptTokens;
    long cacheReadTokens;
    long cacheWriteTokens = 0L;
    long thinkingTokens = 0L;
    long completionTokens = rawCompletionTokens;
    long promptTokens;

    if ("gemini".equals(reqFormat)) {
      cacheReadTokens = parsedGeminiArray
          ? Math.max(arrayCachedTokens, GlobMatcher.asLong(vars.get("cached_content_tokens"), 0L))
          : GlobMatcher.asLong(vars.get("cached_content_tokens"), 0L);
      thinkingTokens = parsedGeminiArray
          ? Math.max(arrayThoughtsTokens, GlobMatcher.asLong(vars.get("thoughts_tokens"), 0L))
          : GlobMatcher.asLong(vars.get("thoughts_tokens"), 0L);
      uncachedPromptTokens = Math.max(0L, rawPromptTokens - cacheReadTokens);
      promptTokens = rawPromptTokens;
      completionTokens = rawCompletionTokens + thinkingTokens;
    } else if ("openai".equals(reqFormat)) {
      String cachedPromptVar =
          vars.firstNonEmptyKey("cached_prompt_tokens", "cache_read_input_tokens");
      cacheReadTokens = GlobMatcher.asLong(cachedPromptVar, 0L);
      cacheWriteTokens = GlobMatcher.asLong(vars.get("cache_creation_input_tokens"), 0L);
      thinkingTokens = GlobMatcher.asLong(vars.get("reasoning_tokens"), 0L);
      String explicitUncached = vars.getNonEmpty("uncached_prompt_tokens");
      if (explicitUncached != null) {
        uncachedPromptTokens = GlobMatcher.asLong(explicitUncached, 0L);
      } else {
        uncachedPromptTokens = Math.max(0L, rawPromptTokens - cacheReadTokens - cacheWriteTokens);
      }
      promptTokens = uncachedPromptTokens + cacheReadTokens + cacheWriteTokens;
      long upstreamTotal =
          thinkingTokens > 0L
              ? GlobMatcher.asLong(vars.firstNonEmptyKey("upstream_total_tokens", "total_tokens"), 0L)
              : 0L;
      completionTokens =
          normalizeOpenAiCompletionTokens(
              promptTokens, rawCompletionTokens, thinkingTokens, upstreamTotal);
    } else {
      cacheReadTokens = GlobMatcher.asLong(vars.get("cache_read_input_tokens"), 0L);
      cacheWriteTokens = GlobMatcher.asLong(vars.get("cache_creation_input_tokens"), 0L);
      thinkingTokens = GlobMatcher.asLong(vars.get("thinking_tokens"), 0L);
      uncachedPromptTokens = rawPromptTokens;
      promptTokens = uncachedPromptTokens + cacheReadTokens + cacheWriteTokens;
      completionTokens = rawCompletionTokens;
    }

    boolean isEmbeddings = "true".equals(vars.getString("is_embeddings"));
    boolean isVertexPredict = "true".equals(vars.getString("vertex_predict_embeddings"));
    long totalTokens = promptTokens + completionTokens;
    if (totalTokens == 0L && !isEmbeddings && !isVertexPredict) {
      if (rawRespContent == null) {
        rawRespContent = vars.getNonEmpty("response.content");
      }
      if (rawRespContent != null && !rawRespContent.trim().isEmpty()) {
        long promptChars = GlobMatcher.asLong(vars.get("prompt_char_len"), 0L);
        if (promptChars <= 0L) {
          String extP = vars.getNonEmpty("extracted_prompt");
          if (extP != null) {
            promptChars = extP.length();
          }
        }
        uncachedPromptTokens = Math.max(1L, (promptChars + 3L) / 4L);
        promptTokens = uncachedPromptTokens;
        completionTokens = Math.max(1L, (Math.min(rawRespContent.length(), 131072) + 3L) / 4L);
        totalTokens = promptTokens + completionTokens;
      }
    }

    String promptStr = String.valueOf(promptTokens);
    String uncachedStr = String.valueOf(uncachedPromptTokens);
    String cacheReadStr = String.valueOf(cacheReadTokens);
    String cacheWriteStr = String.valueOf(cacheWriteTokens);
    String thinkingStr = String.valueOf(thinkingTokens);
    String completionStr = String.valueOf(completionTokens);
    String totalStr = String.valueOf(totalTokens);

    vars.set("prompt_tokens", promptStr);
    vars.set("usage_prompt_tokens", promptStr);
    vars.set("uncached_prompt_tokens", uncachedStr);
    vars.set("usage_uncached_prompt_tokens", uncachedStr);
    vars.set("cache_read_tokens", cacheReadStr);
    vars.set("usage_cache_read_tokens", cacheReadStr);
    vars.set("cache_write_tokens", cacheWriteStr);
    vars.set("usage_cache_write_tokens", cacheWriteStr);
    vars.set("thinking_tokens", thinkingStr);
    vars.set("usage_thinking_tokens", thinkingStr);
    vars.set("completion_tokens", completionStr);
    vars.set("usage_completion_tokens", completionStr);
    vars.set("usage_total_tokens", totalStr);
    vars.set("primary_quota_usage", totalStr);
    vars.set("secondary_quota_usage", totalStr);

    if (!partialAlreadyExtracted
        && !isEmbeddings
        && !isVertexPredict
        && !"false".equals(vars.getString("model_armor_response_enabled"))) {
      if (arrayExtractedText != null) {
        vars.set("response_partial", arrayExtractedText);
      } else if (!parsedGeminiArray) {
        if (rawRespContent == null) {
          rawRespContent = vars.getNonEmpty("response.content");
        }
        if (rawRespContent != null) {
          try {
            Map<String, Object> parsedResp = StrictJson.parseObject(rawRespContent, false);
            StringBuilder extractedText = new StringBuilder();
            List<Object> choices = GlobMatcher.asList(parsedResp.get("choices"));
            List<Object> contentBlocks = GlobMatcher.asList(parsedResp.get("content"));
            List<Object> candidates = GlobMatcher.asList(parsedResp.get("candidates"));
            if (choices != null && !choices.isEmpty()) {
              Map<String, Object> firstChoice = GlobMatcher.asMap(choices.get(0));
              Map<String, Object> msg = firstChoice != null ? GlobMatcher.asMap(firstChoice.get("message")) : null;
              if (msg != null) {
                Object msgContent = msg.get("content");
                if (msgContent instanceof String) {
                  appendScanChunk(extractedText, (String) msgContent);
                } else if (msgContent instanceof List) {
                  for (Object mcObj : (List<?>) msgContent) {
                    Map<String, Object> mc = GlobMatcher.asMap(mcObj);
                    if (mc != null && mc.get("text") != null) {
                      appendScanChunk(extractedText, String.valueOf(mc.get("text")));
                    }
                  }
                }
                List<Object> oaiTcs = GlobMatcher.asList(msg.get("tool_calls"));
                if (oaiTcs != null) {
                  for (Object tcObj : oaiTcs) {
                    Map<String, Object> tc = GlobMatcher.asMap(tcObj);
                    Map<String, Object> fn = tc != null ? GlobMatcher.asMap(tc.get("function")) : null;
                    if (fn != null) {
                      String tName = fn.get("name") != null ? String.valueOf(fn.get("name")) : "tool";
                      Object rawArgs = fn.get("arguments");
                      String argsStr = rawArgs instanceof String
                          ? (String) rawArgs
                          : StrictJson.stringify(rawArgs != null ? rawArgs : new LinkedHashMap<>());
                      appendScanChunk(extractedText, tName + ": " + argsStr);
                    }
                  }
                }
              }
            } else if (contentBlocks != null) {
              for (Object cbObj : contentBlocks) {
                Map<String, Object> cb = GlobMatcher.asMap(cbObj);
                if (cb == null) {
                  continue;
                }
                String cbType = GlobMatcher.asString(cb.get("type"));
                if (!"thinking".equals(cbType) && cb.get("text") != null) {
                  appendScanChunk(extractedText, String.valueOf(cb.get("text")));
                } else if ("tool_use".equals(cbType)) {
                  String tName = cb.get("name") != null ? String.valueOf(cb.get("name")) : "tool";
                  Object tIn = cb.get("input") != null ? cb.get("input") : new LinkedHashMap<>();
                  appendScanChunk(extractedText, tName + ": " + StrictJson.stringify(tIn));
                }
              }
            } else if (candidates != null && !candidates.isEmpty()) {
              Map<String, Object> firstCand = GlobMatcher.asMap(candidates.get(0));
              Map<String, Object> candContent = firstCand != null ? GlobMatcher.asMap(firstCand.get("content")) : null;
              List<Object> parts = candContent != null ? GlobMatcher.asList(candContent.get("parts")) : null;
              if (parts != null) {
                for (Object gpObj : parts) {
                  Map<String, Object> gp = GlobMatcher.asMap(gpObj);
                  if (gp == null || Boolean.TRUE.equals(gp.get("thought"))) {
                    continue;
                  }
                  if (gp.get("text") != null) {
                    appendScanChunk(extractedText, String.valueOf(gp.get("text")));
                  }
                  if (gp.get("functionCall") instanceof Map) {
                    Map<String, Object> fc = GlobMatcher.asMap(gp.get("functionCall"));
                    String fcName = fc.get("name") != null ? String.valueOf(fc.get("name")) : "tool";
                    Object fcArgs = fc.get("args") != null ? fc.get("args") : new LinkedHashMap<>();
                    appendScanChunk(extractedText, fcName + ": " + StrictJson.stringify(fcArgs));
                  }
                }
              }
            }
            String trimmed = extractedText.toString().trim();
            if (!trimmed.isEmpty()) {
              vars.set("response_partial", trimmed);
            }
          } catch (Exception ignored) {
            // ignore
          }
        }
      }
    }
  }

  private static String resolveRateProperty(
      VarCache vars,
      String model,
      String bareModel,
      boolean hasBarePrefix,
      boolean isDefaultModel,
      String propBase,
      String defaultVal) {
    String v =
        vars.getNonEmpty("propertyset.monetization_rates." + model + "." + propBase + "_per_m");
    if (v != null) {
      return v;
    }
    v = vars.getNonEmpty("propertyset.monetization_rates." + model + "." + propBase);
    if (v != null) {
      return v;
    }
    if (hasBarePrefix) {
      v = vars.getNonEmpty(
          "propertyset.monetization_rates." + bareModel + "." + propBase + "_per_m");
      if (v != null) {
        return v;
      }
      v = vars.getNonEmpty("propertyset.monetization_rates." + bareModel + "." + propBase);
      if (v != null) {
        return v;
      }
    }
    if (!isDefaultModel) {
      v = vars.getNonEmpty("propertyset.monetization_rates.default." + propBase + "_per_m");
      if (v != null) {
        return v;
      }
      v = vars.getNonEmpty("propertyset.monetization_rates.default." + propBase);
      if (v != null) {
        return v;
      }
    }
    return defaultVal;
  }

  private void executeCalculateMonetizationCost(VarCache vars) {
    String model = vars.getOrDefault("model", "default");
    boolean isDefaultModel = "default".equals(model);
    String bareModel = model.indexOf('/') != -1 ? model.substring(model.indexOf('/') + 1) : model;
    boolean hasBarePrefix = !bareModel.equals(model) && !"default".equals(bareModel);

    String totalPromptVar =
        vars.firstNonEmptyKeyOrDefault("0", "usage_prompt_tokens", "prompt_tokens");
    long totalPromptTokens = GlobMatcher.asLong(totalPromptVar, 0L);

    String cacheReadVar =
        vars.firstNonEmptyKeyOrDefault("0", "usage_cache_read_tokens", "cache_read_tokens");
    long cacheReadTokens = GlobMatcher.asLong(cacheReadVar, 0L);

    String cacheWriteVar =
        vars.firstNonEmptyKeyOrDefault("0", "usage_cache_write_tokens", "cache_write_tokens");
    long cacheWriteTokens = GlobMatcher.asLong(cacheWriteVar, 0L);

    String uncachedVar =
        vars.firstNonEmptyKey("usage_uncached_prompt_tokens", "uncached_prompt_tokens");
    long uncachedPromptTokens = (uncachedVar != null)
        ? GlobMatcher.asLong(uncachedVar, 0L)
        : Math.max(0L, totalPromptTokens - cacheReadTokens - cacheWriteTokens);

    String thinkingVar =
        vars.firstNonEmptyKeyOrDefault("0", "usage_thinking_tokens", "thinking_tokens");
    long thinkingTokens = GlobMatcher.asLong(thinkingVar, 0L);

    String completionVar =
        vars.firstNonEmptyKeyOrDefault("0", "usage_completion_tokens", "completion_tokens");
    long completionTokens = GlobMatcher.asLong(completionVar, 0L);

    long totalTokens = uncachedPromptTokens + cacheReadTokens + cacheWriteTokens + completionTokens;

    String inputRateStr =
        resolveRateProperty(
            vars, model, bareModel, hasBarePrefix, isDefaultModel, "input_rate", "0.10");
    String outputRateStr =
        resolveRateProperty(
            vars, model, bareModel, hasBarePrefix, isDefaultModel, "output_rate", "0.40");

    double inputRate = GlobMatcher.parseCleanRate(inputRateStr, 0.10, false);
    double outputRate = GlobMatcher.parseCleanRate(outputRateStr, 0.40, false);

    double cacheReadRate = inputRate;
    if (cacheReadTokens > 0) {
      String cacheReadRateStr =
          resolveRateProperty(
              vars, model, bareModel, hasBarePrefix, isDefaultModel, "cache_read_rate", null);
      if (cacheReadRateStr != null) {
        cacheReadRate = GlobMatcher.parseCleanRate(cacheReadRateStr, inputRate, false);
      }
    }

    double cacheWriteRate = inputRate;
    if (cacheWriteTokens > 0) {
      String cacheWriteRateStr =
          resolveRateProperty(
              vars, model, bareModel, hasBarePrefix, isDefaultModel, "cache_write_rate", null);
      if (cacheWriteRateStr != null) {
        cacheWriteRate = GlobMatcher.parseCleanRate(cacheWriteRateStr, inputRate, false);
      }
    }

    String markupStr =
        vars.firstNonEmptyKeyOrDefault(
            "1.0",
            "propertyset.monetization_rates." + model + ".markup",
            hasBarePrefix ? ("propertyset.monetization_rates." + bareModel + ".markup") : null,
            "propertyset.monetization_rates.platform.markup_multiplier",
            !isDefaultModel ? "propertyset.monetization_rates.default.markup" : null);
    double markupMultiplier = GlobMatcher.parseCleanRate(markupStr, 1.0, true);

    String currency =
        vars.firstNonEmptyKeyOrDefault(
            "USD",
            "propertyset.monetization_rates.platform.currency",
            "propertyset.monetization_rates.default.currency");

    double uncachedPromptCost = (uncachedPromptTokens / 1000000.0) * inputRate * markupMultiplier;
    double cacheReadCost = (cacheReadTokens / 1000000.0) * cacheReadRate * markupMultiplier;
    double cacheWriteCost = (cacheWriteTokens / 1000000.0) * cacheWriteRate * markupMultiplier;
    double promptCost = uncachedPromptCost + cacheReadCost + cacheWriteCost;
    double completionCost = (completionTokens / 1000000.0) * outputRate * markupMultiplier;

    long judgeTotalTokens = GlobMatcher.asLong(vars.getString("judge_total_tokens"), 0L);
    double judgeCost = 0.0;
    if (judgeTotalTokens > 0L) {
      String judgeModel = vars.getOrDefault("judge_model", "gemini-2.5-flash-lite");
      boolean isDefaultJudge = "default".equals(judgeModel);
      String bareJudge =
          judgeModel.indexOf('/') != -1
              ? judgeModel.substring(judgeModel.indexOf('/') + 1)
              : judgeModel;
      boolean hasBareJudge = !bareJudge.equals(judgeModel) && !"default".equals(bareJudge);

      long judgeUncachedIn =
          GlobMatcher.asLong(
              vars.firstNonEmptyKeyOrDefault(
                  "0", "judge_uncached_prompt_tokens", "judge_prompt_tokens"),
              0L);
      long judgeCacheRead = GlobMatcher.asLong(vars.getString("judge_cache_read_tokens"), 0L);
      long judgeOut = GlobMatcher.asLong(vars.getString("judge_completion_tokens"), 0L);

      double jInRate =
          GlobMatcher.parseCleanRate(
              resolveRateProperty(
                  vars, judgeModel, bareJudge, hasBareJudge, isDefaultJudge, "input_rate", "0.10"),
              0.10,
              false);
      double jOutRate =
          GlobMatcher.parseCleanRate(
              resolveRateProperty(
                  vars, judgeModel, bareJudge, hasBareJudge, isDefaultJudge, "output_rate", "0.40"),
              0.40,
              false);
      double jCacheRate = jInRate;
      if (judgeCacheRead > 0L) {
        String jCrStr =
            resolveRateProperty(
                vars, judgeModel, bareJudge, hasBareJudge, isDefaultJudge, "cache_read_rate", null);
        if (jCrStr != null) {
          jCacheRate = GlobMatcher.parseCleanRate(jCrStr, jInRate, false);
        }
      }
      String jMarkupStr =
          vars.firstNonEmptyKeyOrDefault(
              String.valueOf(markupMultiplier),
              "propertyset.monetization_rates." + judgeModel + ".markup",
              hasBareJudge ? ("propertyset.monetization_rates." + bareJudge + ".markup") : null);
      double jMarkup = GlobMatcher.parseCleanRate(jMarkupStr, markupMultiplier, true);

      judgeCost =
          (((judgeUncachedIn / 1000000.0) * jInRate)
                  + ((judgeCacheRead / 1000000.0) * jCacheRate)
                  + ((judgeOut / 1000000.0) * jOutRate))
              * jMarkup;
      vars.set("tx_judge_cost_usd", String.format(Locale.US, "%.6f", judgeCost));
    }

    double totalCost = promptCost + completionCost + judgeCost;
    long billedTotalTokens = totalTokens + Math.max(0L, judgeTotalTokens);

    String totalCostStr = String.format(Locale.US, "%.6f", totalCost);
    long totalCostMicro = totalCost > 0.0 ? Math.max(1L, Math.round(totalCost * 1000000.0)) : 0L;
    String totalCostMicroStr = String.valueOf(totalCostMicro);
    String billedTotalTokensStr = String.valueOf(billedTotalTokens);

    String primaryQuotaMode = vars.getOrDefault("primary_quota_mode", "tokens");
    String secondaryQuotaMode = vars.getOrDefault("secondary_quota_mode", "tokens");

    vars.set("tx_cost_usd", totalCostStr);
    vars.set("tx_cost_micro_usd", totalCostMicroStr);
    vars.set("tx_prompt_cost_usd", String.format(Locale.US, "%.6f", promptCost));
    vars.set("tx_uncached_prompt_cost_usd", String.format(Locale.US, "%.6f", uncachedPromptCost));
    vars.set("tx_cache_read_cost_usd", String.format(Locale.US, "%.6f", cacheReadCost));
    vars.set("tx_cache_write_cost_usd", String.format(Locale.US, "%.6f", cacheWriteCost));
    vars.set("tx_completion_cost_usd", String.format(Locale.US, "%.6f", completionCost));
    vars.set("tx_currency", currency);
    vars.set(
        "primary_quota_usage",
        "usd".equals(primaryQuotaMode) ? totalCostMicroStr : billedTotalTokensStr);
    vars.set(
        "secondary_quota_usage",
        "usd".equals(secondaryQuotaMode) ? totalCostMicroStr : billedTotalTokensStr);

    vars.set("usage_uncached_prompt_tokens", String.valueOf(uncachedPromptTokens));
    vars.set("usage_cache_read_tokens", String.valueOf(cacheReadTokens));
    vars.set("usage_cache_write_tokens", String.valueOf(cacheWriteTokens));
    vars.set("usage_thinking_tokens", String.valueOf(thinkingTokens));

    vars.set("perUnitPriceMultiplier", totalCostStr);
    vars.set("currency", currency);
    vars.set("transactionSuccess", "true");
    vars.set("mint.tx_cost", totalCostStr);
    vars.set("mint.tx_volume", billedTotalTokensStr);
    vars.set("mint.tx_currency", currency);

    if ("true".equals(vars.getString("fault_fallback_recovery"))) {
      String recoveredBody = vars.getNonEmpty("fault_recovered_body");
      if (recoveredBody != null) {
        String recoveredCt = vars.getOrDefault("fallback_response_content_type", "application/json");
        vars.set("error.status.code", Integer.valueOf(200));
        vars.set("error.reason.phrase", "OK");
        vars.set("error.header.Content-Type", recoveredCt);
        if (recoveredCt.startsWith("text/event-stream")) {
          vars.set("error.header.Cache-Control", "no-cache");
        }
        vars.set("error.content", recoveredBody);
        vars.remove("fault_recovered_body");
        vars.remove("fallback_response_content_type");
        vars.remove("error.header.X-Gateway-Model-Armor-Phase");
        vars.remove("error.header.X-Gateway-Model-Armor-Blocked-By");
        vars.remove("error.header.X-Gateway-Model-Armor-Template");
      }
      String fbModel = vars.getOrDefault("primary_model", model);
      vars.set("error.header.X-Gateway-Requested-Model", vars.getOrDefault("requested_model", fbModel));
      vars.set("error.header.X-Gateway-Routed-Model", fbModel);
      vars.set("error.header.X-Gateway-Fallback-Model", fbModel);
      vars.set("error.header.X-Gateway-Fallback-Triggered", "true");
      vars.set("error.header.X-Gateway-Circuit-Breaker", vars.getOrDefault("circuit_breaker_state", "CLOSED"));
      vars.set("error.header.X-Gateway-Identity-Persona", vars.getOrDefault("identity_persona", "default"));
      String costTier = vars.getNonEmpty("cost_tier");
      if (costTier != null) {
        vars.set("error.header.X-Gateway-Cost-Tier", costTier);
      }
      String enforceAllowedStr = vars.getNonEmpty("ratelimit.LTQ-EnforceOnly.allowed.count");
      if (enforceAllowedStr != null) {
        long enforceAllowed = GlobMatcher.asLong(enforceAllowedStr, 0L);
        long enforceUsed = GlobMatcher.asLong(vars.getString("ratelimit.LTQ-EnforceOnly.used.count"), 0L);
        long usageDelta = "usd".equals(primaryQuotaMode) ? totalCostMicro : billedTotalTokens;
        long updatedUsed = enforceUsed + Math.max(0L, usageDelta);
        vars.set("error.header.x-quota-allowed", String.valueOf(enforceAllowed));
        vars.set("error.header.x-quota-used", String.valueOf(updatedUsed));
        vars.set("error.header.x-quota-available", String.valueOf(Math.max(0L, enforceAllowed - updatedUsed)));
      }
      vars.set("error.header.x-quota-unit", primaryQuotaMode);
      vars.set("error.header.X-Gateway-Prompt-Tokens", String.valueOf(totalPromptTokens));
      vars.set("error.header.X-Gateway-Uncached-Prompt-Tokens", String.valueOf(uncachedPromptTokens));
      vars.set("error.header.X-Gateway-Cache-Read-Tokens", String.valueOf(cacheReadTokens));
      vars.set("error.header.X-Gateway-Cache-Write-Tokens", String.valueOf(cacheWriteTokens));
      vars.set("error.header.X-Gateway-Completion-Tokens", String.valueOf(completionTokens));
      vars.set("error.header.X-Gateway-Thinking-Tokens", String.valueOf(thinkingTokens));
      vars.set("error.header.X-Gateway-Total-Tokens", String.valueOf(totalTokens));
      vars.set("error.header.X-Gateway-Prompt-Cost-USD", String.format(Locale.US, "%.6f", promptCost));
      vars.set("error.header.X-Gateway-Cache-Read-Cost-USD", String.format(Locale.US, "%.6f", cacheReadCost));
      vars.set("error.header.X-Gateway-Completion-Cost-USD", String.format(Locale.US, "%.6f", completionCost));
      vars.set("error.header.X-Gateway-Total-Cost-USD", totalCostStr);
      vars.set("error.header.X-Gateway-Total-Cost-Micro-USD", totalCostMicroStr);
      vars.set("error.header.X-Gateway-Cost-Currency", currency);
    }
  }

  static boolean isGeminiSafetyFinishReason(String finishReason) {
    if (finishReason == null || finishReason.isEmpty()) {
      return false;
    }
    switch (finishReason) {
      case "SAFETY":
      case "RECITATION":
      case "BLOCKLIST":
      case "PROHIBITED_CONTENT":
      case "SPII":
      case "IMAGE_SAFETY":
      case "MODEL_ARMOR":
        return true;
      default:
        return false;
    }
  }

  static long normalizeOpenAiCompletionTokens(
      long totalPrompt, long rawCompletion, long reasoningTokens, long upstreamTotal) {
    if (reasoningTokens <= 0L) {
      return rawCompletion;
    }
    if (upstreamTotal > 0L && upstreamTotal >= totalPrompt + rawCompletion + reasoningTokens) {
      return rawCompletion + reasoningTokens;
    }
    return Math.max(rawCompletion, reasoningTokens);
  }

  private static String randomId(int len) {
    String chars = "0123456789abcdefghijklmnopqrstuvwxyz";
    StringBuilder sb = new StringBuilder(len);
    ThreadLocalRandom rnd = ThreadLocalRandom.current();
    for (int i = 0; i < len; i++) {
      sb.append(chars.charAt(rnd.nextInt(chars.length())));
    }
    return sb.toString();
  }
}
