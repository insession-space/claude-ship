---
name: graph-workflow
description: Decomposes a task into a graph of nodes and edges and runs it deterministically in parallel with the Workflow tool (graph engineering). Shows the graph design first and gets approval, runs it, and on failure or interruption resumes from where it stopped. Use when the user says things like "run this as a graph", "fan this out", "run a workflow for this", or "audit/review/migrate/investigate in parallel" (in Japanese 「グラフで回して」「workflow で回して」「ファンアウトして」「並列で監査/レビュー/移行/調査して」), and when another skill (e.g. ship-session's multi-lens review) delegates parallel orchestration to it.
---

# graph-workflow — design → approve → run → resume

Turn the task into a **graph of nodes (single-responsibility sub-agents) and edges (control flow written in code)**, and run it deterministically with the Workflow tool. Keep the LLM's freedom confined inside the nodes, and bind the flow control with structure.

The flow has four phases. **Do not call Workflow until the user approves** if any of the approval conditions in Phase 1 apply.

---

## Use the user's language

**Everything addressed to the user is in the user's language.** The canonical labels in this skill are English — translate them when you ask or report.

- **In the user's language**: `AskUserQuestion` `question` / `header` / option `label` and `description`, including the recommended marker (`(Recommended)` in English, `（推奨）` in Japanese); the graph design shown for approval (mermaid node labels may stay short English identifiers, but the explanations are in the user's language); progress updates; reports; Artifacts (`<title>`, body, `description`, and UI strings inside the page)
- **Decide the language in this order**: (1) Claude Code's `language` setting (`~/.claude/settings.local.json`, then `~/.claude/settings.json`), (2) the language of the user's most recent message, (3) English
- **Do not translate**: code, commands, paths, identifiers, or the `result:` / `needs input:` / `failed:` prefixes (only the headline after them is translated). Prompts sent to workflow sub-agents may be in English; the findings you report to the user are in the user's language
- **GitHub Issues, PRs, and commit messages** follow the repository's existing language convention; when there is none, use the user's language

## Phase 0: Fitness check and scouting

### 1. Decide whether the task suits a graph

**Suits a graph**: routine work whose work list can be enumerated (auditing every file, a bulk migration, a review split by lens, a multi-directional investigation), cross-checking independent viewpoints (judge panel, adversarial verification), or a scale that doesn't fit in one context.

**Doesn't suit a graph**: exploratory work where the shape of the task isn't known up front (investigating a bug you've never seen), only 1–2 targets that one agent can handle, or a dependency chain that can only proceed sequentially.

If you judge it doesn't suit a graph, **say so honestly**, propose the normal approach (inline or a single sub-agent), and stop. Graphing is a cost, not a goal.

### 2. Scout inline

**Enumerate the work list (files, PRs, lenses, targets) that flows into the graph yourself.** The targets only need to be fixed before orchestration; you don't need to know the shape of the whole task up front.

- **Don't hand a sub-agent both "find them and process them".** The search scope drifts and leaves holes (same reason as issue-loop's delegation guardrail)
- **Note the count** you enumerated. Later, reconcile it against the row count of the results

## Phase 1: Graph design and approval

### Design principles

- **Each node has one responsibility.** Keep its prompt and its verification small. Structure its output with a `schema` (JSON Schema); don't accept prose
- **pipeline is the default.** Use a barrier (`parallel`, waiting for all results) **only when a later stage needs all of the earlier stage's results at once**, e.g. "deduplicate across all results" or "skip the later stage if there are 0 results"
- **Write edges in code.** Make branches, loops, and exit conditions JS `if` / `while`, not instructions inside a prompt
- Pick quality patterns to fit the task: adversarial verify / judge panel / loop-until-dry / multi-modal sweep
- Aim for **15 agents or fewer**. Go beyond that only when the user has explicitly asked for that scale

### Presenting the design (always)

Once the design is settled, **always present it before running** (even when you skip the approval question — never run it silently):

1. **Graph diagram** (mermaid) — in a form that shows the nodes, edges, cycles (loops), and where the barriers are
2. Each node's responsibility and the gist of its output schema (one line each)
3. **Scale estimate** — number of agents, number of phases, and a rough sense of weight

### Approval gate (conditional)

Decide whether to ask the approval question as follows. **Questions cost the user, so ask only when these conditions require it.**

**You may run without asking** (when all three hold):

- The user asked **in their own words** to run it as a graph/workflow ("run this as a graph", "audit this with a workflow", etc.) — that utterance itself is the opt-in for the Workflow tool
- **Read-only** — no node writes to files, the repository, or external state (investigation, review, audit)
- **15 agents or fewer**

**Get approval with `AskUserQuestion`** (when any one applies; `header: "Approval"`, options **Run this graph (Recommended)** / Change the design / Don't run as a graph):

- You were **launched via delegation** from another skill (ship-session, etc.) — agreement with the caller is not agreement to run the graph
- The scale is **more than 15 agents**
- A node **involves writes** (bulk application, migration, edits that include commits)

If "Change the design" is chosen, revise it and present it again.

## Phase 2: Writing and running the script

1. **Always read the `workflow-authoring` skill first** (it is the source of truth for the script API, the `meta` constraints, and the resume conventions)
2. Script discipline
   - `meta` is a pure literal. Keep `phases` consistent with `phase()`
   - Pass a `schema` to every node, and drop skipped/dead ones with `.filter(Boolean)`
   - If you decide to cut coverage (top-N, sampling), **make it visible with `log()`**. Don't thin things out silently
   - `Date.now()` / `Math.random()` are not allowed (they break resume). Pass times in through args
3. **Do not bake secret values into prompts.** A node's prompt is the only context each sub-agent gets, but have secrets handled by name reference or through env files
4. The run happens in the background. **Always note the `runId` and `scriptPath` from the tool result** (the keys for Phase 4)

## Phase 3: Integrating and reporting results

- When the completion notification arrives, integrate the results. **For empty or unexpected results, read `<transcriptDir>/journal.jsonl` before guessing** (it records each node's actual return value)
- **Reconcile the row count of the results against the count you noted in Phase 0.** If it falls short, don't say "done" until you've found out why
- The report must include: a summary of the graph run / the number of targets and the number processed / skipped or failed nodes and why / `runId` and `scriptPath` (the keys to resume)

## Phase 4: Resume (on failure or interruption)

Don't start over. **Unchanged nodes return instantly from the cache.**

1. Identify the nodes that failed or that you want to fix (journal.jsonl)
2. Fix the file at `scriptPath` with Edit
3. Re-run with `Workflow({scriptPath, resumeFromRunId})`. Only the edited call and those after it actually run

---

## Rules

- **When an approval condition applies (launched via delegation, more than 15 agents, writes involved), do not call Workflow without approval.** You may skip the question only when all three conditions hold, and even then do not skip presenting the diagram and the scale
- **Ask the user questions with `AskUserQuestion` (multiple choice) by default.** Put the recommended option first, and bundle independent questions into one call
- **Don't make graphing the goal.** Say so when a task doesn't suit a graph
- Never put **secret values** in the chat, the script, or node prompts

## Completion signal

**First, determine whether there is a caller.**

**When called from another skill (ship-session / issue-loop, etc.), do not write `result:`.** Report the outcome (integrated results, runId, scriptPath) and return to the caller. If a human is needed, start a line with `needs input:`; if it is structurally impossible, start a line with `failed:`, and return (write these two even when there is a caller).

**When launched on its own**, close with `result:` on its own line followed by a self-contained one-line headline. **Do not end the final turn with a tool call.**
