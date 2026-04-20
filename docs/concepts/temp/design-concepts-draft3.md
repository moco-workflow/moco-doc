

## computational model
- imperative vs declarative
  - imperative workflow
  - declarative capability
    - native support jinja template in wfspec

```yaml
  transform:
    input_data:
      name: tao
      items: ["item1","item2","item3"]
    output_data:
      templated_content#jinja: |
        <html>
        <body>
            <h1>Hello, {{ name | upper }}!</h1>
            {% if items %}
                <ul>
                {% for item in items %}
                    <li>{{ item }}</li>
                {% endfor %}
                </ul>
            {% else %}
                <p>No items found.</p>
            {% endif %}
        </body>
        </html>
```

- state machine
  - can blend with workflow imperative statements seamlessly

- rules engine
  - can blend with workflow imperative statements seamlessly


## execution model
- in-process execution
- distributed execution

## workflow deployment model
- workflow is deployed like an app rather than a service
- support versioned deployment, multiple versions can coexist
- support staged deployment
- support targetted deploymented, user based targeting list

## virtual workflow runtime
A virtual workflow runtime that
- provides consistent virtual memory space during workflow execution (even executes across nodes in distributed environment)
- garanteed workflow execution (can tolerate temporary error condition during distributed execution)

The virtual workflow runtime and run in-process or run on top of Temporalio for distributed execution

## DSL based workflow spec
- concise
  - focus on business logic
  - abstract away error handling, timeout, retry logic
- decoupled with implementation details
- platform agnostic
- can compose hierachical workflows

## app or service

moco workflows have traits of both app and service
* as app
  - stateful execution
  - versioned deployment with user-based targetting

* as service
  - single 'run-workflow' API can serve as a universal API for any backend logic

## scalable for complex workflows
