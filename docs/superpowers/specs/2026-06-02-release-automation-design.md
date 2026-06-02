# Conventional-commit release automation — design

Date: 2026-06-02

## Problem (root cause)

`.github/workflows/publish.yml` never computed a version. It only published when
`package.json`'s version was not already on npm. Since the version stayed `0.1.0`
(already published on 2026-06-01) across every subsequent push, the workflow
correctly no-opped and nothing was published — even though `feat:`/`fix:` commits
landed on `main`. The "bump according to commit subjects" behavior was never
implemented.

Evidence:
- npm has only `0.1.0`; no git tags existed.
- `package.json` version had been `0.1.0` since the file was created.
- npm `0.1.0` published `2026-06-01T15:25Z`, ~9 min after commit `aa6f7c4` (the
  commit that introduced the publish workflow) → npm `0.1.0` == repo state at
  `aa6f7c4`.
- All commits after `aa6f7c4` (the one-shot-task-authoring feature) are
  unreleased and include `feat:` commits with no breaking changes → next version
  is **`0.2.0`** (minor bump).

## Approach

Conventional-commit driven, using the standard toolchain (no semantic-release):

- **`semver`** for version math (`semver.inc`).
- **`conventional-recommended-bump`** (angular preset) for the bump level.
- **`conventional-changelog`** (angular preset) to generate `CHANGELOG.md`.

These are **devDependencies** — the release script lives in `scripts/`, which is
not in `package.json`'s `files`, so none of this ships to npm consumers. The
project is **Yarn Berry 4.14.1** (`packageManager` pinned; `nodeLinker:
node-modules`); tools are invoked via `yarn run <tool>` (never hardcoded
`node_modules/.bin` paths), and CI installs with `yarn install --immutable`.

### Components

**`scripts/release.mjs`** — orchestrator. Pipeline (default / CI):
1. Collect commits since the latest `v*` tag.
2. **Gate** via `isReleasable` (see below): skip the whole release unless there's
   a `feat`/`fix`/`perf`/`revert`/breaking commit. This is necessary because
   `conventional-recommended-bump` returns `patch` for *any* range — even
   docs/chore-only — so without the gate every push would patch-release.
   (Verified empirically: empty, docs-only, and docs+chore ranges all → `patch`.)
3. `level = yarn run conventional-recommended-bump -p angular`.
4. `version = semver.inc(currentVersion, level)`.
5. Write `package.json` (preserving 2-space formatting) **first**, then
   `yarn run conventional-changelog -p angular -i CHANGELOG.md -s` so the new
   section's heading reads the bumped version (not a SHA).
6. Commit `package.json` + `CHANGELOG.md` as `chore(release): vX.Y.Z [skip ci]`,
   tag `vX.Y.Z`, push commit + tag (`git push --follow-tags`).

It does **not** publish to npm or create GitHub releases — those are workflow
steps. Modes:
- default — CI run; release commit gets `[skip ci]`.
- `--prepare` — local redo; commit omits `[skip ci]` so the push triggers CI.
- `--dry-run` — compute the version and print the unreleased changelog; no writes.

**`src/release.mjs`** — one pure, unit-tested export, `isReleasable(commits)`
(the only thing the libraries can't provide). Kept separate from the orchestrator
(which has IO side effects) so it stays importable by the test suite. Distinct
from the CLI's `src/commands/release.mjs` (the unrelated QA release-diff command).

**`.github/workflows/publish.yml`** — triggers: `push: branches: [main]` and
`workflow_dispatch`. `permissions: contents: write`. Steps:
1. `actions/checkout@v4` with `fetch-depth: 0` + `fetch-tags: true` (the default
   shallow clone has no history/tags, so commits-since-tag would be empty).
2. `actions/setup-node@v4` (node 20, npm registry for the publish auth).
3. `corepack enable` (Yarn 4 via the pinned `packageManager`).
4. `yarn install --immutable`.
5. `node scripts/release.mjs` — bumps/commits/tags/pushes when warranted. The
   push uses the default `GITHUB_TOKEN`, which does **not** re-trigger the
   workflow (no loop); `[skip ci]` is belt-and-suspenders.
6. **Publish** (idempotent): if the current version isn't on npm →
   `npm publish --access public` with `NODE_AUTH_TOKEN: secrets.NPM_TOKEN`
   (proven path — it published `0.1.0`; deliberately kept over `yarn npm publish`,
   whose auth can't be tested locally).
7. **GitHub Release** (idempotent): if a tag `vX.Y.Z` exists with no release yet →
   `gh release create` using `yarn run conventional-changelog -p angular -r 1` as
   the notes (`GH_TOKEN: secrets.GITHUB_TOKEN`).

Idempotency means re-runs and no-bump pushes are harmless.

## Redoing the 0.2.0 release (local-prepare / CI-publishes)

Chosen to keep the never-before-run CI git-push-back out of the high-stakes first
real release. The genuine publish path still runs in CI (it owns `NPM_TOKEN`).

1. Verify locally: `node --test` (the `isReleasable` gate); `node scripts/release.mjs
   --dry-run` (asserts `0.1.0` → `0.2.0` + previews the angular changelog);
   `npm publish --dry-run`.
2. Create + push baseline tag `v0.1.0` at `aa6f7c4` (the state npm `0.1.0` was
   published from). Pushing a tag does not trigger the workflow.
3. `node scripts/release.mjs --prepare` → bumps to `0.2.0`, writes `CHANGELOG.md`,
   commits, tags `v0.2.0`, pushes commit + tag (no `[skip ci]` — we want CI to run).
4. The push to `main` triggers CI: the release step finds no releasable commits
   since `v0.2.0` → no-op; the publish step publishes `0.2.0`; the release step
   creates the GitHub Release for `v0.2.0`.

## Risks / assumptions

- `main` is unprotected (verified: branch-protection API returns 404; the user
  pushes to `main` directly), so CI's `GITHUB_TOKEN` push-back works for future
  feature pushes.
- `NPM_TOKEN` exists and is valid (it published `0.1.0`).
- First real exercise of the CI git-push-back is deferred to a future feature
  push, not this redo.
