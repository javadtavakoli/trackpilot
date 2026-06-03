export class AppError extends Error {}

export type FetchFn = (
  input: string | URL,
  init?: RequestInit
) => Promise<Response>;

export interface CreateApiOptions {
  baseUrl: string;
  token: string;
  /** Defaults to globalThis.fetch. Inject a host fetch (e.g. Tauri) here. */
  fetch?: FetchFn;
}

export interface RequestOptions {
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
}

export interface ShapedIssue {
  id: string; // idReadable
  summary: string;
  description: string | null;
  project: string | null;
  state: string | null;
  type: string | null;
  priority: string | null;
  assignee: string | null;
  reporter: string | null;
  tags: string[];
  links: { type: string | null; direction: string | null; id: string | null }[];
  customFields: Record<string, string | null>;
  url?: string;
}

export interface TrackpilotProject {
  id: string;
  shortName: string;
  name: string;
  archived: boolean;
}

export type ReadIssueResult = ShapedIssue & {
  comments: { author: string | null; text: string }[];
};

export interface TrackpilotApi {
  request(method: string, path: string, opts?: RequestOptions): Promise<any>;
  me(): Promise<{ name: string | null; login: string | null }>;
  projects(): Promise<TrackpilotProject[]>;
  resolveProjectId(shortName: string): Promise<string>;
  readIssue(id: string): Promise<ReadIssueResult>;
  search(query: string, limit?: number): Promise<ShapedIssue[]>;
  createIssue(input: { project: string; summary: string; description?: string; customFields?: unknown[] }): Promise<string>;
  setCustomFields(id: string, customFields: unknown[]): Promise<void>;
  updateIssue(id: string, patch: { summary?: string; description?: string; state?: string }): Promise<ReadIssueResult>;
  applyCommand(id: string, query: string): Promise<void>;
  addComment(id: string, text: string): Promise<{ id: string; comment: { author: string | null; text: string } }>;
  logWorkItem(id: string, item: { minutes: number; text?: string; date?: number; type?: string | { id?: string; name?: string } }): Promise<any>;
  tags(): Promise<string[]>;
  users(): Promise<{ login: string; name: string; fullName: string }[]>;
  projectSchema(projectKey: string): Promise<{ name: string; type: string | null; values: string[] }[]>;
  assist(idReadable: string, query: string): Promise<{ description: string; error: boolean }[]>;
  applyCommands(idReadable: string, commands: { command: string }[]): Promise<void>;
  webUrl(idReadable: string): string;
}

export function createApi(options: CreateApiOptions): TrackpilotApi;
export function shapeIssue(issue: any): ShapedIssue;
export function shapeLinks(links: any[]): { type: string | null; direction: string | null; id: string | null }[];
export function shapeSchema(issue: any): { name: string; type: string | null; values: string[] }[];
export function fieldValue(cf: any): string | null;
export function renderOne(v: any): string | null;
