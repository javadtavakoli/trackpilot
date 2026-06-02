import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertAssistClean, resolveInputs } from '../src/apply-fields.mjs';

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
