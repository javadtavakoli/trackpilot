// trackpilot update <id> [--summary "..."] [--description "..."] [--state "..."]

import { AppError } from '../api.mjs';

export async function run({ api, positionals, options }) {
  const id = positionals[0];
  if (!id) throw new AppError('usage: trackpilot update <issue-id> [--summary ...] [--description ...] [--state ...]');

  const patch = {};
  if (typeof options.summary === 'string') patch.summary = options.summary;
  if (typeof options.description === 'string') patch.description = options.description;
  if (typeof options.state === 'string') patch.state = options.state;

  if (Object.keys(patch).length === 0) {
    throw new AppError('nothing to update: pass at least one of --summary, --description, --state');
  }
  return api.updateIssue(id, patch);
}
