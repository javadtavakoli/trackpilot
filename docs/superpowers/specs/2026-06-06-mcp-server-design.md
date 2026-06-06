# trackpilot MCP server — design

Date: 2026-06-06

## Goal

Expose trackpilot's YouTrack operations to Claude (and any MCP client) as a
local **stdio** MCP server, launched as a new `trackpilot mcp` subcommand. The
server reuses the existing library API (`createApi`) and config/token resolution
— no new auth path, no hosting.

Decisions (from brainstorming):
- **Transport:** local stdio (Claude Desktop / Claude Code launch it as a
  subprocess). No remote/HTTP server.
- **Tool surface:** full read + write. Writes are gated by the MCP client's own
  per-tool-call approval prompt — no extra server-side flag.
- **Packaging:** a `trackpilot mcp` subcommand on the existing single bin. The
  MCP SDK + zod are normal dependencies, lazy-imported so they load only when
  the `mcp` subcommand runs.
- **Tool names:** snake_case (e.g. `read_issue`, `create_issue`).

## Architecture & file layout

Follows the repo's existing split (pure logic in `src/*`, thin wiring; mirrors
how `src/api.mjs` is pure and `bin/trackpilot.mjs` is the thin shell):

- **`src/mcp-tools.mjs`** (pure, unit-tested) — exports a `TOOLS` array. Each
  entry: `{ name, title, description, inputSchema, handler(api, args) }`, where
  `inputSchema` is a zod raw shape (object of zod validators) and `handler` calls
  the matching `api` method and returns the raw result. **No SDK import here** —
  this is the testable core. `inputSchema` may import `zod` (a lightweight, pure
  dep); it does not import the MCP SDK.
- **`src/mcp.mjs`** (wiring, side effects) — `export async function
  startMcpServer(options)`. Imports `McpServer` + `StdioServerTransport` from
  `@modelcontextprotocol/sdk`, resolves `baseUrl`/`token`, builds the `api` via
  `createApi`, registers every tool from `TOOLS`, and connects the stdio
  transport. Owns the "keep stdout clean, log to stderr" invariant.
- **`bin/trackpilot.mjs`** — special-cases `mcp` **before** the normal
  handler → `print()` → exit flow (that flow assumes a one-shot JSON result and
  calls `process.exit`; the server is long-lived). Sketch:

  ```js
  if (commandName === 'mcp') {
    const { positionals, options } = parseArgs(argv.slice(1), { booleans: BOOLEAN_FLAGS });
    const { startMcpServer } = await import('../src/mcp.mjs'); // lazy: SDK off the CLI hot path
    await startMcpServer(options);
    return; // do NOT print()/exit — the server owns the process lifetime
  }
  ```

  `mcp` is also added to the `USAGE` text. It is not added to the `COMMANDS`
  table (that table assumes the print/exit contract).

## Tools (full read + write)

Direct 1:1 maps onto `TrackpilotApi`. Each handler returns the shaped JSON, which
the wiring layer wraps as
`{ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }`.

| MCP tool | API method | Kind |
|---|---|---|
| `search` | `search(query, limit?)` | read |
| `read_issue` | `readIssue(id)` | read |
| `list_projects` | `projects()` | read |
| `project_schema` | `projectSchema(key)` | read |
| `list_users` | `users()` | read |
| `list_tags` | `tags()` | read |
| `whoami` | `me()` | read |
| `create_issue` | `createIssue({ project, summary, description? })` | write |
| `update_issue` | `updateIssue(id, { summary?, description?, state? })` | write |
| `add_comment` | `addComment(id, text)` | write |
| `log_work` | `logWorkItem(id, { minutes, text?, date?, type? })` | write |
| `apply_command` | `applyCommand(id, query)` | write |

**Deliberately excluded** (too sharp / low-level for an LLM tool surface; can be
added later): `request()` (raw REST escape hatch), `setCustomFields`,
`applyCommands`, `resolveProjectId`, `webUrl`, `assist`. Custom-field edits flow
through `create_issue`/`update_issue` as those grow, not a raw setter.

Each tool description tells Claude what it does and names the key inputs (e.g.
`search`: "Search issues with YouTrack query syntax; returns shaped issues").

## Auth, errors, dependencies

- **Auth (startup):** `startMcpServer` calls `resolveBaseUrl(options['base-url'])`
  + `resolveToken()`, then `createApi({ baseUrl, token })`. If `baseUrl` or
  `token` is missing, `createApi` throws `AppError`; catch it, write a clear
  message to **stderr**, and `process.exit(1)` so the MCP client surfaces a
  start-up failure instead of a silent hang.
- **Per-tool errors:** wrap each handler; an `AppError` (or any throw) becomes
  `{ isError: true, content: [{ type: 'text', text: err.message }] }`. A bad call
  surfaces to Claude without crashing the server.
- **stdout discipline:** stdout carries *only* JSON-RPC. Any diagnostics go to
  stderr. (The CLI's `print()`/`fail()` write JSON to stdout and must not be used
  on the `mcp` path.)
- **Dependencies:** add `@modelcontextprotocol/sdk` and `zod` as **normal**
  dependencies (they ship, but are dynamically imported only when `mcp` runs).
  `@napi-rs/keyring` remains the only dep loaded for ordinary CLI commands.
  `src` is already in `files`, so the new modules ship without packaging changes.

## Testing

- **`test/mcp-tools.test.mjs`** — drive each `TOOLS[*].handler` against a fake
  `api` object (record calls, return canned data). Assert each tool calls the
  right method with the right args and passes the result through. Pure and fast;
  no server, no SDK. Mirrors `test/api-client.test.mjs`'s fake-`fetch` style.
- **Smoke test (`test/mcp-smoke.test.mjs`)** — spawn `node bin/trackpilot.mjs
  mcp` with stub `YOUTRACK_BASE_URL`/`YOUTRACK_TOKEN` env, write JSON-RPC
  `initialize` then `tools/list` to its stdin, and assert: (a) the 12 tools are
  listed, and (b) stdout contains only well-formed JSON-RPC (guards the
  clean-stdout invariant). No network: tools aren't *called*, only listed, so no
  real YouTrack request is made.

## Docs

README gains a "Use as an MCP server" section:
- Claude Code: `claude mcp add trackpilot -- npx trackpilot mcp`.
- Claude Desktop: a `claude_desktop_config.json` snippet running `npx trackpilot mcp`.
- Note that auth comes from the OS keyring (`trackpilot config set-token`) or the
  `YOUTRACK_BASE_URL` / `YOUTRACK_TOKEN` env vars passed through the MCP client
  config.

## Risks / assumptions

- **MCP SDK API surface:** uses the current `@modelcontextprotocol/sdk`
  high-level `McpServer` + `registerTool` + `StdioServerTransport`. The exact
  registration call is pinned to the installed SDK version during implementation.
- **Release impact:** adding the server is a `feat:` → minor bump via the existing
  CI pipeline. New runtime deps must be added with yarn so `yarn.lock` stays in
  sync.
- **Generic tool:** no company-identifying data in tool descriptions, examples, or
  the README snippet — use neutral placeholders.
