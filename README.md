# Loopboard

A Claude Code plugin that closes the loop between conversation and work:

1. **Gather**: it pulls recent Slack discussions and Jira issues.
2. **Board**: it lays them out on a Miro board, along with Claude's synthesis: themes, decisions, open questions and proposed tickets.
3. **Export**: once the team has reviewed and edited the board, it turns the board's cards and stickies into Jira issues.

Loopboard grew out of the Miro Sync sidebar app. The React panel and the Next.js OAuth routes are gone. The Slack and Miro clients, the mappers, and the layout and colour logic now run as an MCP server bundled with the plugin. Jira replaces Google Drive as both a source and the export target.

## Structure

```
loopboard/
├── .claude-plugin/
│   ├── plugin.json          # Manifest and credential options (userConfig)
│   ├── icon.png             # Placeholder listing icon
│   └── marketplace.json     # Lets this folder be added as a local marketplace
├── .mcp.json                # Starts the bundled MCP server with the credentials
├── skills/
│   ├── gather/SKILL.md          # /loopboard:gather
│   ├── export-to-jira/SKILL.md  # /loopboard:export-to-jira
│   └── setup/SKILL.md           # /loopboard:setup
├── dist/server.js           # Bundled MCP server (built from src/, committed)
├── src/                     # MCP server source
│   ├── server.ts            # Tool definitions
│   ├── config.ts            # Reads credentials from the environment
│   ├── lib/                 # Slack, Jira and Miro REST clients, ADF conversion
│   ├── lib/mappers/         # Pure data → board / board → issue mappings
│   └── utils/               # Layout, colours, text conversion
└── test/                    # Unit tests for the mappers and converters
```

## Commands

| Command | What it does |
| :- | :- |
| `/loopboard:gather [#channel ...] [jql:"..." \| PROJECT] [board] [days]` | Reads the sources, synthesises them, and adds frames to the board |
| `/loopboard:export-to-jira [board] [frame] [PROJECT] [type]` | Previews the frame's items as issues, then creates them once you confirm |
| `/loopboard:setup [slack\|jira\|miro]` | Checks each connection and explains how to fix the ones that aren't working |

Claude also picks the skills up from plain requests, such as "pull last week's #support into our triage board" or "turn the Proposed tickets frame into Jira tasks in PROJ".

## MCP tools

| Tool | Reads/writes | Purpose |
| :- | :- | :- |
| `loopboard_status` | read | Which credentials are configured, and whether each one works |
| `slack_list_channels` | read | Channels the token can see |
| `slack_get_messages` | read | A channel's messages for a window, with names resolved and threads optional |
| `slack_import_to_miro` | write (Miro) | A frame of stickies, one per message |
| `jira_list_projects` | read | Project keys and their issue types |
| `jira_search_issues` | read | JQL results with descriptions and comments as plain text |
| `jira_import_to_miro` | write (Miro) | A frame of cards, one per issue |
| `miro_list_boards` / `miro_list_frames` | read | Find a board or frame |
| `miro_get_frame_items` | read | A frame's items as plain text, in reading order |
| `miro_create_frame` | write (Miro) | A frame of cards and stickies from Claude's synthesis |
| `jira_export_frame` | write (Jira, Miro) | Frame items → Jira issues. It defaults to a dry run |

## Installation

Requirements: Claude Code and Node.js 18 or later. The server is bundled into `dist/server.js`, so it needs no `npm install` to run.

```bash
claude plugin marketplace add ~/Desktop/loopboard
claude plugin install loopboard@loopboard
```

Or run it for one session without installing:

```bash
claude --plugin-dir ~/Desktop/loopboard
```

## Configuration

When the plugin is enabled, Claude Code asks for these options. Tokens are stored in the system keychain, never in `settings.json`. To change them later, open `/plugin`, select **loopboard**, and edit its options. Each service is optional: gathering needs Slack or Jira, the board needs Miro, and the export needs Jira and Miro.

| Option | Where to get it |
| :- | :- |
| Slack token | A Slack app at api.slack.com/apps with the user scopes `channels:read`, `channels:history` and `users:read`, plus `groups:read` and `groups:history` for private channels. Install it and copy the `xoxp-` token |
| Miro access token | A Miro developer app with `boards:read` and `boards:write`. Use **Install app and get OAuth token** |
| Jira site URL, email, API token | https://id.atlassian.com/manage-profile/security/api-tokens |

`/loopboard:setup` walks through each one and tests it.

## How content is mapped

**Slack → Miro.** Each channel gets a frame named `💬 #channel (last N days)`. It holds one sticky per message: the author in bold, then the text with mentions and links made readable. Each author gets a consistent colour, laid out in a 5-column grid in chronological order. Thread replies (optional) follow their parent and are marked `↳`. A frame holds at most 200 messages.

**Jira → Miro.** The JQL results go in a frame named `🎫 Jira: {label}`, with one card per issue. The card title is `KEY: summary`. The description holds the status, type, priority, assignee, a description excerpt, the latest three comments, and a link to the issue. The cards sit in a 4-column grid, up to 100 issues.

**Synthesis → Miro.** Claude writes a frame of theme, decision and question stickies, plus a frame of proposed-ticket cards.

**Miro → Jira.** The frame's items are read top to bottom, then left to right.

- **Cards**: the title becomes the summary and the description becomes the description.
- **Stickies**: the first line becomes the summary and the full text becomes the description. A leading `@name` line, as the Slack import writes, becomes "Raised by @name".
- **Every issue** gets a link back to its board item in the description.

Items whose text starts with an issue key are already in Jira, so they are skipped. That covers imported Jira cards and items exported earlier. After creating an issue, the export writes its key onto the board item, so running the export again never creates duplicates.

New frames always go to the right of the existing ones, so imports never overlap anything already on the board.

## Development

```bash
npm install
npm test            # unit tests for mappers, layout and converters
npm run typecheck
npm run build       # rebuilds dist/server.js; commit the result
claude plugin validate .
```

## Constraints

- **Miro REST API v2** is used throughout, so it works on every plan. The Enterprise-only board export API is not used.
- **Rate limits**: requests are sequential and back off on 429 and 5xx responses, following `Retry-After`. Very large imports can take a minute.
- **Jira descriptions** are written as plain paragraphs in Atlassian Document Format. Projects whose create screen requires extra fields will reject the issue, and the export reports which issues failed and why.

## License

MIT. See [LICENSE](LICENSE).
