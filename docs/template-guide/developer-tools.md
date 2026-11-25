# Developer Tools & IDEs

Connect enterprise coding assistants, desktop apps, and agent builders to the AI Gateway so engineering teams can use **Google Gemini** and **Anthropic Claude** on **Gemini Enterprise Agent Platform** (formerly Vertex AI), **Claude Platform (`api.anthropic.com`)**, **OpenAI**, **Microsoft Foundry** (formerly Azure OpenAI), and **Agent Platform MaaS** models from their preferred tools—without distributing cloud provider credentials to developer workstations.

Every tool below inherits your gateway's **[AI Product](../architecture/security.md)** model allowlists, token and USD budgets, **[Model Armor](../architecture/routing.md)** content safety scans, and **[Looker Studio](../operations/looker-studio-dashboard.md)** cost attribution out of the box.

---

## 1. Tool Compatibility & Governance Summary

Choose the deployment pattern that matches how each tool manages configuration and credentials across teams:

| Tool | Gateway Endpoint | Enterprise Config Plane | Recommended Auth | Governance Granularity |
| :--- | :--- | :--- | :--- | :--- |
| **Claude Code CLI** | `POST /v1/messages`<br>`GET /v1/models` | MDM `managed-settings.json` (`apiKeyHelper`) | **Corporate SSO JWT** (`idp_jwt`) or AI Product Key | **Per-engineer** quotas, **per-team** budgets & Persona RBAC |
| **Google Antigravity** *(App, `agy` CLI & VS Code)* | `POST /v1/chat/completions` | MDM `admin_settings.json` (`"wireProtocol": "openai"`) | **AI Product Key** (MDM Smart Group or per-workstation env var) | **Per-team** budgets (or **per-engineer** with workstation key) |
| **Claude Desktop** | `POST /v1/messages` | MDM `com.anthropic.claudefordesktop` profile | **AI Product Key** (`bearer` or `x-api-key`) | **Per-team** budgets via MDM Smart Groups (or per-workstation key) |
| **GitHub Copilot** *(Enterprise & VS Code)* | `GET /v1/models`<br>`POST /v1/chat/completions` | GitHub Org / Enterprise *AI Controls -> Custom Models* | **AI Product Key** (1 key per GitHub Org or Team) | **Per-team / Org** budgets in Apigee; per-seat analytics in GitHub |
| **Cursor** | `POST /v1/chat/completions` | Client `Override OpenAI Base URL` | **AI Product Key** (`Bearer`) | **Per-team** or **per-engineer** key *(requires public HTTPS)* |
| **Microsoft Copilot Studio** | `POST /v1/chat/completions` | Copilot Studio OpenAPI Tool / Custom Engine Agent | **Corporate SSO JWT** (Entra ID OAuth 2.0 OBO) | **Per-employee** quotas, **per-team** budgets & Persona RBAC |

---

## 2. Step-by-Step Setup by Tool

Select a developer tool below for copy-pasteable local and enterprise MDM configuration steps:

=== "1. Claude Code CLI"

    **Why it works well at scale:** Claude Code supports an MDM-managed `apiKeyHelper` command that automatically refreshes short-lived corporate SSO tokens (`idp_jwt`). One identical configuration file works across every engineering team—Apigee resolves each engineer's persona, department budget, and personal quota directly from their JWT claims.

    **Option A: Enterprise Zero-Key Rollout (MDM + Corporate SSO)**

    Deploy `managed-settings.json` via Jamf, Intune, or configuration management:

    * **macOS:** `/Library/Application Support/ClaudeCode/managed-settings.json`
    * **Linux / WSL:** `/etc/claude-code/managed-settings.json`
    * **Windows:** `C:\Program Files\ClaudeCode\managed-settings.json`

    ```json
    {
      "apiKeyHelper": "oidc-token --aud api://ai-gateway",
      "env": {
        "ANTHROPIC_BASE_URL": "https://ai-gateway.example.com",
        "CLAUDE_CODE_API_KEY_HELPER_TTL_MS": "3000000"
      }
    }
    ```

    > **Important:** Do not set `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` in the user shell when using `apiKeyHelper`, as explicit environment variables take precedence over the helper script.

    **Option B: Quick Local Setup (AI Product API Key)**

    ```bash
    export ANTHROPIC_BASE_URL="https://ai-gateway.example.com"
    export ANTHROPIC_AUTH_TOKEN="YOUR_APIGEE_API_KEY"
    claude --model claude-sonnet-5-5
    ```

    Developers can switch between Claude tiers (`claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`) or—because `/v1/messages` translates across providers—pass Agent Platform Gemini or OpenAI catalog models directly (for example, `claude --model gemini-4-argon`, `claude --model gemini-4-hydrogen`, or `claude --model gpt-6.2-sol`).

=== "2. Google Antigravity (App & CLI)"

    **Why it works well at scale:** A single system-level `admin_settings.json` file configures the **Antigravity Desktop App**, the **`agy` CLI**, and the **VS Code extension** simultaneously, while suppressing personal Google account sign-ins.

    Setting `"wireProtocol": "openai"` routes Antigravity through `POST /v1/chat/completions`, allowing developers to switch seamlessly between **Gemini**, **Claude**, and **OpenAI** models from a single model picker.

    **Step 1: Deploy `admin_settings.json` via MDM**

    Place the file at the protected system path (`0644`, owned by root/Administrator):

    * **macOS:** `/Library/Application Support/Antigravity/admin_settings.json`
    * **Linux:** `/etc/antigravity/admin_settings.json`
    * **Windows:** `C:\ProgramData\Antigravity\admin_settings.json`

    ```json
    {
      "gateway": {
        "enabled": true,
        "url": "https://ai-gateway.example.com/v1",
        "wireProtocol": "openai",
        "apiKey": "YOUR_TEAM_PERSONA_API_KEY"
      },
      "models": {
        "defaultModelId": "gemini-4-hydrogen",
        "list": [
          { "modelId": "gemini-4-hydrogen" },
          { "modelId": "gemini-4-argon" },
          { "modelId": "gemini-3.5-flash-lite" },
          { "modelId": "claude-sonnet-5-5" },
          { "modelId": "claude-opus-5-5" },
          { "modelId": "gpt-6.2-sol" }
        ]
      },
      "auth": {
        "suppressInteractiveLogin": true
      }
    }
    ```

    **Step 2: Choose Team vs. Per-Engineer Governance**

    * **Team-Level Budgets (Simplest):** Scope a separate `admin_settings.json` profile to each Jamf or Intune Smart Group (for example, `Core-Engineering` vs. `Data-Science`), using each team's AI Product key from `scripts/sync-personas.sh`.
    * **Per-Engineer Quotas + Team Budgets:** Leave `"apiKey"` empty in `admin_settings.json` and provision a per-developer Apigee App key (`developer.email` + `team` custom attribute) into the workstation's `AGY_LLM_GATEWAY_API_KEY` environment variable during MDM enrollment.

    > **Compatibility Note:** `"wireProtocol": "openai"` is supported by the Antigravity Desktop App, `agy` CLI, and VS Code extension. JetBrains and Zed ACP extensions currently require Antigravity's native Gemini wire mode.

=== "3. Claude Desktop"

    **How it works:** Claude Desktop uses OS-managed preferences (`com.anthropic.claudefordesktop`) rather than shell environment variables. Administrators push a Third-Party Inference Gateway profile per MDM Smart Group so developers never manage credentials manually.

    **Option A: Enterprise MDM Deployment (Jamf / Intune)**

    Push the following managed preferences to `/Library/Managed Preferences/<user>/com.anthropic.claudefordesktop.plist` (macOS) or `HKLM\SOFTWARE\Policies\Claude` (Windows), scoping each department's Smart Group to its corresponding AI Product key:

    ```json
    {
      "inferenceProvider": "gateway",
      "inferenceGatewayBaseUrl": "https://ai-gateway.example.com",
      "inferenceGatewayApiKey": "YOUR_TEAM_PERSONA_API_KEY",
      "inferenceGatewayAuthScheme": "bearer",
      "inferenceModels": "[\"claude-sonnet-5-5\",\"claude-opus-5-5\",\"claude-haiku-5-5\",\"gemini-4-hydrogen\"]"
    }
    ```

    *(Both `"bearer"` and `"x-api-key"` are supported for `inferenceGatewayAuthScheme`.)*

    **Option B: Manual Workstation Setup**

    1. Open Claude Desktop and select **Help -> Troubleshooting -> Enable Developer Mode**.
    2. Open **Developer -> Configure Third-Party Inference**.
    3. Set **Inference Provider** to **Gateway**, enter `https://ai-gateway.example.com` as the Base URL, and paste your Apigee AI Product API key.

=== "4. GitHub Copilot"

    **Why it works well at scale:** In **GitHub Copilot Enterprise**, developers sign in with normal corporate SAML/OIDC SSO—API keys never touch developer laptops. Organization administrators store AI Product keys centrally in GitHub's cloud vault, and Apigee's `GET /v1/models` endpoint automatically populates the IDE model picker with only the models permitted for that persona (such as `gemini-4-argon`, `gemini-4-hydrogen`, `gemini-3.5-flash-lite`, `claude-sonnet-5-5`, `claude-opus-5-5`, and `gpt-6.2-sol`).

    **Option A: GitHub Copilot Enterprise / Organization Vault (Zero Keys on Laptops)**

    1. Define distinct team or tier personas in `values.yaml` (for example, `eng-platform`, `eng-payments`, `ml-research`) and run `./scripts/sync-personas.sh`.
    2. In GitHub.com, navigate to **Enterprise (or Organization) -> AI Controls -> Copilot -> Custom Models**.
    3. Add an **OpenAI-compatible** custom endpoint pointing to `https://ai-gateway.example.com/v1` with the corresponding AI Product API key.
    4. For multiple teams inside a single GitHub Organization, register separate custom provider entries per tier/team and scope access to specific **GitHub Teams** via Copilot Model Policies.

    > **Governance Split & Network Requirement:** Because GitHub Cloud initiates outbound requests to the gateway, your Apigee endpoint must be reachable over public HTTPS. Apigee enforces hard team/org model allowlists, token/USD caps, and Model Armor policies per AI Product key, while GitHub's *Copilot Usage Metrics API* tracks individual per-seat activity.

    **Option B: VS Code Local Custom Endpoint (Per-Developer Key)**

    Developers using local Bring-Your-Own-Key (BYOK) in VS Code can point Copilot Chat directly to `https://ai-gateway.example.com/v1/chat/completions` (for example, selecting `gemini-4-argon`, `claude-sonnet-5-5`, or `gpt-6.2-sol`) and store their personal Apigee Developer App key in VS Code's OS Keychain secret prompt (`${apiKey}`).

=== "5. Cursor"

    **How it works:** Cursor routes custom model chat and local agent requests through its OpenAI Base URL override (`POST /v1/chat/completions`).

    **Step 1: Add Non-`claude-` Aliases in `values.yaml` (If Exposing Claude Models)**

    Cursor inspects model ID prefixes—any model starting with `claude-` is routed to Cursor's native Anthropic key slot instead of the OpenAI Base URL override. Add a neutral prefix alias under [`routing.aliases`](../architecture/routing.md) so Cursor sends Claude traffic through the gateway:

    ```yaml
    routing:
      aliases:
        "gw-claude-sonnet-5-5": "claude-sonnet-5-5"
        "gw-claude-opus-5-5": "claude-opus-5-5"
        "gw-claude-haiku-5-5": "claude-haiku-5-5"
    ```

    **Step 2: Configure Cursor Settings**

    1. Open **Cursor Settings -> Models**.
    2. Add your gateway model IDs (`gemini-4-argon`, `gemini-4-hydrogen`, `gemini-3.5-flash-lite`, `gw-claude-sonnet-5-5`, `gw-claude-opus-5-5`, `gpt-6.2-sol`).
    3. Paste your Apigee AI Product key into **OpenAI API Key**, enable **Override OpenAI Base URL**, and set it to `https://ai-gateway.example.com/v1`:

    ```text
    https://ai-gateway.example.com/v1
    ```

    > **Network & Feature Notes:** Cursor relays custom model requests through Cursor's cloud servers (`api2.cursor.sh`) rather than directly from the laptop—your Apigee endpoint must be reachable over public HTTPS (VPN-only private IPs and client mTLS cannot be used). Inline *Cursor Tab* autocomplete continues to use Cursor's hosted backend.

=== "6. Microsoft Copilot Studio"

    **Why it works well at scale:** While core Microsoft 365 Copilot chat (Word, Excel, Teams) uses fixed Microsoft-managed models, **Microsoft Copilot Studio** custom agents and OpenAPI tools can route inference through Apigee (`POST /v1/chat/completions`) using native **Microsoft Entra ID OAuth 2.0**—propagating and auto-refreshing each signed-in employee's JWT automatically.

    **Step 1: Enable Entra ID JWT Verification in `values.yaml`**

    ```yaml
    features:
      auth:
        enabled: true
        idp_jwt:
          enabled: true
          jwks_uri: "https://login.microsoftonline.com/<TENANT_ID>/discovery/v2.0/keys"
          issuer: "https://login.microsoftonline.com/<TENANT_ID>/v2.0"
          audience: "api://ai-gateway"
          algorithm: "RS256"
          user_claim: "preferred_username"
          persona_claim: "roles"
          team_claim: "department"
    ```

    > **Entra ID Group Overage Tip:** Configure your Entra App Registration to emit **App Roles (`roles`)** or **Groups assigned to the application** rather than all security groups, avoiding Entra's 200-group token overage omission.

    **Step 2: Connect Copilot Studio**

    Import [`openapi.yaml`](https://github.com/ra2085/ai-gw-sample/blob/main/openapi.yaml) as a REST API Tool (or point your Custom Engine Agent to `https://ai-gateway.example.com/v1/chat/completions`) and configure OAuth 2.0 authentication with your Entra Gateway App scope (`api://ai-gateway/AI.Invoke`).

---

## 3. Multi-Team Rollout Patterns

Most enterprises combine two or three of the gateway's built-in [authentication modes](../architecture/security.md) depending on how each tool connects:

1. **Dynamic Corporate SSO (`idp_jwt`) for Auto-Refreshing Clients:** Use for **Claude Code CLI** (`apiKeyHelper`) and **Microsoft Copilot Studio** (Entra ID OBO). Requires zero API keys and enforces both per-user quotas and shared department budgets automatically from IdP claims.
2. **Centralized Org / Smart-Group AI Product Keys (`VA-ApiKey`) for Zero-Touch GUIs:** Use for **GitHub Copilot Enterprise**, **Claude Desktop**, and **Google Antigravity**. Provision one AI Product per team or engineering tier via `./scripts/sync-personas.sh` and assign keys centrally in GitHub Admin or Jamf/Intune Smart Groups.
3. **Per-Developer App Keys (`VA-ApiKey`) When Individual IDE Quotas Are Required:** Publish your AI Products to **Apigee's Managed Developer Portal** (or mint per-developer App keys during MDM laptop enrollment). Because Apigee resolves `developer.email` and `team` attributes on every key, each developer receives an isolated personal quota and Looker Studio cost row at sub-millisecond cache speed.

> **Note on OpenAI Codex CLI (`codex`):** Modern versions of the OpenAI `codex` CLI removed `wire_api = "chat"` (`/v1/chat/completions`) and exclusively require OpenAI's stateful `POST /v1/responses` protocol, which is not currently exposed by the gateway. For terminal-based agentic coding across Gemini, Claude, and OpenAI models, use **Claude Code CLI** or **Google Antigravity CLI (`agy`)**.
