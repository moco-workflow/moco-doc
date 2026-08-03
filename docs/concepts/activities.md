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
    timeout_sec: 30                  # Execution timeout
    max_retry_attempts: 3            # Retry on failure
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
| `timeout_sec` | integer | Execution timeout in seconds |
| `max_retry_attempts` | integer | Number of retries on failure |
| `execute_locally` | boolean | Force local execution (bypass Temporal) |
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

Access secrets securely:

```yaml
- activity:
    type: builtin.secret.get
    input_data:
      secret_name: database_password
      version: latest
    output_name: db_password
```

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
    timeout_sec: 10     # Timeout after 10 seconds
    output_name: result
```

### Retry

Configure automatic retries on failure:

```yaml
- activity:
    type: builtin.http_request
    input_data:
      url: https://unreliable-api.com/data
    max_retry_attempts: 5       # Try up to 5 times
    timeout_sec: 10             # Per-attempt timeout
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
    timeout_sec: 30
    max_retry_attempts: 3
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
    timeout_sec: 2

# Slow operations
- activity:
    type: data.process_large_file
    input_data:
      file_path: "{{ file }}"
    timeout_sec: 300        # 5 minutes
```

## Next Steps

- [State Machines Reference](../reference/state-machines.md)
- [Events Reference](../reference/events.md)
- [Creating Custom Activities Guide](../guides/creating-activities.md)
