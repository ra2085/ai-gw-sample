# 🧪 Automated Test Suites

The repository contains end-to-end test suites to validate routing, security, streaming, and judge classifications:

---

## Running Tests

| Test Suite | Target Scope | Command |
| :--- | :--- | :--- |
| **`test-smart-routing.sh`** | Claude, Gemini 3.x, fallback chains, auto-router tiers, aliases | `./test-smart-routing.sh` |
| **`test-judge.sh`** | 15 test cases validating LLM as a Judge classification | `./test-judge.sh` |
| **`test-smart-stream.sh`** | Streaming SSE chunk translation & token accumulation | `./test-smart-stream.sh` |
| **`test-claude-models.sh`** | Dynamic `/v1/models` catalog discovery & product tier filtering | `./test-claude-models.sh` |
| **`test-claude.sh`** | Claude non-streaming route with Model Armor security filters | `./test-claude.sh` |
| **`test-gemini-native.sh`** | Native Gemini predict endpoint (`/ai-gateway`) | `./test-gemini-native.sh` |
| **`test-openai-compat.sh`** | OpenAI chat completions endpoint (`/v1/chat/completions`) | `./test-openai-compat.sh` |
