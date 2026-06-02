import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertAssistClean, resolveInputs, prepareCreate, applyPrepared } from '../src/apply-fields.mjs';

test('assertAssistClean passes when all commands ok and no new tag', () => {
  assert.doesNotThrow(() =>
    assertAssistClean([
      { description: 'Add Assignee testuser', error: false },
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
const users = [{ login: 'testuser', name: 'Test User', fullName: 'Test User' }];
const tags = ['scope:infra', 'unplanned'];

test('resolveInputs maps assignee, enum field, period field, and tag to canonical', () => {
  const out = resolveInputs({
    raw: {
      assignee: 'test user',
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
  assert.equal(out.assignee, 'testuser');
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

// --- prepareCreate / applyPrepared (orchestration) -------------------------

function mockApi(overrides = {}) {
  const calls = [];
  const rec = (name) => (...args) => {
    calls.push({ name, args });
    const fn = overrides[name];
    return Promise.resolve(typeof fn === 'function' ? fn(...args) : fn);
  };
  return {
    calls,
    projectSchema: rec('projectSchema'),
    users: rec('users'),
    tags: rec('tags'),
    assist: rec('assist'),
    applyCommands: rec('applyCommands'),
  };
}

test('prepareCreate returns empty payload and fetches nothing when there is no work', async () => {
  const api = mockApi();
  const out = await prepareCreate(api, {}, 'ABC');
  assert.deepEqual(out, { customFields: [], commands: [] });
  assert.equal(api.calls.length, 0);
});

test('prepareCreate does no lookups when only links are present', async () => {
  const api = mockApi();
  const out = await prepareCreate(api, { relates: ['ABC-1'] }, 'ABC');
  assert.deepEqual(api.calls.map((c) => c.name), []);
  assert.deepEqual(out.customFields, []);
  assert.deepEqual(out.commands, [{ concern: 'link:relates:ABC-1', command: 'relates to ABC-1' }]);
});

test('prepareCreate builds typed customFields (fields + assignee) and tag/link commands', async () => {
  const api = mockApi({
    tags: ['scope:infra', 'unplanned'],
    users: [{ login: 'jdoe', name: 'Jane Doe', fullName: 'Jane Doe' }],
    projectSchema: [
      { name: 'Squad', type: 'SingleEnumIssueCustomField', values: ['Squad 1', 'Squad 2'] },
      { name: 'Team', type: 'MultiEnumIssueCustomField', values: ['Front-End', 'QA'] },
      { name: 'Assignee', type: 'MultiUserIssueCustomField', values: [] },
    ],
  });
  const out = await prepareCreate(
    api,
    { assignee: 'jane doe', fields: [{ name: 'Squad', value: 'Squad 2' }, { name: 'Team', value: 'Front-End' }, { name: 'Team', value: 'QA' }], tags: ['unplanned'], relates: ['ABC-211'] },
    'ABC',
  );
  assert.deepEqual(api.calls.map((c) => c.name).sort(), ['projectSchema', 'tags', 'users']);
  assert.deepEqual(out.customFields, [
    { name: 'Squad', $type: 'SingleEnumIssueCustomField', value: { name: 'Squad 2' } },
    { name: 'Team', $type: 'MultiEnumIssueCustomField', value: [{ name: 'Front-End' }, { name: 'QA' }] },
    { name: 'Assignee', $type: 'MultiUserIssueCustomField', value: [{ login: 'jdoe' }] },
  ]);
  assert.deepEqual(out.commands, [
    { concern: 'tag:unplanned', command: 'add tag unplanned' },
    { concern: 'link:relates:ABC-211', command: 'relates to ABC-211' },
  ]);
});

test('prepareCreate fetches schema (not users/tags) when only fields present', async () => {
  const api = mockApi({ projectSchema: [{ name: 'Estimation', type: 'PeriodIssueCustomField', values: [] }] });
  const out = await prepareCreate(api, { fields: [{ name: 'Estimation', value: '1d' }] }, 'ABC');
  assert.deepEqual(api.calls.map((c) => c.name), ['projectSchema']);
  assert.deepEqual(out.customFields, [{ name: 'Estimation', $type: 'PeriodIssueCustomField', value: { presentation: '1d' } }]);
  assert.deepEqual(out.commands, []);
});

test('applyPrepared is a no-op on empty commands', async () => {
  const api = mockApi();
  await applyPrepared(api, 'ABC-1', []);
  assert.equal(api.calls.length, 0);
});

test('applyPrepared runs assist before applyCommands and aborts on assist error', async () => {
  const api = mockApi({ assist: [{ description: 'Type expected: Foo', error: true }] });
  const commands = [{ concern: 'field:Type', command: 'Type Foo' }];
  await assert.rejects(() => applyPrepared(api, 'ABC-1', commands), /Type expected: Foo/);
  // assist was called, applyCommands was NOT (aborted by assertAssistClean)
  assert.deepEqual(api.calls.map((c) => c.name), ['assist']);
});

test('applyPrepared applies commands after a clean assist, in order', async () => {
  const api = mockApi({ assist: [{ description: 'Set Type Task', error: false }] });
  const commands = [{ concern: 'field:Type', command: 'Type Task' }];
  await applyPrepared(api, 'ABC-1', commands);
  assert.deepEqual(api.calls.map((c) => c.name), ['assist', 'applyCommands']);
  assert.deepEqual(api.calls[0].args, ['ABC-1', 'Type Task']); // assist gets joined command string
  assert.deepEqual(api.calls[1].args, ['ABC-1', commands]);
});

test('applyPrepared assists the joined string then applies all commands', async () => {
  const api = mockApi({ assist: [
    { description: 'Add tag unplanned', error: false },
    { description: 'relates to ABC-211', error: false },
  ] });
  const commands = [
    { concern: 'tag:unplanned', command: 'add tag unplanned' },
    { concern: 'link:relates:ABC-211', command: 'relates to ABC-211' },
  ];
  await applyPrepared(api, 'ABC-1', commands);
  assert.deepEqual(api.calls.map((c) => c.name), ['assist', 'applyCommands']);
  assert.deepEqual(api.calls[0].args, ['ABC-1', 'add tag unplanned relates to ABC-211']);
  assert.deepEqual(api.calls[1].args, ['ABC-1', commands]);
});
