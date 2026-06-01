// trackpilot projects -- list projects and their short-name keys.

export async function run({ api }) {
  const projects = await api.projects();
  return { count: projects.length, projects };
}
