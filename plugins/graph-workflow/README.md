English | [日本語](README.ja.md)

# graph-workflow

A graph engineering plugin that decomposes a task into a **graph of nodes and edges** and runs it deterministically in parallel with Claude Code's Workflow tool.

The agent's freedom is confined inside the nodes (single-responsibility sub-agents), and flow control (branching, loops, merging) is bound by code.

## Install

```bash
claude plugin marketplace add insession-space/claude-ship
claude plugin install graph-workflow@claude-ship
```

## Use

```
Audit every API handler in this repository as a graph, from three angles: correctness, security, and performance
```

It starts on phrases like "run this as a graph", "run a workflow for this", or "review/migrate/investigate in parallel". Questions and reports come in your language (Claude Code's `language` setting, or else the language you write in).

## What happens

```
Phase 0  Fitness check and scouting — decide whether it suits a graph, and enumerate the work list itself
   ↓
Phase 1  Graph design — present a mermaid diagram + scale estimate (approval only when delegated, large, or writing)
   ↓
Phase 2  Write and run the script — follow the workflow-authoring conventions, structure with schema, and run
   ↓
Phase 3  Integrate and report results — reconcile the counts, note runId / scriptPath, and report
   ↓
Phase 4  (on failure) Resume — fix the script and resume. Unchanged nodes return from the cache
```

## Design philosophy

- **Approval is conditional.** If you asked in your own words to run it as a graph, it is read-only, and it uses 15 agents or fewer, it shows the diagram and scale and then **runs without asking** (that request itself is the opt-in for Workflow). It asks for approval with `AskUserQuestion` only when delegated from another skill, over 15 agents, or involving writes
- **pipeline is the default; barriers are the exception.** Wait with `parallel` only when a stage needs all results from the previous stage
- **Graphing is not the goal.** For exploratory tasks or tasks one agent can handle, it honestly says they don't suit a graph and proposes the normal approach

## Relationship to ship-session

This is an independent plugin and works on its own. It is also designed to be called by delegation from the multi-lens review and bulk-application steps of ship-session (in the same marketplace). The dependency always points **ship-session → graph-workflow**.
