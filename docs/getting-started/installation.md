# 📦 Installation & Prerequisites

To configure, generate, and deploy the **Apigee AI Gateway**, ensure you have the following prerequisites installed on your development machine or CI/CD environment.

---

## 1. Prerequisites

| Tool | Minimum Version | Description |
| :--- | :--- | :--- |
| **Go** | `>= 1.22` | Required for compiling and running `apigee-go-gen`. |
| **Google Cloud SDK (`gcloud`)** | `>= 450.0.0` | Required for authenticating and managing GCP resources. |
| **Apigee CLI (`apigeecli`)** | `>= 1.120` | Official CLI for deploying Apigee bundles, managing data collectors, and developer apps. |
| **Node.js** | `>= 18.0.0` | Optional, used for local JavaScript policy testing and verification. |

---

## 2. Install Apigee CLI (`apigeecli`)

Install the official `apigeecli` tool:

=== "macOS / Linux"
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

## 3. Build & Set Up `apigee-go-gen`

Clone and build the `apigee-go-gen` generator tool:

```bash
git clone https://github.com/apigee/apigee-go-gen
cd apigee-go-gen
go build -o ./bin/apigee-go-gen ./cmd/apigee-go-gen
```

Verify that the CLI runs successfully:
```bash
./bin/apigee-go-gen --help
```

---

## 4. Google Cloud Authentication

Authenticate with Google Cloud and set your target project:

```bash
export PROJECT_ID="your-gcp-project-id"
export APIGEE_ENV="eval"

gcloud config set project "$PROJECT_ID"
gcloud auth login
gcloud auth application-default login
```
