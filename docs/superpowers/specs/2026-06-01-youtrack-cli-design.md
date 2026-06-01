# youtrack-cli — Design Spec

**Date:** 2026-06-01
**Status:** Approved (pre-implementation)

## Purpose

A small, reusable command-line tool for working with **YouTrack Cloud** from any
local repository. Two primary jobs:

1. **Authoring & managing issues** — read issue specs, create tasks, update
   fields, comment, and search — so Claude (and the user) can turn specs into
   YouTrack tasks programmatically.
2. **Release diffs for QA** — compare two git branches (default `main..next`),
   extract YouTrack issue IDs referenced in the commits, and print a QA-ready
   list of the issues going out in a release.

## Constraints & decisions

- **Runtime:** Node 20+, ESM. Uses built-in `fetch`. **One runtime dependency:**
  `@napi-rs/keyring` for cross-OS secret storage (ships prebuilt native binaries
  for macOS/Windows/Linux, so no compiler needed). Everything else is stdlib.
- **Distribution:** Public git repo **and published to npm**, intended for use
  by other people. Primary install for end users:
  `npm i -g <package-name>` (or `yarn global add <package-name>`), exposing a
  `youtrack` binary on PATH, usable from any repo. Local dev install:
  `git clone … && yarn install && yarn link`. MIT-licensed.
- **Package name:** to be confirmed against npm availability — preferred
  `youtrack-cli`; if taken, a scoped name `@<npm-user>/youtrack-cli`. The binary
  is `youtrack` regardless.
- **Hosting target:** YouTrack Cloud (`https://<instance>.youtrack.cloud`).
- **Output:** **JSON by default** on stdout — precise for machine parsing.
  Errors print `{ "error": "..." }` and exit non-zero.

## Configuration & auth

**The token is stored in the OS keyring**, encrypted at rest by the platform —
macOS Keychain, Windows Credential Manager, or Linux Secret Service (libsecret),
via `@napi-rs/keyring`. It is a YouTrack **permanent token** (`perm:...`, created
in YouTrack → Profile → Account Security → Authentication).

- **Keyring entry:** service `youtrack-cli`, account `default`.
- **Token resolution order:**
  1. `YOUTRACK_TOKEN` environment variable (override, e.g. for CI where no
     keyring exists).
  2. OS keyring entry.
  If neither yields a token, every command needing auth fails fast with a clear
  message telling the user to run `youtrack config set-token` (or export the env
  var).
- **Writing the token:** `youtrack config set-token` reads the token from stdin
  (so it never lands in shell history) and stores it in the keyring. The token
  is **never** echoed back. `youtrack config delete-token` removes it.
- **Keyring-unavailable fallback:** if the platform keyring can't be reached
  (e.g. a headless Linux box with no Secret Service running), `set-token` fails
  with a clear message pointing the user at the `YOUTRACK_TOKEN` env var instead,
  so the tool stays usable in CI/headless contexts.
- **baseUrl (non-secret):** `https://<instance>.youtrack.cloud`. Resolved in
  priority order: `YOUTRACK_BASE_URL` env var → `~/.config/youtrack-cli/config.json`.
  `config set --base-url ...` writes only this non-secret value.
- Auth header on every request: `Authorization: Bearer <token>`.

## Commands

| Command | Behavior |
|---|---|
| `config set --base-url <url>` | Write the non-secret baseUrl to config. |
| `config set-token` | Read token from stdin, store in OS keyring. |
| `config delete-token` | Remove the token from the OS keyring. |
| `config get` | Print resolved baseUrl + whether a token is available (token value never printed). |
| `projects` | List projects with `{ id, shortName, name }`. |
| `read <id>` | Fetch one issue: id, summary, description, state, type, assignee, comments, URL. |
| `list --query "<yt-query>" [--limit N]` | Search via YouTrack query syntax (default limit 50). |
| `create --project <KEY> --summary "..." [--description "..."] [--type <Type>]` | Create a task; resolves project short-name → internal id. |
| `update <id> [--summary "..."] [--description "..."] [--state "..."]` | Edit fields and/or change state. |
| `comment <id> --text "..."` | Add a comment. |
| `release [--base <branch>] [--head <branch>]` | Release diff for QA (see below). Defaults `--base main --head next`. |

## `release` command — detailed flow

1. Run `git log <base>..<head> --format=%H%n%B` in the **current working
   directory's** repo to get every commit in `head` not in `base`, including
   full commit bodies (which capture merge-commit branch names such as
   `Merge branch 'feat/rc-1-fix-thing'`).
2. Scan each commit message (subject + body) for `LETTERS-NUMBER` tokens via
   regex (case-insensitive, e.g. `/[a-z][a-z0-9]*-\d+/gi`).
3. Normalize to uppercase and dedupe.
4. Fetch the set of real project keys via `projects`; **keep only tokens whose
   prefix matches a real project key.** This drops false positives like
   `UTF-8`, `v2-48`, `base64-7`.
5. Look up each surviving issue in YouTrack. Print a QA-ready JSON list:
   `{ id, summary, state, assignee, url }`.
6. Report **unresolved IDs** (matched a real project prefix but not found in
   YouTrack) in a separate `unresolved` array so nothing is silently dropped.

## Module structure

```
youtrack-cli/
  package.json          # name, version, "type": "module", bin, files, engines>=20, deps, repo, license
  LICENSE               # MIT
  bin/youtrack.mjs      # entry: parse argv, dispatch to command, format output/errors
  src/
    config.mjs          # baseUrl (config.json); token resolve via env → keyring
    keyring.mjs         # thin wrapper over @napi-rs/keyring (get/set/delete, availability check)
    api.mjs             # fetch wrapper: auth header, baseUrl+/api, fields=, error mapping
    args.mjs            # tiny flag parser (--key value, positional)
    git.mjs             # run git log, extract issue tokens
    commands/
      config.mjs
      projects.mjs
      read.mjs
      list.mjs
      create.mjs
      update.mjs
      comment.mjs
      release.mjs
  .github/workflows/publish.yml   # publish to npm on GitHub Release / tag
  docs/superpowers/specs/2026-06-01-youtrack-cli-design.md
  README.md             # install (npm + dev), token setup, every command with examples
  .gitignore            # node_modules
```

Each command is an isolated unit: receives parsed args + an `api` instance,
returns a plain object; the entry point serializes it to JSON. The API wrapper
is the only place that knows YouTrack REST shapes.

## YouTrack REST notes (internal)

- Base: `<baseUrl>/api`. All reads pass an explicit `fields=` selector so nested
  values (custom fields, comment text) are returned.
- **Read:** `GET /api/issues/{id}?fields=idReadable,summary,description,
  customFields(name,value(name,login)),comments(text,author(login)),...`
- **Search:** `GET /api/issues?query=<q>&$top=<N>&fields=...`
- **Create:** `POST /api/issues?fields=idReadable` with body
  `{ project: { id }, summary, description }`. Project id resolved from
  short-name via `GET /api/admin/projects?fields=id,shortName,name`.
- **Update fields:** `POST /api/issues/{id}` with summary/description body.
- **State/Type change:** YouTrack **command API** —
  `POST /api/commands` with `{ query: "State <value>", issues: [{ idReadable }] }`
  — more reliable than raw custom-field writes.
- **Comment:** `POST /api/issues/{id}/comments` with `{ text }`.

## Publishing & CI

- **`.github/workflows/publish.yml`** — triggers on GitHub Release published (and
  on `v*` tags). Steps: checkout → `actions/setup-node@v4` with
  `registry-url: https://registry.npmjs.org` and Node 20 → `yarn install
  --frozen-lockfile` → `npm publish --access public`, authenticated via
  `NODE_AUTH_TOKEN` from the repo secret `NPM_TOKEN`.
- The workflow does **not** bump the version; the published version is whatever
  is in `package.json` at the tagged commit. Release flow: bump version → commit
  → tag `vX.Y.Z` → push → create GitHub Release → CI publishes.
- `package.json` `files` whitelist (`bin`, `src`, `README.md`, `LICENSE`) keeps
  the published tarball minimal; `engines.node >= 20`.

## Error handling

- No token available (env var unset and keyring empty) → `{ "error": "no token: run `youtrack config set-token` or export YOUTRACK_TOKEN" }`, exit 1.
- Missing baseUrl → `{ "error": "no baseUrl: run `youtrack config set --base-url ...`" }`, exit 1.
- HTTP non-2xx → surface status + YouTrack error body in `{ "error": ... }`, exit 1.
- `release` outside a git repo → clear error, exit 1.

## Out of scope (YAGNI)

- Multiple YouTrack instances / profiles (single config only).
- Interactive prompts / TUI.
- Caching, offline mode, attachments, work items/time tracking.
- Publishing to npm (local `yarn link` only for now).
