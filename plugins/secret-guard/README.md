English | [日本語](README.ja.md)

# secret-guard

A Claude Code mod that replaces secret-shaped strings with `[redacted:<kind>]` before they are kept in the conversation. It covers two places: your prompt, before it is sent, and the model's response, before it is stored and sent back with the next request.

A command hook that scans Bash commands and staged diffs cannot see what you paste into the prompt or what the model writes in its reply. This mod covers those two places.

## Install

```bash
claude plugin marketplace add insession-space/claude-ship
claude plugin install secret-guard@claude-ship
```

Restart Claude Code to load it. The mod is the hooks module listed under `modules` in `hooks/hooks.json` (`hooks/guard.ts`). A Claude Code build without mods does not read that module, so nothing happens there.

## What it does

### Your prompt

When you submit a prompt, the mod replaces each secret-shaped string with `[redacted:<kind>]` before the prompt enters the session. The model, the transcript file and the user message on screen all get the redacted text. The mod then shows a toast with the number of strings and their kinds, for example:

```
secret-guard: redacted 1 secret-shaped string before sending (google). Consider rotating it.
```

The toast never contains the value itself. The mod treats a pasted value as exposed and suggests rotating it, because the value has already left your clipboard.

Prompts that do not come from you (a background task's notification, a peer session's message, a scheduled prompt) are redacted the same way.

### The model's response

When the model's response is about to be stored (`session.append`, door `response`), the mod redacts the text blocks of that row. This covers the main conversation and every subagent. Thinking blocks and tool calls are kept as they are, because the engine puts them back unchanged. The mod shows no toast for a response.

## What it detects

Only shapes with a known prefix, to keep false positives low. There is no generic "high-entropy string" detection.

| Kind | Shape |
| --- | --- |
| `github` | `ghp_` / `gho_` / `ghu_` / `ghs_` / `ghr_` followed by 36 or more letters and digits, `github_pat_` followed by 70 or more characters |
| `anthropic` | `sk-ant-` followed by 32 or more characters |
| `openai` | `sk-proj-` followed by 32 or more characters; `sk-` followed by 32 or more characters that include upper case, lower case and digits |
| `google` | `AIza` followed by exactly 35 characters |
| `aws` | `AKIA` / `ASIA` followed by exactly 16 upper-case letters and digits |
| `slack` | `xoxa-` / `xoxb-` / `xoxp-` / `xoxr-` / `xoxs-` followed by digits, `-` and 8 or more characters |
| `stripe` | `sk_live_` / `rk_live_` followed by 16 or more letters and digits |
| `private-key` | a PEM block from `-----BEGIN ... PRIVATE KEY-----` to `-----END ... PRIVATE KEY-----`, or a block cut before its END line (the header and the base64 lines after it) |

A match must not be glued to a preceding letter or digit (`disk-...` is not an `sk-` key). A PEM block whose body has no base64 run of 16 characters or more (an example with `...` in it) is left alone.

## Limitations

- **Text already shown while streaming.** The screen draws the model's response as it streams. The mod rewrites the response row when it is stored, after the stream. The engine's own description of `session.append` says the screen, an SDK stream or Remote Control may show the row just before its rewrite. So characters already drawn while streaming are not hidden by this mod. What the model reads afterwards and what the transcript file keeps are the redacted form. Rewriting the stream itself (`turn.step`) is a different mechanism and this mod does not do it.
- **Tool calls the model writes.** A value the model puts into a tool call's arguments (a Bash command, a file to write) stays as it is. The engine puts every `tool_use` block of a response row back unchanged, so a `session.append` hook cannot rewrite it, and rewriting it would also change what the tool runs.
- **Tool results are not redacted.** See below.
- **Prompt history.** The mod rewrites the prompt at `prompt.submit`. Whether the prompt history you reach with the up arrow keeps the text you typed is not stated by the API, so do not rely on this mod for that.
- **Shapes not in the table.** A Gemini key created in Google AI Studio has the `AIza` shape and is covered. Other providers' keys, passwords and tokens without a known prefix are not.

## What it does not redact

- **Tool results (door `tool-result`).** The mod leaves them alone, for these reasons:
  - The screen draws a tool result from its structured record (`toolUseResult`), which the engine stores as made, beside the row. Redacting the row's text would not remove the value from the screen or from the transcript file.
  - The model would read `[redacted:...]` in place of the real file contents. It could then write the placeholder back into a file, or fail to match an `Edit`, which changes how the agent works.
  - When the model copies a value from a tool result into its reply, that reply is redacted.
- Secrets sent to outside services, files being written, and rotating keys are out of scope.

## When something fails

- If checking your prompt fails, the mod does not send it, and shows the reason in place of the prompt. Send it again.
- If redacting a response fails, the mod replaces each text block of that row with `[redacted:secret-guard-error]`, so the unchecked text is not stored.

## Display language

The `language` setting of Claude Code first, then the language of your latest prompt, then English.

## Tests

```bash
claude plugin validate plugins/secret-guard
claude plugin test plugins/secret-guard
```

The test values are fake. Strings with a real prefix are put together at run time from two halves, so the source never holds a key-shaped literal.
