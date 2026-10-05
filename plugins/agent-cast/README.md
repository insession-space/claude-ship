English | [日本語](README.ja.md)

# agent-cast

A Claude Code mod that shows each running child agent (subagents started with the Agent tool, and teammates) as a character. Above the prompt and on the spinner line you can see how many agents are running, what role each has, and which tool each one is using right now.

## Install

```bash
claude plugin marketplace add insession-space/claude-ship
claude plugin install agent-cast@claude-ship
```

Restart Claude Code to load it. The mod is a hooks module (`hooks/cast-band.tsx`) listed under `modules` in `hooks/hooks.json`. A Claude Code version without mods does not read the module, so nothing happens there.

## What it shows

### Band above the prompt

While at least one child agent exists, a band above the prompt shows one row per agent.

```
╭─────────────────────────────────────────────────────────╮
│ Subagents: 3                                            │
│ (o.o) Explore  find the auth code        Read     12s   │
│ [-_-] Plan     plan the change           thinking  4s   │
│ (^_^) general-purpose read the diff      done     31s   │
╰─────────────────────────────────────────────────────────╯
```

Each row shows the face, the agent type, the description given to the Agent tool, the current state, and the elapsed seconds.

- The state is the tool name while a tool runs, and `thinking` otherwise
- A finished agent shows `done`, and its row goes away 5 seconds later
- If the main turn ends without a finish event for a foreground agent, that agent shows `interrupted` and goes away 5 seconds later. Background agents and teammates keep running after the main turn ends, so they stay
- With 6 or more agents, the band shows 5 rows and folds the rest into one `N more` row
- A long description is cut at the end to fit the width

When another mod, such as ship-session's progress band, also draws a band above the prompt, both are stacked vertically.

### Spinner line

While child agents run, the spinner text is replaced with their faces and a count. Up to 5 faces are shown, and the rest as `+N`. The elapsed time and token count stay as the engine draws them.

```
✻ (o.o) [-_-] 2 agents working… (12s · ↓ 2.1k tokens)
```

While the engine shows its own text (for example during compaction), that text is kept.

## Faces

Each agent type has a fixed face.

| Type | Face |
| --- | --- |
| `Explore` | `(o.o)` |
| `Plan` | `[-_-]` |
| `general-purpose` | `(^_^)` |
| `claude-code-guide` | `(?_?)` |
| `fork` | `(=_=)` |
| `teammate` | `(^o^)` |

Any other type, such as a plugin's agent, gets a spare face picked from a hash of its type name, so the same name always gets the same face. Agents of the same type running in parallel share a face; tell them apart by their descriptions.

## Language

It follows Claude Code's `language` setting, then the language of your latest message, then English.

## Where it appears

In the terminal and in the desktop app's Code tab. Only those two have a spinner line, so VS Code and mobile show the band alone.

## Not included

- Agents started by the Workflow tool (it is not yet confirmed that they go through `agent.spawn`)
- Swapping characters, or stopping an agent from the band

## Tests

```bash
claude plugin validate plugins/agent-cast
claude plugin test plugins/agent-cast
```
