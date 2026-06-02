import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCommands } from '../src/build-commands.mjs';

test('builds tag and link commands in order', () => {
  const cmds = buildCommands({ tags: ['scope:infra', 'unplanned'], relates: ['RC-211'], dependsOn: ['RC-1'], subtaskOf: ['RC-2'] });
  assert.deepEqual(cmds, [
    { concern: 'tag:scope:infra', command: 'add tag scope:infra' },
    { concern: 'tag:unplanned', command: 'add tag unplanned' },
    { concern: 'link:relates:RC-211', command: 'relates to RC-211' },
    { concern: 'link:depends:RC-1', command: 'depends on RC-1' },
    { concern: 'link:subtask:RC-2', command: 'subtask of RC-2' },
  ]);
});

test('returns [] for no inputs', () => {
  assert.deepEqual(buildCommands({}), []);
});
