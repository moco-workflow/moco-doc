---
sidebar_label: Deployment & Admin
---

# Deployment Activities

Sixty-seven activities make up moco's control plane: namespaces, workflowspecs, packages and their
files, stages, deployments and targeting, users and groups, roles and privileges, API keys and audit
logs.

**Most people never call these directly.** The `moco` CLI and the console drive them through the
system workflows in `moco-core/src/moco/core/workflow/sys_workflow/` — `moco namespace`,
`moco deploy`, `moco login` and the rest. Use them when you are automating the platform itself: a
release pipeline that publishes a package and rolls it out, a provisioning workflow that creates a
namespace with its roles, a reporting workflow over the audit log.

Because they are one CRUD surface over one database, this page documents them **by family** rather
than one long section per activity: a table covering every activity in the family, then one worked
example. The shapes are consistent enough that the tables are the reference and the example shows
the idiom.

## Setup

No per-call credentials. The provider connects using `MOCO_DEPLOY_DB_CONN_STR`.

Authorization is enforced by the system workflows that wrap these activities (for example
`sys.deploy.assert_privilege`), not by the activities themselves — so a workflow calling them
directly is operating at the control plane's own level of trust.

## Conventions across every family

- **`*.set` is an upsert.** It creates the record if absent and updates it if present. This is
  deliberate: it makes a retried activity safe, where a plain create would fail on a duplicate key.
  Consequently `*.set` activities keep the default `max_attempts: 3`.
- **`*.delete` is not retried** (`max_attempts: 1`), and neither is
  [`apikey.create`](#api-keys), which mints new material on every call.
- **`*.add` / `*.remove` for memberships and targets are idempotent**, so they are safe to retry.
- **Output shapes follow the operation**, not the entity:

  | Operation | Returns |
  | --- | --- |
  | `*.get` | The record as an object, or `null` when it does not exist |
  | `*.list` | A list of record objects |
  | `*.set`, `*.activate`, `*.deactivate`, `*.add` | The resulting record |
  | `*.delete` | `{deleted: true}` |
  | `*.remove` | `{removed: true}`, or `{removed: false, already_removed: true}` |

- Timeouts are 60 s everywhere except `deploy_package` and `package.create_with_files`, which get
  120 s.

---

## Namespaces

A namespace is the top-level grouping for workflowspecs, and the unit access control is scoped to.

| Activity | Purpose | Required input | Optional input |
| --- | --- | --- | --- |
| `builtin.deploy.namespace.set` | Create or update a namespace (upsert by name) | `namespace_id`, `namespace_name` | `description` |
| `builtin.deploy.namespace.get` | Fetch one namespace | — | `namespace_id` |
| `builtin.deploy.namespace.list` | List every namespace | — | — |
| `builtin.deploy.namespace.get_privileged` | List namespaces where the calling user holds any privilege | — | — |
| `builtin.deploy.namespace.delete` | Delete a namespace | `namespace_id` | — |

**Example** — from `sys_workflow/sys.deploy.namespace.yaml`:

```yaml
- activity:
    type: builtin.deploy.namespace.set
    input_data:
      namespace_id: '{{namespace_id}}'
      namespace_name: '{{namespace_name or namespace_id}}'
      description: '{{description}}'
    output_name: result
```

:::note Creating a namespace is more than one activity
The system workflow follows `namespace.set` with `sys.deploy.namespace.authorization` to
initialize the namespace's roles. A provisioning workflow of your own should do the same, or the
namespace exists with nobody able to use it.
:::

---

## Workflowspecs

A wfspec record is the *identity* of a workflow — its name, namespace and ownership. The YAML
itself lives in package files, versioned separately.

| Activity | Purpose | Required input | Optional input |
| --- | --- | --- | --- |
| `builtin.deploy.wfspec.set` | Create or update a wfspec | `wfspec_name` | `namespace_id`, `description`, `owner`, `tags` |
| `builtin.deploy.wfspec.get` | Fetch one wfspec | — | `wfspec_name` |
| `builtin.deploy.wfspec.list` | List wfspecs in a namespace | — | `namespace_id` |
| `builtin.deploy.wfspec.delete` | Delete a wfspec | `wfspec_name` | — |

**Example**

```yaml
- activity:
    name: register-wfspec
    type: builtin.deploy.wfspec.set
    input_data:
      wfspec_name: "reporting.daily-summary"
      namespace_id: "reporting"
      description: "Daily summary report"
      owner: "{{ owner }}"
      tags: ["reporting", "scheduled"]
    output_name: wfspec
```

---

## Packages and files

A package is one **semantic version** of a wfspec, holding the YAML files that make it up. Versions
are `version_major.version_minor.version_patch`.

| Activity | Purpose | Required input | Optional input |
| --- | --- | --- | --- |
| `builtin.deploy.package.set` | Create a package version (idempotent by wfspec + version) | `wfspec_name` | `package_id`, `version_major`, `version_minor`, `version_patch`, `manifest`, `created_by` |
| `builtin.deploy.package.create_with_files` | Create a package **and** its files atomically | `wfspec_name`, `files` | `package_id`, version fields, `manifest`, `created_by` |
| `builtin.deploy.package.get` | Fetch a package by id, or by wfspec + version | — | `package_id`, `wfspec_name`, version fields |
| `builtin.deploy.package.list` | List every version of a wfspec | `wfspec_name` | — |
| `builtin.deploy.package.get_files` | List a package's files | `package_id` | — |
| `builtin.deploy.package.delete` | Delete a package | `package_id` | — |
| `builtin.deploy.package.file.set` | Add or update one file (idempotent by package + filename) | `package_id`, `file_order`, `filename`, `content` | `file_id`, `input_schema`, `output_schema` |
| `builtin.deploy.package.file.get` | Fetch one file by name | `package_id`, `filename` | — |
| `builtin.deploy.package.file.delete` | Delete one file | `file_id` | — |

**Example** — from `sys_workflow/sys.deploy.package.yaml`:

```yaml
- activity:
    condition: '{{operator=="set"}}'
    type: builtin.deploy.package.set
    input_data:
      package_id: '{{package_id}}'
      wfspec_name: '{{wfspec_name}}'
      version_major: '{{version_major}}'
      version_minor: '{{version_minor}}'
      version_patch: '{{version_patch}}'
    output_name: result
```

Creating a package and its files in one step:

```yaml
- activity:
    name: publish-version
    type: builtin.deploy.package.create_with_files
    input_data:
      wfspec_name: "reporting.daily-summary"
      version_major: 1
      version_minor: 2
      version_patch: 0
      created_by: "{{ __user_info__['user_id'] }}"
      files:
        - filename: "daily-summary.yaml"
          file_order: 0
          content: "{{ wfspec_yaml }}"
    retry_policy:
      timeout_sec: 120
    output_name: package
```

:::note Prefer `create_with_files`
It writes the package and every file in one transaction, so a failure cannot leave a version
half-published. Use `package.set` plus `package.file.set` only when you are adding files to a
package that already exists.
:::

---

## Stages, deployments and targeting

A **deployment** puts one package into one **stage**, and **targets** decide which users or groups
see it — the mechanism behind a staged rollout.

| Activity | Purpose | Required input | Optional input |
| --- | --- | --- | --- |
| `builtin.deploy.stage.list` | List the available stages | — | — |
| `builtin.deploy.deployment.set` | Create or update a deployment (upsert by id, or by package + stage) | `package_id`, `stage_id` | `deployment_id`, `is_active`, `deployed_by` |
| `builtin.deploy.deployment.get` | Fetch one deployment | `deployment_id` | — |
| `builtin.deploy.deployment.list` | List deployments | — | `stage_id`, `package_id` |
| `builtin.deploy.deployment.activate` | Make a deployment live | `deployment_id` | — |
| `builtin.deploy.deployment.deactivate` | Take a deployment out of service | `deployment_id` | — |
| `builtin.deploy.target.add` | Target a user or group | `deployment_id` | `target_user_id`, `target_group_id`, `created_by` |
| `builtin.deploy.target.list` | List a deployment's targets | `deployment_id` | — |
| `builtin.deploy.target.remove` | Remove a target | — | `target_id`, `deployment_id`, `target_user_id`, `target_group_id` |
| `builtin.deploy.deploy_package` | Create the deployment **and** add its targets in one call | `package_id`, `stage_id` | `target_user_ids`, `target_group_ids`, `deployed_by` |
| `builtin.deploy.undeploy_package` | Deactivate a deployment | `deployment_id` | `performed_by` |

**Example** — from `sys_workflow/sys.deploy.deployment.yaml`:

```yaml
- activity:
    condition: '{{operator=="set"}}'
    type: builtin.deploy.deployment.set
    input_data:
      deployment_id: '{{deployment_id}}'
      package_id: '{{package_id}}'
      stage_id: '{{stage_id}}'
      deployed_by: '{{deployed_by}}'
    output_name: result

- activity:
    condition: '{{operator=="activate"}}'
    type: builtin.deploy.deployment.activate
    input_data:
      deployment_id: '{{deployment_id}}'
    output_name: result
```

A staged rollout in one activity:

```yaml
- activity:
    name: roll-out-to-beta
    type: builtin.deploy.deploy_package
    input_data:
      package_id: "{{ package['package_id'] }}"
      stage_id: "beta"
      target_group_ids: ["beta-testers"]
      deployed_by: "{{ __user_info__['user_id'] }}"
    retry_policy:
      timeout_sec: 120
    output_name: deployment
```

---

## Deployment queries

Read-only questions about what is deployed and who can see it. These back the platform's own
version resolution.

| Activity | Purpose | Required input | Optional input |
| --- | --- | --- | --- |
| `builtin.deploy.query.get_latest_package` | Latest package version of a wfspec | `namespace_id`, `wfspec_name` | — |
| `builtin.deploy.query.get_wfspec_versions` | Every package version of a wfspec | `wfspec_name` | — |
| `builtin.deploy.query.get_targeted_wfspec_version` | The version a given user resolves to in a stage | `wfspec_name`, `user_id`, `stage_id` | `version_filter` |
| `builtin.deploy.query.get_user_deployments` | Active deployments a user can see in a stage | `user_id`, `stage_id` | — |
| `builtin.deploy.query.is_user_targeted` | Whether a deployment targets a user — returns `{is_targeted: bool}` | `user_id`, `deployment_id` | — |
| `builtin.deploy.query.get_group_members` | Group members, resolved recursively — returns `{user_ids: [...]}` | `group_id` | — |

**Example**

```yaml
- activity:
    name: resolve-version
    type: builtin.deploy.query.get_targeted_wfspec_version
    input_data:
      wfspec_name: "reporting.daily-summary"
      user_id: "{{ target_user }}"
      stage_id: "prod"
    output_name: resolved     # -> the package record, or null
```

---

## Users

| Activity | Purpose | Required input | Optional input |
| --- | --- | --- | --- |
| `builtin.deploy.user.set` | Create or update a user account (upsert; only non-null fields are written) | `user_id` | `display_name`, `email`, `user_org`, `user_metadata`, `record_login` |
| `builtin.deploy.user.get` | Fetch a user | `user_id` | — |
| `builtin.deploy.user.list` | List users | — | `status`, `limit`, `offset` |
| `builtin.deploy.user.disable` | Disable an account and revoke its API keys (idempotent) | `user_id` | — |
| `builtin.deploy.user.delete` | Delete an account and its API keys | `user_id` | — |

**Example**

```yaml
- activity:
    name: record-login
    type: builtin.deploy.user.set
    input_data:
      user_id: "{{ user_id }}"
      display_name: "{{ display_name }}"
      email: "{{ email }}"
      record_login: true      # stamps timestamps and promotes a provisional account
    output_name: user
```

:::caution Disabling blocks API keys, not tokens
`user.disable` revokes the account's API keys, but an already-issued JWT keeps authenticating until
it expires.

`user.delete` refuses system accounts, and does **not** remove the user's group memberships or role
grants — clean those up separately if you are removing someone properly.
:::

---

## Groups

Groups can contain users and other groups; membership resolves recursively.

| Activity | Purpose | Required input | Optional input |
| --- | --- | --- | --- |
| `builtin.deploy.group.set` | Create or update a group (upsert by id or name) | `name` | `group_id`, `description` |
| `builtin.deploy.group.get` | Fetch a group by id or name | — | `group_id`, `name` |
| `builtin.deploy.group.list` | List every group | — | — |
| `builtin.deploy.group.list_members` | List a group's **direct** members | `group_id` | — |
| `builtin.deploy.group.member.add` | Add a user or nested group | `group_id` | `member_user_id`, `member_group_id` |
| `builtin.deploy.group.member.remove` | Remove a member | — | `member_id`, `group_id`, `member_user_id`, `member_group_id` |
| `builtin.deploy.group.delete` | Delete a group | `group_id` | — |

**Example**

```yaml
- activity:
    name: create-group
    type: builtin.deploy.group.set
    input_data:
      name: "beta-testers"
      description: "Early access cohort"
    output_name: group

- activity:
    name: add-member
    type: builtin.deploy.group.member.add
    input_data:
      group_id: "{{ group['group_id'] }}"
      member_user_id: "{{ user_id }}"
```

:::note Direct vs recursive membership
`group.list_members` returns direct members only. For the fully expanded user list, use
[`builtin.deploy.query.get_group_members`](#deployment-queries).
:::

---

## Roles and privileges

Access control is role-based: a **resource** plus an **action** makes a **privilege**, privileges
are attached to **roles**, and users or groups are members of roles.

### Resources

| Activity | Purpose | Required input | Optional input |
| --- | --- | --- | --- |
| `builtin.deploy.auth.resource.set` | Create or update a resource (upsert by id, or type + value) | `resource_type`, `resource_value` | `resource_id`, `description` |
| `builtin.deploy.auth.resource.get` | Fetch a resource by id, or type + value | — | `resource_id`, `resource_type`, `resource_value` |
| `builtin.deploy.auth.resource.list` | List resources | — | `resource_type` |
| `builtin.deploy.auth.resource.delete` | Delete a resource | `resource_id` | — |

### Privileges

| Activity | Purpose | Required input | Optional input |
| --- | --- | --- | --- |
| `builtin.deploy.auth.privilege.set` | Create or update a privilege (upsert by id, or resource + action) | `resource_id`, `action` | `privilege_id`, `description` |
| `builtin.deploy.auth.privilege.get` | Fetch a privilege | — | `privilege_id`, `resource_id`, `action` |
| `builtin.deploy.auth.privilege.list` | List privileges | — | `resource_id` |
| `builtin.deploy.auth.privilege.delete` | Delete a privilege | `privilege_id` | — |

### Roles

| Activity | Purpose | Required input | Optional input |
| --- | --- | --- | --- |
| `builtin.deploy.auth.role.set` | Create or update a role (upsert by id) | `namespace_id`, `role_name` | `role_id`, `description` |
| `builtin.deploy.auth.role.get` | Fetch a role | `role_id` | — |
| `builtin.deploy.auth.role.list` | List roles | — | `namespace_id` |
| `builtin.deploy.auth.role.delete` | Delete a role | `role_id` | — |
| `builtin.deploy.auth.role.privilege.add` | Grant a privilege to a role | `role_id`, `privilege_id` | — |
| `builtin.deploy.auth.role.privilege.list` | List a role's privileges | `role_id` | — |
| `builtin.deploy.auth.role.privilege.remove` | Revoke a privilege from a role | `role_id`, `privilege_id` | — |
| `builtin.deploy.auth.role.member.add` | Add a user or group to a role | `role_id` | `user_id`, `group_id` |
| `builtin.deploy.auth.role.member.list` | List a role's members | `role_id` | — |
| `builtin.deploy.auth.role.member.remove` | Remove a member from a role | — | `member_id`, `role_id`, `user_id`, `group_id` |

### Effective access

| Activity | Purpose | Required input | Optional input |
| --- | --- | --- | --- |
| `builtin.deploy.auth.check_user_privilege` | Whether a user holds a privilege, directly or via a group — returns `{has_privilege: bool}` | `user_id`, `privilege_id` | — |
| `builtin.deploy.auth.get_user_privileges` | Every privilege a user holds — returns `{privileges: [...]}` | `user_id` | `namespace_id` |
| `builtin.deploy.auth.get_user_roles` | Every role a user belongs to | `user_id` | `namespace_id` |

**Example** — granting a namespace role to a group:

```yaml
- activity:
    name: define-role
    type: builtin.deploy.auth.role.set
    input_data:
      namespace_id: "reporting"
      role_name: "reporting-operator"
      description: "May run and deploy reporting workflows"
    output_name: role

- activity:
    name: grant-privilege
    type: builtin.deploy.auth.role.privilege.add
    input_data:
      role_id: "{{ role['role_id'] }}"
      privilege_id: "{{ deploy_privilege_id }}"

- activity:
    name: add-group-to-role
    type: builtin.deploy.auth.role.member.add
    input_data:
      role_id: "{{ role['role_id'] }}"
      group_id: "reporting-team"
```

Checking effective access:

```yaml
- activity:
    name: may-deploy
    type: builtin.deploy.auth.check_user_privilege
    input_data:
      user_id: "{{ user_id }}"
      privilege_id: "{{ deploy_privilege_id }}"
    output_name: check          # -> {has_privilege: bool}

- abort:
    condition: "{{ not check['has_privilege'] }}"
    type: raise
    message: "{{ user_id }} may not deploy to this namespace"
```

This is the *stored* RBAC model. The policy-evaluation activities in
[Authorization](./authz.md) are a different thing: they evaluate a resource policy against evidence
about the caller at run time.

---

## API keys

Every activity here operates on the **calling user's own keys**.

| Activity | Purpose | Required input | Optional input |
| --- | --- | --- | --- |
| `builtin.deploy.apikey.create` | Mint a key. Returns the plaintext **once** | `name` | `scopes`, `expires_at` |
| `builtin.deploy.apikey.get` | Fetch one key's metadata. Never the secret | `key_id` | — |
| `builtin.deploy.apikey.list` | List the caller's keys. Never the secrets | — | `include_revoked` |
| `builtin.deploy.apikey.revoke` | Revoke a key (idempotent) | `key_id` | — |
| `builtin.deploy.apikey.delete` | Delete a key permanently | `key_id` | — |
| `builtin.deploy.apikey.lookup` | Look up verification material by the non-secret `key_prefix` | `key_prefix` | `touch` |

`apikey.create` returns `{api_key, key_info}`; every other activity returns metadata only.

**Example** — from `sys_workflow/sys.apikey.yaml`:

```yaml
- activity:
    condition: '{{operator=="create"}}'
    type: builtin.deploy.apikey.create
    input_data:
      name: '{{name}}'
      scopes: '{{scopes}}'
      expires_at: '{{expires_at}}'
    output_name: result

- activity:
    condition: '{{operator=="revoke"}}'
    type: builtin.deploy.apikey.revoke
    input_data:
      key_id: '{{key_id}}'
    output_name: result
```

:::danger The plaintext key is returned exactly once
`apikey.create` is the only place the secret ever exists outside the caller. It is not recoverable
afterwards — and it is not retried (`max_attempts: 1`), because a retry would mint a second key and
strand the first. Deliver it to its destination in the same run; do not cache it, and do not write
it to workflow state.
:::

:::caution `apikey.lookup` is sensitive
It returns a key's verification material for a caller that will compare the secret itself. It is
part of the authentication path, not an administrative convenience.
:::

---

## Audit log

| Activity | Purpose | Required input | Optional input |
| --- | --- | --- | --- |
| `builtin.deploy.audit.get_logs` | Query the deployment audit log | — | `package_id`, `stage_id`, `performed_by`, `action`, `limit` |

**Example**

```yaml
- activity:
    name: recent-deploys
    type: builtin.deploy.audit.get_logs
    input_data:
      stage_id: "prod"
      action: "deploy"
      limit: 50
    output_name: audit_entries
```
