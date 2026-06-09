// trackpilot update <id> [--summary ...] [--description ...] [--state ...]
//   [--type <Type>] [--assignee <user>] [--field "Name=Value" ...] [--tag <name> ...]
//   [--relates <ID> ...] [--depends-on <ID> ...] [--subtask-of <ID> ...]

import { AppError } from '../api.mjs';
import { updateIssue } from '../issue-ops.mjs';
import { parseFields, asList } from './create.mjs';

export async function run({ api, positionals, options }) {
  const id = positionals[0];
  if (!id) {
    throw new AppError('usage: trackpilot update <issue-id> [--summary ...] [--field ...] [--assignee ...] [--tag ...] [--relates ...]');
  }

  return updateIssue(api, id, {
    summary: typeof options.summary === 'string' ? options.summary : undefined,
    description: typeof options.description === 'string' ? options.description : undefined,
    state: typeof options.state === 'string' ? options.state : undefined,
    type: typeof options.type === 'string' ? options.type : undefined,
    assignee: typeof options.assignee === 'string' ? options.assignee : undefined,
    fields: parseFields(options.field),
    tags: asList(options.tag),
    relates: asList(options.relates),
    dependsOn: asList(options['depends-on']),
    subtaskOf: asList(options['subtask-of']),
  });
}
