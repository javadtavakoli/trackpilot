// Pure: resolved typed inputs -> ordered [{ concern, command }].
// One concern per command; no brace-quoting (YouTrack parses multi-word values
// fine when a single command owns the whole tail).

export function buildCommands({
  assignee,
  fields = [],
  tags = [],
  relates = [],
  dependsOn = [],
  subtaskOf = [],
} = {}) {
  const cmds = [];

  if (assignee) cmds.push({ concern: 'assignee', command: `for ${assignee}` });

  for (const f of fields) {
    cmds.push({ concern: `field:${f.name}`, command: `${f.name} ${f.value}` });
  }

  for (const t of tags) {
    cmds.push({ concern: `tag:${t}`, command: `add tag ${t}` });
  }

  for (const id of relates) {
    cmds.push({ concern: `link:relates:${id}`, command: `relates to ${id}` });
  }
  for (const id of dependsOn) {
    cmds.push({ concern: `link:depends:${id}`, command: `depends on ${id}` });
  }
  for (const id of subtaskOf) {
    cmds.push({ concern: `link:subtask:${id}`, command: `subtask of ${id}` });
  }

  return cmds;
}
