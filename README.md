# trackpilot

> AI-friendly command-line copilot for [YouTrack](https://www.jetbrains.com/youtrack/) Cloud.

`trackpilot` lets you (or an AI assistant) drive YouTrack Cloud straight from a
git repository: read issue specs, create and update tasks, comment, search, and
generate a **release diff for QA** by extracting issue IDs from your git history.

Every command prints **JSON to stdout**, so it's equally pleasant for a human to
read and trivial for a script or an LLM to parse. Errors print
`{ "error": "..." }` and exit non-zero.

Your YouTrack token is stored in the **OS keyring** (macOS Keychain, Windows
Credential Manager, or Linux Secret Service) — never in a plaintext file in your
repo.

---

## Install

```bash
npm install -g trackpilot
# or
yarn global add trackpilot
```

Requires **Node 20+**. The keyring backend (`@napi-rs/keyring`) ships prebuilt
binaries, so there's no compiler step.

### From source (development)

```bash
git clone https://github.com/javadtavakoli/trackpilot.git
cd trackpilot
yarn install
npm link          # exposes the `trackpilot` command on your PATH (use `npm unlink -g trackpilot` to remove)
```

---

## Setup

You need two things: your instance URL and a permanent token.

1. **Create a permanent token** in YouTrack:
   *Profile → Account Security → Authentication → New token…* (give it the scopes
   your work needs — typically YouTrack). It looks like `perm:xxxxxxxx`.

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

### Where things are stored

| Item | Location |
|---|---|
| Token (secret) | OS keyring, service `trackpilot` |
| `baseUrl` (non-secret) | `~/.config/trackpilot/config.json` |

### CI / headless environments

There may be no keyring on a CI runner. Provide the token (and optionally the
URL) via environment variables instead — they take precedence over stored config:

```bash
export YOUTRACK_TOKEN='perm:xxxxxxxx'
export YOUTRACK_BASE_URL='https://YOUR-INSTANCE.youtrack.cloud'
```

---

## Commands

All commands output JSON. Add `--base-url <url>` to any command to override the
configured instance for a single call.

### `config`

```bash
trackpilot config set --base-url https://acme.youtrack.cloud
printf %s 'perm:xxxx' | trackpilot config set-token
trackpilot config delete-token
trackpilot config get
```

### `projects`

List projects and their keys (the short names used by `create` and matched by
`release`).

```bash
trackpilot projects
```

### `read <id>`

Fetch a single issue with its fields, comments, tags, and links.

```bash
trackpilot read ABC-123
```

### `list --query "<yt-query>" [--limit N]`

Search with [YouTrack query syntax](https://www.jetbrains.com/help/youtrack/cloud/search-and-command-attributes.html).
Default limit is 50. Output includes `tags` and `links` arrays for each issue.

```bash
trackpilot list --query "project: ABC State: Open" --limit 20
trackpilot list --query "for: me #Unresolved"
```

### `create --project <KEY> --summary "..." [--description "..."] [--type <Type>] [--assignee <user>] [--field "Name=Value" ...] [--tag <name> ...] [--relates <ID>] [--depends-on <ID>] [--subtask-of <ID>]`

Create a task in one shot. `--project` is the project **key** (short name) from
`trackpilot projects`.

All values are validated **before** anything is written: an unknown tag, user, or
field value fails fast with a "did you mean" suggestion, and no issue is created
on bad input.

```bash
trackpilot create --project RC --summary "Release" --type Task \
  --assignee "Javad Tavakoli" \
  --field "RC Squad=Squad 2" --field "Team=Front-End" --field "Team=QA" \
  --field "Estimation=1d" \
  --tag scope:infra --tag unplanned \
  --relates RC-211
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

### `update <id> [--summary ...] [--description ...] [--state ...] [--assignee <user>] [--field "Name=Value" ...] [--tag <name> ...] [--relates <ID>] [--depends-on <ID>] [--subtask-of <ID>]`

Update an issue. Accepts the same `--assignee`, `--field`, `--tag`, and link flags
as `create` (with the same validation-before-write semantics). Pass at least one
flag.

```bash
trackpilot update ABC-123 --state "In Progress"
trackpilot update ABC-123 --summary "Clearer title" --description "Updated body"
trackpilot update RC-123 --assignee "Javad Tavakoli" --field "Team=Front-End" --tag scope:infra
```

### `comment <id> --text "..."`

```bash
trackpilot comment ABC-123 --text "Deployed to staging, ready for QA."
```

### `fields <PROJECT>`

List all custom field names, their allowed values, and available tags for a
project. Use this to discover what to pass to `--field` and `--tag`.

```bash
trackpilot fields RC
```

### `command <id> --query "<yt-command>"`

Apply an arbitrary [YouTrack command](https://www.jetbrains.com/help/youtrack/cloud/commands.html)
to an issue — a low-level escape hatch for bulk actions or YouTrack command
syntax not covered by the other flags.

```bash
trackpilot command ABC-123 --query "Team Front-End"
trackpilot command ABC-123 --query "State Fixed tag release-blocker"
```

### `release [--base main] [--head next]`

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

## Using it with an AI assistant

Because output is plain JSON, you can let an assistant call `trackpilot` directly.
A typical loop:

1. `trackpilot read ABC-1` → the assistant reads a spec issue.
2. The assistant drafts subtasks and runs `trackpilot create --project ABC --summary ... --description ...` for each.
3. At release time, `trackpilot release` produces the QA list to paste into a ticket or message.

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
