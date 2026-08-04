try {
    var originalModel = context.getVariable("original_model");
    var bodyStr = context.getVariable("request.content");
    if (originalModel && bodyStr) {
        var body = JSON.parse(bodyStr);
        body.model = originalModel;
        context.setVariable("request.content", JSON.stringify(body));
    }
} catch (e) {
    print("Error restoring original OpenAI model prefix: " + e);
}
