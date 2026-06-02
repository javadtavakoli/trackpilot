// trackpilot update <id> [--summary ...] [--description ...] [--state ...]
//   [--assignee <user>] [--field "Name=Value" ...] [--tag <name> ...]
//   [--relates <ID> ...] [--depends-on <ID> ...] [--subtask-of <ID> ...]

import { AppError } from '../api.mjs';
import { prepareCommands, applyPrepared } from '../apply-fields.mjs';
import { parseFields, asList } from './create.mjs';

export async function run({ api, positionals, options }) {
  const id = positionals[0];
  if (!id) {
    throw new AppError('usage: trackpilot update <issue-id> [--summary ...] [--field ...] [--assignee ...] [--tag ...] [--relates ...]');
  }

  const patch = {};
  if (typeof options.summary === 'string') patch.summary = options.summary;
  if (typeof options.description === 'string') patch.description = options.description;
  if (typeof options.state === 'string') patch.state = options.state;

  const raw = {
    assignee: typeof options.assignee === 'string' ? options.assignee : undefined,
    fields: parseFields(options.field),
    tags: asList(options.tag),
    relates: asList(options.relates),
    dependsOn: asList(options['depends-on']),
    subtaskOf: asList(options['subtask-of']),
  };

  const hasFieldWork =
    raw.assignee || raw.fields.length || raw.tags.length ||
    raw.relates.length || raw.dependsOn.length || raw.subtaskOf.length;

  if (Object.keys(patch).length === 0 && !hasFieldWork) {
    throw new AppError('nothing to update: pass at least one of --summary, --description, --state, --assignee, --field, --tag, --relates, --depends-on, --subtask-of');
  }

  // Validate field/tag/link/assignee inputs before mutating anything.
  const projectKey = id.split('-')[0];
  const commands = hasFieldWork ? await prepareCommands(api, raw, projectKey) : [];

  if (Object.keys(patch).length) await api.updateIssue(id, patch);
  await applyPrepared(api, id, commands);

  return api.readIssue(id);
}
