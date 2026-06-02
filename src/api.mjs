// The only module that knows YouTrack Cloud REST shapes.
// Construct with createApi({ baseUrl, token }); every method returns plain data.

export class AppError extends Error {}

const ISSUE_FIELDS =
  'idReadable,summary,description,project(shortName,name),' +
  'reporter(login,fullName),created,updated,' +
  'customFields(name,value(name,login,fullName,presentation,minutes)),' +
  'tags(name),' +
  'links(direction,linkType(name),issues(idReadable))';

const COMMENT_FIELDS = 'id,text,created,author(login,fullName)';

export function renderOne(v) {
  if (v == null) return null;
  if (typeof v !== 'object') return String(v);
  return v.name || v.fullName || v.login || v.presentation || null;
}

export function fieldValue(cf) {
  const v = cf?.value;
  if (v == null) return null;
  if (Array.isArray(v)) return v.map(renderOne).filter(Boolean).join(', ') || null;
  return renderOne(v);
}

export function shapeLinks(links) {
  const out = [];
  for (const link of links || []) {
    for (const issue of link.issues || []) {
      out.push({ type: link.linkType?.name ?? null, direction: link.direction ?? null, id: issue.idReadable });
    }
  }
  return out;
}

export function shapeIssue(issue) {
  const fields = {};
  for (const cf of issue.customFields || []) fields[cf.name] = fieldValue(cf);
  return {
    id: issue.idReadable,
    summary: issue.summary,
    description: issue.description ?? null,
    project: issue.project?.shortName ?? null,
    state: fields.State ?? null,
    type: fields.Type ?? null,
    priority: fields.Priority ?? null,
    assignee: fields.Assignee ?? null,
    reporter: issue.reporter?.fullName || issue.reporter?.login || null,
    tags: (issue.tags || []).map((t) => t.name),
    links: shapeLinks(issue.links),
    customFields: fields,
  };
}

export function createApi({ baseUrl, token }) {
  if (!baseUrl) {
    throw new AppError('no baseUrl: run `trackpilot config set --base-url <url>`');
  }
  if (!token) {
    throw new AppError('no token: run `trackpilot config set-token` or export YOUTRACK_TOKEN');
  }

  const apiBase = `${baseUrl}/api`;

  async function request(method, path, { query, body } = {}) {
    const url = new URL(apiBase + path);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      }
    }
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      throw new AppError(`network error calling YouTrack: ${err.message}`);
    }

    const raw = await res.text();
    let data = null;
    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch {
        data = raw;
      }
    }

    if (!res.ok) {
      const detail =
        (data && (data.error_description || data.error || data.localizedMessage)) ||
        (typeof data === 'string' ? data : '') ||
        res.statusText;
      throw new AppError(`YouTrack ${res.status}: ${detail}`);
    }
    return data;
  }

  // --- helpers ---------------------------------------------------------------

  function webUrl(idReadable) {
    return `${baseUrl}/issue/${idReadable}`;
  }

  function withUrl(shaped) {
    return { ...shaped, url: webUrl(shaped.id) };
  }

  // --- public API ------------------------------------------------------------

  return {
    async projects() {
      const data = await request('GET', '/admin/projects', {
        query: { fields: 'id,shortName,name,archived', $top: 1000 },
      });
      return (data || []).map((p) => ({
        id: p.id,
        shortName: p.shortName,
        name: p.name,
        archived: !!p.archived,
      }));
    },

    async resolveProjectId(shortName) {
      const projects = await this.projects();
      const match = projects.find(
        (p) => p.shortName?.toLowerCase() === String(shortName).toLowerCase(),
      );
      if (!match) {
        throw new AppError(
          `project "${shortName}" not found (run \`trackpilot projects\` to list keys)`,
        );
      }
      return match.id;
    },

    async readIssue(id) {
      const issue = await request('GET', `/issues/${encodeURIComponent(id)}`, {
        query: { fields: ISSUE_FIELDS },
      });
      const comments = await request('GET', `/issues/${encodeURIComponent(id)}/comments`, {
        query: { fields: COMMENT_FIELDS },
      });
      return {
        ...withUrl(shapeIssue(issue)),
        comments: (comments || []).map((c) => ({
          author: c.author?.fullName || c.author?.login || null,
          text: c.text,
        })),
      };
    },

    async search(query, limit = 50) {
      const data = await request('GET', '/issues', {
        query: { query: query || '', $top: limit, fields: ISSUE_FIELDS },
      });
      return (data || []).map((i) => withUrl(shapeIssue(i)));
    },

    // `fields` is an array of { name, value } for single-value enum custom
    // fields that must be set at creation time (e.g. a required "RC Squad").
    async createIssue({ project, summary, description, type, fields = [] }) {
      const projectId = await this.resolveProjectId(project);
      const customFields = fields.map(({ name, value }) => ({
        name,
        $type: 'SingleEnumIssueCustomField',
        value: { name: value },
      }));
      const created = await request('POST', '/issues', {
        query: { fields: 'idReadable' },
        body: {
          project: { id: projectId },
          summary,
          ...(description ? { description } : {}),
          ...(customFields.length ? { customFields } : {}),
        },
      });
      const id = created.idReadable;
      if (type) {
        await this.applyCommand(id, `Type ${type}`);
      }
      return this.readIssue(id);
    },

    async updateIssue(id, { summary, description, state }) {
      const body = {};
      if (summary !== undefined) body.summary = summary;
      if (description !== undefined) body.description = description;
      if (Object.keys(body).length) {
        await request('POST', `/issues/${encodeURIComponent(id)}`, {
          query: { fields: 'idReadable' },
          body,
        });
      }
      if (state !== undefined) {
        await this.applyCommand(id, `State ${state}`);
      }
      return this.readIssue(id);
    },

    // YouTrack command API -- robust for state/type/field transitions.
    async applyCommand(id, query) {
      await request('POST', '/commands', {
        body: { query, issues: [{ idReadable: id }] },
      });
    },

    async addComment(id, text) {
      const c = await request('POST', `/issues/${encodeURIComponent(id)}/comments`, {
        query: { fields: COMMENT_FIELDS },
        body: { text },
      });
      return { id, comment: { author: c.author?.fullName || c.author?.login || null, text: c.text } };
    },

    webUrl,
  };
}
