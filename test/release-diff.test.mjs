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
  assert.equal(out.commits, 2);
  assert.equal(out.issueCount, 1);
  assert.deepEqual(out.knownProjectKeys, ['ABC', 'XYZ']);
});

test('releaseDiff coerces non-string base/head to main/next defaults', async () => {
  const out = await releaseDiff(fakeApi(), { base: true, head: undefined }, fakeGit);
  assert.equal(out.range, 'main..next');
});

test('releaseDiff forwards cwd to git.commitMessages', async () => {
  let capturedCwd;
  const git = {
    commitMessages: async (_b, _h, { cwd } = {}) => { capturedCwd = cwd; return []; },
    extractIssueTokens: () => [],
  };
  await releaseDiff(fakeApi(), { base: 'main', head: 'next', cwd: '/some/path' }, git);
  assert.equal(capturedCwd, '/some/path');
});
