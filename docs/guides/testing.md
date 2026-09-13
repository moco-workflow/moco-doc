---
sidebar_label: Testing Workflows
sidebar_position: 4
---

# Testing Workflows

Moco workflows are YAML documents executed by the workflow engine, which makes them easy to test in isolation. This guide covers unit testing workflow logic with the in-memory runtime and integration testing with real activity providers.

---

## Test Stack

- **pytest** with `asyncio_mode = auto` (configured in `pytest.ini`)
- **In-memory runtime** — runs workflows without Temporal or external services
- **`WorkflowEngine`** directly — the lowest-level option for fast unit tests

---

## Unit Testing: WorkflowEngine Directly

`WorkflowEngine` processes a workflow spec and returns its output. Use it when you want to test pure workflow logic without any activity calls.

```python
import pytest
from moco.core.workflow.engine.workflow_engine import WorkflowEngine

async def test_simple_transform():
    engine = WorkflowEngine()
    result = await engine._run_by_content("""
wfspec_name: greet
wfspec_version: 1.0.0
output_name: message
body:
  transform:
    output_data:
      - message: "Hello, {{ name }}!"
""", input_data={"name": "Alice"})

    assert result == "Hello, Alice!"
```

### Using Fixtures

Extract the engine into a pytest fixture to share it across tests:

```python
import pytest
from moco.core.workflow.engine.workflow_engine import WorkflowEngine

@pytest.fixture
def workflow_engine():
    return WorkflowEngine()

async def test_calculation(workflow_engine):
    result = await workflow_engine._run_by_content("""
wfspec_name: tax-calc
wfspec_version: 1.0.0
output_name: total
body:
  sequence:
    elements:
      - transform:
          output_data:
            - tax: "{{ price * 0.08 }}"
            - total: "{{ price + tax }}"
""", input_data={"price": 100.0})

    assert result == pytest.approx(108.0)
```

### Testing Conditions and Abort

```python
async def test_abort_on_invalid_input(workflow_engine):
    with pytest.raises(Exception):
        await workflow_engine._run_by_content("""
wfspec_name: validate
wfspec_version: 1.0.0
body:
  abort:
    condition: "{{ price < 0 }}"
    type: raise
    message: "Price must be non-negative"
""", input_data={"price": -10})
```

---

## Testing with Activities: InMemoryWorkflowRuntimeBuilder

When your workflow calls activities, use `InMemoryWorkflowRuntimeBuilder` to wire up a real (or mock) activity provider.

```python
import pytest
from moco.core.workflow.runtime.in_memory_workflow_runtime_builder import InMemoryWorkflowRuntimeBuilder
from moco.core.workflow.activity.providers.composite_activity_provider import CompositeActivityProvider
from moco.core.workflow.activity.activity_types import (
    ActivityManifest, ActivityRequest, ActivityResponse, IActivityProvider,
)


class FakeGreetProvider(IActivityProvider):
    def get_activity_manifests(self):
        return [ActivityManifest(activity_type="myapp.greet", version="1.0.0")]

    async def execute_activity(self, request: ActivityRequest) -> ActivityResponse:
        name = (request.input_data or {}).get("name", "World")
        return ActivityResponse(
            activity_type=request.activity_type,
            activity_run_id=request.activity_run_id,
            output_data={"greeting": f"Hello, {name}!"},
        )


@pytest.fixture
async def runtime():
    provider = CompositeActivityProvider(providers=[FakeGreetProvider()])
    builder = InMemoryWorkflowRuntimeBuilder(activity_provider=provider)
    return await builder.build()


async def test_workflow_with_activity(runtime):
    result = await runtime.run_workflow(
        wfspec_content="""
wfspec_name: greet-workflow
wfspec_version: 1.0.0
output_name: message
body:
  sequence:
    elements:
      - activity:
          type: myapp.greet
          input_data:
            name: "{{ customer_name }}"
          output_name: greet_result
      - transform:
          output_data:
            - message: "{{ greet_result.greeting }}"
""",
        input_data={"customer_name": "Bob"},
    )
    assert result == "Hello, Bob!"
```

---

## Testing Custom Activity Providers

Test your `IActivityProvider` implementation directly without running a full workflow:

```python
from myapp.activities import MyActivityProvider
from moco.core.workflow.activity.activity_types import ActivityRequest

async def test_calculate_tax():
    provider = MyActivityProvider()
    request = ActivityRequest(
        activity_type="myapp.calculate_tax",
        input_data={"amount": 100.0, "region": "us"},
    )
    response = await provider.execute_activity(request)
    assert response.output_data["tax"] == pytest.approx(8.0)
    assert response.output_data["total"] == pytest.approx(108.0)

async def test_unknown_activity_raises():
    provider = MyActivityProvider()
    request = ActivityRequest(activity_type="myapp.does_not_exist")
    with pytest.raises(ValueError, match="Unknown activity"):
        await provider.execute_activity(request)
```

---

## Integration Tests

Integration tests run against real services (databases, external APIs). Mark them with `@pytest.mark.integration` so they can be excluded from fast unit test runs:

```python
import pytest

@pytest.mark.integration
async def test_http_activity_real_call(runtime):
    result = await runtime.run_workflow(
        wfspec_content="""
wfspec_name: http-test
wfspec_version: 1.0.0
output_name: status
body:
  sequence:
    elements:
      - activity:
          type: http.request
          input_data:
            method: GET
            url: https://httpbin.org/get
          output_name: response
      - transform:
          output_data:
            - status: "{{ response['url'] }}"
""",
        input_data={},
    )
    assert "httpbin.org" in result
```

Run only unit tests: `pytest tests/unit`  
Run only integration tests: `pytest -m integration`

---

## Parameterized Tests

Use `pytest.mark.parametrize` to cover multiple input combinations efficiently:

```python
import pytest

@pytest.mark.parametrize("price,region,expected_tax", [
    (100.0, "us", 8.0),
    (100.0, "eu", 20.0),
    (0.0, "us", 0.0),
])
async def test_tax_calculation(workflow_engine, price, region, expected_tax):
    result = await workflow_engine._run_by_content("""
wfspec_name: tax
wfspec_version: 1.0.0
output_name: tax
body:
  transform:
    output_data:
      - rate: "{{ {'us': 0.08, 'eu': 0.20}.get(region, 0.10) }}"
      - tax: "{{ price * rate }}"
""", input_data={"price": price, "region": region})

    assert result == pytest.approx(expected_tax)
```

---

## Test File Layout

Follow the pattern used in `moco-core`:

```
tests/
├── conftest.py              # shared fixtures (engine, runtime, providers)
├── unit/
│   └── workflow/
│       ├── conftest.py
│       ├── test_transforms.py
│       ├── test_conditions.py
│       └── test_my_activity.py
└── integration/
    └── workflow/
        ├── conftest.py
        └── test_workflow_integration.py
```

Configure pytest in `pytest.ini`:

```ini
[pytest]
asyncio_mode = auto

markers =
    integration: marks tests as integration tests (deselect with '-m "not integration"')
    slow: marks tests as slow
```

---

## Running Tests

From the project root (using the shared venv):

```bash
# All unit tests
../.venv/bin/pytest tests/unit

# Specific file
../.venv/bin/pytest tests/unit/workflow/test_transforms.py

# Exclude slow or integration tests
../.venv/bin/pytest -m "not integration and not slow"

# With coverage
../.venv/bin/pytest --cov=myapp tests/unit
```

---

## Next Steps

- [Writing Workflows](./writing-workflows.md) — workflow authoring patterns
- [Creating Custom Activities](./creating-activities.md) — implementing `IActivityProvider`
- [Development Setup](./development-setup.md) — environment setup and running services for integration tests
