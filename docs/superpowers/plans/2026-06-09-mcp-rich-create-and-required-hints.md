# Rich MCP create/update + required hints + full parity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the MCP server full parity with the CLI/library — rich `create_issue`/`update_issue` (type, assignee, custom fields, tags, links), `required`-field hints in `project_schema`, and the two missing tools (`release`, `preview_command`) — and reframe the README MCP-first.

**Architecture:** Extract the create/update orchestration the CLI commands already do into a shared `src/issue-ops.mjs`; both the CLI commands and the MCP handlers call it, so they can't drift. Do the same for the release diff (`src/release-diff.mjs`). Required-ness is read from `projectCustomField.canBeEmpty` via the existing schema-via-issue request — no blocked admin endpoint.

**Tech Stack:** Node ESM (`.mjs`), `zod` for MCP input schemas, `@modelcontextprotocol/sdk`, `node:test` + `node:assert/strict`.

**Spec:** `docs/superpowers/specs/2026-06-09-mcp-rich-create-and-required-hints-design.md`

---

## File Structure

- **Create** `src/issue-ops.mjs` — `createIssue(api, args)`, `updateIssue(api, id, args)`. Shared orchestration over the `api` object.
- **Create** `src/release-diff.mjs` — `releaseDiff(api, { base, head, cwd })`. Shared release logic (moved out of `commands/release.mjs`).
- **Create** `test/issue-ops.test.mjs`, **create** `test/release-diff.test.mjs`.
- **Modify** `src/commands/create.mjs`, `src/commands/update.mjs`, `src/commands/release.mjs` — thin CLI adapters.
- **Modify** `src/git.mjs` — `commitMessages(base, head, { cwd })` optional cwd.
- **Modify** `src/mcp-tools.mjs` — enrich `create_issue`/`update_issue`; add `release`, `preview_command`.
- **Modify** `src/api.mjs` — `shapeSchema` gains `required`; `projectSchema` selector gains `canBeEmpty`.
- **Modify** `test/mcp-tools.test.mjs`, `test/shape.test.mjs`.
- **Modify** `README.md`, `package.json` (version).

---

## Task 1: Shared issue-ops orchestration

**Files:**
- Create: `src/issue-ops.mjs`
- Test: `test/issue-ops.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `test/issue-ops.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createIssue, updateIssue } from '../src/issue-ops.mjs';
import { AppError } from '../src/api.mjs';

// Records calls; returns canned values keyed by method name.
function fakeApi(returns = {}) {
  const calls = [];
  const api = new Proxy({}, {
    get(_t, method) {
      return (...args) => {
        calls.push({ method, args });
        return returns[method] ?? { ok: method };
      };
    },
  });
  return { api, calls };
}

test('createIssue with no extra fields: createIssue([{...customFields:[]}]) then readIssue', async () => {
  const { api, calls } = fakeApi({ createIssue: 'ABC-1', readIssue: { id: 'ABC-1' } });
  const out = await createIssue(api, { project: 'ABC', summary: 'S', description: 'D' });
  assert.deepEqual(calls[0], { method: 'createIssue', args: [{ project: 'ABC', summary: 'S', description: 'D', customFields: [] }] });
  assert.deepEqual(calls.at(-1), { method: 'readIssue', args: ['ABC-1'] });
  assert.deepEqual(out, { id: 'ABC-1' });
});

test('createIssue folds type into customFields and resolves enum values', async () => {
  const { api, calls } = fakeApi({
    projectSchema: [{ name: 'Type', type: 'SingleEnumIssueCustomField', values: ['Task', 'Bug'] }],
    createIssue: 'ABC-2',
    readIssue: { id: 'ABC-2' },
  });
  await createIssue(api, { project: 'ABC', summary: 'S', type: 'Task' });
  const create = calls.find((c) => c.method === 'createIssue');
  assert.deepEqual(create.args[0].customFields, [
    { name: 'Type', $type: 'SingleEnumIssueCustomField', value: { name: 'Task' } },
  ]);
});

test('updateIssue applies patch, setCustomFields, then readIssue', async () => {
  const { api, calls } = fakeApi({ readIssue: { id: 'ABC-1' } });
  await updateIssue(api, 'ABC-1', { state: 'Fixed' });
  const methods = calls.map((c) => c.method);
  assert.deepEqual(methods, ['updateIssue', 'setCustomFields', 'readIssue']);
  assert.deepEqual(calls[0], { method: 'updateIssue', args: ['ABC-1', { state: 'Fixed' }] });
});

test('updateIssue with no actionable input throws', async () => {
  const { api } = fakeApi();
  await assert.rejects(() => updateIssue(api, 'ABC-1', {}), (e) => e instanceof AppError && /nothing to update/.test(e.message));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/issue-ops.test.mjs`
Expected: FAIL — `Cannot find module '../src/issue-ops.mjs'`.

- [ ] **Step 3: Write the implementation**

Create `src/issue-ops.mjs`:

```js
// Shared create/update orchestration used by BOTH the CLI commands and the MCP
// tools, so the two front-ends can never drift. Takes plain structured args
// (not CLI options).

import { AppError } from './api.mjs';
import { prepareCreate, applyPrepared } from './apply-fields.mjs';

// Build the `raw` shape prepareCreate expects. `type` is folded in as the
// "Type" custom field (matching the CLI's --type behavior).
function toRaw({ type, assignee, fields = [], tags = [], relates = [], dependsOn = [], subtaskOf = [] } = {}) {
  return {
    assignee,
    fields: [...fields, ...(type ? [{ name: 'Type', value: type }] : [])],
    tags,
    relates,
    dependsOn,
    subtaskOf,
  };
}

export async function createIssue(api, { project, summary, description, ...rest } = {}) {
  const raw = toRaw(rest);
  const { customFields, commands } = await prepareCreate(api, raw, project);
  const id = await api.createIssue({ project, summary, description, customFields });
  await applyPrepared(api, id, commands);
  return api.readIssue(id);
}

export async function updateIssue(api, id, { summary, description, state, ...rest } = {}) {
  const patch = {};
  if (summary !== undefined) patch.summary = summary;
  if (description !== undefined) patch.description = description;
  if (state !== undefined) patch.state = state;

  const raw = toRaw(rest);
  const hasFieldWork =
    raw.assignee || raw.fields.length || raw.tags.length ||
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

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/issue-ops.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/issue-ops.mjs test/issue-ops.test.mjs
git commit -m "feat: extract shared issue-ops create/update orchestration"
```

---

## Task 2: CLI create/update become thin adapters over issue-ops

**Files:**
- Modify: `src/commands/create.mjs`
- Modify: `src/commands/update.mjs`

- [ ] **Step 1: Rewrite `src/commands/create.mjs`**

Replace the whole file with (keeps `parseFields`/`asList` exports — `update.mjs` imports them):

```js
// trackpilot create --project <KEY> --summary "..." [--description "..."]
//   [--type <Type>] [--assignee <user>] [--field "Name=Value" ...]
//   [--tag <name> ...] [--relates <ID> ...] [--depends-on <ID> ...] [--subtask-of <ID> ...]

import { AppError } from '../api.mjs';
import { createIssue } from '../issue-ops.mjs';

// "Name=Value" (repeatable) -> [{ name, value }]
export function parseFields(raw) {
  if (raw === undefined) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((entry) => {
    if (typeof entry !== 'string' || !entry.includes('=')) {
      throw new AppError(`--field must be "Name=Value", got: ${entry}`);
    }
    const eq = entry.indexOf('=');
    return { name: entry.slice(0, eq).trim(), value: entry.slice(eq + 1).trim() };
  });
}

// A repeatable flag may arrive as undefined | string | string[]; normalize.
export function asList(v) {
  if (v === undefined) return [];
  return (Array.isArray(v) ? v : [v]).filter((x) => typeof x === 'string');
}

export async function run({ api, options }) {
  const project = options.project;
  const summary = options.summary;
  if (!project || project === true) throw new AppError('--project <KEY> is required');
  if (!summary || summary === true) throw new AppError('--summary "<text>" is required');

  return createIssue(api, {
    project,
    summary,
    description: typeof options.description === 'string' ? options.description : undefined,
    type: typeof options.type === 'string' ? options.type : undefined,
    assignee: typeof options.assignee === 'string' ? options.assignee : undefined,
    fields: parseFields(options.field),
    tags: asList(options.tag),
    relates: asList(options.relates),
    dependsOn: asList(options['depends-on']),
    subtaskOf: asList(options['subtask-of']),
  });
}
```

- [ ] **Step 2: Rewrite `src/commands/update.mjs`**

Replace the whole file with:

```js
// trackpilot update <id> [--summary ...] [--description ...] [--state ...]
//   [--type <Type>] [--assignee <user>] [--field "Name=Value" ...] [--tag <name> ...]
//   [--relates <ID> ...] [--depends-on <ID> ...] [--subtask-of <ID> ...]

import { AppError } from '../api.mjs';
import { updateIssue } from '../issue-ops.mjs';
import { parseFields, asList } from './create.mjs';

export async function run({ api, positionals, options }) {
  const id = positionals[0];
  if (!id) {
    throw new AppError('usage: trackpilot update <issue-id> [--summary ...] [--field ...] [--assignee ...] [--tag ...] [--relates ...]');
  }

  return updateIssue(api, id, {
    summary: typeof options.summary === 'string' ? options.summary : undefined,
    description: typeof options.description === 'string' ? options.description : undefined,
    state: typeof options.state === 'string' ? options.state : undefined,
    type: typeof options.type === 'string' ? options.type : undefined,
    assignee: typeof options.assignee === 'string' ? options.assignee : undefined,
    fields: parseFields(options.field),
    tags: asList(options.tag),
    relates: asList(options.relates),
    dependsOn: asList(options['depends-on']),
    subtaskOf: asList(options['subtask-of']),
  });
}
```

Note: `updateIssue` ignores `undefined` patch keys, so passing them explicitly is safe and preserves the "nothing to update" guard.

- [ ] **Step 3: Run the full suite to verify no regression**

Run: `node --test`
Expected: PASS (all existing tests + Task 1 tests green).

- [ ] **Step 4: Commit**

```bash
git add src/commands/create.mjs src/commands/update.mjs
git commit -m "refactor: CLI create/update delegate to issue-ops"
```

---

## Task 3: Enrich the MCP `create_issue` / `update_issue` tools

**Files:**
- Modify: `src/mcp-tools.mjs`
- Modify: `test/mcp-tools.test.mjs`

- [ ] **Step 1: Update the failing tests in `test/mcp-tools.test.mjs`**

Replace the existing `create_issue` and `update_issue` test cases (the two `test(...)` blocks at lines ~75-85) with:

```js
test('create_issue routes through issue-ops: createIssue then readIssue', async () => {
  const { api, calls } = fakeApi({ createIssue: 'ABC-1', readIssue: { id: 'ABC-1' } });
  const out = await tool('create_issue').handler(api, { project: 'ABC', summary: 'S', description: 'D' });
  assert.deepEqual(calls[0], { method: 'createIssue', args: [{ project: 'ABC', summary: 'S', description: 'D', customFields: [] }] });
  assert.deepEqual(calls.at(-1), { method: 'readIssue', args: ['ABC-1'] });
  assert.deepEqual(out, { id: 'ABC-1' });
});

test('create_issue forwards custom fields through to api.createIssue', async () => {
  const { api, calls } = fakeApi({
    projectSchema: [{ name: 'Priority', type: 'SingleEnumIssueCustomField', values: ['Normal', 'Major'] }],
    createIssue: 'ABC-3',
    readIssue: { id: 'ABC-3' },
  });
  await tool('create_issue').handler(api, { project: 'ABC', summary: 'S', fields: [{ name: 'Priority', value: 'Major' }] });
  const create = calls.find((c) => c.method === 'createIssue');
  assert.deepEqual(create.args[0].customFields, [
    { name: 'Priority', $type: 'SingleEnumIssueCustomField', value: { name: 'Major' } },
  ]);
});

test('update_issue routes through issue-ops: updateIssue patch then readIssue', async () => {
  const { api, calls } = fakeApi({ readIssue: { id: 'ABC-1' } });
  await tool('update_issue').handler(api, { id: 'ABC-1', state: 'Fixed' });
  assert.deepEqual(calls[0], { method: 'updateIssue', args: ['ABC-1', { state: 'Fixed' }] });
  assert.equal(calls.at(-1).method, 'readIssue');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/mcp-tools.test.mjs`
Expected: FAIL — current `create_issue` handler calls `api.createIssue` with `{project,summary,description}` (no `customFields`) and never calls `readIssue`.

- [ ] **Step 3: Update `src/mcp-tools.mjs`**

Add the import at the top (after the `zod` import):

```js
import { createIssue, updateIssue } from './issue-ops.mjs';
```

Replace the `create_issue` tool object (lines ~60-71) with:

```js
  {
    name: 'create_issue',
    title: 'Create issue',
    description: 'Create an issue. Returns the full created issue. Call project_schema first to see field names, allowed values, and which fields are required.',
    inputSchema: {
      project: z.string().describe('Project short key, e.g. ABC'),
      summary: z.string().describe('Issue summary / title'),
      description: z.string().optional().describe('Markdown description'),
      type: z.string().optional().describe('Issue type, e.g. "Task", "Bug"'),
      assignee: z.string().optional().describe('User login, name, or full name'),
      fields: z.array(z.object({
        name: z.string().describe('Custom field name, e.g. "Priority"'),
        value: z.string().describe('A single value; repeat the field name to set multiple values on a multi-value field'),
      })).optional().describe('Custom fields. Required fields (see project_schema) must be set at creation.'),
      tags: z.array(z.string()).optional().describe('Existing tag names (will not create new tags)'),
      relates: z.array(z.string()).optional().describe('Issue IDs to link as "relates to"'),
      dependsOn: z.array(z.string()).optional().describe('Issue IDs this issue depends on'),
      subtaskOf: z.array(z.string()).optional().describe('Parent issue IDs (this becomes a subtask)'),
    },
    handler: (api, args) => createIssue(api, args),
  },
```

Replace the `update_issue` tool object (lines ~72-84) with:

```js
  {
    name: 'update_issue',
    title: 'Update issue',
    description: "Update an issue's summary, description, state, type, assignee, custom fields, tags, and links. Returns the full updated issue.",
    inputSchema: {
      id: z.string().describe('Readable issue id, e.g. ABC-123'),
      summary: z.string().optional(),
      description: z.string().optional(),
      state: z.string().optional().describe('New state, e.g. "In Progress"'),
      type: z.string().optional().describe('Issue type, e.g. "Task", "Bug"'),
      assignee: z.string().optional().describe('User login, name, or full name'),
      fields: z.array(z.object({
        name: z.string().describe('Custom field name, e.g. "Priority"'),
        value: z.string().describe('A single value; repeat the field name for multi-value fields'),
      })).optional().describe('Custom fields to set'),
      tags: z.array(z.string()).optional().describe('Existing tag names to add'),
      relates: z.array(z.string()).optional().describe('Issue IDs to link as "relates to"'),
      dependsOn: z.array(z.string()).optional().describe('Issue IDs this issue depends on'),
      subtaskOf: z.array(z.string()).optional().describe('Parent issue IDs'),
    },
    handler: (api, { id, ...rest }) => updateIssue(api, id, rest),
  },
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/mcp-tools.test.mjs`
Expected: PASS. (The "exposes exactly the 12 expected tools" test still passes — no tools added yet.)

- [ ] **Step 5: Commit**

```bash
git add src/mcp-tools.mjs test/mcp-tools.test.mjs
git commit -m "feat(mcp): enrich create_issue/update_issue with fields, type, assignee, tags, links"
```

---

## Task 4: `required` hints in `project_schema`

**Files:**
- Modify: `src/api.mjs` (`shapeSchema` + `projectSchema` query)
- Modify: `test/shape.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `test/shape.test.mjs`:

```js
import { shapeSchema } from '../src/api.mjs';

test('shapeSchema marks required when projectCustomField.canBeEmpty is false', () => {
  const issue = {
    customFields: [
      { name: 'Squad', $type: 'SingleEnumIssueCustomField', projectCustomField: { canBeEmpty: false, bundle: { values: [{ name: 'A' }, { name: 'B' }] } } },
      { name: 'Priority', $type: 'SingleEnumIssueCustomField', projectCustomField: { canBeEmpty: true, bundle: { values: [{ name: 'Normal' }] } } },
      { name: 'Note', $type: 'TextIssueCustomField', projectCustomField: {} },
    ],
  };
  const schema = shapeSchema(issue);
  assert.deepEqual(schema, [
    { name: 'Squad', type: 'SingleEnumIssueCustomField', required: true, values: ['A', 'B'] },
    { name: 'Priority', type: 'SingleEnumIssueCustomField', required: false, values: ['Normal'] },
    { name: 'Note', type: 'TextIssueCustomField', required: false, values: [] },
  ]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/shape.test.mjs`
Expected: FAIL — `shapeSchema` output objects lack a `required` key.

- [ ] **Step 3: Update `shapeSchema` in `src/api.mjs`**

Replace `shapeSchema` (lines ~38-44) with:

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

- [ ] **Step 4: Extend the `projectSchema` field selector**

In `src/api.mjs`, in the `projectSchema` method, change the `fields` query string (line ~280) from:

```js
            'customFields(name,$type,projectCustomField(field(name),bundle(values(name))))',
```

to:

```js
            'customFields(name,$type,projectCustomField(canBeEmpty,field(name),bundle(values(name))))',
```

- [ ] **Step 5: Run to verify pass**

Run: `node --test test/shape.test.mjs`
Expected: PASS.

- [ ] **Step 6: Live verification that YouTrack returns `canBeEmpty` via issue-read**

This confirms the design's key assumption (the admin endpoint is blocked, but the issue-read path must still surface `canBeEmpty`). With a configured token:

Run (replace `ABC` with a real project key that has a known required field):
```bash
node bin/trackpilot.mjs project_schema ABC | grep -A1 -i required | head
```
Expected: at least one field shows `"required": true` for a field you know is mandatory, and optional fields show `false`.

If EVERY field shows `required: false` for a project that definitely has a required field, YouTrack is not returning `canBeEmpty` through the issue read. In that case the feature degrades safely (no false claims) — note the limitation in the README rather than blocking, and flag it back for a follow-up using a different source.

- [ ] **Step 7: Commit**

```bash
git add src/api.mjs test/shape.test.mjs
git commit -m "feat: surface required custom fields in project_schema"
```

---

## Task 5: Extract `releaseDiff` + optional `cwd`

**Files:**
- Create: `src/release-diff.mjs`
- Create: `test/release-diff.test.mjs`
- Modify: `src/git.mjs`
- Modify: `src/commands/release.mjs`

- [ ] **Step 1: Write the failing test**

Create `test/release-diff.test.mjs` (injects a fake git layer — providing BOTH
`commitMessages` and the real `extractIssueTokens` — so it needs no real repo):

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { releaseDiff } from '../src/release-diff.mjs';
import { extractIssueTokens } from '../src/git.mjs';

// Fake api: projects() is real-ish; readIssue resolves some ids and throws for others.
function fakeApi() {
  return {
    async projects() { return [{ shortName: 'ABC' }, { shortName: 'XYZ' }]; },
    async readIssue(id) {
      if (id === 'ABC-1') return { id: 'ABC-1', summary: 'One', state: 'Open', assignee: 'Jane', url: 'u/ABC-1' };
      throw new Error('not found');
    },
  };
}

const fakeGit = {
  commitMessages: async () => ['feat: ABC-1 do thing', 'chore: touches XYZ-9 and UTF-8'],
  extractIssueTokens, // reuse the real token extractor
};

test('releaseDiff resolves known issues, separates unresolved and ignored tokens', async () => {
  const out = await releaseDiff(fakeApi(), { base: 'main', head: 'next' }, fakeGit);
  assert.equal(out.range, 'main..next');
  assert.deepEqual(out.issues.map((i) => i.id), ['ABC-1']);
  assert.deepEqual(out.unresolved, ['XYZ-9']);
  assert.ok(out.ignoredTokens.includes('UTF-8'));
});

test('releaseDiff coerces non-string base/head to main/next defaults', async () => {
  const out = await releaseDiff(fakeApi(), { base: true, head: undefined }, fakeGit);
  assert.equal(out.range, 'main..next');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/release-diff.test.mjs`
Expected: FAIL — `Cannot find module '../src/release-diff.mjs'`.

- [ ] **Step 3: Add optional `cwd` to `commitMessages` in `src/git.mjs`**

Change the signature and the `execFile` options. Replace lines ~15-21 (the start of `commitMessages` through the `run(...)` call) with:

```js
export async function commitMessages(base, head, { cwd } = {}) {
  let out;
  try {
    // %x00 emits a NUL byte after each commit body so multi-line bodies stay intact.
    out = await run('git', ['log', `${base}..${head}`, '--format=%B%x00'], {
      maxBuffer: 64 * 1024 * 1024,
      ...(cwd ? { cwd } : {}),
    });
```

(The rest of the function — the `catch` block and the `out.stdout.split(...)` return — is unchanged.)

- [ ] **Step 4: Create `src/release-diff.mjs`**

```js
// Shared release-diff logic used by the CLI `release` command and the MCP
// `release` tool. The git layer is injected (defaults to ./git.mjs) so it is
// unit-testable without a real repository.

import * as defaultGit from './git.mjs';

export async function releaseDiff(api, { base, head, cwd } = {}, git = defaultGit) {
  const b = typeof base === 'string' ? base : 'main';
  const h = typeof head === 'string' ? head : 'next';

  const messages = await git.commitMessages(b, h, { cwd });
  const tokens = git.extractIssueTokens(messages);

  const projectKeys = new Set((await api.projects()).map((p) => p.shortName.toUpperCase()));
  const candidates = tokens.filter((t) => projectKeys.has(t.slice(0, t.lastIndexOf('-')).toUpperCase()));
  const ignoredTokens = tokens.filter((t) => !candidates.includes(t)).sort();

  const found = [];
  const unresolved = [];
  await Promise.all(candidates.map(async (id) => {
    try {
      const issue = await api.readIssue(id);
      found.push({ id: issue.id, summary: issue.summary, state: issue.state, assignee: issue.assignee, url: issue.url });
    } catch {
      unresolved.push(id);
    }
  }));

  found.sort((x, y) => x.id.localeCompare(y.id, undefined, { numeric: true }));
  unresolved.sort((x, y) => x.localeCompare(y, undefined, { numeric: true }));

  return {
    base: b,
    head: h,
    range: `${b}..${h}`,
    commits: messages.length,
    knownProjectKeys: [...projectKeys].sort(),
    issueCount: found.length,
    issues: found,
    unresolved,
    ignoredTokens,
  };
}
```

Note: `releaseDiff` calls `git.commitMessages` and `git.extractIssueTokens` through
the injected `git` object (defaulting to `./git.mjs`), which is why the test in
Step 1 supplies both on its `fakeGit`.

- [ ] **Step 5: Rewrite `src/commands/release.mjs` as a thin adapter**

```js
// trackpilot release [--base main] [--head next]
import { releaseDiff } from '../release-diff.mjs';

export async function run({ api, options }) {
  return releaseDiff(api, { base: options.base, head: options.head });
}
```

- [ ] **Step 6: Run the full suite**

Run: `node --test`
Expected: PASS — new `release-diff` tests green; existing `release` test (`isReleasable`) untouched; everything else green.

- [ ] **Step 7: Commit**

```bash
git add src/release-diff.mjs test/release-diff.test.mjs src/git.mjs src/commands/release.mjs
git commit -m "refactor: extract releaseDiff with injectable git and optional cwd"
```

---

## Task 6: Add `release` and `preview_command` MCP tools

**Files:**
- Modify: `src/mcp-tools.mjs`
- Modify: `test/mcp-tools.test.mjs`

- [ ] **Step 1: Update the tool-count test and add wiring tests**

In `test/mcp-tools.test.mjs`, replace the `'exposes exactly the 12 expected tools'` test with:

```js
test('exposes exactly the 14 expected tools', () => {
  const names = TOOLS.map((t) => t.name).sort();
  assert.deepEqual(names, [
    'add_comment', 'apply_command', 'create_issue', 'list_projects',
    'list_tags', 'list_users', 'log_work', 'preview_command',
    'project_schema', 'read_issue', 'release', 'search',
    'update_issue', 'whoami',
  ]);
});
```

Append these wiring tests:

```js
test('preview_command calls api.assist(id, query)', async () => {
  const { api, calls } = fakeApi({ assist: [{ description: 'State Fixed', error: false }] });
  const out = await tool('preview_command').handler(api, { id: 'ABC-1', query: 'State Fixed' });
  assert.deepEqual(calls.at(-1), { method: 'assist', args: ['ABC-1', 'State Fixed'] });
  assert.deepEqual(out, [{ description: 'State Fixed', error: false }]);
});

test('release tool delegates to releaseDiff via the api (projects + readIssue)', async () => {
  // releaseDiff shells out to git; here we only assert the tool exists and is wired.
  const t = tool('release');
  assert.equal(typeof t.handler, 'function');
  assert.deepEqual(Object.keys(t.inputSchema).sort(), ['base', 'cwd', 'head']);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/mcp-tools.test.mjs`
Expected: FAIL — tool-count test expects 14 but only 12 exist; `preview_command`/`release` not found.

- [ ] **Step 3: Add the tools in `src/mcp-tools.mjs`**

Add to the top imports:

```js
import { releaseDiff } from './release-diff.mjs';
```

Add these two entries to the `TOOLS` array (before the closing `];`):

```js
  {
    name: 'preview_command',
    title: 'Preview command (dry run)',
    description: 'Dry-run a YouTrack command against an issue via /commands/assist. Returns the parsed commands and whether each would fail, without mutating anything.',
    inputSchema: {
      id: z.string().describe('Readable issue id, e.g. ABC-123'),
      query: z.string().describe('YouTrack command, e.g. "State Fixed"'),
    },
    handler: (api, { id, query }) => api.assist(id, query),
  },
  {
    name: 'release',
    title: 'Release diff for QA',
    description: 'Diff two git refs in a repo, extract YouTrack issue IDs from commit/branch names, and resolve them into a QA-ready list.',
    inputSchema: {
      base: z.string().optional().describe('Base ref (default "main")'),
      head: z.string().optional().describe('Head ref (default "next")'),
      cwd: z.string().optional().describe('Repo directory to run git in; defaults to the server working directory'),
    },
    handler: (api, { base, head, cwd }) => releaseDiff(api, { base, head, cwd }),
  },
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/mcp-tools.test.mjs`
Expected: PASS (14 tools, new wiring tests green).

- [ ] **Step 5: Run the full suite**

Run: `node --test`
Expected: PASS (all tests).

- [ ] **Step 6: Commit**

```bash
git add src/mcp-tools.mjs test/mcp-tools.test.mjs
git commit -m "feat(mcp): add release and preview_command tools for full CLI/library parity"
```

---

## Task 7: README reframe — MCP-first, library framing, neutral LLM examples

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Rewrite the top matter and reorder sections**

Make these concrete edits to `README.md`:

1. **Title/tagline (lines 1-8):** keep `# trackpilot`, change the blockquote and intro to lead with MCP:

```markdown
# trackpilot

> An **MCP server** for [YouTrack](https://www.jetbrains.com/youtrack/) Cloud — also usable as a **CLI** and an importable **ESM library**.

`trackpilot` lets an AI assistant (or you) drive YouTrack Cloud: read issue
specs, create and update tasks with full custom-field support, comment, search,
log work, dry-run commands, and generate a **release diff for QA** from git
history. Use it three ways — as an MCP server for agents, as a terminal CLI, or
as a library in your own code.
```

2. **Usage modes table (lines 12-23):** add an MCP row as the first row and update the jump links:

```markdown
| Mode | How | Token storage |
|---|---|---|
| **MCP server** | `npx trackpilot mcp` (via an MCP client like Claude) | OS keyring or env vars |
| **CLI** | `trackpilot <command>` in a terminal | OS keyring — never in a plaintext file |
| **Library** | `import { createApi } from 'trackpilot'` | You pass it — no keyring dependency |

Jump to the section you need:

- [MCP server](#mcp-server) — expose YouTrack to an AI assistant
- [Library (programmatic API)](#library-programmatic-api) — ESM import, typed
- [CLI](#cli) — install globally, configure once, run commands
```

3. **Move the MCP section to the top of the body.** Cut the entire current `## Use as an MCP server` section (lines ~356-392) and paste it immediately after the jump links (before `## CLI`). Rename its heading to `## MCP server` (so the `#mcp-server` anchor matches the jump link).

- [ ] **Step 2: Expand the MCP section's tool reference**

Replace the MCP section's closing paragraph (the one starting "The server exposes read tools …") with a full table of all 14 tools:

```markdown
### Tools

The MCP surface has parity with the CLI and library (the only intentional
omissions are the raw `request` escape hatch and `config`/token management,
which stay CLI/library-only).

| Tool | Purpose |
|---|---|
| `search` | Search issues with YouTrack query syntax. |
| `read_issue` | Read one issue with comments, tags, links. |
| `list_projects` | List projects and their keys. |
| `project_schema` | List a project's custom fields, allowed values, and **which are required**. |
| `list_users` / `list_tags` | List users / existing tags. |
| `whoami` | The authenticated user. |
| `create_issue` | Create an issue with `type`, `assignee`, `fields`, `tags`, and links. Returns the full issue. |
| `update_issue` | Update summary/description/state plus `type`, `assignee`, `fields`, `tags`, links. |
| `add_comment` | Add a comment. |
| `log_work` | Log a work item. |
| `apply_command` | Apply a YouTrack command. |
| `preview_command` | Dry-run a command (no mutation). |
| `release` | Release diff for QA from git history. |

Custom fields are passed as an array of `{ name, value }` (repeat a name to set
multiple values on a multi-value field). Call `project_schema` first to discover
field names, allowed values, and required fields — **required fields must be set
at creation time**, or YouTrack rejects the create.
```

- [ ] **Step 3: Add an LLM usage examples subsection (generic placeholders only)**

Add after the Tools table. Use only `ABC`, generic field/user names — no private project, board, ticket, or repo names:

````markdown
### Using it from an AI assistant

A typical agent loop for filing a well-formed task:

1. `whoami` → confirm the acting user.
2. `project_schema` with `{ "project": "ABC" }` → discover fields and see which
   are `"required": true` (e.g. a mandatory enum field).
3. `create_issue`:

   ```json
   {
     "project": "ABC",
     "summary": "Login button misaligned on mobile",
     "description": "Repro + screenshots…",
     "type": "Bug",
     "assignee": "jdoe",
     "fields": [{ "name": "Priority", "value": "Major" }],
     "tags": ["regression"]
   }
   ```

   Any field reported as required by `project_schema` must be included here.

A read → break-down → release loop:

1. `read_issue` `ABC-100` → the assistant reads a spec issue.
2. `create_issue` once per subtask, each with `subtaskOf: ["ABC-100"]`.
3. At release time, `release` with `{ "base": "main", "head": "next" }` →
   a QA-ready list of the issues going out.

Before a risky transition, `preview_command` dry-runs it so the assistant can
confirm it parses before `apply_command` actually applies it.
````

- [ ] **Step 4: Verify the MCP tool list line was removed / replaced**

Run: `grep -n "read tools" README.md`
Expected: no output (the old one-line tool summary is gone, replaced by the table).

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: reframe README MCP-first with full tool reference and LLM examples"
```

---

## Task 8: Version bump and final verification

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Bump the version**

In `package.json`, change `"version": "0.6.0"` to `"version": "0.7.0"`.

- [ ] **Step 2: Final full test run**

Run: `node --test`
Expected: PASS — entire suite green.

- [ ] **Step 3: Smoke-check the MCP tool list at runtime (optional, needs token)**

Run: `printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node bin/trackpilot.mjs mcp 2>/dev/null | head -c 400` — or rely on `test/mcp-smoke.test.mjs` if it already lists tools.
Expected: the 14 tool names appear.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "chore: bump version to 0.7.0"
```

- [ ] **Step 5: Push and open PR**

```bash
git push -u origin feat/mcp-rich-create-and-required-hints
gh pr create --base main --title "feat: full MCP parity — rich create/update, required hints, release & preview_command tools" --body "<summary referencing the spec; no co-author/footer per user preference>"
```

---

## Notes for the implementer

- `node --test` runs the whole suite; per-file runs use `node --test test/<file>.test.mjs`.
- Keep stdout clean in the MCP path — diagnostics go to stderr only (see `src/mcp.mjs`).
- The pure modules (`apply-fields`, `custom-fields`, `resolve`, `build-commands`) are unchanged — do not edit them; the orchestration just calls them.
- Rollout: after publish (push to `main` with the bumped version), the running MCP client needs a fresh `npx` (cache miss) or a pinned `trackpilot@0.7.0` to pick up the new tools.
