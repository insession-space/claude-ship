---
name: session-naming
description: Rename the session to a concise name in the user's display language. Claude Code's automatic names are always English kebab-case, so rename once, as soon as the topic is clear, to make sessions easy to tell apart in the list. Use when the user says "name this session", "rename this session", 「セッション名を付けて」, or 「名前を日本語にして」, and when you receive the UserPromptSubmit reminder (additional context starting with [セッション名] / [Session name]).
---

# session-naming — rename the session in the display language

Session names that Claude Code assigns automatically are **always English kebab-case** (the naming prompt
inside Claude Code embeds English examples such as `fix-login-bug`, so a language setting in
`~/.claude/CLAUDE.md` does not change them). When the list is full of mechanical names like
`skill-session-naming-japanese`, sessions are hard to tell apart. **This is not limited to working in Japanese** —
even when working in English, `Fix the login redirect` is easier to recognize than `fix-login-bug`.

**As soon as you have grasped the topic, rename the session yourself in the user's display language.**

## How

```bash
"${CLAUDE_PLUGIN_ROOT}/hooks/rename-session.sh" "セッション名の自動リネームを仕込む"
"${CLAUDE_PLUGIN_ROOT}/hooks/rename-session.sh" "Fix the login redirect"
```

- **When to name**: once, right after reading the user's request and the topic is settled, in the same turn as the first real work.
  Do not name before a request arrives or while the topic is still vague (it only leads to more renames).
- **Renaming**: if the topic changes substantially mid-conversation, you may run it again at that point.
  Do not change it for small detours.
- **Do not report it**: do not mention the naming in your report to the user (it is not a result of the work).

## How to write the name

- It should tell "what is being done" in one line. Do not include the repository or branch name; they appear in separate columns of the list.
- Do not use symbols, quotation marks, or emoji.
- The length limit is determined by character width. **Counting full-width as 2 and half-width as 1, anything beyond 40 columns**
  is truncated by the script.

| Display language | Style | Length |
|---|---|---|
| Japanese | Noun-ending phrase (体言止め) | 10–20 full-width characters |
| Latin-script languages | Short noun phrase, not a sentence | 20–40 characters |

| Good | Bad |
|---|---|
| ホーム画面のセッション選択を直す | fix-home-session-nav |
| リリース手順の署名検証を通す | 作業 |
| Fix the login redirect | fix-login-bug |
| Sign the release build | Work on some things |
| セッション名の自動リネームを仕込む | session-desk のセッション名まわりの調査と実装 (too long) |

## What the script touches

`hooks/rename-session.sh` resolves its own session's pid and rewrites the following.

- `name` / `nameSource: "user"` in `~/.claude/jobs/<jobId>/state.json`
  (**this is the only thing it rewrites**. Lists such as Session Desk read this value)
- `~/.claude/cache/session-renamed/<pid>` (a marker that the session has been renamed, so the reminder hook does not prompt again)

`~/.claude/sessions/<pid>.json` is **only read** to look up the `jobId`; it is not rewritten.

The pid is taken from `CLAUDE_CODE_MESSAGING_SOCKET` (`/tmp/cc-socks/<pid>.sock`); if that is absent, the script walks up
the parent processes looking for `claude`.

## When it does not work

In the following cases the script stops with exit code 1 and the reminder hook outputs nothing (none of these are errors).

- The session is not a background job (there is no corresponding `jobs/<jobId>`)
- `state.json` has not been written yet / is corrupted
- A user-derived name is already set (`nameSource: "user"`, or the renamed marker exists)

The reminder hook reads the display language from `language` in `~/.claude/settings.local.json` → `~/.claude/settings.json`,
then `AppleLocale` if neither has it. **If none of them decides it, it prompts as English** (it does not stay silent).
The hook cannot see the conversation, which is why it falls back to `AppleLocale`.

**The name itself follows `../_shared/user-language.md`** (the `language` setting → the language of the user's most recent
message → English), the same order used for questions and reports. When no `language` is set and the user writes in a
language different from `AppleLocale`, name the session in the language the user writes in, even if the reminder names
another language.
