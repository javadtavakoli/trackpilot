import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shapeIssue, shapeLinks } from '../src/api.mjs';

test('shapeLinks keeps only non-empty buckets, flattens to {type,direction,id}', () => {
  const raw = [
    { direction: 'BOTH', linkType: { name: 'Relates' }, issues: [{ idReadable: 'RC-211' }] },
    { direction: 'OUTWARD', linkType: { name: 'Subtask' }, issues: [] },
    { direction: 'OUTWARD', linkType: { name: 'Depend' }, issues: [{ idReadable: 'RC-9' }] },
  ];
  assert.deepEqual(shapeLinks(raw), [
    { type: 'Relates', direction: 'BOTH', id: 'RC-211' },
    { type: 'Depend', direction: 'OUTWARD', id: 'RC-9' },
  ]);
});

test('shapeIssue includes tags and links arrays', () => {
  const issue = {
    idReadable: 'RC-215',
    summary: 'Release',
    description: null,
    project: { shortName: 'RC' },
    reporter: { fullName: 'Javad Tavakoli' },
    customFields: [{ name: 'State', value: { name: 'Open' } }],
    tags: [{ name: 'unplanned' }, { name: 'scope:infra' }],
    links: [{ direction: 'BOTH', linkType: { name: 'Relates' }, issues: [{ idReadable: 'RC-211' }] }],
  };
  const shaped = shapeIssue(issue);
  assert.deepEqual(shaped.tags, ['unplanned', 'scope:infra']);
  assert.deepEqual(shaped.links, [{ type: 'Relates', direction: 'BOTH', id: 'RC-211' }]);
  assert.equal(shaped.state, 'Open');
});
