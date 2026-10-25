# 0057. Custom roles

- Status: Accepted
- Date: 2026-10-25

## Context

The users tab grants roles, but only roles that already exist. Least-privilege access (an
application that may only read and insert into one collection) needs a custom role, and
Studio 3T has a role manager for them. Without one, users go back to the shell.

## Decision

- `users::list_custom_roles` runs `rolesInfo` with `showPrivileges` on each database. The
  databases come from `listDatabases`, plus `admin`, plus the databases named in
  `admin.system.roles` when the user may read it, because a database without data is not listed.
- A privilege is a `Resource` (a namespace, where an empty database or collection means every
  one, the cluster, or any resource) and its actions. `create_role` and `update_role` send them
  with the inherited roles; an update replaces both lists. `drop_role` drops the role.
  Read-only is refused in Rust.
- The users tab lists custom roles under the users. A role's privileges are edited as rows:
  the resource, then its actions as chips with suggestions of common actions. Any action can
  still be typed, since the server's list grows with versions.

## Alternatives considered

- **Reading `admin.system.roles` only** — one query, but it needs a privilege that users who
  administer a single database do not have.
- **A fixed checklist of actions** — clearer for a few actions, but the full list is long and
  differs between server versions.

## Consequences

- A custom role defined for a database that holds no data is found only when the user can read
  `admin.system.roles`.
- `anyResource` privileges are shown but cannot be created: the server reserves them for
  built-in roles.
