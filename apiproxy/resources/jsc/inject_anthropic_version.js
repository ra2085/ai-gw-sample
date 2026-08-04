var content = context.getVariable("request.content");
if (content) {
    var contentStr = content.toString();

    // 1. Remove the "model" field (Vertex AI Anthropic endpoint does not permit it in the request body)
    var cleaned = contentStr.replace(/"model"\s*:\s*"[^"]*"\s*,?/, "");

    // 2. Inject the required "anthropic_version" attribute at the opening brace
    context.setVariable("request.content", cleaned.replace("{", '{"anthropic_version":"vertex-2023-10-16",'));
}
