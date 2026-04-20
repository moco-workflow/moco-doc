---
sidebar_position: 1
---

# Introduction to Moco

Welcome to **Moco**, a powerful YAML-based declarative workflow orchestration engine with dual runtime support.

## What is Moco?

Moco is a workflow orchestration platform that allows you to define complex workflows using simple YAML syntax, enhanced with Python expressions for dynamic behavior. It supports both in-memory execution (for development and testing) and Temporal.io (for production-grade distributed execution).

## Key Features

### 🎯 Declarative YAML Syntax
Define workflows using intuitive YAML configuration files. No need to write procedural code for workflow logic.

```yaml
wfspec_name: hello-world
wfspec_version: 1.0.0
output_name: result

body:
  transform:
    output_data:
      - result: "Hello, Moco!"
```

### ⚡ Dual Runtime Support
- **In-Memory Runtime**: Fast, synchronous execution perfect for development and testing
- **Temporal.io Runtime**: Production-grade distributed execution with durability, retries, and fault tolerance

Switch between runtimes with a simple environment variable - no code changes required!

### 🔌 Pluggable Activity System
Extend Moco with custom activities or use built-in providers:
- HTTP requests
- Database operations
- Message queue integration (Kafka, RabbitMQ)
- Cloud services (AWS S3, OpenAI)
- Custom business logic

### 🧮 Python Expression Engine
Leverage Python's power within your workflows:
- Data transformations with pandas, numpy, pyarrow
- Conditional logic
- Complex calculations
- Template rendering with Jinja2

### 🎭 Event-Driven State Machines
Build complex, event-driven workflows with explicit state management and transitions.

### 🔄 Parallel and Nested Execution
- Execute workflows in parallel with AND/OR join semantics
- Nest workflows with different execution modes
- Iterate over collections sequentially or in parallel

## Use Cases

- **Data Pipelines**: ETL workflows with transformation and validation
- **Business Process Automation**: Order processing, approval workflows
- **Microservice Orchestration**: Coordinate multiple services
- **AI Agent Coordination**: Multi-agent systems with event-based communication
- **Scheduled Jobs**: Recurring tasks with complex logic

## Architecture at a Glance

```
┌─────────────────────────────────────────────────┐
│           Workflowspec (YAML)                   │
└─────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────┐
│         Workflow Engine                         │
│  • Expression Evaluator                         │
│  • Statement Executor                           │
│  • State Machine Support                        │
└─────────────────────────────────────────────────┘
                      ↓
        ┌─────────────┴─────────────┐
        ↓                           ↓
┌───────────────┐         ┌──────────────────┐
│  In-Memory    │         │   Temporal.io    │
│   Runtime     │         │     Runtime      │
└───────────────┘         └──────────────────┘
        ↓                           ↓
┌─────────────────────────────────────────────────┐
│          Activity Providers                     │
│  • Built-in Activities                          │
│  • Custom Activities                            │
└─────────────────────────────────────────────────┘
```

## Quick Example

Here's a simple workflow that processes an order:

```yaml
wfspec_name: process-order
wfspec_version: 1.0.0

input_data:
  order_id:
  items:
  customer_email:

output_name: result

body:
  sequence:
    elements:
      # Calculate total
      - transform:
          output_data:
            - total: "{{ sum([item['price'] for item in items]) }}"

      # Process payment
      - activity:
          type: payment.charge
          input_data:
            amount: "{{ total }}"
          output_name: payment_result

      # Send confirmation
      - activity:
          type: email.send
          input_data:
            to: "{{ customer_email }}"
            subject: "Order Confirmation"
            body: "Your order {{ order_id }} has been processed!"

      - transform:
          output_data:
            - result:
                order_id: "{{ order_id }}"
                total: "{{ total }}"
                status: completed
```

## Next Steps

- [Quick Start Guide](./quick-start.md) - Get up and running in 5 minutes
- [Core Concepts](./concepts/overview.md) - Understand Moco's architecture
- [Workflowspec Reference](./reference/workflowspec.md) - Complete language reference
- [Development Setup](./guides/development-setup.md) - Set up your development environment
