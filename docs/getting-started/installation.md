# Installation & Setup

To configure, generate, and deploy the **Apigee AI Gateway**, install the required CLI tools on your workstation or CI/CD environment.

---

## 1. Prerequisites Overview

| Tool | Purpose | Installation Method |
| :--- | :--- | :--- |
| **`apigee-go-gen`** | Declarative YAML &rarr; Apigee Proxy compiler | Binary download, Homebrew, or `go install` |
| **`apigeecli`** | Apigee deployment & management CLI | `curl \| bash` or Homebrew |
| **`gcloud`** | Google Cloud authentication & IAM | Google Cloud SDK |

---

## 2. Install CLI Tools

### Install `apigee-go-gen` (Template Generator)

=== "Go Install (Recommended)"
    ```bash
    go install github.com/apigee/apigee-go-gen/cmd/apigee-go-gen@latest
    ```

=== "Homebrew (macOS / Linux)"
    ```bash
    brew install apigee/tools/apigee-go-gen
    ```

=== "Build from Source"
    ```bash
    git clone https://github.com/apigee/apigee-go-gen.git
    cd apigee-go-gen
    go build -o /usr/local/bin/apigee-go-gen ./cmd/apigee-go-gen
    ```

Verify installation:
```bash
apigee-go-gen version || apigee-go-gen --help
```

---

### Install `apigeecli` (Deployment CLI)

=== "Direct Install Script (macOS / Linux)"
    ```bash
    curl -s https://raw.githubusercontent.com/apigee/apigeecli/main/downloadLatest.sh | bash
    export PATH=$PATH:$HOME/.apigeecli/bin
    ```

=== "Homebrew (macOS)"
    ```bash
    brew install apigeecli
    ```

Verify installation:
```bash
apigeecli version
```

---

## 3. Google Cloud Authentication

Authenticate with Google Cloud and set your target project:

```bash
export PROJECT_ID="your-gcp-project-id"
export APIGEE_ENV="eval"

gcloud config set project "$PROJECT_ID"
gcloud auth login
gcloud auth application-default login
```

