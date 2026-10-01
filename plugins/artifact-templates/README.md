English | [日本語](README.ja.md)

# artifact-templates

When making an Artifact, **pick the page type from its purpose** and build it from that type's skeleton. The same kind of report always looks the same, and pages avoid the look and wording of machine-made output.

## Install

```bash
claude plugin marketplace add insession-space/claude-ship
claude plugin install artifact-templates@claude-ship
```

## Use

```
Make this proposal an Artifact
Put the review results in a report
Show the status of each service as a dashboard
```

Pages are written in your language (Claude Code's `language` setting, otherwise the language you wrote in, otherwise English).

## Types

| Type | When | Shape |
|---|---|---|
| `plan` | Proposals, plans, directions the reader must decide on | Landing page. The proposal in one sentence first, the decisions needed last |
| `review` | Code review, security review, audit findings | Technical report. A table of severity and `file:line` carries the page |
| `investigation-report` | Root cause, comparison: one question to answer | Report. Answer, evidence with sources, ruled out, still unknown |
| `investigation-dashboard` | Status across many items, numbers against last period | Dashboard. Key numbers, needs attention, full table |
| `implementation` | Reporting shipped work | Goal, acceptance criteria, verification exit codes, before / after |

## Design notes

- **`DESIGN.md` is the single source of truth.** It holds the shared base (tokens, type, layout, Base CSS), the no-slop list, and the five skeletons. Other skills refer to it and never copy it
- **Dark by default.** Pages are dark whatever the OS setting; light applies only when the viewer picks it (`data-theme="light"`)
- **A working-document look.** Blue-grey ground, one indigo accent, IBM Plex Sans JP. Spacing, not cards and shadows. `plan` is a real landing page: headline, sentence, and button in the first screen, a real image full-width below
- **No slop.** Drawing on [taste-skill](https://github.com/Leonxlnx/taste-skill): no gradients, emoji, cards around everything, three equal cards, split headers, hairlines under every row, numbered labels, div-drawn fake screenshots, stock phrases, dashes, or perfect-looking numbers nobody measured. Headings state conclusions; numbers and names replace adjectives
- **Works with the `artifact-design` skill**, which holds the page contract (CDN, size, theming). This plugin only adds the per-purpose types
- **No type fits** (games, tools): no template is forced
- **Japanese text follows [yomiyasu](https://github.com/nanaism/yomiyasu)** when it is installed (`claude plugin marketplace add nanaism/yomiyasu`, then `claude plugin install yomiyasu@yomiyasu`). For Japanese sentences it wins over the `### Writing` list

## Relation to ship-session

When this plugin is installed, `ship-session`'s completion reports (shipped work, review findings, Issue decisions) use the matching type. `ship-session` works without it.

## Verify

```bash
plugins/artifact-templates/tests/skill_test.sh
plugins/artifact-templates/tests/build_skeletons.sh <out-dir>   # assemble the skeletons into openable HTML
```
