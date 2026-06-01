// trackpilot command <id> --query "<yt-command>"
// Apply an arbitrary YouTrack command to an issue (e.g. "State Fixed",
// "Assignee me", "RC Squad Squad 2"). Useful for fields the typed commands
// (create/update) don't cover.

import { AppError } from '../api.mjs';

export async function run({ api, positionals, options }) {
  const id = positionals[0];
  const query = typeof options.query === 'string' ? options.query : positionals.slice(1).join(' ');
  if (!id) throw new AppError('usage: trackpilot command <issue-id> --query "<yt-command>"');
  if (!query) throw new AppError('--query "<yt-command>" is required');
  await api.applyCommand(id, query);
  return api.readIssue(id);
}
