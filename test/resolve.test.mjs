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
