---
name: gather
description: Gather recent communication from Slack channels and Jira issues, synthesise it into themes and proposed tickets, and lay it out on a Miro board. Use when the user runs /loopboard:gather or asks to pull, collect, import or summarise Slack discussions or Jira tickets onto a Miro board, or to prepare a board for triage, a retro or planning.
argument-hint: "[#channel ...] [jql:\"...\" | PROJECT] [board URL] [days]"
allowed-tools: [mcp__plugin_loopboard_loopboard__loopboard_status, mcp__plugin_loopboard_loopboard__slack_list_channels, mcp__plugin_loopboard_loopboard__slack_get_messages, mcp__plugin_loopboard_loopboard__jira_list_projects, mcp__plugin_loopboard_loopboard__jira_search_issues, mcp__plugin_loopboard_loopboard__miro_list_boards, mcp__plugin_loopboard_loopboard__miro_list_frames, mcp__plugin_loopboard_loopboard__miro_get_frame_items]
---

# Gather communication onto a Miro board

The user asked: $ARGUMENTS

This is the first half of the loop: Slack and Jira → Miro. The second half is `/loopboard:export-to-jira`.

## 1. Work out the inputs

From the arguments and the conversation, settle:

- **Slack channels**: `#names`, channel IDs, or channel links. Zero or more.
- **Jira scope**: a JQL query, or a project key. For a project key, use `project = KEY AND updated >= -{days}d ORDER BY updated DESC`. Optional.
- **Board**: a Miro board URL or ID. Required.
- **Window**: days back, default 7.
- **Mode**: `full` (the default) puts both the raw source frames and the synthesis on the board. `summary` puts only the synthesis there, and `raw` only the source frames.

At least one Slack channel or a Jira scope is required. If the board or every source is missing, ask once, with all the missing questions together. Offer `miro_list_boards`, `slack_list_channels` or `jira_list_projects` results so the user can pick. If a tool reports "Not configured", stop and point the user to `/loopboard:setup`.

## 2. Read the sources

- For each channel, call `slack_get_messages` (threads included).
- For the Jira scope, call `jira_search_issues`.

Note any result marked `truncated`, so it can be reported at the end.

## 3. Synthesise

Read everything and produce:

- **Themes**: 3 to 8 recurring topics. Each has a short title and one or two sentences of evidence naming who said what, where.
- **Decisions**: what was agreed, and by whom.
- **Open questions**: unresolved points, with the person best placed to answer each.
- **Proposed tickets**: concrete follow-up work. Each has an imperative summary of 100 characters or less and a description with context, acceptance hints if the discussion gives them, and its sources (Slack: `#channel, date, @author`; Jira: issue key).

Rules for the synthesis:

- Use only what the sources say. Don't invent owners, dates or requirements.
- Before proposing a ticket, check the Jira issues you read. If one already covers it, mention that key under the related theme instead of proposing a duplicate.
- Keep the people's own wording for decisions and questions where it is short.

## 4. Put it on the board

Every call adds a new frame to the right of the existing ones. Nothing already on the board is changed.

Raw frames (modes `full` and `raw`):

- For each channel, call `slack_import_to_miro`. This makes one sticky per message, colored by author.
- For the Jira scope, call `jira_import_to_miro`. This makes one card per issue, and the issue key in each title stops it from being exported again.

Synthesis frames (modes `full` and `summary`), via `miro_create_frame`:

1. `🧭 Themes: {sources}, last {days} days`: one `sticky` per theme. Use `light_green` for themes, `orange` for open questions and `cyan` for decisions, putting decisions and questions in the same frame after the themes.
2. `✅ Proposed tickets: {sources}`: one `card` per proposed ticket. The title is the summary and the body is the description with sources. Skip this frame if there are no proposed tickets.

## 5. Report

Reply with:

- A link to each frame created (`frameUrl`), with its item count.
- The synthesis in brief: themes, decisions and open questions as short bullets.
- Anything truncated, or any channel or search that returned nothing.
- The next step: the team reviews and edits the **Proposed tickets** frame on the board, deleting or rewording cards and adding stickies. Then `/loopboard:export-to-jira {board} "Proposed tickets" {PROJECT}` creates the issues.
