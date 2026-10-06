English | [日本語](README.ja.md)

# acceptance-progress

A Claude Code mod that shows, above the prompt, the progress of the acceptance criteria and checklists in the GitHub issue you are working on. You can see how many criteria are done and which remain without opening the issue page.

## Install

```bash
claude plugin marketplace add insession-space/claude-ship
claude plugin install acceptance-progress@claude-ship
```

Restart Claude Code and it loads. The mod is the hooks module named under `modules` in `hooks/hooks.json` (`hooks/acceptance.tsx`). A Claude Code without mods support does not load that module, so nothing happens there. The mod reads issue bodies with `gh`, so run `gh auth login` first.

## What it shows

When the agent touches an issue that has a checklist with `gh`, a band appears above the prompt.

```
╭──────────────────────────────────────────────────────────────────────────╮
│ #33 Show progress on screen     Acceptance criteria ████░░░░ 2/6 │
│ ○ claude plugin test passes                                              │
│ ○ listed in the README                                                   │
│ ○ existing tests stay green                                              │
│ 1 more                                                                   │
│ Open questions 0/2                                                       │
╰──────────────────────────────────────────────────────────────────────────╯
```

- The first row is the issue number and title, then the progress bar and count of the acceptance criteria. A long title is cut at the end
- Then up to three acceptance criteria that are not done yet. The rest are folded into "N more"
- When everything is done, "All done" replaces the list
- Checklists under other headings (`## Open questions` and the like) get one last row with each heading and its count
- When other mods also draw a band above the prompt (ship-session's progress band, agent-cast), the bands stack

### Which checklist counts as the acceptance criteria

A checklist under a heading `Acceptance criteria` / `Definition of done` / `受け入れ条件` / `受入条件` / `完了条件` counts as the acceptance criteria, and so do the checklists under its subheadings (`### Functional` and the like). When no heading matches, every checklist in the body counts. Items are lines starting with `- [ ]` / `* [ ]` / `1. [ ]`, ticked with `[x]` or `[X]`; lines inside code fences and HTML comments are not counted.

## When it reads the issue again

When the main agent's command succeeds, the mod reads that issue's body back from GitHub with `gh issue view --json`:

- `gh issue view <N>` / `gh issue edit <N>` / `gh issue comment <N>` (`-R owner/repo` and issue URLs are read too)
- `gh issue create` (the issue at the URL it prints)

It shows the last issue touched. ship-session's issue-loop ticks each acceptance criterion in the body as soon as it verifies it, so the count moves forward each time.

It neither reads again nor switches the band for:

- any `gh` command a subagent runs (so the band does not jump whenever a delegate reads a related issue). Boxes a subagent ticks show up with `/acceptance`
- `gh issue view` with no number (the form that infers it from the branch)
- a command with no `-R` and no URL that runs `cd` or sets `GH_REPO` before `gh` (it is unknown which repository the number belongs to)
- `gh` on the second line or later (such as a heredoc's text), and a `-R` that is not `owner/repo`

It does not poll. A box someone ticks on GitHub directly shows up the next time the issue is touched, or with `/acceptance`.

## Command

| Command | What it does |
| --- | --- |
| `/acceptance` | Read the shown issue again |
| `/acceptance 42` / `/acceptance owner/repo#42` / `/acceptance <issue URL>` | Show that issue |
| `/acceptance off` | Hide the band |
| `/acceptance on` | Bring the band back |

## When something fails

- `gh` is missing, not logged in, or the network fails: the previous band stays, marked "refresh failed". The same goes for a failed switch to another issue, so the band shows it is no longer current
- The issue does not exist or you cannot see it: the band goes away
- The issue has no checklist: nothing is shown

The body's text is only displayed; it is never read as a command or a setting.

## Language

Taken from Claude Code's `language` setting, then the language of your latest message, then English.

## Not covered

- Tickets other than GitHub issues, such as Notion pages
- Checklists in PR bodies
- Showing several issues at once

## Tests

```bash
claude plugin validate plugins/acceptance-progress
claude plugin test plugins/acceptance-progress
```
