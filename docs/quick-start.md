---
sidebar_position: 2
---

# Quick Start

Get started with Moco in 5 minutes! This guide will walk you through creating and running your first workflow.

## Prerequisites

- Python 3.10 or higher
- Node.js 18 or higher (for CLI tools)
- Docker (optional, for Temporal.io runtime)

## Installation

### 1. Clone the Repository

```bash
git clone https://github.com/moco-workflow/moco.git
cd moco-workspace
```

### 2. Initialize Submodules

Moco uses git submodules for some components:

```bash
git submodule update --init --recursive
```

### 3. Set Up Python Environment

The workspace uses a shared virtual environment:

```bash
# The virtual environment should already exist at .venv/
# Install dependencies
.venv/bin/pip install -r moco-core/requirements.txt
.venv/bin/pip install -e moco-core/
```

### 4. Install CLI Tools (Optional)

```bash
cd moco-tools
npm install
npm run build
npm run pack

# Install globally
npm i -g moco-lib-0.1.0.tgz moco-cli-0.1.0.tgz
```

## Your First Workflow

Create a file called `hello-world.yaml`:

```yaml
wfspec_name: hello-world
wfspec_version: 1.0.0

context:
  greeting: "Hello"

input_data:
  name: "World"

output_name: message

body:
  transform:
    output_data:
      - message: "{{ greeting }}, {{ name }}!"
```

## Running the Workflow

### Using Python

Create a Python script `run_workflow.py`:

```python
import asyncio
from moco.core.workflow.client.client import WorkflowClient
from moco.core.workflow.runtime.runtime_builder import RuntimeBuilder

async def main():
    # Build in-memory runtime
    runtime_builder = RuntimeBuilder()
    runtime = runtime_builder.build_in_memory_runtime()

    # Create client
    client = WorkflowClient(runtime)

    # Load and execute workflow
    with open('hello-world.yaml', 'r') as f:
        wfspec_yaml = f.read()

    result = await client.execute_workflow_from_yaml(
        wfspec_yaml=wfspec_yaml,
        input_data={'name': 'Moco'}
    )

    print(f"Result: {result}")

if __name__ == "__main__":
    asyncio.run(main())
```

Run it:

```bash
.venv/bin/python run_workflow.py
```

Output:
```
Result: Hello, Moco!
```

### Using CLI (if installed)

```bash
moco run hello-world.yaml --input '{"name": "Moco"}'
```

## Next Example: Data Processing

Create `process-data.yaml`:

```yaml
wfspec_name: process-data
wfspec_version: 1.0.0

input_data:
  numbers: [1, 2, 3, 4, 5]

output_name: result

body:
  sequence:
    elements:
      # Calculate statistics
      - transform:
          output_data:
            - total: "{{ sum(numbers) }}"
            - average: "{{ sum(numbers) / len(numbers) }}"
            - max_value: "{{ max(numbers) }}"
            - min_value: "{{ min(numbers) }}"

      # Double each number
      - iteration:
          iter_type: sequence
          input_data: "{{ numbers }}"
          body:
            transform:
              output_data:
                - doubled: "{{ iter_item * 2 }}"

      # Create result
      - transform:
          output_data:
            - result:
                original: "{{ numbers }}"
                stats:
                  total: "{{ total }}"
                  average: "{{ average }}"
                  max: "{{ max_value }}"
                  min: "{{ min_value }}"
```

## Using Activities

Activities allow you to interact with external systems. Here's an example with HTTP requests:

```yaml
wfspec_name: fetch-data
wfspec_version: 1.0.0

input_data:
  api_url: https://api.github.com/users/github

output_name: user_info

body:
  sequence:
    elements:
      # Fetch user data
      - activity:
          type: builtin.http_request
          input_data:
            method: GET
            url: "{{ api_url }}"
            headers:
              Accept: application/json
          timeout_sec: 30
          output_name: response

      # Extract relevant info
      - transform:
          output_data:
            - user_info:
                name: "{{ response.get('name', 'Unknown') }}"
                company: "{{ response.get('company', 'N/A') }}"
                followers: "{{ response.get('followers', 0) }}"
```

## Running Tests

Moco includes comprehensive tests:

```bash
# Run all tests
.venv/bin/pytest moco-core/

# Run specific tests
.venv/bin/pytest moco-core/tests/unit/
.venv/bin/pytest moco-core/tests/integration/
```

## Using Temporal.io Runtime (Advanced)

For production workloads, use the Temporal.io runtime:

### 1. Start Infrastructure

```bash
docker compose -f docker-compose-env.yml up -d
```

This starts:
- Temporal server (localhost:8234 for UI, localhost:7234 for gRPC)
- PostgreSQL
- Kafka
- RabbitMQ

### 2. Set Environment Variables

```bash
export MOCO_RUNTIME_TYPE=temporal
export MOCO_TEMPORALIO_ENDPOINT=localhost:7234
export MOCO_TEMPORALIO_NAMESPACE=moco
export MOCO_TEMPORALIO_TASK_QUEUE=default
```

### 3. Start a Worker

```bash
.venv/bin/python -m moco_worker.main
```

### 4. Execute Workflow

Your client code remains the same, but now workflows run on Temporal:

```python
# The RuntimeBuilder will automatically use Temporal based on environment variables
runtime = runtime_builder.build_runtime()
```

## Next Steps

Now that you've run your first workflows, explore:

- [Core Concepts](./concepts/overview.md) - Understand how Moco works
- [Workflowspec Reference](./reference/workflowspec.md) - Complete language reference
- [Writing Workflows](./guides/writing-workflows.md) - Best practices and patterns
- [Creating Custom Activities](./guides/creating-activities.md) - Extend Moco with custom activities
