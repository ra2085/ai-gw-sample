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

package com.google.apigee.callouts.util;

import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Shared thread-safe, pre-compiled pattern matchers, glob specificity scorers, and security
 * validators for the Apigee AI Gateway Java Callouts.
 *
 * <p>All regular expressions are pre-compiled once as {@code private static final Pattern} constants
 * at class initialization time ({@code apigee-performance-engineering} Section 5.1) and use bounded
 * non-backtracking character classes ({@code apigee-security-engineering} Section 8.1).
 */
public final class GlobMatcher {

  private static final Pattern SAFE_TOKEN_REF_PATTERN =
      Pattern.compile("^(propertyset\\.[a-zA-Z0-9_.-]+|private\\.[a-zA-Z0-9_.-]+|(?:verifyapikey\\.VA-ApiKey\\.)?apiproduct\\.[a-zA-Z0-9_.-]+)$");

  private static final Pattern FULL_ARMOR_TEMPLATE_PATTERN =
      Pattern.compile("^projects/([^/]+)/locations/([^/]+)/templates/([^/]+)$", Pattern.CASE_INSENSITIVE);

  private static final Pattern LOC_ARMOR_TEMPLATE_PATTERN =
      Pattern.compile("^([^/]+)/([^/]+)$");

  private GlobMatcher() {}

  /**
   * Iterative, linear-time glob matcher supporting multiple {@code *} wildcards with zero regex
   * compilation or backtracking risk.
   */
  public static boolean matchesGlob(String str, String pattern) {
    if (str == null || pattern == null) {
      return false;
    }
    int pLen = pattern.length();
    if (pLen == 1 && pattern.charAt(0) == '*') {
      return true;
    }
    int sLen = str.length();
    int sIdx = 0;
    int pIdx = 0;
    int starIdx = -1;
    int matchIdx = 0;
    while (sIdx < sLen) {
      if (pIdx < pLen && pattern.charAt(pIdx) == '*') {
        while (pIdx < pLen && pattern.charAt(pIdx) == '*') {
          pIdx++;
        }
        if (pIdx == pLen) {
          return true;
        }
        starIdx = pIdx - 1;
        matchIdx = sIdx;
      } else if (pIdx < pLen && pattern.charAt(pIdx) == str.charAt(sIdx)) {
        pIdx++;
        sIdx++;
      } else if (starIdx != -1) {
        pIdx = starIdx + 1;
        matchIdx++;
        sIdx = matchIdx;
      } else {
        return false;
      }
    }
    while (pIdx < pLen && pattern.charAt(pIdx) == '*') {
      pIdx++;
    }
    return pIdx == pLen;
  }

  /**
   * Specificity scorer for Persona claim matching in {@code resolve_auth_persona}:
   * <ol>
   *   <li>SPIFFE Agent Hierarchy: Level 1 Single Agent ({@code reasoningengines/}) &gt; Level 2 Project ({@code /projects/}) &gt; Level 3 Org ({@code .system.id.goog})</li>
   *   <li>GCP IAM Service Account Hierarchy: Exact SA &gt; Prefix+Project &gt; Prefix-only &gt; Project-only &gt; Org-wide</li>
   *   <li>Enterprise IdP Role/Group Claims: Exact &gt; Glob, tie-broken by literal length</li>
   * </ol>
   */
  public static int computeSpecificityScore(String candidate, String pattern) {
    boolean isExact = true;
    int literalLen = 0;
    for (int i = 0, n = pattern.length(); i < n; i++) {
      if (pattern.charAt(i) == '*') {
        isExact = false;
      } else {
        literalLen++;
      }
    }

    if (candidate.startsWith("principal://")
        || candidate.startsWith("spiffe://")
        || candidate.startsWith("principalset://")) {
      if (pattern.contains("reasoningengines/") || pattern.contains("/agents/")) {
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

    if (candidate.contains(".iam.gserviceaccount.com") && pattern.indexOf('@') != -1) {
      if (isExact) {
        return 40500 + literalLen;
      }
      int atIdx = pattern.indexOf('@');
      String localLit = pattern.substring(0, atIdx).replace("*", "");
      String domainPart = pattern.substring(atIdx + 1);
      if (domainPart.toLowerCase().endsWith(".iam.gserviceaccount.com")) {
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

    return (isExact ? 40500 : 30000) + literalLen;
  }

  /**
   * Specificity scorer for Unified Identity &amp; Exception Rules in {@code resolve_model_location}
   * and {@code models_endpoint}.
   */
  public static int computeArmorRuleScore(String candidate, String pattern) {
    boolean isExact = (pattern.indexOf('*') == -1);
    int literalLen = pattern.replace("*", "").length();
    if (candidate.startsWith("principal://") || candidate.startsWith("spiffe://")) {
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
    if (candidate.contains(".iam.gserviceaccount.com") && pattern.indexOf('@') != -1) {
      if (isExact) {
        return 40500 + literalLen;
      }
      int atIdx = pattern.indexOf('@');
      boolean hasLocalLit = hasNonStarChar(pattern, 0, atIdx);
      int domainStart = atIdx + 1;
      int domainEnd = pattern.length();
      final String saSuffix = ".iam.gserviceaccount.com";
      if (domainEnd - domainStart >= saSuffix.length()
          && pattern.regionMatches(true, domainEnd - saSuffix.length(), saSuffix, 0, saSuffix.length())) {
        domainEnd -= saSuffix.length();
      }
      boolean hasDomainLit = hasNonStarChar(pattern, domainStart, domainEnd);
      if (hasLocalLit && hasDomainLit) {
        return 35000 + literalLen;
      }
      if (hasLocalLit) {
        return 30000 + literalLen;
      }
      if (hasDomainLit) {
        return 20000 + literalLen;
      }
      return 10000 + literalLen;
    }
    if (candidate.startsWith("team:") || candidate.startsWith("project:")) {
      return 20000 + (isExact ? 500 : 0) + literalLen;
    }
    return (isExact ? 40500 : 30000) + literalLen;
  }

  private static boolean hasNonStarChar(String s, int start, int end) {
    for (int i = start; i < end; i++) {
      if (s.charAt(i) != '*') {
        return true;
      }
    }
    return false;
  }

  public static boolean isOpenAiModelName(String m) {
    if (m == null || m.isEmpty()) {
      return false;
    }
    return m.startsWith("gpt-")
        || m.startsWith("o1")
        || m.startsWith("o3")
        || m.startsWith("o4")
        || m.startsWith("text-embedding-3-")
        || m.startsWith("text-embedding-ada-");
  }

  public static boolean isGoogleCloudUrl(String url) {
    if (url == null || url.isEmpty()) {
      return false;
    }
    String u = url.trim();
    if (!matchesGoogleAiPlatformAuthority(u)) {
      return false;
    }
    return isSafeUpstreamHttpsUrl(u, null);
  }

  private static boolean matchesGoogleAiPlatformAuthority(String u) {
    if (u.length() < 24 || !u.regionMatches(true, 0, "https://", 0, 8)) {
      return false;
    }
    int authEnd = 8;
    int len = u.length();
    while (authEnd < len) {
      char c = u.charAt(authEnd);
      if (c == '/' || c == '?') {
        break;
      }
      authEnd++;
    }
    int hostEnd = authEnd;
    int colonIdx = u.indexOf(':', 8);
    if (colonIdx != -1 && colonIdx < authEnd) {
      int portLen = authEnd - (colonIdx + 1);
      if (portLen < 1 || portLen > 5) {
        return false;
      }
      int portVal = 0;
      for (int i = colonIdx + 1; i < authEnd; i++) {
        char d = u.charAt(i);
        if (d < '0' || d > '9') {
          return false;
        }
        portVal = portVal * 10 + (d - '0');
      }
      if (portVal < 1 || portVal > 65535) {
        return false;
      }
      hostEnd = colonIdx;
    }
    final String suffix = ".googleapis.com";
    int subEnd = hostEnd - suffix.length();
    if (subEnd <= 8 || !u.regionMatches(true, subEnd, suffix, 0, suffix.length())) {
      return false;
    }
    int subLen = subEnd - 8;
    for (int i = 8; i < subEnd; i++) {
      char c = u.charAt(i);
      boolean ok =
          (c >= 'a' && c <= 'z')
              || (c >= 'A' && c <= 'Z')
              || (c >= '0' && c <= '9')
              || c == '-';
      if (!ok) {
        return false;
      }
    }
    if (subLen == 10 && u.regionMatches(true, 8, "aiplatform", 0, 10)) {
      return true;
    }
    return subLen > 11 && u.regionMatches(true, subEnd - 11, "-aiplatform", 0, 11);
  }

  public static boolean isGoogleCloudVertexUrl(
      String url, String expectedProjectId, String allowedProjectsCsv) {
    if (url == null || url.isEmpty()) {
      return false;
    }
    if (!isGoogleCloudUrl(url)) {
      return false;
    }
    String lower = url.toLowerCase();
    if (lower.contains("..") || lower.contains("%2e") || lower.contains("%2f")) {
      return false;
    }
    String urlProj = extractPathProject(url);
    if (urlProj != null) {
      return isAllowedGcpProject(urlProj, expectedProjectId, allowedProjectsCsv);
    }
    return true;
  }

  /**
   * Zero-DNS, sub-microsecond SSRF &amp; authority validator for outbound HTTPS URLs.
   * Rejects non-HTTPS schemes, userinfo ({@code user@host}), fragments, IPv6 literals,
   * IPv4/integer/hex/octal literals, localhost, GCP metadata hosts, wildcard DNS rebinding
   * domains, and (when configured) hosts outside {@code allowedHostsCsv}.
   */
  public static boolean isSafeUpstreamHttpsUrl(String rawUrl, String allowedHostsCsv) {
    if (rawUrl == null || rawUrl.isEmpty()) {
      return false;
    }
    String u = rawUrl.trim();
    int len = u.length();
    if (len < 10 || len > 2048 || !u.regionMatches(true, 0, "https://", 0, 8)) {
      return false;
    }
    for (int i = 0; i < len; i++) {
      char c = u.charAt(i);
      if (c <= 0x20 || c == 0x7f || c == '\\' || c == '#') {
        return false;
      }
    }
    java.net.URI parsed;
    try {
      parsed = new java.net.URI(u);
    } catch (Exception e) {
      return false;
    }
    if (!"https".equalsIgnoreCase(parsed.getScheme())
        || parsed.getRawUserInfo() != null
        || parsed.getUserInfo() != null
        || parsed.getFragment() != null) {
      return false;
    }
    String authority = parsed.getRawAuthority();
    if (authority == null || authority.isEmpty() || authority.indexOf('@') != -1) {
      return false;
    }
    String host = parsed.getHost();
    if (host == null || host.isEmpty()) {
      return false;
    }
    // Reject IPv6 literals ([::1], [::ffff:169.254.169.254], etc.)
    if (host.indexOf(':') != -1 || host.indexOf('[') != -1 || host.indexOf(']') != -1) {
      return false;
    }
    String lh = host.toLowerCase();
    if (lh.startsWith(".") || lh.endsWith(".")) {
      lh = lh.endsWith(".") && !lh.startsWith(".") ? lh.substring(0, lh.length() - 1) : lh;
    }
    int dotIdx = lh.lastIndexOf('.');
    if (dotIdx <= 0 || dotIdx == lh.length() - 1 || lh.contains("..")) {
      return false;
    }
    // Reject all IPv4 dotted-quad, octal, hex (0x...), and integer IP literals by verifying
    // that the TLD contains at least one non-hex ASCII letter or non-digit label
    String tld = lh.substring(dotIdx + 1);
    boolean hasAlphaNonHexPrefix = false;
    boolean allDigits = true;
    for (int i = 0; i < tld.length(); i++) {
      char ch = tld.charAt(i);
      if (ch < '0' || ch > '9') {
        allDigits = false;
      }
      if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')) {
        hasAlphaNonHexPrefix = true;
      }
    }
    if (allDigits || !hasAlphaNonHexPrefix || tld.startsWith("0x")) {
      return false;
    }
    if ("localhost".equals(lh)
        || lh.endsWith(".localhost")
        || "metadata.goog".equals(lh)
        || lh.endsWith(".metadata.goog")
        || lh.endsWith(".google.internal")
        || lh.endsWith(".nip.io")
        || lh.endsWith(".sslip.io")
        || lh.endsWith(".xip.io")) {
      return false;
    }
    String rawPath = parsed.getRawPath();
    if (rawPath != null) {
      String lp = rawPath.toLowerCase();
      if (lp.contains("/..") || lp.contains("../") || lp.contains("%2e%2e")) {
        return false;
      }
    }
    if (allowedHostsCsv != null && !allowedHostsCsv.trim().isEmpty()) {
      for (String rawPat : allowedHostsCsv.split(",")) {
        String pat = cleanPatternToken(rawPat);
        if (!pat.isEmpty() && matchesGlob(lh, pat)) {
          return true;
        }
      }
      return false;
    }
    return true;
  }

  public static String extractPathProject(String pathOrUrl) {
    if (pathOrUrl == null || pathOrUrl.isEmpty()) {
      return null;
    }
    final String marker = "/projects/";
    int idx = pathOrUrl.indexOf(marker);
    if (idx == -1) {
      if (pathOrUrl.startsWith("projects/")) {
        idx = -1; // handled below with start = 9
        int start = "projects/".length();
        int slash = pathOrUrl.indexOf('/', start);
        return slash == -1 ? pathOrUrl.substring(start) : pathOrUrl.substring(start, slash);
      }
      return null;
    }
    int start = idx + marker.length();
    if (start >= pathOrUrl.length()) {
      return null;
    }
    int end = pathOrUrl.indexOf('/', start);
    int colon = pathOrUrl.indexOf(':', start);
    if (colon != -1 && (end == -1 || colon < end)) {
      end = colon;
    }
    return end == -1 ? pathOrUrl.substring(start) : pathOrUrl.substring(start, end);
  }

  public static boolean isAllowedGcpProject(
      String candidateProj, String expectedProjectId, String allowedProjectsCsv) {
    if (!isSafeSegment(candidateProj)) {
      return false;
    }
    if (expectedProjectId == null || expectedProjectId.isEmpty()) {
      return true;
    }
    if (candidateProj.equals(expectedProjectId)) {
      return true;
    }
    if (allowedProjectsCsv != null && !allowedProjectsCsv.trim().isEmpty()) {
      String lc = candidateProj.toLowerCase();
      for (String rawPat : allowedProjectsCsv.split(",")) {
        String pat = cleanPatternToken(rawPat);
        if (!pat.isEmpty() && matchesGlob(lc, pat)) {
          return true;
        }
      }
    }
    return false;
  }

  public static boolean isAllowedGcsUri(String uri, String allowedBucketsCsv) {
    if (uri == null || !uri.regionMatches(true, 0, "gs://", 0, 5)) {
      return false;
    }
    if (allowedBucketsCsv == null || allowedBucketsCsv.trim().isEmpty()) {
      return false;
    }
    String rest = uri.substring(5);
    int slashIdx = rest.indexOf('/');
    if (slashIdx <= 0 || slashIdx == rest.length() - 1) {
      return false;
    }
    String bucket = rest.substring(0, slashIdx);
    String objectPath = rest.substring(slashIdx + 1);
    String lowerObj = objectPath.toLowerCase();
    if (!isSafeSegment(bucket)
        || objectPath.contains("..")
        || lowerObj.contains("%2e")
        || objectPath.indexOf('\\') != -1
        || objectPath.indexOf('?') != -1
        || objectPath.indexOf('#') != -1
        || hasControlChar(objectPath)) {
      return false;
    }
    String lowerBucket = bucket.toLowerCase();
    for (String rawPat : allowedBucketsCsv.split(",")) {
      String pat = cleanPatternToken(rawPat);
      if (!pat.isEmpty() && matchesGlob(lowerBucket, pat)) {
        return true;
      }
    }
    return false;
  }

  private static boolean hasControlChar(String s) {
    for (int i = 0, n = s.length(); i < n; i++) {
      char c = s.charAt(i);
      if (c < 0x20 || c == 0x7F) {
        return true;
      }
    }
    return false;
  }

  /**
   * Strict URL/resource path segment validator ({@code ^[a-zA-Z0-9._@-]{1,128}$}, rejecting
   * {@code "."} and any {@code ".."} sequence). Blocks {@code :}, {@code $}, {@code ;}, whitespace,
   * slashes, percent-encoding, and control characters to prevent Vertex RPC {@code :method}
   * smuggling and URI structure injection.
   */
  public static boolean isSafeSegment(String seg) {
    return isSafeIdentifierChars(seg, 128, false);
  }

  /**
   * Strict quota, team, and non-path model identifier validator ({@code ^[a-zA-Z0-9._@:-]{1,256}$},
   * rejecting {@code "."} and {@code ".."}). Permits {@code :} for {@code project:<id>} team
   * budgets, Ollama/vLLM model tags ({@code llama3:70b}), and OpenAI fine-tuned IDs
   * ({@code ft:gpt-4o-mini:...}) while rejecting {@code $}, {@code ;}, whitespace, slashes, and
   * traversal tokens.
   */
  public static boolean isSafeQuotaId(String id) {
    return isSafeIdentifierChars(id, 256, true);
  }

  private static boolean isSafeIdentifierChars(String s, int maxLen, boolean allowColon) {
    if (s == null) {
      return false;
    }
    int n = s.length();
    if (n == 0 || n > maxLen || (n == 1 && s.charAt(0) == '.')) {
      return false;
    }
    char prev = '\0';
    for (int i = 0; i < n; i++) {
      char c = s.charAt(i);
      boolean ok =
          (c >= 'a' && c <= 'z')
              || (c >= 'A' && c <= 'Z')
              || (c >= '0' && c <= '9')
              || c == '.'
              || c == '_'
              || c == '-'
              || c == '@'
              || (allowColon && c == ':');
      if (!ok || (c == '.' && prev == '.')) {
        return false;
      }
      prev = c;
    }
    return true;
  }

  public static boolean isSafeLocation(String loc) {
    if (loc == null || loc.isEmpty() || loc.length() > 64) {
      return false;
    }
    for (int i = 0, n = loc.length(); i < n; i++) {
      char c = loc.charAt(i);
      boolean ok =
          (c >= 'a' && c <= 'z')
              || (c >= 'A' && c <= 'Z')
              || (c >= '0' && c <= '9')
              || c == '-';
      if (!ok) {
        return false;
      }
    }
    return true;
  }

  public static boolean isSafeTokenRef(String ref) {
    if (ref == null || ref.isEmpty()) {
      return false;
    }
    String r = ref.trim();
    if (r.contains("..") || r.indexOf('\r') != -1 || r.indexOf('\n') != -1 || r.indexOf('\0') != -1 || r.indexOf(' ') != -1) {
      return false;
    }
    return SAFE_TOKEN_REF_PATTERN.matcher(r).matches();
  }

  public static boolean isSafeHeaderName(String hdr) {
    if (hdr == null || hdr.isEmpty()) {
      return false;
    }
    String h = hdr.trim();
    int len = h.length();
    if (len == 0 || len > 64) {
      return false;
    }
    for (int i = 0; i < len; i++) {
      char c = h.charAt(i);
      boolean ok =
          (c >= 'a' && c <= 'z')
              || (c >= 'A' && c <= 'Z')
              || (c >= '0' && c <= '9')
              || c == '_'
              || c == '-';
      if (!ok) {
        return false;
      }
    }
    return !"host".equalsIgnoreCase(h)
        && !"content-length".equalsIgnoreCase(h)
        && !"transfer-encoding".equalsIgnoreCase(h)
        && !"connection".equalsIgnoreCase(h);
  }

  public static String cleanTokenAttr(String val) {
    if (val == null || val.isEmpty()) {
      return null;
    }
    String s = val.trim();
    if (s.isEmpty() || "unset".equals(s) || "null".equals(s) || "undefined".equals(s)) {
      return null;
    }
    return s;
  }

  public static String stripControlChars(String val) {
    if (val == null || val.isEmpty()) {
      return "";
    }
    if (!hasControlChar(val)) {
      return val.trim();
    }
    StringBuilder sb = new StringBuilder(val.length());
    for (int i = 0, n = val.length(); i < n; i++) {
      char c = val.charAt(i);
      if (c >= 0x20 && c != 0x7F) {
        sb.append(c);
      }
    }
    return sb.toString().trim();
  }

  public static String cleanPatternToken(String raw) {
    if (raw == null || raw.isEmpty()) {
      return "";
    }
    int start = 0;
    int end = raw.length();
    while (start < end && isTrimBracketQuoteWs(raw.charAt(start))) {
      start++;
    }
    while (end > start && isTrimBracketQuoteWs(raw.charAt(end - 1))) {
      end--;
    }
    return start >= end ? "" : raw.substring(start, end).toLowerCase();
  }

  private static boolean isTrimBracketQuoteWs(char c) {
    return c <= ' ' || c == '[' || c == ']' || c == '"';
  }

  private static boolean isAllAsciiDigits(String s) {
    if (s == null || s.isEmpty()) {
      return false;
    }
    for (int i = 0, n = s.length(); i < n; i++) {
      char c = s.charAt(i);
      if (c < '0' || c > '9') {
        return false;
      }
    }
    return true;
  }

  public static boolean isTimestampExpired(String expVal) {
    if (expVal == null || expVal.isEmpty()) {
      return false;
    }
    String expStr = expVal.trim();
    if (expStr.isEmpty()
        || "unset".equalsIgnoreCase(expStr)
        || "null".equalsIgnoreCase(expStr)
        || "never".equalsIgnoreCase(expStr)) {
      return false;
    }
    long expMs;
    try {
      if (isAllAsciiDigits(expStr)) {
        expMs = Long.parseLong(expStr);
      } else if (expStr.length() == 10 && expStr.charAt(4) == '-' && expStr.charAt(7) == '-') {
        expMs =
            LocalDate.parse(expStr)
                .plusDays(1L)
                .atStartOfDay(ZoneOffset.UTC)
                .toInstant()
                .toEpochMilli();
      } else {
        char lastChar = expStr.charAt(expStr.length() - 1);
        if (lastChar == 'Z' || lastChar == 'z') {
          expMs = Instant.parse(expStr).toEpochMilli();
        } else {
          expMs = OffsetDateTime.parse(expStr).toInstant().toEpochMilli();
        }
      }
    } catch (Exception e) {
      // Fail closed: treat malformed non-empty expiration timestamps as expired
      return true;
    }
    if (expMs < 100000000000L) {
      expMs = expMs * 1000L;
    }
    return System.currentTimeMillis() >= expMs;
  }

  public static String usdToMicroStr(String val) {
    if (val == null || val.isEmpty()) {
      return "";
    }
    String s = val.trim();
    if (s.startsWith("$")) {
      s = s.substring(1).trim();
    }
    try {
      double num = Double.parseDouble(s);
      if (!Double.isFinite(num) || num < 0.0 || num > (Long.MAX_VALUE / 1_000_000.0)) {
        return "";
      }
      return String.valueOf(Math.round(num * 1_000_000.0));
    } catch (NumberFormatException e) {
      return "";
    }
  }

  public static String extractPathLocation(String pathSuffix, String fallbackLocation) {
    if (pathSuffix != null && !pathSuffix.isEmpty()) {
      final String marker = "/locations/";
      int idx = indexOfIgnoreCaseAscii(pathSuffix, marker);
      if (idx != -1) {
        int start = idx + marker.length();
        int slash = pathSuffix.indexOf('/', start);
        if (slash > start) {
          String loc = pathSuffix.substring(start, slash);
          if (isSafeLocation(loc)) {
            return loc;
          }
        }
      }
    }
    return fallbackLocation;
  }

  private static int indexOfIgnoreCaseAscii(String str, String needleLower) {
    int max = str.length() - needleLower.length();
    for (int i = 0; i <= max; i++) {
      if (str.regionMatches(true, i, needleLower, 0, needleLower.length())) {
        return i;
      }
    }
    return -1;
  }

  /**
   * Replaces {@code /models/<oldModel>} with {@code /models/<primaryModel>} using zero-allocation
   * index slicing (immune to {@link Matcher#replaceFirst} {@code $1} / {@code \} back-reference
   * crashes).
   */
  public static String replaceModelInPathSuffix(String pathSuffix, String primaryModel) {
    if (pathSuffix == null || pathSuffix.isEmpty()) {
      return "";
    }
    if (primaryModel == null || !isSafeSegment(primaryModel)) {
      return pathSuffix;
    }
    final String marker = "/models/";
    int idx = pathSuffix.indexOf(marker);
    if (idx == -1) {
      return pathSuffix;
    }
    int modelStart = idx + marker.length();
    if (modelStart >= pathSuffix.length()) {
      return pathSuffix;
    }
    int modelEnd = modelStart;
    while (modelEnd < pathSuffix.length()) {
      char c = pathSuffix.charAt(modelEnd);
      if (c == '/' || c == ':' || c == '?') {
        break;
      }
      modelEnd++;
    }
    if (modelEnd == modelStart) {
      return pathSuffix;
    }
    StringBuilder sb =
        new StringBuilder(pathSuffix.length() - (modelEnd - modelStart) + primaryModel.length());
    sb.append(pathSuffix, 0, modelStart);
    sb.append(primaryModel);
    sb.append(pathSuffix, modelEnd, pathSuffix.length());
    return sb.toString();
  }

  /**
   * Replaces {@code /projects/<oldProject>} with {@code /projects/<newProjectId>} using
   * zero-allocation index slicing.
   */
  public static String replaceProjectInPathSuffix(String pathSuffix, String newProjectId) {
    if (pathSuffix == null || pathSuffix.isEmpty()) {
      return "";
    }
    if (newProjectId == null || !isSafeSegment(newProjectId)) {
      return pathSuffix;
    }
    final String marker = "/projects/";
    int idx = pathSuffix.indexOf(marker);
    if (idx == -1) {
      return pathSuffix;
    }
    int projStart = idx + marker.length();
    if (projStart >= pathSuffix.length()) {
      return pathSuffix;
    }
    int projEnd = projStart;
    while (projEnd < pathSuffix.length()) {
      char c = pathSuffix.charAt(projEnd);
      if (c == '/' || c == ':' || c == '?') {
        break;
      }
      projEnd++;
    }
    if (projEnd == projStart) {
      return pathSuffix;
    }
    if ((projEnd - projStart) == newProjectId.length()
        && pathSuffix.regionMatches(projStart, newProjectId, 0, newProjectId.length())) {
      return pathSuffix;
    }
    StringBuilder sb =
        new StringBuilder(pathSuffix.length() - (projEnd - projStart) + newProjectId.length());
    sb.append(pathSuffix, 0, projStart);
    sb.append(newProjectId);
    sb.append(pathSuffix, projEnd, pathSuffix.length());
    return sb.toString();
  }

  public static final class ArmorTemplateSpec {
    public final boolean enabled;
    public final String projectId;
    public final String location;
    public final String template;

    public ArmorTemplateSpec(boolean enabled, String projectId, String location, String template) {
      this.enabled = enabled;
      this.projectId = projectId;
      this.location = location;
      this.template = template;
    }
  }

  public static ArmorTemplateSpec parseArmorTemplateSpec(String rawSpec, String defaultProj, String defaultLoc) {
    String clean = rawSpec != null ? rawSpec.trim() : "";
    String lower = clean.toLowerCase();
    if (clean.isEmpty()
        || "none".equals(lower)
        || "disabled".equals(lower)
        || "off".equals(lower)
        || "false".equals(lower)
        || "skip".equals(lower)) {
      return new ArmorTemplateSpec(false, defaultProj, defaultLoc, "none");
    }
    Matcher fullMatch = FULL_ARMOR_TEMPLATE_PATTERN.matcher(clean);
    if (fullMatch.matches()) {
      String loc = fullMatch.group(2);
      if ("global".equalsIgnoreCase(loc)) {
        loc = defaultLoc;
      }
      return new ArmorTemplateSpec(true, fullMatch.group(1), loc, fullMatch.group(3));
    }
    Matcher locMatch = LOC_ARMOR_TEMPLATE_PATTERN.matcher(clean);
    if (locMatch.matches()) {
      String loc = locMatch.group(1);
      if ("global".equalsIgnoreCase(loc)) {
        loc = defaultLoc;
      }
      return new ArmorTemplateSpec(true, defaultProj, loc, locMatch.group(2));
    }
    return new ArmorTemplateSpec(true, defaultProj, defaultLoc, clean);
  }

  public static String asString(Object obj) {
    return obj != null ? String.valueOf(obj) : null;
  }

  private static final java.math.BigDecimal MIN_LONG_BD =
      java.math.BigDecimal.valueOf(Long.MIN_VALUE);
  private static final java.math.BigDecimal MAX_LONG_BD =
      java.math.BigDecimal.valueOf(Long.MAX_VALUE);

  public static long asLong(Object obj, long defVal) {
    if (obj == null) {
      return defVal;
    }
    if (obj instanceof Number) {
      if (obj instanceof Long
          || obj instanceof Integer
          || obj instanceof Short
          || obj instanceof Byte) {
        return ((Number) obj).longValue();
      }
      if (obj instanceof java.math.BigDecimal) {
        java.math.BigDecimal bd = (java.math.BigDecimal) obj;
        if (bd.compareTo(MIN_LONG_BD) < 0 || bd.compareTo(MAX_LONG_BD) > 0) {
          return defVal;
        }
        return bd.longValue();
      }
      if (obj instanceof java.math.BigInteger) {
        java.math.BigInteger bi = (java.math.BigInteger) obj;
        if (bi.bitLength() > 63) {
          return defVal;
        }
        return bi.longValue();
      }
      if (obj instanceof Double || obj instanceof Float) {
        double d = ((Number) obj).doubleValue();
        if (!Double.isFinite(d) || d < Long.MIN_VALUE || d > Long.MAX_VALUE) {
          return defVal;
        }
      }
      return ((Number) obj).longValue();
    }
    try {
      String s = String.valueOf(obj).trim();
      if (s.isEmpty()) {
        return defVal;
      }
      if (s.indexOf('.') != -1) {
        double d = Double.parseDouble(s);
        if (!Double.isFinite(d) || d < Long.MIN_VALUE || d > Long.MAX_VALUE) {
          return defVal;
        }
        return (long) d;
      }
      return Long.parseLong(s);
    } catch (NumberFormatException e) {
      return defVal;
    }
  }

  public static double asDouble(Object obj, double defVal) {
    if (obj == null) {
      return defVal;
    }
    if (obj instanceof Number) {
      double d = ((Number) obj).doubleValue();
      return Double.isFinite(d) ? d : defVal;
    }
    try {
      String s = String.valueOf(obj).trim();
      if (s.isEmpty()) {
        return defVal;
      }
      double d = Double.parseDouble(s);
      return Double.isFinite(d) ? d : defVal;
    } catch (NumberFormatException e) {
      return defVal;
    }
  }

  public static double parseCleanRate(Object obj, double fallbackVal, boolean strictlyPositive) {
    if (obj == null) {
      return fallbackVal;
    }
    double d;
    if (obj instanceof Number) {
      d = ((Number) obj).doubleValue();
    } else {
      String s = String.valueOf(obj).trim();
      if (s.startsWith("$")) {
        s = s.substring(1).trim();
      }
      if (s.isEmpty()) {
        return fallbackVal;
      }
      try {
        d = Double.parseDouble(s);
      } catch (NumberFormatException e) {
        return fallbackVal;
      }
    }
    if (!Double.isFinite(d)) {
      return fallbackVal;
    }
    if (strictlyPositive ? (d <= 0.0) : (d < 0.0)) {
      return fallbackVal;
    }
    return d;
  }

  public static boolean isStrictZeroLimit(String raw) {
    if (raw == null || raw.isEmpty()) {
      return false;
    }
    String s = raw.trim();
    if (s.startsWith("$")) {
      s = s.substring(1).trim();
    }
    if (s.isEmpty()) {
      return false;
    }
    try {
      double d = Double.parseDouble(s);
      return Double.isFinite(d) && d == 0.0;
    } catch (NumberFormatException e) {
      return false;
    }
  }

  @SuppressWarnings("unchecked")
  public static Map<String, Object> asMap(Object obj) {
    return (obj instanceof Map) ? (Map<String, Object>) obj : null;
  }

  @SuppressWarnings("unchecked")
  public static List<Object> asList(Object obj) {
    return (obj instanceof List) ? (List<Object>) obj : null;
  }
}
