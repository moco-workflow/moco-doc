# How to run moco workflows

* Moco workflow execute_mode:
Moco workflow support three exeuction mode:

- workflow (default) -
By default, Moco workflow runs as Temporalio workflow. Child workflow and activity execution are directly mapped to the corresponding Temporalio concept,
executing in distributed cloud envrionment and offering durability guranteee.

- standalone activity
In this mode, Moco workflow is run as Temporalio standalone activity, providing top level durability.
The whole workflow runs as a single standalone activity, intermediate states are not persisted thus not recoverable if interrupted in the middle.
good for idempotent workflow, for better lancency and reduced system overhead.

- in-memory
In this mode, Temporalio is not used during exeuction. The whole Moco workflow runs in in-memory mode inside moco server.
sacrifice durability and distributed cloud computing benefits, but provide best letency.
run workflow as micro service.
Good for idenpotent workflow, no durability requirement.

* entity workflow


### execute_options

