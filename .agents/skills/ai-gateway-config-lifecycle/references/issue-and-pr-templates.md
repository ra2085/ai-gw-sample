# GitHub Issue & Pull Request Guide (Strict Zero-Leak Hygiene)

Always follow these redaction checks and structured templates before running `git commit`, `git push`, `gh issue create`, or `gh pr create`.

---

## 1. Mandatory Pre-Flight Redaction Checklist

Never publish internal environment metadata or credentials in commits, PR descriptions, issue bodies, logs, or curl snippets:

1. **Scrub Every Live or Local Machine Identifier**:
   - Local Workstation Paths & Usernames (`/Users/<user>/...`, `/home/<user>/...`, `file:///...`) -> replace with repo-relative paths (`templates/ai-gateway/...`, `./values.yaml`)
   - GCP Project IDs / Numbers -> replace with `your-gcp-project-id` / `<YOUR_ORG_NUMBER>`
   - Apigee Hostnames / Orgs -> replace with `ai-gateway.example.com` / `your-apigee-org`
   - Service Account & Employee Emails -> replace with `apigee-ai-gw@your-gcp-project-id.iam.gserviceaccount.com` / `alice@example.com`
   - Developer App Consumer Keys (`client_id`) & Bearer/API Keys -> replace with `<REDACTED_CLIENT_ID>` / `<REDACTED_TOKEN>`
   - Internal Corp / Cloud Run Mock URLs -> replace with `https://vllm.internal.example.com` or `https://idp.example.com`
2. **Verify Staged Git Diff**:
   ```bash
   git status --short
   git diff --cached --stat
   # Reject any staged local paths, file:// URIs, .env, *.local.yaml, or dirtied resources/properties/*.properties:
   ! git diff --cached | grep -E '(/Users/[A-Za-z0-9]|/home/[A-Za-z0-9]|file:///[A-Za-z0-9])'
   ```
3. **Maintainer PR Gate (Only When Code/Templates Were Intentionally Changed)**:
   - If any `.java` file in `callout/` changed, confirm `callout/target/ai-gateway-callouts.jar` and `templates/ai-gateway/resources/java/ai-gateway-callouts.jar` have identical SHA-256 checksums.
   - Confirm `./tests/run.sh offline` passed 100%.
   - Confirm `mkdocs build --strict` passes if `docs/` or `mkdocs.yml` changed.

---

## 2. GitHub Feature Request Template (When `values.yaml` Needs a New Capability)

Use with `gh issue create --title "feat(values): <concise summary>" --body-file <temp_file>`:

```markdown
## Summary & Operator Use Case
<!-- Describe what operational outcome is needed and why existing values.yaml fields cannot express it. -->

## Proposed `values.yaml` Schema
```yaml
# Show minimal, backward-compatible configuration keys and default values
```

## Expected Gateway Runtime Behavior
- **Proxy / Target Endpoints affected:**
- **Default behavior when omitted (`100%` backward-compatible):**
- **Quota / FinOps / Security impact:**

## Workarounds Considered
<!-- Explain why existing aliases, personas, exceptions, or custom_url settings were insufficient. -->
```

---

## 3. GitHub Bug Report Template

Use with `gh issue create --title "fix(<area>): <concise symptom>" --body-file <temp_file>`:

```markdown
## Symptom vs. Expected Behavior
- **Observed:**
- **Expected:**

## Minimal Sanitized Reproduction (`values.yaml` + `curl`)
```yaml
# Sanitized values.yaml snippet (no real project IDs, hostnames, or keys)
```

```bash
curl -i https://ai-gateway.example.com/v1/chat/completions \
  -H "x-api-key: <REDACTED_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"model":"gemini-3.5-flash","messages":[{"role":"user","content":"ping"}]}'
```

## Root Cause Notes (If Known)
<!-- Optional pointer to specific policy, template block, or callout action. -->
```

---

## 4. Pull Request Template

Use on a dedicated branch (`feat/...` or `fix/...`) with `gh pr create --title "<type>(<scope>): <summary>" --body-file <temp_file>`:

```markdown
## Summary
- 

## Backward Compatibility & Footprint Check
- [ ] Default `values.yaml` behavior is unchanged (new options are opt-in / backward-compatible).
- [ ] Default bundle policy (`57`), JavaCallout (`22`), Javascript (`1`), endpoint (`5`x`5`), and DataCollector (`18`) counts preserved (or change explicitly approved).
- [ ] Zero secrets, live GCP project IDs, Apigee hostnames, or `client_id`s in commits or docs.
- [ ] `ai-gateway-callouts.jar` rebuilt and synced (if `callout/` changed).

## Verification
- [ ] `./tests/run.sh offline` passed (`template` + JUnit 5 + unit/security/performance suites).
- [ ] `bash .agents/skills/ai-gateway-config-lifecycle/scripts/validate-values.sh --values templates/ai-gateway/values.yaml` passed.
```
