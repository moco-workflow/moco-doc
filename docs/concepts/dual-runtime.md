---
sidebar_position: 2
---

# Dual Runtime Architecture

One of Moco's most powerful features is its dual runtime support. The same workflow definition can run on two completely different execution engines without any code changes.

## Why Dual Runtime?

Different stages of the development lifecycle have different requirements:

- **Development & Testing**: Fast iteration, easy debugging, minimal setup
- **Production**: Durability, scalability, fault tolerance, observability

Moco's dual runtime allows you to:
1. Develop and test quickly with the in-memory runtime
2. Deploy confidently to production with Temporal.io
3. Use the same workflow definitions in both environments

## In-Memory Runtime

The in-memory runtime is optimized for development and testing.

### Characteristics

- **Synchronous execution**: Workflows run in the calling process
- **No external dependencies**: No need for Temporal server, databases, etc.
- **Fast**: Minimal overhead, instant startup
- **Deterministic**: Perfect for unit testing
- **Limited durability**: State is lost if process crashes

### When to Use

- Local development
- Unit and integration tests
- CI/CD pipeline tests
- Quick prototyping
- Simple automation scripts

### Example Usage

```python
from moco.core.workflow.runtime.runtime_builder import RuntimeBuilder
from moco.core.workflow.client.client import WorkflowClient

# Build in-memory runtime
runtime_builder = RuntimeBuilder()
runtime = runtime_builder.build_in_memory_runtime()

# Create client
client = WorkflowClient(runtime)

# Execute workflow
result = await client.execute_workflow_from_yaml(
    wfspec_yaml=workflow_yaml,
    input_data={'param': 'value'}
)
```

### Configuration

No configuration needed! Just use `build_in_memory_runtime()`.

## Temporal.io Runtime

The Temporal.io runtime is designed for production workloads.

### Characteristics

- **Asynchronous execution**: Workflows run on distributed workers
- **Durable**: Workflow state persisted to database
- **Fault tolerant**: Automatic retries, workflow replay
- **Scalable**: Horizontal scaling of workers
- **Observable**: Complete execution history and monitoring
- **Activity isolation**: Activities run separately from workflow logic

### When to Use

- Production deployments
- Long-running workflows (days, weeks, months)
- Mission-critical processes
- Workflows requiring high availability
- Complex distributed systems

### Architecture

```
┌──────────────┐
│   Client     │
└──────┬───────┘
       │ Start Workflow
       ↓
┌──────────────────┐     ┌──────────────────┐
│ Temporal Server  │────→│   PostgreSQL     │
│   (Orchestrator) │     │  (State Storage) │
└────────┬─────────┘     └──────────────────┘
         │
         │ Task Queue
         ↓
┌──────────────────┐
│  Workflow Worker │
│  • Execute WF    │
│  • Dispatch Acts │
└────────┬─────────┘
         │
         ↓
┌──────────────────┐
│ Activity Worker  │
│  • Execute Acts  │
│  • Return Result │
└──────────────────┘
```

### Example Usage

```python
from moco.core.workflow.runtime.runtime_builder import RuntimeBuilder
from moco.core.workflow.client.client import WorkflowClient

# Build Temporal runtime (uses environment variables)
runtime_builder = RuntimeBuilder()
runtime = runtime_builder.build_temporal_runtime()

# Create client
client = WorkflowClient(runtime)

# Start workflow (non-blocking)
workflow_handle = await client.start_workflow(
    workflow_name='my-workflow',
    workflow_version='1.0.0',
    workflow_id='unique-id-123',
    input_data={'param': 'value'}
)

# Wait for result (or query later)
result = await workflow_handle.result()
```

### Configuration

Set environment variables:

```bash
export MOCO_RUNTIME_TYPE=temporal
export MOCO_TEMPORALIO_ENDPOINT=localhost:7234
export MOCO_TEMPORALIO_NAMESPACE=moco
export MOCO_TEMPORALIO_TASK_QUEUE=default
```

Or use `.env` file:

```env
MOCO_RUNTIME_TYPE=temporal
MOCO_TEMPORALIO_ENDPOINT=temporal.example.com:7233
MOCO_TEMPORALIO_NAMESPACE=moco
MOCO_TEMPORALIO_TASK_QUEUE=default
```

### Starting Infrastructure

Use Docker Compose to run Temporal locally:

```bash
docker compose -f docker-compose-env.yml up -d
```

This starts:
- Temporal server (UI at http://localhost:8234)
- PostgreSQL (for Temporal state)
- Kafka (for event bus)
- RabbitMQ (for message queue)

### Running Workers

Temporal requires workers to execute workflows:

```bash
# Start workflow/activity worker
.venv/bin/python -m moco_worker.main
```

Workers:
1. Connect to Temporal server
2. Poll task queues for work
3. Execute workflow code
4. Execute activities
5. Report results back to Temporal

## Runtime Selection

Moco automatically selects the runtime based on environment:

```python
# Automatic runtime selection
runtime_builder = RuntimeBuilder()
runtime = runtime_builder.build_runtime()  # Uses MOCO_RUNTIME_TYPE env var
```

You can also explicitly select:

```python
# Explicit in-memory
runtime = runtime_builder.build_in_memory_runtime()

# Explicit Temporal
runtime = runtime_builder.build_temporal_runtime()
```

## Key Differences

| Feature | In-Memory | Temporal.io |
|---------|-----------|-------------|
| Execution Mode | Synchronous | Asynchronous |
| State Persistence | None | Database |
| Fault Tolerance | None | Automatic retry |
| Scalability | Single process | Distributed workers |
| Workflow History | No | Complete history |
| Activity Isolation | Same process | Separate workers |
| Setup Complexity | None | Requires infrastructure |
| Performance | Very fast | Higher latency |
| Use Case | Dev/Test | Production |

## Activity Execution

Activities behave differently in each runtime:

### In-Memory Runtime
- Activities execute in the same process
- No retry by default (unless specified)
- Failures propagate immediately
- Fast execution

### Temporal Runtime
- Activities execute on activity workers
- Automatic retry with exponential backoff
- Failures are tracked in workflow history
- Configurable timeouts:
  - `schedule_to_close_timeout`: Max time from schedule to completion
  - `start_to_close_timeout`: Max time from start to completion
  - `schedule_to_start_timeout`: Max time waiting in queue

## Local Activity Execution

You can force activities to run locally (in workflow process) even with Temporal:

```yaml
- activity:
    type: builtin.simple_calculation
    input_data:
      value: "{{ x }}"
    execute_locally: true  # Run in workflow process
    output_name: result
```

Use for:
- Very fast operations (< 1ms)
- Operations that don't benefit from retries
- Reducing worker overhead

Some activities are local by default and need no `execute_locally` from you. Notably, every
`selenium.*` and `playwright.*` activity is, so that a browser session stays on the same worker
as the workflow that opened it — see
[Activities that are already local by default](./activities.md#activities-that-are-already-local-by-default).

## Testing with Both Runtimes

Write tests that work with both runtimes:

```python
import pytest
from moco.core.workflow.runtime.runtime_builder import RuntimeBuilder

@pytest.mark.parametrize("runtime_type", ["in_memory", "temporal"])
async def test_workflow(runtime_type):
    runtime_builder = RuntimeBuilder()

    if runtime_type == "in_memory":
        runtime = runtime_builder.build_in_memory_runtime()
    else:
        runtime = runtime_builder.build_temporal_runtime()

    client = WorkflowClient(runtime)
    result = await client.execute_workflow_from_yaml(
        wfspec_yaml=workflow_yaml,
        input_data=test_input
    )

    assert result == expected_output
```

## Best Practices

### Development
1. Use in-memory runtime for fast iteration
2. Write unit tests with in-memory runtime
3. Test critical paths with Temporal runtime
4. Keep workflow definitions runtime-agnostic

### Production
1. Always use Temporal runtime in production
2. Configure appropriate timeouts for activities
3. Use separate task queues for different workflow types
4. Monitor workflow execution via Temporal UI
5. Set up alerts for workflow failures

### Workflow Design
1. Keep workflows deterministic
2. Don't use non-deterministic operations in workflow code
3. Push side effects to activities
4. Use activities for external I/O
5. Keep workflow logic focused on orchestration

## Migration Path

Moving from development to production:

1. **Develop**: Use in-memory runtime
   ```bash
   # No environment variables needed
   .venv/bin/pytest
   ```

2. **Test**: Test with Temporal locally
   ```bash
   docker compose -f docker-compose-env.yml up -d
   export MOCO_RUNTIME_TYPE=temporal
   .venv/bin/python -m moco_worker.main &
   .venv/bin/pytest -m integration
   ```

3. **Deploy**: Point to production Temporal
   ```bash
   export MOCO_RUNTIME_TYPE=temporal
   export MOCO_TEMPORALIO_ENDPOINT=temporal.prod.example.com:7233
   export MOCO_TEMPORALIO_NAMESPACE=production
   ```

No code changes required - just environment configuration!

## Next Steps

- [Workflowspec Structure](./workflowspec.md)
- [Expression Syntax](./expressions.md)
- [Development Setup](../guides/development-setup.md)
