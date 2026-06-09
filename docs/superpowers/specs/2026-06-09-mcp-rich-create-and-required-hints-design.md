# Rich MCP issue create/update + required-field hints

**Date:** 2026-06-09
**Status:** Approved (pending spec review)

## Motivation

The MCP `create_issue` tool only forwards `{ project, summary, description }` to
`api.createIssue`. When a project has a **required** custom field (a field whose
`canBeEmpty` is false — e.g. a mandatory "Squad" or "Team" field), YouTrack
rejects the create with `400: <Field> is required`, and the MCP path has no way
to supply it. The CLI `create`/`update` commands already handle this fully via
`--type`, `--assignee`, `--field`, `--tag`, and link flags, routing through the
pure, tested `prepareCreate` / `applyPrepared` orchestration. The MCP handlers
simply don't use that path.

Two further frictions compound this:

1. `update_issue` (MCP) has the same gap — only `summary`/`description`/`state`.
2. `project_schema` doesn't indicate which fields are **required**, so an agent
   can't know to set them until a create fails. There is no fast way to discover
   the constraint up front.

## Goals

1. Enrich the MCP `create_issue` and `update_issue` tools to accept the same
   field/assignee/type/tag/link inputs the CLI supports.
2. Surface a `required` flag per field in `project_schema` output so an agent
   knows up front which fields must be set at creation.
3. Reframe the README around the MCP server (MCP-first), keeping CLI and library
   docs below it, with neutral/generic LLM usage examples.
4. No behavior change to the CLI; existing tests stay green.

## Non-goals

- No new YouTrack capabilities beyond what the CLI already exposes.
- No change to auth, config, or the keyring/library token model.
- No attempt to use the blocked admin custom-field endpoints; required-ness is
  derived from data already reachable via the schema-via-issue read.

## Design

### 1. Shared orchestration — `src/issue-ops.mjs` (new)

Extract the orchestration currently inlined in `commands/create.mjs` and
`commands/update.mjs` into two reusable functions that take plain structured
arguments (not CLI `options`). Both the CLI commands and the MCP handlers call
these, so the two front-ends can never drift.

```js
// src/issue-ops.mjs
import { AppError } from './api.mjs';
import { prepareCreate, applyPrepared } from './apply-fields.mjs';

// raw shape consumed by prepareCreate: { assignee, fields:[{name,value}], tags,
// relates, dependsOn, subtaskOf }. `type` is folded into fields as Type.
function toRaw({ type, assignee, fields = [], tags = [], relates = [], dependsOn = [], subtaskOf = [] }) {
  return {
    assignee,
    fields: [...fields, ...(type ? [{ name: 'Type', value: type }] : [])],
    tags, relates, dependsOn, subtaskOf,
  };
}

export async function createIssue(api, { project, summary, description, ...rest }) {
  const raw = toRaw(rest);
  const { customFields, commands } = await prepareCreate(api, raw, project);
  const id = await api.createIssue({ project, summary, description, customFields });
  await applyPrepared(api, id, commands);
  return api.readIssue(id);
}

export async function updateIssue(api, id, { summary, description, state, ...rest }) {
  const patch = {};
  if (summary !== undefined) patch.summary = summary;
  if (description !== undefined) patch.description = description;
  if (state !== undefined) patch.state = state;

  const raw = toRaw(rest);
  const hasFieldWork = raw.assignee || raw.fields.length || raw.tags.length ||
    raw.relates.length || raw.dependsOn.length || raw.subtaskOf.length;

  if (Object.keys(patch).length === 0 && !hasFieldWork) {
    throw new AppError('nothing to update: pass at least one of summary, description, state, assignee, fields, tags, relates, dependsOn, subtaskOf');
  }

  const projectKey = id.split('-')[0];
  const { customFields, commands } = hasFieldWork
    ? await prepareCreate(api, raw, projectKey)
    : { customFields: [], commands: [] };

  if (Object.keys(patch).length) await api.updateIssue(id, patch);
  await api.setCustomFields(id, customFields);
  await applyPrepared(api, id, commands);
  return api.readIssue(id);
}
```

`commands/create.mjs` and `commands/update.mjs` become thin adapters: parse CLI
flags (`parseFields`, `asList`, `type`, `assignee`) into the structured object,
then call `createIssue` / `updateIssue`. `parseFields` and `asList` stay in
`commands/create.mjs` (still imported by `update.mjs`). The pure resolve/build
modules (`apply-fields`, `custom-fields`, `resolve`, `build-commands`) are
untouched, so their tests remain valid.

### 2. Enriched MCP tools — `src/mcp-tools.mjs`

`create_issue` and `update_issue` gain optional params and route through the
shared functions. Field inputs use an **array of `{ name, value }`** — a 1:1
match for the internal `raw.fields` shape (multi-value fields = repeat the name).

```js
const FIELD = z.array(z.object({
  name: z.string().describe('Custom field name, e.g. "Type", "Priority"'),
  value: z.string().describe('A single value; repeat the field name for multi-value fields'),
})).optional().describe('Custom fields. Call project_schema first; fields marked required must be set at creation.');

// create_issue
inputSchema: {
  project: z.string().describe('Project short key, e.g. ABC'),
  summary: z.string().describe('Issue summary / title'),
  description: z.string().optional().describe('Markdown description'),
  type: z.string().optional().describe('Issue type, e.g. "Task", "Bug"'),
  assignee: z.string().optional().describe('User login, name, or full name'),
  fields: FIELD,
  tags: z.array(z.string()).optional().describe('Existing tag names (will not create new tags)'),
  relates: z.array(z.string()).optional().describe('Issue IDs to link as "relates to"'),
  dependsOn: z.array(z.string()).optional().describe('Issue IDs this depends on'),
  subtaskOf: z.array(z.string()).optional().describe('Parent issue IDs (this becomes a subtask)'),
},
handler: (api, args) => issueOps.createIssue(api, args),
```

`update_issue` keeps `id`, `summary`, `description`, `state`, and adds the same
`type`/`assignee`/`fields`/`tags`/link params; handler calls
`issueOps.updateIssue(api, id, rest)`.

**Behavior change:** `create_issue` now returns the **full read issue** (like the
CLI) instead of just the id string, so the agent can confirm the fields landed.
Documented as an improvement.

### 3. Required-field hints — `src/api.mjs`

Avoid the blocked admin endpoints. The schema-via-issue read already pulls
`projectCustomField(...)`; extend its selector to include `canBeEmpty`:

```
customFields(name,$type,projectCustomField(canBeEmpty,field(name),bundle(values(name))))
```

`shapeSchema` adds a `required` field:

```js
export function shapeSchema(issue) {
  return (issue.customFields || []).map((cf) => ({
    name: cf.name,
    type: cf.$type ?? null,
    required: cf.projectCustomField?.canBeEmpty === false, // undefined -> false; never over-claim
    values: (cf.projectCustomField?.bundle?.values || []).map((v) => v.name).filter(Boolean),
  }));
}
```

`project_schema` (MCP) and `fields` (CLI) outputs then carry `required`.

**Validation requirement:** before relying on it, confirm YouTrack returns
`canBeEmpty` on `projectCustomField` through the issue read (not only the admin
endpoint). If it does not, `required` degrades to `false` everywhere (safe: no
false "required" claims), and we note the limitation. The implementation plan
must include a real call to verify.

### 4. README reframe (MCP-first, neutral examples)

- **Tagline / positioning:** lead with the MCP server. New framing along the
  lines of: *"trackpilot — an MCP server for YouTrack Cloud (also a CLI and an
  importable ESM library)."*
- **Section order:** MCP server → Library → CLI (currently CLI → Library → MCP).
- **Expanded MCP section:** install (`claude mcp add`, Claude Desktop JSON), auth,
  and a full **tool reference** including the enriched `create_issue`/`update_issue`
  params and the `required` flag in `project_schema`.
- **LLM usage examples:** concrete agent loops using **generic placeholders only**
  — project `ABC`, generic field/user names. No reference to any private project,
  board, squad, ticket, or repository. Example flow: `whoami` → `project_schema ABC`
  (agent sees a field marked `required: true`) → `create_issue` with that field
  set, a `type`, an `assignee`, and `tags`; plus a read → subtask → release loop.
- CLI and Library sections retained below, trimmed of duplication.

### 5. Testing (`node --test`)

- **`test/issue-ops.test.mjs` (new):** with a fake `api`, assert `createIssue`
  passes `customFields` to `api.createIssue` and runs `applyPrepared` commands;
  `updateIssue` applies the patch, calls `setCustomFields`, runs commands, and
  throws the "nothing to update" error when given no work.
- **`test/mcp-tools.test.mjs` (extend):** the new params are accepted by the
  schemas and the handlers forward mapped args to `issue-ops` (stub it or use a
  fake api and assert the resulting calls).
- **`test/shape.test.mjs` (extend) / schema test:** fixture issue with
  `projectCustomField.canBeEmpty: false` → `required: true`; missing/`true` →
  `required: false`.
- Existing CLI command tests continue to pass unchanged (adapters preserve
  behavior).

### 6. Release / versioning

New functionality → **minor** bump (0.6.0 → 0.7.0) via conventional commits
(`feat:`). Publishing is automated by `.github/workflows/publish.yml` on push to
`main` when the version isn't already on npm.

**Rollout note (for the user, not the package):** the MCP server runs via
`npx trackpilot mcp`; after publish, a fresh `npx` (cache miss) or a pinned
version is needed for the running MCP client to pick up the new tools.

## Interfaces / units

- `src/issue-ops.mjs` — `createIssue(api, args)`, `updateIssue(api, id, args)`.
  Depends on `apply-fields`. Pure orchestration over the `api` object; testable
  with a fake api.
- `src/mcp-tools.mjs` — declarative tool registry; depends on `issue-ops`.
- `src/api.mjs` — `shapeSchema` gains `required`; `projectSchema` selector gains
  `canBeEmpty`.
- `commands/create.mjs`, `commands/update.mjs` — thin CLI adapters over
  `issue-ops`.

## Edge cases

- `canBeEmpty` absent → `required: false` (never over-claim).
- Multi-value fields via repeated `{name}` entries — already handled by
  `buildCustomFields` (MULTI_TYPES).
- `update_issue` with no actionable input → existing "nothing to update" error,
  preserved.
- Field/user/tag validation still happens client-side in `prepareCreate` before
  any write, so a bad value fails fast with suggestions and creates nothing.
