---
sidebar_label: Built-in Core
---

# Built-in Core Activities

Three activities with no external dependency: read the clock, pause, and run a whole workflow
inside a single activity.

The rest of the `builtin.*` namespace is documented separately —
[state](./state.md), [secret](./secret.md), [event](./event.md) and [deploy](./deploy.md).

## Defaults

| Activity | Timeout | Max attempts | Local |
| --- | --- | --- | --- |
| `builtin.now` | — | 1 | yes |
| `builtin.delay` | — | 1 | yes |
| `builtin.execute_workflow` | 86400 s (1 day) | 1 | no |

`builtin.now` and `builtin.delay` run locally by default because a trip to a worker queue would
cost more than the work itself.

---

## `builtin.now`

Returns the current timestamp on the worker.

**Input**

None.

**Output**

A `datetime` value (not an object with fields). Assign it with `output_name` and use it directly.

**Example**

From `moco-examples/moco-workflow-demo/src/activity-options-demo.yaml`:

```yaml
- activity:
    name: get-timestamp
    type: builtin.now
    output_name: started_at
```

```yaml
- transform:
    output_data:
      - run_label: "{{ started_at.strftime('%Y-%m-%d') }}"
      - elapsed_sec: "{{ (finished_at - started_at).total_seconds() }}"
```

:::note Determinism
`builtin.now` reads the worker's clock at execution time. On the Temporal runtime the value is
recorded in workflow history, so a replay sees the original timestamp rather than the clock of the
replaying worker.
:::

---

## `builtin.delay`

Pauses the workflow for a given duration.

**Input**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `duration` | str \| number | no | `null` | How long to wait. A number is seconds; a string is a pandas-style interval such as `5s`, `10min`, `1h30m`. Omitting it is a no-op |

**Output**

`true` when a delay was performed, `null` when `duration` was omitted.

**Example**

```yaml
- activity:
    name: wait_5_seconds
    description: Delay execution for 5 seconds
    type: builtin.delay
    input_data:
      duration: 5s
```

A polling loop:

```yaml
- iteration:
    input_data: "{{ range(max_polls) }}"
    body:
      sequence:
        elements:
          - activity:
              type: http.request
              input_data:
                method: GET
                url: "{{ status_url }}"
                output_json: true
              output_name: status
          - abort:
              condition: "{{ status['json']['state'] == 'done' }}"
              type: break_iteration
          - activity:
              type: builtin.delay
              input_data:
                duration: 30s
```

:::note Long waits belong in `wait_for`
`builtin.delay` holds an activity slot for its whole duration. To pause for hours or days, or
until something happens, use a `wait_for` statement or a state machine instead — see
[Events](../../concepts/events.md).
:::

---

## `builtin.execute_workflow`

Runs an entire workflow **in memory, inside one activity**, using an embedded engine.

Reach for it when a workflow moves large data between steps. On the Temporal runtime every
activity input and output crosses the wire and is capped at 2 MB; an embedded run keeps
intermediate data in the worker's process, so neither limit nor marshalling cost applies.

The trade is observability: steps inside the embedded workflow are not individual Temporal
activities, so they get no per-step history and no per-step retry. The whole embedded run
succeeds or fails as one unit.

**Input**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `wfspec` | [WorkflowSpecInfo](#workflowspecinfo) | yes | — | Which workflow to run |
| `input_data` | any | no | `null` | Input passed to that workflow |
| `options` | [WorkflowExecuteOptions](#workflowexecuteoptions) | no | `null` | Execution options |

#### WorkflowSpecInfo

Identify a deployed workflow by `name` (plus optional `version`), **or** supply the spec inline as
`content`. Inline content is how a dynamically generated workflow is run without deploying it.

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `name` | str | no | `null` | Name of a deployed workflowspec |
| `version` | str | no | latest | Version to run |
| `content` | str \| list[str] | no | `null` | The workflowspec YAML itself |

#### WorkflowExecuteOptions

The commonly used fields; all are optional.

| Field | Type | Description |
| --- | --- | --- |
| `debug_mode` | bool | Publish debug events for the embedded run |
| `catch_exception` | bool | Return the error instead of failing the activity |
| `trace_id` | str | Correlate the embedded run with the caller's trace |
| `workflow_id` | str | Identifier for the embedded run |
| `tier` | str | Execution tier |
| `child_mode` | str | How the run relates to its parent |
| `execute_mode` | str | `in-memory`, `standalone-activity` or `workflow` |
| `retry_policy` | dict | Timeout and retry settings for the embedded run |
| `enable_otel_trace` | bool | Emit OpenTelemetry spans |

**Output**

The embedded workflow's own output, unchanged.

**Example**

From `moco-examples/trade-simulator/src/single-security-monitor.yaml`:

```yaml
- activity:
    name: run-signal-analysis
    type: builtin.execute_workflow
    input_data:
      wfspec:
        name: multi-timeframe-trading-signal
      input_data:
        symbol: "{{ symbol }}"
        confluence_threshold: "{{ confluence_threshold }}"
        hourly_prices: "{{ hist_candles }}"
    output_name: last_result
```

Running an inline spec:

```yaml
- activity:
    name: run-generated-spec
    type: builtin.execute_workflow
    input_data:
      wfspec:
        content: "{{ generated_yaml }}"
      input_data:
        rows: "{{ dataset }}"
      options:
        catch_exception: true
    output_name: result
```

:::note What the embedded workflow can call
It sees the activities of the worker it runs on. On the base worker that is the core provider set;
on the agent worker it additionally includes `claude_agent.*`. It cannot reach activities served
by a *different* worker type.
:::

:::caution Not retried
`builtin.execute_workflow` ships `max_attempts: 1` — a retry would re-run every side effect inside
the embedded workflow. It heartbeats every 20 seconds so Temporal detects a dead worker within a
minute rather than waiting out the one-day timeout.
:::
