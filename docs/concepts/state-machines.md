---
sidebar_label: State Machines
sidebar_position: 3
---

# State Machines

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
          event_type: start_processing

      - from_state: processing
        to_state: completed
        trigger:
          event_type: processing_complete

      - from_state: processing
        to_state: failed
        trigger:
          event_type: processing_failed
```

### Top-Level Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | string | Identifier for this state machine |
| `initial_state` | string | State to start in |
| `timeout_sec` | integer | Maximum total runtime before the machine times out |
| `event_source_topic` | string | Event topic to listen on for all transitions |
| `states` | list | State definitions |
| `transitions` | list | Transition rules between states. A transition with no `from_state` fires from any state |

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
                - entered_at: "{{ now() }}"
          - activity:
              type: process-order
              input_data:
                order_id: "{{ order_id }}"
              output_name: process_result
          - emit_event:
              input_data:
                topic: order_events
                event_type: "{{ 'processing_complete' if process_result.success else 'processing_failed' }}"

    on_exit:
      transform:
        output_data:
          - exited_at: "{{ now() }}"
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
      event_type: approve
```

### Transition with Condition

Only fire the transition if the event data meets a condition:

```yaml
transitions:
  - from_state: pending
    to_state: processing
    trigger:
      event_type: start_processing
      condition:
        and:
          - "{{ event.data.get('price') > 0 }}"
          - "{{ event.data.get('inventory_available') == true }}"
```

The `event` variable inside conditions contains the full event object:
```python
{
  "data": {...},          # Event payload
  "topic": "...",         # Event topic
  "event_type": "...",    # Event type
  "event_id": "...",      # Unique event id
  "source": "...",        # Workflow that emitted the event
  "timestamp": ...,       # When the event was published
  "metadata": {...}       # Event metadata
}
```

### Multiple Transitions from One State

```yaml
transitions:
  - from_state: processing
    to_state: completed
    trigger:
      event_type: success

  - from_state: processing
    to_state: failed
    trigger:
      event_type: error

  - from_state: processing
    to_state: pending
    trigger:
      event_type: retry
```

---

## Global Triggers

A transition that omits `from_state` is a **wildcard**: it can fire from any state. Useful for
cancellation or error escalation. State-specific transitions are matched first; wildcard
transitions are the fallback.

```yaml
state_machine:
  name: order-fsm
  initial_state: pending

  states:
    - name: pending
    - name: processing
    - name: cancelled
      is_terminal: true
    - name: failed
      is_terminal: true

  transitions:
    # No from_state -> fires from any state
    - to_state: cancelled
      trigger:
        event_type: cancel

    - to_state: failed
      trigger:
        event_type: critical_error
```

`from_state` also accepts a list to scope a transition to specific states (an empty list is
equivalent to omitting it):

```yaml
    - from_state: [pending, processing]
      to_state: cancelled
      trigger:
        event_type: cancel
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
        event_type: start        # matches events on "order_events" whose event_type is "start"
```

`trigger.event_type` is matched against the incoming event's own `event_type` field — the one
set by `emit_event`'s `input_data.event_type`, not something inside `data`. To key off a value
in the payload instead, use `trigger.condition`, which has the full `event` in scope.

### Expression Triggers

`trigger.event_type` accepts an embedded expression. It is resolved against the workflow
context on **every incoming event** — not when the machine is built — so it can reference a
value produced after the machine started:

```yaml
transitions:
  - from_state: working
    to_state: ready
    trigger:
      event_type: "{{ work_token }}"
```

The expression is re-evaluated on each event and never cached, so a value that changes between
iterations is picked up. Ordering matters in general: an event that arrives before the
referenced variable is set does not match, and an unmatched event is dropped. Prefer a literal
`event_type` unless the value genuinely cannot be known in advance — the main case where it
cannot is an [async activity token](#triggering-on-an-async-activity), which is unique per
invocation.

### Triggering on an async activity

An activity with `async_mode: true` publishes its result as an event when it finishes, so it
can drive a transition. Its token is unique per invocation, so capture it with `output_name` and
use an expression trigger. Point `async_event_topic` at the machine's `event_source_topic`, and
start the activity from a state's `on_enter` — the machine only subscribes when it starts, so a
completion published before that is not seen.

Starting from `on_enter` is also what makes the expression trigger ordering-safe: `on_enter` is
awaited to completion before the event loop dequeues its first event, so the token variable is
always set before a completion can be matched.

```yaml
state_machine:
  event_source_topic: work_events
  initial_state: fetching
  states:
    - name: fetching
      on_enter:
        activity:
          name: fetch_prices
          type: http.request
          async_mode: true
          async_event_topic: work_events
          output_name: fetch_token    # the transition below triggers on this
    - name: ready
      is_terminal: true
  transitions:
    - from_state: fetching
      to_state: ready
      trigger:
        event_type: "{{ fetch_token }}"
        action:                       # `event` is in scope in the action and condition
          transform:
            output_data:
              - prices: "{{ event['data'] }}"
```

See [Async activity results](./events.md#async-activity-results) for the full event shape and
its limitations.

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
                          event_type: "{{ 'validated' if validation_result.valid else 'validation_failed' }}"
                          data:
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
                          event_type: "{{ 'payment_complete' if payment_result.success else 'payment_failed' }}"

            - name: completed
              is_terminal: true
              on_enter:
                transform:
                  output_data:
                    - status: completed
                    - completed_at: "{{ now() }}"

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
                event_type: validated

            - from_state: validating
              to_state: failed
              trigger:
                event_type: validation_failed

            - from_state: processing
              to_state: completed
              trigger:
                event_type: payment_complete

            - from_state: processing
              to_state: failed
              trigger:
                event_type: payment_failed

            # No from_state -> fires from any state
            - to_state: failed
              trigger:
                event_type: cancel
```

---

## Next Steps

- [Events Reference](./events.md) — how to emit and receive events
- [Statements Reference](../reference/statements.md) — all statement types including `emit_event` and `wait_for`
- [Workflowspec Reference](./workflowspec.md) — full technical reference
