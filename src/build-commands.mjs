// Pure: resolved tags + links -> ordered [{ concern, command }].
// Custom fields and assignee are set via the REST customFields payload
// (see custom-fields.mjs), NOT via commands. Tags and links are not custom
// fields, so they remain command-driven.

export function buildCommands({ tags = [], relates = [], dependsOn = [], subtaskOf = [] } = {}) {
  const cmds = [];
  for (const t of tags) cmds.push({ concern: `tag:${t}`, command: `add tag ${t}` });
  for (const id of relates) cmds.push({ concern: `link:relates:${id}`, command: `relates to ${id}` });
  for (const id of dependsOn) cmds.push({ concern: `link:depends:${id}`, command: `depends on ${id}` });
  for (const id of subtaskOf) cmds.push({ concern: `link:subtask:${id}`, command: `subtask of ${id}` });
  return cmds;
}
