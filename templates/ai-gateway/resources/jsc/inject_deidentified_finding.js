var error = context.getVariable("error.content");
error = JSON.parse(error);

var responseMatchState = context.getVariable("SanitizeModelResponse.SMR-SanitizeModelResponse.sdpFilterResult.deidentifyResult.matchState");
var requestMatchState = context.getVariable("SanitizeUserPrompt.SUP-SanitizeUserPrompt.sdpFilterResult.deidentifyResult.matchState") ||
                        context.getVariable("SanitizeUserPrompt.SUP-SanitizeUserPromptGemini.sdpFilterResult.deidentifyResult.matchState");

if (responseMatchState === "MATCH_FOUND") {
  error.deidentifiedFinding = "" + context.getVariable("SanitizeModelResponse.SMR-SanitizeModelResponse.sdpDeidentifyFindings");
} else {
  var promptFindings = context.getVariable("SanitizeUserPrompt.SUP-SanitizeUserPrompt.sdpDeidentifyFindings") ||
                       context.getVariable("SanitizeUserPrompt.SUP-SanitizeUserPromptGemini.sdpDeidentifyFindings");
  error.deidentifiedFinding = "" + promptFindings;
}

error = JSON.stringify(error);
context.setVariable("error.content", error);