---
sidebar_label: Testing Workflows
sidebar_position: 4
---

# Testing Workflows

Moco tests are YAML, like the workflows they test. You write a `*.test.yaml` suite next to your
wfspec, run it with `moco test`, and the platform executes the workflow for each case and checks the
result. There is no Python and no test framework to install — if you can write a wfspec, you can
write its tests.

```bash
moco test                                   # everything under ./tests/
moco test tests/hello-moco.test.yaml        # one file
moco test 'tests/**/*.test.yaml'            # a glob
```

A Moco project keeps tests where `moco.json` says they are:

```
hello-moco/
├── moco.json          # "tests": ["tests/**/*.yaml"]
├── src/
│   └── hello-moco.yaml
└── tests/
    └── hello-moco.test.yaml
```

---

## Two kinds of suite

Every suite declares a `test_type`.

| Type | Runs | Use it to |
|------|------|-----------|
| `integration-test` | The whole workflow, start to finish | Check end-to-end behaviour and real outputs |
| `unit-test` | One named step, in isolation | Check a single transform's logic without running everything around it |

Start with integration tests. Reach for a unit test when a step has interesting logic of its own and
setting up a full run to reach it would be more trouble than the test is worth.

---

## Integration tests

```yaml
test_type: integration-test

wfspec:
  name: rules-engine-demo
  version: 1.0.0

test_cases:
  - id: approval-good-credit-medium-income
    input:
      credit_score: 720
      annual_income: 85000
      employment_years: 7
      debt_to_income_ratio: 0.32
    expect:
      output:
        - loan_decision.decision: "approved"
        - loan_decision.scoring.credit_tier: "good"
      assert:
        - "{{ round(loan_decision.scoring.final_score, 2) == 0.85 }}"
```

| Field | Required | Meaning |
|-------|----------|---------|
| `test_type` | yes | `integration-test` |
| `wfspec.name` | yes | The workflow under test |
| `wfspec.version` | no | Pin a version; omit to use whatever resolves |
| `wfspec.content` | no | Inline the workflow YAML instead of resolving it by name |
| `test_cases` | yes | The cases to run |
| `test_data` | no | Shared data available to the suite |
| `skip` | no | Skip the whole suite |
| `verbose` | no | Verbose output for the whole suite |

Each case needs an `id`, an `input`, and an `expect`:

| Field | Required | Meaning |
|-------|----------|---------|
| `id` | yes | Unique, descriptive name. This is what the runner and the test explorer show |
| `input` | yes | Input data for the run. `{}` if the workflow takes none |
| `expect` | yes | What should be true afterwards |
| `mocks` | no | Replace named steps with canned output |
| `skip` | no | Skip this case |
| `verbose` | no | Print the expanded test workflow and full output for this case |

Name cases for the behaviour they pin down. `boundary-dti-at-threshold` tells you what broke;
`test-4` does not.

---

## Expectations

`expect` supports four kinds of check, and a case may combine them. All of them must pass.

### `output` — named values

```yaml
expect:
  output:
    - loan_decision.decision: "approved"
    - loan_decision.rejection.auto_reject: false
```

Each entry names an output variable and the value it should have. Dotted paths reach into nested
structures. Only the variables you list are checked, so a case can pin one field and ignore the
rest.

### `assert` — expressions

```yaml
expect:
  assert:
    - "{{ len(items) > 0 }}"
    - "{{ 'Debt-to-income' in loan_decision.rejection.reason }}"
    - "{{ round(final_score, 2) == 0.85 }}"
```

Each assertion is an ordinary Moco expression evaluated against the workflow's output context, and
must come out `True`. Use these when a value is computed, approximate, or only interesting in
relation to another — anything `output` cannot express as a literal.

The whole workflow result is also available as `__OUTPUT__`, which is what you want when the
workflow returns a value rather than named variables:

```yaml
expect:
  assert:
    - "{{ __OUTPUT__['succeeded'] == True }}"
    - "{{ __OUTPUT__['duration_sec'] == 7.5 }}"
```

### `error` — expected failure

```yaml
expect:
  error:
    error_type: AbortError
    error_message: "Price must be non-negative"
```

The run must fail, with this error type and message. Set either field to `null` to accept any value:

```yaml
expect:
  error:
    error_type: AbortError
    error_message: null      # any message
```

Testing the failure paths is the half people skip. A workflow that validates its input deserves a
case proving it actually rejects bad input.

### `terminate` — expected early exit

```yaml
expect:
  terminate:
    terminate_message: "no eligible records"
```

The workflow must stop early via an `abort` statement. `terminate_message: null` accepts any
message. This is distinct from `error`: terminating is a deliberate outcome, failing is not.

---

## Mocking

Real activities make tests slow, flaky, and dependent on credentials. `mocks` replaces a **named
step** with canned output, so the workflow runs its real logic against data you control:

```yaml
- id: successful-job-is-reported-and-cleaned-up
  input: {}
  mocks:
    - step_name: create-job
      _raw_output:
        applied_count: 1
        resources:
          - kind: Job
            name: moco-migrate-abc12345
    - step_name: await-job
      _raw_output:
        met: true
        elapsed_sec: 7.5
  expect:
    assert:
      - "{{ __OUTPUT__['succeeded'] == True }}"
      - "{{ __OUTPUT__['duration_sec'] == 7.5 }}"
```

| Field | Required | Meaning |
|-------|----------|---------|
| `step_name` | yes | The `name` of the activity or child-workflow step to intercept |
| `_raw_output` | yes | What that step should return instead of running |
| `wfspec_name` | no | Mock a step inside a specific child workflow rather than this one |

**Mocking requires named steps.** A step with no `name` cannot be mocked, which is the practical
reason to name every activity in a workflow you intend to test:

```yaml
- activity:
    name: create-job          # <- this is the mock handle
    type: k8s.apply
```

Mock at the edges — the activities that talk to the outside world — and let everything between them
run for real. A suite that mocks every step tests nothing but the mocks. A suite that mocks only
`http.request` and `sql.query` still proves your conditions, expressions, and control flow work.

Mocking error paths works the same way: give the step output that represents failure and assert the
workflow handles it.

---

## Unit tests

A unit test runs **one named step** with an input context you supply, and checks what it produced.
It needs the workflow inline via `wfspec.content`, so the runner can locate the step:

```yaml
test_type: unit-test

wfspec:
  name: merge-config
  content: |
    wfspec_name: merge-config
    wfspec_version: 1.0.0
    body:
      transform:
        name: merge-config
        output_data:
          - resolved: "{{ {**defaults, **overrides} }}"

test_groups:
  - step_name: merge-config
    test_cases:
      - id: overrides-win-over-defaults
        input:
          defaults: {theme: light, lang: en}
          overrides: {theme: dark}
        expect:
          assert:
            - "{{ resolved == {'theme': 'dark', 'lang': 'en'} }}"

      - id: no-overrides-leaves-defaults-intact
        input:
          defaults: {theme: light, lang: en}
          overrides: {}
        expect:
          output:
            - resolved.theme: light
```

`test_groups` replaces `test_cases` at the top level: one group per step, each with its own cases.
Groups take `skip` and `verbose` too, so you can park a whole group while a step is in flux.

`step_name` must match the `name` of a step in the workflow.

This is the right tool for a transform that encodes real business rules — a precedence order, a
rounding convention, a set of defaults. Pinning those values in a unit test turns "someone changed a
default" into a failing test rather than a surprise in production.

---

## Running tests

```bash
moco test                                  # all tests under ./tests/
moco test tests/hello-moco.test.yaml       # a single file
moco test 'tests/**/*.test.yaml'           # a glob
```

| Option | Effect |
|--------|--------|
| `--in-memory` | Run on the in-memory runtime — fastest, no Temporal needed |
| `--verbose` | Per-test progress and server log messages |
| `-t, --timeout <sec>` | MCP request timeout (default 300) |
| `--debug` | HTTP-level debug logging |
| `--auth <mode>` | Force `oauth` or `apikey` |

`--in-memory` is the normal choice while developing: a fully mocked suite has no need for durable
execution, and skipping Temporal makes the loop noticeably tighter. Run at least once without it
before publishing, so the suite is exercised the way the workflow will actually run.

### Debugging a failing case

Set `verbose: true` on the one case that fails rather than on the suite — it prints the expanded
test workflow and the full output context, which is usually enough to see which variable is not what
you assumed:

```yaml
- id: the-one-that-fails
  verbose: true
  input: { ... }
  expect: { ... }
```

The `#` debug modifier works in tests exactly as it does in a normal run — append it to a variable
in the workflow to have its value streamed as the test executes:

```yaml
- transform:
    output_data:
      - final_score#: "{{ base + bonus }}"
```

Use `skip: true` to park a case you are not ready to fix. A skipped case stays visible; a deleted
one is forgotten.

---

## Practical advice

**One behaviour per case.** When a case with eight assertions fails you still have to work out
which. Several small cases with meaningful IDs tell you directly.

**Cover the boundaries.** Most workflow bugs live at thresholds. If a rule fires at `>= 0.70`, write
the case at exactly `0.70` and the one just below it — `boundary-score-exactly-at-threshold` and
`boundary-score-below-threshold` are more valuable than five cases in the comfortable middle.

**Comment the arithmetic.** Where an expected value is derived, show the derivation:

```yaml
# base=0.75 + income=0.05 + employ=0.05 = 0.85 -> approved
- id: approval-good-credit-medium-income
```

The next person to change a weight needs to know why the number was 0.85.

**Test what a change would break.** A suite's job is to fail when behaviour changes unintentionally.
Assertions on values that can never change are noise; assertions on defaults, thresholds, and output
shape are the ones that earn their place.

**Publish tests with the package.** The `tests` glob in `moco.json` ships your suites alongside the
sources, so whoever inherits the workflow inherits its specification of correct behaviour.

---

## Next steps

- [Using the Moco CLI](./use-moco-cli.md) — `moco test` among the other commands
- [Writing Workflows](./writing-workflows.md) — authoring patterns
- [Expressions](../concepts/expressions.md) — the language used in `assert`
- The `moco-examples` projects — every one ships a `tests/` directory worth reading
