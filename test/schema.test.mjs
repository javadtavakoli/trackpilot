import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shapeSchema } from '../src/api.mjs';

test('shapeSchema extracts field name, type, and bundle values', () => {
  const issue = {
    customFields: [
      {
        name: 'Type',
        $type: 'SingleEnumIssueCustomField',
        projectCustomField: {
          field: { name: 'Type' },
          bundle: { values: [{ name: 'Bug' }, { name: 'Task' }, { name: 'User Story' }] },
        },
      },
      {
        name: 'Estimation',
        $type: 'PeriodIssueCustomField',
        projectCustomField: { field: { name: 'Estimation' } },
      },
    ],
  };
  assert.deepEqual(shapeSchema(issue), [
    { name: 'Type', type: 'SingleEnumIssueCustomField', required: false, values: ['Bug', 'Task', 'User Story'] },
    { name: 'Estimation', type: 'PeriodIssueCustomField', required: false, values: [] },
  ]);
});
