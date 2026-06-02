// Git helpers for the `release` command: list commits in head..base and pull
// candidate issue tokens out of their messages (subjects + bodies, which carry
// merge-commit branch names like "Merge branch 'feat/abc-1-fix'").

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AppError } from './api.mjs';

const run = promisify(execFile);
const NUL = String.fromCharCode(0);

// LETTERS-NUMBER, e.g. ABC-1, APP-42. Prefix must start with a letter.
const TOKEN_RE = /\b([a-z][a-z0-9]*)-(\d+)\b/gi;

export async function commitMessages(base, head) {
  let out;
  try {
    // %x00 emits a NUL byte after each commit body so multi-line bodies stay intact.
    out = await run('git', ['log', `${base}..${head}`, '--format=%B%x00'], {
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    const msg = (err.stderr || err.message || '').trim();
    if (/not a git repository/i.test(msg)) {
      throw new AppError('not a git repository (run `release` from inside your repo)');
    }
    if (/unknown revision|bad revision|ambiguous argument/i.test(msg)) {
      throw new AppError(`git could not resolve "${base}..${head}": ${msg}`);
    }
    throw new AppError(`git log failed: ${msg}`);
  }
  return out.stdout
    .split(NUL)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Returns a deduped, uppercased list of LETTERS-NUMBER tokens found in messages.
export function extractIssueTokens(messages) {
  const seen = new Set();
  for (const msg of messages) {
    for (const m of msg.matchAll(TOKEN_RE)) {
      seen.add(`${m[1].toUpperCase()}-${m[2]}`);
    }
  }
  return [...seen];
}
