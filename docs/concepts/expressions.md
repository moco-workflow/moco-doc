---
sidebar_position: 4
---

# Expression Syntax

Expressions are the heart of Moco's dynamic behavior. They use Python syntax enclosed in `{{ }}` delimiters to evaluate data at runtime.

## Basic Syntax

Expressions use double curly braces:

```yaml
# String interpolation
greeting: "Hello, {{ name }}!"

# Full evaluation
total: "{{ price * quantity }}"

# Boolean expression
is_valid: "{{ price > 0 and quantity > 0 }}"

# Complex expression
result: "{{ sum([x * 2 for x in range(10)]) }}"
```

## Expression Types

Moco supports different expression evaluation modes.

### Python (Default)

Standard Python expression evaluation:

```yaml
# Arithmetic
result: "{{ 10 + 20 * 3 }}"          # 70

# String methods
upper: "{{ name.upper() }}"

# List comprehension
squares: "{{ [x**2 for x in range(5)] }}"  # [0, 1, 4, 9, 16]

# Dictionary access
value: "{{ data['key'] }}"
value: "{{ data.get('key', 'default') }}"

# Conditional
discount: "{{ price * 0.1 if price > 100 else 0 }}"
```

### Python Glom

Path-based data extraction using the glom library:

```yaml
# Extract nested value
user_name: "{{ user.profile.name }}"

# With type specification
user_name#python_glom: "user.profile.name"

# Extract list of values
all_names#python_glom: "users.*.name"

# Complex glom spec
data#python_glom: "orders.0.items.*.price"
```

### Literal

No evaluation - treat as literal string:

```yaml
# Keep template syntax as-is
template#literal: "{{ this_is_not_evaluated }}"

# Useful for passing templates to other systems
jinja_template#literal: "Hello {{ user_name }}!"
```

### Jinja2

Jinja2 template evaluation:

```yaml
# Jinja2 template
message#jinja: >
  Dear {{ customer.name }},
  Your order #{{ order.id }} has been {{ order.status }}.
  {% if order.status == 'shipped' %}
  Tracking: {{ order.tracking_number }}
  {% endif %}
```

## Available in Expressions

### Python Builtins

Whitelisted safe builtins. `eval`, `exec`, `open`, `compile`, `globals`, `getattr`/`setattr` and
the other introspection builtins are removed; `__import__` is unreachable because the expression
scanner rejects the name outright.

```python
abs, all, any, bool, dict, enumerate, filter, float, int, len, list,
map, max, min, range, reversed, round, set, sorted, str, sum, tuple, zip
```

Examples:

```yaml
# Built-in functions
total: "{{ sum(prices) }}"
count: "{{ len(items) }}"
maximum: "{{ max(values) }}"
rounded: "{{ round(price, 2) }}"

# Type conversions
as_int: "{{ int(value) }}"
as_str: "{{ str(number) }}"
as_list: "{{ list(range(5)) }}"
```

### Libraries

Pre-imported libraries available in expressions:

```python
import numpy as np
import pandas as pd
import pyarrow as pa
import glom          # the module: call glom.glom(...), not glom(...)
import bs4           # bs4.BeautifulSoup(...)
```

Each is exposed through a read-only proxy, so **submodules are not reachable** — `pd.io`,
`pd.api`, `np.random`, `np.ctypeslib`, `glom.core` and `pa.fs` all raise. Functions that read or
write the filesystem are either restricted to in-memory buffers (`pd.read_csv(StringIO(...))` is
fine, `pd.read_csv('/path')` is not) or removed (`pd.read_pickle`, `np.load`). For YAML, only
`safe_load`, `safe_dump` and `dump` are available.

Examples:

```yaml
# NumPy
mean: "{{ np.mean([1, 2, 3, 4, 5]) }}"
array: "{{ np.array([1, 2, 3]) }}"

# Pandas
df: "{{ pd.DataFrame({'col1': [1, 2], 'col2': [3, 4]}) }}"
filtered: "{{ df[df['col1'] > 1] }}"

# Glom for complex data extraction (data paths only — no attribute traversal)
value: "{{ glom.glom(data, 'path.to.nested.value') }}"
```

### Special Variables

| Variable | Description |
|----------|-------------|
| `_` | Root context (all variables) |
| `_raw_output` | Raw output from last statement |
| `iter_item` | Current item in iteration |
| `iter_items` | All items in iteration |
| `__user_info__` | User information object |
| `__sys_info__` | System information |

**System Info (`__sys_info__`):**

| Field | Description |
|-------|-------------|
| `trace_id` | Root trace identifier, shared by the parent and every child workflow |
| `workflow_id` | This workflow instance's ID |
| `tier` | Execution tier (`dev`, `beta`, `prod`) — useful for pointing at a staging endpoint outside production |
| `wfspec_name`, `wfspec_version` | The running spec's identity |
| `wfspec_callstack` | The chain of specs that led here |
| `is_continue_as_new` | `True` when this execution was restarted by a [continue-as-new checkpoint](../reference/statements.md#continue_as_new_checkpoint). Always a bool, so it is safe to use directly as a condition |
| `state_machine` | Info about the enclosing state machine; present only while one is running |
| `debug_mode`, `enable_otel_trace` | Whether debug events and OTel tracing are on for this run |

There is no current-timestamp field here — use the `builtin.now` activity, whose result is recorded
and therefore stable across a replay.

Examples:

```yaml
# Access all variables
all_data: "{{ _ }}"

# System info
trace: "{{ __sys_info__.trace_id }}"
wf_id: "{{ __sys_info__['workflow_id'] }}"

# Iteration
- iteration:
    input_data: "{{ [1, 2, 3] }}"
    body:
      transform:
        output_data:
          - current: "{{ iter_item }}"           # 1, then 2, then 3
          - all: "{{ iter_items }}"              # [1, 2, 3]
```

## Variable Modifiers

Modifiers control how variables are evaluated and stored.

### Syntax

```
variableName[@][#modifier...][#]
```

### Container Scope (`@`)

Variables with `@` are temporary and not saved to global context:

```yaml
- transform:
    output_data:
      - temp@: "{{ compute_expensive() }}"  # Temporary
      - result: "{{ temp * 2 }}"            # Can use temp
      # temp is NOT saved to context after this
```

**Use for:**
- Intermediate calculations
- Large data you don't need to persist
- Reducing context size

Example:

```yaml
- transform:
    output_data:
      - subtotal@: "{{ sum(item_prices) }}"
      - tax@: "{{ subtotal * 0.08 }}"
      - shipping@: "{{ 5.99 if subtotal < 50 else 0 }}"
      - total: "{{ subtotal + tax + shipping }}"
      # Only 'total' is saved
```

### Debug Logging (`#`)

Trailing `#` logs the variable value:

```yaml
- transform:
    output_data:
      - debug_value#: "{{ computation() }}"   # Logs value
      - result: "{{ debug_value * 2 }}"
```

### Force Expression Type

Override default expression evaluation:

```yaml
- transform:
    output_data:
      # Force literal (don't evaluate)
      - template#literal: "{{ user_name }}"

      # Force glom path
      - user_name#python_glom: "user.profile.name"

      # Force Jinja2
      - message#jinja: "Hello {{ name }}!"

      # Force python (redundant, but explicit)
      - value#python: "{{ 1 + 1 }}"
```

### Multi-stage Evaluation

Chain modifiers for multiple evaluation passes:

```yaml
- transform:
    output_data:
      - var1: "result_var"
      - var2: "{{ var1 }}"                  # "result_var"
      - result_var: 42
      - nested#python#python: "{{ var2 }}"  # First: "{{ var1 }}" -> "result_var"
                                            # Second: "{{ result_var }}" -> 42
```

**Use for:**
- Dynamic variable references
- Meta-evaluation
- Template-in-template scenarios

### Combined Modifiers

Combine multiple modifiers:

```yaml
# Temporary + debug logging
temp@#: "{{ expensive_calc() }}"

# Container scope + force literal
intermediate@#literal: "{{ template }}"

# Debug + glom + multi-stage
extracted#python_glom#python#: "path.to.value"
```

## Common Patterns

### Conditional Logic

```yaml
# Ternary operator
discount: "{{ price * 0.1 if is_premium else 0 }}"

# Multiple conditions
tier: "{{ 'gold' if points > 1000 else 'silver' if points > 500 else 'bronze' }}"

# Boolean logic
valid: "{{ price > 0 and quantity > 0 and in_stock }}"
```

### List Operations

```yaml
# List comprehension
doubled: "{{ [x * 2 for x in numbers] }}"

# Filter
positive: "{{ [x for x in numbers if x > 0] }}"

# Map
names: "{{ [user['name'] for user in users] }}"

# Nested
result: "{{ [[x*y for x in row] for row in matrix] }}"
```

### Dictionary Operations

```yaml
# Dictionary comprehension
squared: "{{ {k: v**2 for k, v in data.items()} }}"

# Filter dictionary
filtered: "{{ {k: v for k, v in data.items() if v > 0} }}"

# Merge dictionaries
merged: "{{ {**dict1, **dict2} }}"
```

### String Operations

```yaml
# String methods
upper: "{{ text.upper() }}"
lower: "{{ text.lower() }}"
stripped: "{{ text.strip() }}"
replaced: "{{ text.replace('old', 'new') }}"

# String formatting
formatted: "{{ f'Total: ${total:.2f}' }}"

# String interpolation
message: "Hello, {{ name }}! You have {{ count }} messages."
```

## Best Practices

### Keep Expressions Simple

```yaml
# Good: Simple, readable
total: "{{ price * quantity }}"

# Bad: Too complex
result: "{{ sum([item['price'] * item['qty'] * (1 - item.get('discount', 0)) for item in items if item.get('available', True) and item['price'] > 0]) }}"

# Better: Break into steps
- transform:
    output_data:
      - available_items@: "{{ [i for i in items if i.get('available', True) and i['price'] > 0] }}"
      - subtotals@: "{{ [i['price'] * i['qty'] * (1 - i.get('discount', 0)) for i in available_items] }}"
      - total: "{{ sum(subtotals) }}"
```

### Use Temporary Variables

```yaml
# Use @ for intermediate calculations
- transform:
    output_data:
      - base_price@: "{{ item_price * quantity }}"
      - discount@: "{{ base_price * discount_rate }}"
      - tax@: "{{ (base_price - discount) * tax_rate }}"
      - final_price: "{{ base_price - discount + tax }}"
```

### Debug with `#`

```yaml
# Log important values during development
- transform:
    output_data:
      - input_data#: "{{ input }}"
      - processed#: "{{ process(input) }}"
      - result: "{{ finalize(processed) }}"
```

### Validate Inputs

```yaml
# Check for required fields
- abort:
    condition: "{{ not email or '@' not in email }}"
    type: raise
    message: "Invalid email: {{ email }}"
```

## Next Steps

- [Activities](./activities.md) - Learn about activity system
- [Workflowspec Reference](../reference/workflowspec-reference.md) - Complete reference
- [Writing Workflows](../guides/writing-workflows.md) - Best practices
