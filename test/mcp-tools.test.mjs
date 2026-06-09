import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../src/mcp-tools.mjs';

// A fake api that records calls and returns a canned value per method.
function fakeApi(returns = {}) {
  const calls = [];
  const handler = {
    get(_t, method) {
      return (...args) => {
        calls.push({ method, args });
        return returns[method] ?? { ok: method };
      };
    },
  };
  const api = new Proxy({}, handler);
  return { api, calls };
}

function tool(name) {
  const t = TOOLS.find((x) => x.name === name);
  assert.ok(t, `tool ${name} should exist`);
  return t;
}

test('exposes exactly the 12 expected tools', () => {
  const names = TOOLS.map((t) => t.name).sort();
  assert.deepEqual(names, [
    'add_comment', 'apply_command', 'create_issue', 'list_projects',
    'list_tags', 'list_users', 'log_work', 'project_schema',
    'read_issue', 'search', 'update_issue', 'whoami',
  ]);
});

test('every tool has name, description, an object inputSchema, and a handler', () => {
  for (const t of TOOLS) {
    assert.equal(typeof t.name, 'string');
    assert.equal(typeof t.description, 'string');
    assert.equal(typeof t.inputSchema, 'object');
    assert.equal(typeof t.handler, 'function');
  }
});

test('search calls api.search(query, limit)', async () => {
  const { api, calls } = fakeApi({ search: [{ id: 'ABC-1' }] });
  const out = await tool('search').handler(api, { query: 'project: ABC', limit: 5 });
  assert.deepEqual(calls.at(-1), { method: 'search', args: ['project: ABC', 5] });
  assert.deepEqual(out, [{ id: 'ABC-1' }]);
});

test('read_issue calls api.readIssue(id)', async () => {
  const { api, calls } = fakeApi();
  await tool('read_issue').handler(api, { id: 'ABC-123' });
  assert.deepEqual(calls.at(-1), { method: 'readIssue', args: ['ABC-123'] });
});

test('list_projects calls api.projects() with no args', async () => {
  const { api, calls } = fakeApi();
  await tool('list_projects').handler(api, {});
  assert.deepEqual(calls.at(-1), { method: 'projects', args: [] });
});

test('project_schema calls api.projectSchema(project)', async () => {
  const { api, calls } = fakeApi();
  await tool('project_schema').handler(api, { project: 'ABC' });
  assert.deepEqual(calls.at(-1), { method: 'projectSchema', args: ['ABC'] });
});

test('whoami calls api.me()', async () => {
  const { api, calls } = fakeApi();
  await tool('whoami').handler(api, {});
  assert.deepEqual(calls.at(-1), { method: 'me', args: [] });
});

test('create_issue routes through issue-ops: createIssue then readIssue', async () => {
  const { api, calls } = fakeApi({ createIssue: 'ABC-1', readIssue: { id: 'ABC-1' } });
  const out = await tool('create_issue').handler(api, { project: 'ABC', summary: 'S', description: 'D' });
  assert.deepEqual(calls[0], { method: 'createIssue', args: [{ project: 'ABC', summary: 'S', description: 'D', customFields: [] }] });
  assert.deepEqual(calls.at(-1), { method: 'readIssue', args: ['ABC-1'] });
  assert.deepEqual(out, { id: 'ABC-1' });
});

test('create_issue forwards custom fields through to api.createIssue', async () => {
  const { api, calls } = fakeApi({
    projectSchema: [{ name: 'Priority', type: 'SingleEnumIssueCustomField', values: ['Normal', 'Major'] }],
    createIssue: 'ABC-3',
    readIssue: { id: 'ABC-3' },
  });
  await tool('create_issue').handler(api, { project: 'ABC', summary: 'S', fields: [{ name: 'Priority', value: 'Major' }] });
  const create = calls.find((c) => c.method === 'createIssue');
  assert.deepEqual(create.args[0].customFields, [
    { name: 'Priority', $type: 'SingleEnumIssueCustomField', value: { name: 'Major' } },
  ]);
});

test('update_issue routes through issue-ops: updateIssue patch then readIssue', async () => {
  const { api, calls } = fakeApi({ readIssue: { id: 'ABC-1' } });
  await tool('update_issue').handler(api, { id: 'ABC-1', state: 'Fixed' });
  assert.deepEqual(calls[0], { method: 'updateIssue', args: ['ABC-1', { state: 'Fixed' }] });
  assert.equal(calls.at(-1).method, 'readIssue');
});

test('add_comment calls api.addComment(id, text)', async () => {
  const { api, calls } = fakeApi();
  await tool('add_comment').handler(api, { id: 'ABC-1', text: 'hi' });
  assert.deepEqual(calls.at(-1), { method: 'addComment', args: ['ABC-1', 'hi'] });
});

test('log_work passes id and a work item object', async () => {
  const { api, calls } = fakeApi();
  await tool('log_work').handler(api, { id: 'ABC-1', minutes: 30, text: 'w' });
  assert.deepEqual(calls.at(-1), { method: 'logWorkItem', args: ['ABC-1', { minutes: 30, text: 'w', date: undefined, type: undefined }] });
});

test('apply_command calls api.applyCommand(id, query)', async () => {
  const { api, calls } = fakeApi();
  await tool('apply_command').handler(api, { id: 'ABC-1', query: 'State Fixed' });
  assert.deepEqual(calls.at(-1), { method: 'applyCommand', args: ['ABC-1', 'State Fixed'] });
});

test('list_tags and list_users call tags() and users()', async () => {
  const { api, calls } = fakeApi();
  await tool('list_tags').handler(api, {});
  assert.deepEqual(calls.at(-1), { method: 'tags', args: [] });
  await tool('list_users').handler(api, {});
  assert.deepEqual(calls.at(-1), { method: 'users', args: [] });
});
