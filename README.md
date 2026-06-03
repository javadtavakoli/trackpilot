# trackpilot

> AI-friendly **CLI** and importable **ESM library** for driving [YouTrack](https://www.jetbrains.com/youtrack/) Cloud.

`trackpilot` lets you (or an AI assistant) drive YouTrack Cloud straight from a
git repository or from your own code: read issue specs, create and update tasks,
comment, search, log work, and generate a **release diff for QA** by extracting
issue IDs from your git history.

---

## Usage modes

| Mode | How | Token storage |
|---|---|---|
| **CLI** | `trackpilot <command>` in a terminal | OS keyring — never in a plaintext file |
| **Library** | `import { createApi } from 'trackpilot'` | You pass it — no keyring dependency |

Jump to the section you need:

- [CLI](#cli) — install globally, configure once, run commands
- [Library (programmatic API)](#library-programmatic-api) — ESM import, typed, works in Node / browsers / Electron / Tauri

---

## CLI

### Install

```bash
npm install -g trackpilot
# or
yarn global add trackpilot
```

Requires **Node 20+**. The keyring backend (`@napi-rs/keyring`) ships prebuilt
binaries, so there's no compiler step.

#### From source (development)

```bash
git clone https://github.com/javadtavakoli/trackpilot.git
cd trackpilot
yarn install
npm link          # exposes the `trackpilot` command on your PATH (use `npm unlink -g trackpilot` to remove)
```

Every command prints **JSON to stdout**, so it's equally pleasant for a human to
read and trivial for a script or an LLM to parse. Errors print
`{ "error": "..." }` and exit non-zero.

Your YouTrack token is stored in the **OS keyring** (macOS Keychain, Windows
Credential Manager, or Linux Secret Service) — never in a plaintext file in your
repo.

---

### Setup

You need two things: your instance URL and a permanent token.

1. **Create a permanent token** in YouTrack:
   *Profile → Account Security → Authentication → New token…* (give it the scopes
   your work needs — typically YouTrack). Depending on your YouTrack version the
   token starts with either `perm:` (older) or `perm-` (newer) — paste whichever
   yours gives you, prefix included.

2. **Point trackpilot at your instance** and store the token:

   ```bash
   trackpilot config set --base-url https://YOUR-INSTANCE.youtrack.cloud

   # Pipe the token via stdin so it never lands in your shell history:
   printf %s 'perm:xxxxxxxx' | trackpilot config set-token
   ```

3. **Verify:**

   ```bash
   trackpilot config get
   # { "baseUrl": "...", "tokenAvailable": true, "tokenSource": "keyring", ... }
   ```

#### Where things are stored

| Item | Location |
|---|---|
| Token (secret) | OS keyring, service `trackpilot` |
| `baseUrl` (non-secret) | `~/.config/trackpilot/config.json` |

#### CI / headless environments

There may be no keyring on a CI runner. Provide the token (and optionally the
URL) via environment variables instead — they take precedence over stored config:

```bash
export YOUTRACK_TOKEN='perm:xxxxxxxx'
export YOUTRACK_BASE_URL='https://YOUR-INSTANCE.youtrack.cloud'
```

---

### Commands

All commands output JSON. Add `--base-url <url>` to any command to override the
configured instance for a single call.

#### `config`

```bash
trackpilot config set --base-url https://acme.youtrack.cloud
printf %s 'perm:xxxx' | trackpilot config set-token
trackpilot config delete-token
trackpilot config get
```

#### `projects`

List projects and their keys (the short names used by `create` and matched by
`release`).

```bash
trackpilot projects
```

#### `read <id>`

Fetch a single issue with its fields, comments, tags, and links.

```bash
trackpilot read ABC-123
```

#### `list --query "<yt-query>" [--limit N]`

Search with [YouTrack query syntax](https://www.jetbrains.com/help/youtrack/cloud/search-and-command-attributes.html).
Default limit is 50. Output includes `tags` and `links` arrays for each issue.

```bash
trackpilot list --query "project: ABC State: Open" --limit 20
trackpilot list --query "for: me #Unresolved"
```

#### `create --project <KEY> --summary "..." [--description "..."] [--type <Type>] [--assignee <user>] [--field "Name=Value" ...] [--tag <name> ...] [--relates <ID>] [--depends-on <ID>] [--subtask-of <ID>]`

Create a task in one shot. `--project` is the project **key** (short name) from
`trackpilot projects`.

Field values, users, and tags are validated **client-side** before any write: an
unknown tag, user, or field value fails fast with a "did you mean" suggestion and
no issue is created. Link target IDs (`--relates`, `--depends-on`, `--subtask-of`)
are validated by YouTrack's command engine after the issue is created.

```bash
trackpilot create --project ABC --summary "Release" --type Task \
  --assignee "Javad Tavakoli" \
  --field "Squad=Squad 2" --field "Team=Front-End" --field "Team=QA" \
  --field "Estimation=1d" \
  --tag scope:infra --tag unplanned \
  --relates ABC-211
```

Flag reference for `create`:

- `--field "Name=Value"` — sets any custom field type; repeat the flag to set
  multiple values on multi-value fields (e.g. two `--field "Team=..."` sets both).
  Use `trackpilot fields <PROJECT>` to discover valid field names and allowed values.
- `--assignee <user>` — matches a user by login, name, or full name.
- `--tag <name>` (repeatable) — adds an existing tag; refuses to silently create a
  new tag.
- `--relates <ID>`, `--depends-on <ID>`, `--subtask-of <ID>` — each repeatable;
  creates the corresponding link type.

#### `update <id> [--summary ...] [--description ...] [--state ...] [--type <Type>] [--assignee <user>] [--field "Name=Value" ...] [--tag <name> ...] [--relates <ID>] [--depends-on <ID>] [--subtask-of <ID>]`

Update an issue. Accepts the same `--assignee`, `--field`, `--tag`, and link flags
as `create` (with the same validation-before-write semantics). Pass at least one
flag.

```bash
trackpilot update ABC-123 --state "In Progress"
trackpilot update ABC-123 --summary "Clearer title" --description "Updated body"
trackpilot update ABC-123 --assignee "Javad Tavakoli" --field "Team=Front-End" --tag scope:infra
```

#### `comment <id> --text "..."`

```bash
trackpilot comment ABC-123 --text "Deployed to staging, ready for QA."
```

#### `fields <PROJECT>`

List all custom field names, their allowed values, and available tags for a
project. Use this to discover what to pass to `--field` and `--tag`.

```bash
trackpilot fields ABC
```

#### `command <id> --query "<yt-command>"`

Apply an arbitrary [YouTrack command](https://www.jetbrains.com/help/youtrack/cloud/commands.html)
to an issue — a low-level escape hatch for bulk actions or YouTrack command
syntax not covered by the other flags.

```bash
trackpilot command ABC-123 --query "Team Front-End"
trackpilot command ABC-123 --query "State Fixed tag release-blocker"
```

#### `release [--base main] [--head next]`

Compare two branches and produce a **QA-ready list of the issues going out**.
It scans every commit in `base..head` (including merge-commit branch names like
`Merge branch 'feat/abc-123-...'`), extracts `LETTERS-NUMBER` tokens, keeps only
those whose prefix is a **real project key**, and resolves each against YouTrack.

```bash
# Run from inside the repo you're releasing:
trackpilot release                 # defaults to main..next
trackpilot release --base main --head release/2.0
```

Example output:

```json
{
  "range": "main..next",
  "commits": 42,
  "issueCount": 2,
  "issues": [
    { "id": "ABC-12", "summary": "Fix X", "state": "Fixed", "assignee": "Jane", "url": "https://acme.youtrack.cloud/issue/ABC-12" },
    { "id": "ABC-15", "summary": "Add Y", "state": "In QA", "assignee": "Sam",  "url": "https://acme.youtrack.cloud/issue/ABC-15" }
  ],
  "unresolved": ["ABC-99"],
  "ignoredTokens": ["UTF-8", "v2-48"]
}
```

- `issues` — resolved issues, ready to hand to QA.
- `unresolved` — matched a real project prefix but weren't found in YouTrack
  (typo in a branch name, deleted issue, …). Surfaced so nothing is silently lost.
- `ignoredTokens` — `LETTERS-NUMBER` strings whose prefix isn't a project key.

---

### Using it with an AI assistant

Because output is plain JSON, you can let an assistant call `trackpilot` directly.
A typical loop:

1. `trackpilot read ABC-1` → the assistant reads a spec issue.
2. The assistant drafts subtasks and runs `trackpilot create --project ABC --summary ... --description ...` for each.
3. At release time, `trackpilot release` produces the QA list to paste into a ticket or message.

---

## Library (programmatic API)

### Install

```bash
npm install trackpilot
```

Requires **Node 20+**. The library is pure ESM (no CommonJS build). It also runs
in browsers, Electron renderer processes, and Tauri webviews — anywhere a standard
`fetch` is available, or where you can inject one.

### Construction

```js
import { createApi } from 'trackpilot';

const yt = createApi({
  baseUrl: 'https://example.youtrack.cloud',
  token: process.env.YOUTRACK_TOKEN,
});
```

**Unlike the CLI, the library does not touch the OS keyring.** You supply the
token directly — store and retrieve it however your application manages secrets
(environment variable, a host keychain API, Tauri's secure store, etc.).

#### `createApi(options)` options

| Option | Type | Required | Description |
|---|---|---|---|
| `baseUrl` | `string` | Yes | Root URL of your YouTrack Cloud instance, e.g. `https://example.youtrack.cloud`. No trailing slash. |
| `token` | `string` | Yes | A permanent YouTrack API token (`perm:…` or `perm-…`). The library passes it as a `Bearer` header on every request. |
| `fetch` | `FetchFn` | No | Custom fetch implementation. Defaults to `globalThis.fetch` (available in Node 18+, all modern browsers). Inject a host-provided fetch for environments where the global is unavailable or CORS-restricted — for example, Tauri's `fetch` from `@tauri-apps/plugin-http` bypasses WebKit's CORS restrictions and routes through the Rust backend. |

### Method reference

All methods return `Promise`s and throw `AppError` on network or HTTP failures.

| Method | Signature | Description |
|---|---|---|
| `request` | `request(method, path, { query?, body? })` | Low-level escape hatch. Sends an authenticated request to any YouTrack REST endpoint. `query` is serialised into URL search params; `body` is JSON-encoded. Use this for any YouTrack endpoint not covered by a helper. |
| `me` | `me()` | Returns `{ name, login }` for the token owner. Useful for verifying credentials. |
| `projects` | `projects()` | Returns all projects as `{ id, shortName, name, archived }[]`. |
| `resolveProjectId` | `resolveProjectId(shortName)` | Resolves a project short name (e.g. `'ACME'`) to its internal YouTrack `id`. Throws if not found. |
| `readIssue` | `readIssue(id)` | Fetches a single issue by readable ID (e.g. `'ACME-1'`). Returns shaped fields + `comments` array. |
| `search` | `search(query, limit?)` | Searches issues using [YouTrack query syntax](https://www.jetbrains.com/help/youtrack/cloud/search-and-command-attributes.html). `limit` defaults to 50. Returns shaped issue objects. |
| `createIssue` | `createIssue({ project, summary, description?, customFields? })` | Creates an issue. `project` is the short name. Returns the new issue's readable ID. |
| `setCustomFields` | `setCustomFields(id, customFields)` | Updates typed custom fields on an existing issue using the raw YouTrack REST `customFields` body format. |
| `updateIssue` | `updateIssue(id, { summary?, description?, state? })` | Updates summary, description, and/or state. Returns the refreshed issue. State is applied via YouTrack's command API for reliable field transitions. |
| `applyCommand` | `applyCommand(id, query)` | Applies a single [YouTrack command string](https://www.jetbrains.com/help/youtrack/cloud/commands.html) to an issue (e.g. `'State {In Progress}'`). |
| `addComment` | `addComment(id, text)` | Adds a comment. Returns `{ id, comment: { author, text } }`. |
| `logWorkItem` | `logWorkItem(id, { minutes, text?, date?, type? })` | Posts a work item. `date` is epoch milliseconds. `type` is the **name** of a work-item type configured in the YouTrack instance (e.g. `'Development'`, `'Testing'`); omit to post without a type. |
| `tags` | `tags()` | Returns all tag names visible to the token. |
| `users` | `users()` | Returns all users as `{ login, name, fullName }[]`. |
| `projectSchema` | `projectSchema(projectKey)` | Returns the custom-field schema for a project as `{ name, type, values[] }[]`. Useful for discovering valid field names and allowed enum values without admin access. |
| `assist` | `assist(idReadable, query)` | Dry-runs a command string against an issue via YouTrack's `/commands/assist` endpoint. Returns `{ description, error }[]` — the parsed commands and whether each would fail. No mutations are made. |
| `applyCommands` | `applyCommands(idReadable, commands)` | Applies an array of `{ command }` objects sequentially using `applyCommand`, so a failure is attributable to a specific command. |
| `webUrl` | `webUrl(idReadable)` | Returns the browser URL for an issue (synchronous). Example: `https://example.youtrack.cloud/issue/ACME-1`. |

### Runnable example

```js
import { createApi } from 'trackpilot';

const yt = createApi({
  baseUrl: 'https://example.youtrack.cloud',
  token: process.env.YOUTRACK_TOKEN,
});

const me = await yt.me();                       // { name, login }
const issues = await yt.search('for: me #Unresolved', 20);
await yt.logWorkItem('ACME-1', { minutes: 30, text: 'Pairing', date: Date.now(), type: 'Development' });
await yt.applyCommand('ACME-1', 'State {In Progress}');

// escape hatch for anything not wrapped:
const boards = await yt.request('GET', '/agiles', { query: { fields: 'name', $top: 50 } });
```

### Tauri / WebKit webview example

In a Tauri app the global `fetch` is subject to WebKit's CORS policy. Inject
Tauri's plugin fetch so requests route through the Rust backend:

```js
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { createApi } from 'trackpilot';

const yt = createApi({
  baseUrl: 'https://example.youtrack.cloud',
  token: mySecretStore.getToken(),
  fetch: tauriFetch,
});
```

---

## Releasing (maintainers)

Publishing is automated by `.github/workflows/publish.yml`: **every push to
`main` runs it, and it publishes only when `package.json`'s version isn't
already on npm** (so it publishes exactly when you bump the version, and does
nothing otherwise). The repo needs an `NPM_TOKEN` secret with publish rights
(GitHub → Settings → Secrets and variables → Actions → `NPM_TOKEN`).

```bash
npm version patch        # bump version (+ vX.Y.Z tag)
git push --follow-tags   # push to main -> CI detects the new version and publishes
```

You can also trigger it manually from the Actions tab (`workflow_dispatch`).

---

## License

[MIT](./LICENSE)
