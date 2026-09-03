---
sidebar_position: 2
---

# Quick Start

This guide takes you from an empty machine to a workflow you have written, published, and shared —
using the **Moco CLI** for development and the **Moco web console** for release and sharing.

You will:

1. Install and configure the `moco` CLI
2. Run existing example workflows
3. Build and run your first workflow
4. Publish it and run the deployed version
5. Manage and share workflows in the web console

## Prerequisites

- **Node.js 18+** (the CLI is distributed as an npm package)
- **Git** (to clone the examples)
- Access to a Moco service — the hosted service at `https://www.my-moco.com`, or your own
  self-hosted deployment — and an account you can log in with

You do **not** need Python, Docker, or a local Temporal server. The CLI is a thin client:
workflows execute on the Moco service.

---

## 1. Set up the Moco CLI

### Install

The CLI and its shared library are published as tarballs under
[`https://www.my-moco.com/tools/`](https://www.my-moco.com/tools/) (the directory is browsable —
use it to check for newer versions).

```bash
curl -O https://www.my-moco.com/tools/moco-lib-1.0.0.tgz
curl -O https://www.my-moco.com/tools/moco-cli-1.0.0.tgz

npm i -g moco-lib-1.0.0.tgz moco-cli-1.0.0.tgz

moco --help
```

Install both tarballs together — `moco-cli` depends on `moco-lib`.

### Point the CLI at your Moco service

The CLI talks to the service over its MCP endpoint. Configuration lives in `~/.moco/config.json`
and is managed with `moco config`:

```bash
# hosted service
moco config set mcp_endpoint https://www.my-moco.com/mcp

# ...or a local/self-hosted server (this is the default)
moco config set mcp_endpoint http://localhost:8000/mcp

moco config list
```

The `auth.*` keys (`auth.authorize_url`, `auth.token_url`, `auth.client_id`, `auth.redirect_url`,
`auth.token_type`) describe the OAuth2 provider. The defaults work for the hosted service; change
them only if your deployment uses a different identity provider.

### Log in

```bash
moco login
```

This runs an OAuth2 PKCE flow: your browser opens, you authenticate, and the CLI receives the
token on its local redirect URL. Tokens are cached in `~/.moco/tokens.json`.

Login also initializes your session and selects your **home namespace** as the working namespace.
A namespace is where your workflow specs live.

```bash
moco session show                    # current user, working namespace, roles, privileges
moco session select <namespace-id>   # switch working namespace
moco logout                          # clear tokens and cached session
```

---

## 2. Run the examples

The example workflows live in the [build-my-workflow](https://github.com/build-my-workflow)
GitHub organization. Clone the examples repository and run one:

```bash
git clone https://github.com/build-my-workflow/moco-examples.git
cd moco-examples/moco-workflow-demo

moco validate src/sequence-demo.yaml
moco run src/sequence-demo.yaml
```

`moco validate` checks the YAML against the workflowspec schema locally — no server needed.
`moco run <file>` bundles the spec (plus any child workflows it references), sends it to the
service, streams progress back to your terminal, and prints the result:

```
✓ Workflow executed successfully

Result:
"Hello, your request was received at 2026-08-30 10:15:04. Current time is 2026-08-30 10:15:05"
```

Useful options while developing:

```bash
moco run src/sequence-demo.yaml --input '{"name": "Moco"}'   # pass input data as JSON
moco run src/sequence-demo.yaml --debug                      # verbose logs and debug traces
moco run src/sequence-demo.yaml --in-memory                  # run in-process, no Temporal
moco run src/sequence-demo.yaml --output result.json         # also save the result to a file
```

`--output` (short form `-o`) is worth reaching for whenever the result is large or you want to
feed it into another tool. Progress and log lines share stdout with the result, so redirecting
with `>` captures both — `--output` writes the result payload on its own. The format follows the
file extension: `.json` writes pretty-printed JSON, `.yaml`/`.yml` writes YAML, and any other
extension writes a string result verbatim (useful for a workflow that returns markdown or CSV),
falling back to JSON for non-strings. The result is still printed to the terminal as usual.

Long-running workflows can be started asynchronously and managed by workflow ID:

```bash
moco start src/sequence-demo.yaml
moco status <workflow-id>
moco cancel <workflow-id>       # graceful, allows cleanup
moco terminate <workflow-id>    # forceful
```

Examples ship with tests (`tests/*.test.yaml`) that you can run with:

```bash
moco test tests/sequence-demo.test.yaml
moco test                       # everything under ./tests/
```

Browse the other example projects — `state-machine-demo`, `rules-engine-demo`,
`web-crawler-demo`, `task-manager` — to see state machines, rules, and AI activities in action.

---

## 3. Build your first workflow

Create a project directory with a `src/` folder:

```bash
mkdir -p hello-moco/src && cd hello-moco
```

Save this as `src/hello-moco.yaml`. It calls a public HTTP API and turns the response into a
one-line summary:

```yaml
wfspec_name: hello-moco
wfspec_version: 1.0.0

input_data:
  owner: temporalio
  repo: temporal

output_name: summary

body:
  sequence:
    elements:
      # Call an external API
      - activity:
          name: fetch-repo
          type: http.request
          input_data:
            method: GET
            url: 'https://api.github.com/repos/{{ owner }}/{{ repo }}'
            output_json: true
          output_data:
            - repo_info: '{{ _raw_output.get("json", {}) }}'

      # Shape the result
      - transform:
          name: build-summary
          output_data:
            - summary:
                name: '{{ repo_info.get("full_name") }}'
                stars: '{{ repo_info.get("stargazers_count", 0) }}'
                description: '{{ repo_info.get("description") }}'
```

A few things to notice:

- `body` holds one statement. Here it is a `sequence`, which runs its `elements` in order.
- `activity` performs work against the outside world; `transform` only reshapes workflow data.
- Anything inside `{{ }}` is a sandboxed Python expression evaluated against the workflow's data
  context. `_raw_output` is the activity's raw response.
- `output_name` names the context variable returned as the workflow result.

Validate and run it:

```bash
moco validate src/hello-moco.yaml
moco run src/hello-moco.yaml
moco run src/hello-moco.yaml --input '{"owner": "python", "repo": "cpython"}'
```

### Debugging tip: the `#` modifier

Append `#` to a variable name and its evaluated value is streamed back to your terminal during
execution — the fastest way to see what an expression actually produced:

```yaml
- transform:
    output_data:
      - stars#: '{{ repo_info.get("stargazers_count", 0) }}'
```

Traces from child workflows are collected automatically. When running a *deployed* workflow, add
`--debug` to print them.

---

## 4. Publish your workflow

A published unit is a **package**: one or more wfspec files versioned together. Describe it with a
`moco.json` in your project root:

```json
{
  "wfspec_package_name": "hello-moco",
  "wfspec_package_version": "1.0.0",
  "wfspec_description": "Summarize a GitHub repository",
  "sources": ["src/**/*.yaml"],
  "tests": ["tests/**/*.yaml"]
}
```

The package needs an entry point: one source file whose `wfspec_name` equals
`wfspec_package_name` (here, `hello-moco.yaml`). The others are child workflows it can reference.

Preview, then publish to your working namespace:

```bash
moco publish --dry-run
moco publish
```

```
✓ Found and validated 1 workflow file(s)
✓ Wfspec created/updated in namespace
✓ Published package
Package: hello-moco:1.0.0
```

To publish elsewhere, use `moco publish --namespace <namespace-id>`.

### Deploy and run the deployed version

Publishing stores the package; **deploying** makes a version resolvable by name in a stage
(`dev`, `beta`, or `prod`). Deploy from the web console (see the next section), then run your
workflow by name instead of by file path:

```bash
moco run hello-moco --input '{"owner": "python", "repo": "cpython"}'
moco run hello-moco --debug
```

Because the name resolves through the deployment, bumping `wfspec_package_version` and
republishing rolls callers forward without them changing anything.

---

## 5. Manage and share in the web console

Open [`https://www.my-moco.com/ui`](https://www.my-moco.com/ui) and sign in with the same account.
The console is where you own the lifecycle of your workflows.

**Create a wfspec.** In your namespace, create a wfspec entry with a name, description, owner, and
tags. This is the container that versioned packages are published into — the same entry
`moco publish` creates for you.

**Publish a new version.** On a wfspec page, publish a package by setting a semantic version
(major / minor / patch), optional manifest metadata, and the workflow file contents. Use this for
quick edits in the browser, or keep publishing from the CLI — both write to the same place.

**Deploy to a stage.** Deploy a package version to `dev`, `beta`, or `prod`. Start in `dev`,
verify with `moco run <name>`, then promote the same package to `prod`.

**Share with others.** A deployment can be targeted at specific users or user groups. Add your
colleague's user ID (or a group they belong to) as a target and they can run your workflow by name
from their own CLI or from the API — without a copy of your YAML, and without deploying anything
themselves. Namespace privileges control who can view, edit, and deploy alongside you.

The console also manages **secrets** (encrypted values referenced from workflows) and
**persistent state** used by long-running workflows.

---

## Next steps

- [Core Concepts](./concepts/overview.md) — how Moco models workflows
- [Workflowspec](./concepts/workflowspec.md) — structure of a spec
- [Statements](./reference/statements.md) — `sequence`, `parallel`, `iteration`, `state_machine`, and more
- [Expressions](./concepts/expressions.md) — the `{{ }}` expression language
- [Activities](./concepts/activities.md) — HTTP, Kafka, shell, S3, OpenAI, MCP, and custom activities
- [State Machines](./reference/state-machines.md) — event-driven and human-in-the-loop workflows
- [Testing](./guides/testing.md) — writing `*.test.yaml` suites for your workflows
