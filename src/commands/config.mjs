// trackpilot config <set|set-token|delete-token|get>
// Manages the non-secret baseUrl and the keyring-stored token.

import { AppError } from '../api.mjs';
import { saveConfig, resolveBaseUrl, resolveToken, paths } from '../config.mjs';
import { setToken, deleteToken } from '../keyring.mjs';

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

export async function run({ positionals, options }) {
  const sub = positionals[0];

  switch (sub) {
    case 'set': {
      const baseUrl = options['base-url'];
      if (!baseUrl || baseUrl === true) {
        throw new AppError('usage: trackpilot config set --base-url <https://your.youtrack.cloud>');
      }
      const clean = String(baseUrl).replace(/\/+$/, '');
      await saveConfig({ baseUrl: clean });
      return { ok: true, baseUrl: clean, configFile: paths.CONFIG_FILE };
    }

    case 'set-token': {
      if (process.stdin.isTTY) {
        throw new AppError(
          'pipe the token via stdin, e.g. `printf %s "$TOKEN" | trackpilot config set-token`',
        );
      }
      const token = (await readStdin()).trim();
      if (!token) throw new AppError('no token received on stdin');
      try {
        await setToken(token);
      } catch (err) {
        throw new AppError(
          `${err.message}. On a headless box without a keyring, export YOUTRACK_TOKEN instead.`,
        );
      }
      return { ok: true, stored: 'os-keyring' };
    }

    case 'delete-token': {
      const removed = await deleteToken();
      return { ok: true, removed };
    }

    case 'get': {
      const baseUrl = await resolveBaseUrl(options['base-url']);
      const { source } = await resolveToken();
      return {
        baseUrl: baseUrl ?? null,
        tokenAvailable: source !== null,
        tokenSource: source, // "env" | "keyring" | null  (value never shown)
        configFile: paths.CONFIG_FILE,
      };
    }

    default:
      throw new AppError('usage: trackpilot config <set|set-token|delete-token|get>');
  }
}
