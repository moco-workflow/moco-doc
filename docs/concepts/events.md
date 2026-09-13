---
sidebar_label: Events
sidebar_position: 4
---

# Events Reference

Moco supports event-driven workflows through two complementary statements: `emit_event` (send) and `wait_for` (receive). Events enable coordination between concurrent workflows, signal state machine transitions, and implement multi-agent patterns.

For full workflowspec context, see the [Workflowspec Reference](./workflowspec.md).

---

## emit_event

Sends an event to the event bus.

```yaml
- emit_event:
    input_data:
      topic: notification_events
      data:
        type: order_created
        order_id: "{{ order_id }}"
        timestamp: "{{ __sys_info__.timestamp }}"
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `topic` | string | Yes | Event topic |
| `data` | object | Yes | Event payload |
| `event_type` | string | No | Event type for filtering and routing |
| `target_workflow_id` | string | No | Route event to a specific workflow |
| `metadata` | object | No | Additional event metadata |
| `entity_child_workflow` | object | No | Start-or-signal entity child workflow (see below) |

### Targeting a Specific Workflow

Use `target_workflow_id` to send events directly to another workflow instance rather than broadcasting on the topic:

```yaml
- emit_event:
    input_data:
      topic: child_events
      target_workflow_id: "{{ parent_workflow_id }}"
      event_type: child_complete
      data:
        result: "{{ processing_result }}"
```

The target workflow must be listening on the same topic with a matching `wait_for` or state machine transition. Put the discriminator in `event_type` (not inside `data`) — that is the field both `wait_for`'s `event.event_type` filter and a transition trigger match on.

### Entity Child Workflow (Start-or-Signal)

Use `entity_child_workflow` to ensure a target entity child workflow is running before sending the event. If the child isn't running, it is started first; if already running, the event is delivered directly.

```yaml
- emit_event:
    entity_child_workflow:
      wfspec:                           # required, same as workflow statement
        name: "order-entity"
        version: "1.0.0"              # optional
      input_data:                     # optional, passed to child on start
        order_id: "{{ order_id }}"
      child_mode: "async"             # "async" (default) or "detached"
    input_data:
      topic: "order_events"
      event_type: "add_item"
      target_workflow_id: "order-entity:{{ order_id }}"
      data:
        sku: "{{ item_sku }}"
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `wfspec` | object | required | Workflow spec info (name, version, content) — same as `workflow` statement |
| `input_data` | object | null | Input data for the child workflow |
| `child_mode` | string | "async" | "async" or "detached" |

Requires the Temporal runtime (`break_away_child_workflow_client`).

### Event Metadata

```yaml
- emit_event:
    input_data:
      topic: analytics_events
      data:
        action: page_view
        page: /products
      metadata:
        priority: low
        source: web_app
```

---

## wait_for

Waits until an event matching the filter arrives, or until the timeout expires.

```yaml
- wait_for:
    event:
      topic: order_events
      match_expression: "{{ event.data.get('order_id') == order_id }}"
    timeout_sec: 60
    output_name: received_event
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `event.topic` | string | Yes | Event topic to subscribe to |
| `event.event_type` | expression | No | Only events with this exact type match. Also used to collect an [async activity result](#async-activity-results) |
| `event.match_expression` | expression | No | Python expression that must be truthy for an event to match |
| `timeout_sec` | integer | Yes | Maximum wait time in seconds |
| `output_name` | string | No | Variable to store the received event |

### Event Object Structure

Inside `match_expression`, the `event` variable has this structure:

```python
{
  "data": {...},          # Event payload (from emit_event data)
  "topic": "...",         # Event topic
  "event_type": "...",    # Event type
  "event_id": "...",      # Unique event id
  "source": "...",        # Workflow that emitted the event
  "timestamp": ...,       # When the event was published
  "metadata": {...}       # Event metadata
}
```

### Filtering Events

Use `match_expression` to select only events that meet specific criteria:

```yaml
- wait_for:
    event:
      topic: payment_events
      match_expression: >
        {{ event.data.get('transaction_id') == transaction_id and
           event.data.get('status') == 'completed' }}
    timeout_sec: 120
    output_name: payment_event
```

### Timeout Only

Omit `event` to use `wait_for` as a simple delay:

```yaml
- wait_for:
    timeout_sec: 30
```

---

## Async Activity Results

An activity with `async_mode: true` is started without blocking. Instead of its result it
returns a **token**, and when it finishes the engine publishes its result to the event bus as an
ordinary event whose `event_type` is that token. This lets a long-running activity overlap with
the rest of the workflow, and its result be collected later.

The token is `async-activity:<activity name>:<run id>` — unique per invocation, so starting the
same activity twice yields two tokens whose completions cannot be confused. Because it is not
knowable in advance, capture it with `output_name` and reference it as an expression.

```yaml
- activity:
    name: fetch_prices                 # token: "async-activity:fetch_prices:<run id>"
    type: http.request
    async_mode: true
    async_event_topic: default         # optional; where the completion is published
    output_name: fetch_token
```

### The completion event

```python
{
  "topic": "default",                            # async_event_topic
  "event_type": "async-activity:fetch_prices:6f1c0f2a-...",   # the token
  "data": {...},                                 # activity output (None if it failed)
  "source": "...",                               # the workflow id
  "metadata": {
    "workflow_id": "...",
    "async_activity": True,
    "activity_type": "http.request",
    "activity_name": "fetch_prices",
    "run_id": "6f1c0f2a-...",                    # the token's suffix
    "status": "completed",                       # or "failed"
    "error": "...",                              # only when status is "failed"
  },
}
```

### Collecting it with `wait_for`

```yaml
- wait_for:
    event:
      event_type: "{{ fetch_token }}"
    timeout_sec: 30
    output_name: prices                # prices['data'] is the activity output
```

### Driving a state machine transition

Because the completion is a normal event, it can trigger a transition. The token is unique per
invocation, so the trigger references it as an
[expression](./state-machines.md#expression-triggers) — `event_type` is re-resolved against the
workflow context on every incoming event.

This is ordering-safe as long as the activity is started from the machine's `on_enter`: the
machine subscribes its topic before starting, and `on_enter` is awaited to completion before the
event loop dequeues its first event, so `fetch_token` is set before the completion can arrive.

```yaml
- state_machine:
    event_source_topic: work_events
    initial_state: fetching
    states:
      - name: fetching
        on_enter:
          activity:
            name: fetch_prices
            type: http.request
            async_mode: true
            async_event_topic: work_events       # == event_source_topic
            output_name: fetch_token             # capture the token
      - name: ready
        is_terminal: true
    transitions:
      - from_state: fetching
        to_state: ready
        trigger:
          event_type: "{{ fetch_token }}"
          action:                                # `event` is in scope here
            transform:
              output_data:
                - prices: "{{ event['data'] }}"
```

### Notes and limitations

- **Waiting is optional.** Ignore the token and `async_mode` is plain fire-and-forget.
- **Failure does not raise.** Check `event['metadata']['status']` and branch on it; `wait_for`
  returns `None` on timeout as usual.
- **Consume-once.** The first matching waiter takes the event; a second `wait_for` on the same
  token times out.
- **Start inside the machine.** A state machine subscribes to its topic only when it starts, so
  start async activities from `on_enter`, not before the machine.
- **Not durable across `continue_as_new`.** In-flight completions are lost at a checkpoint.
- **Temporal.** An activity still running when the workflow completes is cancelled. For work
  that must outlive the workflow, use `emit_event` or a break-away child workflow.

---

## State Machine Events

Events are the primary trigger mechanism for [state machines](./state-machines.md). A state's `on_enter` callback typically does work and emits an event that drives the next transition:

```yaml
states:
  - name: processing
    on_enter:
      sequence:
        elements:
          - activity:
              type: process-payment
              input_data:
                order: "{{ order_data }}"
              output_name: payment_result
          - emit_event:
              input_data:
                topic: order_events
                event_type: "{{ 'payment_complete' if payment_result.success else 'payment_failed' }}"

transitions:
  - from_state: processing
    to_state: completed
    trigger:
      event_type: payment_complete

  - from_state: processing
    to_state: failed
    trigger:
      event_type: payment_failed
```

---

## Multi-Agent Pattern

Coordinate multiple child workflows using events.

**Parent workflow** — starts child workflows and collects results:

```yaml
wfspec_name: parent-orchestrator
wfspec_version: 1.0.0

context:
  child_workflow_ids: []

body:
  sequence:
    elements:
      - iteration:
          iter_type: parallel
          input_data: "{{ agent_configs }}"
          body:
            sequence:
              elements:
                - workflow:
                    wfspec:
                      name: child-agent
                      version: 1.0.0
                    child_mode: async
                    execute_options:
                      workflow_id: "child-{{ iter_item.agent_id }}"
                    input_data:
                      config: "{{ iter_item }}"
                      parent_workflow_id: "{{ __sys_info__.workflow_id }}"
                    output_name: child_info
                - transform:
                    output_data:
                      - _tmp: "{{ child_workflow_ids.append(child_info.workflow_id) }}"

      - iteration:
          iter_type: sequence
          input_data: "{{ child_workflow_ids }}"
          body:
            wait_for:
              event:
                topic: child_events
                match_expression: >
                  {{ event['event_type'] == 'complete' and
                     event['source'] == iter_item }}
              timeout_sec: 300
              output_name: child_result
```

**Child workflow** — does work and signals the parent:

```yaml
wfspec_name: child-agent
wfspec_version: 1.0.0

input_data:
  config:
  parent_workflow_id:

body:
  sequence:
    elements:
      - activity:
          type: process-data
          input_data:
            config: "{{ config }}"
          output_name: result

      - emit_event:
          input_data:
            topic: child_events
            target_workflow_id: "{{ parent_workflow_id }}"
            event_type: complete
            data:
              result: "{{ result }}"
```

---

## Next Steps

- [State Machines Reference](./state-machines.md) — event-driven FSM patterns
- [Statements Reference](../reference/statements.md) — full `emit_event` and `wait_for` parameter reference
- [Workflowspec Reference](./workflowspec.md) — complete technical reference
