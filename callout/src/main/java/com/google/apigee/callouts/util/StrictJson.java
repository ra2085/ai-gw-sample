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

import com.fasterxml.jackson.core.JsonFactory;
import com.fasterxml.jackson.core.JsonGenerator;
import com.fasterxml.jackson.core.JsonParseException;
import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.JsonToken;
import com.fasterxml.jackson.core.StreamReadConstraints;
import com.fasterxml.jackson.core.StreamReadFeature;
import com.fasterxml.jackson.core.exc.InputCoercionException;
import com.fasterxml.jackson.core.exc.StreamReadException;
import com.fasterxml.jackson.core.util.JsonRecyclerPools;
import java.io.IOException;
import java.io.StringWriter;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Thread-safe, zero-reflection JSON parser and serializer backed by {@code jackson-core}
 * ({@link JsonFactory}, {@link JsonParser}, {@link JsonGenerator}) with parser-differential
 * security hardening ({@code apigee-security-engineering} Section 1.2, 8.2 &amp; 8.3):
 * <ul>
 *   <li>Uses {@code private static final JsonFactory} singletons explicitly configured with
 *       {@link JsonRecyclerPools#threadLocalPool()} ({@code ThreadLocal<SoftReference<BufferRecycler>>})
 *       instead of Jackson 2.17's default strong-ref {@code LockFreePool}, allowing the JVM GC to
 *       reclaim multi-MB multimodal {@code BufferRecycler} arrays across Apigee worker threads.</li>
 *   <li>Enforces {@link JsonParser.Feature#STRICT_DUPLICATE_DETECTION} when
 *       {@code failOnDuplicateKeys == true} to prevent First-Key-Wins (Jayway JsonPath) vs.
 *       Last-Key-Wins key smuggling across all nesting levels.</li>
 *   <li>Enforces strict trailing-token rejection and bounded {@link StreamReadConstraints}
 *       aligned with Apigee's 30 MB payload ceiling ({@code MAX_DEPTH = 256},
 *       {@code MAX_STRING_LENGTH = 32 MB}, {@code MAX_DOCUMENT_LENGTH = 32 MB},
 *       {@code MAX_NUMBER_LENGTH = 1000}).</li>
 * </ul>
 */
public final class StrictJson {

  public static final int MAX_DEPTH = 256;
  public static final int MAX_STRING_LENGTH = 32 * 1024 * 1024;
  public static final long MAX_DOCUMENT_LENGTH = 32L * 1024L * 1024L;
  public static final int MAX_NUMBER_LENGTH = 1000;

  private static final Pattern JACKSON_DUP_FIELD_PATTERN =
      Pattern.compile("Duplicate field '([^']*)'");

  private static final StreamReadConstraints READ_CONSTRAINTS =
      StreamReadConstraints.builder()
          .maxNestingDepth(MAX_DEPTH)
          .maxStringLength(MAX_STRING_LENGTH)
          .maxDocumentLength(MAX_DOCUMENT_LENGTH)
          .maxNumberLength(MAX_NUMBER_LENGTH)
          .build();

  /**
   * Thread-safe singleton {@link JsonFactory} with {@link JsonParser.Feature#STRICT_DUPLICATE_DETECTION}
   * enabled for untrusted client ingress payloads and {@link JsonRecyclerPools#threadLocalPool()}
   * soft-reference buffer recycling.
   */
  private static final JsonFactory STRICT_FACTORY =
      JsonFactory.builder()
          .recyclerPool(JsonRecyclerPools.threadLocalPool())
          .streamReadConstraints(READ_CONSTRAINTS)
          .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
          .build()
          .enable(JsonParser.Feature.STRICT_DUPLICATE_DETECTION);

  /**
   * Thread-safe singleton {@link JsonFactory} with duplicate-key detection disabled for trusted
   * upstream provider responses and {@link JsonRecyclerPools#threadLocalPool()} soft-reference
   * buffer recycling.
   */
  private static final JsonFactory LENIENT_FACTORY =
      JsonFactory.builder()
          .recyclerPool(JsonRecyclerPools.threadLocalPool())
          .streamReadConstraints(READ_CONSTRAINTS)
          .disable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
          .build()
          .disable(JsonParser.Feature.STRICT_DUPLICATE_DETECTION);

  private StrictJson() {}

  public static boolean usesThreadLocalSoftRecyclerPool() {
    return STRICT_FACTORY._getRecyclerPool() == JsonRecyclerPools.threadLocalPool()
        && LENIENT_FACTORY._getRecyclerPool() == JsonRecyclerPools.threadLocalPool();
  }

  public static class StrictJsonException extends RuntimeException {
    public StrictJsonException(String message) {
      super(message);
    }

    public StrictJsonException(String message, Throwable cause) {
      super(message, cause);
    }
  }

  public static final class DuplicateKeyException extends StrictJsonException {
    private final String duplicateKey;

    public DuplicateKeyException(String duplicateKey) {
      super("Duplicate JSON object key detected: " + duplicateKey);
      this.duplicateKey = duplicateKey;
    }

    public String getDuplicateKey() {
      return duplicateKey;
    }
  }

  public static Object parse(String json) {
    return parse(json, false);
  }

  public static Object parseStrict(String json) {
    return parse(json, true);
  }

  @SuppressWarnings("unchecked")
  public static Map<String, Object> parseObject(String json, boolean failOnDuplicateKeys) {
    Object parsed = parse(json, failOnDuplicateKeys);
    if (parsed instanceof Map) {
      return (Map<String, Object>) parsed;
    }
    throw new StrictJsonException("Expected JSON Object at root");
  }

  public static Object parse(String json, boolean failOnDuplicateKeys) {
    if (json == null) {
      throw new StrictJsonException("JSON input is null");
    }
    JsonFactory factory = failOnDuplicateKeys ? STRICT_FACTORY : LENIENT_FACTORY;
    try (JsonParser parser = factory.createParser(json)) {
      JsonToken firstToken = parser.nextToken();
      if (firstToken == null) {
        throw new StrictJsonException("Unexpected end of JSON input");
      }
      Object root = readValue(parser, firstToken, 0, failOnDuplicateKeys);
      if (parser.nextToken() != null) {
        throw new StrictJsonException("Trailing tokens after JSON root value");
      }
      return root;
    } catch (DuplicateKeyException dke) {
      throw dke;
    } catch (StreamReadException sre) {
      String msg = sre.getMessage();
      if (failOnDuplicateKeys && msg != null && msg.contains("Duplicate field '")) {
        Matcher m = JACKSON_DUP_FIELD_PATTERN.matcher(msg);
        String dupKey = m.find() ? m.group(1) : "unknown";
        throw new DuplicateKeyException(dupKey);
      }
      throw new StrictJsonException("Invalid JSON payload: " + msg, sre);
    } catch (IOException ioe) {
      throw new StrictJsonException("I/O error parsing JSON payload: " + ioe.getMessage(), ioe);
    }
  }

  private static Object readValue(
      JsonParser parser, JsonToken token, int depth, boolean failOnDuplicateKeys)
      throws IOException {
    if (depth > MAX_DEPTH) {
      throw new StrictJsonException("Maximum JSON nesting depth (" + MAX_DEPTH + ") exceeded");
    }
    switch (token) {
      case START_OBJECT:
        Map<String, Object> map = new LinkedHashMap<>();
        while (true) {
          JsonToken next = parser.nextToken();
          if (next == JsonToken.END_OBJECT) {
            return map;
          }
          if (next != JsonToken.FIELD_NAME) {
            throw new StrictJsonException("Expected field name in JSON object, got: " + next);
          }
          String key = parser.currentName();
          JsonToken valToken = parser.nextToken();
          if (valToken == null) {
            throw new StrictJsonException("Unexpected end of JSON object after key: " + key);
          }
          Object val = readValue(parser, valToken, depth + 1, failOnDuplicateKeys);
          if (failOnDuplicateKeys && map.containsKey(key)) {
            throw new DuplicateKeyException(key);
          }
          map.put(key, val);
        }
      case START_ARRAY:
        List<Object> list = new ArrayList<>();
        while (true) {
          JsonToken next = parser.nextToken();
          if (next == JsonToken.END_ARRAY) {
            return list;
          }
          if (next == null) {
            throw new StrictJsonException("Unterminated JSON array");
          }
          list.add(readValue(parser, next, depth + 1, failOnDuplicateKeys));
        }
      case VALUE_STRING:
        return parser.getText();
      case VALUE_NUMBER_INT:
        try {
          return Long.valueOf(parser.getLongValue());
        } catch (InputCoercionException | JsonParseException overflowEx) {
          return parser.getBigIntegerValue();
        }
      case VALUE_NUMBER_FLOAT:
        return parser.getDecimalValue();
      case VALUE_TRUE:
        return Boolean.TRUE;
      case VALUE_FALSE:
        return Boolean.FALSE;
      case VALUE_NULL:
        return null;
      default:
        throw new StrictJsonException("Unexpected JSON token: " + token);
    }
  }

  public static String stringify(Object value) {
    StringWriter sw = new StringWriter(256);
    try (JsonGenerator gen = STRICT_FACTORY.createGenerator(sw)) {
      writeValue(gen, value);
    } catch (IOException ioe) {
      throw new StrictJsonException("Failed to serialize JSON value", ioe);
    }
    return sw.toString();
  }

  @SuppressWarnings("unchecked")
  private static void writeValue(JsonGenerator gen, Object value) throws IOException {
    if (value == null) {
      gen.writeNull();
    } else if (value instanceof String) {
      gen.writeString((String) value);
    } else if (value instanceof Number) {
      Number n = (Number) value;
      if (n instanceof BigInteger) {
        gen.writeNumber((BigInteger) n);
      } else if (n instanceof BigDecimal) {
        gen.writeNumber((BigDecimal) n);
      } else if (n instanceof Double || n instanceof Float) {
        double d = n.doubleValue();
        if (Double.isNaN(d) || Double.isInfinite(d)) {
          gen.writeNull();
        } else {
          gen.writeNumber(d);
        }
      } else {
        gen.writeNumber(n.longValue());
      }
    } else if (value instanceof Boolean) {
      gen.writeBoolean(((Boolean) value).booleanValue());
    } else if (value instanceof Map) {
      Map<String, Object> map = (Map<String, Object>) value;
      gen.writeStartObject();
      for (Map.Entry<String, Object> entry : map.entrySet()) {
        if (entry.getKey() == null) {
          continue;
        }
        gen.writeFieldName(String.valueOf(entry.getKey()));
        writeValue(gen, entry.getValue());
      }
      gen.writeEndObject();
    } else if (value instanceof List) {
      List<Object> list = (List<Object>) value;
      gen.writeStartArray();
      for (int i = 0; i < list.size(); i++) {
        writeValue(gen, list.get(i));
      }
      gen.writeEndArray();
    } else {
      gen.writeString(String.valueOf(value));
    }
  }
}
