// Pure MCP tool registry: each entry maps one MCP tool to a TrackpilotApi
// method. No MCP SDK import here -- src/mcp.mjs wraps these for the server.
// inputSchema is a zod raw shape (an object of zod validators).

import { z } from 'zod';
import { createIssue, updateIssue } from './issue-ops.mjs';

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
    description: 'Create an issue. Returns the full created issue. Call project_schema first to see field names, allowed values, and which fields are required. Initial state is set by the project workflow; use update_issue to change state after creation.',
    inputSchema: {
      project: z.string().describe('Project short key, e.g. ABC'),
      summary: z.string().describe('Issue summary / title'),
      description: z.string().optional().describe('Markdown description'),
      type: z.string().optional().describe('Issue type, e.g. "Task", "Bug"'),
      assignee: z.string().optional().describe('User login, name, or full name'),
      fields: z.array(z.object({
        name: z.string().describe('Custom field name, e.g. "Priority"'),
        value: z.string().describe('A single value; repeat the field name to set multiple values on a multi-value field'),
      })).optional().describe('Custom fields. Required fields (see project_schema) must be set at creation.'),
      tags: z.array(z.string()).optional().describe('Existing tag names (will not create new tags)'),
      relates: z.array(z.string()).optional().describe('Issue IDs to link as "relates to"'),
      dependsOn: z.array(z.string()).optional().describe('Issue IDs this issue depends on'),
      subtaskOf: z.array(z.string()).optional().describe('Parent issue IDs (this becomes a subtask)'),
    },
    handler: (api, args) => createIssue(api, args),
  },
  {
    name: 'update_issue',
    title: 'Update issue',
    description: "Update an issue's summary, description, state, type, assignee, custom fields, tags, and links. Returns the full updated issue.",
    inputSchema: {
      id: z.string().describe('Readable issue id, e.g. ABC-123'),
      summary: z.string().optional().describe('Issue summary / title'),
      description: z.string().optional().describe('Markdown description'),
      state: z.string().optional().describe('New state, e.g. "In Progress"'),
      type: z.string().optional().describe('Issue type, e.g. "Task", "Bug"'),
      assignee: z.string().optional().describe('User login, name, or full name'),
      fields: z.array(z.object({
        name: z.string().describe('Custom field name, e.g. "Priority"'),
        value: z.string().describe('A single value; repeat the field name to set multiple values on a multi-value field'),
      })).optional().describe('Custom fields to set'),
      tags: z.array(z.string()).optional().describe('Existing tag names to add'),
      relates: z.array(z.string()).optional().describe('Issue IDs to link as "relates to"'),
      dependsOn: z.array(z.string()).optional().describe('Issue IDs this issue depends on'),
      subtaskOf: z.array(z.string()).optional().describe('Parent issue IDs (this becomes a subtask)'),
    },
    handler: (api, { id, ...rest }) => updateIssue(api, id, rest),
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
