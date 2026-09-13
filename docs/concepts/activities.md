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

## Built-in Activities

Moco ships 174 activities across 19 providers — HTTP, shell, SQL, email, Kafka, RabbitMQ, Google
Drive, browser automation, LLM and RAG activities, and the platform's own state, secret and
deployment activities. The [Activity Catalog](../reference/activity-catalog.md) indexes every one
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

- [Activity Catalog](../reference/activity-catalog.md) — every activity, by provider
- [State Machines Reference](./state-machines.md)
- [Events Reference](./events.md)
- [Creating Custom Activities Guide](../guides/creating-activities.md)
