// Shared create/update orchestration used by BOTH the CLI commands and the MCP
// tools, so the two front-ends can never drift. Takes plain structured args
// (not CLI options).

import { AppError } from './api.mjs';
import { prepareCreate, applyPrepared } from './apply-fields.mjs';

// Build the `raw` shape prepareCreate expects. `type` is folded in as the
// "Type" custom field (matching the CLI's --type behavior).
function toRaw({ type, assignee, fields = [], tags = [], relates = [], dependsOn = [], subtaskOf = [] } = {}) {
  return {
    assignee,
    fields: [...fields, ...(type ? [{ name: 'Type', value: type }] : [])],
    tags,
    relates,
    dependsOn,
    subtaskOf,
  };
}

export async function createIssue(api, { project, summary, description, ...rest } = {}) {
  const raw = toRaw(rest);
  const { customFields, commands } = await prepareCreate(api, raw, project);
  const id = await api.createIssue({ project, summary, description, customFields });
  await applyPrepared(api, id, commands);
  return api.readIssue(id);
}

export async function updateIssue(api, id, { summary, description, state, ...rest } = {}) {
  const patch = {};
  if (summary !== undefined) patch.summary = summary;
  if (description !== undefined) patch.description = description;
  if (state !== undefined) patch.state = state;

  const raw = toRaw(rest);
  const hasFieldWork =
    raw.assignee || raw.fields.length || raw.tags.length ||
    raw.relates.length || raw.dependsOn.length || raw.subtaskOf.length;

  if (Object.keys(patch).length === 0 && !hasFieldWork) {
    throw new AppError('nothing to update: pass at least one of summary, description, state, assignee, fields, tags, relates, dependsOn, subtaskOf');
  }

  const projectKey = id.split('-')[0];
  const { customFields, commands } = hasFieldWork
    ? await prepareCreate(api, raw, projectKey)
    : { customFields: [], commands: [] };

  if (Object.keys(patch).length) await api.updateIssue(id, patch);
  await api.setCustomFields(id, customFields);
  await applyPrepared(api, id, commands);
  return api.readIssue(id);
}
