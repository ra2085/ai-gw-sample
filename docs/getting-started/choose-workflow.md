# Choose Your Workflow: Template vs. Native Proxy

This repository provides two distinct, fully supported ways to work with the Apigee AI Gateway depending on your use case and level of customization:

---

## Workflow Comparison

<div class="grid cards" markdown>

-   **Option 1: Declarative Template Workflow (`templates/ai-gateway`)**

    ---

    **Best for:** Platform Engineers, DevOps, and developers who want a turnkey, configurable AI Gateway without managing raw XML policies.

    * **Configuration:** Single declarative `values.yaml` file.
    * **Tooling:** [`apigee-go-gen`](https://github.com/apigee/apigee-go-gen).
    * **Capabilities:** Toggle features (Monetization, Model Armor, Judge, Quotas), add custom model URLs, and compile clean bundles on the fly.
    * **Workflow:** `Edit values.yaml` → `apigee-go-gen render apiproxy` → `Deploy`.

    [Explore Template Guide](../template-guide/configuration.md)

-   **Option 2: Native Proxy Deep Dive (`apiproxy/`)**

    ---

    **Best for:** Apigee Architects, Enterprise Gateway Developers, and engineers who need granular control over XML policies and JS scripts.

    * **Configuration:** Direct access to **51 XML policies** (plus 4 opt-in rate-limit/quota policies in the template), **5 TargetEndpoints**, **5 ProxyEndpoints**, and **20 JavaScript callouts**.
    * **Tooling:** Standard Apigee bundle tools, `apigeecli`, and source control.
    * **Capabilities:** Deep customization of EventFlow SSE streaming, custom error traps, custom Java/Python callouts, and low-level HTTPTargetConnection tuning.
    * **Workflow:** `Edit apiproxy/ XML/JS` → `Deploy with apigeecli`.


    [Explore Native Proxy Deep Dive](../proxy-deep-dive/bundle-structure.md)

</div>

---

## Detailed Comparison Matrix

| Feature / Dimension | Option 1: Template Workflow (`templates/`) | Option 2: Native Proxy (`apiproxy/`) |
| :--- | :--- | :--- |
| **Primary Artifact** | `templates/ai-gateway/values.yaml` | `apiproxy/` directory (XML + JS + OAS) |
| **Complexity** | Low / Declarative | High / Granular XML & JavaScript |
| **Custom Model URLs** | Simple `models:` entry in `values.yaml` | Add entries to `model_locations.properties` |
| **Feature Toggles** | `monetization.enabled: false` (auto-removes XML) | Manually edit PreFlow/PostFlow Step tags |
| **Auth & Quota Options** | Declarative toggles (`auth`, `quotas.secondary_window`, `rate_limits`) | Manually attach/detach OAuth, SpikeArrest, and Quota XML |
| **Streaming & EventFlow** | Pre-wired & compiled automatically | Direct inspection of SSE chunk handlers |
| **CI/CD Pipeline** | Helm-like pipeline rendering per environment | Standard Apigee proxy deployment pipeline |
| **Recommended Path** | **Recommended for 90% of deployments** | **Recommended for deep Apigee platform engineering** |

