import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCommands } from '../src/build-commands.mjs';

test('builds commands in order: assignee, fields, tags, links', () => {
  const cmds = buildCommands({
    assignee: 'Javadtavakoli95',
    fields: [
      { name: 'RC Squad', value: 'Squad 2' },
      { name: 'Team', value: 'Front-End' },
      { name: 'Team', value: 'QA' },
      { name: 'Estimation', value: '1d' },
    ],
    tags: ['scope:infra', 'unplanned'],
    relates: ['RC-211'],
    dependsOn: [],
    subtaskOf: [],
  });
  assert.deepEqual(cmds, [
    { concern: 'assignee', command: 'for Javadtavakoli95' },
    { concern: 'field:RC Squad', command: 'RC Squad Squad 2' },
    { concern: 'field:Team', command: 'Team Front-End' },
    { concern: 'field:Team', command: 'Team QA' },
    { concern: 'field:Estimation', command: 'Estimation 1d' },
    { concern: 'tag:scope:infra', command: 'add tag scope:infra' },
    { concern: 'tag:unplanned', command: 'add tag unplanned' },
    { concern: 'link:relates:RC-211', command: 'relates to RC-211' },
  ]);
});

test('omits empty groups and returns [] for no inputs', () => {
  assert.deepEqual(buildCommands({}), []);
});

test('builds depends-on and subtask-of links', () => {
  const cmds = buildCommands({ dependsOn: ['RC-1'], subtaskOf: ['RC-2'] });
  assert.deepEqual(cmds, [
    { concern: 'link:depends:RC-1', command: 'depends on RC-1' },
    { concern: 'link:subtask:RC-2', command: 'subtask of RC-2' },
  ]);
});
