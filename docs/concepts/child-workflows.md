---
sidebar_label: Composing Workflows
sidebar_position: 8
---

# Composing Workflows

A workflow that does everything itself is a workflow nobody else can reuse. Moco's answer is that a
workflow can run another workflow — and because workflows are published, versioned documents, the
one you call may belong to someone else entirely.

This page is about *why* you would split a workflow up and which composition mechanism fits. For the
exact field list, see the [`workflow` statement](../reference/statements.md#workflow).

---

## Four ways to compose

| Mechanism | Scope | Reach for it when |
|-----------|-------|-------------------|
| `call` a **function** | Inside one wfspec | A few steps repeat within this workflow |
| `workflow` with `child_mode: inline` | Another wfspec, parent's context | Factoring a long spec into readable files |
| `workflow` with `child_mode: sync` / `async` / `detached` | Another wfspec, own context | Reusing something independently owned, or fanning work out |
| `builtin.execute_workflow` activity | Another wfspec, as one activity | Large data or CPU-bound work you want in a single unit |

---

## Functions: reuse within a spec

When the repetition is local, a full child workflow is too much ceremony. Declare a `function` and
`call` it:

```yaml
wfspec_name: invoice
wfspec_version: 1.0.0

functions:
  - function: line_total
    input_data:
      price:
      qty:
    output_data:
      total: "{{ price * qty }}"

body:
  sequence:
    elements:
      - call:
          function: line_total
          input_data: {price: 10, qty: 3}
          output_name: first
```

A function runs as an inline child workflow with a **fresh context** — it sees only what you pass in,
which is exactly what makes it safe to call from several places. Functions are visible only inside
the wfspec that defines them, and recursion is rejected by the call-stack guard.

---

## Child modes

The `child_mode` decides two things: whether the child shares the parent's variables, and whether the
parent waits.

### `inline` — the default

The child runs inside the parent's context, seeing and writing the parent's variables. No separate
workflow is created.

```yaml
- workflow:
    wfspec:
      name: validate-order
    child_mode: inline
    output_name: validation
```

Use it to split a long spec into readable pieces. Because the context is shared, it is *not* the mode
for reusing someone else's workflow — the child can read and clobber variables it was never told
about.

### `sync` — an independent call

The child runs as its own workflow, with its own context, and the parent waits for the result.

```yaml
- workflow:
    wfspec:
      name: payment-charge
      version: 1.0.0
    child_mode: sync
    input_data:
      amount: "{{ total }}"
    output_name: payment_result
```

This is the mode for genuine reuse. The interface is `input_data` in, result out — nothing else
crosses the boundary, so the child can be owned, versioned, and changed by someone else without
breaking you.

### `async` — start and keep going

The parent gets a `workflow_id` as soon as the child starts and carries on. Use it to fan work out:

```yaml
- iteration:
    input_data: "{{ regions }}"
    body:
      workflow:
        wfspec:
          name: regional-report
        child_mode: async
        input_data:
          region: "{{ iter_item }}"
        output_name: child_id
```

An `async` child is tied to the parent's lifetime: if the parent terminates, the child terminates
with it. To collect results, have the children emit events and have the parent `wait_for` them.

### `detached` — cut loose

Like `async`, but the child survives the parent. Use it for work that must finish regardless — a
cleanup job, a notification pipeline, an audit trail — or to hand off to a long-running workflow
while the caller returns immediately.

The flip side is that you have given up control: the parent has no handle on the outcome, so
whatever the child does must be safe unattended.

---

## Referencing a wfspec

A `workflow` statement names its child in one of two ways, and the choice matters more than it looks.

### By name and version — the deployed way

```yaml
- workflow:
    wfspec:
      name: payment-charge
      version: 1.0.0
    child_mode: sync
```

The name resolves through the deployment for the calling user and tier. Omit `version` and you get
whatever the stage resolves to, which is what lets the owner of `payment-charge` ship a fix without
every caller editing their spec. Pin a version when you need the behaviour frozen.

This is how workflows are shared: you call a name, not a file.

### By content — the undeployed way

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

The spec travels with the call. Three situations want this:

- **Development.** `moco run src/parent.yaml` bundles the children it references and sends them
  along, so you can iterate on a whole tree without publishing anything.
- **Generated workflows.** `wfspec` accepts expressions, so a workflow can build a child spec at
  runtime and execute it — the basis for agent-authored workflows.
- **Self-contained tests.** A unit test inlines the spec it exercises.

Because `content` is evaluated as an expression, a dynamically generated child is just a string your
workflow computed.

---

## Running a workflow as an activity

`builtin.execute_workflow` runs a wfspec as a *single activity* instead of as a child workflow:

```yaml
- activity:
    type: builtin.execute_workflow
    input_data:
      wfspec:
        name: transform-dataset
      input_data:
        source: "{{ path }}"
    output_name: dataset
```

The difference is where the durability boundary sits. A child workflow records every step; an
activity records one result. On Temporal every activity input and output crosses the wire and is
capped at 2 MB, so for a spec that moves a large dataframe through several transforms this is the
difference between marshalling the frame repeatedly and not marshalling it at all.

What you give up is observability: the embedded steps are not individual Temporal activities, so
there is no per-step history and no per-step retry — the whole run succeeds or fails as one unit,
and a restart re-runs it from the top. It must be idempotent. This is the in-workflow form of
`execute_mode: standalone-activity`; see
[How Workflows Run](./how-to-run-workflow.md#standalone-activity--one-durable-unit) and the
[`builtin.execute_workflow` reference](../reference/activities/builtin-core.md#builtinexecute_workflow).

---

## Per-child execute options

A `workflow` statement can carry `execute_options`, applying to that child only:

```yaml
- workflow:
    wfspec:
      name: slow-report
    child_mode: sync
    execute_options:
      retry_policy:
        timeout_sec: 1800
      tier: prod
    output_name: report
```

The child's `workflow_id` is worth setting when the child is an
[entity workflow](./how-to-run-workflow.md#entity-workflows) — that ID is its address, and starting
it again with the same ID delivers an event to the running instance rather than creating a second
one.

`trace_id` is inherited automatically: parent and every descendant share one trace, so a whole tree
is greppable by a single ID.

---

## Designing for reuse

**Publish the interface, not the internals.** A `sync` child's contract is its `input_data` and its
result. Keep both stable and you can rewrite everything between them.

**Don't share context across an ownership boundary.** `inline` is for splitting up *your* workflow.
The moment another team owns the child, use `sync`.

**Version deliberately.** Callers who omit `version` roll forward with you — good for a bug fix,
bad for a changed output shape. A breaking change deserves a major version, so existing callers stay
where they are.

**Watch the depth.** Every level adds latency and history. A tree three deep is usually a sign that
some middle layer is only passing data through.

---

## Next steps

- [`workflow` statement](../reference/statements.md#workflow) — full field reference
- [`call` statement](../reference/statements.md#call) — function invocation
- [Events](./events.md) — collecting results from `async` children
- [Releasing and Sharing Workflows](./release-and-sharing.md) — how a name becomes resolvable
