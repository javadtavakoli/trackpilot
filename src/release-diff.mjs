// Shared release-diff logic used by the CLI `release` command and the MCP
// `release` tool. The git layer is injected (defaults to ./git.mjs) so it is
// unit-testable without a real repository.

import * as defaultGit from './git.mjs';

export async function releaseDiff(api, { base, head, cwd } = {}, git = defaultGit) {
  const b = typeof base === 'string' ? base : 'main';
  const h = typeof head === 'string' ? head : 'next';

  const messages = await git.commitMessages(b, h, { cwd });
  const tokens = git.extractIssueTokens(messages);

  const projectKeys = new Set((await api.projects()).map((p) => p.shortName.toUpperCase()));
  const candidates = tokens.filter((t) => projectKeys.has(t.slice(0, t.lastIndexOf('-')).toUpperCase()));
  const ignoredTokens = tokens.filter((t) => !candidates.includes(t)).sort();

  const found = [];
  const unresolved = [];
  await Promise.all(candidates.map(async (id) => {
    try {
      const issue = await api.readIssue(id);
      found.push({ id: issue.id, summary: issue.summary, state: issue.state, assignee: issue.assignee, url: issue.url });
    } catch {
      unresolved.push(id);
    }
  }));

  found.sort((x, y) => x.id.localeCompare(y.id, undefined, { numeric: true }));
  unresolved.sort((x, y) => x.localeCompare(y, undefined, { numeric: true }));

  return {
    base: b,
    head: h,
    range: `${b}..${h}`,
    commits: messages.length,
    knownProjectKeys: [...projectKeys].sort(),
    issueCount: found.length,
    issues: found,
    unresolved,
    ignoredTokens,
  };
}
