#!/usr/bin/env node
// trackpilot -- AI-friendly CLI for YouTrack Cloud.
// Parses argv, builds an API client for data commands, runs the command,
// and prints the result as JSON. Errors print `{ "error": ... }` and exit 1.

import { parseArgs } from '../src/args.mjs';
import { createApi, AppError } from '../src/api.mjs';
import { resolveBaseUrl, resolveToken } from '../src/config.mjs';

import { run as config } from '../src/commands/config.mjs';
import { run as projects } from '../src/commands/projects.mjs';
import { run as read } from '../src/commands/read.mjs';
import { run as list } from '../src/commands/list.mjs';
import { run as create } from '../src/commands/create.mjs';
import { run as update } from '../src/commands/update.mjs';
import { run as comment } from '../src/commands/comment.mjs';
import { run as command } from '../src/commands/command.mjs';
import { run as release } from '../src/commands/release.mjs';
import { run as fields } from '../src/commands/fields.mjs';

const BOOLEAN_FLAGS = ['help'];

// Commands that talk to YouTrack get a ready `api`; `config` manages its own state.
const COMMANDS = {
  config: { handler: config, needsApi: false },
  projects: { handler: projects, needsApi: true },
  read: { handler: read, needsApi: true },
  list: { handler: list, needsApi: true },
  create: { handler: create, needsApi: true },
  update: { handler: update, needsApi: true },
  comment: { handler: comment, needsApi: true },
  command: { handler: command, needsApi: true },
  release: { handler: release, needsApi: true },
  fields: { handler: fields, needsApi: true },
};

const USAGE = `trackpilot -- YouTrack Cloud from your terminal (JSON output)

Usage: trackpilot <command> [options]

Commands:
  config set --base-url <url>          Set your YouTrack instance URL
  config set-token                     Store token from stdin in the OS keyring
  config delete-token                  Remove the stored token
  config get                           Show baseUrl + whether a token is available
  projects                             List projects and their keys
  read <id>                            Read one issue (with comments)
  list --query "<q>" [--limit N]       Search issues (YouTrack query syntax)
  create --project <KEY> --summary "..." [--description ...] [--type <Type>] [--assignee <user>] [--field "Name=Value" ...] [--tag <name> ...] [--relates <ID> ...]
  update <id> [--summary ...] [--description ...] [--state ...] [--assignee <user>] [--field "Name=Value" ...] [--tag <name> ...] [--relates <ID> ...]
  comment <id> --text "..."            Add a comment
  command <id> --query "..."           Apply a YouTrack command (e.g. "State Fixed")
  fields <PROJECT>                     List a project's fields, allowed values, and tags
  release [--base main] [--head next]  Release diff: issues for QA from git history
  mcp                                  Run an MCP server over stdio (for Claude)

Global:
  --base-url <url>   Override the configured instance for one call
  --help             Show this help

Auth: token from $YOUTRACK_TOKEN or the OS keyring (trackpilot config set-token).`;

function print(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
}

function fail(message) {
  process.stdout.write(JSON.stringify({ error: message }, null, 2) + '\n');
  process.exit(1);
}

async function main() {
  const argv = process.argv.slice(2);
  const commandName = argv[0];

  if (!commandName || commandName === '--help' || commandName === 'help' || commandName === '-h') {
    process.stdout.write(USAGE + '\n');
    process.exit(commandName ? 0 : 1);
  }

  // `mcp` starts a long-lived stdio server -- it bypasses the one-shot
  // print/exit flow below, so it is not in COMMANDS. Lazy-import keeps the
  // MCP SDK off the path of every other command.
  if (commandName === 'mcp') {
    const { options } = parseArgs(argv.slice(1), { booleans: BOOLEAN_FLAGS });
    if (options.help) {
      process.stdout.write(USAGE + '\n');
      process.exit(0);
    }
    try {
      const { startMcpServer } = await import('../src/mcp.mjs');
      await startMcpServer(options);
    } catch (err) {
      // Route errors to stderr and exit -- do NOT fall through to fail(),
      // which writes JSON to stdout and would corrupt the JSON-RPC stream.
      process.stderr.write(`trackpilot mcp: ${err?.message || err}\n`);
      process.exit(1);
    }
    return;
  }

  const entry = COMMANDS[commandName];
  if (!entry) fail(`unknown command "${commandName}". Run \`trackpilot --help\`.`);

  const { positionals, options } = parseArgs(argv.slice(1), { booleans: BOOLEAN_FLAGS });

  if (options.help) {
    process.stdout.write(USAGE + '\n');
    process.exit(0);
  }

  let api = null;
  if (entry.needsApi) {
    const baseUrl = await resolveBaseUrl(options['base-url']);
    const { token } = await resolveToken();
    api = createApi({ baseUrl, token }); // throws AppError with a clear message if missing
  }

  const result = await entry.handler({ api, positionals, options });
  print(result);
}

main().catch((err) => {
  if (err instanceof AppError) fail(err.message);
  fail(err?.stack || String(err));
});
