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
    type: http.request      # Activity type identifier
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
| `type` | string | Activity type identifier (e.g., "http.request") |

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
| `async_mode` | boolean | Start the activity and continue without waiting — see [`async_mode`](#fire-and-forget-async_mode) |
| `async_event_topic` | string | Topic the completion event is published to when `async_mode` is set (default: `default`) |
| `name` | string | Names the step. Required to mock it in a [test](../guides/testing.md#mocking) |
| `condition` | expression | Skip the activity when this is falsy |

## Built-in Activities

Moco ships 183 activities across 20 providers — HTTP, shell, SQL, email, Kafka, RabbitMQ, Google
Drive, Kubernetes, browser automation, LLM and RAG activities, and the platform's own state,
secret and deployment activities. The [Activity Catalog](../reference/activity-catalog.md) indexes every one
of them, and each provider has a reference page giving the input and output contract of its
activities with worked examples.

A few you will reach for constantly:

### HTTP Request

Make HTTP requests to external APIs — see [HTTP Activities](../reference/activities/http.md):

```yaml
# GET request
- activity:
    type: http.request
    input_data:
      method: GET
      url: https://api.example.com/data?limit=10&offset=0
      headers:
        Accept: application/json
      output_json: true
    output_name: api_response
    retry_policy:
      timeout_sec: 30
```

```yaml
# POST request with JSON body
- activity:
    type: http.request
    input_data:
      method: POST
      url: https://api.example.com/orders
      json_data:
        order_id: "{{ order_id }}"
        items: "{{ items }}"
        total: "{{ total }}"
    output_name: create_response
```

### Delay

Pause workflow execution — see [Built-in Core](../reference/activities/builtin-core.md):

```yaml
- activity:
    type: builtin.delay
    input_data:
      duration: 5s      # seconds: 5s, minutes: 5min, hours: 1h30m
```

### State Persistence

Store and retrieve values that outlive a single run — see
[State Store](../reference/activities/state.md):

```yaml
# Save state
- activity:
    type: builtin.state.set_state
    input_data:
      namespace: "user-preferences"
      key: "{{ user_id }}"
      value:
        theme: dark
        notifications: true

# Load state
- activity:
    type: builtin.state.get_state
    input_data:
      namespace: "user-preferences"
      key: "{{ user_id }}"
    output_name: preferences
```

### Secret Management

Access secrets securely. Plaintext secrets never travel between activities.

Most activities that need a secret take a **secret key** instead of the secret itself — for
example `openai.chat.completions.apikey_secret_key`, `email.send.password_secret_key` or
`sql.query.connection_string_secret_key`. The activity looks the secret up and decrypts it
internally, so nothing sensitive touches workflow context at all. A bare `NAME` resolves a
user-scoped secret; `global/NAME` resolves a global one.

Where an activity does not yet support that (for example `http.request.encrypted_auth_token`), use
`builtin.secret.get`, which returns the secret **still encrypted** — pass that blob straight to the
activity, which decrypts it internally.

```yaml
- activity:
    type: builtin.secret.get
    input_data:
      secret_name: database_password
      in_global_ns: false      # optional; true reads the shared global namespace
      expiration_seconds: 60   # optional; defaults to 60
    output_name: db_password
```

The returned secret **expires after `expiration_seconds`**, so a long-running workflow must re-run
`builtin.secret.get` rather than holding the result. The full list of secret-bearing fields, the
encryption model and the reserved-namespace rules are in
[Secret Activities](../reference/activities/secret.md).

### AI and retrieval

`openai.chat.completions` runs a single prompt-and-response; `claude_agent.query` runs an
autonomous multi-turn agent with explicitly granted tools; the `llama_index.*` activities build and
query a vector index over your own documents so an LLM can answer from them. See
[OpenAI](../reference/activities/openai.md),
[Claude Agent](../reference/activities/claude-agent.md) and
[LlamaIndex](../reference/activities/llama-index.md), with runnable examples in
`moco-examples/openai-demo/`, `moco-examples/claude-agent-demo/` and `moco-examples/rag-demo/`.

### Files, messaging and browsers

`gdrive.*` reads and writes Google Drive files; `kafka.*`, `rabbit.*`, `graphql.subscribe` and
`websocket.subscribe` connect a workflow to message buses and live feeds; `playwright.*` and
`selenium.*` drive a real browser. See
[Google Drive](../reference/activities/gdrive.md),
[Kafka](../reference/activities/kafka.md), [RabbitMQ](../reference/activities/rabbit.md) and
[Playwright](../reference/activities/playwright.md).

## Config vs Input Data

Activities support two types of parameters:

### config_data (Static)

Evaluated once at workflow start. Use for:
- API endpoints
- Credentials
- Fixed configuration

```yaml
- activity:
    type: sql.query
    config_data:
      connection_string_secret_key: ANALYTICS_DB      # same every run
    input_data:
      query: "SELECT * FROM orders WHERE id = {{ order_id }}"
```

Note what is *not* in `config_data`: the connection string itself. Credentials are referenced by
secret key and resolved inside the activity — see [Secret Management](#secret-management).

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
    type: http.request
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
    type: http.request
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
    type: http.request
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
script works the way you'd expect.

**Don't set `execute_locally: false` on a browser activity.** The workflow will still validate
and start, but the session will no longer be pinned to one worker and any step after
`browser.create` can fail with an unknown session. See
[Playwright](../reference/activities/playwright.md) and
[Selenium](../reference/activities/selenium.md) for the full session model.

Conversely, an activity served by a *different* worker type can never run locally.
[`claude_agent.query`](../reference/activities/claude-agent.md) is the only one today: it runs on
the `agent` worker, so `execute_locally` has no effect on it.

## Output Transformation

Transform activity results before storing:

```yaml
- activity:
    type: http.request
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

## Fire-and-forget: `async_mode`

By default a workflow waits for each activity to finish. Set `async_mode: true` and it starts the
activity and moves on:

```yaml
- activity:
    name: slow_report
    type: shell.run
    async_mode: true
    input_data:
      command: ./build-report.sh
    output_name: report_token
```

The activity's "output" is immediately a **token** string, not the result. Later — possibly much
later, possibly in a different branch — you collect the real result by waiting for an event whose
type is that token:

```yaml
- wait_for:
    event:
      event_type: "{{ report_token }}"
    output_name: report
```

The token is unique per invocation, so the same activity running in a loop or a re-entered state
never collides with itself. Event metadata carries `status` (`completed` or `failed`), `error`, and
the activity name and run ID.

Point `async_event_topic` at a state machine's `event_source_topic` and the activity's completion
drives a transition directly — the usual way to let slow work advance an event-driven workflow.

Waiting is optional: ignoring the token is plain fire-and-forget. Two caveats, though. A completion
event is consumed by the first matching waiter, and in-flight completions do not survive a
`continue_as_new_checkpoint`. And an activity still running when the workflow completes is
cancelled — for work that must outlive the workflow, use a detached child workflow instead.

## What if no built-in activity fits?

The [Activity Catalog](../reference/activity-catalog.md) covers most integration needs, and it is
worth checking before concluding it does not. In particular:

- `http.request` and `graphql.query` reach any HTTP or GraphQL service
- `shell.run` runs a command on the worker
- `sql.query` talks to any database with a connection string
- `mcp.*` calls tools on an MCP server

Between them, most "I need a custom activity" cases turn out to be an HTTP call. Wrapping that call
in a child workflow gives you a named, versioned, reusable unit that other workflows can compose —
usually a better answer than new platform code, because you can release it yourself.

When you genuinely need a new activity type in the platform — a new protocol, a native SDK, or
something that must run inside a worker — that is a change to Moco itself, not to a workflow. It is
documented for platform developers in `moco-core/docs/creating-activity-providers.md`.

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

### Assume Activities Can Run Twice

With `max_attempts` above 1, a retried activity runs again — and a transient failure can happen
*after* the work succeeded but before the result got back. Prefer operations that tolerate that:

```yaml
# Safer: PUT is idempotent, the same call twice leaves the same state
- activity:
    type: http.request
    input_data:
      method: PUT
      url: "https://api.example.com/orders/{{ order_id }}"
      json_data: "{{ order }}"
    retry_policy:
      max_attempts: 3

# Riskier: POST may create two orders. Send an idempotency key, or set max_attempts: 1
- activity:
    type: http.request
    input_data:
      method: POST
      url: https://api.example.com/orders
      headers:
        Idempotency-Key: "{{ order_id }}"
      json_data: "{{ order }}"
    retry_policy:
      max_attempts: 3
```

### Use config_data for Static Values

```yaml
# Good: what never varies goes in config_data
- activity:
    type: http.request
    config_data:
      base_url: https://api.example.com
    input_data:
      path: "/users/{{ user_id }}"   # varies per execution

# Bad: everything in input_data, re-evaluated every call
- activity:
    type: http.request
    input_data:
      base_url: https://api.example.com   # same every time
      path: "/users/{{ user_id }}"
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

- [Activity Catalog](../reference/activity-catalog.md) — every activity, by provider
- [Statements Reference](../reference/statements.md) — the `activity` statement's full field list
- [State Machines Reference](./state-machines.md)
- [Events Reference](./events.md)
