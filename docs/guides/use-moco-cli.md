---
sidebar_label: Using the Moco CLI
sidebar_position: 0
---

# Using the Moco CLI

`moco` is the command-line client for the Moco platform. It validates workflow specs locally, runs
them on a Moco service, publishes them to a namespace, and manages the secrets, state, and
credentials your workflows depend on.

The CLI is a **thin client**. Apart from schema validation, nothing executes locally — the CLI
bundles your YAML, sends it to the service over MCP, and streams progress back. You do not need
Python, Docker, or a Temporal server on your machine.

If you are setting up for the first time, follow the [Quick Start](../quick-start.md) — it walks
through install, login, and your first workflow. This guide is the command-by-command reference.

---

## Installation

The CLI and its shared library are published as npm tarballs under
[`https://www.my-moco.com/tools/`](https://www.my-moco.com/tools/):

```bash
curl -O https://www.my-moco.com/tools/moco-lib-1.0.0.tgz
curl -O https://www.my-moco.com/tools/moco-cli-1.0.0.tgz

npm i -g moco-lib-1.0.0.tgz moco-cli-1.0.0.tgz

moco --help
```

Install both together — `moco-cli` depends on `moco-lib`. Node.js 18+ is required.

---

## Configuration

Configuration lives in `~/.moco/config.json` and is edited with `moco config`:

```bash
moco config list
moco config get mcp_endpoint
moco config set mcp_endpoint https://www.my-moco.com/mcp
```

| Key | Default | Meaning |
|-----|---------|---------|
| `mcp_endpoint` | `http://localhost:8000/mcp` | The Moco service's MCP endpoint. Every command except `validate` goes here. |
| `auth.authorize_url` | Google OAuth2 | Authorization endpoint of the identity provider |
| `auth.token_url` | Google OAuth2 | Token endpoint |
| `auth.redirect_url` | `http://localhost:3000/auth` | Local redirect the CLI listens on during login |
| `auth.client_id` | `moco-cli` | OAuth2 client ID |
| `auth.token_type` | `id_token` | Which token is sent to the service — `id_token` or `access_token` |

The `auth.*` defaults work for the hosted service. Change them only if your deployment uses a
different identity provider.

The `~/.moco` directory also holds `tokens.json` (OAuth tokens), `session.json` (cached session and
working namespace), and the downloaded wfspec schema.

---

## Authentication

Moco accepts two credentials: an **OAuth2 session** (interactive, for humans) and an **API key**
(non-interactive, for scripts and CI).

### OAuth2 login

```bash
moco login
moco logout          # clear tokens
moco logout --all    # also clear the stored API key
```

`moco login` runs an OAuth2 PKCE flow: your browser opens, you authenticate, and the CLI receives
the token on `auth.redirect_url`. Tokens are cached and refreshed automatically.

### API keys

```bash
moco apikey create ci-runner --expires-in 90d --save
moco apikey list
moco apikey list --include-revoked
moco apikey get <key-id>
moco apikey revoke <key-id>      # keeps the record, stops the key working
moco apikey delete <key-id>      # removes the record entirely
```

`moco apikey create` prints the key **exactly once** — there is no way to read it back. `--save`
stores it for this CLI to use. `--expires-in` accepts `30d` / `12h` / `90m`; `--expires-at` takes an
ISO-8601 instant.

To hand a key to a machine that did not create it:

```bash
moco apikey set              # reads the key from stdin
moco apikey set <key>
moco apikey clear
moco apikey status           # which credential will be used
moco apikey status --reveal
```

A key in the `MOCO_API_KEY` environment variable takes precedence over the stored one — the usual
way to authenticate in CI without writing anything to disk.

When both an API key and OAuth tokens are available the API key wins. Force one explicitly with
`--auth oauth` or `--auth apikey`, available on every command that talks to the service.

---

## Sessions and namespaces

A **namespace** is where workflow specs live. Logging in selects your home namespace as the working
namespace; publishing and secret management default to it.

```bash
moco session show                    # user, working namespace, roles, privileges
moco session select <namespace-id>   # switch working namespace
```

---

## Validating

```bash
moco validate src/my-workflow.yaml
```

`validate` checks the YAML against the workflowspec JSON schema. It runs entirely locally and needs
neither a login nor a running service — so it is the right thing to put in a pre-commit hook.

The schema ships with the CLI, but the service's schema advances as activities are added. Keep them
in sync:

```bash
moco schema update     # download the current schema from the configured service
moco schema show       # print the active schema and where it came from
```

The same schema drives autocompletion and inline diagnostics in the VSCode extension.

---

## Running workflows

```bash
moco run <file-or-name>
```

The argument is treated as a **file path** when it ends in `.yaml` or `.yml`, and as a **deployed
workflow name** otherwise:

```bash
moco run src/hello-moco.yaml                 # local file
moco run hello-moco                          # deployed, resolved by name
```

Running a local file bundles the spec together with any child workflows it references and sends the
whole bundle; nothing needs to be published first. This is the normal development loop.

| Option | Effect |
|--------|--------|
| `-i, --input <json>` | Input data as a JSON string |
| `-o, --output <file>` | Also write the result to a file |
| `-t, --timeout <sec>` | MCP request timeout (`0` = no timeout, the default for `run`) |
| `--in-memory` | Run in-process on the server, no Temporal (`execute_mode: in-memory`) |
| `--activity` | Run the whole workflow as one Temporal activity (`execute_mode: standalone-activity`) |
| `--tier <tier>` | Execution tier, e.g. `dev`, `beta`, `prod` |
| `--user-id`, `--user-org` | Override the identity the workflow runs as |
| `--trace` | Emit OpenTelemetry traces for the run |
| `--debug` | Verbose logging and debug traces |

`--in-memory` and `--activity` are mutually exclusive. See
[How Workflows Run](../concepts/how-to-run-workflow.md) for what each mode gives up.

`--output` writes the result payload on its own, which matters because progress lines and the
result share stdout — redirecting with `>` captures both. The format follows the extension: `.json`
writes pretty-printed JSON, `.yaml`/`.yml` writes YAML, any other extension writes a string result
verbatim (useful for markdown or CSV), falling back to JSON for non-strings.

### Debug traces

Debug mode is enabled **automatically when you run a local file**, so variables marked with the `#`
modifier stream to your terminal as they are evaluated:

```yaml
- transform:
    output_data:
      - stars#: '{{ repo_info.get("stargazers_count", 0) }}'
```

When running a *deployed* workflow by name, pass `--debug` to get the same traces. Traces from
child workflows are collected and interleaved automatically.

### Asynchronous runs

`run` blocks until the workflow finishes. For long-running workflows, start one and manage it by
ID:

```bash
moco start src/monitor.yaml -i '{"symbol": "AAPL"}'
moco status <workflow-id>
moco history <workflow-id>
moco cancel <workflow-id>                  # graceful — the workflow can run cleanup
moco terminate <workflow-id> -r "stuck"    # forceful — no cleanup
```

`moco history` returns the chronological event list for a run (activity scheduled, started,
completed, failed) — the first place to look when a run behaved unexpectedly.

`start`, `cancel`, `terminate`, `status`, and `history` require Temporal. They are not available for
`--in-memory` runs, which have no durable handle to address.

---

## Running a single activity

Sometimes you want to exercise one activity without wrapping it in a workflow — checking an HTTP
endpoint's shape, verifying credentials, or reproducing an activity failure in isolation:

```bash
moco activity run http.request -i '{"method": "GET", "url": "https://api.github.com"}'
moco activity run sql.query -i @query-input.json -c @db-config.yaml
```

`-i/--input` and `-c/--config` accept inline JSON, or `@path` pointing at a `.json` or `.yaml` file.

```bash
moco activity start <type> -i @input.json    # returns an activity ID
moco activity result <activity-id>
moco activity cancel <activity-id>
moco activity terminate <activity-id>
```

Standalone activities default to `max_attempts=1` with a 24-hour timeout. Override with
`--retry-policy '{"max_attempts": 3, "timeout_sec": 60}'`. `moco activity run --in-memory` dispatches
in the server process, which means no Temporal worker is needed.

---

## Testing

```bash
moco test                                  # everything under ./tests/
moco test tests/hello-moco.test.yaml       # one file
moco test 'tests/**/*.test.yaml'           # a glob
```

| Option | Effect |
|--------|--------|
| `--in-memory` | Run tests on the in-memory runtime (no Temporal) |
| `--verbose` | Per-test workflow progress and server log messages |
| `-t, --timeout <sec>` | MCP request timeout (default 300) |
| `--debug` | HTTP-level debug logging |

Test files are `*.test.yaml` and support mocked activities and assertions. See
[Testing Workflows](./testing.md) for the file format.

---

## Publishing

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

The package needs an **entry point**: one source file whose `wfspec_name` equals
`wfspec_package_name`. The remaining sources are child workflows it may reference.

```bash
moco publish --dry-run                     # validate and show what would be published
moco publish
moco publish --namespace <namespace-id>    # publish somewhere other than the working namespace
```

Publishing stores the package. Making a version resolvable by name in a stage (`dev`, `beta`,
`prod`) is a separate **deployment** step, done from the web console. Once deployed,
`moco run hello-moco` resolves through the deployment — so bumping `wfspec_package_version` and
republishing rolls callers forward without them changing anything.

---

## Secrets

Secrets are encrypted **client-side** before upload; the service stores ciphertext and workflows
resolve them at execution time through the `secret.*` activities.

```bash
moco secret list
moco secret upload OPENAI_API_KEY sk-...
moco secret delete OPENAI_API_KEY
```

`--global` targets the global (shared) namespace instead of your own; `--force` skips the delete
confirmation. See the [secret activity reference](../reference/activities/secret.md) for how
workflows read them.

---

## Uploading state

Workflows read and write persistent state through the `state.*` activities. To seed that store with
a local dataset:

```bash
moco state upload data/customers.csv --key customers
moco state upload data/config.json --key app-config --topic settings
```

| Option | Effect |
|--------|--------|
| `--key <key>` | State key name (prompted if omitted) |
| `--namespace <ns>` | Target namespace (prompted if omitted; defaults to `uploads`) |
| `--topic <topic>` | Topic used for categorization |
| `--in-global-ns` | Store in the global, non-user-scoped namespace |

Only `.json` and `.csv` files are accepted.

---

## Command summary

| Command | Purpose |
|---------|---------|
| `moco validate <file>` | Schema-check a wfspec locally |
| `moco run <file-or-name>` | Execute a workflow and wait for the result |
| `moco start <file-or-name>` | Start a workflow, return its ID |
| `moco status <id>` / `history <id>` | Inspect a run |
| `moco cancel <id>` / `terminate <id>` | Stop a run gracefully / forcefully |
| `moco activity run\|start\|result\|cancel\|terminate` | Work with a single activity |
| `moco test [path]` | Run `*.test.yaml` suites |
| `moco publish [dir]` | Publish a package from `moco.json` |
| `moco login` / `logout` | OAuth2 session |
| `moco apikey …` | Create and manage API keys |
| `moco session show` / `select` | Inspect or switch the working namespace |
| `moco config get` / `set` / `list` | CLI configuration |
| `moco schema update` / `show` | Sync the validation schema |
| `moco secret list` / `upload` / `delete` | Manage secrets |
| `moco state upload <file>` | Seed persistent state |

---

## Next steps

- [How Workflows Run](../concepts/how-to-run-workflow.md) — execute modes and options
- [Running Workflows Through the API](./run-moco-workflow-through-api.md) — REST and MCP
- [Testing Workflows](./testing.md) — writing test suites
- [Writing Workflows](./writing-workflows.md) — authoring patterns
