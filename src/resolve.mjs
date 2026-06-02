// Pure value resolution: map a user-supplied string to a canonical token,
// or return ranked "did you mean" suggestions. No I/O.

// Levenshtein edit distance (small inputs; simple two-row DP).
export function distance(a, b) {
  a = a.toLowerCase();
  b = b.toLowerCase();
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  let curr = new Array(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

// options: [{ value, keys: [string, ...] }]
// returns { match: value|null, suggestions: value[] (<=3) }
export function resolveValue(candidate, options) {
  const cand = String(candidate).trim().toLowerCase();

  for (const opt of options) {
    if (opt.keys.some((k) => String(k).toLowerCase() === cand)) {
      return { match: opt.value, suggestions: [] };
    }
  }

  const scored = options.map((opt) => {
    const best = Math.min(
      ...opt.keys.map((k) => {
        const key = String(k).toLowerCase();
        const contains = key.includes(cand) || cand.includes(key);
        // substring hits sort ahead of pure edit-distance hits
        return (contains ? 0 : 100) + distance(cand, key);
      }),
    );
    return { value: opt.value, score: best };
  });

  scored.sort((a, b) => a.score - b.score);
  return { match: null, suggestions: scored.slice(0, 3).map((s) => s.value) };
}
