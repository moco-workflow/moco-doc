---
sidebar_label: Writing Workflows
sidebar_position: 2
---

# Writing Workflows

This guide covers practical patterns for authoring Moco workflow specs. It assumes you have the environment set up — if not, see [Development Setup](./development-setup.md).

---

## Anatomy of a Workflow Spec

Every workflowspec is a YAML file with four top-level sections:

```yaml
wfspec_name: my-workflow        # unique identifier
wfspec_version: 1.0.0           # semantic version

context:                         # initial variables (optional)
  retry_limit: 3
  base_url: https://api.example.com

input_data:                      # runtime inputs (optional)
  order_id:                      # required input (no default)
  timeout: 60                    # optional input with default

output_name: result              # variable to return as the workflow result

body:                            # workflow logic — a single statement
  sequence:
    elements:
      - transform:
          output_data:
            - result: "Hello from {{ order_id }}"
```

`body` takes exactly one statement. For multi-step workflows use `sequence` as the root.

---

## Structuring Multi-Step Workflows

### Sequential Steps

Wrap steps in a `sequence` to run them one after another:

```yaml
body:
  sequence:
    elements:
      - transform:
          output_data:
            - status: "starting"

      - activity:
          type: builtin.http_request
          input_data:
            method: GET
            url: "{{ base_url }}/orders/{{ order_id }}"
          output_name: order

      - transform:
          output_data:
            - result: "{{ order.total }}"
```

### Parallel Steps

Use `parallel` to run independent steps concurrently:

```yaml
- parallel:
    join_type: and
    elements:
      - activity:
          name: fetch-user
          type: builtin.http_request
          input_data:
            url: "{{ base_url }}/users/{{ user_id }}"
          output_name: user

      - activity:
          name: fetch-inventory
          type: builtin.http_request
          input_data:
            url: "{{ base_url }}/inventory/{{ product_id }}"
          output_name: inventory
```

Both `user` and `inventory` are available after the parallel block completes.

### Iteration

Loop over a list with `iteration`:

```yaml
- iteration:
    iter_type: sequence
    input_data: "{{ order_items }}"
    body:
      activity:
        type: process-item
        input_data:
          item: "{{ iter_item }}"
          order_id: "{{ order_id }}"
        output_name: item_result
```

Use `iter_type: parallel` to process items concurrently.

---

## Working with Variables

### Context vs Input Data

- **`context`** — initial state for the workflow, set at spec-write time
- **`input_data`** — parameters supplied at runtime when starting the workflow

```yaml
context:
  max_retries: 3          # always 3, baked into spec

input_data:
  order_id:               # caller must supply this
  region: us-east         # caller may override, defaults to "us-east"
```

### Assigning Variables

Use `transform` to compute and assign variables:

```yaml
- transform:
    output_data:
      - subtotal: "{{ quantity * unit_price }}"
      - tax: "{{ subtotal * 0.08 }}"
      - total: "{{ subtotal + tax }}"
```

Assignments within a single `output_data` list are chained — later entries can reference earlier ones.

### Reading Activity Output

Assign an `output_name` to capture what an activity returns:

```yaml
- activity:
    type: builtin.http_request
    input_data:
      url: https://api.example.com/data
    output_name: api_response

- transform:
    output_data:
      - items: "{{ api_response['items'] }}"
```

---

## Conditional Logic

Skip a statement by adding a `condition`:

```yaml
- activity:
    type: send-email
    condition: "{{ order.total > 1000 }}"
    input_data:
      recipient: "{{ order.email }}"
      subject: "Large order confirmation"
```

For branching, combine `condition` with `abort`:

```yaml
- abort:
    condition: "{{ not order.is_valid }}"
    type: raise
    message: "Order {{ order_id }} failed validation"

# This step only runs if the abort didn't fire
- activity:
    type: process-payment
    input_data:
      order: "{{ order }}"
```

---

## Calling HTTP APIs

The `builtin.http_request` activity handles most API integrations:

```yaml
- activity:
    type: builtin.http_request
    config_data:
      base_url: https://api.example.com
      headers:
        Content-Type: application/json
        Authorization: "Bearer {{ api_token }}"
    input_data:
      method: POST
      url: "{{ base_url }}/orders"
      body:
        order_id: "{{ order_id }}"
        items: "{{ cart_items }}"
    output_name: create_response
    timeout_sec: 30
    max_retry_attempts: 3
```

Use `config_data` for values that are the same every time (headers, base URL) and `input_data` for values that change per execution.

---

## Reusing Logic with Child Workflows

Extract reusable logic into a separate workflowspec and call it as a child:

```yaml
- workflow:
    wfspec:
      name: calculate-shipping
      version: 1.0.0
    child_mode: sync
    input_data:
      weight: "{{ order.weight_kg }}"
      destination: "{{ order.ship_to }}"
    output_name: shipping_cost
```

Use `child_mode: inline` when the child needs access to the parent's full context, and `sync` when it should run independently with its own isolated context.

---

## Error Handling Patterns

### Validate Early

Check preconditions at the top of your workflow before doing expensive work:

```yaml
body:
  sequence:
    elements:
      - abort:
          condition: "{{ not order_id }}"
          type: raise
          message: "order_id is required"

      - abort:
          condition: "{{ quantity <= 0 }}"
          type: raise
          message: "quantity must be positive"

      # ... rest of workflow
```

### Retry with Timeouts

Activities retry automatically on failure. Override defaults per activity:

```yaml
- activity:
    type: builtin.http_request
    input_data:
      url: https://flaky-api.example.com/data
    output_name: result
    timeout_sec: 10
    max_retry_attempts: 5
```

### Cache Expensive Calls

Avoid redundant work by caching activity results:

```yaml
- activity:
    type: builtin.http_request
    input_data:
      url: https://api.example.com/reference-data
    output_name: ref_data
    enable_cache: true
    cache_policy:
      ttl_sec: 3600
```

---

## A Complete Example

Order processing workflow with validation, payment, and notification:

```yaml
wfspec_name: process-order
wfspec_version: 1.0.0

input_data:
  order_id:
  customer_email:

output_name: order_status

body:
  sequence:
    elements:
      # Validate
      - abort:
          condition: "{{ not order_id }}"
          type: raise
          message: "order_id required"

      # Fetch order
      - activity:
          type: builtin.http_request
          input_data:
            method: GET
            url: https://api.example.com/orders/{{ order_id }}
          output_name: order
          timeout_sec: 10

      # Process payment and notify in parallel
      - parallel:
          join_type: and
          elements:
            - activity:
                name: charge-payment
                type: builtin.http_request
                input_data:
                  method: POST
                  url: https://payments.example.com/charge
                  body:
                    amount: "{{ order.total }}"
                    customer_id: "{{ order.customer_id }}"
                output_name: payment_result
                timeout_sec: 30

            - activity:
                name: send-confirmation
                type: builtin.http_request
                input_data:
                  method: POST
                  url: https://email.example.com/send
                  body:
                    to: "{{ customer_email }}"
                    subject: "Order {{ order_id }} received"
                timeout_sec: 10

      - transform:
          output_data:
            - order_status: "{{ 'paid' if payment_result.success else 'failed' }}"
```

---

## Next Steps

- [Creating Custom Activities](./creating-activities.md) — extend Moco with your own activity types
- [Testing Workflows](./testing.md) — unit and integration testing patterns
- [Statements Reference](../reference/statements.md) — complete statement syntax
- [Workflowspec Reference](../reference/workflowspec.md) — expressions, conditions, variable modifiers, and more
