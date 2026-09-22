# Use the user's language

**Everything addressed to the user is written in the user's language.** The skills in this plugin are written in English, and so are the canonical labels in their tables (options, headers, report headings). Translate them when you output them.

- **Why**: an English example in a skill body leaks into output easily. Without this rule a Japanese user gets English questions, and an English user gets whatever language the examples happen to be in. The skill bodies stay in English so they read the same for every user and cost fewer tokens; this file is what keeps the output in the user's language.

## Decide the language

Check in this order and stop at the first one that decides it.

1. **Claude Code's `language` setting** — `~/.claude/settings.local.json`, then `~/.claude/settings.json`. This is the order Claude Code itself uses for its replies and the order the session-naming hook uses, so questions, replies, and session names never disagree
2. **The language of the user's most recent message** — if the message mixes languages, the one used for most of the prose (not code or quoted identifiers)
3. **English**, if neither of the above decides it

The `language` value is free-form: a language name (`日本語`, `Français`) or a code (`ja`, `ja-JP`) both count.

## Write these in the user's language

- **`AskUserQuestion`** — `question`, `header`, each option's `label` and `description`. The recommended marker too: `(Recommended)` in English, `（推奨）` in Japanese, and the natural equivalent in other languages
- **Artifacts** — the `<title>`, the body, the `description` parameter, and UI strings inside the page (button text, `aria-label`, captions)
- **Plain-text progress updates and completion reports**
- **The headline after a completion signal** (see below)

## Do not translate these

- Code, commands, file paths, identifiers, configuration keys, and label names such as `status: todo`
- **The signal prefixes `result:` / `needs input:` / `failed:`** — callers look for them literally. Only the headline after the prefix is in the user's language
- Quotes of what the user said

## GitHub Issues, pull requests, and commit messages

These live in the repository, not in the conversation. **Follow the repository's existing convention** — the language of existing Issues, PRs, and commits, and any rule in `CLAUDE.md` / `CONTRIBUTING.md`. Only when there is no clear convention, use the user's language.

## Phase 0 gate headers (ship-session only)

The Phase 0 gate hook (`hooks/ship-gate.py`) records the answer automatically when the question's `header` is one of `Goal`, `Approach`, `到達点`, or `進め方`. **If you asked in any other language, run `ship-goal.sh record "<answer>"` right after the user answers.** If you forget, the next tool call is blocked and the block message tells you to do exactly that.
