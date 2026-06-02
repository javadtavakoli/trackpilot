// trackpilot fields <PROJECT>
// Print the project's custom fields (name, type, allowed values) plus the
// instance tag list -- the values you can pass to create/update.

import { AppError } from '../api.mjs';

export async function run({ api, positionals }) {
  const project = positionals[0];
  if (!project) throw new AppError('usage: trackpilot fields <PROJECT>');
  const [schema, tags] = await Promise.all([api.projectSchema(project), api.tags()]);
  return { project, fields: schema, tags };
}
