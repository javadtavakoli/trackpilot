import { AppError } from './api.mjs';
import { resolveValue } from './resolve.mjs';
import { buildCommands } from './build-commands.mjs';
import { buildCustomFields } from './custom-fields.mjs';

const ASSIGNEE_FIELD = 'Assignee';

const ENUM_TYPES = new Set([
  'SingleEnumIssueCustomField',
  'MultiEnumIssueCustomField',
  'SingleBuildIssueCustomField',
  'SingleVersionIssueCustomField',
  'MultiVersionIssueCustomField',
]);

// Throws if any parsed command errored, or if a tag would be newly created
// (YouTrack reports that as "Add new tag X" with error:false).
export function assertAssistClean(results) {
  for (const c of results) {
    if (c.error) throw new AppError(`YouTrack rejected: ${c.description}`);
    if (/add new tag/i.test(c.description || '')) {
      throw new AppError(`refusing to create a new tag: ${c.description}`);
    }
  }
}

// Pure: resolve raw inputs to canonical values using the provided lookup data.
// Throws AppError (with suggestions) on any miss.
export function resolveInputs({ raw = {}, schema = [], users = [], tags = [] }) {
  const out = {
    assignee: undefined,
    fields: [],
    tags: [],
    relates: raw.relates || [],
    dependsOn: raw.dependsOn || [],
    subtaskOf: raw.subtaskOf || [],
  };

  if (raw.assignee) {
    const opts = users.map((u) => ({ value: u.login, keys: [u.login, u.name, u.fullName].filter(Boolean) }));
    const r = resolveValue(raw.assignee, opts);
    if (!r.match) {
      const hint = r.suggestions.length ? ` Did you mean: ${r.suggestions.join(', ')}?` : '';
      throw new AppError(`unknown user "${raw.assignee}".${hint}`);
    }
    out.assignee = r.match;
  }

  for (const f of raw.fields || []) {
    const field = schema.find((s) => s.name.toLowerCase() === f.name.toLowerCase());
    if (!field) {
      const names = schema.map((s) => s.name).join(', ');
      throw new AppError(`unknown field "${f.name}". Valid fields: ${names}`);
    }
    if (ENUM_TYPES.has(field.type) && field.values.length) {
      const r = resolveValue(f.value, field.values.map((v) => ({ value: v, keys: [v] })));
      if (!r.match) {
        throw new AppError(`"${f.value}" is not valid for ${field.name}. Valid: ${field.values.join(', ')}`);
      }
      out.fields.push({ name: field.name, value: r.match });
    } else {
      // period / text / simple / user-typed fields pass through unchanged; enum values are the only ones validated here
      out.fields.push({ name: field.name, value: f.value });
    }
  }

  for (const t of raw.tags || []) {
    const r = resolveValue(t, tags.map((name) => ({ value: name, keys: [name] })));
    if (!r.match) {
      const hint = r.suggestions.length ? ` Did you mean: ${r.suggestions.join(', ')}?` : '';
      throw new AppError(`unknown tag "${t}".${hint}`);
    }
    out.tags.push(r.match);
  }

  return out;
}

// Phase 1 (no issue id needed): fetch lookups, resolve/validate, and produce
// BOTH the typed customFields payload (fields + assignee, set via REST) and the
// tag/link command list. Throws AppError (with suggestions) on any bad value
// BEFORE anything is written.
export async function prepareCreate(api, raw, projectKey) {
  const has = (arr) => Array.isArray(arr) && arr.length > 0;
  const needSchema = has(raw.fields) || !!raw.assignee; // assignee needs its field $type
  const needUsers = !!raw.assignee;
  const needTags = has(raw.tags);
  if (!needSchema && !needUsers && !needTags &&
      !has(raw.relates) && !has(raw.dependsOn) && !has(raw.subtaskOf)) {
    return { customFields: [], commands: [] };
  }

  const [schema, users, tags] = await Promise.all([
    needSchema ? api.projectSchema(projectKey) : Promise.resolve([]),
    needUsers ? api.users() : Promise.resolve([]),
    needTags ? api.tags() : Promise.resolve([]),
  ]);

  const resolved = resolveInputs({ raw, schema, users, tags });

  const fieldInputs = [...resolved.fields];
  if (resolved.assignee) fieldInputs.push({ name: ASSIGNEE_FIELD, value: resolved.assignee });
  const customFields = buildCustomFields(fieldInputs, schema);

  const commands = buildCommands({
    tags: resolved.tags,
    relates: resolved.relates,
    dependsOn: resolved.dependsOn,
    subtaskOf: resolved.subtaskOf,
  });

  return { customFields, commands };
}

// Phase 2 (needs the issue id): dry-run via assist, then apply grouped commands.
export async function applyPrepared(api, id, commands) {
  if (!commands || !commands.length) return;
  const assistResults = await api.assist(id, commands.map((c) => c.command).join(' '));
  assertAssistClean(assistResults);
  await api.applyCommands(id, commands);
}
