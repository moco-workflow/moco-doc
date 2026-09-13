---
sidebar_label: MCP
---

# MCP Activities

One activity, `mcp.call_tool`, invokes a tool on a remote [Model Context
Protocol](https://modelcontextprotocol.io) server and returns its result. Progress notifications
the tool emits along the way are relayed into the workflow as events, so a long tool call can be
followed while it runs.

This is the outbound direction — a moco workflow calling someone else's MCP tool. Moco also
*serves* MCP (`moco-server` exposes `execute_workflow` as a tool); that is a separate thing, covered
in [Running workflows through the API](../../guides/run-moco-workflow-through-api.md).

## Setup

No configuration and no secret-store integration: authentication is a bearer token or API key in
`headers`.

:::caution Tokens in `headers` are visible
They pass through workflow context and history in plaintext.
:::

Only the **streamable-http** transport is supported; stdio servers cannot be reached. The worker
needs the `mcp` package.

## Defaults

86400 s (1 day) timeout, 1 attempt, heartbeating every 20 s against a 60 s timeout. The activity
ends when the tool call completes, so the one-day timeout is a ceiling rather than a duration.

---

## `mcp.call_tool`

Opens a session, initializes it, calls one tool, and returns the result. Each
`notifications/progress` message the tool sends is relayed as a workflow event.

**Input**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `endpoint` | str | yes | — | Streamable-http MCP endpoint URL |
| `tool_name` | str | yes | — | Name of the tool to call |
| `arguments` | dict | no | `null` | Arguments passed to the tool |
| `headers` | dict[str, str] | no | `null` | HTTP headers for the connection |
| `relay_topic` | str | no | `"default"` | Event topic progress is relayed on |
| `relay_event_type` | str | no | `null` | `event_type` stamped on each relayed event |
| `target_workflow_id` | str | no | current workflow | Workflow the events are delivered to |

**Output**

| Field | Type | Description |
| --- | --- | --- |
| `stopped` | bool | Always `true` |
| `result` | object \| null | The MCP `CallToolResult` as JSON, or `null` if the call did not produce one |

**Relayed event data**

Each event's `data` is a progress notification from the tool.

**Examples**

Called synchronously, for the result only — the common case:

```yaml
- activity:
    name: run-remote-tool
    type: mcp.call_tool
    input_data:
      endpoint: "https://tools.example.com/mcp"
      tool_name: "summarize_document"
      arguments:
        document_id: "{{ doc_id }}"
      headers:
        Authorization: "Bearer {{ mcp_token }}"
    retry_policy:
      timeout_sec: 600
    output_name: tool_run     # -> stopped, result

- abort:
    condition: "{{ tool_run['result'] is None }}"
    type: raise
    message: "MCP tool call produced no result"
```

Started asynchronously so the workflow can react to progress, from the provider's integration test:

```yaml
- activity:
    type: mcp.call_tool
    name: start_tool_call
    async_mode: true
    input_data:
      endpoint: "{{ endpoint }}"
      tool_name: "{{ tool_name }}"
      arguments:
        count: "{{ max_count }}"
      relay_topic: mcp.msg
      relay_event_type: mcp_progress
      target_workflow_id: "{{ __sys_info__['workflow_id'] }}"
    retry_policy:
      heartbeat_interval_sec: 0.5
```

:::caution A failed tool call is not an activity failure
An exception inside the streamer is logged and swallowed: the activity returns `stopped: true` with
`result: null`. Always check `result` explicitly rather than assuming a successful activity means a
successful tool call.
:::

:::note Async mode is only for progress
`async_mode: true` lets the workflow continue while the tool runs, but then the activity's
`result` is not available inline — you receive progress events and must collect the outcome another
way. Run it synchronously when you just want the answer.
:::

:::caution At-most-once progress
Progress pushed while the connection is down is not replayed, and with `max_attempts: 1` there is
no retry. Treat progress events as advisory, never as the record of what happened.
:::
