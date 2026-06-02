import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isReleasable } from '../src/release.mjs';

const c = (subject, body = '') => ({ subject, body });

test('isReleasable: true for feat', () => {
  assert.equal(isReleasable([c('feat: add thing')]), true);
});

test('isReleasable: true for fix / perf / revert', () => {
  assert.equal(isReleasable([c('fix: a')]), true);
  assert.equal(isReleasable([c('perf: b')]), true);
  assert.equal(isReleasable([c('revert: c')]), true);
});

test('isReleasable: true for scoped types', () => {
  assert.equal(isReleasable([c('feat(api): add endpoint')]), true);
});

test('isReleasable: true for a breaking-change bang', () => {
  assert.equal(isReleasable([c('refactor(core)!: rename export')]), true);
});

test('isReleasable: true for a BREAKING CHANGE footer', () => {
  assert.equal(isReleasable([c('chore: x', 'body\n\nBREAKING CHANGE: gone')]), true);
});

test('isReleasable: false for docs/chore/test/ci only', () => {
  assert.equal(isReleasable([c('docs: readme'), c('test: cover'), c('ci: tweak'), c('chore: dep')]), false);
});

test('isReleasable: false for an empty range', () => {
  assert.equal(isReleasable([]), false);
});

test('isReleasable: true when any commit in a mixed set qualifies', () => {
  assert.equal(isReleasable([c('docs: a'), c('feat: b'), c('chore: c')]), true);
});
