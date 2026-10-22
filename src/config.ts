/**
 * Credentials arrive as environment variables that .mcp.json fills from the
 * plugin's userConfig. An option the user never set can arrive empty or as the
 * unsubstituted `${user_config.KEY}` placeholder, so both count as missing.
 */

export class ConfigError extends Error {}

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  if (!value || value.startsWith('${')) return undefined;
  return value;
}

const SETUP_HINT = 'Run /loopboard:setup to see how to configure it.';

export function slackToken(): string {
  const token = readEnv('LOOPBOARD_SLACK_TOKEN');
  if (!token) throw new ConfigError(`Slack token is not configured. ${SETUP_HINT}`);
  return token;
}

export function miroToken(): string {
  const token = readEnv('LOOPBOARD_MIRO_TOKEN');
  if (!token) throw new ConfigError(`Miro access token is not configured. ${SETUP_HINT}`);
  return token;
}

export interface JiraConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
}

export function jiraConfig(): JiraConfig {
  const rawUrl = readEnv('LOOPBOARD_JIRA_BASE_URL');
  const email = readEnv('LOOPBOARD_JIRA_EMAIL');
  const apiToken = readEnv('LOOPBOARD_JIRA_API_TOKEN');
  const missing = [
    !rawUrl && 'Jira site URL',
    !email && 'Jira email',
    !apiToken && 'Jira API token',
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new ConfigError(`${missing.join(', ')} not configured. ${SETUP_HINT}`);
  }
  return { baseUrl: normalizeBaseUrl(rawUrl!), email: email!, apiToken: apiToken! };
}

export function normalizeBaseUrl(url: string): string {
  const withScheme = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  return withScheme.replace(/\/+$/, '');
}

export function configuredServices() {
  return {
    slack: !!readEnv('LOOPBOARD_SLACK_TOKEN'),
    miro: !!readEnv('LOOPBOARD_MIRO_TOKEN'),
    jira:
      !!readEnv('LOOPBOARD_JIRA_BASE_URL') &&
      !!readEnv('LOOPBOARD_JIRA_EMAIL') &&
      !!readEnv('LOOPBOARD_JIRA_API_TOKEN'),
  };
}
