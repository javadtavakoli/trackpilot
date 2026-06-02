import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertAssistClean, resolveInputs, prepareCommands, applyPrepared } from '../src/apply-fields.mjs';

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
  { name: 'RC Squad', type: 'SingleEnumIssueCustomField', values: ['Squad 1', 'Squad 2'] },
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
        { name: 'RC Squad', value: 'squad 2' },
        { name: 'Estimation', value: '1d' },
      ],
      tags: ['unplanned'],
      relates: ['RC-211'],
    },
    schema,
    users,
    tags,
  });
  assert.equal(out.assignee, 'testuser');
  assert.deepEqual(out.fields, [
    { name: 'RC Squad', value: 'Squad 2' },
    { name: 'Estimation', value: '1d' }, // period passes through
  ]);
  assert.deepEqual(out.tags, ['unplanned']);
  assert.deepEqual(out.relates, ['RC-211']);
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
    () => resolveInputs({ raw: { fields: [{ name: 'RC Squad', value: 'Squad 9' }] }, schema, users, tags }),
    /Squad 1|Squad 2/,
  );
});

// --- prepareCommands / applyPrepared (orchestration) -------------------------

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

test('prepareCommands returns [] and fetches nothing when there is no work', async () => {
  const api = mockApi();
  const cmds = await prepareCommands(api, {}, 'RC');
  assert.deepEqual(cmds, []);
  assert.equal(api.calls.length, 0);
});

test('prepareCommands does no lookups when only links are present', async () => {
  const api = mockApi();
  const cmds = await prepareCommands(api, { relates: ['RC-1'] }, 'RC');
  assert.deepEqual(api.calls.map((c) => c.name), []); // no schema/users/tags fetch
  assert.deepEqual(cmds, [{ concern: 'link:relates:RC-1', command: 'relates to RC-1' }]);
});

test('prepareCommands fetches only the lookups it needs', async () => {
  const api = mockApi({
    tags: ['scope:infra', 'unplanned'],
    users: [{ login: 'u1', name: 'User One', fullName: 'User One' }],
    projectSchema: [{ name: 'Team', type: 'MultiEnumIssueCustomField', values: ['QA'] }],
  });
  await prepareCommands(api, { assignee: 'user one', tags: ['unplanned'], fields: [{ name: 'Team', value: 'QA' }] }, 'RC');
  const names = api.calls.map((c) => c.name).sort();
  assert.deepEqual(names, ['projectSchema', 'tags', 'users']);
});

test('prepareCommands does NOT fetch users/tags when only fields present', async () => {
  const api = mockApi({ projectSchema: [{ name: 'Estimation', type: 'PeriodIssueCustomField', values: [] }] });
  await prepareCommands(api, { fields: [{ name: 'Estimation', value: '1d' }] }, 'RC');
  assert.deepEqual(api.calls.map((c) => c.name), ['projectSchema']);
});

test('applyPrepared is a no-op on empty commands', async () => {
  const api = mockApi();
  await applyPrepared(api, 'RC-1', []);
  assert.equal(api.calls.length, 0);
});

test('applyPrepared runs assist before applyCommands and aborts on assist error', async () => {
  const api = mockApi({ assist: [{ description: 'Type expected: Foo', error: true }] });
  const commands = [{ concern: 'field:Type', command: 'Type Foo' }];
  await assert.rejects(() => applyPrepared(api, 'RC-1', commands), /Type expected: Foo/);
  // assist was called, applyCommands was NOT (aborted by assertAssistClean)
  assert.deepEqual(api.calls.map((c) => c.name), ['assist']);
});

test('applyPrepared applies commands after a clean assist, in order', async () => {
  const api = mockApi({ assist: [{ description: 'Set Type Task', error: false }] });
  const commands = [{ concern: 'field:Type', command: 'Type Task' }];
  await applyPrepared(api, 'RC-1', commands);
  assert.deepEqual(api.calls.map((c) => c.name), ['assist', 'applyCommands']);
  assert.deepEqual(api.calls[0].args, ['RC-1', 'Type Task']); // assist gets joined command string
  assert.deepEqual(api.calls[1].args, ['RC-1', commands]);
});
