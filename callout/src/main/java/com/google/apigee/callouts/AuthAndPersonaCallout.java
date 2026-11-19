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
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Stateless, thread-safe Java Callout consolidating the 3 authentication and persona resolution
 * scripts:
 * <ul>
 *   <li>{@code extract_auth_credentials} (replaces {@code extract_auth_credentials.js})</li>
 *   <li>{@code resolve_auth_persona} (replaces {@code resolve_auth_persona.js})</li>
 *   <li>{@code restore_request_payload} (replaces {@code restore_request_payload.js})</li>
 * </ul>
 */
public final class AuthAndPersonaCallout extends BaseCallout {

  private static final long NO_UPSTREAM_EXPIRY = Long.MIN_VALUE;

  private static final Pattern SPIFFE_FULL_PATTERN =
      Pattern.compile(
          "^principal://([^/]+)/resources/([^/]+)/projects/([^/]+)/locations/([^/]+)/(.+)$",
          Pattern.CASE_INSENSITIVE);

  private static final Pattern SA_PROJECT_PATTERN =
      Pattern.compile("@([^.]+)\\.iam\\.gserviceaccount\\.com$", Pattern.CASE_INSENSITIVE);

  private static final Pattern SAFE_PERSONA_NAME_PATTERN =
      Pattern.compile("^[A-Za-z0-9._-]+$");

  public AuthAndPersonaCallout(Map properties) {
    super(properties);
  }

  @Override
  public String getVarprefix() {
    return "auth_callout_";
  }

  @Override
  public ExecutionResult execute(MessageContext msgCtxt, ExecutionContext exeCtxt) {
    VarCache vars = new VarCache(msgCtxt).withFallbackProperties(this.staticPropertySets);
    String action = resolveAction(msgCtxt, "extract_auth_credentials");
    try {
      switch (action) {
        case "extract_auth_credentials":
        case "extract_credentials":
          executeExtractAuthCredentials(vars);
          break;
        case "resolve_auth_persona":
        case "resolve_persona":
          executeResolveAuthPersona(vars);
          break;
        case "restore_request_payload":
        case "restore_payload":
          executeRestoreRequestPayload(vars);
          break;
        default:
          throw new IllegalStateException("Unsupported AuthAndPersonaCallout action: " + action);
      }
      return ExecutionResult.SUCCESS;
    } catch (Exception e) {
      setExceptionVariables(e, msgCtxt);
      vars.set("callout_aborted", "true");
      if (vars.getNonEmpty("auth_error_status") == null) {
        vars.set("auth_error_status", "401");
      }
      if (vars.getNonEmpty("auth_error_payload") == null) {
        Map<String, Object> errOuter = new LinkedHashMap<>();
        Map<String, Object> errInner = new LinkedHashMap<>();
        errInner.put("type", "authentication_error");
        errInner.put(
            "message",
            "Missing or invalid authentication credentials. Provide a valid Apigee API Key or Bearer token.");
        errInner.put("code", 401L);
        errOuter.put("error", errInner);
        vars.set("auth_error_payload", StrictJson.stringify(errOuter));
      }
      if ("extract_auth_credentials".equals(action) || "extract_credentials".equals(action)) {
        vars.set("auth_has_apikey", "false");
        vars.set("auth_token_type", "none");
      } else if ("resolve_auth_persona".equals(action) || "resolve_persona".equals(action)) {
        vars.set("auth_ready_to_import", "false");
      }
      return ExecutionResult.ABORT;
    }
  }

  private void executeExtractAuthCredentials(VarCache vars) {
    vars.set("auth_error_status", "401");
    Map<String, Object> errOuter = new LinkedHashMap<>();
    Map<String, Object> errInner = new LinkedHashMap<>();
    errInner.put("type", "authentication_error");
    errInner.put(
        "message",
        "Missing or invalid authentication credentials. Provide a valid Apigee API Key or Bearer token.");
    errInner.put("code", 401L);
    errOuter.put("error", errInner);
    vars.set("auth_error_payload", StrictJson.stringify(errOuter));

    String qpApiKey = vars.firstNonEmptyKey("request.queryparam.apikey", "request.queryparam.key");
    String hXApiKey = vars.getNonEmpty("request.header.x-api-key");
    String hAnthKey = vars.getNonEmpty("request.header.anthropic-api-key");
    String hGoogKey = vars.getNonEmpty("request.header.x-goog-api-key");
    String hApiKey = vars.getNonEmpty("request.header.api-key");
    String explicitApiKey = firstNonEmpty(
        vars.getNonEmpty("request.header.x-apikey"),
        hXApiKey,
        hAnthKey,
        hGoogKey,
        hApiKey,
        qpApiKey);

    if (qpApiKey != null) {
      vars.remove("request.queryparam.apikey");
      vars.remove("request.queryparam.key");
    }
    if (hXApiKey != null) {
      vars.remove("request.header.x-api-key");
    }
    if (hAnthKey != null) {
      vars.remove("request.header.anthropic-api-key");
    }
    if (hGoogKey != null) {
      vars.remove("request.header.x-goog-api-key");
    }
    if (hApiKey != null) {
      vars.remove("request.header.api-key");
    }
    vars.remove("request.header.X-Upstream-Provider");
    vars.remove("request.header.X-Goog-FieldMask");
    vars.remove("request.header.X-Goog-User-Project");

    boolean hasApiKey = false;
    if (explicitApiKey != null && !explicitApiKey.trim().isEmpty()) {
      String cleanKey = explicitApiKey.trim();
      vars.set("request.header.x-apikey", cleanKey);
      vars.set("client_id", cleanKey);
      vars.set("auth_extracted_apikey", cleanKey);
      vars.set("auth_has_apikey", "true");
      hasApiKey = true;
    } else {
      vars.set("auth_has_apikey", "false");
    }

    String authHeader =
        vars.firstNonEmptyKey("request.header.Authorization", "request.header.authorization");
    if (authHeader != null) {
      String trimmedAuth = authHeader.trim();
      if (trimmedAuth.length() > 7 && trimmedAuth.regionMatches(true, 0, "Bearer", 0, 6)
          && Character.isWhitespace(trimmedAuth.charAt(6))) {
        String bearerToken = trimmedAuth.substring(6).trim();
        if (!bearerToken.isEmpty()) {
          vars.set("auth_bearer_token", bearerToken);

          String[] parts = bearerToken.split("\\.", -1);
          String tokenType = "idp_opaque";
          if (bearerToken.startsWith("ya29.") || bearerToken.startsWith("ya29_")) {
            tokenType = "agent_identity";
          } else if (parts.length == 3 && bearerToken.startsWith("eyJ")) {
            tokenType = "idp_jwt";
          }
          vars.set("auth_token_type", tokenType);

          if (!hasApiKey && "idp_opaque".equals(tokenType)) {
            String allowBearerApiKey = vars.getString("propertyset.config.auth_allow_bearer_api_key");
            if (!"false".equals(allowBearerApiKey)) {
              vars.set("request.header.x-apikey", bearerToken);
              vars.set("client_id", bearerToken);
              vars.set("auth_extracted_apikey", bearerToken);
              vars.set("auth_try_bearer_as_apikey", "true");
            } else {
              vars.set("auth_try_bearer_as_apikey", "false");
            }
          } else {
            vars.set("auth_try_bearer_as_apikey", "false");
          }
        }
      }
    }
  }

  private void executeResolveAuthPersona(VarCache vars) {
    vars.set("auth_ready_to_import", "false");

    String tokenType = vars.getOrDefault("auth_token_type", "");
    boolean isVerified = false;
    String userId = "";
    String userEmail = "";
    Object rawPersonaClaim = "";
    String defaultAgentPersona = "";
    String team = "";
    String quotaOverride = "";
    String quotaOverrideExpiresAt = "";
    String modelArmorRequestTemplate = "";
    String modelArmorResponseTemplate = "";
    String tokenTtlMs = "3600000";
    long upstreamRemainingMs = NO_UPSTREAM_EXPIRY;

    if ("agent_identity".equals(tokenType)) {
      long agentStatus = GlobMatcher.asLong(vars.get("agentTokenVerifyResponse.status.code"), 0L);
      String agentContent = vars.getNonEmpty("agentTokenVerifyResponse.content");
      if (agentStatus == 200L && agentContent != null) {
        Map<String, Object> agentData = StrictJson.parseObject(agentContent, true);
        String expectedAgentAud = vars.getNonEmpty("propertyset.config.auth_agent_expected_audience");
        String requiredAgentScopes = vars.getNonEmpty("propertyset.config.auth_agent_required_scopes");
        Object rawScopeObj = agentData.get("scope") != null ? agentData.get("scope") : agentData.get("scp");
        boolean audAndScopeOk =
            matchesExpectedAgentAudience(agentData.get("aud"), expectedAgentAud)
                && matchesRequiredAgentScopes(rawScopeObj, requiredAgentScopes);

        if (audAndScopeOk) {
          String email = firstNonEmpty(GlobMatcher.asString(agentData.get("email")), "");
          String sub = firstNonEmpty(
              GlobMatcher.asString(agentData.get("sub")),
              GlobMatcher.asString(agentData.get("azp")),
              "");
          String rawPrincipal = firstNonEmpty(
              GlobMatcher.asString(agentData.get("principal")),
              GlobMatcher.asString(agentData.get("spiffe_id")),
              (sub.startsWith("spiffe://") || sub.startsWith("principal://") || sub.contains(".system.id.goog")) ? sub : "",
              (email.startsWith("spiffe://") || email.startsWith("principal://") || email.contains(".system.id.goog")) ? email : "",
              "");

          String allowedSuffix = vars.getNonEmpty("propertyset.config.auth_agent_allowed_email_suffix");
          if (allowedSuffix == null) {
            String gwProj = resolveGatewayProjectId(vars);
            allowedSuffix = gwProj != null ? ("@" + gwProj + ".iam.gserviceaccount.com") : "";
          }
          String allowedTrustDomain = vars.getOrDefault("propertyset.config.auth_agent_allowed_trust_domain", "");
          defaultAgentPersona = vars.getOrDefault("propertyset.config.auth_agent_persona", "agent");
          tokenTtlMs = vars.getOrDefault("propertyset.config.auth_agent_token_ttl_ms", "3600000");
          upstreamRemainingMs = computeMapRemainingMs(agentData);

          if (!rawPrincipal.isEmpty()) {
            String normalizedPrincipal = rawPrincipal;
            if (normalizedPrincipal.regionMatches(true, 0, "spiffe://", 0, 9)) {
              normalizedPrincipal = "principal://" + normalizedPrincipal.substring(9);
            } else if (!normalizedPrincipal.startsWith("principal://")
                && normalizedPrincipal.contains(".system.id.goog")) {
              normalizedPrincipal = "principal://" + normalizedPrincipal.replaceFirst("^/+", "");
            }

            Matcher spiffeMatch = SPIFFE_FULL_PATTERN.matcher(normalizedPrincipal);
            boolean hasSpiffeMatch = spiffeMatch.matches();
            String trustDomain = hasSpiffeMatch ? spiffeMatch.group(1) : "";
            boolean trustValid = matchesAllowedTrustDomain(
                normalizedPrincipal, trustDomain, hasSpiffeMatch, allowedTrustDomain);

            if (trustValid) {
              isVerified = true;
              userId = normalizedPrincipal;
              userEmail = normalizedPrincipal;
              List<String> claimsList = new ArrayList<>();
              claimsList.add(normalizedPrincipal);
              claimsList.add("spiffe://" + normalizedPrincipal.substring("principal://".length()));
              if (hasSpiffeMatch) {
                String svcName = spiffeMatch.group(2);
                String projNum = spiffeMatch.group(3);
                String tailPath = spiffeMatch.group(5);
                String[] tailSegments = tailPath.split("/");
                String engineId = tailSegments.length > 0 ? tailSegments[tailSegments.length - 1] : "";
                String projectPrincipalSet =
                    "principalSet://" + trustDomain + "/attribute.platformContainer/" + svcName + "/projects/" + projNum;
                String orgPrincipalSet = "principalSet://" + trustDomain + "/*";
                if (!engineId.isEmpty()) {
                  claimsList.add(engineId);
                }
                claimsList.add(projectPrincipalSet);
                claimsList.add("project:" + projNum);
                claimsList.add(orgPrincipalSet);
                claimsList.add(trustDomain);
                team = "project:" + projNum;
              } else {
                team = firstNonEmpty(GlobMatcher.asString(agentData.get("azp")), "agents");
              }
              claimsList.add(defaultAgentPersona);
              rawPersonaClaim = claimsList;
            }
          } else {
            String emailVerifiedStr = GlobMatcher.asString(agentData.get("email_verified"));
            boolean emailVerifiedOk = "true".equalsIgnoreCase(emailVerifiedStr);
            boolean suffixValid = emailVerifiedOk && matchesAllowedEmailSuffix(email, sub, allowedSuffix);

            if (suffixValid) {
              isVerified = true;
              userId = !email.isEmpty() ? email : sub;
              userEmail = userId;
              String emailPrefix = (!email.isEmpty() && email.indexOf('@') != -1) ? email.substring(0, email.indexOf('@')) : "";
              Matcher saProjMatcher = SA_PROJECT_PATTERN.matcher(email);
              String saProject = saProjMatcher.find() ? saProjMatcher.group(1) : "";
              List<String> claimsList = new ArrayList<>();
              if (!email.isEmpty()) {
                claimsList.add(email);
              }
              if (!emailPrefix.isEmpty()) {
                claimsList.add(emailPrefix);
              }
              if (!saProject.isEmpty()) {
                claimsList.add("project:" + saProject);
              }
              if (!sub.isEmpty() && !sub.equals(email)) {
                claimsList.add(sub);
              }
              claimsList.add(defaultAgentPersona);
              rawPersonaClaim = claimsList;
              team = !saProject.isEmpty()
                  ? ("project:" + saProject)
                  : firstNonEmpty(GlobMatcher.asString(agentData.get("azp")), "agents");
            }
          }
        }
      }
    } else if ("idp_opaque".equals(tokenType)) {
      long idpStatus = GlobMatcher.asLong(vars.get("idpOpaqueVerifyResponse.status.code"), 0L);
      String idpContent = vars.getNonEmpty("idpOpaqueVerifyResponse.content");
      if (idpStatus == 200L && idpContent != null) {
        Map<String, Object> idpData = StrictJson.parseObject(idpContent, true);
        String uClaim = vars.getOrDefault("propertyset.config.auth_idp_opaque_user_claim", "email");
        String pClaim = vars.getOrDefault("propertyset.config.auth_idp_opaque_persona_claim", "role");
        String tClaim = vars.getOrDefault("propertyset.config.auth_idp_opaque_team_claim", "department");
        String qClaim = vars.getOrDefault("propertyset.config.auth_idp_opaque_quota_override_claim", "ai_quota_override");
        String qExpClaim = vars.getOrDefault(
            "propertyset.config.auth_idp_opaque_quota_override_expires_at_claim", "ai_quota_override_expires_at");

        userId = firstNonEmpty(
            GlobMatcher.asString(idpData.get(uClaim)),
            GlobMatcher.asString(idpData.get("email")),
            GlobMatcher.asString(idpData.get("sub")),
            "");
        if (!userId.isEmpty()) {
          isVerified = true;
          userEmail = firstNonEmpty(GlobMatcher.asString(idpData.get("email")), userId);
          Object pVal = idpData.get(pClaim);
          if (pVal == null) {
            pVal = idpData.get("role");
          }
          if (pVal == null) {
            pVal = idpData.get("groups");
          }
          rawPersonaClaim = pVal != null ? pVal : "";
          team = firstNonEmpty(
              GlobMatcher.asString(idpData.get(tClaim)),
              GlobMatcher.asString(idpData.get("department")),
              GlobMatcher.asString(idpData.get("cost_center")),
              "");
          quotaOverride = firstNonEmpty(GlobMatcher.asString(idpData.get(qClaim)), "");
          quotaOverrideExpiresAt = firstNonEmpty(GlobMatcher.asString(idpData.get(qExpClaim)), "");
          modelArmorRequestTemplate = firstNonEmpty(
              GlobMatcher.asString(idpData.get("model_armor_request_template")),
              GlobMatcher.asString(idpData.get("model_armor_template")),
              "");
          modelArmorResponseTemplate = firstNonEmpty(
              GlobMatcher.asString(idpData.get("model_armor_response_template")),
              GlobMatcher.asString(idpData.get("model_armor_template")),
              "");
          tokenTtlMs = vars.getOrDefault("propertyset.config.auth_idp_opaque_token_ttl_ms", "3600000");
          upstreamRemainingMs = computeMapRemainingMs(idpData);
        }
      }
    } else if ("idp_jwt".equals(tokenType)) {
      String jwtFailed = vars.getString("jwt.VJ-VerifyIdpJwt.failed");
      String jwtValid = vars.getString("jwt.VJ-VerifyIdpJwt.valid");
      if (!"true".equals(jwtFailed)
          && ("true".equals(jwtValid) || "false".equals(jwtFailed))) {
        String configuredAudience = vars.getNonEmpty("propertyset.config.auth_idp_jwt_audience");
        boolean audienceOk =
            configuredAudience != null && matchesAllowedJwtAudience(vars, configuredAudience);
        if (audienceOk) {
          String juClaim = vars.getOrDefault("propertyset.config.auth_idp_jwt_user_claim", "email");
          String jpClaim = vars.getOrDefault("propertyset.config.auth_idp_jwt_persona_claim", "role");
          String jtClaim = vars.getOrDefault("propertyset.config.auth_idp_jwt_team_claim", "department");
          String jqClaim = vars.getOrDefault("propertyset.config.auth_idp_jwt_quota_override_claim", "ai_quota_override");
          String jqExpClaim = vars.getOrDefault(
              "propertyset.config.auth_idp_jwt_quota_override_expires_at_claim", "ai_quota_override_expires_at");

          String jwtEmailClaim = vars.getNonEmpty("jwt.VJ-VerifyIdpJwt.claim.email");
          userId = "email".equals(juClaim)
              ? firstNonEmpty(jwtEmailClaim, vars.getOrDefault("jwt.VJ-VerifyIdpJwt.claim.sub", ""))
              : vars.firstNonEmptyKeyOrDefault(
                  "",
                  "jwt.VJ-VerifyIdpJwt.claim." + juClaim,
                  "jwt.VJ-VerifyIdpJwt.claim.email",
                  "jwt.VJ-VerifyIdpJwt.claim.sub");
          if (!userId.isEmpty()) {
            isVerified = true;
            userEmail = firstNonEmpty(jwtEmailClaim, userId);
            rawPersonaClaim = vars.firstNonEmptyKeyOrDefault(
                "",
                "jwt.VJ-VerifyIdpJwt.claim." + jpClaim,
                !"role".equals(jpClaim) ? "jwt.VJ-VerifyIdpJwt.claim.role" : null,
                !"groups".equals(jpClaim) ? "jwt.VJ-VerifyIdpJwt.claim.groups" : null);
            team = vars.getOrDefault("jwt.VJ-VerifyIdpJwt.claim." + jtClaim, "");
            quotaOverride = vars.getOrDefault("jwt.VJ-VerifyIdpJwt.claim." + jqClaim, "");
            quotaOverrideExpiresAt =
                vars.getOrDefault("jwt.VJ-VerifyIdpJwt.claim." + jqExpClaim, "");
            String jwtSharedArmor =
                vars.getOrDefault("jwt.VJ-VerifyIdpJwt.claim.model_armor_template", "");
            modelArmorRequestTemplate =
                vars.getOrDefault(
                    "jwt.VJ-VerifyIdpJwt.claim.model_armor_request_template", jwtSharedArmor);
            modelArmorResponseTemplate =
                vars.getOrDefault(
                    "jwt.VJ-VerifyIdpJwt.claim.model_armor_response_template", jwtSharedArmor);
            tokenTtlMs = vars.getOrDefault("propertyset.config.auth_idp_jwt_token_ttl_ms", "3600000");
            upstreamRemainingMs = computeJwtRemainingMs(vars);
          }
        }
      }
    }

    if (isVerified && upstreamRemainingMs != NO_UPSTREAM_EXPIRY) {
      if (upstreamRemainingMs <= 0L) {
        isVerified = false;
      } else {
        long configuredTtlMs = GlobMatcher.asLong(tokenTtlMs, 3600000L);
        if (configuredTtlMs <= 0L) {
          configuredTtlMs = 3600000L;
        }
        long clampedMs = Math.min(configuredTtlMs, upstreamRemainingMs);
        tokenTtlMs = String.valueOf(Math.max(1000L, clampedMs));
      }
    }

    if (!isVerified) {
      return;
    }

    List<String> claimValues = normalizeClaimValues(rawPersonaClaim);
    String personasCsv = vars.getOrDefault(
        "propertyset.config.auth_personas_list", "knowledge-worker,developer,it,agent");
    String defaultClientIdFallback = vars.getOrDefault("propertyset.config.auth_default_client_id", "");
    String[] personas = personasCsv.split(",");
    String matchedPersona = "";
    String personaClientId = "";
    int bestScore = -1;
    Map<String, String> personaClientIdsMap = new LinkedHashMap<>();

    for (String rawP : personas) {
      String pName = rawP.trim();
      if (pName.isEmpty() || !SAFE_PERSONA_NAME_PATTERN.matcher(pName).matches()) {
        continue;
      }

      String candidateClientId =
          vars.firstNonEmptyKeyOrDefault(
              defaultClientIdFallback,
              "propertyset.config.persona." + pName + ".client_id",
              "propertyset.config.persona_" + pName + "_client_id");
      personaClientIdsMap.put(pName, candidateClientId);
      if (candidateClientId == null || candidateClientId.trim().isEmpty()) {
        continue;
      }

      String matchClaimsCsv = vars.getNonEmpty("propertyset.config.persona." + pName + ".match_claims");
      List<String> matchCandidates =
          normalizeClaimValues(matchClaimsCsv != null ? matchClaimsCsv : pName);

      for (String claimVal : claimValues) {
        for (String pattern : matchCandidates) {
          if (GlobMatcher.matchesGlob(claimVal, pattern)) {
            int score = computeMatchScore(claimVal, pattern, defaultAgentPersona);
            if (score > bestScore) {
              bestScore = score;
              matchedPersona = pName;
              personaClientId = candidateClientId.trim();
            }
          }
        }
      }
    }

    if (personaClientId.isEmpty()) {
      String defaultPersona = vars.getNonEmpty("propertyset.config.auth_persona_default");
      if (defaultPersona != null && !defaultPersona.trim().isEmpty()) {
        String defName = defaultPersona.trim();
        if (SAFE_PERSONA_NAME_PATTERN.matcher(defName).matches()) {
          String defClientId = personaClientIdsMap.containsKey(defName)
              ? personaClientIdsMap.get(defName)
              : vars.firstNonEmptyKeyOrDefault(
                  defaultClientIdFallback,
                  "propertyset.config.persona." + defName + ".client_id",
                  "propertyset.config.persona_" + defName + "_client_id");
          if (defClientId != null && !defClientId.trim().isEmpty()) {
            matchedPersona = defName;
            personaClientId = defClientId.trim();
          }
        }
      }
    }

    if (!personaClientId.isEmpty()) {
      String origContent = vars.getString("request.content");
      String origContentType = vars.getString("request.header.Content-Type");
      if (origContent != null) {
        vars.set("orig_request_content", origContent);
      }
      if (origContentType != null) {
        vars.set("orig_request_content_type", origContentType);
      }

      vars.set("request.formparam.client_id", personaClientId);
      vars.set("request.formparam.grant_type", "client_credentials");
      vars.set("oauth_external_authorization_status", "true");

      String cleanTeam = GlobMatcher.stripControlChars(team).trim();
      String resolvedTeam = (!cleanTeam.isEmpty() && !"default".equals(cleanTeam))
          ? cleanTeam
          : (!matchedPersona.isEmpty() ? matchedPersona : "default");
      vars.set("auth_user_id", userId);
      vars.set("auth_user_email", !userEmail.isEmpty() ? userEmail : userId);
      vars.set("auth_persona", matchedPersona);
      vars.set("auth_team", resolvedTeam);
      vars.set("auth_quota_override", !quotaOverride.isEmpty() ? quotaOverride : "unset");
      vars.set("auth_quota_override_expires_at", !quotaOverrideExpiresAt.isEmpty() ? quotaOverrideExpiresAt : "unset");
      vars.set(
          "auth_model_armor_request_template",
          !modelArmorRequestTemplate.isEmpty() ? modelArmorRequestTemplate : "unset");
      vars.set(
          "auth_model_armor_response_template",
          !modelArmorResponseTemplate.isEmpty() ? modelArmorResponseTemplate : "unset");
      vars.set("auth_persona_client_id", personaClientId);
      vars.set("auth_token_ttl_ms", tokenTtlMs);
      vars.set("auth_ready_to_import", "true");
    } else {
      vars.set("auth_error_status", "403");
      Map<String, Object> errOuter = new LinkedHashMap<>();
      Map<String, Object> errInner = new LinkedHashMap<>();
      errInner.put("type", "permission_error");
      errInner.put(
          "message",
          "Authenticated identity ('" + userId + "') is not mapped to an authorized AI Gateway Persona or API Product.");
      errInner.put("code", 403L);
      errOuter.put("error", errInner);
      vars.set("auth_error_payload", StrictJson.stringify(errOuter));
    }
  }

  private static List<String> normalizeClaimValues(Object rawClaim) {
    List<String> out = new ArrayList<>();
    if (rawClaim == null) {
      return out;
    }
    if (rawClaim instanceof List) {
      for (Object item : (List<?>) rawClaim) {
        if (item != null) {
          out.add(String.valueOf(item).trim().toLowerCase(Locale.ROOT));
        }
      }
      return out;
    }
    String str = String.valueOf(rawClaim).trim();
    if (str.isEmpty()) {
      return out;
    }
    if (str.startsWith("[") && str.endsWith("]")) {
      try {
        Object parsed = StrictJson.parse(str, false);
        if (parsed instanceof List) {
          return normalizeClaimValues(parsed);
        }
      } catch (Exception ignored) {
        // fallback to comma split
      }
    }
    String[] parts = str.split(",");
    for (String part : parts) {
      String clean = GlobMatcher.cleanPatternToken(part);
      if (!clean.isEmpty()) {
        out.add(clean);
      }
    }
    return out;
  }

  private static int computeMatchScore(String claim, String pattern, String defaultAgentPersona) {
    boolean isExact = (pattern.indexOf('*') == -1);
    int literalLen = pattern.replace("*", "").length();

    if (defaultAgentPersona != null
        && !defaultAgentPersona.isEmpty()
        && pattern.equals(defaultAgentPersona.toLowerCase(Locale.ROOT))) {
      return 1000 + literalLen;
    }

    if (claim.startsWith("principal://")
        || claim.startsWith("spiffe://")
        || claim.startsWith("principalset://")) {
      if (pattern.contains("reasoningengines/")) {
        return 40000 + (isExact ? 500 : 0) + literalLen;
      }
      if (pattern.contains("/locations/")) {
        return 30000 + (isExact ? 500 : 0) + literalLen;
      }
      if (pattern.contains("/projects/")) {
        return 20000 + (isExact ? 500 : 0) + literalLen;
      }
      return 10000 + (isExact ? 500 : 0) + literalLen;
    }

    if (claim.contains(".iam.gserviceaccount.com") && pattern.indexOf('@') != -1) {
      if (isExact) {
        return 40500 + literalLen;
      }
      int atIdx = pattern.indexOf('@');
      String localLit = pattern.substring(0, atIdx).replace("*", "");
      String domainPart = pattern.substring(atIdx + 1);
      if (domainPart.toLowerCase(Locale.ROOT).endsWith(".iam.gserviceaccount.com")) {
        domainPart = domainPart.substring(0, domainPart.length() - ".iam.gserviceaccount.com".length());
      }
      String domainLit = domainPart.replace("*", "");
      if (!localLit.isEmpty() && !domainLit.isEmpty()) {
        return 35000 + literalLen;
      }
      if (!localLit.isEmpty()) {
        return 30000 + literalLen;
      }
      if (!domainLit.isEmpty()) {
        return 20000 + literalLen;
      }
      return 10000 + literalLen;
    }

    if (claim.startsWith("project:") || pattern.startsWith("project:")) {
      return 20000 + (isExact ? 500 : 0) + literalLen;
    }

    return (isExact ? 40500 : 30000) + literalLen;
  }

  private void executeRestoreRequestPayload(VarCache vars) {
    vars.remove("request.formparam.client_id");
    vars.remove("request.formparam.grant_type");

    String origContent = vars.getString("orig_request_content");
    String savedContent = origContent != null ? null : vars.getString("saved_request_content");
    String restoredContent = origContent != null ? origContent : savedContent;
    if (restoredContent != null) {
      vars.set("request.content", restoredContent);
      vars.remove("orig_request_content");
      if (savedContent != null) {
        vars.remove("saved_request_content");
      }
    }

    String origContentType = vars.getString("orig_request_content_type");
    String savedContentType = origContentType != null ? null : vars.getString("saved_request_content_type");
    String restoredContentType = origContentType != null ? origContentType : savedContentType;
    if (restoredContentType != null && !restoredContentType.trim().isEmpty()) {
      vars.set("request.header.Content-Type", restoredContentType);
    }
    if (origContentType != null) {
      vars.remove("orig_request_content_type");
    }
    if (savedContentType != null) {
      vars.remove("saved_request_content_type");
    }

    String resolvedClientId =
        vars.firstNonEmptyKey("auth_persona_client_id", "auth_resolved_client_id");
    if (resolvedClientId != null && !resolvedClientId.trim().isEmpty()) {
      String cleanId = resolvedClientId.trim();
      vars.set("client_id", cleanId);
      vars.set("request.header.x-apikey", cleanId);
    }
  }

  private static String resolveGatewayProjectId(VarCache vars) {
    String[] keys = new String[] {"propertyset.config.project_id", "organization.name"};
    for (String k : keys) {
      String c = vars.getNonEmpty(k);
      if (c != null) {
        String trimmed = c.trim();
        if (!trimmed.isEmpty()
            && !"{organization.name}".equals(trimmed)
            && !"your-gcp-project-id".equals(trimmed)) {
          return trimmed;
        }
      }
    }
    return null;
  }

  private static boolean matchesAllowedTrustDomain(
      String normalizedPrincipal,
      String trustDomain,
      boolean hasSpiffeMatch,
      String allowedTrustDomainsCsv) {
    if (allowedTrustDomainsCsv == null || allowedTrustDomainsCsv.trim().isEmpty()) {
      return false;
    }
    String lowerPrincipal = normalizedPrincipal.toLowerCase(Locale.ROOT);
    String lowerDomain = trustDomain != null ? trustDomain.toLowerCase(Locale.ROOT) : "";
    for (String rawPat : allowedTrustDomainsCsv.split(",")) {
      String pat = rawPat.trim().toLowerCase(Locale.ROOT);
      if (pat.isEmpty()) {
        continue;
      }
      if ("*".equals(pat)) {
        return true;
      }
      if (pat.indexOf('*') != -1) {
        if (GlobMatcher.matchesGlob(lowerPrincipal, pat)
            || (!lowerDomain.isEmpty() && GlobMatcher.matchesGlob(lowerDomain, pat))) {
          return true;
        }
      } else if (pat.startsWith(".")) {
        if (hasSpiffeMatch ? lowerDomain.endsWith(pat) : lowerPrincipal.contains(pat)) {
          return true;
        }
      } else {
        if ((!lowerDomain.isEmpty() && lowerDomain.equals(pat))
            || lowerPrincipal.equals("principal://" + pat)
            || lowerPrincipal.startsWith("principal://" + pat + "/")) {
          return true;
        }
      }
    }
    return false;
  }

  private static boolean matchesAllowedEmailSuffix(String email, String sub, String allowedSuffixCsv) {
    if (allowedSuffixCsv == null || allowedSuffixCsv.trim().isEmpty()) {
      return false;
    }
    String lowerEmail = email != null ? email.trim().toLowerCase(Locale.ROOT) : "";
    int atIdx = lowerEmail.indexOf('@');
    boolean hasValidEmailAt =
        atIdx > 0 && atIdx < lowerEmail.length() - 1 && lowerEmail.indexOf('@', atIdx + 1) == -1;

    for (String rawPat : allowedSuffixCsv.split(",")) {
      String pat = rawPat.trim().toLowerCase(Locale.ROOT);
      if (pat.isEmpty()) {
        continue;
      }
      if ("*".equals(pat)) {
        if (hasValidEmailAt || (sub != null && !sub.isEmpty())) {
          return true;
        }
      } else if (pat.indexOf('*') != -1) {
        if (hasValidEmailAt && GlobMatcher.matchesGlob(lowerEmail, pat)) {
          return true;
        }
      } else if (pat.startsWith("@")) {
        if (hasValidEmailAt && lowerEmail.endsWith(pat)
            && (lowerEmail.length() - pat.length() == atIdx)) {
          return true;
        }
      } else if (pat.indexOf('@') > 0) {
        if (hasValidEmailAt && lowerEmail.equals(pat)) {
          return true;
        }
      } else if (pat.startsWith(".")) {
        // Explicit subdomain suffix (e.g. ".iam.gserviceaccount.com"): require '@' + non-empty label before '.'
        if (hasValidEmailAt && lowerEmail.endsWith(pat)
            && (lowerEmail.length() - pat.length() > atIdx + 1)) {
          return true;
        }
      } else {
        // Bare domain suffix (e.g. "my-proj.iam.gserviceaccount.com"): anchor strictly at '@'
        if (hasValidEmailAt && lowerEmail.endsWith(pat)
            && (lowerEmail.length() - pat.length() == atIdx + 1)) {
          return true;
        }
      }
    }
    return false;
  }

  private static boolean matchesExpectedAgentAudience(Object rawAudObj, String expectedAudienceCsv) {
    if (expectedAudienceCsv == null || expectedAudienceCsv.trim().isEmpty()) {
      return true;
    }
    List<String> tokenAudiences = normalizeClaimValues(rawAudObj);
    if (tokenAudiences.isEmpty()) {
      return false;
    }
    for (String rawAllowed : expectedAudienceCsv.split(",")) {
      String pat = rawAllowed.trim().toLowerCase(Locale.ROOT);
      if (pat.isEmpty()) {
        continue;
      }
      if ("*".equals(pat)) {
        return true;
      }
      for (String aud : tokenAudiences) {
        if (GlobMatcher.matchesGlob(aud, pat)) {
          return true;
        }
      }
    }
    return false;
  }

  private static boolean matchesRequiredAgentScopes(Object rawScopeObj, String requiredScopesSpec) {
    if (requiredScopesSpec == null || requiredScopesSpec.trim().isEmpty()) {
      return true;
    }
    List<String> requiredList = splitScopesOrCsv(requiredScopesSpec);
    if (requiredList.isEmpty()) {
      return true;
    }
    List<String> tokenScopes = extractScopeList(rawScopeObj);
    if (tokenScopes.isEmpty()) {
      return false;
    }
    for (String reqPat : requiredList) {
      if ("*".equals(reqPat)) {
        continue;
      }
      boolean matched = false;
      for (String tokScope : tokenScopes) {
        if (GlobMatcher.matchesGlob(tokScope, reqPat)) {
          matched = true;
          break;
        }
      }
      if (!matched) {
        return false;
      }
    }
    return true;
  }

  private static List<String> extractScopeList(Object rawScopeObj) {
    if (rawScopeObj == null) {
      return new ArrayList<>();
    }
    if (rawScopeObj instanceof List) {
      List<String> out = new ArrayList<>();
      for (Object item : (List<?>) rawScopeObj) {
        if (item != null) {
          out.addAll(splitScopesOrCsv(String.valueOf(item)));
        }
      }
      return out;
    }
    String raw = String.valueOf(rawScopeObj).trim();
    if (raw.startsWith("[") && raw.endsWith("]")) {
      try {
        Object parsed = StrictJson.parse(raw, false);
        if (parsed instanceof List) {
          return extractScopeList(parsed);
        }
      } catch (Exception ignored) {
        // fallback to delimiter scan
      }
    }
    return splitScopesOrCsv(raw);
  }

  private static List<String> splitScopesOrCsv(String input) {
    List<String> out = new ArrayList<>();
    if (input == null || input.isEmpty()) {
      return out;
    }
    int len = input.length();
    int start = -1;
    for (int i = 0; i < len; i++) {
      char ch = input.charAt(i);
      if (ch == ',' || Character.isWhitespace(ch)) {
        if (start != -1) {
          out.add(input.substring(start, i).toLowerCase(Locale.ROOT));
          start = -1;
        }
      } else if (start == -1) {
        start = i;
      }
    }
    if (start != -1) {
      out.add(input.substring(start, len).toLowerCase(Locale.ROOT));
    }
    return out;
  }

  private static boolean matchesAllowedJwtAudience(VarCache vars, String allowedAudienceCsv) {
    String rawAud =
        vars.firstNonEmptyKey("jwt.VJ-VerifyIdpJwt.claim.audience", "jwt.VJ-VerifyIdpJwt.claim.aud");
    if (rawAud == null || rawAud.trim().isEmpty()) {
      return false;
    }
    List<String> tokenAudiences = normalizeClaimValues(rawAud);
    if (tokenAudiences.isEmpty()) {
      return false;
    }
    for (String rawAllowed : allowedAudienceCsv.split(",")) {
      String pat = rawAllowed.trim().toLowerCase(Locale.ROOT);
      if (pat.isEmpty() || "*".equals(pat)) {
        continue;
      }
      for (String aud : tokenAudiences) {
        if (GlobMatcher.matchesGlob(aud, pat)) {
          return true;
        }
      }
    }
    return false;
  }

  private static long computeMapRemainingMs(Map<String, Object> data) {
    if (data == null || data.isEmpty()) {
      return NO_UPSTREAM_EXPIRY;
    }
    Object rawExpiresIn = data.get("expires_in");
    if (rawExpiresIn != null) {
      long secs = parseStrictSignedLong(rawExpiresIn);
      if (secs != NO_UPSTREAM_EXPIRY) {
        return secs <= 0L ? 0L : (secs > Long.MAX_VALUE / 1000L ? Long.MAX_VALUE : secs * 1000L);
      }
    }
    Object rawExp = data.get("exp");
    if (rawExp != null) {
      long expMs = parseEpochMillis(rawExp);
      if (expMs != NO_UPSTREAM_EXPIRY) {
        long rem = expMs - System.currentTimeMillis();
        return rem <= 0L ? 0L : rem;
      }
    }
    return NO_UPSTREAM_EXPIRY;
  }

  private static long computeJwtRemainingMs(VarCache vars) {
    String secsRem = vars.getNonEmpty("jwt.VJ-VerifyIdpJwt.seconds_remaining");
    if (secsRem != null) {
      long secs = parseStrictSignedLong(secsRem);
      if (secs != NO_UPSTREAM_EXPIRY) {
        return secs <= 0L ? 0L : (secs > Long.MAX_VALUE / 1000L ? Long.MAX_VALUE : secs * 1000L);
      }
    }
    String msLeft = vars.getNonEmpty("jwt.VJ-VerifyIdpJwt.millis_left");
    if (msLeft != null) {
      long ms = parseStrictSignedLong(msLeft);
      if (ms != NO_UPSTREAM_EXPIRY) {
        return ms <= 0L ? 0L : ms;
      }
    }
    String expClaim = vars.getNonEmpty("jwt.VJ-VerifyIdpJwt.claim.exp");
    if (expClaim != null) {
      long expMs = parseEpochMillis(expClaim);
      if (expMs != NO_UPSTREAM_EXPIRY) {
        long rem = expMs - System.currentTimeMillis();
        return rem <= 0L ? 0L : rem;
      }
    }
    return NO_UPSTREAM_EXPIRY;
  }

  private static final java.math.BigDecimal MIN_SIGNED_LONG_BD =
      java.math.BigDecimal.valueOf(Long.MIN_VALUE + 1L);
  private static final java.math.BigDecimal MAX_SIGNED_LONG_BD =
      java.math.BigDecimal.valueOf(Long.MAX_VALUE);
  private static final java.math.BigInteger MIN_SIGNED_LONG_BI =
      java.math.BigInteger.valueOf(Long.MIN_VALUE + 1L);
  private static final java.math.BigInteger MAX_SIGNED_LONG_BI =
      java.math.BigInteger.valueOf(Long.MAX_VALUE);

  private static long parseStrictSignedLong(Object val) {
    if (val instanceof Number) {
      if (val instanceof Long
          || val instanceof Integer
          || val instanceof Short
          || val instanceof Byte) {
        long lv = ((Number) val).longValue();
        return lv == Long.MIN_VALUE ? NO_UPSTREAM_EXPIRY : lv;
      }
      if (val instanceof java.math.BigDecimal) {
        java.math.BigDecimal bd = (java.math.BigDecimal) val;
        if (bd.compareTo(MIN_SIGNED_LONG_BD) < 0 || bd.compareTo(MAX_SIGNED_LONG_BD) > 0) {
          return NO_UPSTREAM_EXPIRY;
        }
        return bd.setScale(0, java.math.RoundingMode.FLOOR).longValue();
      }
      if (val instanceof java.math.BigInteger) {
        java.math.BigInteger bi = (java.math.BigInteger) val;
        if (bi.compareTo(MIN_SIGNED_LONG_BI) < 0 || bi.compareTo(MAX_SIGNED_LONG_BI) > 0) {
          return NO_UPSTREAM_EXPIRY;
        }
        return bi.longValue();
      }
      if (val instanceof Double || val instanceof Float) {
        double d = ((Number) val).doubleValue();
        if (!Double.isFinite(d) || d < Long.MIN_VALUE + 1 || d > Long.MAX_VALUE) {
          return NO_UPSTREAM_EXPIRY;
        }
        return (long) Math.floor(d);
      }
      return ((Number) val).longValue();
    }
    String s = String.valueOf(val).trim();
    if (s.isEmpty()) {
      return NO_UPSTREAM_EXPIRY;
    }
    try {
      if (s.indexOf('.') != -1) {
        double d = Double.parseDouble(s);
        if (!Double.isFinite(d) || d < Long.MIN_VALUE + 1 || d > Long.MAX_VALUE) {
          return NO_UPSTREAM_EXPIRY;
        }
        return (long) Math.floor(d);
      }
      return Long.parseLong(s);
    } catch (NumberFormatException e) {
      return NO_UPSTREAM_EXPIRY;
    }
  }

  private static long parseEpochMillis(Object val) {
    long rawNum = parseStrictSignedLong(val);
    if (rawNum != NO_UPSTREAM_EXPIRY) {
      if (rawNum <= 0L) {
        return 0L;
      }
      return rawNum < 100_000_000_000L ? rawNum * 1000L : rawNum;
    }
    String s = String.valueOf(val).trim();
    if (s.isEmpty()) {
      return NO_UPSTREAM_EXPIRY;
    }
    try {
      return Instant.parse(s).toEpochMilli();
    } catch (Exception e) {
      return NO_UPSTREAM_EXPIRY;
    }
  }
}
