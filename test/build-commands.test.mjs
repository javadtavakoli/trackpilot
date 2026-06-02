import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCommands } from '../src/build-commands.mjs';

test('builds tag and link commands in order', () => {
  const cmds = buildCommands({ tags: ['scope:infra', 'unplanned'], relates: ['ABC-211'], dependsOn: ['ABC-1'], subtaskOf: ['ABC-2'] });
  assert.deepEqual(cmds, [
    { concern: 'tag:scope:infra', command: 'add tag scope:infra' },
    { concern: 'tag:unplanned', command: 'add tag unplanned' },
    { concern: 'link:relates:ABC-211', command: 'relates to ABC-211' },
    { concern: 'link:depends:ABC-1', command: 'depends on ABC-1' },
    { concern: 'link:subtask:ABC-2', command: 'subtask of ABC-2' },
  ]);
});

test('returns [] for no inputs', () => {
  assert.deepEqual(buildCommands({}), []);
});
