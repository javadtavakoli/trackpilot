// Non-secret config (baseUrl) lives in ~/.config/trackpilot/config.json.
// The token is NEVER stored here -- it comes from the env var or the OS keyring.

import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { getToken as keyringGetToken } from './keyring.mjs';

const CONFIG_DIR = process.env.XDG_CONFIG_HOME
  ? join(process.env.XDG_CONFIG_HOME, 'trackpilot')
  : join(homedir(), '.config', 'trackpilot');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

export async function loadConfig() {
  try {
    const raw = await readFile(CONFIG_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw new Error(`failed to read config (${CONFIG_FILE}): ${err.message}`);
  }
}

export async function saveConfig(patch) {
  const current = await loadConfig();
  const next = { ...current, ...patch };
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_FILE, JSON.stringify(next, null, 2) + '\n', 'utf8');
  return next;
}

// baseUrl precedence: --base-url flag > YOUTRACK_BASE_URL env > config file.
export async function resolveBaseUrl(flagValue) {
  const fromConfig = (await loadConfig()).baseUrl;
  const raw = flagValue || process.env.YOUTRACK_BASE_URL || fromConfig;
  if (!raw) return null;
  return String(raw).replace(/\/+$/, ''); // strip trailing slashes
}

// token precedence: YOUTRACK_TOKEN env > OS keyring.
export async function resolveToken() {
  if (process.env.YOUTRACK_TOKEN) {
    return { token: process.env.YOUTRACK_TOKEN, source: 'env' };
  }
  const fromKeyring = await keyringGetToken();
  if (fromKeyring) return { token: fromKeyring, source: 'keyring' };
  return { token: null, source: null };
}

export const paths = { CONFIG_DIR, CONFIG_FILE };
