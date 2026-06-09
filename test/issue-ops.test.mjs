import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createIssue, updateIssue } from '../src/issue-ops.mjs';
import { AppError } from '../src/api.mjs';

// Records calls; returns canned values keyed by method name.
function fakeApi(returns = {}) {
  const calls = [];
  const api = new Proxy({}, {
    get(_t, method) {
      return (...args) => {
        calls.push({ method, args });
        return returns[method] ?? { ok: method };
      };
    },
  });
  return { api, calls };
}

test('createIssue with no extra fields: createIssue([{...customFields:[]}]) then readIssue', async () => {
  const { api, calls } = fakeApi({ createIssue: 'ABC-1', readIssue: { id: 'ABC-1' } });
  const out = await createIssue(api, { project: 'ABC', summary: 'S', description: 'D' });
  assert.deepEqual(calls[0], { method: 'createIssue', args: [{ project: 'ABC', summary: 'S', description: 'D', customFields: [] }] });
  assert.deepEqual(calls.at(-1), { method: 'readIssue', args: ['ABC-1'] });
  assert.deepEqual(out, { id: 'ABC-1' });
});

test('createIssue folds type into customFields and resolves enum values', async () => {
  const { api, calls } = fakeApi({
    projectSchema: [{ name: 'Type', type: 'SingleEnumIssueCustomField', values: ['Task', 'Bug'] }],
    createIssue: 'ABC-2',
    readIssue: { id: 'ABC-2' },
  });
  await createIssue(api, { project: 'ABC', summary: 'S', type: 'Task' });
  const create = calls.find((c) => c.method === 'createIssue');
  assert.deepEqual(create.args[0].customFields, [
    { name: 'Type', $type: 'SingleEnumIssueCustomField', value: { name: 'Task' } },
  ]);
});

test('updateIssue applies patch, setCustomFields, then readIssue', async () => {
  const { api, calls } = fakeApi({ readIssue: { id: 'ABC-1' } });
  await updateIssue(api, 'ABC-1', { state: 'Fixed' });
  const methods = calls.map((c) => c.method);
  assert.deepEqual(methods, ['updateIssue', 'setCustomFields', 'readIssue']);
  assert.deepEqual(calls[0], { method: 'updateIssue', args: ['ABC-1', { state: 'Fixed' }] });
});

test('updateIssue with no actionable input throws', async () => {
  const { api } = fakeApi();
  await assert.rejects(() => updateIssue(api, 'ABC-1', {}), (e) => e instanceof AppError && /nothing to update/.test(e.message));
});

test('updateIssue with field work calls prepareCreate and setCustomFields with the resolved payload', async () => {
  const { api, calls } = fakeApi({
    projectSchema: [{ name: 'Priority', type: 'SingleEnumIssueCustomField', values: ['Major', 'Minor'] }],
    readIssue: { id: 'ABC-1' },
  });
  await updateIssue(api, 'ABC-1', { fields: [{ name: 'Priority', value: 'Major' }] });
  const setCall = calls.find((c) => c.method === 'setCustomFields');
  assert.ok(setCall, 'setCustomFields should be called');
  assert.deepEqual(setCall.args, ['ABC-1', [
    { name: 'Priority', $type: 'SingleEnumIssueCustomField', value: { name: 'Major' } },
  ]]);
});
