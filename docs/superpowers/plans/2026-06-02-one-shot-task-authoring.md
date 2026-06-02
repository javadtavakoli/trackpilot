# One-Shot Task Authoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `trackpilot create`/`update` set fields, assignee, tags, and links in one invocation, with values validated and corrected ("did you mean") before writing, and tags/links surfaced in output for self-verification.

**Architecture:** Inputs are resolved/validated client-side against cached `/users`, `/issueTags`, and a per-project schema (obtained by reading one issue — admin field endpoints are blocked under our token). Each settable thing maps to one YouTrack command (one concern per command, no braces). The assembled commands are dry-run through `/commands/assist`, then applied as grouped `/commands` calls, then the issue is re-read (now including tags + links) and returned.

**Tech Stack:** Node ≥20 ESM, built-in `fetch`, built-in `node:test`/`node:assert` (no new runtime deps). Single existing runtime dep: `@napi-rs/keyring`.

> **Revision (implemented):** Tasks 6–8 below were superseded after e2e testing
> revealed `Squad` is required at creation time (bare-create 400s before any
> command runs). Custom fields incl. assignee are now set via a typed REST
> `customFields` POST body (new `src/custom-fields.mjs` `buildCustomFields`;
> `api.createIssue({customFields})` + `api.setCustomFields(id, fields)`;
> `apply-fields.mjs` `prepareCreate()` → `{customFields, commands}`); only tags
> and links remain command-driven (still assist-guarded). See the spec's
> "Implementation revision" section. The `resolve.mjs`, tags/links output,
> API-lookups, `fields` command, and validation tasks are unchanged.

---

## File Structure

- `test/` — new directory for `*.test.mjs` (node's runner auto-discovers; excluded from npm `files` whitelist).
- `src/resolve.mjs` — NEW, pure: candidate → canonical match + ranked suggestions. Used for tags, users, enum values.
- `src/build-commands.mjs` — NEW, pure: typed flags → ordered list of `{concern, command}`.
- `src/apply-fields.mjs` — NEW: orchestration (resolve → assist → grouped apply) shared by create/update. Contains one pure helper `assertAssistClean()`.
- `src/api.mjs` — MODIFY: extend `ISSUE_FIELDS`/`shapeIssue` with tags+links; add `tags()`, `users()`, `projectSchema()`, `assist()`, `applyCommands()`; simplify `createIssue` to create-bare-and-return-id.
- `src/commands/create.mjs` — MODIFY: parse new flags, run the apply-fields flow.
- `src/commands/update.mjs` — MODIFY: same new flags.
- `src/commands/fields.mjs` — NEW: `fields <PROJECT>` discovery command.
- `bin/trackpilot.mjs` — MODIFY: register `fields`, expand BOOLEAN handling not needed; update USAGE.
- `package.json` — MODIFY: add `"test": "node --test"` script.
- `README.md` — MODIFY: document new flags and `fields`.

---

## Task 1: Test scaffolding

**Files:**
- Modify: `package.json:16-18`
- Create: `test/smoke.test.mjs`

- [ ] **Step 1: Add the test script**

In `package.json`, change the `scripts` block to:

```json
  "scripts": {
    "trackpilot": "node bin/trackpilot.mjs",
    "test": "node --test"
  },
```

- [ ] **Step 2: Write a smoke test**

Create `test/smoke.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('node test runner works', () => {
  assert.equal(1 + 1, 2);
});
```

- [ ] **Step 3: Run the tests**

Run: `cd /home/javad/Projects/youtrack-cli && yarn test`
Expected: PASS — `1 passing` (tests 1, pass 1).

- [ ] **Step 4: Commit**

```bash
git add package.json test/smoke.test.mjs
git commit -m "test: add node:test runner and smoke test"
```

---

## Task 2: `resolve.mjs` — value matcher with suggestions

**Files:**
- Create: `src/resolve.mjs`
- Test: `test/resolve.test.mjs`

The unit `resolveValue(candidate, options)` takes a candidate string and an array
of `{ value, keys }` (where `value` is the canonical token to use downstream and
`keys` is the list of strings the candidate may match — e.g. a user's login,
name, fullName). It returns `{ match, suggestions }`: `match` is the `value` of
the exact (case-insensitive) hit or `null`; `suggestions` is up to 3 `value`s
ranked by closeness (substring first, then edit distance).

- [ ] **Step 1: Write the failing tests**

Create `test/resolve.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveValue, distance } from '../src/resolve.mjs';

const tags = ['scope:infra', 'scope:widget', 'unplanned', 'type:bug'].map((v) => ({
  value: v,
  keys: [v],
}));

test('exact match returns the value', () => {
  const r = resolveValue('scope:infra', tags);
  assert.equal(r.match, 'scope:infra');
});

test('match is case-insensitive', () => {
  const r = resolveValue('UNPLANNED', tags);
  assert.equal(r.match, 'unplanned');
});

test('no match returns null and ranked suggestions', () => {
  const r = resolveValue('infra', tags);
  assert.equal(r.match, null);
  assert.equal(r.suggestions[0], 'scope:infra'); // substring containment ranks first
});

test('suggestions capped at 3', () => {
  const r = resolveValue('scope', tags);
  assert.ok(r.suggestions.length <= 3);
});

test('matches against any key, returns canonical value', () => {
  const users = [{ value: 'Javadtavakoli95', keys: ['Javadtavakoli95', 'Javad Tavakoli'] }];
  const r = resolveValue('javad tavakoli', users);
  assert.equal(r.match, 'Javadtavakoli95');
});

test('distance is symmetric and zero for equal', () => {
  assert.equal(distance('abc', 'abc'), 0);
  assert.equal(distance('abc', 'abd'), distance('abd', 'abc'));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn test --test-name-pattern resolve` (or `node --test test/resolve.test.mjs`)
Expected: FAIL — cannot find module `../src/resolve.mjs`.

- [ ] **Step 3: Implement `src/resolve.mjs`**

```javascript
// Pure value resolution: map a user-supplied string to a canonical token,
// or return ranked "did you mean" suggestions. No I/O.

// Levenshtein edit distance (small inputs; simple two-row DP).
export function distance(a, b) {
  a = a.toLowerCase();
  b = b.toLowerCase();
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  let curr = new Array(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

// options: [{ value, keys: [string, ...] }]
// returns { match: value|null, suggestions: value[] (<=3) }
export function resolveValue(candidate, options) {
  const cand = String(candidate).trim().toLowerCase();

  for (const opt of options) {
    if (opt.keys.some((k) => String(k).toLowerCase() === cand)) {
      return { match: opt.value, suggestions: [] };
    }
  }

  const scored = options.map((opt) => {
    const best = Math.min(
      ...opt.keys.map((k) => {
        const key = String(k).toLowerCase();
        const contains = key.includes(cand) || cand.includes(key);
        // substring hits sort ahead of pure edit-distance hits
        return (contains ? 0 : 100) + distance(cand, key);
      }),
    );
    return { value: opt.value, score: best };
  });

  scored.sort((a, b) => a.score - b.score);
  return { match: null, suggestions: scored.slice(0, 3).map((s) => s.value) };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/resolve.test.mjs`
Expected: PASS — all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/resolve.mjs test/resolve.test.mjs
git commit -m "feat: add resolve.mjs value matcher with did-you-mean suggestions"
```

---

## Task 3: Surface tags + links in issue output

**Files:**
- Modify: `src/api.mjs:6-9` (ISSUE_FIELDS), `src/api.mjs:84-100` (shapeIssue)
- Test: `test/shape.test.mjs`

To unit-test the pure shaping, extract `shapeIssue` and a new `shapeLinks` as
named exports.

- [ ] **Step 1: Write the failing tests**

Create `test/shape.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shapeIssue, shapeLinks } from '../src/api.mjs';

test('shapeLinks keeps only non-empty buckets, flattens to {type,direction,id}', () => {
  const raw = [
    { direction: 'BOTH', linkType: { name: 'Relates' }, issues: [{ idReadable: 'ABC-211' }] },
    { direction: 'OUTWARD', linkType: { name: 'Subtask' }, issues: [] },
    { direction: 'OUTWARD', linkType: { name: 'Depend' }, issues: [{ idReadable: 'ABC-9' }] },
  ];
  assert.deepEqual(shapeLinks(raw), [
    { type: 'Relates', direction: 'BOTH', id: 'ABC-211' },
    { type: 'Depend', direction: 'OUTWARD', id: 'ABC-9' },
  ]);
});

test('shapeIssue includes tags and links arrays', () => {
  const issue = {
    idReadable: 'ABC-215',
    summary: 'Release',
    description: null,
    project: { shortName: 'ABC' },
    reporter: { fullName: 'Javad Tavakoli' },
    customFields: [{ name: 'State', value: { name: 'Open' } }],
    tags: [{ name: 'unplanned' }, { name: 'scope:infra' }],
    links: [{ direction: 'BOTH', linkType: { name: 'Relates' }, issues: [{ idReadable: 'ABC-211' }] }],
  };
  const shaped = shapeIssue(issue);
  assert.deepEqual(shaped.tags, ['unplanned', 'scope:infra']);
  assert.deepEqual(shaped.links, [{ type: 'Relates', direction: 'BOTH', id: 'ABC-211' }]);
  assert.equal(shaped.state, 'Open');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/shape.test.mjs`
Expected: FAIL — `shapeIssue`/`shapeLinks` are not exported (currently nested inside `createApi`).

- [ ] **Step 3: Refactor api.mjs to export pure shapers and include tags/links**

In `src/api.mjs`, move `renderOne`, `fieldValue`, `shapeIssue` to module scope as
named exports (they don't use `baseUrl`), add `shapeLinks`, and have
`shapeIssue` attach tags/links. Replace the existing `ISSUE_FIELDS` const and the
in-`createApi` `fieldValue`/`renderOne`/`shapeIssue` definitions.

Set `ISSUE_FIELDS` (top of file) to:

```javascript
const ISSUE_FIELDS =
  'idReadable,summary,description,project(shortName,name),' +
  'reporter(login,fullName),created,updated,' +
  'customFields(name,value(name,login,fullName,presentation,minutes)),' +
  'tags(name),' +
  'links(direction,linkType(name),issues(idReadable))';
```

Add at module scope (outside `createApi`):

```javascript
export function renderOne(v) {
  if (v == null) return null;
  if (typeof v !== 'object') return String(v);
  return v.name || v.fullName || v.login || v.presentation || null;
}

export function fieldValue(cf) {
  const v = cf?.value;
  if (v == null) return null;
  if (Array.isArray(v)) return v.map(renderOne).filter(Boolean).join(', ') || null;
  return renderOne(v);
}

export function shapeLinks(links) {
  const out = [];
  for (const link of links || []) {
    for (const issue of link.issues || []) {
      out.push({ type: link.linkType?.name ?? null, direction: link.direction ?? null, id: issue.idReadable });
    }
  }
  return out;
}

export function shapeIssue(issue) {
  const fields = {};
  for (const cf of issue.customFields || []) fields[cf.name] = fieldValue(cf);
  return {
    id: issue.idReadable,
    summary: issue.summary,
    description: issue.description ?? null,
    project: issue.project?.shortName ?? null,
    state: fields.State ?? null,
    type: fields.Type ?? null,
    priority: fields.Priority ?? null,
    assignee: fields.Assignee ?? null,
    reporter: issue.reporter?.fullName || issue.reporter?.login || null,
    tags: (issue.tags || []).map((t) => t.name),
    links: shapeLinks(issue.links),
    url: webUrlStatic(issue.idReadable, fields.__baseUrl),
    customFields: fields,
  };
}
```

Because `shapeIssue` now lives at module scope it can't close over `baseUrl` for
the URL. Keep the URL inside `createApi` instead: delete the `url` line from the
module-scope `shapeIssue` and have `createApi` wrap results. Simplest concrete
approach — in `shapeIssue` drop the `url` field entirely, and in each `createApi`
method that returns a shaped issue, add the url:

Replace the module-scope `shapeIssue` `url` line with nothing (remove it and the
`webUrlStatic` reference), so the object ends at `customFields: fields,`.

Then inside `createApi`, define a small wrapper and use it everywhere a shaped
issue is returned:

```javascript
    function withUrl(shaped) {
      return { ...shaped, url: webUrl(shaped.id) };
    }
```

Update `readIssue` to `return { ...withUrl(shapeIssue(issue)), comments: [...] }`,
and `search` to `return (data || []).map((i) => withUrl(shapeIssue(i)))`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/shape.test.mjs`
Expected: PASS — both tests pass. (The shaper tests don't assert on `url`.)

- [ ] **Step 5: Verify read still works end-to-end**

Run: `node bin/trackpilot.mjs read ABC-215`
Expected: JSON now contains `"tags": ["unplanned","scope:infra"]` and
`"links": [{"type":"Relates","direction":"BOTH","id":"ABC-211"}]`, plus `url`.

- [ ] **Step 6: Commit**

```bash
git add src/api.mjs test/shape.test.mjs
git commit -m "feat: surface tags and links in issue output; export pure shapers"
```

---

## Task 4: API lookups — tags, users, projectSchema, assist, applyCommands

**Files:**
- Modify: `src/api.mjs` (add methods + a pure `shapeSchema` export)
- Test: `test/schema.test.mjs`

`shapeSchema(issueJson)` is the only pure part and gets a unit test; the fetch
wrappers are thin and verified manually in Task 10 (endpoints already confirmed
during design).

- [ ] **Step 1: Write the failing test for `shapeSchema`**

Create `test/schema.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shapeSchema } from '../src/api.mjs';

test('shapeSchema extracts field name, type, and bundle values', () => {
  const issue = {
    customFields: [
      {
        name: 'Type',
        $type: 'SingleEnumIssueCustomField',
        projectCustomField: {
          field: { name: 'Type' },
          bundle: { values: [{ name: 'Bug' }, { name: 'Task' }, { name: 'User Story' }] },
        },
      },
      {
        name: 'Estimation',
        $type: 'PeriodIssueCustomField',
        projectCustomField: { field: { name: 'Estimation' } },
      },
    ],
  };
  assert.deepEqual(shapeSchema(issue), [
    { name: 'Type', type: 'SingleEnumIssueCustomField', values: ['Bug', 'Task', 'User Story'] },
    { name: 'Estimation', type: 'PeriodIssueCustomField', values: [] },
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/schema.test.mjs`
Expected: FAIL — `shapeSchema` not exported.

- [ ] **Step 3: Add `shapeSchema` (module scope) and lookup methods (in createApi)**

Add at module scope in `src/api.mjs`:

```javascript
export function shapeSchema(issue) {
  return (issue.customFields || []).map((cf) => ({
    name: cf.name,
    type: cf.$type ?? null,
    values: (cf.projectCustomField?.bundle?.values || []).map((v) => v.name).filter(Boolean),
  }));
}
```

Add these methods inside the object returned by `createApi` (alongside
`projects`, `readIssue`, etc.):

```javascript
    async tags() {
      const data = await request('GET', '/issueTags', {
        query: { fields: 'name', $top: 1000 },
      });
      return (data || []).map((t) => t.name).filter(Boolean);
    },

    async users() {
      const data = await request('GET', '/users', {
        query: { fields: 'login,name,fullName', $top: 1000 },
      });
      return (data || []).map((u) => ({ login: u.login, name: u.name, fullName: u.fullName }));
    },

    // Schema-via-issue: admin field endpoints are blocked under our token, but
    // reading any one issue in the project returns each field's name, type, and
    // allowed bundle values.
    async projectSchema(projectKey) {
      const list = await request('GET', '/issues', {
        query: {
          query: `project: ${projectKey}`,
          $top: 1,
          fields:
            'customFields(name,$type,projectCustomField(field(name),bundle(values(name))))',
        },
      });
      if (!list || !list.length) {
        throw new AppError(`cannot read schema: no issues found in project "${projectKey}"`);
      }
      return shapeSchema(list[0]);
    },

    // Dry-run a command string; returns [{ description, error }] without mutating.
    async assist(idReadable, query) {
      const data = await request('POST', '/commands/assist', {
        query: { fields: 'commands(description,error)' },
        body: { query, issues: [{ idReadable }] },
      });
      return (data?.commands || []).map((c) => ({ description: c.description, error: !!c.error }));
    },

    // Apply commands one at a time so a failure is attributable to one concern.
    async applyCommands(idReadable, commands) {
      for (const cmd of commands) {
        await this.applyCommand(idReadable, cmd.command);
      }
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/schema.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/api.mjs test/schema.test.mjs
git commit -m "feat: add tags/users/projectSchema/assist/applyCommands to api"
```

---

## Task 5: `build-commands.mjs` — flags → command list

**Files:**
- Create: `src/build-commands.mjs`
- Test: `test/build-commands.test.mjs`

Pure. Input is already-resolved canonical values (login for assignee, exact tag
names, `{name, value}` for fields, ID arrays for links). Output is an ordered
`[{ concern, command }]`. No braces — one concern per command (verified during
design: `Squad Squad 1`, `Type User Story` parse cleanly).

- [ ] **Step 1: Write the failing tests**

Create `test/build-commands.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCommands } from '../src/build-commands.mjs';

test('builds commands in order: assignee, fields, tags, links', () => {
  const cmds = buildCommands({
    assignee: 'Javadtavakoli95',
    fields: [
      { name: 'Squad', value: 'Squad 2' },
      { name: 'Team', value: 'Front-End' },
      { name: 'Team', value: 'QA' },
      { name: 'Estimation', value: '1d' },
    ],
    tags: ['scope:infra', 'unplanned'],
    relates: ['ABC-211'],
    dependsOn: [],
    subtaskOf: [],
  });
  assert.deepEqual(cmds, [
    { concern: 'assignee', command: 'for Javadtavakoli95' },
    { concern: 'field:Squad', command: 'Squad Squad 2' },
    { concern: 'field:Team', command: 'Team Front-End' },
    { concern: 'field:Team', command: 'Team QA' },
    { concern: 'field:Estimation', command: 'Estimation 1d' },
    { concern: 'tag:scope:infra', command: 'add tag scope:infra' },
    { concern: 'tag:unplanned', command: 'add tag unplanned' },
    { concern: 'link:relates:ABC-211', command: 'relates to ABC-211' },
  ]);
});

test('omits empty groups and returns [] for no inputs', () => {
  assert.deepEqual(buildCommands({}), []);
});

test('builds depends-on and subtask-of links', () => {
  const cmds = buildCommands({ dependsOn: ['ABC-1'], subtaskOf: ['ABC-2'] });
  assert.deepEqual(cmds, [
    { concern: 'link:depends:ABC-1', command: 'depends on ABC-1' },
    { concern: 'link:subtask:ABC-2', command: 'subtask of ABC-2' },
  ]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/build-commands.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/build-commands.mjs`**

```javascript
// Pure: resolved typed inputs -> ordered [{ concern, command }].
// One concern per command; no brace-quoting (YouTrack parses multi-word values
// fine when a single command owns the whole tail).

export function buildCommands({
  assignee,
  fields = [],
  tags = [],
  relates = [],
  dependsOn = [],
  subtaskOf = [],
} = {}) {
  const cmds = [];

  if (assignee) cmds.push({ concern: 'assignee', command: `for ${assignee}` });

  for (const f of fields) {
    cmds.push({ concern: `field:${f.name}`, command: `${f.name} ${f.value}` });
  }

  for (const t of tags) {
    cmds.push({ concern: `tag:${t}`, command: `add tag ${t}` });
  }

  for (const id of relates) {
    cmds.push({ concern: `link:relates:${id}`, command: `relates to ${id}` });
  }
  for (const id of dependsOn) {
    cmds.push({ concern: `link:depends:${id}`, command: `depends on ${id}` });
  }
  for (const id of subtaskOf) {
    cmds.push({ concern: `link:subtask:${id}`, command: `subtask of ${id}` });
  }

  return cmds;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/build-commands.test.mjs`
Expected: PASS — all 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/build-commands.mjs test/build-commands.test.mjs
git commit -m "feat: add build-commands (typed flags to YouTrack command list)"
```

---

## Task 6: `apply-fields.mjs` — resolve, assist-check, apply

**Files:**
- Create: `src/apply-fields.mjs`
- Test: `test/apply-fields.test.mjs`

This module ties resolution + validation together. The pure, testable core is
`assertAssistClean(assistResults)` (throws on any error or unintended new tag)
and `resolveInputs({ raw, schema, users, tags })` (pure given lookup data).
Orchestration is split in two so validation happens **before** any issue is
created (spec requirement): `prepareCommands(api, raw, projectKey)` fetches
lookups, resolves/validates, and returns the command list (needs no issue id);
`applyPrepared(api, id, commands)` runs the assist dry-run and the grouped apply
(needs the id). For `create`, prepare runs before `createIssue`, so a bad value
aborts with no issue created.

- [ ] **Step 1: Write the failing tests**

Create `test/apply-fields.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertAssistClean, resolveInputs } from '../src/apply-fields.mjs';

test('assertAssistClean passes when all commands ok and no new tag', () => {
  assert.doesNotThrow(() =>
    assertAssistClean([
      { description: 'Add Assignee Javadtavakoli95', error: false },
      { description: 'Add tag scope:infra', error: false },
    ]),
  );
});

test('assertAssistClean throws on an errored command', () => {
  assert.throws(
    () => assertAssistClean([{ description: 'Type expected: Foo', error: true }]),
    /Type expected: Foo/,
  );
});

test('assertAssistClean throws on unintended new tag', () => {
  assert.throws(
    () => assertAssistClean([{ description: 'Add new tag infra', error: false }]),
    /new tag/i,
  );
});

const schema = [
  { name: 'Squad', type: 'SingleEnumIssueCustomField', values: ['Squad 1', 'Squad 2'] },
  { name: 'Team', type: 'MultiEnumIssueCustomField', values: ['Front-End', 'QA', 'Design'] },
  { name: 'Estimation', type: 'PeriodIssueCustomField', values: [] },
];
const users = [{ login: 'Javadtavakoli95', name: 'Javad Tavakoli', fullName: 'Javad Tavakoli' }];
const tags = ['scope:infra', 'unplanned'];

test('resolveInputs maps assignee, enum field, period field, and tag to canonical', () => {
  const out = resolveInputs({
    raw: {
      assignee: 'javad tavakoli',
      fields: [
        { name: 'Squad', value: 'squad 2' },
        { name: 'Estimation', value: '1d' },
      ],
      tags: ['unplanned'],
      relates: ['ABC-211'],
    },
    schema,
    users,
    tags,
  });
  assert.equal(out.assignee, 'Javadtavakoli95');
  assert.deepEqual(out.fields, [
    { name: 'Squad', value: 'Squad 2' },
    { name: 'Estimation', value: '1d' }, // period passes through
  ]);
  assert.deepEqual(out.tags, ['unplanned']);
  assert.deepEqual(out.relates, ['ABC-211']);
});

test('resolveInputs throws with suggestions on a bad tag', () => {
  assert.throws(
    () => resolveInputs({ raw: { tags: ['infra'] }, schema, users, tags }),
    /scope:infra/,
  );
});

test('resolveInputs throws on unknown field name', () => {
  assert.throws(
    () => resolveInputs({ raw: { fields: [{ name: 'Nope', value: 'x' }] }, schema, users, tags }),
    /Nope/,
  );
});

test('resolveInputs throws on bad enum value with valid options listed', () => {
  assert.throws(
    () => resolveInputs({ raw: { fields: [{ name: 'Squad', value: 'Squad 9' }] }, schema, users, tags }),
    /Squad 1|Squad 2/,
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/apply-fields.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/apply-fields.mjs`**

```javascript
import { AppError } from './api.mjs';
import { resolveValue } from './resolve.mjs';
import { buildCommands } from './build-commands.mjs';

const ENUM_TYPES = new Set([
  'SingleEnumIssueCustomField',
  'MultiEnumIssueCustomField',
  'SingleBuildIssueCustomField',
  'SingleVersionIssueCustomField',
  'MultiVersionIssueCustomField',
]);

// Throws if any parsed command errored, or if a tag would be newly created
// (YouTrack reports that as "Add new tag X" with error:false).
export function assertAssistClean(results) {
  for (const c of results) {
    if (c.error) throw new AppError(`YouTrack rejected: ${c.description}`);
    if (/add new tag/i.test(c.description || '')) {
      throw new AppError(`refusing to create a new tag: ${c.description}`);
    }
  }
}

// Pure: resolve raw inputs to canonical values using the provided lookup data.
// Throws AppError (with suggestions) on any miss.
export function resolveInputs({ raw = {}, schema = [], users = [], tags = [] }) {
  const out = {
    assignee: undefined,
    fields: [],
    tags: [],
    relates: raw.relates || [],
    dependsOn: raw.dependsOn || [],
    subtaskOf: raw.subtaskOf || [],
  };

  if (raw.assignee) {
    const opts = users.map((u) => ({ value: u.login, keys: [u.login, u.name, u.fullName].filter(Boolean) }));
    const r = resolveValue(raw.assignee, opts);
    if (!r.match) throw new AppError(`unknown user "${raw.assignee}". Did you mean: ${r.suggestions.join(', ')}?`);
    out.assignee = r.match;
  }

  for (const f of raw.fields || []) {
    const field = schema.find((s) => s.name.toLowerCase() === f.name.toLowerCase());
    if (!field) {
      const names = schema.map((s) => s.name).join(', ');
      throw new AppError(`unknown field "${f.name}". Valid fields: ${names}`);
    }
    if (ENUM_TYPES.has(field.type) && field.values.length) {
      const r = resolveValue(f.value, field.values.map((v) => ({ value: v, keys: [v] })));
      if (!r.match) {
        throw new AppError(`"${f.value}" is not valid for ${field.name}. Valid: ${field.values.join(', ')}`);
      }
      out.fields.push({ name: field.name, value: r.match });
    } else {
      // period / text / user-typed fields pass through (assist validates format)
      out.fields.push({ name: field.name, value: f.value });
    }
  }

  for (const t of raw.tags || []) {
    const r = resolveValue(t, tags.map((name) => ({ value: name, keys: [name] })));
    if (!r.match) throw new AppError(`unknown tag "${t}". Did you mean: ${r.suggestions.join(', ')}?`);
    out.tags.push(r.match);
  }

  return out;
}

// Phase 1 (no issue id needed): fetch lookups, resolve/validate, build commands.
// Throws AppError (with suggestions) on any bad value BEFORE anything is written.
export async function prepareCommands(api, raw, projectKey) {
  const needSchema = raw.fields && raw.fields.length;
  const needUsers = !!raw.assignee;
  const needTags = raw.tags && raw.tags.length;
  if (!needSchema && !needUsers && !needTags &&
      !(raw.relates && raw.relates.length) &&
      !(raw.dependsOn && raw.dependsOn.length) &&
      !(raw.subtaskOf && raw.subtaskOf.length)) {
    return [];
  }

  const [schema, users, tags] = await Promise.all([
    needSchema ? api.projectSchema(projectKey) : Promise.resolve([]),
    needUsers ? api.users() : Promise.resolve([]),
    needTags ? api.tags() : Promise.resolve([]),
  ]);

  const resolved = resolveInputs({ raw, schema, users, tags });
  return buildCommands(resolved);
}

// Phase 2 (needs the issue id): dry-run via assist, then apply grouped commands.
export async function applyPrepared(api, id, commands) {
  if (!commands || !commands.length) return;
  const assistResults = await api.assist(id, commands.map((c) => c.command).join(' '));
  assertAssistClean(assistResults);
  await api.applyCommands(id, commands);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/apply-fields.test.mjs`
Expected: PASS — all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/apply-fields.mjs test/apply-fields.test.mjs
git commit -m "feat: add apply-fields (resolve, assist pre-flight, grouped apply)"
```

---

## Task 7: Wire `create` to the new flow

**Files:**
- Modify: `src/api.mjs` (`createIssue`)
- Modify: `src/commands/create.mjs`
- Test: manual (network)

- [ ] **Step 1: Simplify `createIssue` in api.mjs**

Replace the current `createIssue` (which forces `SingleEnumIssueCustomField`) with
a bare creator that returns the new id; field setting now happens via the command
flow:

```javascript
    async createIssue({ project, summary, description }) {
      const projectId = await this.resolveProjectId(project);
      const created = await request('POST', '/issues', {
        query: { fields: 'idReadable' },
        body: {
          project: { id: projectId },
          summary,
          ...(description ? { description } : {}),
        },
      });
      return created.idReadable;
    },
```

- [ ] **Step 2: Rewrite `src/commands/create.mjs`**

```javascript
// trackpilot create --project <KEY> --summary "..." [--description "..."]
//   [--type <Type>] [--assignee <user>] [--field "Name=Value" ...]
//   [--tag <name> ...] [--relates <ID> ...] [--depends-on <ID> ...] [--subtask-of <ID> ...]

import { AppError } from '../api.mjs';
import { prepareCommands, applyPrepared } from '../apply-fields.mjs';

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

  const raw = {
    assignee: typeof options.assignee === 'string' ? options.assignee : undefined,
    fields: [
      ...parseFields(options.field),
      ...(typeof options.type === 'string' ? [{ name: 'Type', value: options.type }] : []),
    ],
    tags: asList(options.tag),
    relates: asList(options.relates),
    dependsOn: asList(options['depends-on']),
    subtaskOf: asList(options['subtask-of']),
  };

  // Validate everything BEFORE creating the issue (spec: bad input -> no issue).
  const commands = await prepareCommands(api, raw, project);

  const id = await api.createIssue({
    project,
    summary,
    description: typeof options.description === 'string' ? options.description : undefined,
  });

  await applyPrepared(api, id, commands);
  return api.readIssue(id);
}
```

Note: `Type` is routed through `prepareCommands` as a field so it is validated
against the project's Type bundle (e.g. catches `Tsak`). The schema lookup happens
because `raw.fields` is non-empty. Because `prepareCommands` runs first, an
unknown tag/user/field value aborts with no issue created.

- [ ] **Step 3: Verify create end-to-end with a real one-shot task**

Run:
```bash
node bin/trackpilot.mjs create --project ABC --summary "Plan test — delete me" \
  --type Task --assignee "javad tavakoli" \
  --field "Squad=Squad 2" --field "Team=Front-End" --field "Team=QA" \
  --field "Estimation=1d" --tag scope:infra --tag unplanned --relates ABC-211
```
Expected: a single JSON issue object with correct `assignee`, `customFields`
(Squad, Team "Front-End, QA", Estimation 1d, Type Task), `tags`
(`scope:infra`, `unplanned`), and `links` (Relates ABC-211) — no errors, one call.

- [ ] **Step 4: Verify validation rejects a bad value and creates NO issue**

Run:
```bash
node bin/trackpilot.mjs create --project ABC --summary "Validation test — should not be created" --tag infra
```
Expected: `{ "error": "unknown tag \"infra\". Did you mean: scope:infra, ..." }`,
exit 1, and **no new issue** (confirm with
`node bin/trackpilot.mjs list --query "project: ABC summary: {Validation test — should not be created}"` → count 0). Because `prepareCommands` runs before
`createIssue`, the failure happens before anything is written.

- [ ] **Step 5: Clean up the test issue created in Step 3**

```bash
node bin/trackpilot.mjs command <id> --query "State Done"
```
(There is no delete command; mark Done or remove via the YouTrack UI.)

- [ ] **Step 6: Commit**

```bash
git add src/api.mjs src/commands/create.mjs
git commit -m "feat: create sets fields/assignee/tags/links in one call with validation"
```

---

## Task 8: Wire `update` to the new flow

**Files:**
- Modify: `src/commands/update.mjs`
- Test: manual (network)

- [ ] **Step 1: Rewrite `src/commands/update.mjs`**

```javascript
// trackpilot update <id> [--summary ...] [--description ...] [--state ...]
//   [--assignee <user>] [--field "Name=Value" ...] [--tag <name> ...]
//   [--relates <ID> ...] [--depends-on <ID> ...] [--subtask-of <ID> ...]

import { AppError } from '../api.mjs';
import { prepareCommands, applyPrepared } from '../apply-fields.mjs';
import { parseFields, asList } from './create.mjs';

export async function run({ api, positionals, options }) {
  const id = positionals[0];
  if (!id) {
    throw new AppError('usage: trackpilot update <issue-id> [--summary ...] [--field ...] [--assignee ...] [--tag ...] [--relates ...]');
  }

  const patch = {};
  if (typeof options.summary === 'string') patch.summary = options.summary;
  if (typeof options.description === 'string') patch.description = options.description;
  if (typeof options.state === 'string') patch.state = options.state;

  const raw = {
    assignee: typeof options.assignee === 'string' ? options.assignee : undefined,
    fields: parseFields(options.field),
    tags: asList(options.tag),
    relates: asList(options.relates),
    dependsOn: asList(options['depends-on']),
    subtaskOf: asList(options['subtask-of']),
  };

  const hasFieldWork =
    raw.assignee || raw.fields.length || raw.tags.length ||
    raw.relates.length || raw.dependsOn.length || raw.subtaskOf.length;

  if (Object.keys(patch).length === 0 && !hasFieldWork) {
    throw new AppError('nothing to update: pass at least one of --summary, --description, --state, --assignee, --field, --tag, --relates, --depends-on, --subtask-of');
  }

  // Validate field/tag/link/assignee inputs before mutating anything.
  const projectKey = id.split('-')[0];
  const commands = hasFieldWork ? await prepareCommands(api, raw, projectKey) : [];

  if (Object.keys(patch).length) await api.updateIssue(id, patch);
  await applyPrepared(api, id, commands);

  return api.readIssue(id);
}
```

Note: `updateIssue` in api.mjs already handles summary/description/state. The
project key for schema lookup is derived from the issue id prefix (e.g. `ABC-215`
→ `ABC`), which matches project short-names in this instance.

- [ ] **Step 2: Verify update end-to-end**

Run (use a disposable test issue id from Task 7, here shown as `ABC-XXX`):
```bash
node bin/trackpilot.mjs update ABC-XXX --field "Estimation=2d" --tag unplanned
```
Expected: JSON shows Estimation `2d` and `unplanned` in `tags`, no errors.

- [ ] **Step 3: Verify a bad value is rejected with suggestions**

Run: `node bin/trackpilot.mjs update ABC-XXX --assignee "nobody-xyz"`
Expected: `{ "error": "unknown user \"nobody-xyz\". Did you mean: ..." }`, exit 1.

- [ ] **Step 4: Commit**

```bash
git add src/commands/update.mjs
git commit -m "feat: update accepts assignee/field/tag/link flags with validation"
```

---

## Task 9: `fields <PROJECT>` discovery command

**Files:**
- Create: `src/commands/fields.mjs`
- Modify: `bin/trackpilot.mjs:10-33` (import + COMMANDS), `bin/trackpilot.mjs:35-57` (USAGE)
- Test: manual

- [ ] **Step 1: Implement `src/commands/fields.mjs`**

```javascript
// trackpilot fields <PROJECT>
// Print the project's custom fields (name, type, allowed values) plus the
// instance tag list -- the values you can pass to create/update.

import { AppError } from '../api.mjs';

export async function run({ api, positionals }) {
  const project = positionals[0];
  if (!project) throw new AppError('usage: trackpilot fields <PROJECT>');
  const [schema, tags] = await Promise.all([api.projectSchema(project), api.tags()]);
  return { project, fields: schema, tags };
}
```

- [ ] **Step 2: Register the command in `bin/trackpilot.mjs`**

Add the import alongside the others (after the `release` import):

```javascript
import { run as fields } from '../src/commands/fields.mjs';
```

Add to the `COMMANDS` map:

```javascript
  fields: { handler: fields, needsApi: true },
```

In the `USAGE` template, add this line under the command list (after the
`command` line):

```
  fields <PROJECT>                     List a project's fields, allowed values, and tags
```

And update the `create`/`update` USAGE lines to mention the new flags:

```
  create --project <KEY> --summary "..." [--description ...] [--type <Type>] [--assignee <user>] [--field "Name=Value" ...] [--tag <name> ...] [--relates <ID> ...]
  update <id> [--summary ...] [--description ...] [--state ...] [--assignee <user>] [--field "Name=Value" ...] [--tag <name> ...] [--relates <ID> ...]
```

- [ ] **Step 3: Verify**

Run: `node bin/trackpilot.mjs fields ABC`
Expected: JSON with `fields` (each `{name,type,values}` — e.g. Squad → [Squad 1, Squad 2], Team → [...], Type → [Bug, Epic, Task, User Story]) and `tags` (incl. `scope:infra`, `unplanned`).

- [ ] **Step 4: Commit**

```bash
git add src/commands/fields.mjs bin/trackpilot.mjs
git commit -m "feat: add 'fields <PROJECT>' discovery command; update usage"
```

---

## Task 10: README + full test run

**Files:**
- Modify: `README.md`
- Test: `yarn test`

- [ ] **Step 1: Update README**

In `README.md`, update the `create` section and add new flags + the `fields`
command. Document, with an example, the one-shot create:

```bash
trackpilot create --project ABC --summary "Release" --type Task \
  --assignee "Javad Tavakoli" \
  --field "Squad=Squad 2" --field "Team=Front-End" --field "Team=QA" \
  --field "Estimation=1d" \
  --tag scope:infra --tag unplanned \
  --relates ABC-211
```

State explicitly: values are validated before writing (unknown tag/user/field
value → error with suggestions); `--field` accepts any field type and repeats for
multi-value fields; `read`/`list` output now includes `tags` and `links`; use
`trackpilot fields <PROJECT>` to discover valid field values and tags.

- [ ] **Step 2: Run the whole unit suite**

Run: `cd /home/javad/Projects/youtrack-cli && yarn test`
Expected: PASS — all suites green (smoke, resolve, shape, schema, build-commands, apply-fields).

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document one-shot create flags and fields command"
```

---

## Task 11: End-to-end acceptance (the original pain, re-run)

**Files:** none (verification only)

- [ ] **Step 1: Recreate the ABC-215-style task in ONE command**

Run:
```bash
node bin/trackpilot.mjs create --project ABC --summary "Release (e2e check — delete me)" \
  --description "Release rango-client first, then app-v2." --type Task \
  --assignee "Javad Tavakoli" \
  --field "Squad=Squad 2" --field "Team=Front-End" --field "Team=QA" --field "Estimation=1d" \
  --tag scope:infra --tag unplanned --relates ABC-211
```
Expected: one JSON object, no errors, with: `assignee: "Javad Tavakoli"`,
`tags: ["scope:infra","unplanned"]`, `links: [{type:"Relates",...,id:"ABC-211"}]`,
and `customFields` showing Squad Squad 2, Team "Front-End, QA", Estimation 1d,
Type Task. This is the entire original task in a single call — confirming the
~10-round-trip workflow is now one.

- [ ] **Step 2: Confirm the stray-tag class of bug is blocked**

Run the same command but with `--tag infra`.
Expected: error with `Did you mean: scope:infra` and (per the pre-create
resolution, if implemented) no issue created.

- [ ] **Step 3: Mark the e2e test issue(s) Done**

```bash
node bin/trackpilot.mjs command <id> --query "State Done"
```

- [ ] **Step 4: Final commit / branch ready for PR**

```bash
git log --oneline origin/main..HEAD
```
Expected: the task commits listed, branch `feat/one-shot-task-authoring` ready to open a PR.

---

## Notes for the implementer

- **No new runtime dependencies.** Tests use built-in `node:test`/`node:assert`. The `test/` dir is not in `package.json` `files`, so it won't ship to npm.
- **Command formatting was verified against the live instance** via `/commands/assist`: one concern per command, no braces, multi-word values fine. Do not add brace-quoting.
- **Admin field endpoints are blocked** under the token; schema comes only from reading one issue (`projectSchema`). Don't switch to `/admin/projects/{id}/customFields`.
- **`for me`** resolves to login `Javadtavakoli95`; assignee resolution matches on login/name/fullName and passes the login to `for <login>`.
- Keep each file single-purpose; `apply-fields.mjs` is the only place that orchestrates lookups + assist + apply.
