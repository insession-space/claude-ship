# Write Japanese with yomiyasu

When the language decided in `user-language.md` is Japanese (`日本語`, `ja`, `ja-JP`, and so on), write Japanese prose following the [`yomiyasu`](https://github.com/nanaism/yomiyasu) skill.

- **Why**: Japanese written by a model keeps the same habits: metaphor verbs (`壊れる`, `効く`, `倒す`), things acting as subjects, preambles like `重要なのは`, and bold or bullets everywhere. yomiyasu rewrites the sentence structure, not just the words, so a report reads as if a person wrote it.

## What it covers

- Artifact bodies (headings, paragraphs, table cells, captions)
- Progress updates and completion reports in chat
- Issue and pull request bodies, when they are written in Japanese

The trigger is the language of the text being written. A repository whose convention is English Issues gets English Issues, and yomiyasu does not apply to them.

## What it leaves alone

- Code, commands, file paths, identifiers, configuration keys, and label names such as `status: todo`
- Quotes of what the user said, and quotes from logs or error messages
- The signal prefixes `result:` / `needs input:` / `failed:`
- Attribution lines (`🤖 Generated with ...`, `Co-Authored-By: ...`). Keep them exactly as given, emoji included
- Short UI strings: `AskUserQuestion` labels and headers, buttons, pills
- Commit messages (a one-line summary is not the prose yomiyasu is for)

## How to use it

1. **Load the `yomiyasu` skill once per session, before the first Japanese prose you write.** Write in its style from the start. Do not write first and run a second rewriting pass
2. Keep every fact: numbers, exit codes, paths, and names stay as they are. yomiyasu forbids adding information, and so does this file
3. **Do not use another Japanese style skill alongside it** (for example `natural-japanese`). yomiyasu warns that similar skills interfere with each other. If both are enabled, follow yomiyasu only and do not load the other

When delegating Japanese writing to a subagent, say so in the prompt: "Load the `yomiyasu` skill and write the Japanese in its style." The subagent does not inherit this file.

## When it is not installed

If the skill cannot be loaded, do not stop. Write with these principles, which come from yomiyasu itself:

- Each sentence says who does what. Name the actor (`開発者`, `CI`, `このスクリプト`) instead of `これ` or `両者`
- Replace metaphor verbs with the actual operation or state change. `テストが壊れる` becomes `テストが失敗する`
- Drop preambles (`重要なのは`, `ポイントは`) and "not X but Y" framing. State the point directly
- No emoji, no colon at the end of a sentence, no bold or bullets used only for emphasis
- Aim for 30 to 45 characters per sentence and at most two `、` per sentence
