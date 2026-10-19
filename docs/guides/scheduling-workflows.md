---
sidebar_label: Scheduling Workflows
sidebar_position: 7
---

# Scheduling Workflows

A **schedule** runs a deployed workflow on a cron or a fixed interval: a nightly report, an
hourly cleanup job, a health ping every five minutes. Schedules run on the Temporal runtime and
keep firing whether or not anyone is logged in.

## What a schedule is

| Part | Meaning |
| --- | --- |
| **Id** | `<namespace>/<name>`. `name` is yours to choose and unique within the namespace, so one workflow can have several schedules. Letters, digits, `.`, `_`, `-` and `@` |
| **Workflow** | The **name** of a deployed workflow. Without a version, every fire runs whatever version is deployed at that moment, so a redeploy takes effect at the next fire. Add `@<version>` to pin one |
| **Timing** | Exactly one of `cron` (one or more cron expressions) or `every` (a fixed interval) |
| **Input** | The `input` passed to every run |
| **Owner** | The user who created or last updated the schedule. Every run executes as that user |

Optional settings:

| Setting | Default | Meaning |
| --- | --- | --- |
| `timezone` | UTC | IANA timezone the cron expressions are read in, e.g. `America/New_York` |
| `jitter` | none | Delays each fire by a random amount up to this, to spread load |
| `overlap` | `skip` | What to do when a fire is due while the previous run is still going: `skip`, `buffer_one`, `buffer_all`, `cancel_other`, `terminate_other`, `allow_all` |
| `catchup` | 5 minutes | After an outage, missed fires up to this old are still run; older ones are dropped |
| `paused` | false | Create the schedule paused |
| `note` | | Free text, shown with the schedule (why it is paused, who to ask) |

Only deployed workflows can be scheduled. A local file cannot, because a schedule outlives your
session. [Publish](./use-moco-cli.md) the package first.

## With the CLI

```bash
# Every night at 02:00 New York time
moco schedule create ops/nightly-report nightly-report \
  --cron "0 2 * * *" --tz America/New_York --input '{"days": 1}'

# Every 5 minutes, pinned to version 1.2.0, created paused
moco schedule create ops/ping health-ping@1.2.0 --every 5m --paused --note "enable after go-live"

moco schedule list ops                  # schedules in a namespace
moco schedule describe ops/nightly-report   # spec, next fires, recent runs
moco schedule trigger ops/nightly-report    # run once now (also while paused)
moco schedule pause ops/nightly-report --note "incident 42"
moco schedule resume ops/nightly-report
moco schedule update ops/nightly-report nightly-report --cron "0 3 * * *"
moco schedule delete ops/nightly-report     # asks to confirm; --force skips
```

Durations (`--every`, `--jitter`, `--catchup`) are seconds (`90`) or units: `30s`, `5m`,
`1h30m`, `2d`. Input comes from `--input '<json>'` or `--input-file <file>` (JSON or YAML) and
must be an object. Add `--json` to `list` or `describe` for machine-readable output.

`describe` lists the workflow ids of recent runs. Pass one to `moco status` or `moco history` to
inspect that run. A scheduled run's id has the form
`<workflow>:<version>:<owner>:schedule-<schedule id>-<fire time>`.

`update` replaces the whole schedule: workflow, timing, input and options. Pass everything you
want to keep. A paused schedule stays paused through an update unless you pass `--paused` (or
`paused: false` through the API).

## Through the API

The same operations are available as REST endpoints under `/api/schedule` and as MCP tools.

| Operation | REST | MCP tool |
| --- | --- | --- |
| Create | `POST /api/schedule/create` | `create_schedule` |
| Replace | `POST /api/schedule/update` | `update_schedule` |
| Describe | `GET /api/schedule/describe?namespace=&name=` | `describe_schedule` |
| List | `GET /api/schedule/list?namespace=` | `list_schedules` |
| Pause / resume | `POST /api/schedule/pause`, `/unpause` | `pause_schedule`, `unpause_schedule` |
| Run now | `POST /api/schedule/trigger` | `trigger_schedule` |
| Delete | `POST /api/schedule/delete` | `delete_schedule` |

A create request:

```json
{
  "namespace": "ops",
  "name": "nightly-report",
  "wfspec_info": {"name": "nightly-report"},
  "spec": {"cron": ["0 2 * * *"], "timezone": "America/New_York"},
  "input_data": {"days": 1}
}
```

`spec` takes `cron` (a list) or `every_sec`, plus `timezone`, `jitter_sec`, `overlap`,
`catchup_window_sec`, `paused` and `note`. The API reference at `/docs` on your Moco server has
the exact request and response models.

## From a workflow

A workflow can manage schedules with the [`builtin.schedule.*` activities](../reference/activities/schedule.md),
for example a setup workflow that installs its package's recurring jobs. `builtin.schedule.create`
replaces an existing schedule of the same name by default, so the setup can be run again safely.
The schedules run as the user the setup workflow ran as.

## Permissions

| Action | Who may do it |
| --- | --- |
| Create | Write access to the namespace (`deploy_wfspec`, or namespace admin), and permission to run the workflow |
| Update | The same, plus being the owner or a namespace admin. You become the new owner |
| Describe, list | The owner, or view access to the namespace |
| Pause, resume, run now, delete | The owner or a namespace admin |

Your home namespace (your user id) is always yours to administer.

:::note
A schedule keeps running as its owner. If the owner leaves or loses access, pause the schedule,
or have a namespace admin update it so that it runs as someone else.
:::

## Limits

- Schedules need the Temporal runtime. A server running workflows in memory rejects them.
- A schedule cannot start an entity workflow (a long-lived workflow addressed by a fixed id).
- Fire times have one-second resolution. Two fires of the same schedule cannot start in the
  same second.
