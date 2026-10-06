English | [日本語](README.ja.md)

# session-dashboard

A Claude Code mod that shows the current session at a glance in one pane: what needs attention, ship-session and acceptance progress, the current branch's PR, and the servers and containers started in this session. It also blocks Bash calls that mass-kill processes or containers, which would stop other sessions' work too.

## Install

```bash
claude plugin marketplace add insession-space/claude-ship
claude plugin install session-dashboard@claude-ship
```

Restart Claude Code and it loads. The mod is the hooks module named under `modules` in `hooks/hooks.json` (`hooks/dashboard.tsx`). A Claude Code without mods support does not load that module, so nothing happens there. The mod reads the PR with `gh`, so run `gh auth login` first.

## Open and close

Run `/dashboard` to open the pane and run it again to close it. In fullscreen it docks beside the transcript; otherwise it sits above the prompt.

Once you open it, the mod reopens it when the next session starts. Claude Code draws a pane opened that way only when the terminal is at least 110 columns wide. If you close it with the pane's close mark or `/dashboard`, it is not reopened.

## What it shows

Four sections, stacked from top to bottom:

```
╭ Needs attention 3 ──────────────────────────────────────╮
│ ✖ CI failed  test (ubuntu-latest)                       │
│ ● 1 unresolved review thread                            │
│ ○ listed in the README                                  │
╰─────────────────────────────────────────────────────────╯
╭ Session ────────────────────────────────────────────────╮
│ ship-session  Implementation loop · round 2  goal PR    │
│ #33 ████████░░░░ 4/6  Show progress                     │
╰─────────────────────────────────────────────────────────╯
╭ PR ─────────────────────────────────────────────────────╮
│ #34 draft Show the acceptance progress of the issue…    │
│  ✔ 3   ✖ 1   ● 1   Changes requested · unresolved 1     │
│ 2 open PRs awaiting your review                         │
╰─────────────────────────────────────────────────────────╯
╭ Running 2 ──────────────────────────────────────────────╮
│ :5173   node              12m                           │
│ docker  app-db            12m                           │
╰─────────────────────────────────────────────────────────╯
```

- **Needs attention**: names of failed CI checks, the number of unresolved review threads, and acceptance criteria not yet done (up to 3). The section is hidden when there is nothing in it
- **Session**: ship-session's phase, review round and goal, and the acceptance progress of the issue acceptance-progress shows. The section is hidden when neither value exists
- **PR**: the current branch's PR number, draft flag and title, the counts of passed, failed and pending CI checks (as colored pills), the review decision and the number of unresolved threads. The last row counts the open PRs where you are a requested reviewer
  - For a merged or closed PR it shows only the state, without the CI and review row and without attention items
  - On a branch with no PR it shows "No PR"
- **Running**: listening ports (`lsof -nP -iTCP -sTCP:LISTEN`) and docker containers (`docker ps`) that appeared after the session started, with how long they have been up. Anything that existed before the session started is left out

Long titles and items are cut at the end, so rows stay intact at the docked pane width (about 66 columns).

## When it refreshes

| What | When |
| --- | --- |
| PR and CI | At session start, when you open the pane, and after a Bash call containing `git push` or `gh pr`. Every 60 seconds only while CI checks are pending |
| Running servers and containers | After each Bash call, every 30 seconds, when you open the pane, and at the end of each turn |
| Session values | Whenever ship-session or acceptance-progress change them (read on every draw) |

A PR refresh is one `gh pr view`, one GraphQL query for unresolved threads and one search for review requests. Nothing is polled while no CI check is pending.

## Leftover servers and containers

At the end of a turn, if servers or containers started in this session are still running, the mod shows a toast. It does not repeat while the set stays the same, and shows it again when something new appears.

A toast at session end (`session.end`) was tried and does not show: after `/exit` the terminal leaves fullscreen and the screen is gone before the toast is drawn. So the reminder is only given at the end of a turn.

## Mass-kill guard

The mod blocks these shapes of agent Bash calls and returns, as the reason, examples of stopping by port or name.

| Blocked | Examples in the reason |
| --- | --- |
| `pkill -f ...` / `pkill --full ...` | `lsof -ti :5173 \| xargs kill`, `kill 12345` |
| `killall ...` | same |
| `docker stop $(docker ps -q)` / `docker ps -q \| xargs docker stop` (also `kill` / `rm`) | `docker stop app-db`, `docker compose down` |

`kill <PID>`, `pkill vite` (without `-f`), `docker stop <name>` and a `docker ps -q` narrowed with `--filter` pass. If the guard's hook fails, the call goes through.

## Decisions taken

- **Other plugins**: ship-session and acceptance-progress are not listed under `dependencies` in `plugin.json`, so installing session-dashboard alone does not install them. Their values are read with `$.state.get`; a row is hidden when the plugin is not installed or its value is null. Their type contracts (`PluginState`) are not redeclared; `hooks/dashboard.tsx` narrows only the shape it reads
- **Existing bands**: the bands ship-session and acceptance-progress draw above the prompt stay as they are
- **Surfaces**: the pane is built from `Box` and `Text` only, so it draws in the terminal and in the desktop app's Code tab

## Language

Taken from Claude Code's `language` setting, then the language of your latest message, then English.

## Out of scope

- Actions from the pane, such as merging a PR or rerunning CI
- Keeping the ledger across sessions
- Details of PRs other than the current branch's

## Tests

```bash
claude plugin validate plugins/session-dashboard
claude plugin test plugins/session-dashboard
```
