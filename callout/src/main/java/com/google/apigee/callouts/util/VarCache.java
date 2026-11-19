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

import com.apigee.flow.message.MessageContext;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

/**
 * Per-invocation local variable cache wrapping {@link MessageContext}.
 *
 * <p>Enforces {@code apigee-performance-engineering} Rule 2: every flow variable is read from
 * {@code MessageContext.getVariable(key)} at most once per callout execution, eliminating repeated
 * synchronization and tree traversal across the Apigee variable map. Also falls back to static
 * embedded PropertySet maps when executing inside Apigee's out-of-process Remote Policy Sandbox
 * ({@code apigee-sandbox} / {@code remoteexecution=true}), where {@code propertyset.*} keys are
 * not serialized over gRPC in {@code MessageContext}.
 *
 * <p>Instances of {@code VarCache} MUST be allocated on the stack inside {@code execute()} and
 * NEVER stored in a field on a {@code BaseCallout} singleton.
 */
public final class VarCache {

  private final MessageContext msgCtxt;
  private final Map<String, Object> cache = new HashMap<>(64);
  private Map<String, String> fallbackProperties = Collections.emptyMap();

  public VarCache(MessageContext msgCtxt) {
    this.msgCtxt = msgCtxt;
  }

  public VarCache withFallbackProperties(Map<String, String> fallbackProperties) {
    if (fallbackProperties != null && !fallbackProperties.isEmpty()) {
      this.fallbackProperties = fallbackProperties;
    }
    return this;
  }

  public boolean hasFallbackProperties() {
    return !fallbackProperties.isEmpty();
  }

  public String getFallbackProperty(String key) {
    return fallbackProperties.get(key);
  }

  public Object get(String key) {
    if (cache.containsKey(key)) {
      return cache.get(key);
    }
    if (!fallbackProperties.isEmpty() && key.startsWith("propertyset.")) {
      String embedded = fallbackProperties.get(key);
      if (embedded != null && !embedded.isEmpty()) {
        cache.put(key, embedded);
        return embedded;
      }
    }
    Object val = msgCtxt.getVariable(key);
    cache.put(key, val);
    return val;
  }

  public String getString(String key) {
    Object val = get(key);
    return val != null ? String.valueOf(val) : null;
  }

  public String getNonEmpty(String key) {
    String s = getString(key);
    return (s != null && !s.isEmpty()) ? s : null;
  }

  public String getCleanedTokenAttr(String key) {
    return GlobMatcher.cleanTokenAttr(getString(key));
  }

  public String firstCleanedKey(String k1, String k2) {
    String v = getCleanedTokenAttr(k1);
    return v != null ? v : getCleanedTokenAttr(k2);
  }

  public String firstCleanedKey(String k1, String k2, String k3, String k4) {
    String v = getCleanedTokenAttr(k1);
    if (v != null) {
      return v;
    }
    v = getCleanedTokenAttr(k2);
    if (v != null) {
      return v;
    }
    v = getCleanedTokenAttr(k3);
    return v != null ? v : getCleanedTokenAttr(k4);
  }

  public String getOrDefault(String key, String defaultValue) {
    String s = getNonEmpty(key);
    return s != null ? s : defaultValue;
  }

  public String firstNonEmptyKey(String k1, String k2) {
    String v = (k1 != null && !k1.isEmpty()) ? getNonEmpty(k1) : null;
    if (v != null) {
      return v;
    }
    return (k2 != null && !k2.isEmpty()) ? getNonEmpty(k2) : null;
  }

  public String firstNonEmptyKey(String k1, String k2, String k3) {
    String v = (k1 != null && !k1.isEmpty()) ? getNonEmpty(k1) : null;
    if (v != null) {
      return v;
    }
    v = (k2 != null && !k2.isEmpty()) ? getNonEmpty(k2) : null;
    if (v != null) {
      return v;
    }
    return (k3 != null && !k3.isEmpty()) ? getNonEmpty(k3) : null;
  }

  public String firstNonEmptyKey(String k1, String k2, String k3, String k4) {
    String v = (k1 != null && !k1.isEmpty()) ? getNonEmpty(k1) : null;
    if (v != null) {
      return v;
    }
    v = (k2 != null && !k2.isEmpty()) ? getNonEmpty(k2) : null;
    if (v != null) {
      return v;
    }
    v = (k3 != null && !k3.isEmpty()) ? getNonEmpty(k3) : null;
    if (v != null) {
      return v;
    }
    return (k4 != null && !k4.isEmpty()) ? getNonEmpty(k4) : null;
  }

  public String firstNonEmptyKey(String... keys) {
    if (keys == null) {
      return null;
    }
    for (String k : keys) {
      if (k != null && !k.isEmpty()) {
        String v = getNonEmpty(k);
        if (v != null) {
          return v;
        }
      }
    }
    return null;
  }

  public String firstNonEmptyKeyOrDefault(String defaultValue, String k1, String k2) {
    String v = firstNonEmptyKey(k1, k2);
    return v != null ? v : defaultValue;
  }

  public String firstNonEmptyKeyOrDefault(String defaultValue, String k1, String k2, String k3) {
    String v = firstNonEmptyKey(k1, k2, k3);
    return v != null ? v : defaultValue;
  }

  public String firstNonEmptyKeyOrDefault(
      String defaultValue, String k1, String k2, String k3, String k4) {
    String v = firstNonEmptyKey(k1, k2, k3, k4);
    return v != null ? v : defaultValue;
  }

  public String firstNonEmptyKeyOrDefault(String defaultValue, String... keys) {
    String v = firstNonEmptyKey(keys);
    return v != null ? v : defaultValue;
  }

  public void set(String key, Object value) {
    msgCtxt.setVariable(key, value);
    cache.put(key, value);
  }

  public void remove(String key) {
    msgCtxt.removeVariable(key);
    cache.put(key, null);
  }

  public MessageContext rawContext() {
    return msgCtxt;
  }
}
