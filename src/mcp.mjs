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
