// trackpilot comment <id> --text "..."

import { AppError } from '../api.mjs';

export async function run({ api, positionals, options }) {
  const id = positionals[0];
  if (!id) throw new AppError('usage: trackpilot comment <issue-id> --text "<comment>"');
  if (!options.text || options.text === true) throw new AppError('--text "<comment>" is required');
  return api.addComment(id, options.text);
}
