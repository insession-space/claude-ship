English | [日本語](README.ja.md)

# claude-ship

A marketplace of plugins for Claude Code. Multiple plugins are managed in this single repository.

The plugins write questions, reports, and Artifacts in the user's language (Claude Code's `language` setting, or else the language of the user's latest message).

## Install

```bash
claude plugin marketplace add insession-space/claude-ship
claude plugin install ship-session@claude-ship
```

Restart Claude Code and it is ready to use.

## Included plugins

| Plugin | What it does | Docs |
| --- | --- | --- |
| `ship-session` | Turns a request into a GitHub Issue and implements it in the same session until every acceptance criterion is met, verification is green, and code review has zero findings | [plugins/ship-session](plugins/ship-session/README.md) |
| `ship-session-jev` | Add-on to `ship-session`: lets Jev (TypeSafe AI) decide the goal from the request and skip the Phase 0 question when confident. Optional and fail-open; without `TYPESAFE_API_KEY` it behaves like `ship-session`. Requires `ship-session` | [plugins/ship-session-jev](plugins/ship-session-jev/README.md) |
| `graph-workflow` | Breaks a task down into a graph of nodes and edges and runs it deterministically in parallel with the Workflow tool (design → approval → run → resume) | [plugins/graph-workflow](plugins/graph-workflow/README.md) |
| `artifact-templates` | Picks an Artifact design template by purpose (plan → landing page, review → technical report, investigation → report or dashboard, shipped work → implementation report), with one dark-first base and a no-slop list | [plugins/artifact-templates](plugins/artifact-templates/README.md) |
| `agent-cast` | A mod that, while subagents and teammates run, shows one row per agent above the prompt (character face, type, task, current tool, elapsed time) and lines their faces up at the head of the spinner line. Each agent type has its own face | [plugins/agent-cast](plugins/agent-cast/README.md) |
| `acceptance-progress` | A mod that reads the checklists back from the GitHub issue the agent touched with gh, and shows above the prompt how many acceptance criteria are done and which remain | [plugins/acceptance-progress](plugins/acceptance-progress/README.md) |
| `secret-guard` | A mod that replaces secret-shaped strings (API keys with a known prefix, PEM private keys) with `[redacted:<kind>]` in your prompt before it is sent and in the model's response before it is stored, and suggests rotating a key you pasted | [plugins/secret-guard](plugins/secret-guard/README.md) |
| `yomiyasu-gate` | A mod that checks the Japanese text the agent writes into PR and issue bodies and commit messages with the yomiyasu linter before the Bash tool runs the command, and sends it back with the offending lines when it breaks the rules. Without the linter it lets everything through | [plugins/yomiyasu-gate](plugins/yomiyasu-gate/README.md) |
| `session-dashboard` | A mod that shows the session at a glance in one pane (what needs attention, ship-session and acceptance progress, the current branch's PR with CI and review, servers and containers started in this session) and blocks mass-kill commands such as `pkill -f` | [plugins/session-dashboard](plugins/session-dashboard/README.md) |

## Repository layout

```
.claude-plugin/marketplace.json   Marketplace definition (list of plugins)
plugins/<name>/                   Each plugin
  .claude-plugin/plugin.json      Plugin manifest
  SKILL.md / skills/ / hooks/     Skills and hooks
  tests/                          Tests
```

To add a plugin, create `plugins/<name>/` and add an entry to the `plugins` array in `marketplace.json`. Each plugin's version is managed independently in its own `plugin.json`.

## License

MIT
