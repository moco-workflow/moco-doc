---
sidebar_position: 3
---

# Workflowspec Structure

A **workflowspec** is a YAML document that defines a complete workflow in Moco. Understanding its structure is key to building effective workflows.

## Basic Structure

Every workflowspec has this top-level structure:

```yaml
wfspec_name: my-workflow           # Required: Unique workflow identifier
wfspec_version: 1.0.0              # Required: Semantic version

context:                            # Optional: Initial context variables
  variable1: "default value"
  variable2: 42

input_data:                         # Optional: Input parameter definitions
  param1: default_value             # With default
  param2:                           # Required (no default)

output_name: result                 # Optional: Variable to return as result

body:                               # Required: Main workflow logic
  # Any statement goes here
```

## Required Fields

### wfspec_name

A unique identifier for the workflow. Used when:
- Registering workflows with the engine
- Calling child workflows by name
- Versioning and deployment

**Naming conventions:**
- Use lowercase with hyphens: `process-order`, `send-email`
- Be descriptive: `calculate-tax` not `calc`
- Avoid generic names: `workflow1` ❌

### wfspec_version

Semantic version string (e.g., "1.0.0", "2.1.0").

Used for:
- Version management
- Child workflow references
- Deployment tracking

Follow semantic versioning:
- **Major** (1.x.x): Breaking changes
- **Minor** (x.1.x): New features, backward compatible
- **Patch** (x.x.1): Bug fixes

### body

The main workflow logic. Can be any statement type:

```yaml
# Simple transform
body:
  transform:
    output_data:
      - result: "Hello, World!"
```

```yaml
# Complex sequence
body:
  sequence:
    elements:
      - transform:
          output_data:
            - step1: "first"
      - activity:
          type: process-data
          input_data:
            value: "{{ step1 }}"
```

```yaml
# State machine
body:
  state_machine:
    name: order-fsm
    initial_state: pending
    states:
      - name: pending
      - name: completed
        is_terminal: true
```

## Optional Fields

### context

Initial variable values. These variables are available throughout the workflow:

```yaml
context:
  status: "pending"
  counter: 0
  items: []
  config:
    max_retries: 3
    timeout: 30
```

**Use cases:**
- Default values for workflow variables
- Configuration values
- Accumulator variables
- Flags and state

### input_data

Define expected input parameters. Each parameter can have a default value:

```yaml
input_data:
  # Required parameter (no default)
  user_id:

  # Optional parameter (with default)
  limit: 10

  # Complex default
  options:
    verbose: false
    format: json
```

When executing the workflow:

```python
# Provide input_data
result = await client.execute_workflow(
    workflow_name='my-workflow',
    workflow_version='1.0.0',
    input_data={
        'user_id': '12345',
        'limit': 20,  # Override default
        'options': {'verbose': True}
    }
)
```

**Input validation:**
- Missing required parameters raise an error
- Provided values override defaults
- Extra parameters are ignored

### output_name

Specifies which variable to return as the workflow result:

```yaml
output_name: final_result

body:
  sequence:
    elements:
      - transform:
          output_data:
            - temp: "{{ some_calc() }}"
            - final_result: "{{ temp * 2 }}"
      # final_result is returned
```

If not specified:
- In-memory runtime returns the entire context
- Temporal runtime returns None

## Complete Example

```yaml
wfspec_name: order-processing
wfspec_version: 2.1.0

# Initial state
context:
  status: pending
  total: 0
  processed_items: []

# Expected inputs
input_data:
  order_id:                         # Required
  customer_id:                      # Required
  items: []                         # Optional, defaults to empty array
  shipping_method: standard         # Optional, defaults to "standard"

# Return order_result at the end
output_name: order_result

# Main workflow logic
body:
  sequence:
    elements:
      # Validate inputs
      - abort:
          condition:
            - or:
                - "{{ not order_id }}"
                - "{{ not customer_id }}"
                - "{{ len(items) == 0 }}"
          type: raise
          message: "Invalid order: missing required fields"

      # Calculate total
      - transform:
          output_data:
            - subtotal: "{{ sum([item['price'] * item['qty'] for item in items]) }}"
            - tax: "{{ subtotal * 0.08 }}"
            - shipping: "{{ 0 if shipping_method == 'pickup' else 9.99 }}"
            - total: "{{ subtotal + tax + shipping }}"
            - status: processing

      # Process payment
      - activity:
          type: payment.charge
          input_data:
            customer_id: "{{ customer_id }}"
            amount: "{{ total }}"
          timeout_sec: 30
          output_name: payment

      # Check payment
      - abort:
          condition: "{{ not payment.success }}"
          type: raise
          message: "Payment failed: {{ payment.error }}"

      # Create shipment
      - activity:
          type: shipping.create
          input_data:
            order_id: "{{ order_id }}"
            items: "{{ items }}"
            method: "{{ shipping_method }}"
          output_name: shipment

      # Update status
      - transform:
          output_data:
            - status: completed
            - processed_items: "{{ items }}"

      # Build result
      - transform:
          output_data:
            - order_result:
                order_id: "{{ order_id }}"
                status: "{{ status }}"
                total: "{{ total }}"
                tracking: "{{ shipment.tracking_number }}"
                processed_at: "{{ __sys_info__.timestamp }}"
```

## Best Practices

### Naming

- **wfspec_name**: Use descriptive, kebab-case names
  - ✅ `process-customer-order`
  - ❌ `workflow1` or `ProcessCustomerOrder`

- **Variables**: Use snake_case
  - ✅ `customer_email`, `total_price`
  - ❌ `customerEmail`, `TotalPrice`

### Organization

- Keep context variables minimal
- Use input_data for all external parameters
- Always specify output_name for clarity
- Document complex workflows with inline comments

### Versioning

- Start at 1.0.0
- Increment major version for breaking changes
- Increment minor version for new features
- Increment patch version for bug fixes

### Validation

- Validate inputs early in the workflow
- Use abort statements for invalid data
- Provide clear error messages

## Schema Validation

Workflowspecs can be validated against the JSON schema:

```bash
# Located at:
scripts/schema_gen/schemas/workflowspec_schema.json
```

Use with:
- VSCode YAML extension (auto-completion)
- CI/CD validation
- Pre-deployment checks

## Next Steps

- [Expression Syntax](./expressions.md) - Learn about Python expressions
- [Statements Reference](../reference/statements.md) - Complete statement reference
- [Writing Workflows Guide](../guides/writing-workflows.md) - Best practices
