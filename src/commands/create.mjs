// trackpilot create --project <KEY> --summary "..." [--description "..."]
//                    [--type <Type>] [--field "Name=Value" ...]
//
// --field sets a single-value enum custom field at creation time (repeatable).
// Useful for required project fields, e.g. --field "RC Squad=Squad 2".

import { AppError } from '../api.mjs';

function parseFields(raw) {
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

export async function run({ api, options }) {
  const project = options.project;
  const summary = options.summary;
  if (!project || project === true) throw new AppError('--project <KEY> is required');
  if (!summary || summary === true) throw new AppError('--summary "<text>" is required');

  return api.createIssue({
    project,
    summary,
    description: typeof options.description === 'string' ? options.description : undefined,
    type: typeof options.type === 'string' ? options.type : undefined,
    fields: parseFields(options.field),
  });
}
