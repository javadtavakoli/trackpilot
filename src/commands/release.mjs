// trackpilot release [--base main] [--head next]
import { releaseDiff } from '../release-diff.mjs';

export async function run({ api, options }) {
  return releaseDiff(api, { base: options.base, head: options.head });
}
