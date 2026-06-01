// trackpilot read <id> -- fetch one issue with comments.

import { AppError } from '../api.mjs';

export async function run({ api, positionals }) {
  const id = positionals[0];
  if (!id) throw new AppError('usage: trackpilot read <issue-id>');
  return api.readIssue(id);
}
