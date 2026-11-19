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
import com.apigee.flow.message.Message;
import com.apigee.flow.message.MessageContext;
import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.util.Collection;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Instrumented mock {@link MessageContext} and {@link ExecutionContext} using dynamic proxies.
 *
 * <p>Enforces:
 * <ul>
 *   <li>Rule 2 (Single-read memoization): Tracks per-variable {@code getVariable} counts so tests
 *       can assert {@code count <= 1} per callout execution.
 *   <li>Rule 5.1 (No raw Collection/Map/Array leaked into MessageContext): Throws
 *       {@link AssertionError} if {@code setVariable} is called with a complex Java object.
 * </ul>
 */
public final class InstrumentedMessageContext {

  private final Map<String, Object> variables = new ConcurrentHashMap<>();
  private final Map<String, Message> messages = new ConcurrentHashMap<>();
  private final Map<String, MockMessageState> messageStates = new ConcurrentHashMap<>();
  private final MockMessageState requestMessageState = new MockMessageState();
  private final Message requestMessageProxy;
  private final Map<String, AtomicInteger> readCounts = new ConcurrentHashMap<>();
  private final Map<String, AtomicInteger> writeCounts = new ConcurrentHashMap<>();
  private final MessageContext messageContextProxy;
  private final ExecutionContext executionContextProxy;

  public InstrumentedMessageContext() {
    this(new HashMap<>());
  }

  public InstrumentedMessageContext(Map<String, Object> initialVars) {
    if (initialVars != null) {
      for (Map.Entry<String, Object> entry : initialVars.entrySet()) {
        if (entry.getValue() != null) {
          this.variables.put(entry.getKey(), entry.getValue());
        }
      }
    }

    this.requestMessageProxy = createMessageProxy(this.requestMessageState);

    this.messageContextProxy =
        (MessageContext)
            Proxy.newProxyInstance(
                MessageContext.class.getClassLoader(),
                new Class<?>[] {MessageContext.class},
                new MessageContextHandler());

    this.executionContextProxy =
        (ExecutionContext)
            Proxy.newProxyInstance(
                ExecutionContext.class.getClassLoader(),
                new Class<?>[] {ExecutionContext.class},
                new ExecutionContextHandler());
  }

  public MessageContext getMessageContext() {
    return messageContextProxy;
  }

  public ExecutionContext getExecutionContext() {
    return executionContextProxy;
  }

  public void setRequestHeader(String name, String value) {
    if (value == null) {
      requestMessageState.removeHeader(name);
    } else {
      requestMessageState.setHeader(name, value);
    }
  }

  public Map<String, String> getCreatedMessageHeaders(String varName) {
    MockMessageState state = messageStates.get(varName);
    return state != null ? state.snapshotHeaders() : Collections.emptyMap();
  }

  public String getCreatedMessageContent(String varName) {
    MockMessageState state = messageStates.get(varName);
    return state != null ? state.content : null;
  }

  @SuppressWarnings("unchecked")
  public <T> T getVar(String name) {
    if (messages.containsKey(name)) {
      return (T) messages.get(name);
    }
    return (T) variables.get(name);
  }

  public String getString(String name) {
    Object val = variables.get(name);
    return val != null ? String.valueOf(val) : null;
  }

  public void putVar(String name, Object value) {
    if (value == null) {
      variables.remove(name);
      messages.remove(name);
      messageStates.remove(name);
    } else {
      variables.put(name, value);
    }
  }

  public Map<String, Object> getAllVariables() {
    return new HashMap<>(variables);
  }

  public int getReadCount(String name) {
    AtomicInteger count = readCounts.get(name);
    return count != null ? count.get() : 0;
  }

  public Map<String, Integer> getDuplicateReads() {
    Map<String, Integer> duplicates = new HashMap<>();
    for (Map.Entry<String, AtomicInteger> entry : readCounts.entrySet()) {
      if (entry.getValue().get() > 1) {
        duplicates.put(entry.getKey(), entry.getValue().get());
      }
    }
    return duplicates;
  }

  public Map<String, Integer> getReadCounts() {
    Map<String, Integer> map = new HashMap<>();
    for (Map.Entry<String, AtomicInteger> entry : readCounts.entrySet()) {
      map.put(entry.getKey(), entry.getValue().get());
    }
    return map;
  }

  public Map<String, Integer> getWriteCounts() {
    Map<String, Integer> map = new HashMap<>();
    for (Map.Entry<String, AtomicInteger> entry : writeCounts.entrySet()) {
      map.put(entry.getKey(), entry.getValue().get());
    }
    return map;
  }

  public void resetReadCounts() {
    readCounts.clear();
    writeCounts.clear();
  }

  private static Message createMessageProxy(MockMessageState state) {
    return (Message)
        Proxy.newProxyInstance(
            Message.class.getClassLoader(),
            new Class<?>[] {Message.class, MockStateHolder.class},
            (proxy, method, args) -> {
              String m = method.getName();
              if ("getMockState".equals(m)) {
                return state;
              }
              if ("getTransportMessage".equals(m)) {
                return null;
              }
              if ("getHeaderNames".equals(m)) {
                return new LinkedHashSet<>(state.headers.keySet());
              }
              if ("getHeader".equals(m) && args != null && args.length >= 1) {
                return state.getHeader(String.valueOf(args[0]));
              }
              if ("getHeaders".equals(m) && args != null && args.length == 1) {
                String v = state.getHeader(String.valueOf(args[0]));
                return v != null ? Collections.singletonList(v) : Collections.emptyList();
              }
              if ("setHeader".equals(m) && args != null && args.length == 2) {
                state.setHeader(
                    String.valueOf(args[0]), args[1] != null ? String.valueOf(args[1]) : null);
                return Boolean.TRUE;
              }
              if ("removeHeader".equals(m) && args != null && args.length >= 1) {
                return state.removeHeader(String.valueOf(args[0]));
              }
              if ("getContent".equals(m)) {
                return state.content;
              }
              if ("setContent".equals(m) && args != null && args.length == 1) {
                state.content = args[0] != null ? String.valueOf(args[0]) : null;
                return null;
              }
              if ("toString".equals(m)) {
                return "MockMessage";
              }
              return null;
            });
  }

  private interface MockStateHolder {
    MockMessageState getMockState();
  }

  private static final class MockMessageState {
    final Map<String, String> headers = new LinkedHashMap<>();
    String content = "";

    String getHeader(String key) {
      for (Map.Entry<String, String> e : headers.entrySet()) {
        if (e.getKey().equalsIgnoreCase(key)) {
          return e.getValue();
        }
      }
      return null;
    }

    void setHeader(String key, String val) {
      String existing = null;
      for (String k : headers.keySet()) {
        if (k.equalsIgnoreCase(key)) {
          existing = k;
          break;
        }
      }
      if (existing != null) {
        headers.remove(existing);
      }
      if (val != null) {
        headers.put(key, val);
      }
    }

    boolean removeHeader(String key) {
      String existing = null;
      for (String k : headers.keySet()) {
        if (k.equalsIgnoreCase(key)) {
          existing = k;
          break;
        }
      }
      if (existing != null) {
        headers.remove(existing);
        return true;
      }
      return false;
    }

    Map<String, String> snapshotHeaders() {
      return new LinkedHashMap<>(headers);
    }
  }

  private final class MessageContextHandler implements InvocationHandler {
    @Override
    public Object invoke(Object proxy, Method method, Object[] args) {
      String name = method.getName();
      if ("getRequestMessage".equals(name) || "getMessage".equals(name) && (args == null || args.length == 0)) {
        return requestMessageProxy;
      }
      if ("createMessage".equals(name) && args != null && args.length == 1) {
        MockMessageState state =
            (args[0] instanceof MockStateHolder)
                ? ((MockStateHolder) args[0]).getMockState()
                : new MockMessageState();
        return createMessageProxy(state);
      }
      if ("getVariable".equals(name) && args != null && args.length == 1) {
        String key = String.valueOf(args[0]);
        readCounts.computeIfAbsent(key, k -> new AtomicInteger(0)).incrementAndGet();
        if (messages.containsKey(key)) {
          return messages.get(key);
        }
        return variables.get(key);
      }
      if ("setVariable".equals(name) && args != null && args.length == 2) {
        String key = String.valueOf(args[0]);
        Object val = args[1];
        if (val != null) {
          if (val instanceof Message) {
            messages.put(key, (Message) val);
            if (val instanceof MockStateHolder) {
              messageStates.put(key, ((MockStateHolder) val).getMockState());
            }
            writeCounts.computeIfAbsent(key, k -> new AtomicInteger(0)).incrementAndGet();
            return Boolean.TRUE;
          }
          if (val instanceof Collection<?>
              || val instanceof Map<?, ?>
              || val.getClass().isArray()) {
            throw new AssertionError(
                "Performance Skill Violation: Raw Java Collection/Map/Array stored in"
                    + " MessageContext variable '"
                    + key
                    + "' ("
                    + val.getClass().getName()
                    + ")");
          }
          variables.put(key, val);
        } else {
          variables.remove(key);
          messages.remove(key);
          messageStates.remove(key);
        }
        writeCounts.computeIfAbsent(key, k -> new AtomicInteger(0)).incrementAndGet();
        return Boolean.TRUE;
      }
      if ("removeVariable".equals(name) && args != null && args.length == 1) {
        String key = String.valueOf(args[0]);
        variables.remove(key);
        messages.remove(key);
        messageStates.remove(key);
        return Boolean.TRUE;
      }
      if ("toString".equals(name)) {
        return "InstrumentedMessageContext";
      }
      return null;
    }
  }

  private static final class ExecutionContextHandler implements InvocationHandler {
    @Override
    public Object invoke(Object proxy, Method method, Object[] args) {
      if ("toString".equals(nameOf(method))) {
        return "InstrumentedExecutionContext";
      }
      return null;
    }

    private static String nameOf(Method m) {
      return m != null ? m.getName() : "";
    }
  }
}
