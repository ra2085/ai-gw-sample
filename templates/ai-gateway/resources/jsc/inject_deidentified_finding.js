(function () {
'use strict';

try {
    var rawError = context.getVariable("error.content");
    var error = rawError ? JSON.parse(rawError) : {};

    var responseFilterMatch = context.getVariable("SanitizeModelResponse.SMR-SanitizeModelResponse.filterMatchState");
    var responseSdpMatch = context.getVariable("SanitizeModelResponse.SMR-SanitizeModelResponse.sdpFilterResult.deidentifyResult.matchState");
    var isResponseBlock = (responseFilterMatch === "MATCH_FOUND" || responseSdpMatch === "MATCH_FOUND");

    if (isResponseBlock) {
        error.deidentifiedFinding = "" + (context.getVariable("SanitizeModelResponse.SMR-SanitizeModelResponse.sdpDeidentifyFindings") || "");
        error.modelArmorPhase = "response";
        error.modelArmorTemplate = context.getVariable("model_armor_response_template") || "";
        error.modelArmorSource = context.getVariable("model_armor_response_source") || "";
    } else {
        var promptFindings = context.getVariable("SanitizeUserPrompt.SUP-SanitizeUserPrompt.sdpDeidentifyFindings") ||
                             context.getVariable("SanitizeUserPrompt.SUP-SanitizeUserPromptGemini.sdpDeidentifyFindings") || "";
        error.deidentifiedFinding = "" + promptFindings;
        error.modelArmorPhase = "request";
        error.modelArmorTemplate = context.getVariable("model_armor_request_template") || "";
        error.modelArmorSource = context.getVariable("model_armor_request_source") || "";
    }
    error.identityPersona = context.getVariable("identity_persona") || "default";

    context.setVariable("error.content", JSON.stringify(error));
    context.setVariable("error.header.X-Gateway-Model-Armor-Phase", error.modelArmorPhase);
    context.setVariable("error.header.X-Gateway-Model-Armor-Template", error.modelArmorTemplate);
    context.setVariable("error.header.X-Gateway-Model-Armor-Source", error.modelArmorSource);
    context.setVariable("error.header.X-Gateway-Identity-Persona", error.identityPersona);
} catch (e) {
    print("Error in inject_deidentified_finding.js: " + e);
}

})();
