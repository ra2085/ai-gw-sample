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

=== "Automated Install Script (Recommended)"
    ```bash
    # Install latest version into /usr/local/bin
    curl -s https://apigee.github.io/apigee-go-gen/install | sh
    ```

    To install to a custom directory (e.g. `~/.local/bin`):
    ```bash
    curl -s https://apigee.github.io/apigee-go-gen/install | sh -s latest ~/.local/bin
    ```

=== "From Source (with Go)"
    ```bash
    go install github.com/apigee/apigee-go-gen/cmd/...@latest
    ```

=== "Manual Download"
    Download the pre-compiled binary tarball for your OS and architecture from [GitHub Releases](https://github.com/apigee/apigee-go-gen/releases), extract it, and place `apigee-go-gen` into your `$PATH`.

Verify installation:
```bash
apigee-go-gen --help
```


---

### Install `apigeecli` (Deployment CLI)

=== "Automated Install Script (Recommended)"
    ```bash
    # Install latest version into ~/.apigeecli/bin
    curl -L https://raw.githubusercontent.com/apigee/apigeecli/main/downloadLatest.sh | sh -
    export PATH=$PATH:$HOME/.apigeecli/bin
    ```

    To install to a custom directory or specific version:
    ```bash
    curl -L https://raw.githubusercontent.com/apigee/apigeecli/main/downloadLatest.sh | sh -s -- -v <version> -b /usr/local/bin
    ```

=== "Homebrew (macOS / Linux)"
    ```bash
    brew install apigeecli
    ```


=== "From Source (with Go)"
    ```bash
    go install github.com/apigee/apigeecli/cmd/apigeecli@latest
    ```

=== "Manual Download"
    Download the pre-compiled binary package for your operating system from [apigeecli GitHub Releases](https://github.com/apigee/apigeecli/releases), extract it, and add it to your `$PATH`.

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

