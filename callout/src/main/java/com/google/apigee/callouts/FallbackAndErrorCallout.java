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
import com.apigee.flow.message.Message;
import com.apigee.flow.message.MessageContext;
import com.google.apigee.callouts.util.GlobMatcher;
import com.google.apigee.callouts.util.StrictJson;
import com.google.apigee.callouts.util.VarCache;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ThreadLocalRandom;
import java.util.regex.Pattern;

/**
 * Stateless, thread-safe Java Callout consolidating the 4 resilience, fallback, and error-formatting
 * scripts:
 * <ul>
 *   <li>{@code prepare_fallback_request} (replaces {@code prepare_fallback_request.js})</li>
 *   <li>{@code apply_fallback_response} (replaces {@code apply_fallback_response.js})</li>
 *   <li>{@code format_rate_limit_error} (replaces {@code format_rate_limit_error.js})</li>
 *   <li>{@code inject_deidentified_finding} (replaces {@code inject_deidentified_finding.js})</li>
 * </ul>
 */
public final class FallbackAndErrorCallout extends BaseCallout {

  private static final Integer HTTP_STATUS_200 = Integer.valueOf(200);
  private static final int MAX_UPSTREAM_ERROR_CHARS = 65536;

  private static final String STATIC_FALLBACK_429_JSON =
      "{\"type\":\"error\",\"error\":{\"type\":\"rate_limit_error\","
          + "\"message\":\"Rate limit exceeded. Please retry after 1s.\",\"code\":429}}";

  private static final String STATIC_FALLBACK_500_JSON =
      "{\"error\":{\"type\":\"api_error\",\"message\":\"Internal gateway error.\",\"code\":500}}";

  private static final Pattern PATTERN_GCP_PROJECT_PATH =
      Pattern.compile("projects/[A-Za-z0-9._:-]+");
  private static final Pattern PATTERN_GCP_LOCATION_PATH =
      Pattern.compile("locations/[A-Za-z0-9._-]+");
  private static final Pattern PATTERN_GCP_PROJECT_NUM =
      Pattern.compile("(?i)\\b(project(?:\\s+(?:number|id))?\\s*[:=]?\\s*['\"]?)[0-9]{6,20}(['\"]?)");
  private static final Pattern PATTERN_SERVICE_ACCOUNT =
      Pattern.compile("[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]*gserviceaccount\\.com");
  private static final Pattern PATTERN_CONSUMER_ID =
      Pattern.compile("consumer:[A-Za-z0-9._:/-]+");
  private static final Pattern PATTERN_QUOTA_METRIC =
      Pattern.compile("(?i)(quota_metric|quota_limit|quota_unit)\\s*[:=]\\s*['\"]?[A-Za-z0-9._:/-]+['\"]?");
  private static final Pattern PATTERN_URL =
      Pattern.compile("https?://[^\\s\"'<>\\])}]+");
  private static final Pattern PATTERN_PRIVATE_IPV4 =
      Pattern.compile(
          "\\b(?:10\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}|172\\.(?:1[6-9]|2\\d|3[01])\\.\\d{1,3}\\.\\d{1,3}|192\\.168\\.\\d{1,3}\\.\\d{1,3}|127\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3})(?::\\d{1,5})?\\b");

  public FallbackAndErrorCallout(Map properties) {
    super(properties);
  }

  @Override
  public String getVarprefix() {
    return "fallback_callout_";
  }

  @Override
  public ExecutionResult execute(MessageContext msgCtxt, ExecutionContext exeCtxt) {
    VarCache vars = new VarCache(msgCtxt).withFallbackProperties(this.staticPropertySets);
    String action = resolveAction(msgCtxt, "format_rate_limit_error");
    try {
      switch (action) {
        case "prepare_fallback_request":
          executePrepareFallbackRequest(vars, msgCtxt);
          break;
        case "apply_fallback_response":
          executeApplyFallbackResponse(vars);
          break;
        case "format_rate_limit_error":
          executeFormatRateLimitError(vars);
          break;
        case "inject_deidentified_finding":
          executeInjectDeidentifiedFinding(vars);
          break;
        default:
          throw new IllegalStateException("Unsupported FallbackAndErrorCallout action: " + action);
      }
      return ExecutionResult.SUCCESS;
    } catch (StrictJson.DuplicateKeyException dke) {
      setExceptionVariables(dke, msgCtxt);
      if ("format_rate_limit_error".equals(action)) {
        applyRateLimitFallbackError(vars);
        return ExecutionResult.SUCCESS;
      }
      boolean inFaultFlow = vars.getNonEmpty("fault.name") != null;
      vars.set("fallback_ready", "false");
      vars.set("json_duplicate_key_detected", "true");
      vars.set("model_access_denied", "true");
      vars.set("auth_error_status", "400");
      Map<String, Object> errOuter = new LinkedHashMap<>();
      Map<String, Object> errInner = new LinkedHashMap<>();
      errInner.put("type", "invalid_request_error");
      errInner.put("message", "Duplicate JSON object key '" + dke.getDuplicateKey() + "' is not permitted.");
      errInner.put("code", 400L);
      errOuter.put("error", errInner);
      String errJson = StrictJson.stringify(errOuter);
      vars.set("auth_error_payload", errJson);
      if (!inFaultFlow) {
        vars.set("callout_aborted", "true");
        return ExecutionResult.ABORT;
      }
      vars.set("error.content", errJson);
      return ExecutionResult.SUCCESS;
    } catch (RequestRouterAndTranscoderCallout.SecurityAccessDeniedException sade) {
      setExceptionVariables(sade, msgCtxt);
      if ("format_rate_limit_error".equals(action)) {
        applyRateLimitFallbackError(vars);
        return ExecutionResult.SUCCESS;
      }
      boolean inFaultFlow = vars.getNonEmpty("fault.name") != null;
      vars.set("fallback_ready", "false");
      vars.set("model_access_denied", "true");
      vars.set("auth_error_status", "403");
      Map<String, Object> errOuter = new LinkedHashMap<>();
      Map<String, Object> errInner = new LinkedHashMap<>();
      errInner.put("type", "permission_error");
      errInner.put("message", sade.getMessage() != null ? sade.getMessage() : "Access denied.");
      errInner.put("code", 403L);
      errOuter.put("error", errInner);
      String errJson = StrictJson.stringify(errOuter);
      vars.set("auth_error_payload", errJson);
      if (!inFaultFlow) {
        vars.set("callout_aborted", "true");
        return ExecutionResult.ABORT;
      }
      vars.set("error.content", errJson);
      return ExecutionResult.SUCCESS;
    } catch (RequestRouterAndTranscoderCallout.InvalidRequestViolationException irve) {
      setExceptionVariables(irve, msgCtxt);
      if ("format_rate_limit_error".equals(action)) {
        applyRateLimitFallbackError(vars);
        return ExecutionResult.SUCCESS;
      }
      boolean inFaultFlow = vars.getNonEmpty("fault.name") != null;
      vars.set("fallback_ready", "false");
      vars.set("model_access_denied", "true");
      vars.set("auth_error_status", "400");
      Map<String, Object> errOuter = new LinkedHashMap<>();
      Map<String, Object> errInner = new LinkedHashMap<>();
      errInner.put("type", "invalid_request_error");
      errInner.put("message", irve.getMessage() != null ? irve.getMessage() : "Invalid request payload.");
      errInner.put("code", 400L);
      errOuter.put("error", errInner);
      String errJson = StrictJson.stringify(errOuter);
      vars.set("auth_error_payload", errJson);
      if (!inFaultFlow) {
        vars.set("callout_aborted", "true");
        return ExecutionResult.ABORT;
      }
      vars.set("error.content", errJson);
      return ExecutionResult.SUCCESS;
    } catch (StrictJson.StrictJsonException sje) {
      setExceptionVariables(sje, msgCtxt);
      if ("prepare_fallback_request".equals(action)) {
        boolean inFaultFlow = vars.getNonEmpty("fault.name") != null;
        vars.set("fallback_ready", "false");
        vars.set("json_malformed_payload_detected", "true");
        vars.set("model_access_denied", "true");
        vars.set("auth_error_status", "400");
        Map<String, Object> errOuter = new LinkedHashMap<>();
        Map<String, Object> errInner = new LinkedHashMap<>();
        errInner.put("type", "invalid_request_error");
        errInner.put("message", "Malformed or invalid JSON request payload.");
        errInner.put("code", 400L);
        errOuter.put("error", errInner);
        String errJson = StrictJson.stringify(errOuter);
        vars.set("auth_error_payload", errJson);
        if (!inFaultFlow) {
          vars.set("callout_aborted", "true");
          return ExecutionResult.ABORT;
        }
        vars.set("error.content", errJson);
      } else if ("apply_fallback_response".equals(action)) {
        vars.set("fallback_succeeded", "false");
      } else if ("format_rate_limit_error".equals(action)) {
        applyRateLimitFallbackError(vars);
      } else {
        applyDeidentifiedFallbackError(vars);
      }
      return ExecutionResult.SUCCESS;
    } catch (Exception e) {
      setExceptionVariables(e, msgCtxt);
      if ("prepare_fallback_request".equals(action)) {
        boolean inFaultFlow = vars.getNonEmpty("fault.name") != null;
        vars.set("fallback_ready", "false");
        vars.set("auth_error_status", "500");
        Map<String, Object> errOuter = new LinkedHashMap<>();
        Map<String, Object> errInner = new LinkedHashMap<>();
        errInner.put("type", "api_error");
        errInner.put("message", "Internal gateway fallback processing error.");
        errInner.put("code", 500L);
        errOuter.put("error", errInner);
        String errJson = StrictJson.stringify(errOuter);
        vars.set("auth_error_payload", errJson);
        if (!inFaultFlow) {
          vars.set("callout_aborted", "true");
          return ExecutionResult.ABORT;
        }
        vars.set("error.content", errJson);
      } else if ("apply_fallback_response".equals(action)) {
        vars.set("fallback_succeeded", "false");
      } else if ("format_rate_limit_error".equals(action)) {
        applyRateLimitFallbackError(vars);
      } else {
        applyDeidentifiedFallbackError(vars);
      }
      return ExecutionResult.SUCCESS;
    }
  }

  private static void applyRateLimitFallbackError(VarCache vars) {
    vars.set("ratelimit_constraint", "rate_limit");
    vars.set("ratelimit_retry_after", "1");
    vars.set("ratelimit_limit_requests", "0");
    vars.set("ratelimit_remaining_requests", "0");
    vars.set("ratelimit_limit_tokens", "0");
    vars.set("ratelimit_remaining_tokens", "0");
    vars.set("ratelimit_error_payload", STATIC_FALLBACK_429_JSON);
  }

  private static void applyDeidentifiedFallbackError(VarCache vars) {
    boolean inFaultFlow =
        vars.getNonEmpty("fault.name") != null || vars.getNonEmpty("error.content") != null;
    long respStatus = inFaultFlow ? 0L : GlobMatcher.asLong(vars.get("response.status.code"), 0L);
    if (inFaultFlow || respStatus < 400L) {
      vars.set("error.content", STATIC_FALLBACK_500_JSON);
      vars.set("auth_error_status", "500");
      vars.set("auth_error_payload", STATIC_FALLBACK_500_JSON);
    } else {
      String cleanUpstreamErr =
          "{\"error\":{\"type\":\"api_error\",\"message\":\"Upstream model provider error.\",\"code\":"
              + respStatus
              + "}}";
      vars.remove("response.header.Server");
      vars.remove("response.header.X-Powered-By");
      vars.remove("response.header.X-AspNet-Version");
      vars.remove("response.header.X-Application-Context");
      vars.set("response.header.Content-Type", "application/json");
      vars.set("response.header.Cache-Control", "no-store");
      vars.set("response.header.X-Content-Type-Options", "nosniff");
      vars.set("response.content", cleanUpstreamErr);
    }
  }

  private void executePrepareFallbackRequest(VarCache vars, MessageContext msgCtxt) {
    String rawFallbackModel = vars.getNonEmpty("fallback_model");
    boolean allowFallbacks = !"false".equals(vars.getString("allow_fallbacks"));
    if (rawFallbackModel == null || rawFallbackModel.trim().isEmpty() || !allowFallbacks) {
      vars.set("fallback_ready", "false");
      return;
    }
    long clientStartMs = GlobMatcher.asLong(vars.get("client.received.start.timestamp"), 0L);
    long nowMs = GlobMatcher.asLong(vars.get("system.timestamp"), 0L);
    if (clientStartMs > 0L && nowMs > clientStartMs && (nowMs - clientStartMs) >= 240000L) {
      vars.set("fallback_ready", "false");
      return;
    }

    vars.remove("fallback_anthropic_version");
    vars.remove("fallback_anthropic_beta");
    vars.remove("fallback_openai_org");
    vars.remove("fallback_openai_project");
    vars.remove("private.fallback_auth_authorization");
    vars.remove("private.fallback_header_x_api_key");
    vars.remove("private.fallback_header_api_key");
    vars.remove("fallback_caller_stream");
    vars.remove("fallback_caller_include_usage");
    vars.remove("fallback_response_content_type");

    String fallbackModel = rawFallbackModel.trim();
    String candPrefix = null;
    int slashIdx = fallbackModel.indexOf('/');
    if (slashIdx != -1) {
      candPrefix = fallbackModel.substring(0, slashIdx);
      fallbackModel = fallbackModel.substring(slashIdx + 1);
    } else {
      String savedPrefixesStr = vars.getNonEmpty("resolved_prefixes_json");
      if (savedPrefixesStr != null) {
        try {
          Object parsed = StrictJson.parse(savedPrefixesStr, false);
          if (parsed instanceof List) {
            List<?> savedPrefixes = (List<?>) parsed;
            if (savedPrefixes.size() > 1 && savedPrefixes.get(1) != null) {
              candPrefix = String.valueOf(savedPrefixes.get(1));
            }
          }
        } catch (Exception ignored) {
          // ignore
        }
      }
    }

    if (candPrefix != null && !GlobMatcher.isSafeSegment(candPrefix)) {
      candPrefix = null;
    }
    if (!GlobMatcher.isSafeQuotaId(fallbackModel)) {
      vars.set("fallback_ready", "false");
      return;
    }

    String defaultPublisher = vars.getOrDefault("propertyset.model_locations.default.publisher", "google");
    String defaultFormat = vars.getOrDefault("propertyset.model_locations.default.format", "gemini");
    String rawCfgProj = vars.getNonEmpty("propertyset.config.project_id");
    if ("{organization.name}".equals(rawCfgProj)) {
      rawCfgProj = null;
    }
    String gatewayProj;
    if (rawCfgProj != null && !"your-gcp-project-id".equals(rawCfgProj)) {
      gatewayProj = rawCfgProj;
    } else {
      String rawGcpProj = vars.getNonEmpty("propertyset.config.gcp_project_id");
      if ("{organization.name}".equals(rawGcpProj)) {
        rawGcpProj = null;
      }
      String flowGcpProj = vars.getNonEmpty("gcp_project_id");
      if ("{organization.name}".equals(flowGcpProj) || "your-gcp-project-id".equals(flowGcpProj)) {
        flowGcpProj = null;
      }
      String orgName = vars.getNonEmpty("organization.name");
      if ("your-gcp-project-id".equals(rawCfgProj) && orgName != null) {
        rawCfgProj = orgName;
      }
      gatewayProj = firstNonEmpty(rawCfgProj, rawGcpProj, flowGcpProj, orgName, "");
    }
    String projectId;
    if (!RequestRouterAndTranscoderCallout.isProjectOverridesActive(vars)) {
      projectId = gatewayProj;
    } else {
      String rawPersona = vars.getNonEmpty("identity_persona");
      if (rawPersona == null) {
        rawPersona =
            RequestRouterAndTranscoderCallout.resolveAnchoredIdentityPersona(
                vars, vars.getNonEmpty("apiproduct.name"));
      }
      String safePersona = GlobMatcher.isSafeSegment(rawPersona) ? rawPersona : "default";
      String ruleProj = vars.getNonEmpty("rule_vertex_project_id");
      projectId =
          RequestRouterAndTranscoderCallout.resolveModelVertexProjectId(
              vars, fallbackModel, safePersona, ruleProj, gatewayProj);
    }
    String requestFormat = vars.getOrDefault("request_format", "claude").toLowerCase(Locale.ROOT);
    boolean isEmbeddings = "true".equals(vars.getString("is_embeddings")) || fallbackModel.contains("embedding");
    String defaultLoc = isEmbeddings ? "us-central1" : "global";

    String configuredPublisher = vars.getNonEmpty("propertyset.model_locations." + fallbackModel + ".publisher");
    String publisher = firstNonEmpty(
        configuredPublisher,
        candPrefix,
        GlobMatcher.isOpenAiModelName(fallbackModel) ? "openai" : defaultPublisher);

    String clientFallbackUrl = vars.getNonEmpty("verifyapikey.VA-ApiKey." + fallbackModel + "_url");
    boolean urlFromClientApp = clientFallbackUrl != null;
    String customUrl =
        clientFallbackUrl != null
            ? clientFallbackUrl
            : vars.getNonEmpty("propertyset.model_locations." + fallbackModel + ".url");

    if ("openai".equals(publisher) && customUrl == null) {
      String clientOpenAiBaseUrl = vars.getNonEmpty("verifyapikey.VA-ApiKey.openai_base_url");
      if (clientOpenAiBaseUrl != null) {
        urlFromClientApp = true;
      }
      String openAiBaseUrl =
          clientOpenAiBaseUrl != null
              ? clientOpenAiBaseUrl
              : vars.getOrDefault(
                  "propertyset.config.openai_base_url", "https://api.openai.com/v1");
      openAiBaseUrl = openAiBaseUrl.replaceAll("/+$", "");
      customUrl = openAiBaseUrl + (isEmbeddings ? "/embeddings" : "/chat/completions");
    }

    boolean isValidatedGoogleVertexUrl = true;
    if (customUrl != null) {
      if (!GlobMatcher.isSafeUpstreamHttpsUrl(
          customUrl, vars.getNonEmpty("propertyset.config.allowed_upstream_hosts"))) {
        vars.set("fallback_ready", "false");
        return;
      }
      if (GlobMatcher.isGoogleCloudUrl(customUrl)) {
        isValidatedGoogleVertexUrl =
            RequestRouterAndTranscoderCallout.isAllowedCallerVertexUrl(
                customUrl, gatewayProj, projectId, vars);
        if (!isValidatedGoogleVertexUrl) {
          vars.set("fallback_ready", "false");
          return;
        }
      } else {
        isValidatedGoogleVertexUrl = false;
      }
    }

    String configuredFormat = vars.getNonEmpty("propertyset.model_locations." + fallbackModel + ".format");
    String fallbackFormat = (configuredFormat != null
            ? configuredFormat
            : ("anthropic".equals(publisher)
                ? "anthropic"
                : ((!"google".equals(publisher) || customUrl != null) ? "openai" : defaultFormat)))
        .toLowerCase(Locale.ROOT);

    String fallbackEndpointLoc = defaultLoc;
    String fallbackModelLoc = defaultLoc;
    if ("anthropic".equals(publisher)) {
      fallbackEndpointLoc = vars.getOrDefault("propertyset.model_locations.default_claude.endpoint", "us-east5");
      fallbackModelLoc = vars.getOrDefault("propertyset.model_locations.default_claude.model", "us-east5");
    } else if ("openai".equals(fallbackFormat) && !"google".equals(publisher) && customUrl == null) {
      fallbackEndpointLoc = vars.getOrDefault("propertyset.model_locations.default_openai.endpoint", defaultLoc);
      fallbackModelLoc = vars.getOrDefault("propertyset.model_locations.default_openai.model", defaultLoc);
    }

    String endpointLocation =
        vars.getOrDefault("propertyset.model_locations." + fallbackModel + ".endpoint", fallbackEndpointLoc);
    String modelLocation =
        vars.getOrDefault("propertyset.model_locations." + fallbackModel + ".model", fallbackModelLoc);
    if (!GlobMatcher.isSafeLocation(endpointLocation)) {
      endpointLocation = defaultLoc;
    }
    if (!GlobMatcher.isSafeLocation(modelLocation)) {
      modelLocation = defaultLoc;
    }
    String endpointHost = (!endpointLocation.isEmpty() && !"global".equals(endpointLocation))
        ? (endpointLocation + "-aiplatform.googleapis.com")
        : "aiplatform.googleapis.com";

    String clientAuthType = vars.getNonEmpty("verifyapikey.VA-ApiKey." + fallbackModel + "_auth_type");
    if (clientAuthType != null && "google_iam".equalsIgnoreCase(clientAuthType.trim())) {
      clientAuthType = null;
    }
    String authType =
        clientAuthType != null
            ? clientAuthType
            : vars.getNonEmpty("propertyset.model_locations." + fallbackModel + ".auth_type");
    String normAuthType = authType != null ? authType.toLowerCase(Locale.ROOT) : "";
    boolean useGoogleIam = isValidatedGoogleVertexUrl
        && ((!"openai".equals(publisher)
                && !"bearer".equals(normAuthType)
                && !"header".equals(normAuthType)
                && !"apikey".equals(normAuthType)
                && !"api_key".equals(normAuthType))
            || "google_iam".equals(normAuthType));

    String upstreamModel = vars.getNonEmpty("propertyset.model_locations." + fallbackModel + ".upstream_model");
    String nativeFallbackModel = firstNonEmpty(upstreamModel, fallbackModel);
    int nativeSlashIdx = nativeFallbackModel.indexOf('/');
    if (nativeSlashIdx != -1) {
      nativeFallbackModel = nativeFallbackModel.substring(nativeSlashIdx + 1);
    }

    if (customUrl == null
        && ("gemini".equals(fallbackFormat) || "anthropic".equals(fallbackFormat))
        && !GlobMatcher.isSafeSegment(nativeFallbackModel)) {
      vars.set("fallback_ready", "false");
      return;
    }

    String targetUrl;
    if (customUrl != null) {
      targetUrl = customUrl;
      if ("anthropic".equals(fallbackFormat) && targetUrl.contains(":streamRawPredict")) {
        targetUrl = targetUrl.replace(":streamRawPredict", ":rawPredict");
      } else if ("gemini".equals(fallbackFormat) && targetUrl.contains(":streamGenerateContent")) {
        targetUrl = targetUrl.replace(":streamGenerateContent", ":generateContent")
            .replaceAll("\\?alt=sse(&|$)", "");
      } else if (isEmbeddings && targetUrl.contains("/chat/completions")) {
        targetUrl = targetUrl.replaceAll("/chat/completions/?$", "/embeddings");
      }
    } else if ("gemini".equals(fallbackFormat)) {
      if (isEmbeddings) {
        String embLoc = (!modelLocation.isEmpty() && !"global".equals(modelLocation)) ? modelLocation : "us-central1";
        String predictHost = "aiplatform.googleapis.com".equals(endpointHost)
            ? (embLoc + "-aiplatform.googleapis.com")
            : endpointHost;
        targetUrl = "https://" + predictHost + "/v1/projects/" + projectId + "/locations/" + embLoc
            + "/publishers/google/models/" + nativeFallbackModel + ":predict";
      } else {
        targetUrl = "https://" + endpointHost + "/v1/projects/" + projectId + "/locations/" + modelLocation
            + "/publishers/google/models/" + nativeFallbackModel + ":generateContent";
      }
    } else if ("anthropic".equals(fallbackFormat)) {
      targetUrl = "https://" + endpointHost + "/v1/projects/" + projectId + "/locations/" + modelLocation
          + "/publishers/anthropic/models/" + nativeFallbackModel + ":rawPredict";
    } else {
      targetUrl = "https://" + endpointHost + "/v1/projects/" + projectId + "/locations/" + modelLocation
          + "/endpoints/openapi/" + (isEmbeddings ? "embeddings" : "chat/completions");
    }

    String hostAndPath = targetUrl.replaceFirst("^(?i)https?://", "");
    int firstSlashIdx = hostAndPath.indexOf('/');
    String targetHost = (firstSlashIdx != -1) ? hostAndPath.substring(0, firstSlashIdx) : hostAndPath;
    String targetPath = (firstSlashIdx != -1) ? hostAndPath.substring(firstSlashIdx + 1) : "";
    vars.set("fallback_target_host", targetHost);
    vars.set("fallback_target_path", targetPath);
    vars.set("fallback_target_host_and_path", hostAndPath);

    Map<String, String> outboundHeaders = !useGoogleIam ? new LinkedHashMap<>(6) : null;
    if (!useGoogleIam) {
      String authHeader =
          vars.firstNonEmptyKey(
              "verifyapikey.VA-ApiKey." + fallbackModel + "_auth_header",
              "verifyapikey.VA-ApiKey.upstream_auth_header",
              "propertyset.model_locations." + fallbackModel + ".auth_header");

      String clientKeyRef =
          vars.firstNonEmptyKey(
              "verifyapikey.VA-ApiKey." + fallbackModel + "_api_key_ref",
              "verifyapikey.VA-ApiKey." + publisher + "_api_key_ref",
              "openai".equals(publisher) ? "verifyapikey.VA-ApiKey.openai_api_key_ref" : null,
              "verifyapikey.VA-ApiKey.upstream_api_key_ref");
      String tokenVal =
          vars.firstNonEmptyKey(
              GlobMatcher.isSafeTokenRef(clientKeyRef) ? clientKeyRef.trim() : null,
              "verifyapikey.VA-ApiKey." + fallbackModel + "_api_key",
              "verifyapikey.VA-ApiKey." + publisher + "_api_key",
              "openai".equals(publisher) ? "verifyapikey.VA-ApiKey.openai_api_key" : null,
              "verifyapikey.VA-ApiKey.upstream_api_key");

      if (!urlFromClientApp && tokenVal == null) {
        String productKeyRef =
            vars.firstNonEmptyKey(
                "apiproduct." + fallbackModel + "_api_key_ref",
                "apiproduct." + publisher + "_api_key_ref",
                "openai".equals(publisher) ? "apiproduct.openai_api_key_ref" : null,
                "apiproduct.upstream_api_key_ref");
        tokenVal =
            vars.firstNonEmptyKey(
                GlobMatcher.isSafeTokenRef(productKeyRef) ? productKeyRef.trim() : null,
                "apiproduct." + fallbackModel + "_api_key",
                "apiproduct." + publisher + "_api_key",
                "openai".equals(publisher) ? "apiproduct.openai_api_key" : null,
                "apiproduct.upstream_api_key");
      }
      if (!urlFromClientApp && tokenVal == null) {
        String authTokenRef = vars.getNonEmpty("propertyset.model_locations." + fallbackModel + ".auth_token_ref");
        tokenVal =
            vars.firstNonEmptyKey(
                GlobMatcher.isSafeTokenRef(authTokenRef) ? authTokenRef.trim() : null,
                "propertyset.model_locations." + fallbackModel + ".auth_token",
                "propertyset.config." + publisher + "_api_key",
                "openai".equals(publisher) ? "propertyset.config.openai_api_key" : null);
      }

      if (tokenVal != null && !"none".equals(normAuthType) && !"google_iam".equals(normAuthType)) {
        String cleanTokenVal = GlobMatcher.stripControlChars(tokenVal);
        String trimmedAuthHdr = authHeader != null ? authHeader.trim() : "";
        boolean isCustomHeader =
            !trimmedAuthHdr.isEmpty() && !"authorization".equalsIgnoreCase(trimmedAuthHdr);
        if (isCustomHeader) {
          if (!"content-type".equalsIgnoreCase(trimmedAuthHdr)
              && GlobMatcher.isSafeHeaderName(trimmedAuthHdr)
              && !cleanTokenVal.isEmpty()) {
            outboundHeaders.put(trimmedAuthHdr, cleanTokenVal);
            String lowerH = trimmedAuthHdr.toLowerCase(Locale.ROOT);
            if ("x-api-key".equals(lowerH)) {
              vars.set("private.fallback_header_x_api_key", cleanTokenVal);
            } else if ("api-key".equals(lowerH)) {
              vars.set("private.fallback_header_api_key", cleanTokenVal);
            } else {
              vars.set("private.fallback_custom_auth_header", trimmedAuthHdr);
              vars.set("private.fallback_custom_auth_value", cleanTokenVal);
            }
          }
        } else if ("header".equals(normAuthType)
            && !trimmedAuthHdr.isEmpty()
            && "authorization".equalsIgnoreCase(trimmedAuthHdr)) {
          if (!cleanTokenVal.isEmpty()) {
            outboundHeaders.put("Authorization", cleanTokenVal);
            vars.set("private.fallback_auth_authorization", cleanTokenVal);
          }
        } else if (!cleanTokenVal.isEmpty()) {
          String bearerVal = "Bearer " + cleanTokenVal;
          outboundHeaders.put("Authorization", bearerVal);
          vars.set("private.fallback_auth_authorization", bearerVal);
        }
      }

      String openaiOrgId =
          vars.firstNonEmptyKey(
              "verifyapikey.VA-ApiKey.openai_org_id",
              "apiproduct.openai_org_id",
              "propertyset.model_locations." + fallbackModel + ".openai_org_id",
              "propertyset.config.openai_org_id");
      if (openaiOrgId != null) {
        String cleanOrg = GlobMatcher.stripControlChars(openaiOrgId);
        if (!cleanOrg.isEmpty()) {
          vars.set("fallback_openai_org", cleanOrg);
          outboundHeaders.put("OpenAI-Organization", cleanOrg);
        }
      }

      String openaiProjectId =
          vars.firstNonEmptyKey(
              "verifyapikey.VA-ApiKey.openai_project_id",
              "apiproduct.openai_project_id",
              "propertyset.model_locations." + fallbackModel + ".openai_project_id",
              "propertyset.config.openai_project_id");
      if (openaiProjectId != null) {
        String cleanProj = GlobMatcher.stripControlChars(openaiProjectId);
        if (!cleanProj.isEmpty()) {
          vars.set("fallback_openai_project", cleanProj);
          outboundHeaders.put("OpenAI-Project", cleanProj);
        }
      }
    }

    String rawPayloadStr =
        vars.firstNonEmptyKeyOrDefault(
            "{}", "raw_client_payload", "original_request_body", "request.content");
    boolean checkDuplicateKeys = !"true".equals(vars.getString("payload_strict_validated"));
    Map<String, Object> rawBody = StrictJson.parseObject(rawPayloadStr, checkDuplicateKeys);

    Object rawStreamVal = rawBody.get("stream");
    Object ctxStreamVal = vars.get("stream");
    boolean callerStream =
        !isEmbeddings
            && (Boolean.TRUE.equals(ctxStreamVal)
                || "true".equalsIgnoreCase(String.valueOf(ctxStreamVal))
                || Boolean.TRUE.equals(rawStreamVal)
                || "true".equalsIgnoreCase(String.valueOf(rawStreamVal)));
    boolean callerIncludeUsage =
        "true".equals(vars.getString("client_requested_include_usage"));
    if (!callerIncludeUsage && rawBody.get("stream_options") instanceof Map) {
      Map<String, Object> rawStreamOpts = GlobMatcher.asMap(rawBody.get("stream_options"));
      if (rawStreamOpts != null
          && (Boolean.TRUE.equals(rawStreamOpts.get("include_usage"))
              || "true".equalsIgnoreCase(String.valueOf(rawStreamOpts.get("include_usage"))))) {
        callerIncludeUsage = true;
      }
    }
    vars.set("fallback_caller_stream", callerStream ? "true" : "false");
    if (callerIncludeUsage) {
      vars.set("fallback_caller_include_usage", "true");
    }

    rawBody.remove("models");
    rawBody.remove("plugins");
    rawBody.remove("provider");
    rawBody.remove("stream");
    rawBody.remove("stream_options");

    Map<String, Object> fallbackPayload;

    if ("openai".equals(fallbackFormat)) {
      boolean isVertexOpenApi =
          targetUrl.contains("googleapis.com") && targetUrl.contains("/endpoints/openapi/");
      String rawOaiModel = firstNonEmpty(upstreamModel, fallbackModel);
      String oaiModelName =
          (isVertexOpenApi && rawOaiModel.indexOf('/') == -1)
              ? (publisher + "/" + rawOaiModel)
              : rawOaiModel;
      if (isEmbeddings) {
        fallbackPayload = rawBody;
      } else {
        fallbackPayload =
            RequestRouterAndTranscoderCallout.transcodeRequestToOpenAiAst(rawBody, requestFormat);
        fallbackPayload.remove("models");
        fallbackPayload.remove("plugins");
        fallbackPayload.remove("provider");
        fallbackPayload.remove("stream");
        fallbackPayload.remove("stream_options");
        RequestRouterAndTranscoderCallout.stripThoughtSignatureFromOpenAiToolCalls(fallbackPayload);
        if (useGoogleIam) {
          RequestRouterAndTranscoderCallout.validateOpenAiMessagesMediaForVertexIam(
              fallbackPayload, vars);
        }
      }
      fallbackPayload.put("model", oaiModelName);
      if (!isEmbeddings
          && ("openai".equalsIgnoreCase(publisher) || targetUrl.contains("api.openai.com"))
          && RequestRouterAndTranscoderCallout.isOpenAiReasoningModel(oaiModelName)) {
        if (fallbackPayload.get("max_tokens") != null) {
          if (fallbackPayload.get("max_completion_tokens") == null) {
            fallbackPayload.put("max_completion_tokens", fallbackPayload.get("max_tokens"));
          }
          fallbackPayload.remove("max_tokens");
        }
        Object tempVal = fallbackPayload.get("temperature");
        if (tempVal != null && GlobMatcher.asDouble(tempVal, 1.0) != 1.0) {
          fallbackPayload.remove("temperature");
        }
        fallbackPayload.remove("top_p");
      }
    } else if ("anthropic".equals(fallbackFormat)) {
      String configuredAnthropicVersion =
          vars.getNonEmpty("propertyset.model_locations." + fallbackModel + ".anthropic_version");
      String configuredAnthropicBeta =
          vars.getNonEmpty("propertyset.model_locations." + fallbackModel + ".anthropic_beta");
      fallbackPayload =
          RequestRouterAndTranscoderCallout.transcodeRequestToAnthropicAst(
              rawBody, requestFormat, configuredAnthropicVersion, false, vars);
      boolean isVertexRawPredict = useGoogleIam || targetUrl.contains(":rawPredict");
      if (isVertexRawPredict) {
        fallbackPayload.put(
            "anthropic_version",
            configuredAnthropicVersion != null ? configuredAnthropicVersion : "vertex-2023-10-16");
        fallbackPayload.remove("model");
      } else {
        fallbackPayload.remove("anthropic_version");
        fallbackPayload.put("model", firstNonEmpty(upstreamModel, fallbackModel));
        String antVer =
            GlobMatcher.stripControlChars(
                configuredAnthropicVersion != null ? configuredAnthropicVersion : "2023-06-01");
        if (!antVer.isEmpty()) {
          vars.set("fallback_anthropic_version", antVer);
          if (outboundHeaders != null) {
            outboundHeaders.put("anthropic-version", antVer);
          }
        }
        if (configuredAnthropicBeta != null) {
          String cleanBeta = GlobMatcher.stripControlChars(configuredAnthropicBeta);
          if (!cleanBeta.isEmpty()) {
            vars.set("fallback_anthropic_beta", cleanBeta);
            if (outboundHeaders != null) {
              outboundHeaders.put("anthropic-beta", cleanBeta);
            }
          }
        }
      }
    } else {
      if (isEmbeddings && "openai".equals(requestFormat)) {
        fallbackPayload = new LinkedHashMap<>();
        List<Object> instances = new ArrayList<>();
        Object inputObj = rawBody.get("input");
        Object taskType = rawBody.get("task_type");
        if (inputObj instanceof String) {
          Map<String, Object> inst = new LinkedHashMap<>();
          inst.put("content", inputObj);
          if (taskType != null) {
            inst.put("task_type", taskType);
          }
          instances.add(inst);
        } else if (inputObj instanceof List) {
          List<?> inList = (List<?>) inputObj;
          if (inList.isEmpty()) {
            vars.set("fallback_ready", "false");
            return;
          }
          for (Object item : inList) {
            if (!(item instanceof String)) {
              vars.set("fallback_ready", "false");
              return;
            }
            Map<String, Object> inst = new LinkedHashMap<>();
            inst.put("content", item);
            if (taskType != null) {
              inst.put("task_type", taskType);
            }
            instances.add(inst);
          }
        } else {
          vars.set("fallback_ready", "false");
          return;
        }
        fallbackPayload.put("instances", instances);
        if (rawBody.get("dimensions") != null) {
          Map<String, Object> params = new LinkedHashMap<>();
          params.put("outputDimensionality", GlobMatcher.asLong(rawBody.get("dimensions"), 0L));
          fallbackPayload.put("parameters", params);
        }
      } else {
        fallbackPayload =
            RequestRouterAndTranscoderCallout.transcodeRequestToGeminiAst(
                rawBody, fallbackModel, vars);
      }
    }

    String fallbackPayloadJson = StrictJson.stringify(fallbackPayload);
    if (!useGoogleIam && outboundHeaders != null) {
      buildExternalFallbackRequestMessage(vars, msgCtxt, outboundHeaders, fallbackPayloadJson);
    }

    vars.set("fallback_model", fallbackModel);
    vars.set("fallback_format", fallbackFormat);
    vars.set("fallback_publisher", publisher);
    vars.set("fallback_use_google_iam", useGoogleIam ? "true" : "false");
    vars.set("fallback_request_payload", fallbackPayloadJson);
    vars.set("fallback_ready", "true");
  }

  private static void buildExternalFallbackRequestMessage(
      VarCache vars, MessageContext msgCtxt, Map<String, String> headers, String jsonPayload) {
    if (msgCtxt == null) {
      return;
    }
    Object existingFb = vars.get("fallbackRequest");
    Message fbMsg = null;
    if (existingFb instanceof Message) {
      fbMsg = (Message) existingFb;
    } else {
      try {
        fbMsg = msgCtxt.createMessage(null);
        if (fbMsg != null) {
          msgCtxt.setVariable("fallbackRequest", fbMsg);
        }
      } catch (Throwable ignored) {
        return;
      }
    }
    if (fbMsg == null) {
      return;
    }
    Set<String> existingHeaders = fbMsg.getHeaderNames();
    if (existingHeaders != null && !existingHeaders.isEmpty()) {
      for (String hName : new ArrayList<>(existingHeaders)) {
        fbMsg.removeHeader(hName);
      }
    }
    fbMsg.setHeader("Content-Type", "application/json");
    for (Map.Entry<String, String> entry : headers.entrySet()) {
      String hKey = entry.getKey();
      String hVal = entry.getValue();
      if (hKey != null && !hKey.isEmpty() && hVal != null && !hVal.isEmpty()) {
        fbMsg.setHeader(hKey, hVal);
      }
    }
    if (jsonPayload != null) {
      fbMsg.setContent(jsonPayload);
    }
  }

  private void executeApplyFallbackResponse(VarCache vars) {
    long fbStatus = GlobMatcher.asLong(vars.get("fallbackResponse.status.code"), 0L);
    String fbContent = vars.getNonEmpty("fallbackResponse.content");

    if (!(fbStatus >= 200L && fbStatus < 300L && fbContent != null)) {
      vars.set("fallback_succeeded", "false");
      return;
    }

    String fbModel =
        vars.firstNonEmptyKeyOrDefault("gemini-3.5-flash", "fallback_model", "model");
    String fbFormat = vars.getOrDefault("fallback_format", "gemini").toLowerCase(Locale.ROOT);
    String fbPublisher = vars.getOrDefault("fallback_publisher", "google");
    String reqFormat = vars.getOrDefault("request_format", "claude").toLowerCase(Locale.ROOT);
    boolean isEmbeddings = "true".equals(vars.getString("is_embeddings"));

    Map<String, Object> fbBody = StrictJson.parseObject(fbContent, false);

    String normText = "";
    List<Map<String, Object>> normToolCalls = new ArrayList<>();
    List<Map<String, Object>> normThinkingBlocks = new ArrayList<>();
    boolean includeClaudeThinking =
        "claude".equals(reqFormat) && "true".equals(vars.getString("anthropic_thinking_requested"));
    String normFinishCategory = "stop";
    long uncachedIn = 0L;
    long cacheRead = 0L;
    long cacheWrite = 0L;
    long outTokens = 0L;
    long thinkingTokens = 0L;

    List<Object> candidates = GlobMatcher.asList(fbBody.get("candidates"));
    if ("gemini".equals(fbFormat) || candidates != null) {
      Map<String, Object> cand = (candidates != null && !candidates.isEmpty())
          ? GlobMatcher.asMap(candidates.get(0))
          : null;
      Map<String, Object> contentMap = cand != null ? GlobMatcher.asMap(cand.get("content")) : null;
      List<Object> parts = contentMap != null ? GlobMatcher.asList(contentMap.get("parts")) : null;
      List<String> tParts = new ArrayList<>();
      if (parts != null) {
        for (Object pObj : parts) {
          Map<String, Object> part = GlobMatcher.asMap(pObj);
          if (part == null) {
            continue;
          }
          if (Boolean.TRUE.equals(part.get("thought"))
              || "true".equals(String.valueOf(part.get("thought")))) {
            if (includeClaudeThinking) {
              String sig = GlobMatcher.asString(part.get("thoughtSignature"));
              if (part.get("text") != null || (sig != null && !sig.isEmpty())) {
                Map<String, Object> tb = new LinkedHashMap<>();
                tb.put("type", "thinking");
                tb.put("thinking", part.get("text") != null ? String.valueOf(part.get("text")) : "");
                tb.put(
                    "signature",
                    (sig != null && !sig.isEmpty())
                        ? (sig.startsWith("gem_ts:") ? sig : ("gem_ts:" + sig))
                        : "gem_ts:none");
                normThinkingBlocks.add(tb);
              }
            }
            continue;
          }
          if (part.get("text") != null) {
            tParts.add(String.valueOf(part.get("text")));
          }
          if (part.get("functionCall") instanceof Map) {
            Map<String, Object> fc = GlobMatcher.asMap(part.get("functionCall"));
            Map<String, Object> tc = new LinkedHashMap<>();
            tc.put("id", fc.get("id") != null ? fc.get("id") : ("call_" + randomId(8)));
            tc.put("name", fc.get("name"));
            tc.put("argsObj", fc.get("args") != null ? fc.get("args") : new LinkedHashMap<>());
            String fcSig = GlobMatcher.asString(part.get("thoughtSignature"));
            if (fcSig != null && !fcSig.isEmpty()) {
              tc.put("thoughtSignature", fcSig);
            }
            normToolCalls.add(tc);
          }
        }
      }
      normText = String.join("", tParts);
      String gemFinish = cand != null ? GlobMatcher.asString(cand.get("finishReason")) : null;
      if (!normToolCalls.isEmpty()) {
        normFinishCategory = "tool_calls";
      } else if ("MAX_TOKENS".equals(gemFinish)) {
        normFinishCategory = "length";
      } else if (ResponseTranscoderAndCostCallout.isGeminiSafetyFinishReason(gemFinish)) {
        normFinishCategory = "safety";
      }
      Map<String, Object> uMeta = GlobMatcher.asMap(fbBody.get("usageMetadata"));
      if (uMeta != null) {
        long totalPrompt = GlobMatcher.asLong(uMeta.get("promptTokenCount"), 0L);
        cacheRead = GlobMatcher.asLong(uMeta.get("cachedContentTokenCount"), 0L);
        uncachedIn = Math.max(0L, totalPrompt - cacheRead);
        thinkingTokens = GlobMatcher.asLong(uMeta.get("thoughtsTokenCount"), 0L);
        outTokens = GlobMatcher.asLong(uMeta.get("candidatesTokenCount"), 0L) + thinkingTokens;
      }
    } else if ("anthropic".equals(fbFormat) || "message".equals(fbBody.get("type"))) {
      List<Object> contentBlocks = GlobMatcher.asList(fbBody.get("content"));
      if (contentBlocks != null) {
        List<String> aParts = new ArrayList<>();
        for (Object bObj : contentBlocks) {
          Map<String, Object> blk = GlobMatcher.asMap(bObj);
          if (blk == null) {
            continue;
          }
          String blkType = GlobMatcher.asString(blk.get("type"));
          if ("text".equals(blkType) && blk.get("text") != null) {
            aParts.add(String.valueOf(blk.get("text")));
          } else if ("tool_use".equals(blkType)) {
            Map<String, Object> tc = new LinkedHashMap<>();
            tc.put("id", blk.get("id") != null ? blk.get("id") : ("toolu_" + randomId(8)));
            tc.put("name", blk.get("name"));
            tc.put("argsObj", blk.get("input") != null ? blk.get("input") : new LinkedHashMap<>());
            String tuSig = firstNonEmpty(
                GlobMatcher.asString(blk.get("thought_signature")),
                GlobMatcher.asString(blk.get("thoughtSignature")));
            if (tuSig != null && !tuSig.isEmpty()) {
              tc.put("thoughtSignature", tuSig);
            }
            normToolCalls.add(tc);
          }
        }
        normText = String.join("", aParts);
      }
      String antStop = GlobMatcher.asString(fbBody.get("stop_reason"));
      if ("tool_use".equals(antStop) || !normToolCalls.isEmpty()) {
        normFinishCategory = "tool_calls";
      } else if ("max_tokens".equals(antStop)) {
        normFinishCategory = "length";
      } else if ("refusal".equals(antStop)) {
        normFinishCategory = "safety";
      }
      Map<String, Object> aUsage = GlobMatcher.asMap(fbBody.get("usage"));
      if (aUsage != null) {
        uncachedIn = GlobMatcher.asLong(aUsage.get("input_tokens"), 0L);
        cacheRead = GlobMatcher.asLong(aUsage.get("cache_read_input_tokens"), 0L);
        cacheWrite = GlobMatcher.asLong(aUsage.get("cache_creation_input_tokens"), 0L);
        outTokens = GlobMatcher.asLong(aUsage.get("output_tokens"), 0L);
      }
    } else {
      List<Object> choices = GlobMatcher.asList(fbBody.get("choices"));
      Map<String, Object> choice = (choices != null && !choices.isEmpty())
          ? GlobMatcher.asMap(choices.get(0))
          : null;
      Map<String, Object> msg = choice != null ? GlobMatcher.asMap(choice.get("message")) : null;
      if (msg != null) {
        Object msgContent = msg.get("content");
        if (msgContent instanceof String) {
          normText = (String) msgContent;
        } else if (msgContent instanceof List) {
          List<String> oParts = new ArrayList<>();
          for (Object opObj : (List<?>) msgContent) {
            Map<String, Object> op = GlobMatcher.asMap(opObj);
            if (op != null && op.get("text") != null) {
              oParts.add(String.valueOf(op.get("text")));
            }
          }
          normText = String.join("", oParts);
        }
        List<Object> toolCalls = GlobMatcher.asList(msg.get("tool_calls"));
        if (toolCalls != null) {
          for (Object tcObj : toolCalls) {
            Map<String, Object> tCall = GlobMatcher.asMap(tcObj);
            if (tCall == null) {
              continue;
            }
            Map<String, Object> fn = GlobMatcher.asMap(tCall.get("function"));
            Object parsedArgs = new LinkedHashMap<>();
            if (fn != null) {
              Object rawArgs = fn.get("arguments");
              if (rawArgs instanceof String) {
                try {
                  parsedArgs = StrictJson.parse((String) rawArgs, false);
                } catch (Exception e) {
                  Map<String, Object> fallbackArgs = new LinkedHashMap<>();
                  fallbackArgs.put("raw", rawArgs);
                  parsedArgs = fallbackArgs;
                }
              } else if (rawArgs != null) {
                parsedArgs = rawArgs;
              }
            }
            Map<String, Object> tc = new LinkedHashMap<>();
            tc.put("id", tCall.get("id") != null ? tCall.get("id") : ("call_" + randomId(8)));
            tc.put("name", (fn != null && fn.get("name") != null) ? fn.get("name") : "tool");
            tc.put("argsObj", parsedArgs);
            String tcSig = firstNonEmpty(
                GlobMatcher.asString(tCall.get("thought_signature")),
                GlobMatcher.asString(tCall.get("thoughtSignature")));
            if (tcSig != null && !tcSig.isEmpty()) {
              tc.put("thoughtSignature", tcSig);
            }
            normToolCalls.add(tc);
          }
        }
      }
      String oaiFinish = choice != null ? GlobMatcher.asString(choice.get("finish_reason")) : null;
      if ("tool_calls".equals(oaiFinish) || !normToolCalls.isEmpty()) {
        normFinishCategory = "tool_calls";
      } else if ("length".equals(oaiFinish)) {
        normFinishCategory = "length";
      } else if ("content_filter".equals(oaiFinish)) {
        normFinishCategory = "safety";
      }
      Map<String, Object> oUsage = GlobMatcher.asMap(fbBody.get("usage"));
      if (oUsage != null) {
        long oTotalPrompt = oUsage.get("prompt_tokens") != null
            ? GlobMatcher.asLong(oUsage.get("prompt_tokens"), 0L)
            : GlobMatcher.asLong(oUsage.get("input_tokens"), 0L);
        Map<String, Object> pDetails = GlobMatcher.asMap(oUsage.get("prompt_tokens_details"));
        cacheRead = (pDetails != null && pDetails.get("cached_tokens") != null)
            ? GlobMatcher.asLong(pDetails.get("cached_tokens"), 0L)
            : GlobMatcher.asLong(oUsage.get("cache_read_input_tokens"), 0L);
        cacheWrite = GlobMatcher.asLong(oUsage.get("cache_creation_input_tokens"), 0L);
        uncachedIn = Math.max(0L, oTotalPrompt - cacheRead - cacheWrite);
        long rawFbOut = oUsage.get("completion_tokens") != null
            ? GlobMatcher.asLong(oUsage.get("completion_tokens"), 0L)
            : GlobMatcher.asLong(oUsage.get("output_tokens"), 0L);
        Map<String, Object> cDetails = GlobMatcher.asMap(oUsage.get("completion_tokens_details"));
        thinkingTokens = cDetails != null ? GlobMatcher.asLong(cDetails.get("reasoning_tokens"), 0L) : 0L;
        long fbUpstreamTotal = GlobMatcher.asLong(oUsage.get("total_tokens"), 0L);
        outTokens =
            ResponseTranscoderAndCostCallout.normalizeOpenAiCompletionTokens(
                oTotalPrompt, rawFbOut, thinkingTokens, fbUpstreamTotal);
      }
    }

    if ("openai".equals(reqFormat)) {
      normText = ResponseTranscoderAndCostCallout.unwrapMarkdownJsonFenceIfRequested(vars, normText);
    }

    long totalPromptTokens = uncachedIn + cacheRead + cacheWrite;
    long totalTokens = totalPromptTokens + outTokens;

    Map<String, Object> finalBody = fbBody;
    if (isEmbeddings && "openai".equals(reqFormat)) {
      if (fbBody.get("predictions") instanceof List) {
        vars.set("vertex_predict_embeddings", "true");
        finalBody = fbBody;
      } else {
        finalBody = fbBody;
        finalBody.put("model", fbModel);
      }
    } else if ("openai".equals(reqFormat)) {
      if ("openai".equals(fbFormat) && fbBody.get("choices") instanceof List) {
        finalBody = fbBody;
        finalBody.put("model", fbModel);
      } else {
        Map<String, Object> oaiMsgObj = new LinkedHashMap<>();
        oaiMsgObj.put("role", "assistant");
        oaiMsgObj.put("content", !normText.isEmpty() ? normText : null);
        if (!normToolCalls.isEmpty()) {
          List<Object> tcs = new ArrayList<>();
          for (Map<String, Object> ntc : normToolCalls) {
            Map<String, Object> fnObj = new LinkedHashMap<>();
            fnObj.put("name", ntc.get("name"));
            fnObj.put("arguments", StrictJson.stringify(ntc.get("argsObj")));
            Map<String, Object> tcEntry = new LinkedHashMap<>();
            tcEntry.put("id", ntc.get("id"));
            tcEntry.put("type", "function");
            tcEntry.put("function", fnObj);
            if (ntc.get("thoughtSignature") != null) {
              tcEntry.put("thought_signature", ntc.get("thoughtSignature"));
            }
            tcs.add(tcEntry);
          }
          oaiMsgObj.put("tool_calls", tcs);
        }
        Map<String, Object> oaiUsage = new LinkedHashMap<>();
        oaiUsage.put("prompt_tokens", totalPromptTokens);
        oaiUsage.put("completion_tokens", outTokens);
        oaiUsage.put("total_tokens", totalTokens);
        if (cacheRead > 0) {
          Map<String, Object> pDetails = new LinkedHashMap<>();
          pDetails.put("cached_tokens", cacheRead);
          oaiUsage.put("prompt_tokens_details", pDetails);
        }
        if (thinkingTokens > 0) {
          Map<String, Object> cDetails = new LinkedHashMap<>();
          cDetails.put("reasoning_tokens", thinkingTokens);
          oaiUsage.put("completion_tokens_details", cDetails);
        }
        if (cacheWrite > 0) {
          oaiUsage.put("cache_creation_input_tokens", cacheWrite);
        }
        String mappedOaiFinish =
            !normToolCalls.isEmpty()
                ? "tool_calls"
                : ("length".equals(normFinishCategory)
                    ? "length"
                    : ("safety".equals(normFinishCategory) ? "content_filter" : "stop"));
        Map<String, Object> choice0 = new LinkedHashMap<>();
        choice0.put("index", 0L);
        choice0.put("message", oaiMsgObj);
        choice0.put("finish_reason", mappedOaiFinish);
        List<Object> choicesList = new ArrayList<>();
        choicesList.add(choice0);

        finalBody = new LinkedHashMap<>();
        finalBody.put("id", "chatcmpl-fb-" + randomId(10));
        finalBody.put("object", "chat.completion");
        finalBody.put("created", System.currentTimeMillis() / 1000L);
        finalBody.put("model", fbModel);
        finalBody.put("choices", choicesList);
        finalBody.put("usage", oaiUsage);
      }
    } else if ("gemini".equals(reqFormat)) {
      if ("gemini".equals(fbFormat) && candidates != null) {
        finalBody = fbBody;
        finalBody.put("modelVersion", fbModel);
      } else {
        List<Object> gemParts = new ArrayList<>();
        if (!normText.isEmpty()) {
          Map<String, Object> tp = new LinkedHashMap<>();
          tp.put("text", normText);
          gemParts.add(tp);
        }
        for (Map<String, Object> ntc : normToolCalls) {
          Map<String, Object> fc = new LinkedHashMap<>();
          fc.put("name", ntc.get("name"));
          fc.put("args", ntc.get("argsObj"));
          Map<String, Object> fp = new LinkedHashMap<>();
          fp.put("functionCall", fc);
          if (ntc.get("thoughtSignature") != null) {
            fp.put("thoughtSignature", ntc.get("thoughtSignature"));
          }
          gemParts.add(fp);
        }
        Map<String, Object> contentObj = new LinkedHashMap<>();
        contentObj.put("role", "model");
        contentObj.put("parts", gemParts);
        String mappedGemFinish =
            "length".equals(normFinishCategory)
                ? "MAX_TOKENS"
                : ("safety".equals(normFinishCategory) ? "SAFETY" : "STOP");
        Map<String, Object> cand0 = new LinkedHashMap<>();
        cand0.put("content", contentObj);
        cand0.put("finishReason", mappedGemFinish);
        cand0.put("index", 0L);
        List<Object> candList = new ArrayList<>();
        candList.add(cand0);

        Map<String, Object> uMeta = new LinkedHashMap<>();
        uMeta.put("promptTokenCount", totalPromptTokens);
        uMeta.put("candidatesTokenCount", Math.max(0L, outTokens - thinkingTokens));
        uMeta.put("totalTokenCount", totalTokens);
        if (cacheRead > 0) {
          uMeta.put("cachedContentTokenCount", cacheRead);
        }
        if (thinkingTokens > 0) {
          uMeta.put("thoughtsTokenCount", thinkingTokens);
        }

        finalBody = new LinkedHashMap<>();
        finalBody.put("candidates", candList);
        finalBody.put("usageMetadata", uMeta);
        finalBody.put("modelVersion", fbModel);
      }
    } else {
      if ("anthropic".equals(fbFormat) && "message".equals(fbBody.get("type"))) {
        finalBody = fbBody;
        finalBody.put("model", fbModel);
      } else {
        List<Object> antBlocks = new ArrayList<>();
        antBlocks.addAll(normThinkingBlocks);
        if (!normText.isEmpty() || (antBlocks.isEmpty() && normToolCalls.isEmpty())) {
          Map<String, Object> tb = new LinkedHashMap<>();
          tb.put("type", "text");
          tb.put("text", normText);
          antBlocks.add(tb);
        }
        for (Map<String, Object> ntc : normToolCalls) {
          Map<String, Object> tub = new LinkedHashMap<>();
          tub.put("type", "tool_use");
          tub.put("id", ntc.get("id"));
          tub.put("name", ntc.get("name"));
          tub.put("input", ntc.get("argsObj"));
          if (ntc.get("thoughtSignature") != null) {
            tub.put("thought_signature", ntc.get("thoughtSignature"));
          }
          antBlocks.add(tub);
        }
        Map<String, Object> usageObj = new LinkedHashMap<>();
        usageObj.put("input_tokens", uncachedIn);
        usageObj.put("cache_read_input_tokens", cacheRead);
        usageObj.put("cache_creation_input_tokens", cacheWrite);
        usageObj.put("output_tokens", outTokens);

        String mappedAntStop =
            !normToolCalls.isEmpty()
                ? "tool_use"
                : ("length".equals(normFinishCategory)
                    ? "max_tokens"
                    : ("safety".equals(normFinishCategory) ? "refusal" : "end_turn"));

        finalBody = new LinkedHashMap<>();
        finalBody.put("id", "msg_fb_" + randomId(12));
        finalBody.put("type", "message");
        finalBody.put("role", "assistant");
        finalBody.put("model", fbModel);
        finalBody.put("content", antBlocks);
        finalBody.put("stop_reason", mappedAntStop);
        finalBody.put("stop_sequence", null);
        finalBody.put("usage", usageObj);
      }
    }

    String savedCallerStream = vars.getNonEmpty("fallback_caller_stream");
    boolean callerStream;
    if (savedCallerStream != null) {
      callerStream = "true".equalsIgnoreCase(savedCallerStream) && !isEmbeddings;
    } else {
      Object curStream = vars.get("stream");
      callerStream =
          !isEmbeddings
              && (Boolean.TRUE.equals(curStream)
                  || "true".equalsIgnoreCase(String.valueOf(curStream)));
    }
    boolean callerIncludeUsage =
        "true".equals(vars.getString("fallback_caller_include_usage"))
            || "true".equals(vars.getString("client_requested_include_usage"));

    String responseContentType;
    String serializedBody;
    if (callerStream) {
      responseContentType = "text/event-stream; charset=utf-8";
      serializedBody =
          buildSyntheticFallbackSse(
              reqFormat,
              finalBody,
              fbModel,
              normText,
              normToolCalls,
              normFinishCategory,
              uncachedIn,
              cacheRead,
              cacheWrite,
              outTokens,
              thinkingTokens,
              callerIncludeUsage);
    } else if ("gemini".equals(reqFormat)
        && "true".equals(vars.getString("gemini_json_array_stream"))) {
      responseContentType = "application/json";
      List<Object> arrWrap = new ArrayList<>(1);
      arrWrap.add(finalBody);
      serializedBody = StrictJson.stringify(arrWrap);
    } else {
      responseContentType = "application/json";
      serializedBody = StrictJson.stringify(finalBody);
    }

    vars.set("response.status.code", HTTP_STATUS_200);
    vars.set("response.reason.phrase", "OK");
    vars.set("response.header.Content-Type", responseContentType);
    if (callerStream) {
      vars.set("response.header.Cache-Control", "no-cache");
    }
    vars.set("response.content", serializedBody);
    boolean inFaultFlow = vars.getNonEmpty("fault.name") != null;
    String respArmorTpl =
        inFaultFlow
            ? vars.firstNonEmptyKeyOrDefault(
                "",
                "model_armor_response_template",
                "propertyset.config.model_armor_response_template",
                "propertyset.config.model_armor_template")
            : "";
    boolean deferFaultCommitForArmor =
        inFaultFlow
            && !"false".equals(vars.getString("model_armor_response_enabled"))
            && !respArmorTpl.isEmpty()
            && !"none".equalsIgnoreCase(respArmorTpl);
    if (inFaultFlow) {
      vars.set("fault_fallback_recovery", "true");
      if (deferFaultCommitForArmor) {
        vars.set("fault_recovered_body", serializedBody);
        vars.set("fallback_response_content_type", responseContentType);
        vars.set("error.status.code", Integer.valueOf(403));
        vars.set("error.reason.phrase", "Forbidden");
        vars.set("error.header.Content-Type", "application/json");
        vars.set("error.header.X-Content-Type-Options", "nosniff");
        vars.set("error.header.X-Gateway-Model-Armor-Phase", "response");
        vars.set("error.header.X-Gateway-Model-Armor-Blocked-By", "ModelResponse");
        vars.set("error.header.X-Gateway-Model-Armor-Template", respArmorTpl);
        vars.set(
            "error.content",
            "{\"error\":{\"type\":\"policy_violation_error\",\"message\":\"Model response blocked by safety policy.\",\"code\":403}}");
      } else {
        vars.set("error.status.code", HTTP_STATUS_200);
        vars.set("error.reason.phrase", "OK");
        vars.set("error.header.Content-Type", responseContentType);
        if (callerStream) {
          vars.set("error.header.Cache-Control", "no-cache");
        }
        vars.set("error.content", serializedBody);
      }
    }
    if (!"false".equals(vars.getString("model_armor_response_enabled"))) {
      StringBuilder fbScan = new StringBuilder();
      if (!normText.trim().isEmpty()) {
        fbScan.append(normText.trim());
      }
      for (Map<String, Object> ntc : normToolCalls) {
        if (fbScan.length() >= 32768) {
          break;
        }
        if (fbScan.length() > 0) {
          fbScan.append(' ');
        }
        String tName = ntc.get("name") != null ? String.valueOf(ntc.get("name")) : "tool";
        String tArgs = StrictJson.stringify(ntc.get("argsObj") != null ? ntc.get("argsObj") : new LinkedHashMap<>());
        String entry = tName + ": " + tArgs;
        int rem = 32768 - fbScan.length();
        fbScan.append(entry.length() <= rem ? entry : entry.substring(0, rem));
      }
      String trimmedFbScan = fbScan.toString().trim();
      if (!trimmedFbScan.isEmpty()) {
        vars.set("response_partial", trimmedFbScan);
      }
    }
    vars.set("response_partial_extracted", "true");
    if (!"true".equals(vars.getString("vertex_predict_embeddings"))) {
      if ("gemini".equals(reqFormat)) {
        vars.set("prompt_tokens", String.valueOf(totalPromptTokens));
        vars.set("cached_content_tokens", String.valueOf(cacheRead));
        vars.set("thoughts_tokens", String.valueOf(thinkingTokens));
        vars.set("completion_tokens", String.valueOf(Math.max(0L, outTokens - thinkingTokens)));
      } else if ("openai".equals(reqFormat)) {
        vars.set("prompt_tokens", String.valueOf(totalPromptTokens));
        vars.set("uncached_prompt_tokens", String.valueOf(uncachedIn));
        vars.set("cached_prompt_tokens", String.valueOf(cacheRead));
        vars.set("cache_read_input_tokens", String.valueOf(cacheRead));
        vars.set("cache_creation_input_tokens", String.valueOf(cacheWrite));
        vars.set("reasoning_tokens", String.valueOf(thinkingTokens));
        vars.set("completion_tokens", String.valueOf(outTokens));
      } else {
        vars.set("prompt_tokens", String.valueOf(uncachedIn));
        vars.set("uncached_prompt_tokens", String.valueOf(uncachedIn));
        vars.set("cache_read_input_tokens", String.valueOf(cacheRead));
        vars.set("cache_creation_input_tokens", String.valueOf(cacheWrite));
        vars.set("thinking_tokens", String.valueOf(thinkingTokens));
        vars.set("completion_tokens", String.valueOf(outTokens));
      }
      vars.set("total_tokens", String.valueOf(totalTokens));
      vars.set("response_tokens_extracted", "true");
    }
    vars.remove("raw_client_payload");
    vars.remove("original_request_body");

    vars.set("model", fbModel);
    vars.set("primary_model", fbModel);
    vars.set("model_publisher", fbPublisher);
    vars.set("model_format", fbFormat);
    vars.set("route_format", fbFormat);
    vars.set("stream", Boolean.FALSE);
    vars.set("fallback_triggered", "true");
    vars.set("fallback_succeeded", "true");

    String cbState = vars.getOrDefault("circuit_breaker_state", "CLOSED");
    vars.set("response.header.X-Gateway-Routed-Model", fbModel);
    vars.set("response.header.X-Gateway-Fallback-Triggered", "true");
    vars.set("response.header.X-Gateway-Circuit-Breaker", cbState);
    if (inFaultFlow && !deferFaultCommitForArmor) {
      vars.set("error.header.X-Gateway-Requested-Model", vars.getOrDefault("requested_model", fbModel));
      vars.set("error.header.X-Gateway-Routed-Model", fbModel);
      vars.set("error.header.X-Gateway-Fallback-Model", fbModel);
      vars.set("error.header.X-Gateway-Fallback-Triggered", "true");
      vars.set("error.header.X-Gateway-Circuit-Breaker", cbState);
      vars.set("error.header.X-Gateway-Identity-Persona", vars.getOrDefault("identity_persona", "default"));
    }
  }

  private static String buildSyntheticFallbackSse(
      String reqFormat,
      Map<String, Object> finalBody,
      String fbModel,
      String normText,
      List<Map<String, Object>> normToolCalls,
      String normFinishCategory,
      long uncachedIn,
      long cacheRead,
      long cacheWrite,
      long outTokens,
      long thinkingTokens,
      boolean callerIncludeUsage) {
    if ("gemini".equals(reqFormat)) {
      return "data: " + StrictJson.stringify(finalBody) + "\n\n";
    }
    if ("openai".equals(reqFormat)) {
      String chunkId =
          finalBody.get("id") != null
              ? String.valueOf(finalBody.get("id"))
              : ("chatcmpl-fb-" + randomId(10));
      long nowSec = System.currentTimeMillis() / 1000L;
      long createdSec =
          finalBody.get("created") != null
              ? GlobMatcher.asLong(finalBody.get("created"), nowSec)
              : nowSec;
      String mappedOaiFinish =
          !normToolCalls.isEmpty()
              ? "tool_calls"
              : ("length".equals(normFinishCategory)
                  ? "length"
                  : ("safety".equals(normFinishCategory) ? "content_filter" : "stop"));

      Map<String, Object> delta1 = new LinkedHashMap<>();
      delta1.put("role", "assistant");
      if (!normText.isEmpty()) {
        delta1.put("content", normText);
      } else if (normToolCalls.isEmpty()) {
        delta1.put("content", "");
      }
      if (!normToolCalls.isEmpty()) {
        List<Object> deltaTcs = new ArrayList<>(normToolCalls.size());
        for (int i = 0; i < normToolCalls.size(); i++) {
          Map<String, Object> ntc = normToolCalls.get(i);
          Map<String, Object> fnObj = new LinkedHashMap<>();
          fnObj.put("name", ntc.get("name"));
          fnObj.put("arguments", StrictJson.stringify(ntc.get("argsObj")));
          Map<String, Object> tcEntry = new LinkedHashMap<>();
          tcEntry.put("index", Long.valueOf(i));
          tcEntry.put("id", ntc.get("id"));
          tcEntry.put("type", "function");
          tcEntry.put("function", fnObj);
          if (ntc.get("thoughtSignature") != null) {
            tcEntry.put("thought_signature", ntc.get("thoughtSignature"));
          }
          deltaTcs.add(tcEntry);
        }
        delta1.put("tool_calls", deltaTcs);
      }

      long totalPromptTokens = uncachedIn + cacheRead + cacheWrite;
      long totalTokens = totalPromptTokens + outTokens;
      Map<String, Object> oaiUsage = new LinkedHashMap<>();
      oaiUsage.put("prompt_tokens", totalPromptTokens);
      oaiUsage.put("completion_tokens", outTokens);
      oaiUsage.put("total_tokens", totalTokens);
      if (cacheRead > 0L) {
        Map<String, Object> pDetails = new LinkedHashMap<>();
        pDetails.put("cached_tokens", cacheRead);
        oaiUsage.put("prompt_tokens_details", pDetails);
      }
      if (thinkingTokens > 0L) {
        Map<String, Object> cDetails = new LinkedHashMap<>();
        cDetails.put("reasoning_tokens", thinkingTokens);
        oaiUsage.put("completion_tokens_details", cDetails);
      }
      if (cacheWrite > 0L) {
        oaiUsage.put("cache_creation_input_tokens", cacheWrite);
      }

      StringBuilder sse = new StringBuilder(512);
      Map<String, Object> choice1 = new LinkedHashMap<>();
      choice1.put("index", 0L);
      choice1.put("delta", delta1);
      choice1.put("finish_reason", null);
      List<Object> choices1 = new ArrayList<>(1);
      choices1.add(choice1);
      Map<String, Object> chunk1 = new LinkedHashMap<>();
      chunk1.put("id", chunkId);
      chunk1.put("object", "chat.completion.chunk");
      chunk1.put("created", createdSec);
      chunk1.put("model", fbModel);
      chunk1.put("choices", choices1);
      sse.append("data: ").append(StrictJson.stringify(chunk1)).append("\n\n");

      Map<String, Object> choice2 = new LinkedHashMap<>();
      choice2.put("index", 0L);
      choice2.put("delta", new LinkedHashMap<>());
      choice2.put("finish_reason", mappedOaiFinish);
      List<Object> choices2 = new ArrayList<>(1);
      choices2.add(choice2);
      Map<String, Object> chunk2 = new LinkedHashMap<>();
      chunk2.put("id", chunkId);
      chunk2.put("object", "chat.completion.chunk");
      chunk2.put("created", createdSec);
      chunk2.put("model", fbModel);
      chunk2.put("choices", choices2);
      if (!callerIncludeUsage) {
        chunk2.put("usage", oaiUsage);
      }
      sse.append("data: ").append(StrictJson.stringify(chunk2)).append("\n\n");

      if (callerIncludeUsage) {
        Map<String, Object> chunkUsage = new LinkedHashMap<>();
        chunkUsage.put("id", chunkId);
        chunkUsage.put("object", "chat.completion.chunk");
        chunkUsage.put("created", createdSec);
        chunkUsage.put("model", fbModel);
        chunkUsage.put("choices", new ArrayList<>());
        chunkUsage.put("usage", oaiUsage);
        sse.append("data: ").append(StrictJson.stringify(chunkUsage)).append("\n\n");
      }

      sse.append("data: [DONE]\n\n");
      return sse.toString();
    }

    // Anthropic / Claude Messages SSE lifecycle
    String msgId =
        finalBody.get("id") != null
            ? String.valueOf(finalBody.get("id"))
            : ("msg_fb_" + randomId(12));
    String stopReason =
        finalBody.get("stop_reason") != null
            ? String.valueOf(finalBody.get("stop_reason"))
            : (!normToolCalls.isEmpty() ? "tool_use" : "end_turn");

    StringBuilder sse = new StringBuilder(768);
    Map<String, Object> startUsage = new LinkedHashMap<>();
    startUsage.put("input_tokens", uncachedIn);
    startUsage.put("cache_read_input_tokens", cacheRead);
    startUsage.put("cache_creation_input_tokens", cacheWrite);
    startUsage.put("output_tokens", 0L);

    Map<String, Object> startMsg = new LinkedHashMap<>();
    startMsg.put("id", msgId);
    startMsg.put("type", "message");
    startMsg.put("role", "assistant");
    startMsg.put("content", new ArrayList<>());
    startMsg.put("model", fbModel);
    startMsg.put("stop_reason", null);
    startMsg.put("stop_sequence", null);
    startMsg.put("usage", startUsage);

    Map<String, Object> msgStartEvt = new LinkedHashMap<>();
    msgStartEvt.put("type", "message_start");
    msgStartEvt.put("message", startMsg);
    sse.append("event: message_start\ndata: ")
        .append(StrictJson.stringify(msgStartEvt))
        .append("\n\n");

    List<Object> blocks = GlobMatcher.asList(finalBody.get("content"));
    if (blocks != null) {
      for (int idx = 0; idx < blocks.size(); idx++) {
        Map<String, Object> blk = GlobMatcher.asMap(blocks.get(idx));
        if (blk == null) {
          continue;
        }
        String bType = GlobMatcher.asString(blk.get("type"));
        Long idxVal = Long.valueOf(idx);
        if ("thinking".equals(bType)) {
          Map<String, Object> cbStartObj = new LinkedHashMap<>();
          cbStartObj.put("type", "thinking");
          cbStartObj.put("thinking", "");
          Map<String, Object> cbStartEvt = new LinkedHashMap<>();
          cbStartEvt.put("type", "content_block_start");
          cbStartEvt.put("index", idxVal);
          cbStartEvt.put("content_block", cbStartObj);
          sse.append("event: content_block_start\ndata: ")
              .append(StrictJson.stringify(cbStartEvt))
              .append("\n\n");

          String thinkTxt =
              blk.get("thinking") != null ? String.valueOf(blk.get("thinking")) : "";
          if (!thinkTxt.isEmpty()) {
            Map<String, Object> td = new LinkedHashMap<>();
            td.put("type", "thinking_delta");
            td.put("thinking", thinkTxt);
            Map<String, Object> tdEvt = new LinkedHashMap<>();
            tdEvt.put("type", "content_block_delta");
            tdEvt.put("index", idxVal);
            tdEvt.put("delta", td);
            sse.append("event: content_block_delta\ndata: ")
                .append(StrictJson.stringify(tdEvt))
                .append("\n\n");
          }
          String sigTxt = GlobMatcher.asString(blk.get("signature"));
          if (sigTxt != null && !sigTxt.isEmpty()) {
            Map<String, Object> sd = new LinkedHashMap<>();
            sd.put("type", "signature_delta");
            sd.put("signature", sigTxt);
            Map<String, Object> sdEvt = new LinkedHashMap<>();
            sdEvt.put("type", "content_block_delta");
            sdEvt.put("index", idxVal);
            sdEvt.put("delta", sd);
            sse.append("event: content_block_delta\ndata: ")
                .append(StrictJson.stringify(sdEvt))
                .append("\n\n");
          }
        } else if ("tool_use".equals(bType)) {
          Map<String, Object> cbStartObj = new LinkedHashMap<>();
          cbStartObj.put("type", "tool_use");
          cbStartObj.put("id", blk.get("id") != null ? blk.get("id") : ("toolu_" + randomId(8)));
          cbStartObj.put("name", blk.get("name") != null ? blk.get("name") : "tool");
          cbStartObj.put("input", new LinkedHashMap<>());
          String tuSig =
              firstNonEmpty(
                  GlobMatcher.asString(blk.get("thought_signature")),
                  GlobMatcher.asString(blk.get("thoughtSignature")));
          if (tuSig != null && !tuSig.isEmpty()) {
            cbStartObj.put("thought_signature", tuSig);
          }
          Map<String, Object> cbStartEvt = new LinkedHashMap<>();
          cbStartEvt.put("type", "content_block_start");
          cbStartEvt.put("index", idxVal);
          cbStartEvt.put("content_block", cbStartObj);
          sse.append("event: content_block_start\ndata: ")
              .append(StrictJson.stringify(cbStartEvt))
              .append("\n\n");

          Object inputObj = blk.get("input") != null ? blk.get("input") : new LinkedHashMap<>();
          Map<String, Object> ijd = new LinkedHashMap<>();
          ijd.put("type", "input_json_delta");
          ijd.put("partial_json", StrictJson.stringify(inputObj));
          Map<String, Object> ijdEvt = new LinkedHashMap<>();
          ijdEvt.put("type", "content_block_delta");
          ijdEvt.put("index", idxVal);
          ijdEvt.put("delta", ijd);
          sse.append("event: content_block_delta\ndata: ")
              .append(StrictJson.stringify(ijdEvt))
              .append("\n\n");
        } else {
          Map<String, Object> cbStartObj = new LinkedHashMap<>();
          cbStartObj.put("type", "text");
          cbStartObj.put("text", "");
          Map<String, Object> cbStartEvt = new LinkedHashMap<>();
          cbStartEvt.put("type", "content_block_start");
          cbStartEvt.put("index", idxVal);
          cbStartEvt.put("content_block", cbStartObj);
          sse.append("event: content_block_start\ndata: ")
              .append(StrictJson.stringify(cbStartEvt))
              .append("\n\n");

          String txt = blk.get("text") != null ? String.valueOf(blk.get("text")) : "";
          Map<String, Object> txd = new LinkedHashMap<>();
          txd.put("type", "text_delta");
          txd.put("text", txt);
          Map<String, Object> txdEvt = new LinkedHashMap<>();
          txdEvt.put("type", "content_block_delta");
          txdEvt.put("index", idxVal);
          txdEvt.put("delta", txd);
          sse.append("event: content_block_delta\ndata: ")
              .append(StrictJson.stringify(txdEvt))
              .append("\n\n");
        }

        Map<String, Object> cbStopEvt = new LinkedHashMap<>();
        cbStopEvt.put("type", "content_block_stop");
        cbStopEvt.put("index", idxVal);
        sse.append("event: content_block_stop\ndata: ")
            .append(StrictJson.stringify(cbStopEvt))
            .append("\n\n");
      }
    }

    Map<String, Object> mdDelta = new LinkedHashMap<>();
    mdDelta.put("stop_reason", stopReason);
    mdDelta.put("stop_sequence", null);
    Map<String, Object> mdUsage = new LinkedHashMap<>();
    mdUsage.put("output_tokens", outTokens);
    Map<String, Object> msgDeltaEvt = new LinkedHashMap<>();
    msgDeltaEvt.put("type", "message_delta");
    msgDeltaEvt.put("delta", mdDelta);
    msgDeltaEvt.put("usage", mdUsage);
    sse.append("event: message_delta\ndata: ")
        .append(StrictJson.stringify(msgDeltaEvt))
        .append("\n\n");

    Map<String, Object> msgStopEvt = new LinkedHashMap<>();
    msgStopEvt.put("type", "message_stop");
    sse.append("event: message_stop\ndata: ")
        .append(StrictJson.stringify(msgStopEvt))
        .append("\n\n");
    return sse.toString();
  }

  private void executeFormatRateLimitError(VarCache vars) {
    String requestFormat = vars.getOrDefault("request_format", "");
    String proxyName = vars.getOrDefault("proxy.name", "");
    if (requestFormat.isEmpty()) {
      if (proxyName.contains("openai")) {
        requestFormat = "openai";
      } else if (proxyName.contains("gemini")) {
        requestFormat = "gemini";
      } else {
        requestFormat = "claude";
      }
    }

    String faultName = vars.getString("fault.name");
    boolean saFailed = "true".equals(vars.getString("ratelimit.SA-BurstRateLimit.failed"))
        || "SpikeArrestViolation".equals(faultName);
    boolean ptlFailed = "PromptTokenLimitViolation".equals(faultName)
        || (faultName != null && faultName.endsWith("PromptTokenLimitViolation"));
    boolean concFailed = "true".equals(vars.getString("ratelimit.Q-ConcurrencyLimit.failed"));
    boolean preflightExceeded = "true".equals(vars.getString("preflight_quota_exceeded"));
    boolean zeroQuotaEnforced = "true".equals(vars.getString("zero_quota_enforced"));
    boolean preflightPromptExceeded = preflightExceeded && !zeroQuotaEnforced;
    String preflightScope = vars.getOrDefault("preflight_quota_scope", "primary");
    boolean secQuotaFailed = "true".equals(vars.getString("ratelimit.LTQ-SecondaryEnforceOnly.failed"))
        || (preflightExceeded && "secondary".equals(preflightScope));

    String constraint;
    long retryAfterSec = 1L;
    String message;

    String concAllowed =
        vars.firstNonEmptyKeyOrDefault(
            "20",
            "ratelimit.Q-ConcurrencyLimit.allowed.count",
            "concurrency_limit",
            "propertyset.config.default_concurrency_limit");
    String concAvail = vars.getOrDefault("ratelimit.Q-ConcurrencyLimit.available.count", "0");

    String tokenAllowed = vars.getOrDefault("ratelimit.LTQ-EnforceOnly.allowed.count", "0");
    String tokenAvail = vars.getOrDefault("ratelimit.LTQ-EnforceOnly.available.count", "0");
    long expiryTime = GlobMatcher.asLong(vars.get("ratelimit.LTQ-EnforceOnly.expiry.time"), 0L);
    long nowMs = System.currentTimeMillis();

    if (saFailed) {
      String burstRate =
          vars.firstNonEmptyKeyOrDefault(
              "600pm", "burst_rate_limit", "propertyset.config.default_burst_rate");
      constraint = "burst_rate_limit";
      retryAfterSec = 1L;
      message = "Burst rate limit exceeded (" + burstRate
          + "). Too many requests sent in a short interval; please back off and retry after "
          + retryAfterSec + "s.";
    } else if (ptlFailed) {
      String promptRate =
          vars.firstNonEmptyKeyOrDefault(
              "100000pm", "prompt_token_rate_limit", "propertyset.config.default_prompt_token_rate");
      String promptTokens = vars.getNonEmpty("ratelimit.PTL-PromptTokenLimit.userPromptTokenCount");
      constraint = "prompt_token_rate_limit";
      retryAfterSec = 1L;
      message = "Prompt token rate limit exceeded (" + promptRate
          + (promptTokens != null ? ", prompt tokens: " + promptTokens : "")
          + "). Please reduce prompt size or back off and retry after "
          + retryAfterSec + "s.";
    } else if (concFailed) {
      constraint = "concurrency_limit";
      retryAfterSec = 2L;
      concAvail = "0";
      message = "Concurrency limit exceeded (max " + concAllowed
          + " simultaneous active requests per application). Please wait for an in-flight request to complete and retry after "
          + retryAfterSec + "s.";
    } else if (secQuotaFailed) {
      String secScope = vars.getOrDefault("secondary_quota_scope", "user");
      String identityTeam = vars.getOrDefault("identity_team", "default");
      String secQuotaMode = vars.getOrDefault("secondary_quota_mode", "tokens");
      tokenAllowed = vars.getOrDefault("ratelimit.LTQ-SecondaryEnforceOnly.allowed.count", tokenAllowed);
      tokenAvail = preflightPromptExceeded
          ? vars.getOrDefault("ratelimit.LTQ-SecondaryEnforceOnly.available.count", "0")
          : "0";
      long secExpiry = GlobMatcher.asLong(vars.get("ratelimit.LTQ-SecondaryEnforceOnly.expiry.time"), 0L);
      if (secExpiry > nowMs) {
        retryAfterSec = Math.max(1L, (long) Math.ceil((secExpiry - nowMs) / 1000.0));
      } else {
        retryAfterSec = 3600L;
      }
      String secLimitDisplay = "usd".equals(secQuotaMode)
          ? String.format(Locale.US, "$%.2f USD", GlobMatcher.asLong(tokenAllowed, 0L) / 1000000.0)
          : (tokenAllowed + " tokens");
      if ("team".equals(secScope)) {
        constraint = "team_budget_quota";
        if (preflightPromptExceeded) {
          message = "usd".equals(secQuotaMode)
              ? ("Estimated prompt spend exceeds remaining team budget for team '" + identityTeam + "' (limit: " + secLimitDisplay + "). Please reduce prompt size or retry after " + retryAfterSec + "s.")
              : ("Estimated prompt tokens exceed remaining team token budget for team '" + identityTeam + "' (limit: " + secLimitDisplay + "). Please reduce prompt size or retry after " + retryAfterSec + "s.");
        } else {
          message = "usd".equals(secQuotaMode)
              ? ("Team spend budget exceeded for team '" + identityTeam + "' (limit: " + secLimitDisplay + "). Please retry after " + retryAfterSec + "s.")
              : ("Team token budget exceeded for team '" + identityTeam + "' (limit: " + secLimitDisplay + "). Please retry after " + retryAfterSec + "s.");
        }
      } else {
        constraint = "token_quota_secondary";
        if (preflightPromptExceeded) {
          message = "usd".equals(secQuotaMode)
              ? ("Estimated prompt spend exceeds remaining secondary rolling-window spend quota (limit: " + secLimitDisplay + "). Please reduce prompt size or retry after " + retryAfterSec + "s.")
              : ("Estimated prompt tokens exceed remaining secondary rolling-window token quota (limit: " + secLimitDisplay + "). Please reduce prompt size or retry after " + retryAfterSec + "s.");
        } else {
          message = "usd".equals(secQuotaMode)
              ? ("Secondary rolling-window spend quota exceeded (limit: " + secLimitDisplay + "). Please retry after " + retryAfterSec + "s.")
              : ("Secondary rolling-window token quota exceeded (limit: " + secLimitDisplay + "). Please retry after " + retryAfterSec + "s.");
        }
      }
    } else {
      String llmModelQuota =
          vars.firstNonEmptyKey(
              "verifyapikey.VA-ApiKey.apiproduct.developer.llmQuota.limit",
              "apiproduct.developer.llmQuota.limit");
      boolean exceptionActive = "true".equals(vars.getString("quota_exception_active"));
      String priQuotaMode = vars.getOrDefault("primary_quota_mode", "tokens");
      String targetModel = vars.getOrDefault("model", "requested model");
      if (!preflightPromptExceeded) {
        tokenAvail = "0";
      }
      if (expiryTime > nowMs) {
        retryAfterSec = Math.max(1L, (long) Math.ceil((expiryTime - nowMs) / 1000.0));
      } else {
        retryAfterSec = 60L;
      }
      String priLimitDisplay = "usd".equals(priQuotaMode)
          ? String.format(Locale.US, "$%.2f USD", GlobMatcher.asLong(tokenAllowed, 0L) / 1000000.0)
          : (tokenAllowed + " tokens");
      if (exceptionActive) {
        constraint = "individual_exception_quota";
        if (preflightPromptExceeded) {
          message = "usd".equals(priQuotaMode)
              ? ("Estimated prompt spend exceeds remaining individual exception spend quota (limit: " + priLimitDisplay + "). Please reduce prompt size or retry after " + retryAfterSec + "s.")
              : ("Estimated prompt tokens exceed remaining individual exception token quota (limit: " + priLimitDisplay + "). Please reduce prompt size or retry after " + retryAfterSec + "s.");
        } else {
          message = "usd".equals(priQuotaMode)
              ? ("Individual exception spend quota exceeded (limit: " + priLimitDisplay + "). Please retry after " + retryAfterSec + "s.")
              : ("Individual exception token quota exceeded (limit: " + priLimitDisplay + "). Please retry after " + retryAfterSec + "s.");
        }
      } else if (llmModelQuota != null) {
        constraint = "per_model_quota";
        if (preflightPromptExceeded) {
          message = "usd".equals(priQuotaMode)
              ? ("Estimated prompt spend exceeds remaining per-model spend quota for model '" + targetModel + "' (limit: " + priLimitDisplay + "). Please reduce prompt size or retry after " + retryAfterSec + "s.")
              : ("Estimated prompt tokens exceed remaining per-model token quota for model '" + targetModel + "' (limit: " + priLimitDisplay + "). Please reduce prompt size or retry after " + retryAfterSec + "s.");
        } else {
          message = "usd".equals(priQuotaMode)
              ? ("Per-model spend quota exceeded for model '" + targetModel + "' (limit: " + priLimitDisplay + "). Please retry after " + retryAfterSec + "s.")
              : ("Per-model token quota exceeded for model '" + targetModel + "' (limit: " + priLimitDisplay + "). Please retry after " + retryAfterSec + "s.");
        }
      } else {
        constraint = "token_quota_primary";
        if (preflightPromptExceeded) {
          message = "usd".equals(priQuotaMode)
              ? ("Estimated prompt spend exceeds remaining rolling-window spend quota (limit: " + priLimitDisplay + "). Please reduce prompt size or retry after " + retryAfterSec + "s.")
              : ("Estimated prompt tokens exceed remaining rolling-window token quota (limit: " + priLimitDisplay + "). Please reduce prompt size or retry after " + retryAfterSec + "s.");
        } else {
          message = "usd".equals(priQuotaMode)
              ? ("Rolling-window spend quota exceeded (limit: " + priLimitDisplay + "). Please retry after " + retryAfterSec + "s.")
              : ("Rolling-window token quota exceeded (limit: " + priLimitDisplay + "). Please retry after " + retryAfterSec + "s.");
        }
      }
    }

    Map<String, Object> errorPayloadObj = new LinkedHashMap<>();
    if ("openai".equals(requestFormat)) {
      Map<String, Object> err = new LinkedHashMap<>();
      err.put("message", message);
      err.put("type", "rate_limit_error");
      err.put("param", constraint);
      err.put("code", "rate_limit_exceeded");
      err.put("retry_after_seconds", retryAfterSec);
      errorPayloadObj.put("error", err);
    } else if ("gemini".equals(requestFormat)) {
      Map<String, Object> metadata = new LinkedHashMap<>();
      metadata.put("constraint", constraint);
      metadata.put("retry_after_seconds", String.valueOf(retryAfterSec));
      Map<String, Object> detail = new LinkedHashMap<>();
      detail.put("@type", "type.googleapis.com/google.rpc.ErrorInfo");
      detail.put("reason", "RATE_LIMIT_EXCEEDED");
      detail.put("domain", "apigee.googleapis.com");
      detail.put("metadata", metadata);
      List<Object> details = new ArrayList<>();
      details.add(detail);
      Map<String, Object> err = new LinkedHashMap<>();
      err.put("code", 429L);
      err.put("message", message);
      err.put("status", "RESOURCE_EXHAUSTED");
      err.put("details", details);
      errorPayloadObj.put("error", err);
    } else {
      Map<String, Object> err = new LinkedHashMap<>();
      err.put("type", "rate_limit_error");
      err.put("message", message);
      err.put("constraint", constraint);
      err.put("retry_after_seconds", retryAfterSec);
      errorPayloadObj.put("type", "error");
      errorPayloadObj.put("error", err);
    }

    vars.set("ratelimit_constraint", constraint);
    vars.set("ratelimit_retry_after", String.valueOf(retryAfterSec));
    vars.set("ratelimit_limit_requests", concAllowed);
    vars.set("ratelimit_remaining_requests", concAvail);
    vars.set("ratelimit_limit_tokens", tokenAllowed);
    vars.set("ratelimit_remaining_tokens", tokenAvail);
    vars.set("ratelimit_error_payload", StrictJson.stringify(errorPayloadObj));
  }

  /**
   * Populates Model Armor 403 block diagnostics and Sensitive Data Protection (SDP) de-identified
   * findings using the exact {@code ModelArmorFlowInfo} flow variables populated by
   * Apigee's {@code SanitizeUserPrompt} and {@code SanitizeModelResponse} policies.
   */
  private void executeInjectDeidentifiedFinding(VarCache vars) {
    String rawError = vars.getOrDefault("error.content", "");
    if (rawError.isEmpty()
        && "true".equalsIgnoreCase(vars.getString("propertyset.config.sanitize_upstream_errors"))
        && vars.getNonEmpty("fault.name") == null) {
      int respStatus = (int) GlobMatcher.asLong(vars.get("response.status.code"), 0L);
      if (respStatus >= 400) {
        sanitizeUpstreamErrorResponse(vars, respStatus);
        return;
      }
    }

    String responseFilterMatch =
        vars.firstNonEmptyKey(
            "SanitizeModelResponse.SMR-SanitizeModelResponse.filterMatchState",
            "SanitizeModelResponse.SMR-SanitizeFallbackInFault.filterMatchState");
    String responseSdpMatch =
        vars.firstNonEmptyKey(
            "SanitizeModelResponse.SMR-SanitizeModelResponse.sdpFilterResult.deidentifyResult.matchState",
            "SanitizeModelResponse.SMR-SanitizeFallbackInFault.sdpFilterResult.deidentifyResult.matchState");
    boolean responseFallbackArmorFailed =
        "true".equalsIgnoreCase(
            vars.getString("SanitizeModelResponse.SMR-SanitizeFallbackInFault.failed"));
    String reqFilterMatch =
        vars.firstNonEmptyKey(
            "SanitizeUserPrompt.SUP-SanitizeUserPrompt.filterMatchState",
            "SanitizeUserPrompt.SUP-SanitizeUserPromptGemini.filterMatchState");
    String reqSdpMatch =
        vars.firstNonEmptyKey(
            "SanitizeUserPrompt.SUP-SanitizeUserPrompt.sdpFilterResult.deidentifyResult.matchState",
            "SanitizeUserPrompt.SUP-SanitizeUserPromptGemini.sdpFilterResult.deidentifyResult.matchState");

    boolean isResponseBlock =
        "MATCH_FOUND".equals(responseFilterMatch)
            || "MATCH_FOUND".equals(responseSdpMatch)
            || responseFallbackArmorFailed
            || (!rawError.isEmpty() && rawError.contains("sanitizeModelResponseResult"));
    boolean isModelArmorFault =
        isResponseBlock
            || "MATCH_FOUND".equals(reqFilterMatch)
            || "MATCH_FOUND".equals(reqSdpMatch)
            || (!rawError.isEmpty()
                && (rawError.contains("sanitizationResult")
                    || rawError.contains("sanitizeUserPromptResult")));

    if (!isModelArmorFault) {
      String faultName = vars.getOrDefault("fault.name", "").toLowerCase(Locale.ROOT);
      boolean oasFailed =
          "true".equals(vars.getString("OASValidation.OAS-VerifyClaude.failed"))
              || "true".equals(vars.getString("OASValidation.OAS-VerifyOpenAI.failed"))
              || "true".equals(vars.getString("OASValidation.OAS-VerifyGemini.failed"))
              || "true".equals(vars.getString("oasvalidation.OAS-VerifyClaude.failed"))
              || "true".equals(vars.getString("oasvalidation.OAS-VerifyOpenAI.failed"))
              || "true".equals(vars.getString("oasvalidation.OAS-VerifyGemini.failed"))
              || rawError.contains("OASValidation")
              || faultName.contains("oas")
              || faultName.contains("schema")
              || faultName.contains("invalidjson");
      boolean authFailed =
          "true".equalsIgnoreCase(vars.getString("jwt.VJ-VerifyIdpJwt.failed"))
              || "true".equalsIgnoreCase(vars.getString("JWT.VJ-VerifyIdpJwt.failed"))
              || "false".equalsIgnoreCase(vars.getString("jwt.VJ-VerifyIdpJwt.valid"))
              || rawError.contains("steps.jwt.")
              || rawError.contains("VJ-VerifyIdpJwt")
              || rawError.contains("steps.oauth.")
              || faultName.contains("jwt")
              || "invalidtoken".equals(faultName)
              || "invalidsignature".equals(faultName)
              || "tokenexpired".equals(faultName)
              || "tokennotyetvalid".equals(faultName)
              || "invalidclaim".equals(faultName)
              || "algorithmmismatch".equals(faultName)
              || "missingkeyid".equals(faultName)
              || "keynotfound".equals(faultName)
              || faultName.contains("apikey")
              || faultName.contains("accesstoken")
              || faultName.contains("apiproduct")
              || faultName.contains("unauthorized");
      boolean billingFailed =
          faultName.contains("monetization")
              || faultName.contains("mint")
              || faultName.contains("creditlimit");
      String lowerRawErrForTransport = rawError.toLowerCase(Locale.ROOT);
      boolean isHttpAdaptorFault =
          "transport".equalsIgnoreCase(vars.getString("fault.category"))
              || lowerRawErrForTransport.contains("messaging.adaptors.http.flow.")
              || lowerRawErrForTransport.contains("protocol.http.");
      boolean timeoutFailed =
          faultName.contains("timeout")
              || (isHttpAdaptorFault && lowerRawErrForTransport.contains("timeout"));
      boolean upstreamConnFailed =
          isHttpAdaptorFault
              || faultName.contains("serviceunavailable")
              || faultName.contains("hostnotreachable")
              || faultName.contains("noresolvedhost")
              || faultName.contains("unresolved")
              || faultName.contains("ssl")
              || faultName.contains("dns")
              || faultName.contains("unexpectedeof")
              || faultName.contains("prematurelyclosed")
              || faultName.contains("noactivetarget")
              || faultName.contains("badgateway")
              || faultName.contains("connection");

      long status = 500L;
      String errType = "api_error";
      String errMsg = "Internal gateway error.";
      if (oasFailed) {
        String lowerRawError = rawError.toLowerCase(Locale.ROOT);
        if (lowerRawError.contains("no api path found")
            || lowerRawError.contains("unable to find matching path")) {
          status = 404L;
          errType = "not_found_error";
          errMsg = "Requested API endpoint path was not found.";
        } else if (lowerRawError.contains("media type")
            || lowerRawError.contains("content-type")
            || lowerRawError.contains("unsupported media")) {
          status = 415L;
          errType = "invalid_request_error";
          errMsg = "Unsupported Content-Type. Expected 'application/json'.";
        } else if (lowerRawError.contains("not allowed on path")
            || lowerRawError.contains("method not allowed")) {
          status = 405L;
          errType = "invalid_request_error";
          errMsg = "HTTP method is not allowed for this endpoint.";
        } else {
          status = 400L;
          errType = "invalid_request_error";
          errMsg = "Request failed OpenAPI schema validation.";
        }
      } else if (authFailed) {
        status = 401L;
        errType = "authentication_error";
        errMsg = "Missing or invalid authentication credentials.";
      } else if (billingFailed) {
        status = 402L;
        errType = "billing_error";
        errMsg = "Monetization wallet or credit limit exceeded.";
      } else if (timeoutFailed) {
        status = 504L;
        errType = "api_error";
        errMsg = "Upstream model provider timed out.";
      } else if (upstreamConnFailed) {
        status = 502L;
        errType = "api_error";
        errMsg = "Upstream model provider connection error.";
      }

      Map<String, Object> errOuter = new LinkedHashMap<>();
      Map<String, Object> errInner = new LinkedHashMap<>();
      errInner.put("type", errType);
      errInner.put("message", errMsg);
      errInner.put("code", status);
      errOuter.put("error", errInner);
      String cleanJson = StrictJson.stringify(errOuter);
      vars.set("error.content", cleanJson);
      vars.set("auth_error_status", String.valueOf(status));
      vars.set("auth_error_payload", cleanJson);
      return;
    }

    vars.remove("fault_recovered_body");
    Map<String, Object> errorObj = new LinkedHashMap<>();
    if (!rawError.isEmpty()) {
      try {
        Map<String, Object> parsed = StrictJson.parseObject(rawError, false);
        if (parsed != null) {
          errorObj.putAll(parsed);
        }
      } catch (Exception ignored) {
        // Ignore unparseable error.content and initialize a clean diagnostic JSON object
      }
    }

    String blockSource = isResponseBlock ? "ModelResponse" : "UserPrompt";
    String phase = isResponseBlock ? "response" : "request";

    String deidentifiedFinding;
    String sdpIdentifyFindings;
    String activeTemplate;
    String armorSource;

    if (isResponseBlock) {
      deidentifiedFinding =
          vars.firstNonEmptyKeyOrDefault(
              "",
              "SanitizeModelResponse.SMR-SanitizeModelResponse.sdpDeidentifyFindings",
              "SanitizeModelResponse.SMR-SanitizeFallbackInFault.sdpDeidentifyFindings");
      sdpIdentifyFindings =
          vars.firstNonEmptyKeyOrDefault(
              "",
              "SanitizeModelResponse.SMR-SanitizeModelResponse.sdpIdentifyFindings",
              "SanitizeModelResponse.SMR-SanitizeFallbackInFault.sdpIdentifyFindings");
      activeTemplate =
          vars.firstNonEmptyKeyOrDefault(
              "",
              "model_armor_response_template",
              "propertyset.config.model_armor_response_template",
              "propertyset.config.model_armor_template");
      armorSource =
          vars.firstNonEmptyKeyOrDefault("", "model_armor_response_source", "model_armor_source");
    } else {
      deidentifiedFinding =
          vars.firstNonEmptyKeyOrDefault(
              "",
              "SanitizeUserPrompt.SUP-SanitizeUserPrompt.sdpDeidentifyFindings",
              "SanitizeUserPrompt.SUP-SanitizeUserPromptGemini.sdpDeidentifyFindings");
      sdpIdentifyFindings =
          vars.firstNonEmptyKeyOrDefault(
              "",
              "SanitizeUserPrompt.SUP-SanitizeUserPrompt.sdpIdentifyFindings",
              "SanitizeUserPrompt.SUP-SanitizeUserPromptGemini.sdpIdentifyFindings");
      activeTemplate =
          vars.firstNonEmptyKeyOrDefault(
              "",
              "model_armor_request_template",
              "propertyset.config.model_armor_request_template",
              "propertyset.config.model_armor_template");
      armorSource =
          vars.firstNonEmptyKeyOrDefault("", "model_armor_request_source", "model_armor_source");
    }

    String persona = vars.getOrDefault("identity_persona", "default");
    String userId = vars.getOrDefault("identity_user_id", "anonymous");

    errorObj.put("deidentifiedFinding", deidentifiedFinding);
    if (!sdpIdentifyFindings.isEmpty()) {
      errorObj.put("sdpIdentifyFindings", sdpIdentifyFindings);
    }
    errorObj.put("modelArmorPhase", phase);
    errorObj.put("modelArmorTemplate", activeTemplate);
    errorObj.put("modelArmorSource", armorSource);
    errorObj.put("identityPersona", persona);

    String serializedError = StrictJson.stringify(errorObj);
    vars.set("error.content", serializedError);
    vars.set("auth_error_status", "403");
    vars.set("auth_error_payload", serializedError);
    vars.set("error.header.X-Gateway-Model-Armor-Phase", phase);
    vars.set("error.header.X-Gateway-Model-Armor-Blocked-By", blockSource);
    vars.set("error.header.X-Gateway-Model-Armor-Template", activeTemplate);
    vars.set("error.header.X-Gateway-Model-Armor-Source", armorSource);
    vars.set("error.header.X-Gateway-Identity-Persona", persona);

    vars.set("model_armor_blocked_by", blockSource);
    vars.set("model_armor_active_template", activeTemplate);
    vars.set("response.header.X-Gateway-Model-Armor-Phase", phase);
    vars.set("response.header.X-Gateway-Model-Armor-Blocked-By", blockSource);
    vars.set("response.header.X-Gateway-Model-Armor-Template", activeTemplate);
    vars.set("response.header.X-Gateway-Model-Armor-Source", armorSource);
    vars.set("response.header.X-Gateway-Identity-Persona", persona);
    vars.set("private.model_armor.blocked_user", userId);
  }

  @SuppressWarnings("unchecked")
  private void sanitizeUpstreamErrorResponse(VarCache vars, int statusCode) {
    vars.remove("response.header.Server");
    vars.remove("response.header.X-Powered-By");
    vars.remove("response.header.X-AspNet-Version");
    vars.remove("response.header.X-Application-Context");
    vars.set("response.header.Content-Type", "application/json");
    vars.set("response.header.Cache-Control", "no-store");
    vars.set("response.header.X-Content-Type-Options", "nosniff");

    String callerFormat = vars.getOrDefault("request_format", "").toLowerCase(Locale.ROOT);
    if (callerFormat.isEmpty()) {
      String proxyName = vars.getOrDefault("proxy.name", "").toLowerCase(Locale.ROOT);
      if (proxyName.contains("openai")) {
        callerFormat = "openai";
      } else if (proxyName.contains("gemini")) {
        callerFormat = "gemini";
      } else {
        callerFormat = "claude";
      }
    }

    String rawResp = vars.getOrDefault("response.content", "");
    Map<String, Object> parsedObj = null;
    if (!rawResp.isEmpty() && rawResp.length() <= MAX_UPSTREAM_ERROR_CHARS) {
      String trimmed = rawResp.trim();
      if (trimmed.startsWith("{")) {
        try {
          parsedObj = StrictJson.parseObject(trimmed, false);
        } catch (Exception ignored) {
          parsedObj = null;
        }
      } else if (trimmed.startsWith("[")) {
        try {
          Object arr = StrictJson.parse(trimmed, false);
          if (arr instanceof List && !((List<?>) arr).isEmpty() && ((List<?>) arr).get(0) instanceof Map) {
            parsedObj = (Map<String, Object>) ((List<?>) arr).get(0);
          }
        } catch (Exception ignored) {
          parsedObj = null;
        }
      }
    }

    if (parsedObj == null) {
      Map<String, Object> cleanEnv =
          buildProtocolErrorEnvelope(
              callerFormat, statusCode, defaultUpstreamStatusMessage(statusCode), null, null);
      vars.set("response.content", StrictJson.stringify(cleanEnv));
      return;
    }

    Map<String, Object> scrubbed = (Map<String, Object>) redactSensitiveErrorNode(parsedObj, 0);
    Object innerErrObj = scrubbed.get("error");
    if (!(innerErrObj instanceof Map) && scrubbed.get("detail") instanceof Map) {
      Map<String, Object> detailMap = (Map<String, Object>) scrubbed.get("detail");
      if (detailMap.get("error") instanceof Map) {
        innerErrObj = detailMap.get("error");
      }
    }
    Map<String, Object> innerErr =
        innerErrObj instanceof Map ? (Map<String, Object>) innerErrObj : null;

    String extractedMsg = null;
    Object extractedCode = null;
    Object extractedParam = null;
    if (innerErr != null) {
      if (innerErr.get("message") instanceof String) {
        extractedMsg = (String) innerErr.get("message");
      }
      extractedCode = innerErr.get("code");
      extractedParam = innerErr.get("param");
    } else if (scrubbed.get("message") instanceof String) {
      extractedMsg = (String) scrubbed.get("message");
    } else if (scrubbed.get("detail") instanceof String) {
      extractedMsg = (String) scrubbed.get("detail");
    } else if (scrubbed.get("detail") instanceof Map) {
      Object dm = ((Map<?, ?>) scrubbed.get("detail")).get("message");
      if (dm instanceof String) {
        extractedMsg = (String) dm;
      }
    } else if (scrubbed.get("detail") instanceof List && !((List<?>) scrubbed.get("detail")).isEmpty()) {
      Object firstDetail = ((List<?>) scrubbed.get("detail")).get(0);
      if (firstDetail instanceof Map) {
        Object msgField = ((Map<?, ?>) firstDetail).get("msg");
        if (!(msgField instanceof String)) {
          msgField = ((Map<?, ?>) firstDetail).get("message");
        }
        if (msgField instanceof String) {
          extractedMsg = (String) msgField;
        }
      }
    }
    if (extractedMsg == null || extractedMsg.trim().isEmpty()) {
      extractedMsg = defaultUpstreamStatusMessage(statusCode);
    }

    Map<String, Object> finalEnvelope;
    if ("claude".equals(callerFormat)) {
      if (innerErr != null
          && "error".equals(scrubbed.get("type"))
          && innerErr.get("type") instanceof String
          && innerErr.get("message") instanceof String) {
        finalEnvelope = scrubbed;
      } else {
        finalEnvelope = buildProtocolErrorEnvelope("claude", statusCode, extractedMsg, null, null);
      }
    } else if ("gemini".equals(callerFormat)) {
      if (innerErr != null
          && innerErr.get("status") instanceof String
          && innerErr.get("message") instanceof String) {
        finalEnvelope = scrubbed;
      } else {
        finalEnvelope = buildProtocolErrorEnvelope("gemini", statusCode, extractedMsg, null, null);
      }
    } else {
      if (innerErr != null
          && innerErr.get("type") instanceof String
          && innerErr.get("message") instanceof String
          && !"error".equals(scrubbed.get("type"))) {
        finalEnvelope = scrubbed;
      } else {
        finalEnvelope =
            buildProtocolErrorEnvelope(
                "openai", statusCode, extractedMsg, extractedCode, extractedParam);
      }
    }

    vars.set("response.content", StrictJson.stringify(finalEnvelope));
  }

  private static Object redactSensitiveErrorNode(Object node, int depth) {
    if (node == null || depth > 16) {
      return node;
    }
    if (node instanceof String) {
      return redactSensitiveErrorText((String) node);
    }
    if (node instanceof Map) {
      Map<?, ?> rawMap = (Map<?, ?>) node;
      Map<String, Object> out = new LinkedHashMap<>(rawMap.size());
      for (Map.Entry<?, ?> entry : rawMap.entrySet()) {
        if (entry.getKey() == null) {
          continue;
        }
        String key = String.valueOf(entry.getKey());
        String lowerKey = key.toLowerCase(Locale.ROOT);
        Object val = entry.getValue();
        if ("@type".equals(key) && val instanceof String) {
          String typeStr = (String) val;
          out.put(
              key,
              typeStr.startsWith("type.googleapis.com/")
                  ? typeStr
                  : redactSensitiveErrorText(typeStr));
        } else if ("details".equals(key) && val instanceof List) {
          List<?> rawList = (List<?>) val;
          List<Object> cleanDetails = new ArrayList<>(rawList.size());
          for (Object item : rawList) {
            if (item instanceof Map) {
              Object itemType = ((Map<?, ?>) item).get("@type");
              if (itemType instanceof String && ((String) itemType).contains("DebugInfo")) {
                continue;
              }
            }
            cleanDetails.add(redactSensitiveErrorNode(item, depth + 1));
          }
          out.put(key, cleanDetails);
        } else if ("quota_metric".equals(lowerKey)
            || "quota_limit".equals(lowerKey)
            || "quota_unit".equals(lowerKey)
            || "quota_location".equals(lowerKey)
            || "project_number".equals(lowerKey)) {
          out.put(key, "[REDACTED]");
        } else {
          out.put(key, redactSensitiveErrorNode(val, depth + 1));
        }
      }
      return out;
    }
    if (node instanceof List) {
      List<?> rawList = (List<?>) node;
      List<Object> out = new ArrayList<>(rawList.size());
      for (Object item : rawList) {
        out.add(redactSensitiveErrorNode(item, depth + 1));
      }
      return out;
    }
    return node;
  }

  static String redactSensitiveErrorText(String input) {
    if (input == null || input.isEmpty()) {
      return input;
    }
    String s = PATTERN_GCP_PROJECT_PATH.matcher(input).replaceAll("projects/[REDACTED]");
    s = PATTERN_GCP_LOCATION_PATH.matcher(s).replaceAll("locations/[REDACTED]");
    s = PATTERN_GCP_PROJECT_NUM.matcher(s).replaceAll("$1[REDACTED]$2");
    s = PATTERN_SERVICE_ACCOUNT.matcher(s).replaceAll("[REDACTED_SA]");
    s = PATTERN_CONSUMER_ID.matcher(s).replaceAll("consumer:[REDACTED]");
    s = PATTERN_QUOTA_METRIC.matcher(s).replaceAll("$1=[REDACTED]");
    s = PATTERN_URL.matcher(s).replaceAll("[REDACTED_URL]");
    s = PATTERN_PRIVATE_IPV4.matcher(s).replaceAll("[REDACTED_HOST]");
    return s;
  }

  private static Map<String, Object> buildProtocolErrorEnvelope(
      String callerFormat,
      int statusCode,
      String message,
      Object existingCode,
      Object existingParam) {
    Map<String, Object> outer = new LinkedHashMap<>();
    if ("gemini".equals(callerFormat)) {
      Map<String, Object> err = new LinkedHashMap<>();
      err.put("code", (long) statusCode);
      err.put("message", message);
      err.put("status", mapGeminiGrpcStatus(statusCode));
      outer.put("error", err);
    } else if ("openai".equals(callerFormat)) {
      Map<String, Object> err = new LinkedHashMap<>();
      err.put("message", message);
      err.put("type", mapOpenAiErrorType(statusCode));
      err.put("param", existingParam instanceof String ? existingParam : null);
      if (existingCode instanceof String) {
        err.put("code", existingCode);
      } else {
        err.put("code", (long) statusCode);
      }
      outer.put("error", err);
    } else {
      Map<String, Object> err = new LinkedHashMap<>();
      err.put("type", mapAnthropicErrorType(statusCode));
      err.put("message", message);
      outer.put("type", "error");
      outer.put("error", err);
    }
    return outer;
  }

  private static String defaultUpstreamStatusMessage(int statusCode) {
    if (statusCode == 400) {
      return "Invalid upstream request.";
    } else if (statusCode == 401 || statusCode == 403) {
      return "Upstream provider rejected request permissions.";
    } else if (statusCode == 404) {
      return "Requested upstream model or resource was not found.";
    } else if (statusCode == 413) {
      return "Request payload exceeds upstream model limit.";
    } else if (statusCode == 429) {
      return "Upstream model rate limit exceeded.";
    } else if (statusCode == 504) {
      return "Upstream model provider timed out.";
    } else if (statusCode == 529) {
      return "Upstream model provider is temporarily overloaded.";
    }
    return "Upstream model provider error.";
  }

  private static String mapAnthropicErrorType(int statusCode) {
    if (statusCode == 400 || statusCode == 415 || statusCode == 422) {
      return "invalid_request_error";
    } else if (statusCode == 401) {
      return "authentication_error";
    } else if (statusCode == 403) {
      return "permission_error";
    } else if (statusCode == 404) {
      return "not_found_error";
    } else if (statusCode == 413) {
      return "request_too_large";
    } else if (statusCode == 429) {
      return "rate_limit_error";
    } else if (statusCode == 529) {
      return "overloaded_error";
    }
    return "api_error";
  }

  private static String mapOpenAiErrorType(int statusCode) {
    if (statusCode == 400 || statusCode == 404 || statusCode == 413 || statusCode == 415 || statusCode == 422) {
      return "invalid_request_error";
    } else if (statusCode == 401) {
      return "authentication_error";
    } else if (statusCode == 403) {
      return "permission_error";
    } else if (statusCode == 429) {
      return "rate_limit_error";
    }
    return "api_error";
  }

  private static String mapGeminiGrpcStatus(int statusCode) {
    if (statusCode == 400 || statusCode == 415 || statusCode == 422) {
      return "INVALID_ARGUMENT";
    } else if (statusCode == 401) {
      return "UNAUTHENTICATED";
    } else if (statusCode == 403) {
      return "PERMISSION_DENIED";
    } else if (statusCode == 404) {
      return "NOT_FOUND";
    } else if (statusCode == 429) {
      return "RESOURCE_EXHAUSTED";
    } else if (statusCode == 503 || statusCode == 529) {
      return "UNAVAILABLE";
    } else if (statusCode == 504) {
      return "DEADLINE_EXCEEDED";
    }
    return "INTERNAL";
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
