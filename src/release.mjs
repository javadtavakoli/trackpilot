// Pure, IO-free helper for the release script (scripts/release.mjs). Version math
// is delegated to `semver` and changelog generation to `conventional-changelog`
// (angular preset); the one thing those tools don't give us is a "should we
// release at all?" gate. `conventional-recommended-bump` returns `patch` for
// *any* range (even docs/chore-only), which would publish a release on every
// push. This guard restores the no-op-for-non-release-pushes behavior.

// Release-worthy conventional-commit types (the ones the angular changelog shows
// and that justify a version bump): feat, fix, perf, revert.
const RELEASABLE_TYPE = /^(feat|fix|perf|revert)(\([^)]*\))?!?:/i;
// Any type with a `!` marker, or a BREAKING CHANGE footer, is a breaking change.
const BANG = /^\w+(\([^)]*\))?!:/;
const BREAKING_FOOTER = /^BREAKING[ -]CHANGE:/m;

/**
 * Does this set of commits warrant a release?
 * @param {{subject:string, body?:string}[]} commits
 * @returns {boolean}
 */
export function isReleasable(commits) {
  return commits.some((commit) => {
    const subject = (commit.subject || '').trim();
    return (
      RELEASABLE_TYPE.test(subject) ||
      BANG.test(subject) ||
      BREAKING_FOOTER.test(commit.body || '')
    );
  });
}
