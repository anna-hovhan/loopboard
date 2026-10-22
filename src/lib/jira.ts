import type { JiraConfig } from '../config';
import { fetchWithRetry } from './http';
import { adfToText, textToAdf, type AdfNode } from './adf';

interface JiraRequestOptions {
  method?: string;
  body?: unknown;
}

async function jiraFetch<T>(config: JiraConfig, path: string, opts: JiraRequestOptions = {}): Promise<T> {
  const { method = 'GET', body } = opts;
  const credentials = Buffer.from(`${config.email}:${config.apiToken}`).toString('base64');

  const res = await fetchWithRetry(`${config.baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Basic ${credentials}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Jira API ${method} ${path} failed (${res.status}): ${errorText}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export function issueUrl(config: JiraConfig, key: string): string {
  return `${config.baseUrl}/browse/${key}`;
}

export async function getMyself(config: JiraConfig) {
  const me = await jiraFetch<{ accountId: string; displayName: string; emailAddress?: string }>(
    config, '/rest/api/3/myself'
  );
  return { accountId: me.accountId, displayName: me.displayName };
}

export interface JiraProject {
  key: string;
  name: string;
  issueTypes: string[];
}

export async function listProjects(config: JiraConfig, query?: string): Promise<JiraProject[]> {
  const params = new URLSearchParams({ expand: 'issueTypes', maxResults: '50' });
  if (query) params.set('query', query);

  const res = await jiraFetch<{
    values: Array<{ key: string; name: string; issueTypes?: Array<{ name: string; subtask?: boolean }> }>;
  }>(config, `/rest/api/3/project/search?${params}`);

  return res.values.map((project) => ({
    key: project.key,
    name: project.name,
    issueTypes: (project.issueTypes || []).filter((t) => !t.subtask).map((t) => t.name),
  }));
}

export interface JiraComment {
  author: string;
  created: string;
  body: string;
}

export interface JiraIssue {
  key: string;
  url: string;
  summary: string;
  issueType: string;
  status: string;
  priority?: string;
  assignee?: string;
  reporter?: string;
  labels: string[];
  created: string;
  updated: string;
  description: string;
  comments: JiraComment[];
  commentTotal: number;
}

interface RawIssue {
  key: string;
  fields: {
    summary?: string;
    issuetype?: { name?: string };
    status?: { name?: string };
    priority?: { name?: string };
    assignee?: { displayName?: string } | null;
    reporter?: { displayName?: string } | null;
    labels?: string[];
    created?: string;
    updated?: string;
    description?: AdfNode | null;
    comment?: {
      total?: number;
      comments?: Array<{ author?: { displayName?: string }; created?: string; body?: AdfNode }>;
    };
  };
}

const SEARCH_FIELDS = [
  'summary', 'issuetype', 'status', 'priority', 'assignee', 'reporter',
  'labels', 'created', 'updated', 'description', 'comment',
];

export async function searchIssues(
  config: JiraConfig,
  jql: string,
  maxResults = 50
): Promise<{ issues: JiraIssue[]; truncated: boolean }> {
  const issues: JiraIssue[] = [];
  let nextPageToken: string | undefined;
  let isLast = true;

  do {
    const res = await jiraFetch<{ issues: RawIssue[]; nextPageToken?: string; isLast?: boolean }>(
      config, '/rest/api/3/search/jql', {
        method: 'POST',
        body: {
          jql,
          fields: SEARCH_FIELDS,
          maxResults: Math.min(100, maxResults - issues.length),
          nextPageToken,
        },
      }
    );
    issues.push(...res.issues.map((raw) => toIssue(config, raw)));
    nextPageToken = res.nextPageToken;
    isLast = res.isLast ?? !nextPageToken;
  } while (!isLast && nextPageToken && issues.length < maxResults);

  return { issues: issues.slice(0, maxResults), truncated: !isLast };
}

function toIssue(config: JiraConfig, raw: RawIssue): JiraIssue {
  const f = raw.fields;
  const comments = (f.comment?.comments || []).map((c) => ({
    author: c.author?.displayName || 'unknown',
    created: c.created || '',
    body: adfToText(c.body),
  }));
  return {
    key: raw.key,
    url: issueUrl(config, raw.key),
    summary: f.summary || '',
    issueType: f.issuetype?.name || '',
    status: f.status?.name || '',
    priority: f.priority?.name,
    assignee: f.assignee?.displayName,
    reporter: f.reporter?.displayName,
    labels: f.labels || [],
    created: f.created || '',
    updated: f.updated || '',
    description: adfToText(f.description),
    comments,
    commentTotal: f.comment?.total ?? comments.length,
  };
}

export interface NewIssue {
  projectKey: string;
  issueType: string;
  summary: string;
  description: string;
  labels?: string[];
}

export async function createIssue(config: JiraConfig, issue: NewIssue) {
  const fields: Record<string, unknown> = {
    project: { key: issue.projectKey },
    issuetype: { name: issue.issueType },
    summary: issue.summary,
    description: textToAdf(issue.description),
  };
  if (issue.labels && issue.labels.length > 0) {
    fields.labels = issue.labels;
  }

  const res = await jiraFetch<{ id: string; key: string }>(config, '/rest/api/3/issue', {
    method: 'POST',
    body: { fields },
  });
  return { id: res.id, key: res.key, url: issueUrl(config, res.key) };
}
