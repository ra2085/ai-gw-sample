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

// Copyright 2026 Google LLC.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package com.google.apigee.callouts;

import com.apigee.flow.execution.spi.Execution;
import com.apigee.flow.message.MessageContext;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Collections;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Abstract base class for stateless, thread-safe Apigee Java Callouts.
 *
 * <p><b>Apigee Runtime Lifecycle &amp; Security Architecture:</b>
 * <ul>
 *   <li><b>Singleton per {@code <Step>} Attachment:</b>
 *       Each {@code <Step>} in the flow decision tree instantiates its {@code Execution} class once at
 *       deployment initialization via the 1-arg {@code Map} constructor and invokes {@code execute()}
 *       concurrently across worker threads. Static properties such as {@code <Property name="action">}
 *       and embedded Base64 PropertySet payloads are pre-resolved once in this constructor into
 *       {@code final} fields for zero-allocation O(1) dispatch on every request.</li>
 *   <li><b>Self-First ClassLoading:</b>
 *       Shaded callout classes load self-first from {@code resources/java/ai-gateway-callouts.jar}.</li>
 *   <li><b>Sandbox Compatibility:</b>
 *       Requires zero filesystem I/O, outbound socket permissions, {@code System.setProperty} calls,
 *       or reflective access overrides.</li>
 * </ul>
 */
public abstract class BaseCallout implements Execution {

  private static final Pattern VARIABLE_REFERENCE_PATTERN = Pattern.compile("\\{([^\\}]+)\\}");

  private static final String[][] EMBEDDED_PROP_SPECS = {
    {"propertyset_config_b64", "propertyset.config."},
    {"propertyset_model_locations_b64", "propertyset.model_locations."},
    {"propertyset_monetization_rates_b64", "propertyset.monetization_rates."},
    {"propertyset_extract_expressions_b64", "propertyset.extract_expressions."}
  };

  private static final ConcurrentHashMap<String, Map<String, String>> EMBEDDED_PROP_CACHE =
      new ConcurrentHashMap<>(8);

  protected final Map<String, String> properties;
  protected final Map<String, String> staticPropertySets;
  protected final String staticAction;
  protected final String staticErrorPrefix;

  public BaseCallout(Map properties) {
    Map<String, String> m = new HashMap<>();
    if (properties != null) {
      Iterator iterator = properties.keySet().iterator();
      while (iterator.hasNext()) {
        Object key = iterator.next();
        Object value = properties.get(key);
        if ((key instanceof String) && (value instanceof String)) {
          m.put((String) key, (String) value);
        }
      }
    }
    this.properties = Collections.unmodifiableMap(m);
    this.staticPropertySets = parseEmbeddedPropertySets(this.properties);

    String rawAction = this.properties.get("action");
    if (rawAction != null) {
      rawAction = rawAction.trim();
    }
    this.staticAction =
        (rawAction != null && !rawAction.isEmpty() && rawAction.indexOf('{') == -1)
            ? rawAction
            : null;

    String rawPrefix = this.properties.get("error_prefix");
    if (rawPrefix != null) {
      rawPrefix = rawPrefix.trim();
    }
    this.staticErrorPrefix =
        (rawPrefix != null && !rawPrefix.isEmpty() && rawPrefix.indexOf('{') == -1)
            ? rawPrefix
            : null;
  }

  private static Map<String, String> parseEmbeddedPropertySets(Map<String, String> props) {
    if (props == null || props.isEmpty()) {
      return Collections.emptyMap();
    }
    StringBuilder keyBuilder = new StringBuilder(128);
    boolean hasAny = false;
    for (int i = 0; i < EMBEDDED_PROP_SPECS.length; i++) {
      String v = props.get(EMBEDDED_PROP_SPECS[i][0]);
      if (v != null && !v.trim().isEmpty()) {
        hasAny = true;
        keyBuilder.append(v.trim());
      }
      keyBuilder.append('|');
    }
    if (!hasAny) {
      return Collections.emptyMap();
    }

    String cacheKey = keyBuilder.toString();
    Map<String, String> cached = EMBEDDED_PROP_CACHE.get(cacheKey);
    if (cached != null) {
      return cached;
    }

    Map<String, String> parsed = new HashMap<>(64);
    for (int i = 0; i < EMBEDDED_PROP_SPECS.length; i++) {
      String propKey = EMBEDDED_PROP_SPECS[i][0];
      String prefix = EMBEDDED_PROP_SPECS[i][1];
      String b64 = props.get(propKey);
      if (b64 == null || b64.trim().isEmpty()) {
        continue;
      }
      try {
        byte[] decodedBytes = Base64.getDecoder().decode(b64.trim());
        String content = new String(decodedBytes, StandardCharsets.UTF_8);
        int start = 0;
        int len = content.length();
        while (start < len) {
          int nl = content.indexOf('\n', start);
          String line = (nl == -1) ? content.substring(start) : content.substring(start, nl);
          start = (nl == -1) ? len : (nl + 1);
          String trimmed = line.trim();
          if (trimmed.isEmpty() || trimmed.charAt(0) == '#' || trimmed.charAt(0) == '!') {
            continue;
          }
          int eq = trimmed.indexOf('=');
          if (eq <= 0) {
            continue;
          }
          String k = trimmed.substring(0, eq).trim().replace("\\:", ":");
          String v = trimmed.substring(eq + 1).trim();
          if (!k.isEmpty() && !v.isEmpty()) {
            parsed.put(prefix + k, v);
          }
        }
      } catch (IllegalArgumentException ignored) {
        // Ignore malformed Base64 property value and continue safely
      }
    }

    Map<String, String> unmodifiable =
        parsed.isEmpty() ? Collections.emptyMap() : Collections.unmodifiableMap(parsed);
    if (EMBEDDED_PROP_CACHE.size() >= 64) {
      EMBEDDED_PROP_CACHE.clear();
    }
    Map<String, String> existing = EMBEDDED_PROP_CACHE.putIfAbsent(cacheKey, unmodifiable);
    return existing != null ? existing : unmodifiable;
  }

  public abstract String getVarprefix();

  protected String varName(String label) {
    return getVarprefix() + label;
  }

  /**
   * Returns the configured {@code <Property name="action">} in O(1) with zero allocations when the
   * property is a static literal (pre-resolved at construction time in {@link #staticAction}), or
   * evaluates dynamic {@code {var}} placeholders via {@link #getSimpleOptionalProperty(String, MessageContext)}.
   */
  protected String resolveAction(MessageContext msgCtxt, String defaultAction) {
    if (this.staticAction != null) {
      return this.staticAction;
    }
    String dynamicAction = getSimpleOptionalProperty("action", msgCtxt);
    return (dynamicAction != null) ? dynamicAction : defaultAction;
  }

  protected String getSimpleOptionalProperty(String propName, MessageContext msgCtxt) {
    String value = this.properties.get(propName);
    if (value == null) {
      return null;
    }
    value = value.trim();
    if (value.isEmpty()) {
      return null;
    }
    value = resolvePropertyValue(value, msgCtxt);
    if (value == null || value.isEmpty()) {
      return null;
    }
    return value;
  }

  protected String getSimpleRequiredProperty(String propName, MessageContext msgCtxt)
      throws IllegalStateException {
    String value = this.properties.get(propName);
    if (value == null) {
      throw new IllegalStateException(propName + " resolves to an empty string");
    }
    value = value.trim();
    if (value.isEmpty()) {
      throw new IllegalStateException(propName + " resolves to an empty string");
    }
    value = resolvePropertyValue(value, msgCtxt);
    if (value == null || value.isEmpty()) {
      throw new IllegalStateException(propName + " resolves to an empty string");
    }
    return value;
  }

  protected String resolvePropertyValue(String spec, MessageContext msgCtxt) {
    if (spec.indexOf('{') == -1) {
      return spec;
    }
    Matcher matcher = VARIABLE_REFERENCE_PATTERN.matcher(spec);
    StringBuffer sb = new StringBuffer(spec.length() + 16);
    while (matcher.find()) {
      matcher.appendReplacement(sb, "");
      String refName = matcher.group(1);
      Object v = null;
      if (!this.staticPropertySets.isEmpty() && refName.startsWith("propertyset.")) {
        v = this.staticPropertySets.get(refName);
      }
      if (v == null || v.toString().isEmpty()) {
        v = msgCtxt.getVariable(refName);
      }
      if (v != null) {
        sb.append(v.toString());
      }
    }
    matcher.appendTail(sb);
    return (sb.length() > 0) ? sb.toString() : null;
  }

  protected static String firstNonEmpty(String a, String b) {
    return (a != null && !a.isEmpty()) ? a : b;
  }

  protected static String firstNonEmpty(String a, String b, String c) {
    if (a != null && !a.isEmpty()) {
      return a;
    }
    return (b != null && !b.isEmpty()) ? b : c;
  }

  protected static String firstNonEmpty(String a, String b, String c, String d) {
    if (a != null && !a.isEmpty()) {
      return a;
    }
    if (b != null && !b.isEmpty()) {
      return b;
    }
    return (c != null && !c.isEmpty()) ? c : d;
  }

  protected static String firstNonEmpty(String... values) {
    if (values == null || values.length == 0) {
      return null;
    }
    for (String v : values) {
      if (v != null && !v.isEmpty()) {
        return v;
      }
    }
    return values[values.length - 1];
  }

  protected static String getStackTrace(Throwable e) {
    StringWriter sw = new StringWriter();
    PrintWriter pw = new PrintWriter(sw);
    e.printStackTrace(pw);
    return sw.toString();
  }

  /**
   * Records exception diagnostics in flow variables while strictly isolating raw stack traces
   * inside the {@code private.*} namespace so they are masked in Apigee Trace/Debug sessions
   * and never leaked to clients (apigee-security-engineering Section 1.5 &amp; 8.2).
   */
  protected void setExceptionVariables(Exception exc1, MessageContext msgCtxt) {
    String error = exc1.toString().replaceAll("[\\r\\n]+", " ");
    String stack = getStackTrace(exc1);
    msgCtxt.setVariable(varName("error"), error);
    msgCtxt.setVariable("private." + varName("stacktrace"), stack);
    if (this.staticErrorPrefix != null && !this.staticErrorPrefix.equals(getVarprefix())) {
      msgCtxt.setVariable(this.staticErrorPrefix + "error", error);
      msgCtxt.setVariable("private." + this.staticErrorPrefix + "stacktrace", stack);
    }
  }
}
