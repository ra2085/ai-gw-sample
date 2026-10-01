(function () {
'use strict';

// ============================================================================
// Restore Request Payload after OAuthV2 ExternalAuthorization Token Import
// Cleans up temporary FormParams (client_id, grant_type) and restores the
// original JSON LLM payload so OASValidation and downstream extractors succeed.
// ============================================================================

try {
    context.removeVariable("request.formparam.client_id");
    context.removeVariable("request.formparam.grant_type");

    var origContent = context.getVariable("orig_request_content");
    if (origContent !== null && origContent !== undefined) {
        context.setVariable("request.content", origContent);
    }

    var origContentType = context.getVariable("orig_request_content_type");
    if (origContentType !== null && origContentType !== undefined && String(origContentType).trim() !== "") {
        context.setVariable("request.header.Content-Type", origContentType);
    }
} catch (e) {
    print("Error in restore_request_payload.js: " + e);
}

})();
