---
sidebar_label: Statements
sidebar_position: 2
---

# Statements Reference

Statements are the building blocks of Moco workflows. Every `body` in a workflowspec is a statement. Statements fall into two categories: **primitives** (leaf nodes that do work) and **composites** (containers that orchestrate other statements).

For full workflowspec context, see the [Workflowspec Reference](./workflowspec.md).

## Common Parameters

All statements support these optional parameters:

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | string | Unique identifier for the statement |
| `description` | string | Human-readable description |
| `condition` | expression or list | Skip this statement if the expression is falsy |
| `output_name` | string | Variable to store the statement result |
| `output_data` | list | Data transformations to apply after execution |

---

## Primitive Statements

### transform

Evaluates expressions and assigns variables. The primary way to compute or reshape data.

```yaml
- transform:
    input_data:
      - temp: "{{ price * 1.08 }}"
    output_data:
      - total: "{{ temp }}"
      - message: "Total is {{ total }}"
```

| Parameter | Description |
|-----------|-------------|
| `input_data` | Variable assignments evaluated before `output_data` |
| `output_data` | Main transformation assignments |

---

### abort

Terminates or breaks execution with different behaviors.

```yaml
- abort:
    condition: "{{ price < 0 }}"
    type: raise
    message: "Invalid price: {{ price }}"
```

| Type | Behavior |
|------|----------|
| `abort` | Abort the entire workflow |
| `terminate` | Gracefully terminate the workflow |
| `break` | Break out of the current sequence or parallel block |
| `break_iteration` | Break out of the current iteration loop |
| `raise` | Raise an error and fail the workflow |

---

### activity

Executes a registered activity (HTTP call, database query, custom function, etc.).

```yaml
- activity:
    type: builtin.http_request
    input_data:
      method: POST
      url: https://api.example.com/orders
      body:
        order_id: "{{ order_id }}"
    output_name: api_response
    timeout_sec: 30
    max_retry_attempts: 3
```

| Parameter | Description |
|-----------|-------------|
| `type` | Activity type identifier (required) |
| `version` | Activity version (default: `1.0.0`) |
| `config_data` | Static configuration, evaluated once at workflow start |
| `input_data` | Dynamic input, evaluated each time the activity runs |
| `output_name` | Variable to store the activity result |
| `timeout_sec` | Execution timeout in seconds |
| `max_retry_attempts` | Number of retries on failure |
| `execute_locally` | Force local execution, bypassing Temporal |
| `enable_cache` | Enable result caching |
| `cache_policy` | Cache configuration (TTL, key) |

Built-in activities: `builtin.delay`, `builtin.now`, `builtin.execute_workflow`.

---

### workflow

Executes a child workflow by reference or inline definition.

```yaml
- workflow:
    wfspec:
      name: process-order
      version: 1.0.0
    child_mode: sync
    input_data:
      order_id: "{{ order_id }}"
    output_name: order_result
```

| Child Mode | Behavior |
|------------|----------|
| `inline` | Runs in the parent's context, shares variables (default) |
| `sync` | Runs independently; parent waits for the result |
| `async` | Runs independently; parent waits only for start, gets `workflow_id` |
| `detached` | Runs completely independently; parent doesn't wait |

To define a workflow inline instead of by name:

```yaml
- workflow:
    wfspec:
      content:
        wfspec_name: inline-helper
        wfspec_version: 1.0.0
        input_data:
          x:
        output_name: result
        body:
          transform:
            output_data:
              - result: "{{ x * 2 }}"
    child_mode: inline
    input_data:
      x: 21
    output_name: doubled
```

---

### call

Invokes a [function](./workflowspec.md#functions) defined in the enclosing wfspec's
`functions` list. A `call` is a compact shorthand for a `workflow` statement running in
`inline` mode: the function executes in a fresh context and its return value is mapped back
via `output_name` / `output_data`.

```yaml
- call:
    function: add          # matches a `function` in the wfspec's `functions`
    input_data:
      a: 1
      b: 2
    output_name: result
```

| Parameter | Description |
|-----------|-------------|
| `function` | Name of the function to call (required) |
| `input_data` | Arguments passed to the function; supports expressions |
| `output_name` | Context variable to store the function's return value |
| `output_data` | Transform the return value (`_raw_output` holds the raw return) |
| `condition` | Pre-condition; the call is skipped when it evaluates to false |

Functions may call sibling functions defined in the same wfspec. Recursion (a function
calling itself, directly or indirectly) is **not** supported — it is rejected by the cyclic
call-stack guard.

---

### wait_for

Waits for an event matching filter criteria, or until a timeout.

```yaml
- wait_for:
    event:
      topic: order_events
      match_expression: >
        {{ event.data.get('order_id') == order_id and
           event.data.get('status') == 'completed' }}
    timeout_sec: 60
    output_name: completion_event
```

| Parameter | Description |
|-----------|-------------|
| `event.topic` | Event topic to subscribe to |
| `event.match_expression` | Python expression to filter incoming events (`event` variable is the event object) |
| `timeout_sec` | Maximum wait time in seconds (required) |
| `output_name` | Variable to store the received event |

---

### emit_event

Emits an event to the event bus.

```yaml
- emit_event:
    input_data:
      topic: notification_events
      data:
        type: order_created
        order_id: "{{ order_id }}"
      target_workflow_id: "{{ parent_id }}"
      metadata:
        priority: high
```

| Parameter | Description |
|-----------|-------------|
| `topic` | Event topic (required) |
| `data` | Event payload (required) |
| `target_workflow_id` | Route the event to a specific workflow (optional) |
| `metadata` | Additional event metadata (optional) |

---

### continue_as_new_checkpoint

Checks whether the runtime suggests restarting the workflow (e.g., Temporal event history nearing its size limit). If suggested, serializes workflow state and restarts execution from the beginning with the preserved state.

This is a no-op in the in-memory runtime. In Temporal, it triggers a continue-as-new when the SDK signals that history is getting large.

```yaml
- continue_as_new_checkpoint:
    name: checkpoint-after-processing
    serialize_data_context: true
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `name` | string | null | Optional identifier for logging |
| `serialize_data_context` | boolean | true | Whether to include data context variables in the serialized state |
| `condition` | expression | null | Skip this statement if the expression is falsy |

---

## Composite Statements

### sequence

Executes statements one after another.

```yaml
sequence:
  elements:
    - transform:
        output_data:
          - status: "validating"
    - activity:
        type: builtin.http_request
        input_data:
          url: https://api.example.com/validate
        output_name: validation
    - abort:
        condition: "{{ not validation.valid }}"
        type: raise
        message: "Validation failed"
```

---

### parallel

Executes statements concurrently with configurable join semantics.

```yaml
- parallel:
    join_type: and
    elements:
      - activity:
          name: fetch-user
          type: builtin.http_request
          input_data:
            url: https://api.example.com/users/{{ user_id }}
          output_name: user_data
      - activity:
          name: fetch-orders
          type: builtin.http_request
          input_data:
            url: https://api.example.com/orders?user={{ user_id }}
          output_name: order_data
```

| Join Type | Behavior |
|-----------|----------|
| `and` | All branches must succeed |
| `or` | At least one branch must succeed |

---

### iteration

Loops over a collection, either sequentially or in parallel.

```yaml
- iteration:
    iter_type: sequence
    input_data: "{{ items }}"
    body:
      activity:
        type: process-item
        input_data:
          item: "{{ iter_item }}"
```

| Parameter | Description |
|-----------|-------------|
| `iter_type` | `sequence` (sequential) or `parallel` (concurrent) |
| `input_data` | Collection to iterate over (list, `dict.items()`, `range()`, etc.) |
| `body` | Statement executed for each item |
| `join_type` | For parallel iteration: `and` or `or` |

Special variables available inside the body:
- `iter_item` — the current item
- `iter_items` — all items in the collection

Use `abort` with `type: break_iteration` to exit the loop early.

---

### state_machine

Event-driven finite state machine. See [State Machines Reference](./state-machines.md) for full documentation.

```yaml
- state_machine:
    name: order-fsm
    initial_state: pending
    timeout_sec: 300
    states:
      - name: pending
      - name: processing
      - name: completed
        is_terminal: true
    transitions:
      - from_state: pending
        to_state: processing
        trigger:
          event_name: start
```

---

## Next Steps

- [State Machines Reference](./state-machines.md) — detailed FSM documentation
- [Events Reference](./events.md) — event-driven workflow patterns
- [Workflowspec Reference](./workflowspec.md) — full technical reference including expressions, conditions, and complete examples
