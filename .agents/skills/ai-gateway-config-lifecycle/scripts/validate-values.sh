#!/usr/bin/env bash
# Copyright 2027 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# ==============================================================================
# Apigee AI Gateway — Safe Offline values.yaml Validator & Staged Renderer
# ==============================================================================
# Validates a values.yaml file for schema pitfalls, dangling model references,
# plaintext secret leaks, and clean apigee-go-gen rendering inside an isolated
# temporary staging directory (so os_writefile NEVER dirties tracked files under
# templates/ai-gateway/resources/properties/).
# ==============================================================================

set -euo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"

VALUES_FILE=""
OUTPUT_DIR=""
SKIP_RENDER=false
ALLOW_PLACEHOLDERS=false

usage() {
  cat <<EOF
Usage: bash .agents/skills/ai-gateway-config-lifecycle/scripts/validate-values.sh [OPTIONS]

Options:
  -f, --values <path>       Path to values.yaml file to validate (required)
  -o, --output <dir>        Optional path to copy rendered bundle (e.g., ./out/ai-gateway)
      --allow-placeholders  Permit template placeholder project_id ("your-gcp-project-id") without warning
      --skip-render         Run static YAML/schema/secret checks only (skip apigee-go-gen render)
  -h, --help                Show this help message
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -f|--values)
      VALUES_FILE="$2"
      shift 2
      ;;
    -o|--output)
      OUTPUT_DIR="$2"
      shift 2
      ;;
    --allow-placeholders)
      ALLOW_PLACEHOLDERS=true
      shift
      ;;
    --skip-render)
      SKIP_RENDER=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "ERROR: Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -z "$VALUES_FILE" ]]; then
  echo "ERROR: --values <path> is required." >&2
  usage >&2
  exit 2
fi

if [[ ! -f "$VALUES_FILE" ]]; then
  echo "ERROR: Values file not found: $VALUES_FILE" >&2
  exit 2
fi

echo "==> [1/2] Running static schema, reference & secret hygiene checks on: $VALUES_FILE"

python3 - "$VALUES_FILE" "$ALLOW_PLACEHOLDERS" << 'PYEOF'
import fnmatch
import math
import re
import sys

try:
    import yaml
except ImportError:
    sys.stderr.write("ERROR: PyYAML ('yaml') is required for static validation.\n")
    sys.exit(2)

values_path = sys.argv[1]
allow_placeholders = sys.argv[2].lower() == "true"

with open(values_path, "r", encoding="utf-8") as fh:
    raw_text = fh.read()

try:
    data = yaml.safe_load(raw_text)
except Exception as exc:
    sys.stderr.write(f"FAIL: Invalid YAML syntax in {values_path}: {exc}\n")
    sys.exit(1)

if not isinstance(data, dict):
    sys.stderr.write(f"FAIL: Root of {values_path} must be a YAML mapping/object.\n")
    sys.exit(1)

errors = []
warnings = []

# 1. Secret leak patterns anywhere in raw YAML (excluding comments)
SECRET_PATTERNS = [
    (re.compile(r"\bsk-ant-[A-Za-z0-9_-]{12,}\b"), "Anthropic API key ('sk-ant-...')"),
    (re.compile(r"\bsk-(?:proj-|live-)?[A-Za-z0-9_-]{20,}\b"), "OpenAI-style secret key ('sk-...')"),
    (re.compile(r"\bAIza[0-9A-Za-z_-]{30,}\b"), "Google API key ('AIza...')"),
    (re.compile(r"\bya29\.[0-9A-Za-z._-]{20,}\b"), "Google OAuth access token ('ya29....')"),
    (re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"), "PEM private key"),
]
for lineno, line in enumerate(raw_text.splitlines(), 1):
    stripped = line.split("#", 1)[0]
    for pat, label in SECRET_PATTERNS:
        m_sec = pat.search(stripped)
        if m_sec:
            matched_tok = m_sec.group(0).lower()
            if allow_placeholders and ("mock" in matched_tok or "dummy" in matched_tok or "example" in matched_tok or "placeholder" in matched_tok):
                warnings.append(f"Line {lineno}: Mock/placeholder {label} permitted via --allow-placeholders.")
                continue
            errors.append(
                f"Line {lineno}: Detected hardcoded {label}. Use auth.token_ref='propertyset.provider_keys.<key>' instead."
            )

GCP_PROJECT_RE = re.compile(r"^(?:\{[A-Za-z0-9_.-]+\}|(?:[a-z0-9.-]+:)?[a-z][a-z0-9-]{4,28}[a-z0-9])$")
GCP_AGENT_PLATFORM_REGION_RE = re.compile(r"^(?:global|us|eu|[a-z]+-[a-z]+\d+)$")

def check_gcp_project_id(field_label, raw_val, warn_empty=False):
    if raw_val is None:
        if warn_empty:
            warnings.append(f"{field_label} is empty (will fall back to {{organization.name}}).")
        return
    proj = str(raw_val).strip()
    if not proj:
        if warn_empty:
            warnings.append(f"{field_label} is empty (will fall back to {{organization.name}}).")
        return
    if proj == "your-gcp-project-id":
        if not allow_placeholders:
            warnings.append(
                f"{field_label} is still set to placeholder 'your-gcp-project-id' (set real project ID in a gitignored local override file before live deploy)."
            )
        return
    if not GCP_PROJECT_RE.match(proj):
        errors.append(
            f"{field_label}={proj!r} is not a valid GCP project ID (expected lowercase letters, digits, hyphens, e.g., 'my-gcp-project-01')."
        )

# 2. Gateway metadata
gw = data.get("gateway") or {}
if isinstance(gw, dict):
    check_gcp_project_id("gateway.project_id", gw.get("project_id"), warn_empty=True)

# 3. Models catalog & pricing checks
models = data.get("models")
model_names = set()
VALID_TARGETS = {"gemini", "claude", "gemini-openai-compat", "openai-custom", "gemini-native-target"}
AGENT_PLATFORM_TARGETS = {"gemini", "claude", "gemini-openai-compat", "gemini-native-target"}
VALID_FORMATS = {"gemini", "anthropic", "openai"}
SYMMETRIC_OR_NONE_ALGS = {"none", "hs256", "hs384", "hs512"}

if models is not None:
    if not isinstance(models, list) or len(models) == 0:
        errors.append("'models' must be a non-empty list when specified.")
    else:
        for idx, m in enumerate(models):
            if not isinstance(m, dict):
                errors.append(f"models[{idx}] must be a mapping.")
                continue
            mname = str(m.get("name") or "").strip()
            if not mname:
                errors.append(f"models[{idx}] is missing required non-empty 'name'.")
                continue
            if mname in model_names:
                errors.append(f"Duplicate model name in models[]: '{mname}'.")
            model_names.add(mname)

            tgt = str(m.get("target") or "").strip()
            if tgt and tgt not in VALID_TARGETS:
                errors.append(f"models['{mname}'].target='{tgt}' is invalid (allowed: {sorted(VALID_TARGETS)}).")

            fmt = str(m.get("format") or "").strip()
            if fmt and fmt not in VALID_FORMATS:
                errors.append(f"models['{mname}'].format='{fmt}' is invalid (allowed: {sorted(VALID_FORMATS)}).")

            check_gcp_project_id(f"models['{mname}'].project_id", m.get("project_id"))

            custom_url = str(m.get("custom_url") or "").strip()
            region = str(m.get("region") or "").strip()
            if region and not custom_url and (not tgt or tgt in AGENT_PLATFORM_TARGETS):
                if not GCP_AGENT_PLATFORM_REGION_RE.match(region):
                    errors.append(
                        f"models['{mname}'].region={region!r} is invalid for Agent Platform target '{tgt or 'gemini'}' (expected 'global', 'us', 'eu', or a GCP region like 'us-central1')."
                    )

            if custom_url:
                if not custom_url.startswith("https://") and not custom_url.startswith("http://localhost"):
                    warnings.append(f"models['{mname}'].custom_url should use https:// ('{custom_url}').")
                if tgt in {"gemini", "gemini-openai-compat", "gemini-native-target"} and "googleapis.com" not in custom_url:
                    errors.append(
                        f"models['{mname}'] sets non-Google custom_url '{custom_url}' with IAM target '{tgt}'. Use target: 'openai-custom' or 'claude'."
                    )

            auth_cfg = m.get("auth")
            if isinstance(auth_cfg, dict):
                raw_tok = str(auth_cfg.get("token") or "").strip()
                if raw_tok and not raw_tok.startswith("{"):
                    warnings.append(
                        f"models['{mname}'].auth.token contains a literal value; prefer auth.token_ref: 'propertyset.provider_keys.<name>'."
                    )

            pricing = m.get("pricing")
            if pricing is not None:
                if not isinstance(pricing, dict):
                    errors.append(f"models['{mname}'].pricing must be a mapping.")
                else:
                    for rate_key in ("input_rate", "output_rate", "cache_read_rate", "cache_write_rate"):
                        if rate_key in pricing and pricing[rate_key] is not None:
                            rv = pricing[rate_key]
                            if isinstance(rv, bool) or not isinstance(rv, (int, float)) or math.isnan(rv) or math.isinf(rv) or rv < 0:
                                errors.append(
                                    f"models['{mname}'].pricing.{rate_key}={rv!r} must be a non-negative finite number (USD per 1M tokens, no '$' prefix)."
                                )

# 4. Referential integrity for defaults, judge, routing tiers/tasks/aliases
def check_model_ref(field_label, ref_val):
    if ref_val is None or not model_names:
        return
    s = str(ref_val).strip()
    if s and s not in model_names:
        errors.append(f"{field_label} references '{s}', which is not defined in models[].name.")

defaults = data.get("defaults") or {}
if isinstance(defaults, dict):
    check_model_ref("defaults.model", defaults.get("model"))
    check_model_ref("defaults.fallback", defaults.get("fallback"))
    def_reg = str(defaults.get("region") or "").strip()
    if def_reg and not GCP_AGENT_PLATFORM_REGION_RE.match(def_reg):
        errors.append(
            f"defaults.region={def_reg!r} is invalid (expected 'global', 'us', 'eu', or a GCP region like 'us-central1')."
        )

features = data.get("features") or {}
if isinstance(features, dict):
    judge = features.get("llm_judge") or {}
    if isinstance(judge, dict) and judge.get("enabled") is not False:
        j_model = str(judge.get("classifier_model") or "").strip()
        if j_model and model_names and j_model not in model_names:
            warnings.append(
                f"features.llm_judge.classifier_model='{j_model}' is not in models[] (SC-LLMJudge will still call Vertex AI directly, using default judge rates unless added to models[])."
            )

    armor = features.get("model_armor") or {}
    if isinstance(armor, dict):
        check_gcp_project_id("features.model_armor.project_id", armor.get("project_id"))
        loc = str(armor.get("location") or "").strip().lower()
        if loc == "global":
            errors.append(
                "features.model_armor.location cannot be 'global' — Model Armor requires a regional endpoint (e.g., 'us-central1')."
            )
        id_rules = armor.get("identity_rules")
        if isinstance(id_rules, list):
            for idx, rcfg in enumerate(id_rules):
                if isinstance(rcfg, dict):
                    check_gcp_project_id(f"features.model_armor.identity_rules[{idx}].project_id", rcfg.get("project_id"))

auth = data.get("auth") if isinstance(data.get("auth"), dict) else (features.get("auth") if isinstance(features, dict) else {})
if isinstance(auth, dict):
    idp_jwt = auth.get("idp_jwt") or {}
    if isinstance(idp_jwt, dict) and str(idp_jwt.get("enabled", "false")).lower() == "true":
        for req_field in ("jwks_uri", "issuer", "audience"):
            val = str(idp_jwt.get(req_field) or "").strip()
            if not val:
                errors.append(f"auth.idp_jwt.{req_field} is required when idp_jwt.enabled=true.")
        algs = [a.strip().lower() for a in str(idp_jwt.get("algorithm") or "RS256").split(",") if a.strip()]
        if not algs or any(a in SYMMETRIC_OR_NONE_ALGS for a in algs):
            errors.append(
                f"auth.idp_jwt.algorithm={idp_jwt.get('algorithm')!r} must use asymmetric JWS algorithms (RS*/PS*/ES*), never 'none' or 'HS*'."
            )

    agent_id = auth.get("agent_identity") or {}
    if isinstance(agent_id, dict) and str(agent_id.get("enabled", "false")).lower() == "true":
        td = str(agent_id.get("allowed_trust_domain") or "").strip()
        if td == "*":
            errors.append("auth.agent_identity.allowed_trust_domain cannot be wildcard '*'.")

    personas = auth.get("personas") or {}
    if isinstance(personas, dict):
        for pname, pcfg in personas.items():
            if not isinstance(pcfg, dict):
                continue
            check_gcp_project_id(f"auth.personas.{pname}.project_id", pcfg.get("project_id"))
            pmodels = pcfg.get("models")
            if model_names and isinstance(pmodels, list) and pmodels:
                for pat in pmodels:
                    pat_s = str(pat).strip()
                    if pat_s and not any(fnmatch.fnmatchcase(m, pat_s) for m in model_names):
                        warnings.append(
                            f"auth.personas.{pname}.models pattern '{pat_s}' does not match any model in models[]."
                        )
            pquota = pcfg.get("quota")
            if isinstance(pquota, dict):
                for pm_field in ("per_model", "per_model_usd"):
                    pm_map = pquota.get(pm_field)
                    if pm_map is not None:
                        if not isinstance(pm_map, dict):
                            errors.append(f"auth.personas.{pname}.quota.{pm_field} must be a mapping.")
                        else:
                            for pm_key, pm_val in pm_map.items():
                                pm_key_s = str(pm_key).strip()
                                if model_names and pm_key_s and not any(fnmatch.fnmatchcase(m, pm_key_s) for m in model_names):
                                    warnings.append(
                                        f"auth.personas.{pname}.quota.{pm_field} key '{pm_key_s}' does not match any model in models[]."
                                    )
                                if pm_val is None or isinstance(pm_val, bool) or not isinstance(pm_val, (int, float)) or math.isnan(pm_val) or math.isinf(pm_val) or pm_val < 0:
                                    errors.append(
                                        f"auth.personas.{pname}.quota.{pm_field}['{pm_key_s}']={pm_val!r} must be a non-negative finite number (no '$' prefix)."
                                    )

for exc_label, exc_list in (("exceptions", data.get("exceptions")), ("auth.exceptions", auth.get("exceptions") if isinstance(auth, dict) else None)):
    if isinstance(exc_list, list):
        for idx, exc_cfg in enumerate(exc_list):
            if not isinstance(exc_cfg, dict):
                continue
            check_gcp_project_id(f"{exc_label}[{idx}].project_id", exc_cfg.get("project_id"))
            em_list = exc_cfg.get("models") or exc_cfg.get("allowed_models")
            if model_names and isinstance(em_list, list):
                for pat in em_list:
                    pat_s = str(pat).strip()
                    if pat_s and not any(fnmatch.fnmatchcase(m, pat_s) for m in model_names):
                        warnings.append(
                            f"{exc_label}[{idx}].models pattern '{pat_s}' does not match any model in models[]."
                        )

routing = data.get("routing") or {}
if isinstance(routing, dict):
    for sec in ("tiers", "tasks", "aliases"):
        mapping = routing.get(sec) or {}
        if isinstance(mapping, dict):
            for k, target_model in mapping.items():
                check_model_ref(f"routing.{sec}.{k}", target_model)

for w in warnings:
    print(f"  WARN: {w}")

if errors:
    for e in errors:
        sys.stderr.write(f"  FAIL: {e}\n")
    sys.stderr.write(f"\nValidation FAILED with {len(errors)} error(s).\n")
    sys.exit(1)

print(f"  OK: Static YAML checks passed ({len(model_names)} catalog models, {len(warnings)} warning(s)).")
PYEOF

if [[ "$SKIP_RENDER" == "true" ]]; then
  echo "==> [2/2] Skipping apigee-go-gen render (--skip-render)."
  exit 0
fi

APIGEE_GEN=""
if command -v apigee-go-gen >/dev/null 2>&1; then
  APIGEE_GEN="apigee-go-gen"
elif [[ -x "$REPO_ROOT/bin/apigee-go-gen" ]]; then
  APIGEE_GEN="$REPO_ROOT/bin/apigee-go-gen"
fi

if [[ -z "$APIGEE_GEN" ]]; then
  echo "  WARN: 'apigee-go-gen' not found in PATH; skipping bundle dry-render."
  exit 0
fi

STAGE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/ai-gw-stage.XXXXXX")"
chmod 700 "$STAGE_ROOT"
cleanup() {
  rm -rf "$STAGE_ROOT"
}
trap cleanup EXIT

cp -R "$REPO_ROOT/templates/ai-gateway" "$STAGE_ROOT/ai-gateway"
RENDER_DEST="$STAGE_ROOT/rendered_bundle"

echo "==> [2/2] Dry-rendering proxy bundle in isolated staging directory via $APIGEE_GEN..."
"$APIGEE_GEN" render apiproxy \
  --template "$STAGE_ROOT/ai-gateway/apiproxy.yaml" \
  --values "$VALUES_FILE" \
  --output "$RENDER_DEST" \
  --validate=true

if [[ ! -d "$RENDER_DEST/apiproxy" ]]; then
  echo "FAIL: apigee-go-gen did not produce $RENDER_DEST/apiproxy" >&2
  exit 1
fi

if [[ -n "$OUTPUT_DIR" ]]; then
  mkdir -p "$OUTPUT_DIR"
  rm -rf "$OUTPUT_DIR/apiproxy" "$OUTPUT_DIR/apiproxy.zip"
  cp -R "$RENDER_DEST/apiproxy" "$OUTPUT_DIR/apiproxy"
  if [[ -f "$RENDER_DEST/apiproxy.zip" ]]; then
    cp "$RENDER_DEST/apiproxy.zip" "$OUTPUT_DIR/apiproxy.zip"
  fi
  echo "  OK: Clean bundle written to $OUTPUT_DIR (templates/ai-gateway/ left untouched)."
else
  echo "  OK: Dry-render & XML validation succeeded (templates/ai-gateway/ left untouched)."
fi
