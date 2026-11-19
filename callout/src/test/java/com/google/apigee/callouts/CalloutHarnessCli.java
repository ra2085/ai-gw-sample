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

import com.apigee.flow.execution.Action;
import com.apigee.flow.execution.ExecutionResult;
import com.google.apigee.callouts.util.StrictJson;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * CLI bridge for executing compiled Apigee Java Callouts from the Node.js unit/parity test suite.
 *
 * <p>Reads JSON lines from stdin:
 * <pre>
 *   {"script":"resolve_model_location.js","vars":{...},"strictDuplicateKeys":false}
 * </pre>
 * Writes JSON lines to stdout:
 * <pre>
 *   {"action":"CONTINUE","vars":{...},"duplicateReads":{}}
 * </pre>
 */
public final class CalloutHarnessCli {

  private static final Map<String, BaseCallout> CALLOUT_REGISTRY = new HashMap<>();

  static {
    register(
        AuthAndPersonaCallout.class,
        "extract_auth_credentials",
        "resolve_auth_persona",
        "restore_request_payload");
    register(
        RequestRouterAndTranscoderCallout.class,
        "extract_vars_gemini",
        "extract_vars_openai",
        "extract_vars_claude",
        "extract_prompt",
        "prepare_judge_request",
        "process_judge_response",
        "resolve_model_location",
        "inject_anthropic_version",
        "anthropic_to_gemini",
        "restore_model_openai",
        "models_endpoint");
    register(
        ResponseTranscoderAndCostCallout.class,
        "gemini_to_anthropic_resp",
        "anthropic_to_openai_resp",
        "gemini_to_openai_resp",
        "calculate_tokens_non_streaming",
        "calculate_monetization_cost");
    register(
        FallbackAndErrorCallout.class,
        "prepare_fallback_request",
        "apply_fallback_response",
        "format_rate_limit_error",
        "inject_deidentified_finding");
  }

  private static void register(Class<? extends BaseCallout> clazz, String... actions) {
    try {
      for (String action : actions) {
        Map<String, String> props = Collections.singletonMap("action", action);
        BaseCallout instance = clazz.getConstructor(Map.class).newInstance(props);
        CALLOUT_REGISTRY.put(action, instance);
        CALLOUT_REGISTRY.put(action + ".js", instance);
      }
    } catch (Exception e) {
      throw new ExceptionInInitializerError(e);
    }
  }

  public static void main(String[] args) throws Exception {
    if (args.length > 0) {
      String output = executeSingleRequest(args[0]);
      System.out.println(output);
      return;
    }

    BufferedReader reader =
        new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
    String line;
    while ((line = reader.readLine()) != null) {
      String trimmed = line.trim();
      if (trimmed.isEmpty()) {
        continue;
      }
      System.out.println(executeSingleRequest(trimmed));
      System.out.flush();
    }
  }

  @SuppressWarnings("unchecked")
  public static String executeSingleRequest(String jsonLine) {
    Map<String, Object> result = new LinkedHashMap<>();
    try {
      Map<String, Object> req = StrictJson.parseObject(jsonLine, false);
      String script = String.valueOf(req.get("script"));
      BaseCallout callout = CALLOUT_REGISTRY.get(script);
      if (callout == null) {
        result.put("error", "Unknown script/action: " + script);
        return StrictJson.stringify(result);
      }

      Map<String, Object> initialVars = new LinkedHashMap<>();
      Object varsObj = req.get("vars");
      if (varsObj instanceof Map<?, ?>) {
        initialVars.putAll((Map<String, Object>) varsObj);
      }

      InstrumentedMessageContext ctx = new InstrumentedMessageContext(initialVars);
      ExecutionResult execResult =
          callout.execute(ctx.getMessageContext(), ctx.getExecutionContext());

      result.put(
          "action",
          execResult.getAction() == Action.ABORT ? "ABORT" : "CONTINUE");
      result.put("vars", ctx.getAllVariables());
      result.put("readCounts", ctx.getReadCounts());
      result.put("writeCounts", ctx.getWriteCounts());
      result.put("duplicateReads", ctx.getDuplicateReads());
    } catch (Throwable e) {
      result.put("error", e.getClass().getName() + ": " + e.getMessage());
    }
    return StrictJson.stringify(result);
  }
}
