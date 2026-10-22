---
name: setup
description: Check and fix loopboard's Slack, Jira and Miro connections. Use when the user runs /loopboard:setup, asks how to connect Slack, Jira or Miro to loopboard, or when a loopboard tool returns "Not configured" or an authentication error.
argument-hint: "[slack|jira|miro]"
allowed-tools: [mcp__plugin_loopboard_loopboard__loopboard_status]
---

# Loopboard setup

The user asked: $ARGUMENTS

Loopboard reads Slack and Jira and writes to Miro and Jira with credentials the user enters as plugin options. Claude Code asks for them when the plugin is enabled and keeps the tokens in the system keychain. To change them later, the user opens `/plugin`, selects **loopboard**, and edits its options, then restarts the session or runs `/reload-plugins` so the server picks them up.

Never ask the user to paste a token into the chat, and never write one to a file.

## Steps

1. Call `loopboard_status`. It reports, for each of Slack, Jira and Miro, whether the credential is configured and whether a live call with it succeeds.
2. Present a short table: service, state (working / not configured / failing), and the account or error.
3. For each service that is not working, and for the one named in the arguments if any, give only the matching instructions below. Each service is optional. Gathering needs Slack or Jira, the board needs Miro, and the export needs Jira and Miro.
4. When everything the user needs is working, suggest `/loopboard:gather` as the next step.

## Slack

1. Go to https://api.slack.com/apps, create an app from scratch, and pick the workspace.
2. Under **OAuth & Permissions → User Token Scopes**, add `channels:read`, `channels:history` and `users:read`. For private channels, also add `groups:read` and `groups:history`.
3. Click **Install to Workspace** and copy the **User OAuth Token** (`xoxp-…`).
4. Enter it as the **Slack token** option.

A user token can read every channel the user is in. A bot token (`xoxb-…`, with the same scopes under Bot Token Scopes) works too, but it only reads channels the bot has been invited to.

Common errors: `missing_scope` means a scope is missing, so add it and reinstall the app. `not_in_channel` means a bot token is being used, so invite the bot or switch to a user token.

## Miro

1. Go to https://developers.miro.com, open **Your apps**, and create a new app.
2. Under **Permissions**, enable `boards:read` and `boards:write`.
3. Click **Install app and get OAuth token**, pick the team, and copy the access token.
4. Enter it as the **Miro access token** option.

The token only works on boards in the team the app was installed to.

## Jira

1. Create an API token at https://id.atlassian.com/manage-profile/security/api-tokens.
2. Enter the **Jira site URL** (e.g. `https://your-company.atlassian.net`), the **Jira account email** the token belongs to, and the **Jira API token**.

A 401 error means the email and token don't match. A 403 or 404 on a project means the account lacks access to it.
