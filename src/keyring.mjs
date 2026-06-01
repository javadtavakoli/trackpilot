// Cross-OS keyring access via @napi-rs/keyring.
// macOS Keychain, Windows Credential Manager, Linux Secret Service (libsecret).
// Every function degrades gracefully if the platform keyring is unreachable.

const SERVICE = 'trackpilot';
const ACCOUNT = 'default';

let EntryCtor = null;
let loadError = null;

async function getEntry() {
  if (EntryCtor === null && loadError === null) {
    try {
      ({ Entry: EntryCtor } = await import('@napi-rs/keyring'));
    } catch (err) {
      loadError = err;
    }
  }
  if (loadError) {
    throw new Error(`keyring unavailable: ${loadError.message}`);
  }
  return new EntryCtor(SERVICE, ACCOUNT);
}

export async function getToken() {
  try {
    const entry = await getEntry();
    return entry.getPassword();
  } catch {
    // No entry stored, or keyring unreachable -> treat as "no token here".
    return null;
  }
}

export async function setToken(token) {
  const entry = await getEntry(); // throws a clear error if keyring is unavailable
  entry.setPassword(token);
}

export async function deleteToken() {
  try {
    const entry = await getEntry();
    return entry.deletePassword();
  } catch {
    return false;
  }
}
