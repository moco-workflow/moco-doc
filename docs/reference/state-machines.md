---
sidebar_label: State Machines
sidebar_position: 3
---

# State Machines Reference

The `state_machine` statement implements an event-driven finite state machine (FSM) inside a workflow. Use it when your workflow needs to wait for external events and transition between named states based on those events.

For full workflowspec context, see the [Workflowspec Reference](./workflowspec.md).

---

## Basic Structure

```yaml
- state_machine:
    name: order-fsm
    initial_state: pending
    timeout_sec: 300
    event_source_topic: order_events

    states:
      - name: pending
      - name: processing
      - name: completed
        is_terminal: true
      - name: failed
        is_terminal: true

    transitions:
      - from_state: pending
        to_state: processing
        trigger:
          event_name: start_processing

      - from_state: processing
        to_state: completed
        trigger:
          event_name: processing_complete

      - from_state: processing
        to_state: failed
        trigger:
          event_name: processing_failed
```

### Top-Level Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | string | Identifier for this state machine |
| `initial_state` | string | State to start in |
| `timeout_sec` | integer | Maximum total runtime before the machine times out |
| `event_source_topic` | string | Event topic to listen on for all transitions |
| `states` | list | State definitions |
| `transitions` | list | Transition rules between states |
| `global_triggers` | list | Transitions that apply from any state |

---

## States

### State Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | string | Unique state name |
| `is_terminal` | boolean | Mark as a final state; reaching it ends the machine |
| `timeout_sec` | integer | Maximum time to spend in this state |
| `on_enter` | statement | Executed when entering this state |
| `on_exit` | statement | Executed when leaving this state |

### State Callbacks

```yaml
states:
  - name: processing
    on_enter:
      sequence:
        elements:
          - transform:
              output_data:
                - entered_at: "{{ __sys_info__.timestamp }}"
          - activity:
              type: process-order
              input_data:
                order_id: "{{ order_id }}"
              output_name: process_result
          - emit_event:
              input_data:
                topic: order_events
                data:
                  event_name: "{{ 'processing_complete' if process_result.success else 'processing_failed' }}"

    on_exit:
      transform:
        output_data:
          - exited_at: "{{ __sys_info__.timestamp }}"
```

The `on_enter` callback typically does the work for a state and then emits an event to trigger the next transition.

---

## Transitions

### Basic Transition

```yaml
transitions:
  - from_state: pending
    to_state: approved
    trigger:
      event_name: approve
```

### Transition with Condition

Only fire the transition if the event data meets a condition:

```yaml
transitions:
  - from_state: pending
    to_state: processing
    trigger:
      event_name: start_processing
      condition:
        - and:
            - "{{ event.data.get('price') > 0 }}"
            - "{{ event.data.get('inventory_available') == true }}"
```

The `event` variable inside conditions contains the full event object:
```python
{
  "data": {...},
  "topic": "...",
  "source_workflow_id": "...",
  "metadata": {...}
}
```

### Multiple Transitions from One State

```yaml
transitions:
  - from_state: processing
    to_state: completed
    trigger:
      event_name: success

  - from_state: processing
    to_state: failed
    trigger:
      event_name: error

  - from_state: processing
    to_state: pending
    trigger:
      event_name: retry
```

---

## Global Triggers

Global triggers define transitions that can fire from **any** state. Useful for cancellation or error escalation.

```yaml
state_machine:
  name: order-fsm
  initial_state: pending

  global_triggers:
    - to_state: cancelled
      trigger:
        event_name: cancel

    - to_state: failed
      trigger:
        event_name: critical_error

  states:
    - name: pending
    - name: processing
    - name: cancelled
      is_terminal: true
    - name: failed
      is_terminal: true
```

---

## Event Source Configuration

By default, state machines listen for events on a per-transition basis. Setting `event_source_topic` at the machine level causes all transitions to listen on that topic.

```yaml
state_machine:
  name: order-fsm
  event_source_topic: order_events
  initial_state: pending

  transitions:
    - from_state: pending
      to_state: processing
      trigger:
        event_name: start        # matches events on "order_events" with data.event_name == "start"
```

When using `event_source_topic`, the `trigger.event_name` matches against `event.data.event_name` in the incoming event payload.

---

## Complete Example

A three-step order processor with validation, payment, and fulfillment stages:

```yaml
body:
  sequence:
    elements:
      - transform:
          output_data:
            - order_id: "{{ input.order_id }}"
            - order_data: "{{ input.order_data }}"

      - state_machine:
          name: order-processor
          initial_state: validating
          timeout_sec: 600
          event_source_topic: order_events

          states:
            - name: validating
              timeout_sec: 30
              on_enter:
                sequence:
                  elements:
                    - activity:
                        type: validate-order
                        input_data:
                          order: "{{ order_data }}"
                        output_name: validation_result
                    - emit_event:
                        input_data:
                          topic: order_events
                          data:
                            event_name: "{{ 'validated' if validation_result.valid else 'validation_failed' }}"
                            order_id: "{{ order_id }}"

            - name: processing
              timeout_sec: 120
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

            - name: completed
              is_terminal: true
              on_enter:
                transform:
                  output_data:
                    - status: completed
                    - completed_at: "{{ __sys_info__.timestamp }}"

            - name: failed
              is_terminal: true
              on_enter:
                transform:
                  output_data:
                    - status: failed

          transitions:
            - from_state: validating
              to_state: processing
              trigger:
                event_name: validated

            - from_state: validating
              to_state: failed
              trigger:
                event_name: validation_failed

            - from_state: processing
              to_state: completed
              trigger:
                event_name: payment_complete

            - from_state: processing
              to_state: failed
              trigger:
                event_name: payment_failed

          global_triggers:
            - to_state: failed
              trigger:
                event_name: cancel
```

---

## Next Steps

- [Events Reference](./events.md) — how to emit and receive events
- [Statements Reference](./statements.md) — all statement types including `emit_event` and `wait_for`
- [Workflowspec Reference](./workflowspec.md) — full technical reference
