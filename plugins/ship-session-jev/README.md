English | [日本語](README.ja.md)

# ship-session-jev

An add-on to [`ship-session`](../ship-session/README.md) that lets **Jev**, TypeSafe AI's System One model, decide the goal (Issue only / implementation only / up to PR / up to merge) from the request itself. When Jev is confident, **the Phase 0 question is skipped**; when it is not — or when Jev is not available at all — everything works exactly like `ship-session`.

- **Fully optional.** Without `TYPESAFE_API_KEY` the hook never makes a request
- **Fail-open.** Network failure, timeout, 4xx/5xx, or a malformed response all fall back to the usual question. Your work is never blocked
- **Only the goal.** Jev classifies intent and nothing else. Verification (exit codes), acceptance criteria, and review are untouched

## Install

`ship-session-jev` delegates the Issue, the implementation loop, and the review to the `ship-session` plugin's skills, so **install both**.

```bash
claude plugin marketplace add insession-space/claude-ship
claude plugin install ship-session@claude-ship
claude plugin install ship-session-jev@claude-ship
```

Then put your TypeSafe API key where Claude Code's hooks can see it: either in the shell you launch Claude Code from, or in the `env` block of `~/.claude/settings.json`. Restart Claude Code and it is ready to use.

## Usage

```
/ship-session-jev:ship-session-jev Add a dark mode toggle to settings. Make a PR.
```

The text after the command is what Jev reads. If it states how far to go ("make a PR", "up to merge", "just an Issue"), Jev records the goal and the agent goes straight to creating the Issue, telling you in one line which goal it chose. If it does not, or Jev is unsure, you get the same goal question `ship-session` asks.

The original `/ship-session:ship-session` keeps working unchanged next to this plugin.

## What happens

```
/ship-session-jev:… <request>   ──►  UserPromptSubmit hook   ─┐
  (you type the command)                                       ├─► the request goes to Jev (once, ≤ 800 ms)
"ship this with Jev" in prose   ──►  agent calls Skill tool    │
                                     ──► PreToolUse hook      ─┘
                 │
                 ├─ confident (≥ 0.85) and one of the 4 goals ──► goal recorded, gate open
                 │                                                (slash command: the agent is told so in context)
                 └─ otherwise ──► gate armed as usual
                                       │
Phase 0  Agent reads the context line / runs ship-goal.sh status ┘
         goal set?  yes → tell the user in one line, go on
                    no  → ask once (same question as ship-session)
   ↓
Phase 1  ship-session:create-issue
   ↓
Phase 2  ship-session:issue-loop
   ↓
Phase 3  Offer next options
```

## Automating Phase 0 with Jev (optional)

### Configuration

Everything is read from environment variables by the hook (`hooks/jev.py`). Claude Code passes its own environment to hooks, so `env` in `~/.claude/settings.json` works as well as your shell.

| Variable | Default | Meaning |
| --- | --- | --- |
| `TYPESAFE_API_KEY` | — | **Required to enable.** Absent or empty → Jev is never called |
| `SHIP_JEV_ENABLED` | `1` | Set to `0` / `false` / `no` / `off` to switch Jev off while keeping the key |
| `SHIP_JEV_THRESHOLD` | `0.85` | Minimum confidence to record the goal without asking. Values outside 0–1 or unparsable fall back to the default |
| `SHIP_JEV_TIMEOUT_MS` | `800` | Wall-clock budget for the whole request, capped at `5000` (the hook itself is killed by Claude Code at 10 s). On timeout the hook gives up and the usual question is asked |
| `SHIP_JEV_ENDPOINT` | `https://api.typesafe.ai/v1/systemone` | Override for proxies or tests |

The defaults are constants at the top of `hooks/jev.py`.

### What is sent

One Choice question, following the [TypeSafe API reference](https://docs.typesafe.ai/api). `state` is the text you typed after the slash command (or, when the agent invoked the skill itself, the `args` it passed) — verbatim.

```json
{
  "model": "jev-latest",
  "state": "<your request>",
  "questions": {
    "goal": {
      "type": "choice",
      "instructions": "How far does the user explicitly ask this task to be taken? Pick unspecified when the message does not state how far to go.",
      "criteria": {
        "issue_only":     "Only write a GitHub Issue; no implementation",
        "implementation": "Implement and commit, but do not open a pull request",
        "up_to_pr":       "Implement and open a (draft) pull request; do not merge",
        "up_to_merge":    "Implement, open a pull request, and merge it",
        "unspecified":    "The message does not say how far to go"
      }
    }
  }
}
```

The four goals map 1:1 to `ship-session`'s canonical labels (`Issue only` / `Implementation only (no PR)` / `Up to PR` / `Up to merge`). `unspecified` is the "none of the above" option the TypeSafe docs recommend; when it wins, the hook never records a goal, no matter how confident Jev is.

### When it falls back to the question

| Situation | Result |
| --- | --- |
| No `TYPESAFE_API_KEY`, `SHIP_JEV_ENABLED=0`, or empty `args` | Jev is not called |
| `SHIP_JEV_ENDPOINT` is not `https://` (plain `http://` is allowed only for loopback hosts) | Jev is not called — the key is never sent in clear text |
| `unspecified` is the answer | Ask |
| Confidence below the threshold | Ask |
| Connection error, timeout, 3xx (redirects are never followed), 401 / 422 / 429 / 5xx / 529 | Ask (no retry) |
| Body is not JSON, has no `answers.goal`, `choice` / `confidence` have the wrong type, `choice` is not one of the five criteria, or `confidence` is outside 0–1 (including `NaN` / `Infinity`) | Ask |
| The same request text is submitted again as a slash command | Jev is not called again; the current state is repeated to the agent as context |
| The agent re-invokes the skill with the `Skill` tool after the first classification | Jev is not called again and nothing is printed; the agent reads `ship-goal.sh status` |
| The user types the slash command again with a *different* request in the same session | Treated as a new task: Jev is called again and the previous goal is not carried over |

Proxies: for `https://` endpoints the hook honours `https_proxy` / `HTTPS_PROXY` from the environment (the key travels inside TLS). It never reads macOS system proxy settings, and never sends a plain `http://` (loopback) request through a proxy.

The hook itself keeps `ship-session`'s fail-open rule: if anything in it breaks, the tool call passes through.

### Changing what Jev decided

Jev's decision is a normal goal record. Say "actually, Issue only" and the agent runs `hooks/ship-goal.sh record "Issue only"`, exactly as it would after a manual decision; if the agent asks the goal question anyway, your answer overrides Jev's record too. `hooks/ship-goal.sh status` shows both the current goal and what Jev said:

```
goal: Up to PR
jev: decided the goal (up_to_pr, confidence 0.93)
```

After you override it, the second line keeps the history:

```
goal: Issue only
jev: decided Up to PR but the goal was changed afterwards (up_to_pr, confidence 0.93)
```

When Jev did not decide, it says why (`jev: could not decide (low_confidence, up_to_pr, confidence 0.61)` / `jev: not called (no_api_key)`).

### Log

Every attempt appends one line to `~/.claude/cache/ship-gate-jev/jev.log`:

```
2026-09-22T10:35:00+0900 pid=12345 result=recorded choice=up_to_pr confidence=0.93 elapsed_ms=412
2026-09-22T10:36:00+0900 pid=12346 result=fallback reason=low_confidence choice=up_to_pr confidence=0.61 elapsed_ms=380
2026-09-22T10:37:00+0900 pid=12347 result=fallback reason=http_429 elapsed_ms=120
2026-09-22T10:38:00+0900 pid=12348 result=skipped reason=no_api_key elapsed_ms=0
```

The API key, the request body, the response body, and your request text are **never** written to the log or to the gate's state file (`~/.claude/cache/ship-gate-jev/<pid>.json`).

## Living next to ship-session

- The gate hook here reacts only to `ship-session-jev` (the slash command and the `Skill` tool); `ship-session`'s hook reacts only to `ship-session`. Each keeps its own state directory (`ship-gate-jev/` vs `ship-gate/`), so the two never share or overwrite a decision
- Session renaming (the `UserPromptSubmit` reminder) stays with `ship-session`; this plugin's own `UserPromptSubmit` hook only watches for its slash command and stays silent otherwise
- This plugin ships no `create-issue` / `issue-loop` / `code-review` of its own. It calls `ship-session:create-issue` and `ship-session:issue-loop`, so without `ship-session` installed the skill stops at Phase 1

## Tests

```bash
plugins/ship-session-jev/tests/jev_test.sh     # every branch against a local mock server (no network)
plugins/ship-session-jev/tests/gate_test.sh    # the gate itself, same checks as ship-session
plugins/ship-session-jev/tests/skills_test.sh  # SKILL.md / README / manifest structure
plugins/ship-session-jev/tests/run_all.sh      # all of the above plus ship-session's and graph-workflow's suites
```

The tests use a throwaway `HOME` and a dummy key, and assert that the key never shows up in the log or the output.

## License

MIT
