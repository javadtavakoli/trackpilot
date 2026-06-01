// trackpilot create --project <KEY> --summary "..." [--description "..."] [--type <Type>]

import { AppError } from '../api.mjs';

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
  });
}
