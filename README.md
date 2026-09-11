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
| `graph-workflow` | Breaks a task down into a graph of nodes and edges and runs it deterministically in parallel with the Workflow tool (design → approval → run → resume) | [plugins/graph-workflow](plugins/graph-workflow/README.md) |

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
