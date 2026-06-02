// trackpilot create --project <KEY> --summary "..." [--description "..."]
//   [--type <Type>] [--assignee <user>] [--field "Name=Value" ...]
//   [--tag <name> ...] [--relates <ID> ...] [--depends-on <ID> ...] [--subtask-of <ID> ...]

import { AppError } from '../api.mjs';
import { prepareCommands, applyPrepared } from '../apply-fields.mjs';

// "Name=Value" (repeatable) -> [{ name, value }]
export function parseFields(raw) {
  if (raw === undefined) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((entry) => {
    if (typeof entry !== 'string' || !entry.includes('=')) {
      throw new AppError(`--field must be "Name=Value", got: ${entry}`);
    }
    const eq = entry.indexOf('=');
    return { name: entry.slice(0, eq).trim(), value: entry.slice(eq + 1).trim() };
  });
}

// A repeatable flag may arrive as undefined | string | string[]; normalize.
export function asList(v) {
  if (v === undefined) return [];
  return (Array.isArray(v) ? v : [v]).filter((x) => typeof x === 'string');
}

export async function run({ api, options }) {
  const project = options.project;
  const summary = options.summary;
  if (!project || project === true) throw new AppError('--project <KEY> is required');
  if (!summary || summary === true) throw new AppError('--summary "<text>" is required');

  const raw = {
    assignee: typeof options.assignee === 'string' ? options.assignee : undefined,
    fields: [
      ...parseFields(options.field),
      ...(typeof options.type === 'string' ? [{ name: 'Type', value: options.type }] : []),
    ],
    tags: asList(options.tag),
    relates: asList(options.relates),
    dependsOn: asList(options['depends-on']),
    subtaskOf: asList(options['subtask-of']),
  };

  // Validate everything BEFORE creating the issue (bad input -> no issue created).
  const commands = await prepareCommands(api, raw, project);

  const id = await api.createIssue({
    project,
    summary,
    description: typeof options.description === 'string' ? options.description : undefined,
  });

  await applyPrepared(api, id, commands);
  return api.readIssue(id);
}
