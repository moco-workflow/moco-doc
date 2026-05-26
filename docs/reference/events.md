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
| `target_workflow_id` | string | No | Route event to a specific workflow |
| `metadata` | object | No | Additional event metadata |

### Targeting a Specific Workflow

Use `target_workflow_id` to send events directly to another workflow instance rather than broadcasting on the topic:

```yaml
- emit_event:
    input_data:
      topic: child_events
      target_workflow_id: "{{ parent_workflow_id }}"
      data:
        event_name: child_complete
        result: "{{ processing_result }}"
```

The target workflow must be listening on the same topic with a matching `wait_for` or state machine transition.

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
| `event.match_expression` | expression | No | Python expression that must be truthy for an event to match |
| `timeout_sec` | integer | Yes | Maximum wait time in seconds |
| `output_name` | string | No | Variable to store the received event |

### Event Object Structure

Inside `match_expression`, the `event` variable has this structure:

```python
{
  "data": {...},               # Event payload (from emit_event data)
  "topic": "...",              # Event topic
  "source_workflow_id": "...", # Workflow that emitted the event
  "metadata": {...}            # Event metadata
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
                data:
                  event_name: "{{ 'payment_complete' if payment_result.success else 'payment_failed' }}"

transitions:
  - from_state: processing
    to_state: completed
    trigger:
      event_name: payment_complete

  - from_state: processing
    to_state: failed
    trigger:
      event_name: payment_failed
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
                  {{ event.data.get('event_name') == 'complete' and
                     event.source_workflow_id == iter_item }}
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
            data:
              event_name: complete
              result: "{{ result }}"
```

---

## Next Steps

- [State Machines Reference](./state-machines.md) — event-driven FSM patterns
- [Statements Reference](./statements.md) — full `emit_event` and `wait_for` parameter reference
- [Workflowspec Reference](./workflowspec.md) — complete technical reference
