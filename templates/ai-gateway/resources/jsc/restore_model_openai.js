try {
    var customUrl = context.getVariable("model_custom_url");
    if (customUrl) {
        context.setVariable("target.url", customUrl);
    }
    var originalModel = context.getVariable("original_model");
    if (!originalModel || customUrl) {
        originalModel = context.getVariable("model");
    }
    var bodyStr = context.getVariable("request.content");
    if (bodyStr) {
        var body = JSON.parse(bodyStr);
        body.model = originalModel;
        context.setVariable("request.content", JSON.stringify(body));
    }
} catch (e) {
    print("Error restoring original OpenAI model prefix: " + e);
}

