---
sidebar_position: 1
---

# Core Concepts Overview

This page is the map. It introduces every concept you need to build a Moco workflow and links to the
page that covers each one properly.

Three ideas hold the platform together:

**A workflow is a document.** A **workflowspec** (or **wfspec**) is a YAML file that expresses your
logic as a mix of imperative steps, an event-driven state machine, and a declarative rules engine —
with sandboxed Python expressions in `{{ }}` wherever a value needs to be computed. One language
covers a wide range of workflows, and it stays readable by the people who own the process.

**A workflow is released like data, not like software.** Because a wfspec is a document rather than
code compiled into the runtime, you publish and deploy it yourself, on demand, through the CLI or
the web console. Versioning, access control, and staged rollout are properties of the document, so
workflows can be shared and composed without a backend deployment for every change.

**Durability is the platform's problem.** Workflows run durably on Temporal — surviving crashes,
restarts, and multi-day waits — without you writing any state-management or checkpointing logic. The
same wfspec also runs in-memory with no infrastructure at all when you want speed over durability.

## Workflowspec

A **workflowspec** is a YAML document that defines a complete workflow. It specifies:

- Workflow identity (name and version)
- Input parameters
- Initial context variables
- The workflow body (execution logic)
- Output specification

```yaml
wfspec_name: my-workflow
wfspec_version: 1.0.0
context:
  status: pending
input_data:
  user_id:
output_name: result
body:
  # Workflow logic here
```

## Statements

Statements are the building blocks of workflows. They come in two categories:

### Primitive Statements
Leaf nodes that perform specific actions:
- **transform**: Data transformations and variable assignments
- **abort**: Stop the workflow (abort, terminate, break, raise)
- **activity**: Execute an activity — the bridge to the outside world
- **workflow**: Execute a child workflow
- **call**: Invoke a reusable `function` defined in the same wfspec
- **wait_for**: Wait for an event or a timeout
- **emit_event**: Send an event to the event bus
- **continue_as_new_checkpoint**: Restart a long-running workflow with a fresh history

### Composite Statements
Containers that orchestrate other statements:
- **sequence**: Execute statements sequentially
- **parallel**: Execute statements concurrently
- **iteration**: Loop over collections
- **state_machine**: Event-driven finite state machines
- **rules_engine**: Declarative rule evaluation over a working memory of facts

## Expressions

Expressions provide dynamic behavior using Python syntax:

```yaml
# Simple expression
total: "{{ price * quantity }}"

# Complex expression with list comprehension
result: "{{ sum([item['price'] for item in items]) }}"

# Conditional expression
discount: "{{ price * 0.1 if price > 100 else 0 }}"
```

### Expression Types
- **python**: Standard Python evaluation (default)
- **python_glom**: Path-based data extraction
- **literal**: No evaluation, treat as string
- **jinja**: Jinja2 template rendering

## Activities

Activities are external functions or services that workflows can invoke:

```yaml
- activity:
    type: http.request
    input_data:
      method: GET
      url: https://api.example.com/data
    retry_policy:
      timeout_sec: 30
      max_attempts: 3
    output_name: api_result
```

Moco ships activities for HTTP and GraphQL, shell commands, SQL, email, Kafka and RabbitMQ, Google
Drive, Kubernetes, browser automation, OpenAI and Claude agents, vector search, and the platform's
own secret, state, and deployment operations. The
[Activity Catalog](../reference/activity-catalog.md) lists every one with its input and output
contract.

## Context and Variables

Workflows maintain a context (variable store) throughout execution:

- **Context**: Initial variables defined in the workflowspec
- **Input Data**: Parameters passed when starting the workflow
- **Output Data**: Values computed during execution
- **Special Variables**:
  - `_`: Root context (all variables)
  - `__user_info__`: User information
  - `__sys_info__`: System info (workflow_id, trace_id, etc.)
  - `iter_item`: Current item in iteration
  - `iter_items`: All items in iteration

### Variable Modifiers

Control how variables are evaluated and stored:

```yaml
# Container scope (temporary, not persisted)
temp@: "{{ calculation() }}"

# Debug logging
value#: "{{ important_data }}"

# Force expression type
template#literal: "{{ not_evaluated }}"
path#python_glom: "data.nested.field"
```

## Runtimes and Execute Modes

The same wfspec runs two ways: durably and distributed on **Temporal**, or entirely **in-memory**
with no infrastructure. You pick per run, not per workflow — `moco run --in-memory`, or
`execute_mode` through the API. A third mode, `standalone-activity`, runs the whole spec as one
durable unit for data-heavy work.

See [Runtimes](./dual-runtime.md) for the trade-offs and
[How Workflows Run](./how-to-run-workflow.md) for the execute modes and their options.

## Events

Workflows can communicate via events:

### Emitting Events
```yaml
- emit_event:
    input_data:
      topic: notifications
      data:
        message: "Task complete"
        result: "{{ result }}"
```

### Waiting for Events
```yaml
- wait_for:
    event:
      topic: notifications
      match_expression: "{{ event.data.get('id') == task_id }}"
    timeout_sec: 60
    output_name: received_event
```

Events enable:
- Parent-child workflow communication
- Multi-agent coordination
- State machine transitions
- Asynchronous notifications

## Child Workflows

Workflows can execute other workflows, in one of four modes:

- **inline** (default): Runs in the parent's context, sharing its variables
- **sync**: Runs independently; the parent waits for the result
- **async**: Runs independently; the parent waits only for it to start, and gets a `workflow_id`
- **detached**: Runs completely independently, and outlives the parent

```yaml
- workflow:
    wfspec:
      name: child-workflow
      version: 1.0.0
    child_mode: sync
    input_data:
      param: "{{ value }}"
    output_name: child_result
```

## State Machines

For complex event-driven workflows, use state machines:

```yaml
state_machine:
  name: order-fsm
  initial_state: pending
  states:
    - name: pending
    - name: processing
    - name: completed
      is_terminal: true
  transitions:
    - from_state: pending
      to_state: processing
      trigger:
        event_type: start
```

State machines provide:
- Explicit state management
- Event-driven transitions
- State-specific timeouts
- Entry/exit callbacks
- Global transitions

## Where to go next

**Writing a workflow**

- [Workflowspec Structure](./workflowspec.md) — the anatomy of a spec
- [Expressions](./expressions.md) — the `{{ }}` language and variable modifiers
- [Activities](./activities.md) — calling the outside world
- [Writing Workflows](../guides/writing-workflows.md) — practical authoring patterns

**Beyond straight-line logic**

- [State Machines](./state-machines.md) — event-driven and human-in-the-loop workflows
- [Rules Engine](./rules-engine.md) — declarative rules over a working memory of facts
- [Events](./events.md) — `emit_event`, `wait_for`, and workflow-to-workflow messaging
- [Composing Workflows](./child-workflows.md) — functions, child workflows, and child modes

**Running and shipping it**

- [Runtimes](./dual-runtime.md) — in-memory versus durable execution
- [How Workflows Run](./how-to-run-workflow.md) — execute modes, entity workflows, run options
- [Using the Moco CLI](../guides/use-moco-cli.md) — run, test, publish
- [Running Workflows Through the API](../guides/run-moco-workflow-through-api.md) — REST and MCP
- [Testing Workflows](../guides/testing.md) — `*.test.yaml` suites
- [Releasing and Sharing](./release-and-sharing.md) — packages, stages, targets, access control

**Looking something up**

- [Statements Reference](../reference/statements.md)
- [Workflowspec Reference](../reference/workflowspec-reference.md)
- [Activity Catalog](../reference/activity-catalog.md)
