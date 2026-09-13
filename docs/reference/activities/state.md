---
sidebar_label: State Store
---

# State Store Activities

Eight activities read and write a durable key/value store that outlives any single workflow run.
Use it to remember something between runs — a watermark, a task record, a cached lookup — where
workflow context, which dies with the run, would not do.

## Setup

No per-call credentials. The worker connects using `MOCO_DB_CONN_STR`.

:::caution No database means no durability
If `MOCO_DB_CONN_STR` is unset the provider falls back to an in-process store and logs a warning.
State then vanishes on restart and is not shared between workers — fine for a local run, wrong
for anything else.
:::

## Namespaces and keys

Every entry is addressed by `namespace` + `key`, and the namespace you write is not always the
namespace used:

| `in_global_ns` | Resolved namespace | Visible to |
| --- | --- | --- |
| `false` *(default)* | `<user_id>:<namespace>` | Only the calling user |
| `true` | `<namespace>` | Every user of the deployment |

So two users writing `namespace: tasks, key: t-1` privately do not collide, while
`in_global_ns: true` is how a shared task queue or a shared cache is built.

Values are serialized with moco's extended JSON encoder, so typed values — `datetime`, `Decimal`
and friends — round-trip rather than degrading to strings.

:::note The `secret` namespace is off limits
Secrets share this table under the reserved namespaces `secret` and `<user_id>:secret`. Every
activity here rejects them with `ReservedNamespaceError` — including another user's
`<user_id>:secret` — and `list_namespaces` filters them out entirely. Use
[Secret Activities](./secret.md) instead.
:::

## Topics

`topic` is an optional free-text tag on a row, set when you write it. It exists for bulk
filtering (`list_states`) and bulk deletion (`delete_by_topic`) — tagging every task row with its
status, for instance, then listing or clearing one status at a time.

It is a **label on stored data**, unrelated to event-bus topics or to the `relay_topic` used by
[long-running activities](../activity-catalog.md#long-running-activities-and-the-relay-pattern).

Patterns (`key_pattern`, `topic_pattern`, `name_pattern`) use `*` as the wildcard.

:::caution Two topic traps
- **`set_state` always writes the topic column.** Re-saving a value without `topic` *clears* a tag
  set earlier. Use [`update_topic`](#builtinstateupdate_topic) to retag without rewriting.
- **Untagged rows are invisible to topic operations.** `topic_pattern: "*"` does not match rows
  whose topic is null, so `delete_by_topic` will not clear them.
:::

## Defaults

All eight: 60 s timeout, 3 attempts. All are safe to retry — writes are upserts and deletes are
idempotent.

---

## `builtin.state.set_state`

Writes a value, creating the entry or replacing it.

**Input**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `namespace` | str | yes | — | Namespace, resolved per [Namespaces](#namespaces-and-keys) |
| `key` | str | yes | — | Key within the namespace |
| `value` | any | yes | — | The value to store; any JSON-serializable structure |
| `topic` | str | no | `null` | Tag for bulk operations. Omitting it clears an existing tag |
| `in_global_ns` | bool | no | `false` | Write to the shared namespace |

**Output**

None.

**Example**

```yaml
- activity:
    name: save-task
    type: builtin.state.set_state
    input_data:
      in_global_ns: true
      namespace: "tasks"
      key: "{{ task_id }}"
      value:
        task_id: "{{ task_id }}"
        payload: "{{ payload }}"
        submitted_at: "{{ now }}"
      topic: "pending"
```

---

## `builtin.state.get_state`

Reads one value.

**Input**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `namespace` | str | yes | — | Namespace |
| `key` | str | yes | — | Key to read |
| `in_global_ns` | bool | no | `false` | Read from the shared namespace |

**Output**

The stored value, or `null` when the key does not exist. Reading a missing key is not an error.

**Example**

```yaml
- activity:
    name: load-task
    type: builtin.state.get_state
    input_data:
      in_global_ns: true
      namespace: "tasks"
      key: "{{ task_id }}"
    output_name: task

- abort:
    condition: "{{ task is None }}"
    type: raise
    message: "No such task: {{ task_id }}"
```

---

## `builtin.state.get_state_with_ts`

Reads a value together with the time it was last written. Use it to decide whether a cached entry
is still fresh.

**Input**

Same as [`get_state`](#builtinstateget_state): `namespace`, `key`, `in_global_ns`.

**Output**

| Field | Type | Description |
| --- | --- | --- |
| `value` | any | The stored value, or `null` when the key does not exist |
| `last_update_time` | str \| null | ISO-8601 timestamp of the last write, or `null` |

**Example**

```yaml
- activity:
    name: read-cache
    type: builtin.state.get_state_with_ts
    input_data:
      namespace: "fx-rates"
      key: "{{ pair }}"
    output_name: cached

- transform:
    output_data:
      - is_stale: >-
          {{ cached['value'] is None
             or (datetime.now(timezone.utc)
                 - datetime.fromisoformat(cached['last_update_time'])).total_seconds() > 3600 }}
```

---

## `builtin.state.del_state`

Deletes one entry. Deleting a key that does not exist is not an error.

**Input**

Same as [`get_state`](#builtinstateget_state): `namespace`, `key`, `in_global_ns`.

**Output**

None.

**Example**

```yaml
- activity:
    name: forget-task
    type: builtin.state.del_state
    input_data:
      in_global_ns: true
      namespace: "tasks"
      key: "{{ task_id }}"
```

---

## `builtin.state.list_states`

Lists the keys in a namespace, with filtering, ordering and pagination. It returns **keys and
topics only, not values** — fetch the ones you need with `get_state`.

**Input**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `namespace` | str | yes | — | Namespace to list |
| `in_global_ns` | bool | no | `false` | List the shared namespace |
| `key_pattern` | str | no | `null` | Keep keys matching this pattern; `*` is the wildcard |
| `topic_pattern` | str | no | `null` | Keep rows whose topic matches; untagged rows never match |
| `limit` | int | no | `null` | Maximum rows to return |
| `offset` | int | no | `null` | Rows to skip, for paging |
| `order_by` | enum | no | `"key"` | `key`, `last_update_time` or `topic` |
| `order_direction` | enum | no | `"asc"` | `asc` or `desc` |

**Output**

A list of `{key, topic}` objects.

**Example**

The ten most recently touched pending tasks:

```yaml
- activity:
    name: list-pending
    type: builtin.state.list_states
    input_data:
      in_global_ns: true
      namespace: "tasks"
      topic_pattern: "pending"
      order_by: last_update_time
      order_direction: desc
      limit: 10
    output_name: pending      # -> [{key, topic}, ...]
```

---

## `builtin.state.list_namespaces`

Lists the namespaces that hold data.

**Input**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `name_pattern` | str | no | `null` | Keep namespaces matching this pattern; `*` is the wildcard |
| `limit` | int | no | `null` | Maximum namespaces to return |
| `in_global_ns` | bool | no | `false` | List shared namespaces instead of the caller's own |

**Output**

A list of namespace names. Secret namespaces are never included.

**Example**

```yaml
- activity:
    name: list-namespaces
    type: builtin.state.list_namespaces
    input_data:
      name_pattern: "task*"
      in_global_ns: true
    output_name: namespaces   # -> ["tasks", "task-archive", ...]
```

---

## `builtin.state.update_topic`

Retags an existing entry without touching its value or its last-update time. Pass `topic: null` to
clear the tag.

**Input**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `namespace` | str | yes | — | Namespace |
| `key` | str | yes | — | Key to retag |
| `topic` | str | no | `null` | New tag; `null` clears it |
| `in_global_ns` | bool | no | `false` | Operate on the shared namespace |

**Output**

None.

**Example**

Moving a task through its lifecycle, from `moco-examples/task-manager/src/get-task.yaml`:

```yaml
- activity:
    name: update-task-topic
    condition: "{{ has_task }}"
    type: builtin.state.update_topic
    input_data:
      in_global_ns: true
      namespace: "tasks"
      key: "{{ task_id }}"
      topic: "dispatched"
```

:::caution A missing key is a silent no-op
`update_topic` on a key that does not exist does nothing and reports no error — it will not create
the entry. Check with `get_state` first if that distinction matters.
:::

---

## `builtin.state.delete_by_topic`

Deletes every entry in a namespace whose topic matches a pattern, and returns how many it removed.

**Input**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `namespace` | str | yes | — | Namespace to clear within |
| `topic_pattern` | str | yes | — | Topic pattern; `*` is the wildcard |
| `in_global_ns` | bool | no | `false` | Operate on the shared namespace |

**Output**

An integer: the number of rows deleted.

**Example**

```yaml
- activity:
    name: purge-completed
    type: builtin.state.delete_by_topic
    input_data:
      in_global_ns: true
      namespace: "tasks"
      topic_pattern: "completed-*"
    output_name: purged_count   # -> e.g. 42
```

:::caution This deletes many rows at once
`topic_pattern` is required — there is no accidental "delete everything" — but a broad pattern
still clears the whole namespace. Run [`list_states`](#builtinstatelist_states) with the same
pattern first to see what will go. Note also that rows with no topic are never matched, so this
cannot be used to empty a namespace completely.
:::
