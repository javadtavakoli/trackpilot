import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asContent } from '../src/mcp.mjs';

test('asContent wraps a value as pretty-printed JSON text', () => {
  const out = asContent({ a: 1 });
  assert.equal(out.content[0].type, 'text');
  assert.equal(out.content[0].text, JSON.stringify({ a: 1 }, null, 2));
});

test('asContent coerces void (undefined) results to a string, not undefined', () => {
  const out = asContent(undefined);
  assert.equal(typeof out.content[0].text, 'string'); // SDK requires a string
  assert.equal(out.content[0].text, JSON.stringify({ ok: true }, null, 2));
});

test('asContent renders null as the JSON string "null"', () => {
  const out = asContent(null);
  assert.equal(out.content[0].text, 'null');
});
