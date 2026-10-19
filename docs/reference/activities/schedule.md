---
sidebar_label: Schedules
---

# Schedule Activities

Eight activities manage [schedules](../../guides/scheduling-workflows.md), the recurring runs of a
deployed workflow, from inside a workflow. They do exactly what the `moco schedule` CLI and the
`/api/schedule` endpoints do, with the same permission checks. The caller is the user the
workflow runs as.

The typical use is a setup workflow that installs a package's recurring jobs. Because
`builtin.schedule.create` replaces an existing schedule by default, running the setup again is
safe.

## Setup

Schedules need the Temporal runtime. The worker uses its own Temporal settings
(`MOCO_TEMPORALIO_*`). On a deployment without Temporal, every activity here fails with a message
saying so.

## Identity and permissions

- A schedule runs as the user who created it or last replaced it, its **owner**. A workflow
  that calls `builtin.schedule.create` makes the user it runs as the owner.
- The checks match the API ([Permissions](../../guides/scheduling-workflows.md#permissions)).
  Create and update need write access to the namespace and permission to run the workflow.
  Pause, resume, run now and delete need the owner or a namespace admin.
- A refusal, a missing schedule, a name clash (`if_exists: fail`) and bad input fail the task
  without retry. The workflow sees a `WorkflowRuntimeError` whose message says what failed, for
  example `User 'alice' does not have write access to namespace 'ops'` or
  `Schedule 'ops/nightly' already exists`. To handle one, put `on_error` on the task:

  ```yaml
  on_error:
    catch: true
    do:
      set:
        - schedule_error: '{{ _["error_message"] }}'
  ```

## Defaults

Writes (create, update, pause, unpause, trigger, delete): 60 s timeout, 1 attempt. Reads
(describe, list): 60 s timeout, 3 attempts.

---

## `builtin.schedule.create`

Creates a schedule. By default an existing schedule with the same name is replaced.

**Input**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `namespace` | str | yes | — | Namespace the schedule belongs to |
| `name` | str | yes | — | Schedule name, unique within the namespace. Letters, digits, `.`, `_`, `-`, `@` |
| `wfspec_name` | str | yes | — | Deployed workflow to run: a package name, or `<package>/<wfspec>` |
| `wfspec_version` | str | no | `null` | Pin a version. Omit to run whatever version is deployed at each fire |
| `spec` | object | yes | — | When it fires, see [spec](#spec) |
| `input_data` | object | no | `null` | Input passed to every run |
| `if_exists` | `replace` \| `keep` \| `fail` | no | `replace` | When the name is taken: replace it (as [update](#builtinscheduleupdate) would), leave it as is, or fail |

**Output**: `{schedule_id, action}`. `action` is `created`, `replaced` or `kept`.

### `spec`

Exactly one of `cron` or `every_sec`.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `cron` | list of str | — | Cron expressions. The schedule fires on the union of them |
| `every_sec` | int | — | Fixed interval in seconds, at least 1 |
| `timezone` | str | UTC | IANA timezone the cron expressions are read in |
| `jitter_sec` | int | none | Delay each fire by a random amount up to this |
| `overlap` | str | `skip` | When a fire is due while the previous run is still going: `skip`, `buffer_one`, `buffer_all`, `cancel_other`, `terminate_other`, `allow_all` |
| `catchup_window_sec` | int | 300 | After an outage, missed fires up to this old still run |
| `paused` | bool | false | Create (or set) the schedule paused |
| `note` | str | | Free text shown with the schedule |

**Example**: a setup workflow that installs an hourly cleanup job and a nightly report:

```yaml
header:
  schema_version: 2.0.0
  workflow_name: ops-setup

main:
  tasks:
    - activity:
        type: builtin.schedule.create
        input:
          namespace: ops
          name: hourly-cleanup
          wfspec_name: ops-cleanup
          spec:
            cron: ["0 * * * *"]
    - activity:
        type: builtin.schedule.create
        input:
          namespace: ops
          name: nightly-report
          wfspec_name: ops-report
          spec:
            cron: ["0 2 * * *"]
            timezone: America/New_York
          input_data:
            days: 1
```

---

## `builtin.schedule.update`

Replaces a schedule's workflow, `spec` and input. The caller becomes the owner. A paused schedule
stays paused unless `spec.paused` is given.

**Input**: the same as [create](#builtinschedulecreate), without `if_exists`.

**Output**: `{schedule_id}`. Fails if the schedule does not exist.

---

## `builtin.schedule.describe`

**Input**: `namespace`, `name`.

**Output**: `schedule_id`, `namespace`, `name`, `wfspec_name`, `wfspec_version`, `owner`, `spec`,
`paused`, `note`, `input_data`, `next_fire_times` (ISO timestamps), and `recent_runs`, a list of
`{workflow_id, scheduled_at, started_at}`.

---

## `builtin.schedule.list`

Lists the schedules the caller may see: the ones they own, plus those in namespaces they can view.

**Input**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `namespace` | str | no | `null` | Only this namespace |
| `max_results` | int | no | 100 | 1 to 1000 |

**Output**: `{schedules: [...]}`. Each entry has the fields of describe, without `input_data` and
`recent_runs`.

---

## `builtin.schedule.pause` / `builtin.schedule.unpause`

**Input**: `namespace`, `name`, and optionally `note`, which is shown with the schedule's state.

**Output**: `{schedule_id, done}`.

---

## `builtin.schedule.trigger`

Runs the schedule once now, as its owner, subject to its overlap policy. Works while paused.

**Input**: `namespace`, `name`. **Output**: `{schedule_id, done}`.

---

## `builtin.schedule.delete`

Deletes the schedule. Runs it already started keep running.

**Input**: `namespace`, `name`. **Output**: `{schedule_id, done}`.
