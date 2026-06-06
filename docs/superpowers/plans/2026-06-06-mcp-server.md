# trackpilot MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `trackpilot mcp` subcommand that runs a local stdio MCP server exposing trackpilot's YouTrack operations (read + write) as MCP tools.

**Architecture:** A pure, unit-tested tool registry (`src/mcp-tools.mjs`) maps each MCP tool to a `TrackpilotApi` method. A thin wiring module (`src/mcp.mjs`) builds the `api` from existing config/token resolution, registers every tool on an `McpServer`, and connects a `StdioServerTransport`. `bin/trackpilot.mjs` special-cases `mcp` before its one-shot print/exit flow and lazy-imports the server so the MCP SDK stays off the normal CLI path. stdout is reserved for JSON-RPC; diagnostics go to stderr.

**Tech Stack:** Node 20 ESM, `@modelcontextprotocol/sdk` (high-level `McpServer` API), `zod` (tool input schemas), `node:test` + `node:assert/strict`, Yarn Berry 4.

---

## File Structure

- **Create `src/mcp-tools.mjs`** — exports `TOOLS`, an array of `{ name, title, description, inputSchema, handler(api, args) }`. Pure: imports only `zod`. Each `handler` calls one `api` method and returns its raw result (no MCP wrapping). This is the testable core.
- **Create `src/mcp.mjs`** — exports `startMcpServer(options)`. Imports the MCP SDK, `createApi`/`AppError`, `resolveBaseUrl`/`resolveToken`, and `TOOLS`. Resolves auth, registers tools (wrapping results/errors into MCP responses), connects stdio.
- **Modify `bin/trackpilot.mjs`** — add an early `mcp` branch that lazy-imports `startMcpServer`; add `mcp` to the `USAGE` text. (Do NOT add `mcp` to the `COMMANDS` table — that table assumes the print/exit contract.)
- **Create `test/mcp-tools.test.mjs`** — unit tests driving each `TOOLS[*].handler` against a fake `api`.
- **Create `test/mcp-smoke.test.mjs`** — spawns the server, performs the JSON-RPC `initialize` + `tools/list` handshake over stdio, asserts the tool list and clean stdout.
- **Modify `package.json`** — add `@modelcontextprotocol/sdk` and `zod` to `dependencies` (via `yarn add`, which also updates `yarn.lock`).
- **Modify `README.md`** — add a "Use as an MCP server" section.

---

### Task 1: Add dependencies

**Files:**
- Modify: `package.json` (dependencies)
- Modify: `yarn.lock`

- [ ] **Step 1: Add the MCP SDK and zod with yarn**

Run:
```bash
yarn add @modelcontextprotocol/sdk zod
```
Expected: `package.json` `dependencies` gains both packages; `yarn.lock` updates; install succeeds.

- [ ] **Step 2: Confirm the installed SDK's high-level API**

This plan targets the modern high-level API: `McpServer` from `@modelcontextprotocol/sdk/server/mcp.js`, `StdioServerTransport` from `@modelcontextprotocol/sdk/server/stdio.js`, and `server.registerTool(name, { title, description, inputSchema }, handler)`.

Run:
```bash
node --input-type=module -e "import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'; const s = new McpServer({ name: 't', version: '0' }); console.log(typeof s.registerTool, typeof s.connect);"
```
Expected: `function function`.

If `registerTool` is `undefined` (older SDK), the installed version exposes `server.tool(name, inputSchemaShape, handler)` instead. In that case, in Task 3 use `server.tool(tool.name, tool.inputSchema, wrappedHandler)` and drop the `{ title, description }` config object. Verify which one exists before writing Task 3's code, and use the one that prints `function`.

- [ ] **Step 3: Commit**

```bash
git add package.json yarn.lock
git commit -m "build: add @modelcontextprotocol/sdk and zod deps

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: The pure tool registry (`src/mcp-tools.mjs`)

**Files:**
- Create: `src/mcp-tools.mjs`
- Test: `test/mcp-tools.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `test/mcp-tools.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../src/mcp-tools.mjs';

// A fake api that records calls and returns a canned value per method.
function fakeApi(returns = {}) {
  const calls = [];
  const handler = {
    get(_t, method) {
      return (...args) => {
        calls.push({ method, args });
        return returns[method] ?? { ok: method };
      };
    },
  };
  const api = new Proxy({}, handler);
  return { api, calls };
}

function tool(name) {
  const t = TOOLS.find((x) => x.name === name);
  assert.ok(t, `tool ${name} should exist`);
  return t;
}

test('exposes exactly the 12 expected tools', () => {
  const names = TOOLS.map((t) => t.name).sort();
  assert.deepEqual(names, [
    'add_comment', 'apply_command', 'create_issue', 'list_projects',
    'list_tags', 'list_users', 'log_work', 'project_schema',
    'read_issue', 'search', 'update_issue', 'whoami',
  ]);
});

test('every tool has name, description, an object inputSchema, and a handler', () => {
  for (const t of TOOLS) {
    assert.equal(typeof t.name, 'string');
    assert.equal(typeof t.description, 'string');
    assert.equal(typeof t.inputSchema, 'object');
    assert.equal(typeof t.handler, 'function');
  }
});

test('search calls api.search(query, limit)', async () => {
  const { api, calls } = fakeApi({ search: [{ id: 'ABC-1' }] });
  const out = await tool('search').handler(api, { query: 'project: ABC', limit: 5 });
  assert.deepEqual(calls.at(-1), { method: 'search', args: ['project: ABC', 5] });
  assert.deepEqual(out, [{ id: 'ABC-1' }]);
});

test('read_issue calls api.readIssue(id)', async () => {
  const { api, calls } = fakeApi();
  await tool('read_issue').handler(api, { id: 'ABC-123' });
  assert.deepEqual(calls.at(-1), { method: 'readIssue', args: ['ABC-123'] });
});

test('list_projects calls api.projects() with no args', async () => {
  const { api, calls } = fakeApi();
  await tool('list_projects').handler(api, {});
  assert.deepEqual(calls.at(-1), { method: 'projects', args: [] });
});

test('project_schema calls api.projectSchema(project)', async () => {
  const { api, calls } = fakeApi();
  await tool('project_schema').handler(api, { project: 'ABC' });
  assert.deepEqual(calls.at(-1), { method: 'projectSchema', args: ['ABC'] });
});

test('whoami calls api.me()', async () => {
  const { api, calls } = fakeApi();
  await tool('whoami').handler(api, {});
  assert.deepEqual(calls.at(-1), { method: 'me', args: [] });
});

test('create_issue passes a {project, summary, description} object', async () => {
  const { api, calls } = fakeApi();
  await tool('create_issue').handler(api, { project: 'ABC', summary: 'S', description: 'D' });
  assert.deepEqual(calls.at(-1), { method: 'createIssue', args: [{ project: 'ABC', summary: 'S', description: 'D' }] });
});

test('update_issue passes id and a patch object', async () => {
  const { api, calls } = fakeApi();
  await tool('update_issue').handler(api, { id: 'ABC-1', state: 'Fixed' });
  assert.deepEqual(calls.at(-1), { method: 'updateIssue', args: ['ABC-1', { summary: undefined, description: undefined, state: 'Fixed' }] });
});

test('add_comment calls api.addComment(id, text)', async () => {
  const { api, calls } = fakeApi();
  await tool('add_comment').handler(api, { id: 'ABC-1', text: 'hi' });
  assert.deepEqual(calls.at(-1), { method: 'addComment', args: ['ABC-1', 'hi'] });
});

test('log_work passes id and a work item object', async () => {
  const { api, calls } = fakeApi();
  await tool('log_work').handler(api, { id: 'ABC-1', minutes: 30, text: 'w' });
  assert.deepEqual(calls.at(-1), { method: 'logWorkItem', args: ['ABC-1', { minutes: 30, text: 'w', date: undefined, type: undefined }] });
});

test('apply_command calls api.applyCommand(id, query)', async () => {
  const { api, calls } = fakeApi();
  await tool('apply_command').handler(api, { id: 'ABC-1', query: 'State Fixed' });
  assert.deepEqual(calls.at(-1), { method: 'applyCommand', args: ['ABC-1', 'State Fixed'] });
});

test('list_tags and list_users call tags() and users()', async () => {
  const { api, calls } = fakeApi();
  await tool('list_tags').handler(api, {});
  assert.deepEqual(calls.at(-1), { method: 'tags', args: [] });
  await tool('list_users').handler(api, {});
  assert.deepEqual(calls.at(-1), { method: 'users', args: [] });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/mcp-tools.test.mjs`
Expected: FAIL — `Cannot find module '../src/mcp-tools.mjs'`.

- [ ] **Step 3: Create the implementation**

Create `src/mcp-tools.mjs`:
```js
// Pure MCP tool registry: each entry maps one MCP tool to a TrackpilotApi
// method. No MCP SDK import here -- src/mcp.mjs wraps these for the server.
// inputSchema is a zod raw shape (an object of zod validators).

import { z } from 'zod';

export const TOOLS = [
  {
    name: 'search',
    title: 'Search issues',
    description: 'Search YouTrack issues with YouTrack query syntax. Returns shaped issues.',
    inputSchema: {
      query: z.string().describe('YouTrack query, e.g. "project: ABC #Unresolved"'),
      limit: z.number().int().positive().optional().describe('Max number of results'),
    },
    handler: (api, { query, limit }) => api.search(query, limit),
  },
  {
    name: 'read_issue',
    title: 'Read issue',
    description: 'Read one issue by its readable id (e.g. ABC-123), including comments.',
    inputSchema: { id: z.string().describe('Readable issue id, e.g. ABC-123') },
    handler: (api, { id }) => api.readIssue(id),
  },
  {
    name: 'list_projects',
    title: 'List projects',
    description: 'List all projects with their short keys.',
    inputSchema: {},
    handler: (api) => api.projects(),
  },
  {
    name: 'project_schema',
    title: 'Project schema',
    description: "List a project's custom fields, their types, and allowed values.",
    inputSchema: { project: z.string().describe('Project short key, e.g. ABC') },
    handler: (api, { project }) => api.projectSchema(project),
  },
  {
    name: 'list_users',
    title: 'List users',
    description: 'List users (login, name, fullName).',
    inputSchema: {},
    handler: (api) => api.users(),
  },
  {
    name: 'list_tags',
    title: 'List tags',
    description: 'List the available issue tags.',
    inputSchema: {},
    handler: (api) => api.tags(),
  },
  {
    name: 'whoami',
    title: 'Who am I',
    description: 'Return the authenticated user (name, login).',
    inputSchema: {},
    handler: (api) => api.me(),
  },
  {
    name: 'create_issue',
    title: 'Create issue',
    description: 'Create a new issue in a project. Returns the new issue id.',
    inputSchema: {
      project: z.string().describe('Project short key, e.g. ABC'),
      summary: z.string().describe('Issue summary / title'),
      description: z.string().optional().describe('Markdown description'),
    },
    handler: (api, { project, summary, description }) =>
      api.createIssue({ project, summary, description }),
  },
  {
    name: 'update_issue',
    title: 'Update issue',
    description: "Update an issue's summary, description, and/or state.",
    inputSchema: {
      id: z.string().describe('Readable issue id, e.g. ABC-123'),
      summary: z.string().optional(),
      description: z.string().optional(),
      state: z.string().optional().describe('New state, e.g. "In Progress"'),
    },
    handler: (api, { id, summary, description, state }) =>
      api.updateIssue(id, { summary, description, state }),
  },
  {
    name: 'add_comment',
    title: 'Add comment',
    description: 'Add a comment to an issue.',
    inputSchema: {
      id: z.string().describe('Readable issue id, e.g. ABC-123'),
      text: z.string().describe('Comment text (markdown)'),
    },
    handler: (api, { id, text }) => api.addComment(id, text),
  },
  {
    name: 'log_work',
    title: 'Log work',
    description: 'Log a work item (time spent) on an issue.',
    inputSchema: {
      id: z.string().describe('Readable issue id, e.g. ABC-123'),
      minutes: z.number().int().positive().describe('Minutes spent'),
      text: z.string().optional().describe('Work description'),
      date: z.number().optional().describe('Epoch milliseconds; defaults to now'),
      type: z.string().optional().describe('Work item type name'),
    },
    handler: (api, { id, minutes, text, date, type }) =>
      api.logWorkItem(id, { minutes, text, date, type }),
  },
  {
    name: 'apply_command',
    title: 'Apply command',
    description: 'Apply a YouTrack command to an issue, e.g. "State Fixed" or "add tag urgent".',
    inputSchema: {
      id: z.string().describe('Readable issue id, e.g. ABC-123'),
      query: z.string().describe('YouTrack command, e.g. "State Fixed"'),
    },
    handler: (api, { id, query }) => api.applyCommand(id, query),
  },
];
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/mcp-tools.test.mjs`
Expected: PASS (all tests green).

- [ ] **Step 5: Commit**

```bash
git add src/mcp-tools.mjs test/mcp-tools.test.mjs
git commit -m "feat(mcp): add pure tool registry mapping MCP tools to the API

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: The server wiring (`src/mcp.mjs`)

**Files:**
- Create: `src/mcp.mjs`

This module has IO side effects (stdio transport, process exit). It is exercised end-to-end by the smoke test in Task 5, so this task has no separate unit test — it is verified by `node -c` (syntax) here and by Task 5's handshake.

- [ ] **Step 1: Create the implementation**

Create `src/mcp.mjs`:
```js
// trackpilot mcp -- expose YouTrack operations to MCP clients over stdio.
// IMPORTANT: stdout is reserved for the JSON-RPC protocol. All diagnostics
// MUST go to stderr, or they corrupt the protocol stream.

import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createApi, AppError } from './api.mjs';
import { resolveBaseUrl, resolveToken } from './config.mjs';
import { TOOLS } from './mcp-tools.mjs';

const require = createRequire(import.meta.url);
const { version } = require('../package.json');

function asContent(result) {
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}

export async function startMcpServer(options = {}) {
  const baseUrl = await resolveBaseUrl(options['base-url']);
  const { token } = await resolveToken();

  let api;
  try {
    api = createApi({ baseUrl, token }); // throws AppError if baseUrl/token missing
  } catch (err) {
    process.stderr.write(`trackpilot mcp: ${err.message}\n`);
    process.exit(1);
  }

  const server = new McpServer({ name: 'trackpilot', version });

  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      { title: tool.title, description: tool.description, inputSchema: tool.inputSchema },
      async (args) => {
        try {
          return asContent(await tool.handler(api, args));
        } catch (err) {
          const message = err instanceof AppError ? err.message : err?.message || String(err);
          return { isError: true, content: [{ type: 'text', text: message }] };
        }
      },
    );
  }

  await server.connect(new StdioServerTransport());
  process.stderr.write('trackpilot mcp: server ready on stdio\n');
}
```

(If Task 1 Step 2 found the older SDK, replace the `server.registerTool(...)` call with:
```js
server.tool(tool.name, tool.inputSchema, async (args) => { /* same try/catch body */ });
```
and drop the `{ title, description, inputSchema }` config object.)

- [ ] **Step 2: Verify it parses**

Run: `node -c src/mcp.mjs`
Expected: no output, exit 0 (syntax OK).

- [ ] **Step 3: Commit**

```bash
git add src/mcp.mjs
git commit -m "feat(mcp): add stdio server wiring

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Wire the `mcp` subcommand into the CLI

**Files:**
- Modify: `bin/trackpilot.mjs`

- [ ] **Step 1: Add the `mcp` branch in `main()`**

In `bin/trackpilot.mjs`, find this block in `main()`:
```js
  const entry = COMMANDS[commandName];
  if (!entry) fail(`unknown command "${commandName}". Run \`trackpilot --help\`.`);
```
Insert this BEFORE it (right after the top-of-`main` help check):
```js
  // `mcp` starts a long-lived stdio server -- it bypasses the one-shot
  // print/exit flow below, so it is not in COMMANDS. Lazy-import keeps the
  // MCP SDK off the path of every other command.
  if (commandName === 'mcp') {
    const { options } = parseArgs(argv.slice(1), { booleans: BOOLEAN_FLAGS });
    if (options.help) {
      process.stdout.write(USAGE + '\n');
      process.exit(0);
    }
    const { startMcpServer } = await import('../src/mcp.mjs');
    await startMcpServer(options);
    return;
  }
```

- [ ] **Step 2: Add `mcp` to the USAGE text**

In the `USAGE` template string, under the `Commands:` list (after the `fields` line), add:
```
  mcp                                  Run an MCP server over stdio (for Claude)
```

- [ ] **Step 3: Verify the CLI still parses and help shows `mcp`**

Run: `node bin/trackpilot.mjs --help`
Expected: usage text prints and includes the `mcp` line; exit 0.

- [ ] **Step 4: Commit**

```bash
git add bin/trackpilot.mjs
git commit -m "feat(mcp): wire up the \`trackpilot mcp\` subcommand

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Smoke test the live server over stdio

**Files:**
- Create: `test/mcp-smoke.test.mjs`

- [ ] **Step 1: Write the test**

Create `test/mcp-smoke.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../bin/trackpilot.mjs', import.meta.url));

// Drive the server: spawn it, send newline-delimited JSON-RPC, collect stdout
// lines, and resolve when a response with the given id arrives (or time out).
function rpcSession() {
  const child = spawn(process.execPath, [BIN, 'mcp'], {
    env: {
      ...process.env,
      YOUTRACK_BASE_URL: 'https://stub.youtrack.cloud',
      YOUTRACK_TOKEN: 'stub-token',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const messages = [];
  let buf = '';
  child.stdout.on('data', (chunk) => {
    buf += chunk.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) messages.push(JSON.parse(line)); // throws if stdout is not pure JSON-RPC
    }
  });

  const send = (obj) => child.stdin.write(JSON.stringify(obj) + '\n');

  const waitFor = (id, timeoutMs = 5000) =>
    new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = () => {
        const found = messages.find((m) => m.id === id);
        if (found) return resolve(found);
        if (Date.now() - started > timeoutMs) return reject(new Error(`timeout waiting for id ${id}`));
        setTimeout(tick, 25);
      };
      tick();
    });

  return { child, send, waitFor };
}

test('server lists all 12 tools via the JSON-RPC handshake', async () => {
  const { child, send, waitFor } = rpcSession();
  try {
    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'smoke', version: '0' },
      },
    });
    await waitFor(1);
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });

    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const res = await waitFor(2);

    const names = res.result.tools.map((t) => t.name).sort();
    assert.equal(names.length, 12);
    assert.ok(names.includes('search'));
    assert.ok(names.includes('create_issue'));
    assert.ok(names.includes('log_work'));
  } finally {
    child.kill();
  }
});
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `node --test test/mcp-smoke.test.mjs`
Expected: PASS. (If it fails on `protocolVersion`, read the `initialize` error in the response and set `protocolVersion` to the version the installed SDK reports as supported, then re-run.)

- [ ] **Step 3: Run the whole suite**

Run: `node --test`
Expected: all tests pass (existing suite + the two new files).

- [ ] **Step 4: Commit**

```bash
git add test/mcp-smoke.test.mjs
git commit -m "test(mcp): smoke-test the stdio server handshake and tool list

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Document the MCP server in the README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add an "Use as an MCP server" section**

Add this section to `README.md` (place it after the CLI usage / library API sections; match the surrounding heading level — use `##`):
```markdown
## Use as an MCP server

trackpilot can run as a local [Model Context Protocol](https://modelcontextprotocol.io)
server over stdio, exposing your YouTrack instance to MCP clients like Claude.

It uses the same auth as the CLI: set your instance URL and store a token first
(`trackpilot config set --base-url https://your.youtrack.cloud` and
`trackpilot config set-token`), or pass `YOUTRACK_BASE_URL` / `YOUTRACK_TOKEN`
through the client config below.

**Claude Code:**
```bash
claude mcp add trackpilot -- npx trackpilot mcp
```

**Claude Desktop** — add to `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "trackpilot": {
      "command": "npx",
      "args": ["trackpilot", "mcp"],
      "env": {
        "YOUTRACK_BASE_URL": "https://your.youtrack.cloud",
        "YOUTRACK_TOKEN": "perm-xxxxxxxx"
      }
    }
  }
}
```

The server exposes read tools (`search`, `read_issue`, `list_projects`,
`project_schema`, `list_users`, `list_tags`, `whoami`) and write tools
(`create_issue`, `update_issue`, `add_comment`, `log_work`, `apply_command`).
Your MCP client prompts for approval before each write.
```

- [ ] **Step 2: Verify the section renders / links are sane**

Run: `grep -n "Use as an MCP server" README.md`
Expected: one match. Eyeball the section for broken markdown.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document the trackpilot mcp server

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Notes on release impact

The `feat(mcp): ...` commits make the next push to `main` a **minor** version bump
(via the existing CI pipeline). The `build:`/`test:`/`docs:` commits are release
no-ops on their own but ride along with the feature in the same release. Push only
when the user asks.

## Self-review notes

- **Spec coverage:** transport (stdio) → Task 3/4; full read+write tool surface (12 tools) → Task 2 + asserted in Tasks 2 & 5; `trackpilot mcp` subcommand + lazy SDK import → Task 4; snake_case names → Task 2; auth reuse + fail-fast → Task 3; per-tool error wrapping → Task 3; stdout discipline → Task 3 + guarded by Task 5 (JSON.parse of every stdout line); deps as normal + yarn.lock → Task 1; tests → Tasks 2 & 5; README → Task 6. All spec sections covered.
- **Tool count consistency:** 12 tools listed identically in the spec table, Task 2 implementation, Task 2 name-set test, and Task 5 assertion.
- **Method-name consistency:** handler→api mappings (`search`, `readIssue`, `projects`, `projectSchema`, `users`, `tags`, `me`, `createIssue`, `updateIssue`, `addComment`, `logWorkItem`, `applyCommand`) all match `src/api.d.ts`.
- **SDK API risk:** Task 1 Step 2 verifies `registerTool` exists and gives the `server.tool(...)` fallback for older SDKs, referenced again in Task 3.
