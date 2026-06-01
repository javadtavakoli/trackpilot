// trackpilot list --query "<yt-query>" [--limit N] -- search issues.

import { AppError } from '../api.mjs';

export async function run({ api, options }) {
  const query = options.query ?? '';
  const limit = options.limit !== undefined ? Number(options.limit) : 50;
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new AppError('--limit must be a positive number');
  }
  const issues = await api.search(query, limit);
  return { query, count: issues.length, issues };
}
