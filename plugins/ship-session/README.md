English | [日本語](README.ja.md)

# claude-ship

A workflow plugin for Claude Code that turns a request into a GitHub Issue and implements it in the same session until **every acceptance criterion is met, verification is green, and code review has zero findings**.

Its defining trait is that it decides the **goal** (Issue only / implementation only / up to PR / up to merge) **once**, before starting, and **stops there**. No more "it got merged before I noticed," and no more "it created an Issue and left it at that."

## Install

```bash
claude plugin marketplace add insession-space/claude-ship
claude plugin install ship-session@claude-ship
```

Restart Claude Code and it is ready to use.

## Usage

```
/ship-session:ship-session Add a dark mode toggle to settings.
```

Or just ask in plain words and it starts.

```
ship this
```

Mention the goal along with the request, and it proceeds without asking about it.

```
/ship-session:ship-session Add a dark mode toggle to settings. Make a PR.
```

Each skill's `description` carries trigger examples in both English and Japanese, so asking in Japanese (for example, `この要望を ship して`) starts it the same way.

## What happens

```
Phase 0  Ask for the goal, once (Issue / implementation / PR / merge)
   ↓
Phase 1  create-issue — dig into requirements and spec, then create the Issue
   ↓
Phase 2  issue-loop  — repeat "implement → verify → review" until the stop conditions are met
   ↓
Phase 3  Offer next options based on where it stopped
```

There are four goal options: Up to PR (Recommended) / Up to merge / Implementation only (no PR) / Issue only. These are the canonical English labels defined in the skill, and they are shown translated into the user's language.

### Three stop conditions

1. **Every acceptance criterion** in the ticket is met
2. **Verification is green** (exit code 0; never judged by grepping the output)
3. **Zero review findings**

It loops until all three hold. If it hits the limit (5 rounds by default), it lists the remaining gaps and stops.

### Phase 0 is enforced by a hook

Phase 0 is not just an instruction in SKILL.md; **a hook enforces it mechanically**. (In past measurements, every session that ran Phase 0 reached the implementation loop, and every session that skipped it stalled silently partway through.)

1. Invoking ship-session makes the `PreToolUse` hook (`hooks/ship-gate.py`) set up a gate
2. Until the goal is recorded, every tool call other than `AskUserQuestion`, session renaming, and the recording script is **blocked, and the agent is told what to do instead** (reading files and investigating also come after the gate)
3. The goal is recorded in one of the following ways, which opens the gate
   - If the `AskUserQuestion` header is `Goal` / `Approach` (English) or `到達点` / `進め方` (Japanese), the hook **records the answer automatically**
   - If the question was asked in another language, or the user's message states the goal explicitly, the agent runs `hooks/ship-goal.sh record "<goal>"`. If it forgets, the message on the next blocked tool call tells it to

State is kept in `~/.claude/cache/ship-gate/<pid>.json`, and leftovers from a different session are never used as grounds for blocking. If the check itself fails, it **always lets the call through** (the gate is an added safeguard, not something that should stop the user's work). Sessions that do not use ship-session are left untouched.

## Speaks the user's language

The skill bodies are written in English, but **everything addressed to the user is written in the user's language**: `AskUserQuestion` questions and options, progress and completion reports, and Artifacts (title, body, and UI strings inside the page).

The language is decided by checking the following in order and using the first that decides it.

1. Claude Code's `language` setting (`~/.claude/settings.local.json` → `~/.claude/settings.json`)
2. The language of the user's latest message
3. English, if neither decides it

Code, commands, file paths, and the completion-signal prefixes `result:` / `needs input:` / `failed:` are not translated (callers look for them literally). GitHub Issues, pull requests, and commit messages follow the repository's existing convention (the language of existing Issues/PRs/commits, and any rule in `CLAUDE.md` / `CONTRIBUTING.md`); only when there is no convention are they written in the user's language.

The rule itself lives in [`skills/_shared/user-language.md`](skills/_shared/user-language.md).

## Renaming sessions in your display language

The session names Claude Code generates automatically are **always English kebab-case** (an English example like `fix-login-bug` is embedded in the built-in naming prompt, so specifying a language in `CLAUDE.md` does not change it). When the session list is full of mechanical names, you cannot tell sessions apart. This helps either way: if you work in Japanese, it fixes a list full of English; if you work in English, `Fix the login redirect` is still easier to read than `fix-login-bug`.

With this plugin installed, the following happens **even in ordinary sessions that do not use `/ship-session`**.

1. When you send your first prompt, a `UserPromptSubmit` hook runs, and if the session name is still auto-generated, it tells the agent to rename it in your display language
2. Once the agent has grasped what the request is about, it runs `hooks/rename-session.sh` exactly once
3. `name` in `~/.claude/jobs/<jobId>/state.json` becomes a name in your display language, and it shows up in lists such as Session Desk

**When it does nothing** (none of these are errors):

- The session already has a user-given name (`nameSource: "user"`, or a marker that it has already been renamed)
- The session is not a background job (there is no `state.json` to write to)
- The reminder count has reached its limit (3)

The display language is taken from `language` in `~/.claude/settings.local.json` → `~/.claude/settings.json`, falling back to `AppleLocale`. **If none of these decides it, the reminder assumes English** (it does not stay silent).

Only `name` / `nameSource` in `state.json` are rewritten. `~/.claude/sessions/<pid>.json` is **only read**, to look up the `jobId`, and never rewritten. Even if the hook crashes with an exception, it does not stop the prompt from being sent.

To rename a session by hand, just ask.

```
Rename this session to "Pass signature verification in the release steps"
```

## Included skills

| Skill | Role | Usable on its own |
| --- | --- | --- |
| `ship-session` | Agree on the goal → create the Issue → implementation loop → offer next actions | — |
| `create-issue` | Dig into requirements and spec and create an Issue (creation only) | ✔ |
| `issue-loop` | Iterate on implementing one ticket until the stop conditions are met | ✔ |
| `code-review` | Review a diff | ✔ |
| `session-naming` | Rename the session in the user's display language | ✔ |

`ship-session` delegates to the three skills below it. They also work on their own, so you can call them directly when you "just want an Issue" or "just want the diff reviewed."

## Requirements

- **`gh` CLI** is authenticated (used for Issue and PR operations)
- Used inside a git repository

The following are **used if available**; everything works without them.

- **External review CLI** (`codex` etc.) — if available, review and investigation are delegated to it to save tokens. Otherwise, multiple subagents with separate lenses are used instead (**it never falls back to a single read-through**)
- **Notion MCP** — if available, Notion pages can also be handled as tickets

### Verification commands are chosen automatically

It never hard-codes "this project's build command." **Reading the CI definitions (`.github/workflows/`) comes first**; if there are none, it decides from the shape of the repository.

| What it finds | Candidate verification commands |
| --- | --- |
| `package.json` | Read `scripts`. The package manager is determined from the lockfile |
| `Package.swift` | `swift build` / `swift test` |
| `go.mod` | `go build ./...` / `go test ./...` |
| `Cargo.toml` | `cargo build` / `cargo test` |
| `Gemfile` | `bundle exec rspec` etc. |
| `Makefile` | Actually look at the targets |

If it still cannot decide, it asks before entering the loop.

## Design principles

This plugin was built by working backward from patterns that actually failed.

- **Decide the goal first** — if it runs while "how far to go" is still vague, it goes all the way to merge when you wanted it to stop after creating the Issue
- **Do not cut the spec deep-dive short** — an Issue that merely reshapes a one-sentence request into "background + two lines of acceptance criteria" has not resolved its ambiguity, and that turns into back-and-forth during implementation. One round of digging prevents five rounds of implementation
- **Judge green by exit code** — searching the output for `error` reports failures as successes
- **Do not change information hierarchy nobody asked for** — the most expensive failure is not breaking during implementation but **getting reverted wholesale after merge**. Asking takes 30 seconds; a revert costs a full cycle
- **Do not fall back to a single-reader review** — when no external CLI is available, one agent reading everything alone loses coverage yet **gets reported just like a successful review**
- **Clean up what you created** — only the one who started a server, took a screenshot, or made a temporary worktree knows exactly what needs cleaning up

## License

MIT
