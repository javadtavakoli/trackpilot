import { AppError } from './api.mjs';

// Types where all supplied values are collected into an array.
const MULTI_TYPES = new Set([
  'MultiEnumIssueCustomField',
  'MultiVersionIssueCustomField',
  'MultiBuildIssueCustomField',
  'MultiOwnedIssueCustomField',
  'MultiUserIssueCustomField',
  'MultiGroupIssueCustomField',
]);

// Types whose per-value shape is { name }.
const ENUM_LIKE = new Set([
  'SingleEnumIssueCustomField',
  'StateIssueCustomField',
  'SingleVersionIssueCustomField',
  'SingleBuildIssueCustomField',
  'SingleOwnedIssueCustomField',
  'SingleGroupIssueCustomField',
  'MultiEnumIssueCustomField',
  'MultiVersionIssueCustomField',
  'MultiBuildIssueCustomField',
  'MultiOwnedIssueCustomField',
  'MultiGroupIssueCustomField',
]);

// Types whose per-value shape is { login }.
const USER_LIKE = new Set([
  'SingleUserIssueCustomField',
  'MultiUserIssueCustomField',
]);

// Shape a single raw value string for the given $type.
function shapeOne(type, v) {
  if (ENUM_LIKE.has(type)) return { name: v };
  if (USER_LIKE.has(type)) return { login: v };
  if (type === 'PeriodIssueCustomField') return { presentation: v };
  if (type === 'TextIssueCustomField') return { text: v };
  if (type === 'SimpleIssueCustomField') return v;
  return null; // unknown — handled below
}

/**
 * Convert resolved canonical field inputs into a YouTrack REST customFields
 * payload array. Repeated names are merged per their type arity: multi-valued
 * types collect all values; single-valued types use the last supplied value.
 *
 * @param {{ name: string, value: string }[]} fields
 * @param {{ name: string, type: string, values: string[] }[]} schema
 * @returns {{ name: string, $type: string, value: unknown }[]}
 */
export function buildCustomFields(fields, schema) {
  // Group by canonical field name, preserving first-seen insertion order.
  const groups = new Map(); // lowercased name -> { canonicalName, type, values[] }

  for (const f of fields) {
    const key = f.name.toLowerCase();
    if (!groups.has(key)) {
      const entry = schema.find((s) => s.name.toLowerCase() === key);
      if (!entry) throw new AppError(`unknown field "${f.name}"`);
      groups.set(key, { canonicalName: entry.name, type: entry.type, values: [] });
    }
    groups.get(key).values.push(f.value);
  }

  // Build output array, one entry per grouped field.
  return Array.from(groups.values()).map(({ canonicalName, type, values }) => {
    let value;
    if (MULTI_TYPES.has(type)) {
      value = values.map((v) => shapeOne(type, v));
    } else {
      // Last-wins for single-valued types.
      const shaped = shapeOne(type, values[values.length - 1]);
      if (shaped === null) {
        throw new AppError(`unsupported field type "${type}" for "${canonicalName}"`);
      }
      value = shaped;
    }
    return { name: canonicalName, $type: type, value };
  });
}
