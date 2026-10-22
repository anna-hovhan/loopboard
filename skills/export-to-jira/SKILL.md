---
name: export-to-jira
description: Export the cards and sticky notes in a Miro frame to Jira as issues, previewing them first and creating them only after the user confirms. Use when the user runs /loopboard:export-to-jira or asks to turn a Miro frame, board section, proposed tickets or retro actions into Jira issues or tickets.
argument-hint: "[board URL] [frame title or ID] [PROJECT] [issue type]"
allowed-tools: [mcp__plugin_loopboard_loopboard__loopboard_status, mcp__plugin_loopboard_loopboard__miro_list_boards, mcp__plugin_loopboard_loopboard__miro_list_frames, mcp__plugin_loopboard_loopboard__miro_get_frame_items, mcp__plugin_loopboard_loopboard__jira_list_projects]
---

# Export a Miro frame to Jira

The user asked: $ARGUMENTS

This is the second half of the loop: Miro → Jira. Creating issues is visible to the whole team and is not undone by this plugin, so **never create issues without the user's explicit confirmation of the preview.**

## 1. Work out the inputs

- **Board**: a Miro board URL or ID.
- **Frame**: a frame title, frame ID, or item link. A unique partial title works.
- **Project**: a Jira project key.
- **Issue type**: default `Task`.
- **Labels**: optional, applied to every issue. Suggest `loopboard` so the issues can be found later.
- **Item types**: cards and sticky notes by default. Add `text` or `shape` only if the user asks.

If anything required is missing, use `miro_list_frames` and `jira_list_projects` to offer choices, and ask once with all the questions together. Use `jira_list_projects` to check that the issue type exists in the project. If it doesn't, offer the project's types.

## 2. Preview (dry run)

Call `jira_export_frame` with `dry_run: true`. Show:

- A numbered table with columns #, summary, item type, and the first line of the description.
- The skipped items, grouped by reason. Items already in Jira (with their key) are expected. The rest only need a count.
- The target: project, issue type and labels.

If the summaries need work (vague, too long, duplicated), say so. Offer to tighten them on the board or to skip those items. Don't rewrite them silently: the board is the source of truth.

## 3. Confirm

Ask the user to choose one of:

- create all,
- create a subset (by number),
- or change the project, type or labels.

Wait for a clear yes.

## 4. Create

Call `jira_export_frame` with `dry_run: false`. Pass `item_ids` when the user picked a subset, and keep `mark_on_board: true` so each item gets its new key written on it. This stops a second export from duplicating the issue.

## 5. Report

- The issues created, as `KEY: summary` linked to the issue `url`.
- Any failures, with the Jira error explained in plain words. A field required by the project's create screen is the usual cause; suggest a different issue type or ask which values to use.
- Any item that was created but not marked on the board, so the user knows to add the key by hand.
