import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shapeIssue, shapeLinks, shapeSchema } from '../src/api.mjs';

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

test('shapeSchema marks required when projectCustomField.canBeEmpty is false', () => {
  const issue = {
    customFields: [
      { name: 'Squad', $type: 'SingleEnumIssueCustomField', projectCustomField: { canBeEmpty: false, bundle: { values: [{ name: 'A' }, { name: 'B' }] } } },
      { name: 'Priority', $type: 'SingleEnumIssueCustomField', projectCustomField: { canBeEmpty: true, bundle: { values: [{ name: 'Normal' }] } } },
      { name: 'Note', $type: 'TextIssueCustomField', projectCustomField: {} },
      { name: 'Orphan', $type: 'SimpleIssueCustomField' },
    ],
  };
  const schema = shapeSchema(issue);
  assert.deepEqual(schema, [
    { name: 'Squad', type: 'SingleEnumIssueCustomField', required: true, values: ['A', 'B'] },
    { name: 'Priority', type: 'SingleEnumIssueCustomField', required: false, values: ['Normal'] },
    { name: 'Note', type: 'TextIssueCustomField', required: false, values: [] },
    { name: 'Orphan', type: 'SimpleIssueCustomField', required: false, values: [] },
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
