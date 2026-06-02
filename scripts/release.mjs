#!/usr/bin/env node
// Conventional-commit release orchestration. Run by .github/workflows/publish.yml
// on push to main (and locally with --prepare for the first/redone release).
//
// Pipeline (default / CI):
//   1. collect commits since the latest v* tag
//   2. gate: skip entirely unless there's a feat/fix/perf/revert/breaking commit
//      (conventional-recommended-bump alone returns `patch` for ANY range — even
//      docs/chore-only — which would patch-release every push; isReleasable below
//      restores the no-op-for-non-release-pushes behavior)
//   3. level   := conventional-recommended-bump -p angular   (major|minor|patch)
//   4. version := semver.inc(currentVersion, level)
//   5. write package.json, then conventional-changelog -p angular -i (heading reads
//      the new version), commit package.json + CHANGELOG.md, tag, push
//
// It does NOT publish to npm or create GitHub releases — those are workflow steps.
//
// Modes:
//   node scripts/release.mjs            full run (CI): commit message gets [skip ci]
//   node scripts/release.mjs --prepare  local redo: no [skip ci], so the push triggers CI to publish
//   node scripts/release.mjs --dry-run  compute version + preview changelog; no writes

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import semver from 'semver';
import { isReleasable } from '../src/release.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const US = '\x1f';
const NUL = '\x00';

function git(args, opts = {}) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', ...opts }).trim();
}

// Run a dependency's CLI via yarn (no hardcoded node_modules paths).
function tool(name, args) {
  return execFileSync('yarn', ['run', name, ...args], { cwd: ROOT, encoding: 'utf8' }).trim();
}

function readPkg() {
  return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
}

function latestTag() {
  const out = git(['tag', '--list', 'v*', '--sort=-v:refname']);
  return out ? out.split('\n')[0] : null;
}

function commitsSince(tag) {
  const range = tag ? [`${tag}..HEAD`] : ['HEAD'];
  // %x1f / %x00 are git format tokens emitting those bytes (passed literally —
  // execFileSync rejects real NUL bytes inside an argument).
  const out = git(['log', ...range, '--format=%s%x1f%b%x00'], { maxBuffer: 64 * 1024 * 1024 });
  return out
    .split(NUL)
    .map((rec) => rec.trim())
    .filter(Boolean)
    .map((rec) => {
      const [subject, ...body] = rec.split(US);
      return { subject, body: body.join(US) };
    });
}

function setOutput(key, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}

function configureGitIdentity() {
  if (!process.env.GITHUB_ACTIONS) return;
  git(['config', 'user.name', 'github-actions[bot]']);
  git(['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
}

function main() {
  const args = process.argv.slice(2);
  const prepare = args.includes('--prepare');
  const dryRun = args.includes('--dry-run');

  const pkg = readPkg();
  const prevTag = latestTag();
  const commits = commitsSince(prevTag);

  if (!isReleasable(commits)) {
    console.log(`No releasable commits since ${prevTag || 'the beginning'} — nothing to release.`);
    setOutput('released', 'false');
    setOutput('version', pkg.version);
    return;
  }

  const level = tool('conventional-recommended-bump', ['-p', 'angular']); // major|minor|patch
  const version = semver.inc(pkg.version, level);
  if (!version) throw new Error(`semver.inc failed for ${pkg.version} + ${level}`);
  console.log(`Bumping ${pkg.version} -> ${version} (${level}) from ${commits.length} commit(s).`);

  if (dryRun) {
    console.log('\n--- changelog preview (unreleased, dry run) ---');
    console.log(tool('conventional-changelog', ['-p', 'angular', '-u']));
    return;
  }

  // Write the new version first so conventional-changelog uses it as the heading,
  // preserving package.json's 2-space formatting.
  pkg.version = version;
  writeFileSync(join(ROOT, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

  // Prepend the new section to CHANGELOG.md (-i in place, -s same file, 1 release).
  tool('conventional-changelog', ['-p', 'angular', '-i', 'CHANGELOG.md', '-s']);

  configureGitIdentity();
  const tag = `v${version}`;
  const skipCi = prepare ? '' : ' [skip ci]';
  git(['add', 'package.json', 'CHANGELOG.md']);
  git(['commit', '-m', `chore(release): ${tag}${skipCi}`]);
  git(['tag', '-a', tag, '-m', tag]);

  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  git(['push', '--follow-tags', 'origin', `HEAD:${branch}`]);

  console.log(`Released ${tag} on ${branch}.`);
  setOutput('released', 'true');
  setOutput('version', version);
  setOutput('tag', tag);
}

main();
