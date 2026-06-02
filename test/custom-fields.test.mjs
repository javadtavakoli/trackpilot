import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCustomFields } from '../src/custom-fields.mjs';

const schema = [
  { name: 'RC Squad', type: 'SingleEnumIssueCustomField', values: ['Squad 1', 'Squad 2'] },
  { name: 'Type', type: 'SingleEnumIssueCustomField', values: ['Bug', 'Task'] },
  { name: 'Team', type: 'MultiEnumIssueCustomField', values: ['Front-End', 'QA', 'Design'] },
  { name: 'Estimation', type: 'PeriodIssueCustomField', values: [] },
  { name: 'Assignee', type: 'MultiUserIssueCustomField', values: [] },
  { name: 'QA', type: 'SingleUserIssueCustomField', values: [] },
  { name: 'Developer Note', type: 'TextIssueCustomField', values: [] },
  { name: 'Story Point', type: 'SimpleIssueCustomField', values: [] },
];

test('single enum -> { name }', () => {
  assert.deepEqual(buildCustomFields([{ name: 'RC Squad', value: 'Squad 2' }], schema), [
    { name: 'RC Squad', $type: 'SingleEnumIssueCustomField', value: { name: 'Squad 2' } },
  ]);
});

test('multi enum collects repeated values into an array', () => {
  assert.deepEqual(
    buildCustomFields([{ name: 'Team', value: 'Front-End' }, { name: 'Team', value: 'QA' }], schema),
    [{ name: 'Team', $type: 'MultiEnumIssueCustomField', value: [{ name: 'Front-End' }, { name: 'QA' }] }],
  );
});

test('multi user -> [{ login }]', () => {
  assert.deepEqual(buildCustomFields([{ name: 'Assignee', value: 'jdoe' }], schema), [
    { name: 'Assignee', $type: 'MultiUserIssueCustomField', value: [{ login: 'jdoe' }] },
  ]);
});

test('single user -> { login }', () => {
  assert.deepEqual(buildCustomFields([{ name: 'QA', value: 'jdoe' }], schema), [
    { name: 'QA', $type: 'SingleUserIssueCustomField', value: { login: 'jdoe' } },
  ]);
});

test('period -> { presentation }', () => {
  assert.deepEqual(buildCustomFields([{ name: 'Estimation', value: '1d' }], schema), [
    { name: 'Estimation', $type: 'PeriodIssueCustomField', value: { presentation: '1d' } },
  ]);
});

test('text -> { text }', () => {
  assert.deepEqual(buildCustomFields([{ name: 'Developer Note', value: 'hi' }], schema), [
    { name: 'Developer Note', $type: 'TextIssueCustomField', value: { text: 'hi' } },
  ]);
});

test('simple -> raw scalar', () => {
  assert.deepEqual(buildCustomFields([{ name: 'Story Point', value: '3' }], schema), [
    { name: 'Story Point', $type: 'SimpleIssueCustomField', value: '3' },
  ]);
});

test('single-valued type with duplicates uses last-wins', () => {
  assert.deepEqual(
    buildCustomFields([{ name: 'RC Squad', value: 'Squad 1' }, { name: 'RC Squad', value: 'Squad 2' }], schema),
    [{ name: 'RC Squad', $type: 'SingleEnumIssueCustomField', value: { name: 'Squad 2' } }],
  );
});

test('preserves first-seen field order', () => {
  const out = buildCustomFields(
    [{ name: 'Type', value: 'Task' }, { name: 'RC Squad', value: 'Squad 2' }],
    schema,
  );
  assert.deepEqual(out.map((f) => f.name), ['Type', 'RC Squad']);
});

test('case-insensitive field name match, outputs canonical name', () => {
  const out = buildCustomFields([{ name: 'rc squad', value: 'Squad 2' }], schema);
  assert.equal(out[0].name, 'RC Squad');
});

test('unknown field throws', () => {
  assert.throws(() => buildCustomFields([{ name: 'Nope', value: 'x' }], schema), /unknown field "Nope"/);
});

test('multi group -> [{ name }]', () => {
  const groupSchema = [{ name: 'Groups', type: 'MultiGroupIssueCustomField', values: [] }];
  assert.deepEqual(buildCustomFields([{ name: 'Groups', value: 'X' }], groupSchema), [
    { name: 'Groups', $type: 'MultiGroupIssueCustomField', value: [{ name: 'X' }] },
  ]);
});

test('empty input -> []', () => {
  assert.deepEqual(buildCustomFields([], schema), []);
});
