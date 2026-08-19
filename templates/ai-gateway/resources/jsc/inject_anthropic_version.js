try {
    var content = context.getVariable("request.content");
    if (content) {
        var body = JSON.parse(content);

        // Remove gateway/non-standard top-level fields not accepted by Anthropic
        delete body.model;
        delete body.models;
        delete body.plugins;
        delete body.provider;

        // Ensure required anthropic_version is present
        body.anthropic_version = "vertex-2023-10-16";

        context.setVariable("request.content", JSON.stringify(body));
    }
} catch (e) {
    print("Error in inject_anthropic_version: " + e);
}
