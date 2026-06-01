// trackpilot release [--base main] [--head next]
// Diff two branches, extract YouTrack issue IDs from commit/branch names,
// validate them against real project keys, and resolve them for QA.

import { commitMessages, extractIssueTokens } from '../git.mjs';

export async function run({ api, options }) {
  const base = typeof options.base === 'string' ? options.base : 'main';
  const head = typeof options.head === 'string' ? options.head : 'next';

  const messages = await commitMessages(base, head);
  const tokens = extractIssueTokens(messages);

  // Keep only tokens whose prefix is a real project key -> drops UTF-8, v2-48, etc.
  const projectKeys = new Set((await api.projects()).map((p) => p.shortName.toUpperCase()));
  const candidates = tokens.filter((t) => projectKeys.has(t.slice(0, t.lastIndexOf('-')).toUpperCase()));
  const ignoredTokens = tokens.filter((t) => !candidates.includes(t)).sort();

  const found = [];
  const unresolved = [];
  await Promise.all(
    candidates.map(async (id) => {
      try {
        const issue = await api.readIssue(id);
        found.push({
          id: issue.id,
          summary: issue.summary,
          state: issue.state,
          assignee: issue.assignee,
          url: issue.url,
        });
      } catch {
        unresolved.push(id);
      }
    }),
  );

  found.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  unresolved.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  return {
    base,
    head,
    range: `${base}..${head}`,
    commits: messages.length,
    knownProjectKeys: [...projectKeys].sort(),
    issueCount: found.length,
    issues: found,
    unresolved,
    ignoredTokens,
  };
}
