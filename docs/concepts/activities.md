---
sidebar_position: 5
---

# Activity System

Activities are external functions or services that workflows can execute. They enable workflows to interact with databases, APIs, message queues, and other systems.

## What are Activities?

An **activity** is:
- A reusable piece of logic
- Executed outside the workflow logic
- Potentially long-running or unreliable
- Subject to retries and timeouts
- Isolated from workflow state

Activities allow you to:
- Make HTTP requests
- Query databases
- Send emails or SMS
- Process files
- Call external APIs
- Perform complex calculations
- Integrate with third-party services

## Basic Activity Usage

```yaml
- activity:
    type: builtin.http_request      # Activity type identifier
    input_data:                      # Input parameters
      method: GET
      url: https://api.example.com/users/123
    output_name: user_data           # Store result
    retry_policy:                    # Timeout & retry (Temporal runtime only)
      timeout_sec: 30                # Per-attempt execution timeout
      max_attempts: 3               # Total attempts (initial + retries)
```

## Activity Parameters

### Required

| Parameter | Type | Description |
|-----------|------|-------------|
| `type` | string | Activity type identifier (e.g., "builtin.http_request") |

### Optional

| Parameter | Type | Description |
|-----------|------|-------------|
| `version` | string | Activity version (default: "1.0.0") |
| `config_data` | dict | Static configuration (evaluated once) |
| `input_data` | dict | Dynamic input (evaluated per execution) |
| `output_name` | string | Variable to store activity result |
| `output_data` | list | Transform result before storing |
| `retry_policy` | dict | Nested timeout/retry config (Temporal only): `timeout_sec` (per-attempt execution timeout), `schedule_to_close_timeout_sec`, `heartbeat_timeout_sec`, `heartbeat_interval_sec` (heartbeat cadence; heartbeating is enabled only when both `heartbeat_timeout_sec` and `heartbeat_interval_sec` are set), `max_attempts` (total attempts = initial + retries), `initial_interval_sec`, `backoff_coefficient`, `maximum_interval_sec`, `non_retryable_error_types` |
| `execute_locally` | boolean | Force local execution (bypass Temporal). Overrides the activity's own default — see [Local Execution](#local-execution) |
| `enable_cache` | boolean | Enable result caching |
| `cache_policy` | dict | Cache configuration |

## Built-in Activities

Moco includes several built-in activities:

### HTTP Request

Make HTTP requests to external APIs:

```yaml
# GET request
- activity:
    type: builtin.http_request
    input_data:
      method: GET
      url: https://api.example.com/data
      headers:
        Authorization: "Bearer {{ token }}"
        Accept: application/json
      params:
        limit: 10
        offset: 0
    output_name: api_response
    retry_policy:
      timeout_sec: 30
```

```yaml
# POST request with JSON body
- activity:
    type: builtin.http_request
    input_data:
      method: POST
      url: https://api.example.com/orders
      headers:
        Content-Type: application/json
      body:
        order_id: "{{ order_id }}"
        items: "{{ items }}"
        total: "{{ total }}"
    output_name: create_response
```

### Delay

Pause workflow execution:

```yaml
- activity:
    type: builtin.delay
    input_data:
      duration: 5s      # Seconds: 5s, minutes: 5m, hours: 5h
```

### State Persistence

Store and retrieve workflow state:

```yaml
# Save state
- activity:
    type: builtin.state.save
    input_data:
      key: "user-{{ user_id }}-preferences"
      value:
        theme: dark
        notifications: true
    output_name: save_result

# Load state
- activity:
    type: builtin.state.load
    input_data:
      key: "user-{{ user_id }}-preferences"
    output_name: preferences
```

### Secret Management

Access secrets securely. Plaintext secrets never travel between activities.

Most activities that need a secret take a **secret key** instead of the secret itself — for
example `openai.chat.completions.apikey_secret_key`, `email.send.password_secret_key`,
`sql.query.connection_string_secret_key` or, nested one level down,
`llama_index.query.vectordb_info.connection_string_secret_key`,
`llama_index.query.embed_model_info.apikey_secret_key`,
`llama_index.index_github.auth.token_secret_key` and
`gdrive.*.auth.credentials_secret_key` (which `llama_index.index_gdrive` reuses
verbatim). The activity looks the secret up and
decrypts it internally, so nothing sensitive touches workflow context at all. A bare `NAME`
resolves a user-scoped secret; `global/NAME` resolves a global one.

Where an activity does not yet support that (for example `http.request.encrypted_auth_token`),
use `builtin.secret.get`, which returns the secret **still encrypted** — pass that blob straight
to the activity, which decrypts it internally.

```yaml
- activity:
    type: builtin.secret.get
    input_data:
      secret_name: database_password
      in_global_ns: false      # optional; true reads the shared global namespace
      expiration_seconds: 60   # optional; defaults to 60
    output_name: db_password
```

The returned secret **expires after `expiration_seconds`** (60 by default), so a copy that
leaks into logs, events or workflow history cannot be replayed later. Decrypting an expired
secret fails with `EncryptedDataExpiredError`.

This matters for long-running workflows: a state machine that waits on events for minutes or
hours must not fetch the secret once at startup and hold it. Re-run `builtin.secret.get` in
each state that needs it, so every use gets a freshly minted secret. Passing `0` or a negative
value disables expiration entirely, which restores the old replayable behaviour — use it only
when re-fetching genuinely isn't possible.

The stored secret itself never expires; only the copy handed to the workflow does.

Secrets share the persistence store with ordinary workflow state, under the reserved
namespace `secret` (global) or `<user_id>:secret` (per user). The `builtin.state.*`
activities refuse that namespace with a `ReservedNamespaceError` — including another user's
`<user_id>:secret` — and omit it from `builtin.state.list_namespaces`. Secrets are reachable
only through `builtin.secret.*`, so the expiration above cannot be sidestepped by reading the
stored blob directly.

### Retrieval-Augmented Generation (RAG)

These activities build and query a vector index over your own documents, so an LLM can answer
from them instead of from its training data. Documents are chunked and embedded into a
[pgvector](https://github.com/pgvector/pgvector) table by one of the `llama_index.index_*`
activities, and `llama_index.query` finds the chunks closest to a question.

There is one indexing activity per document source:

| Activity | Indexes |
| --- | --- |
| `llama_index.index_web` | Pages or documents at a list of URLs |
| `llama_index.index_site` | Every page reachable from one seed — a sitemap, a feed, or a crawl |
| `llama_index.index_github` | The files of a GitHub or GitHub Enterprise repository |
| `llama_index.index_gdrive` | A Google Drive folder, file list or query |
| `llama_index.index_files` | Files already on the worker's disk |

They all share the same chunking, embedding and metadata handling, so a single table can hold
documents from several sources: every chunk carries `source_url`, `file_name` and
`source_type`, whichever activity wrote it.

Every one of them takes the same two nested blocks, so build them once in `context` and reuse
them — the embedding model **must** be identical on both sides, or the similarity scores are
meaningless:

```yaml
context:
  vectordb_info:
    connection_string_secret_key: "MOCO_PGVECTOR_CONN"  # postgresql://... in the secret store
    table_name: "product_docs"                          # physical table is data_product_docs
  embed_model_info:
    apikey_secret_key: "MY_LLM_TOKEN"
    base_url: "https://my-gateway/v1"       # or MOCO_LLM_DEFAULT_BASE_URL
    model_name: "text-embedding-3-small"    # or MOCO_LLM_DEFAULT_EMBED_MODEL_NAME
    embed_dim: 1536                         # must match the model and the existing table
```

`base_url` is the full base URL of an OpenAI-compatible endpoint and is used exactly as given —
include the version path. That is `https://my-gateway/v1` for most gateways,
`http://localhost:11434/v1` for Ollama, and
`https://generativelanguage.googleapis.com/v1beta/openai/` for Gemini. The same rule applies to
`llm_model_info.base_url` and to `openai.chat.completions`.

#### Indexing from the web

`index_web` fetches each URL and parses it. A URL that fails is reported in `failed_sources`
rather than failing the run:

```yaml
- activity:
    type: llama_index.index_web
    name: index-docs
    input_data:
      urls: "{{ doc_urls }}"
      loader: download                # see the table below
      vectordb_info: "{{ vectordb_info }}"
      embed_model_info: "{{ embed_model_info }}"
      chunk_size: 1024
      chunk_overlap: 200
      overwrite: true                 # replace the table's contents; false appends
      embed_batch_size: 64            # chunks per batch; only affects progress cadence
      metadata:                       # attached to every chunk, filterable at query time
        collection: "product-docs"
    output_name: index_result         # -> indexed_sources, failed_sources, document_count,
                                      #    node_count, table_name, source_type
```

#### Watching an index run

Indexing a repository or a whole site takes minutes, most of it spent embedding. Run with
`--debug` and the activity reports each phase as it happens, instead of returning one result at
the end:

```
$ moco run index-docs.yaml --debug
15:02:11 [llama_index.index_web] load_start  loading web sources
15:02:19 [llama_index.index_web] load_end  loaded 142 documents (3 failed)
15:02:21 [llama_index.index_web] chunk_end  split into 1832 chunks
15:02:21 [llama_index.index_web] write_start  embedding and writing 1832 chunks
15:02:34 [llama_index.index_web] write_progress 4%  embedded 64/1832 chunks
...
15:06:02 [llama_index.index_web] write_end  wrote 1832 chunks to product_docs
```

Running a local YAML file enables debug mode automatically, so the flag is only needed for a
deployed workflow. One progress line appears per `embed_batch_size` chunks — raise it for a
quieter run. Without debug mode nothing is published and the indexing itself is unchanged.

The `loader` decides how a URL becomes text. Only `download` handles non-HTML formats, and the
`simple` and `async` loaders fetch pages themselves, so they do not see moco's proxy settings:

| `loader` | Extracts | Handles PDF/DOCX | Honours `MOCO_HTTP_PROXY` |
| --- | --- | --- | --- |
| `download` *(default)* | The file, parsed by extension | Yes | Yes |
| `trafilatura` | The main article, without navigation boilerplate | No | Yes |
| `readability` | The main article, via a headless browser (sees client-rendered pages) | No | Yes |
| `beautiful_soup` | All page text | No | Yes |
| `simple` | The whole HTML page as text | No | No |
| `async` | The whole HTML page as text, fetched concurrently | No | No |

Keep `download` unless the pages are HTML *and* the boilerplate is hurting retrieval quality —
then reach for `trafilatura`, which indexes the article and leaves the navigation behind.

#### Indexing a whole site

`index_site` takes one seed URL and expands it. `sitemap` reads `sitemap.xml`; `rss` reads a
feed (indexing each entry's **summary**, not the linked article); `whole_site` walks links with
a real browser and needs Chrome plus `MOCO_CHROME_DRIVER_PATH` on the worker.

```yaml
- activity:
    type: llama_index.index_site
    input_data:
      url: "https://docs.example.com/sitemap.xml"
      crawler: sitemap
      limit: 200                      # bound the crawl
      url_filter: "/guides/"          # only sitemap entries containing this
      vectordb_info: "{{ vectordb_info }}"
      embed_model_info: "{{ embed_model_info }}"
```

#### Indexing a GitHub repository

Reads one branch or one `commit_sha`, narrowed by include/exclude filters. Set `auth.base_url`
for GitHub Enterprise. `auth.token_secret_key` is optional — without it the reader is anonymous,
which reaches public repositories at a much lower rate limit.

```yaml
- activity:
    type: llama_index.index_github
    input_data:
      auth:
        token_secret_key: "GH_TOKEN"
        base_url: "https://api.github.com"    # or https://<ghe-host>/api/v3
      owner: "temporalio"
      repo: "documentation"
      branch: "main"
      include_directories: ["docs"]           # exclude_directories is the other way round
      include_extensions: [".md", ".mdx"]
      vectordb_info: "{{ vectordb_info }}"
      embed_model_info: "{{ embed_model_info }}"
```

#### Indexing Google Drive

Takes the same `auth` block as the `gdrive.*` activities, so define it once and share it.

```yaml
- activity:
    type: llama_index.index_gdrive
    input_data:
      auth: "{{ gdrive_auth }}"       # credentials_secret_key -> service-account key JSON
      folder_id: "{{ folder_id }}"    # or file_ids: [...], or query_string: "name contains 'Q1'"
      vectordb_info: "{{ vectordb_info }}"
      embed_model_info: "{{ embed_model_info }}"
```

:::caution
`index_gdrive` **rejects** `auth.impersonate_user` and `auth.scopes` rather than silently
ignoring them: the underlying reader always acts as the service account itself. Either share
the folder with the service account, or — if you need domain-wide delegation — use
`gdrive.download` (which does support it) with `output_format: file`, then
`llama_index.index_files` over the downloaded directory.
:::

#### Indexing local files

`index_files` parses a directory already on the worker. `path` is resolved under
`MOCO_RAG_FILE_DIR` and a path escaping that root is rejected.

```yaml
- activity:
    type: llama_index.index_files
    input_data:
      path: "reports/q1"
      required_extensions: [".pdf", ".md"]
      vectordb_info: "{{ vectordb_info }}"
      embed_model_info: "{{ embed_model_info }}"
```

#### Querying

Querying has two modes. `retrieve` returns the matching chunks and nothing else, leaving the
prompt to you — useful when you want to force citations or a specific refusal:

```yaml
- activity:
    type: llama_index.query
    name: retrieve-chunks
    input_data:
      query: "{{ question }}"
      vectordb_info: "{{ vectordb_info }}"
      embed_model_info: "{{ embed_model_info }}"
      top_k: 5
      response_mode: retrieve
      filters:
        collection: "product-docs"
    output_name: hits     # -> nodes[{node_id, text, score, metadata}], node_count, answer=null
```

`synthesize` additionally has an LLM write the answer, returning it as `answer` alongside the
source `nodes`. It needs an `llm_model_info` block (its `apikey_secret_key` defaults to the
embedding one, since the two usually share a gateway):

```yaml
- activity:
    type: llama_index.query
    name: answer-question
    input_data:
      query: "{{ question }}"
      vectordb_info: "{{ vectordb_info }}"
      embed_model_info: "{{ embed_model_info }}"
      llm_model_info:
        model_name: "{{ chat_model }}"
      top_k: 5
      response_mode: synthesize
    output_name: rag_answer          # -> answer, nodes, node_count
```

:::note
Every `index_*` activity writes rows and is **not** retried by default (`max_attempts: 1`) — a
retry would duplicate chunks. Use `overwrite: true` to make re-runs idempotent. The database
needs the `vector` extension enabled; `moco-db` does this for you.
:::

:::caution
`overwrite: true` empties the **whole table**, not just the documents that activity is about to
write. When you feed one `table_name` from several sources — say web pages plus a repository —
set it on the first activity only, or the second will discard what the first just indexed.
:::

:::info Deprecated
`llama_index.index_docs` still works but is deprecated in favour of `llama_index.index_web`,
whose default `loader: download` reproduces its behaviour exactly. To migrate, rename the
activity, rename `document_urls` to `urls`, and read `indexed_sources` / `failed_sources`
instead of `indexed_urls` / `failed_urls`.
:::

A complete runnable example, contrasting both query modes over the same question, lives in
`moco-examples/rag-demo/`.

### Google Drive

Six activities read and write files in Google Drive: `gdrive.download`, `gdrive.upload`,
`gdrive.list`, `gdrive.get_metadata`, `gdrive.create_folder` and `gdrive.delete`. Together they
cover picking up a file someone dropped in a shared folder, and publishing a generated report
back to one.

All six authenticate as a **service account**, whose key JSON lives in the secret store. Define
the `auth` block once in `context` and reference it everywhere:

```yaml
context:
  gdrive_auth:
    credentials_secret_key: "GDRIVE_SERVICE_ACCOUNT"  # the whole key JSON, in the secret store
    # impersonate_user: "ops@example.com"   # optional: act as a user via domain-wide delegation
    # scopes: ["https://www.googleapis.com/auth/drive.readonly"]   # optional: narrow the access
```

:::caution
A service account has its own empty Drive. It can only see files and folders **explicitly
shared with its email address** — so share the target folder with the service account before
the first run, or set `impersonate_user` and configure domain-wide delegation.
:::

#### Content moves in one of two formats

Every download and upload picks a `format`:

| Format | Where the bytes live | Use it when |
| --- | --- | --- |
| `base64` (default) | Inline in workflow context, as a base64 string | The file is small and a later step needs its content |
| `file` | On the worker's filesystem, under `MOCO_GDRIVE_FILE_DIR` | The file is large, or a later `shell.run` needs it on disk |

`base64` copies the payload into workflow history, so keep it to small files. `file` paths are
always relative to `MOCO_GDRIVE_FILE_DIR` (default `/tmp/moco/gdrive`); paths that escape that
directory are rejected. Either way a single transfer is capped at `MOCO_GDRIVE_MAX_FILE_SIZE_MB`
(default 256).

#### Finding and downloading a file

`gdrive.list` resolves a name to a `file_id`. Pass `parent_folder_id` and/or `name_contains`, or
take over completely with a raw [Drive query string](https://developers.google.com/drive/api/guides/search-files)
in `query`:

```yaml
- activity:
    type: gdrive.list
    name: find-latest-report
    input_data:
      auth: "{{ gdrive_auth }}"
      parent_folder_id: "{{ inbox_folder_id }}"
      name_contains: "monthly-report"
      order_by: "modifiedTime desc"
      page_size: 10
    output_name: found      # -> files[{file_id, name, mime_type, size_bytes, ...}], file_count,
                            #    next_page_token
```

```yaml
- activity:
    type: gdrive.download
    name: fetch-report
    input_data:
      file_id: "{{ found.files[0].file_id }}"
      auth: "{{ gdrive_auth }}"
      output_format: base64           # or 'file' plus a file_path
    output_name: report   # -> file_id, name, mime_type, size_bytes, format, data, exported
```

`output_data.data` holds the base64 content, or — with `output_format: file` — the absolute path
the content was written to. `format` echoes which, so a downstream step can branch on it.

**Google-native documents** (Docs, Sheets, Slides, Drawings) have no stored bytes and cannot be
downloaded directly; they are exported automatically to `.docx`, `.xlsx`, `.pptx` and `.pdf`
respectively, and `exported: true` says so. Set `export_mime_type: application/pdf` to get a PDF
of any of them instead.

#### Uploading

Supply the content inline as base64, or read it from the worker's disk:

```yaml
- activity:
    type: gdrive.upload
    name: publish-summary
    input_data:
      name: "summary-{{ run_date }}.csv"
      auth: "{{ gdrive_auth }}"
      data: "{{ base64.b64encode(summary_csv.encode()).decode() }}"
      parent_folder_id: "{{ output_folder_id }}"
      mime_type: "text/csv"       # optional; guessed from the file name when omitted
    output_name: published        # -> file_id, name, mime_type, size_bytes, web_view_link, parents
```

```yaml
- activity:
    type: gdrive.upload
    name: publish-large-export
    input_data:
      name: "export.parquet"
      auth: "{{ gdrive_auth }}"
      source_format: file
      file_path: "exports/export.parquet"   # relative to MOCO_GDRIVE_FILE_DIR
      parent_folder_id: "{{ output_folder_id }}"
    output_name: published
```

Set `mime_type` to a Google-native type (e.g. `application/vnd.google-apps.spreadsheet`) to have
Drive convert the upload into a native document as it lands. Conversion needs to know the format
to convert *from*, which is taken from the file name — add `source_mime_type: text/csv` when the
name has no useful extension:

```yaml
- activity:
    type: gdrive.upload
    input_data:
      name: "Q3 numbers"          # no extension, so the source format can't be guessed
      auth: "{{ gdrive_auth }}"
      data: "{{ base64.b64encode(csv_text.encode()).decode() }}"
      mime_type: "application/vnd.google-apps.spreadsheet"   # target: a real Google Sheet
      source_mime_type: "text/csv"                           # what the bytes actually are
```

#### Folders, metadata and deletion

```yaml
- activity:
    type: gdrive.create_folder
    input_data:
      name: "{{ run_date }}"
      auth: "{{ gdrive_auth }}"
      parent_folder_id: "{{ archive_folder_id }}"
      skip_if_exists: true      # reuse a folder of this name instead of creating a second one
    output_name: run_folder     # -> folder{file_id, name, ...}, created

- activity:
    type: gdrive.delete
    input_data:
      file_id: "{{ stale_file_id }}"
      auth: "{{ gdrive_auth }}"
      permanent: false          # move to trash (default); true deletes outright
    output_name: deleted        # -> file_id, permanent
```

:::note
The three write activities — `upload`, `create_folder` and `delete` — are **not retried** by
default (`max_attempts: 1`). Drive allows several files to share a name in one folder, so a
retried create leaves a duplicate behind. The idempotent paths are `upload` with an explicit
`file_id` (which replaces that file's contents in place) and `create_folder` with
`skip_if_exists: true`; with either of those set it is safe to raise `max_attempts` via the
activity's `retry_policy`.
:::

A complete runnable example — create a folder, upload a report, list it, download it back and
clean up — lives in `moco-examples/gdrive-demo/`.

### Claude Agent

`claude_agent.query` runs a full Claude Agent SDK loop inside one activity. The agent reasons over
multiple turns and calls tools autonomously; the activity returns its final result.

Use it when a step is open-ended enough that you cannot specify it in advance ("investigate why
this job failed and summarise the cause"). For a single prompt-and-response, use
`openai.chat.completions` instead — an agent loop is slower and more expensive.

:::warning Deny-by-default, and enabled per deployment
The agent starts with **no capabilities**. Every tool must be granted explicitly under
`capabilities`. The activity also refuses to run unless the worker sets
`MOCO_CLAUDE_AGENT_ENABLED=true`.

This matters because the agent reads content you do not control (web pages, documents, tool
output) and then acts with the *calling user's* privileges. Grant the smallest set of tools the
task needs.
:::

```yaml
- activity:
    type: claude_agent.query
    name: investigate
    input_data:
      apikey_secret_key: "global/ANTHROPIC_API_KEY"
      prompt: |
        Find out what https://api.github.com/zen returns and summarise it.
      capabilities:
        # Moco activities exposed to the agent as tools. They run through the normal
        # providers under the calling user, so the agent can never exceed that user's
        # own privileges.
        moco_tools:
          - http.request
      max_turns: 8
      max_tool_calls: 5
      timeout_sec: 300
      relay_topic: agent.progress      # optional: stream progress as workflow events
      relay_granularity: turn
    output_name: investigation
```

Key output fields: `result` (the answer), `num_turns`, `total_cost_usd`, `tool_calls`,
`denied_tools`, `timed_out`. A successful run with a non-empty `denied_tools` usually means the
capability grant was too narrow for the prompt.

**Capabilities**

| Field | Purpose |
|---|---|
| `builtin_tools` | Claude Code built-ins, e.g. `["Read", "Grep", "Glob"]`. Tools not listed do not exist in the agent's context. |
| `moco_tools` | Moco activity types exposed as `mcp__moco__<name>` tools. |
| `mcp_servers` / `mcp_tools` | External MCP servers (remote `http`/`sse` only) and the tools allowed from them. |
| `plugins` / `skills` | Claude Agent plugins installed on the worker, and the skills to enable. See below. |

Granting `Bash`, `Write`, `Edit` or `NotebookEdit` requires elevated authorization — those either
execute arbitrary code or mutate the filesystem, and `Bash` can read the agent's own process
environment.

Secret, state, deploy, shell and workflow-execution activities can never be bridged, at any
privilege level. External MCP servers must be remote; stdio servers are rejected because their
config is arbitrary process spawn on the worker. Credentials for remote servers go in
`headers_secret_key`, naming a secret that holds a JSON object of headers.

**Plugins**

A [Claude Agent plugin](https://code.claude.com/docs/en/plugins) bundles skills, commands,
subagents and hooks. Plugins are baked into the worker image and discovered from
`MOCO_CLAUDE_AGENT_PLUGIN_ROOT` — every immediate subdirectory of that root is one available
plugin. A workflow selects among them **by name**; it can never supply a path.

```yaml
capabilities:
  plugins:
    - deployment-tools          # name from the deployment's catalog
  skills:
    - deployment-tools:rollback # <plugin-name>:<skill-name>
```

The plugin's name is the `name` in its `.claude-plugin/plugin.json`, falling back to its directory
name. Ask your operator which plugins are installed; naming one that is not produces an error
listing what is available.

Granting a skill implies the `Skill` tool, so you do not need to add it to `builtin_tools`.

:::danger Plugins run code on the worker
A plugin's hooks execute shell commands on lifecycle events, **outside the tool permission
system** — they fire even for an agent granted no tools at all. Loading a plugin is therefore
equivalent to granting code execution, and requires the same elevated authorization as `Bash`.

Select no plugins (the default) and no plugin code runs.
:::

:::note Plugin MCP servers are not available
MCP servers declared inside a plugin's `.mcp.json` are deliberately suppressed: surfacing them
would require handing the agent the complete built-in tool set, including `Bash`. Declare the
server under `capabilities.mcp_servers` instead.
:::

:::note No session resumption
Each run gets a private temporary working directory that is deleted afterwards, and the CLI keys
its session transcripts to that directory on local disk. Sessions therefore cannot be resumed
across activity runs. Model a multi-turn conversation by looping in the workflow and passing prior
context back through `prompt`.
:::

A runnable example lives in `moco-examples/claude-agent-demo/`.

## Config vs Input Data

Activities support two types of parameters:

### config_data (Static)

Evaluated once at workflow start. Use for:
- API endpoints
- Credentials
- Fixed configuration

```yaml
- activity:
    type: custom.data_processor
    config_data:
      endpoint: https://processor.example.com
      api_key: "{{ env.API_KEY }}"
      timeout: 60
    input_data:
      data: "{{ batch_data }}"
```

### input_data (Dynamic)

Evaluated each time the activity executes. Use for:
- Request parameters
- Data to process
- Dynamic values

```yaml
- iteration:
    input_data: "{{ user_ids }}"
    body:
      activity:
        type: fetch.user
        config_data:
          api_base: https://api.example.com
        input_data:
          user_id: "{{ iter_item }}"  # Different each iteration
        output_name: user
```

## Retry and Timeout

### Timeout

Set maximum execution time:

```yaml
- activity:
    type: builtin.http_request
    input_data:
      url: https://slow-api.com/data
    retry_policy:
      timeout_sec: 10   # Timeout after 10 seconds
    output_name: result
```

### Retry

Configure automatic retries on failure:

```yaml
- activity:
    type: builtin.http_request
    input_data:
      url: https://unreliable-api.com/data
    retry_policy:
      max_attempts: 5          # Total attempts (initial + retries)
      timeout_sec: 10          # Per-attempt timeout
    output_name: result
```

Retry behavior:
- Initial attempt + retries = total attempts
- Exponential backoff between retries
- Failures are logged
- Final failure propagates to workflow

## Caching

Enable caching to avoid redundant executions:

```yaml
- activity:
    type: builtin.http_request
    input_data:
      url: https://api.example.com/reference-data
    enable_cache: true
    cache_policy:
      ttl_seconds: 3600           # Cache for 1 hour
      cache_key: "ref-data-{{ date }}"
    output_name: cached_data
```

**Cache benefits:**
- Reduce API calls
- Improve performance
- Lower costs
- Consistent data within TTL

## Local Execution

Force activities to run in the workflow process (bypass Temporal workers):

```yaml
- activity:
    type: builtin.delay
    input_data:
      duration: 1s
    execute_locally: true    # Run in workflow process
```

**Use for:**
- Very fast operations (< 1ms)
- Operations that don't benefit from retries
- Reducing worker overhead
- Testing/debugging

**Caution:** Local activities:
- Don't get automatic retries
- Run in workflow process (blocking)
- Can impact workflow performance

### Activities that are already local by default

Some activities set `execute_locally` for you, so you don't have to write it. Short built-ins
like `builtin.now` and `builtin.delay` do it because a queue round trip would cost more than
the work itself.

**All browser automation activities — every `selenium.*` and `playwright.*` type — default to
local execution**, and for a different reason: they need to stay on the same worker as the
workflow.

A browser session belongs to the process that opened it. The `session_id` you get back from
`browser.create` is only meaningful there, so if `nav.goto` or `element.click` ran somewhere
else, they would not find the browser. Running these activities locally keeps a whole
session — from `browser.create` to `browser.close` — on one worker, so a multi-step browser
script works the way you'd expect:

```yaml
- activity:
    type: playwright.browser.create      # execute_locally is already true
    input_data:
      browser_type: chromium
    output_name: session

- activity:
    type: playwright.page.goto           # runs on the same worker as above
    input_data:
      session_id: "{{ session['session_id'] }}"
      url: https://example.com

- activity:
    type: playwright.browser.close
    input_data:
      session_id: "{{ session['session_id'] }}"
```

**Don't set `execute_locally: false` on a browser activity.** The workflow will still validate
and start, but the session will no longer be pinned to one worker and any step after
`browser.create` can fail with an unknown session.

## Output Transformation

Transform activity results before storing:

```yaml
- activity:
    type: builtin.http_request
    input_data:
      url: https://api.example.com/users
    output_data:
      - users: "{{ _raw_output }}"           # Raw response
      - user_count: "{{ len(users) }}"       # Derived value
      - first_user: "{{ users[0] if users else None }}"
    output_name: result
```

The transformed data is stored in `result`:
```python
{
  "users": [...],
  "user_count": 5,
  "first_user": {...}
}
```

## Custom Activities

Create custom activities for your specific needs:

### 1. Define Activity Provider

```python
from moco.core.workflow.activity.activity_types import IActivityProvider

class EmailActivityProvider(IActivityProvider):
    async def execute(
        self,
        config_data: dict,
        input_data: dict,
        context: dict
    ) -> dict:
        # Send email
        to = input_data['to']
        subject = input_data['subject']
        body = input_data['body']

        # ... email sending logic ...

        return {
            'sent': True,
            'message_id': 'msg-12345'
        }

    def get_manifest(self) -> dict:
        return {
            'type': 'myorg.send_email',
            'version': '1.0.0',
            'description': 'Send email via SMTP',
            'input_schema': {
                'to': {'type': 'string', 'required': True},
                'subject': {'type': 'string', 'required': True},
                'body': {'type': 'string', 'required': True},
            }
        }
```

### 2. Register Activity

```python
from moco.core.workflow.activity.activity_directory import ActivityDirectory

activity_dir = ActivityDirectory()
activity_dir.register_provider('myorg.send_email', EmailActivityProvider())
```

### 3. Use in Workflow

```yaml
- activity:
    type: myorg.send_email
    version: 1.0.0
    config_data:
      smtp_host: smtp.example.com
      smtp_port: 587
    input_data:
      to: "{{ customer.email }}"
      subject: "Order Confirmation #{{ order_id }}"
      body: "{{ email_template }}"
    output_name: email_result
```

## Activity Best Practices

### Error Handling

```yaml
# Provide meaningful timeout
- activity:
    type: external.api
    input_data:
      url: "{{ endpoint }}"
    retry_policy:
      timeout_sec: 30
      max_attempts: 3
    output_name: result

# Check for errors
- abort:
    condition: "{{ not result.success }}"
    type: raise
    message: "API call failed: {{ result.error }}"
```

### Idempotency

Design activities to be idempotent (safe to retry):

```python
async def execute(self, config_data, input_data, context):
    # Check if already processed
    order_id = input_data['order_id']
    if await self.is_processed(order_id):
        return await self.get_previous_result(order_id)

    # Process order
    result = await self.process_order(order_id)

    # Store result
    await self.save_result(order_id, result)

    return result
```

### Use config_data for Static Values

```yaml
# Good: Static values in config_data
- activity:
    config_data:
      api_base: https://api.example.com
      api_key: "{{ env.API_KEY }}"
    input_data:
      user_id: "{{ user_id }}"  # Dynamic per execution

# Bad: Everything in input_data
- activity:
    input_data:
      api_base: https://api.example.com  # Same every time
      api_key: "{{ env.API_KEY }}"      # Same every time
      user_id: "{{ user_id }}"
```

### Appropriate Timeouts

```yaml
# Fast operations
- activity:
    type: builtin.delay
    input_data:
      duration: 1s
    retry_policy:
      timeout_sec: 2

# Slow operations
- activity:
    type: data.process_large_file
    input_data:
      file_path: "{{ file }}"
    retry_policy:
      timeout_sec: 300      # 5 minutes
```

## Next Steps

- [State Machines Reference](../reference/state-machines.md)
- [Events Reference](../reference/events.md)
- [Creating Custom Activities Guide](../guides/creating-activities.md)
