English | [日本語](README.ja.md)

# yomiyasu-gate

A Claude Code mod that checks the Japanese text the agent writes into pull requests, issues and commits with the [yomiyasu](https://github.com/nanaism/yomiyasu) linter, `yomiyasu_lint.py`, before the Bash tool runs the command. When the text breaks the rules, the mod stops the command and sends the offending lines and their kinds back to the agent, which rewrites the text and runs the same command again.

## Install

```bash
claude plugin marketplace add insession-space/claude-ship
claude plugin install yomiyasu-gate@claude-ship
```

It loads after Claude Code restarts. The mod is the hooks module named under `modules` in `hooks/hooks.json` (`hooks/gate.ts`); a Claude Code without mods does not load it, and nothing happens.

The linter ships with the yomiyasu plugin. Without it, the mod lets every command through unchecked.

```bash
claude plugin marketplace add nanaism/yomiyasu
claude plugin install yomiyasu@yomiyasu
```

## Commands it checks

| Command | Where the text comes from |
| --- | --- |
| `gh pr create` / `gh pr edit` / `gh pr comment` | `--body` / `-b` / `--body-file` / `-F` |
| `gh issue create` / `gh issue edit` / `gh issue comment` | `--body` / `-b` / `--body-file` / `-F` |
| `git commit` | `-m` (several are joined as paragraphs) / `--message` / `-F` / `--file` |

`--body-file -` and `-F -` read the heredoc or here-string on the same line. A command substitution of the form `--body "$(cat <<'EOF' ... EOF)"` is read as the text too. Commands joined with `&&` or `;` are checked one by one.

The mod lets the command through unchecked when:

- the text holds `$VAR` or another command substitution, so it is not known until the command runs
- the `--body-file` file cannot be read
- the text has no kana or kanji (English text is not checked)

## Lines left out

Before handing the text to the linter, the mod blanks these lines, so line numbers still match the linter's findings:

- the `🤖 Generated with [Claude Code](https://claude.com/claude-code)` line at the end of a PR body, and a line holding only `https://claude.ai/code/session_...`
- a commit's `Co-Authored-By:` and `Claude-Session:` lines

## When it sends a command back

From the linter's `--json` findings the mod drops the ignored rules and scores the rest the linter's way: 100 minus 5 per warning and 2 per info. It sends the command back when either holds:

- there is a finding of a rule that always sends back (emoji and trailing colons by default)
- the score is below the threshold (80 by default)

The default of 80 comes from the PR bodies recently merged in this repository, which score 85 to 100 with the space rule left out.

The warning about a space between Japanese and Latin text is ignored by default, since this repository and its owner's repositories write that space.

The reason lists up to 8 findings with the line number, the kind of rule and the line, the always-send-back rules first.

## Send-backs in a row

The mod counts how many times in a row the same agent's command of the same kind (`git commit`, `gh pr create`, ...) was sent back. Once the count reaches the limit (2 by default), the next run is let through whatever the result, with a toast, and the count starts over. A run that passes the check also starts the count over.

The count is per kind of command rather than per text, so that it also stops an agent that keeps editing the text a little and running again.

## Subagents

By default the mod checks subagents' commands too: delegated agents also create commits and pull requests, and what they write stays just as long. With `includeSubagents` set to `false` it checks the main agent's commands only.

## When the linter is missing or fails

The mod lets the command through and shows a toast once per session when:

- the linter is not found
- Python does not start, the linter exits non-zero, or its output is not JSON
- it does not finish within 10 seconds

A hook that throws midway also lets the command through.

## Options

Set them in `/config` or under `pluginConfigs["yomiyasu-gate"].options` in settings.

| Key | Default | Meaning |
| --- | --- | --- |
| `linterPath` | empty | Absolute path to `yomiyasu_lint.py`. Empty looks in `~/.claude/plugins/marketplaces/yomiyasu/skills/yomiyasu/scripts/`, then `~/.claude/plugins/marketplaces/yomiyasu/scripts/` |
| `python` | `python3` | The Python that runs the linter |
| `minScore` | `80` | Send back below this score |
| `hardRules` | `emoji_prohibited,trailing_colon` | Rules of which one finding sends back (comma-separated) |
| `ignoreRules` | `unnatural_halfwidth_space` | Rules left out (comma-separated) |
| `maxDenials` | `2` | Send-backs in a row before one run is let through; `0` for no limit |
| `includeSubagents` | `true` | Check subagents' commands too |

## Language

The reason and the toasts follow Claude Code's `language` setting, then the language of your latest prompt, then English.

## Out of scope

- rewriting the text automatically
- checking chat replies
- checking English text
- checking pull request and issue titles

## Tests

```bash
claude plugin validate plugins/yomiyasu-gate
claude plugin test plugins/yomiyasu-gate
```
