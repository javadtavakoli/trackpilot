// Tiny argv parser. Supports:
//   positional args, --flag value, --flag=value, and boolean --flag.
// Boolean flags must be listed in `booleans` so the next token isn't eaten.

export function parseArgs(argv, { booleans = [] } = {}) {
  const positionals = [];
  const options = {};

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];

    if (token === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }

    if (token.startsWith('--')) {
      let key = token.slice(2);
      let value;

      const eq = key.indexOf('=');
      if (eq !== -1) {
        value = key.slice(eq + 1);
        key = key.slice(0, eq);
      } else if (booleans.includes(key)) {
        value = true;
      } else {
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('--')) {
          value = true;
        } else {
          value = next;
          i++;
        }
      }
      options[key] = value;
    } else {
      positionals.push(token);
    }
  }

  return { positionals, options };
}
