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

- **Runtime:** Node 20+, ESM, **zero runtime dependencies** (uses built-in
  `fetch`). Keeps install trivial and audit surface tiny.
- **Distribution:** Lives in its own git repo at `~/Projects/youtrack-cli`.
  Installed globally via `yarn link` (Yarn 1.22), exposing a `youtrack` binary
  on PATH. Usable from any repo.
- **Hosting target:** YouTrack Cloud (`https://<instance>.youtrack.cloud`).
- **Output:** **JSON by default** on stdout — precise for machine parsing.
  Errors print `{ "error": "..." }` and exit non-zero.

## Configuration & auth

**The token is never written to disk by the tool.** It is read only from the
environment.

- **Token:** read exclusively from the `YOUTRACK_TOKEN` environment variable
  (a YouTrack **permanent token**, `perm:...`, created in YouTrack → Profile →
  Account Security → Authentication). If `YOUTRACK_TOKEN` is unset, every
  command that needs auth fails fast with a clear message telling the user to
  export it. The tool has no `--token` flag and no token persistence.
- **baseUrl (non-secret):** `https://<instance>.youtrack.cloud`. Resolved in
  priority order: `YOUTRACK_BASE_URL` env var → `~/.config/youtrack-cli/config.json`.
  `config set --base-url ...` writes only this non-secret value.
- Auth header on every request: `Authorization: Bearer $YOUTRACK_TOKEN`.

**Recommended user setup (documented in README):** keep the export in a
gitignored secrets file the shell sources, e.g.

```sh
# ~/.config/youtrack-cli/token.env   (chmod 600, NOT committed)
export YOUTRACK_TOKEN="perm:xxxxxxxx"
```

then `source` it from `~/.zshrc` (or use direnv per-repo). The tool itself does
not read this file — it only consumes the resulting env var, so the secret’s
lifetime and storage stay entirely under the user’s control.

## Commands

| Command | Behavior |
|---|---|
| `config set --base-url <url>` | Write the non-secret baseUrl to config. |
| `config get` | Print resolved baseUrl + whether `YOUTRACK_TOKEN` is set (token value never printed). |
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
  package.json          # "type": "module", "bin": { "youtrack": "./bin/youtrack.mjs" }
  bin/youtrack.mjs      # entry: parse argv, dispatch to command, format output/errors
  src/
    config.mjs          # load/save baseUrl (config.json); resolve token from env only
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
  docs/superpowers/specs/2026-06-01-youtrack-cli-design.md
  README.md             # install + secure token setup + usage
  .gitignore            # node_modules, *.env, token.env
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

## Error handling

- `YOUTRACK_TOKEN` unset → `{ "error": "YOUTRACK_TOKEN is not set; export your YouTrack permanent token" }`, exit 1.
- Missing baseUrl → `{ "error": "no baseUrl: run `youtrack config set --base-url ...`" }`, exit 1.
- HTTP non-2xx → surface status + YouTrack error body in `{ "error": ... }`, exit 1.
- `release` outside a git repo → clear error, exit 1.

## Out of scope (YAGNI)

- Multiple YouTrack instances / profiles (single config only).
- Storing the token anywhere (env var only, by design).
- Interactive prompts / TUI.
- Caching, offline mode, attachments, work items/time tracking.
- Publishing to npm (local `yarn link` only for now).
