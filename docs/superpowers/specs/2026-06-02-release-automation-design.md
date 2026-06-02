# Conventional-commit release automation — design

Date: 2026-06-02

## Problem (root cause)

`.github/workflows/publish.yml` never computes a version. It only publishes when
`package.json`'s version is not already on npm. Since the version stayed `0.1.0`
(already published on 2026-06-01) across every subsequent push, the workflow
correctly no-opped and nothing was published — even though `feat:`/`fix:` commits
landed on `main`. The user's mental model ("bump according to commit subjects")
was never implemented.

Evidence:
- npm has only `0.1.0`; no git tags exist.
- `package.json` version has been `0.1.0` since the file was created.
- npm `0.1.0` published `2026-06-01T15:25Z`, ~9 min after commit `aa6f7c4`
  (the commit that introduced the publish workflow) → npm `0.1.0` == repo state
  at `aa6f7c4`.
- All commits after `aa6f7c4` (the one-shot-task-authoring feature) are
  unreleased and include `feat:` commits with no breaking changes → next version
  is **`0.2.0`** (minor bump).

## Approach

Lightweight inline script (no new runtime deps — matches the repo's minimal,
no-build, plain-`.mjs` ethos) plus git tags, a GitHub Release, and a
`CHANGELOG.md`.

### Components

**`scripts/release.mjs`** — pure logic (unit-tested, no IO) + IO `main()`.

Pure functions (tested with `node --test`):
- `bumpLevel(commitMessages) -> 'major' | 'minor' | 'patch' | null`
  - `major` if any commit has `!` before the `:` or a `BREAKING CHANGE` footer
  - else `minor` if any `feat`
  - else `patch` if any `fix` / `perf` / `revert`
  - else `null` (no release-worthy change)
- `nextVersion(currentSemver, level) -> string` (standard semver math; `null` level returns the current version unchanged)
- `groupCommits(commits) -> { feat: [...], fix: [...], perf: [...], other: [...] }`
- `renderChangelogSection({ version, date, groups, repoUrl, prevTag }) -> string`
  - Markdown `## [x.y.z]` heading with Features / Bug Fixes / Performance sub-lists,
    each entry `- subject (shortHash)`.

IO `main()`:
1. Read current version from `package.json`.
2. `lastTag` = latest `v*` tag via `git tag` (semver-sorted), or `null`.
3. Collect commits in range `lastTag..HEAD` (or all history if no tag):
   subject + body (for `BREAKING CHANGE` detection) + short hash.
4. `level = bumpLevel(...)`. If `null` → print "no release" and exit 0 (the
   workflow's publish/release safety-net steps still run).
5. `newVersion = nextVersion(current, level)`.
6. `npm version <newVersion> --no-git-tag-version` (no implicit commit/tag).
7. Prepend the rendered section to `CHANGELOG.md` (create with a header if absent).
8. **One** commit of `package.json` + `CHANGELOG.md`:
   `chore(release): v<newVersion> [skip ci]`.
9. Create annotated tag `v<newVersion>`.
10. Push commit + tag (`git push --follow-tags`).
11. `--prepare` flag stops after step 10 (no publish/GitHub release) — used for
    the local redo.

Configure git identity from env when running in CI
(`github-actions[bot]`), falling back to the local config otherwise.

**`.github/workflows/publish.yml`** — triggers: `push: branches: [main]` and
`workflow_dispatch`. `permissions: contents: write`. Steps:
1. `actions/checkout@v4` with **`fetch-depth: 0`** and `fetch-tags: true` (the
   default shallow clone has no history/tags, so `git log <tag>..HEAD` would
   silently return nothing — the #1 "works locally, no-ops in CI" trap).
2. `actions/setup-node@v4` (node 20, npm registry).
3. Run `node scripts/release.mjs` (bumps/commits/tags/pushes when warranted).
   The bump commit is pushed with the default `GITHUB_TOKEN`, which does **not**
   re-trigger the workflow (no loop); `[skip ci]` is belt-and-suspenders.
4. **Publish** (idempotent safety net): re-read current version; if not on npm →
   `npm publish --access public` with `NODE_AUTH_TOKEN: secrets.NPM_TOKEN`.
5. **GitHub Release** (idempotent): if a tag `v<version>` exists and has no
   release yet → `gh release create v<version>` using the changelog section as
   notes (`GH_TOKEN: secrets.GITHUB_TOKEN`).

Idempotency means re-runs and no-bump pushes are harmless.

### Bump/publish/release flow

```
push to main
  -> release.mjs: commits since last tag -> bump? 
       yes -> npm version, CHANGELOG, commit, tag, push   (GITHUB_TOKEN, no retrigger)
       no  -> nothing
  -> publish: version on npm? no -> npm publish
  -> release: tag exists & no GH release? -> gh release create
```

## Redoing the 0.2.0 release (local-prepare / CI-publishes)

Chosen to keep the never-before-run CI git-push-back out of the high-stakes first
real release. The genuine publish path still runs in CI (it owns `NPM_TOKEN`).

1. Verify locally: `node --test` (pure logic asserts `0.1.0` + these commits →
   `0.2.0`); `npm publish --dry-run` (sanity-check the tarball).
2. Create + push baseline tag `v0.1.0` at `aa6f7c4` (the state npm `0.1.0` was
   published from). Pushing a tag does not trigger the workflow.
3. `node scripts/release.mjs --prepare` → bumps to `0.2.0`, writes `CHANGELOG.md`,
   commits, tags `v0.2.0`, pushes commit + tag. (No `[skip ci]` on this local
   commit — we *want* CI to run.)
4. The push to `main` triggers CI: `release.mjs` finds no commits since `v0.2.0`
   → no bump → the publish step publishes `0.2.0`, and the release step creates
   the GitHub Release for `v0.2.0`.

## Risks / assumptions

- `main` is unprotected (verified: branch-protection API returns 404; the user
  pushes to `main` directly), so CI's `GITHUB_TOKEN` push-back works for future
  feature pushes.
- `NPM_TOKEN` exists and is valid (it published `0.1.0`).
- First real exercise of the CI git-push-back is deferred to a future feature
  push, not this redo.
