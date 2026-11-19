#!/bin/bash
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
# Apigee AI Gateway - Test Suite Orchestrator & CLI Runner
# ==============================================================================

set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

show_help() {
    echo -e "${BOLD}${CYAN}======================================================================${NC}"
    echo -e "${BOLD}${CYAN}   Apigee AI Gateway Test Suite CLI                                  ${NC}"
    echo -e "${BOLD}${CYAN}======================================================================${NC}"
    echo -e "${BOLD}Usage:${NC} ./tests/run.sh <command> [options]"
    echo ""
    echo -e "${BOLD}Offline Unit, Skill & Template Suites (Zero Cloud Dependencies):${NC}"
    echo -e "  ${GREEN}unit [filter]${NC}        Run all 5 modular Rhino JS & policy unit suites (or filter by name)"
    echo -e "  ${GREEN}performance${NC}          Run apigee-performance-engineering skill validation suite"
    echo -e "  ${GREEN}security${NC}             Run apigee-security-engineering skill validation suite"
    echo -e "  ${GREEN}template${NC}             Run 8-step Helm template render, feature toggle & parity suite"
    echo -e "  ${GREEN}quickstart${NC}           Validate minimal 20-line quickstart template locally"
    echo -e "  ${GREEN}offline${NC}              Run all offline suites (unit + template + quickstart)"
    echo ""
    echo -e "${BOLD}Live Apigee E2E & Integration Suites:${NC}"
    echo -e "  ${GREEN}quickstart --live${NC}    Deploy minimal quickstart bundle to Apigee and run live tests"
    echo -e "  ${GREEN}live${NC}                 Run live quickstart integration tests against Apigee"
    echo -e "  ${GREEN}byo${NC}                  Run BYO models & custom URL integration suite"
    echo -e "  ${GREEN}probe <name>${NC}         Run a diagnostic live probe in tests/probes/ (e.g. claude, judge)"
    echo -e "  ${GREEN}all [--live]${NC}         Run all offline suites (and live integration suite if --live is set)"
    echo ""
    echo -e "${BOLD}Options:${NC}"
    echo -e "  ${YELLOW}--live${NC}               Deploy and/or run against live Apigee environment"
    echo -e "  ${YELLOW}--skip-deploy${NC}        Skip redeployment and run tests against existing revision"
    echo -e "  ${YELLOW}--env <file>${NC}         Load custom environment variables (e.g. tests/env/example.env)"
    echo -e "  ${YELLOW}--help, -h${NC}           Show this help message"
    echo ""
    echo -e "${BOLD}Examples:${NC}"
    echo "  ./tests/run.sh unit"
    echo "  ./tests/run.sh performance"
    echo "  ./tests/run.sh security"
    echo "  ./tests/run.sh template"
    echo "  ./tests/run.sh quickstart"
    echo "  ./tests/run.sh quickstart --live"
    echo "  ./tests/run.sh byo --skip-deploy"
    echo "  ./tests/run.sh probe claude_stream"
    echo -e "${BOLD}${CYAN}======================================================================${NC}"
}

ensure_callout_jar() {
    local force="${1:-}"
    local jar_dest="$REPO_ROOT/templates/ai-gateway/resources/java/ai-gateway-callouts.jar"
    local harness_class="$REPO_ROOT/callout/target/test-classes/com/google/apigee/callouts/CalloutHarnessCli.class"
    local needs_build=false

    if [ "$force" == "--force" ] || [ ! -f "$jar_dest" ] || [ ! -f "$harness_class" ]; then
        needs_build=true
    elif [ -n "$(find "$REPO_ROOT/callout/src" "$REPO_ROOT/callout/pom.xml" -newer "$jar_dest" 2>/dev/null | head -n 1)" ]; then
        needs_build=true
    fi

    if [ "$needs_build" = true ]; then
        echo -e "${BOLD}${BLUE}==> Building Shaded JAR & Running JUnit 5 Java Callout Suite...${NC}"
        local m2_dir="${M2_REPO:-$HOME/.m2/repository}"
        local mvn_args=()
        if [ "${MAVEN_PUBLIC_APIGEE_REPO:-auto}" = "true" ]; then
            mvn_args=(-Ppublic-apigee-repo)
        elif [ "${MAVEN_PUBLIC_APIGEE_REPO:-auto}" = "auto" ] && \
             [ ! -f "$m2_dir/com/apigee/gateway/libraries/message-flow/1.0.0/message-flow-1.0.0.jar" ] && \
             ! grep -qi "<mirror>" "$HOME/.m2/settings.xml" 2>/dev/null; then
            mvn_args=(-Ppublic-apigee-repo)
        fi
        mvn -q -f "$REPO_ROOT/callout/pom.xml" "${mvn_args[@]}" package
        cp "$REPO_ROOT/callout/target/ai-gateway-callouts.jar" "$jar_dest"
        echo -e "${GREEN}✓ JUnit 5 Callout Suite passed & ai-gateway-callouts.jar synced.${NC}\n"
    fi
}

# Parse global --env <file> anywhere in arguments while preserving remaining args
CLEAN_ARGS=()
while [[ $# -gt 0 ]]; do
    case "$1" in
        --env)
            if [ -z "${2:-}" ]; then
                echo -e "${RED}✗ Error: --env requires a file path argument.${NC}"
                exit 1
            fi
            ENV_CANDIDATE="$2"
            if [ ! -f "$ENV_CANDIDATE" ] && [ -f "$REPO_ROOT/$ENV_CANDIDATE" ]; then
                ENV_CANDIDATE="$REPO_ROOT/$ENV_CANDIDATE"
            fi
            if [ ! -f "$ENV_CANDIDATE" ]; then
                echo -e "${RED}✗ Error: Environment file not found: $2${NC}"
                exit 1
            fi
            # shellcheck disable=SC1090
            source "$ENV_CANDIDATE"
            export CUSTOM_ENV_LOADED="true"
            shift 2
            ;;
        --env=*)
            ENV_CANDIDATE="${1#--env=}"
            if [ ! -f "$ENV_CANDIDATE" ] && [ -f "$REPO_ROOT/$ENV_CANDIDATE" ]; then
                ENV_CANDIDATE="$REPO_ROOT/$ENV_CANDIDATE"
            fi
            if [ ! -f "$ENV_CANDIDATE" ]; then
                echo -e "${RED}✗ Error: Environment file not found: ${1#--env=}${NC}"
                exit 1
            fi
            # shellcheck disable=SC1090
            source "$ENV_CANDIDATE"
            export CUSTOM_ENV_LOADED="true"
            shift
            ;;
        *)
            CLEAN_ARGS+=("$1")
            shift
            ;;
    esac
done
set -- "${CLEAN_ARGS[@]}"

COMMAND="${1:-}"
shift || true

case "$COMMAND" in
    unit)
        if [ -z "${1:-}" ]; then
            ensure_callout_jar --force
        else
            ensure_callout_jar
        fi
        node "$SCRIPT_DIR/unit/run_unit_tests.js" "$@"
        ;;

    performance|perf)
        ensure_callout_jar
        node "$SCRIPT_DIR/unit/run_unit_tests.js" "01_performance_skill"
        ;;

    security|sec)
        ensure_callout_jar
        node "$SCRIPT_DIR/unit/run_unit_tests.js" "02_security_skill"
        ;;

    quickstart|qs)
        ensure_callout_jar
        if [[ "$*" == *"--live"* ]]; then
            LIVE_ARGS=()
            for arg in "$@"; do
                [ "$arg" != "--live" ] && LIVE_ARGS+=("$arg")
            done
            "$SCRIPT_DIR/scripts/test_quickstart_live.sh" "${LIVE_ARGS[@]}"
        else
            "$SCRIPT_DIR/scripts/test_quickstart.sh" "$@"
        fi
        ;;

    live)
        ensure_callout_jar
        "$SCRIPT_DIR/scripts/test_quickstart_live.sh" "$@"
        ;;

    template|parity)
        ensure_callout_jar
        "$SCRIPT_DIR/scripts/test_template.sh" "$@"
        ;;

    byo)
        ensure_callout_jar
        "$SCRIPT_DIR/scripts/test_byo_models.sh" "$@"
        ;;

    probe)
        PROBE_NAME="${1:-}"
        shift || true
        if [ -z "$PROBE_NAME" ]; then
            echo -e "${YELLOW}Available live probes in tests/probes/:${NC}"
            ls -1 "$SCRIPT_DIR/probes" | sed 's/^test_//; s/\.sh$//' | sed 's/^/  - /'
            exit 0
        fi
        ensure_callout_jar
        PROBE_NAME="${PROBE_NAME#test_}"
        PROBE_NAME="${PROBE_NAME%.sh}"
        PROBE_NAME="${PROBE_NAME//-/_}"
        PROBE_FILE="$SCRIPT_DIR/probes/test_${PROBE_NAME}.sh"
        if [ ! -f "$PROBE_FILE" ]; then
            echo -e "${RED}Unknown probe: $PROBE_NAME (expected $PROBE_FILE)${NC}"
            exit 1
        fi
        "$PROBE_FILE" "$@"
        ;;

    claude)
        "$SCRIPT_DIR/probes/test_claude.sh" "$@"
        ;;

    claude-models)
        "$SCRIPT_DIR/probes/test_claude_models.sh" "$@"
        ;;

    claude-stream)
        "$SCRIPT_DIR/probes/test_claude_stream.sh" "$@"
        ;;

    gemini-native)
        "$SCRIPT_DIR/probes/test_gemini_native.sh" "$@"
        ;;

    gemini-native-claude)
        "$SCRIPT_DIR/probes/test_gemini_native_claude.sh" "$@"
        ;;

    gemini-native-stream)
        "$SCRIPT_DIR/probes/test_gemini_native_stream.sh" "$@"
        ;;

    openai-compat)
        "$SCRIPT_DIR/probes/test_openai_compat.sh" "$@"
        ;;

    judge)
        "$SCRIPT_DIR/probes/test_judge.sh" "$@"
        ;;

    judge-prompts)
        "$SCRIPT_DIR/probes/test_judge_prompts.sh" "$@"
        ;;

    quota-stream)
        "$SCRIPT_DIR/probes/test_quota_stream.sh" "$@"
        ;;

    smart-routing)
        "$SCRIPT_DIR/probes/test_smart_routing.sh" "$@"
        ;;

    smart-stream)
        "$SCRIPT_DIR/probes/test_smart_stream.sh" "$@"
        ;;

    offline)
        echo -e "${BOLD}${BLUE}==> [1/2] Running Full Template & Unit/Skill Validation Suite...${NC}"
        "$SCRIPT_DIR/scripts/test_template.sh"

        echo -e "\n${BOLD}${BLUE}==> [2/2] Running Minimal Quickstart Local Validation...${NC}"
        "$SCRIPT_DIR/scripts/test_quickstart.sh"

        echo -e "\n${BOLD}${GREEN}======================================================================${NC}"
        echo -e "${BOLD}${GREEN}ALL OFFLINE TEST SUITES PASSED SUCCESSFULLY!${NC}"
        echo -e "${BOLD}${GREEN}======================================================================${NC}"
        ;;

    all)
        echo -e "${BOLD}${BLUE}==> [1/2] Running Full Template & Unit/Skill Validation Suite...${NC}"
        "$SCRIPT_DIR/scripts/test_template.sh"
        
        echo -e "\n${BOLD}${BLUE}==> [2/2] Running Minimal Quickstart Local Validation...${NC}"
        "$SCRIPT_DIR/scripts/test_quickstart.sh"
        
        if [[ "$*" == *"--live"* ]]; then
            echo -e "\n${BOLD}${BLUE}==> [3/3] Running Quickstart Live Integration Tests...${NC}"
            "$SCRIPT_DIR/scripts/test_quickstart_live.sh" --skip-deploy
        fi
        
        echo -e "\n${BOLD}${GREEN}======================================================================${NC}"
        echo -e "${BOLD}${GREEN}ALL TEST SUITES PASSED SUCCESSFULLY!${NC}"
        echo -e "${BOLD}${GREEN}======================================================================${NC}"
        ;;

    help|-h|--help|"")
        show_help
        ;;

    *)
        echo -e "${RED}Unknown command: $COMMAND${NC}"
        show_help
        exit 1
        ;;
esac
