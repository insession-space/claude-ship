---
name: artifact-templates
description: Picks a design template for an Artifact by its purpose and builds the page from it: a plan or proposal becomes a landing page, a review becomes a technical report, an investigation becomes a report or a dashboard, shipped work becomes an implementation report. All templates share one dark-first base and a no-slop list, so pages stop looking machine-made. Use when making an Artifact from a plan, review, investigation, status check, or completion report, e.g. "make this proposal an Artifact", "put the review results in a report", "show the status as a dashboard", 「この企画を Artifact にして」「レビュー結果をレポートにして」「調査結果をダッシュボードで見せて」「状況をまとめて」, and when another skill (ship-session, code-review, issue-loop) asks for a template.
---

# artifact-templates: pick the page type by purpose

Pick one of five page types from the context, then build the Artifact from its skeleton in `DESIGN.md`.
The point is that the same kind of report always looks the same, and that no page looks machine-made.

## Use the user's language

Everything addressed to the user, and every string in the page, is in the user's language.

- **Decide the language in this order**: (1) Claude Code's `language` setting (`~/.claude/settings.local.json`, then `~/.claude/settings.json`), (2) the language of the user's most recent message, (3) English
- **In the user's language**: the `<title>`, the body, the `description` parameter, UI strings in the page (labels, pills, `alt`, captions), and questions you ask
- **Do not translate**: code, commands, paths, identifiers
- Put the code of the language you decided on the page wrapper (`lang="ja"` for Japanese, `lang="en"` for English)

## Step 1: Pick the type

| Context | Type id | Why this type |
|---|---|---|
| A proposal, plan, pitch, or direction the reader must decide on | `plan` | The reader acts on a decision, so the page leads with the proposal and ends with the decisions needed |
| Findings on code or a document (code review, security review, audit) | `review` | The reader works through findings one by one, so a table with locations carries the page |
| One question to answer (root cause, research, comparison of options) | `investigation-report` | The value is in the explanation: answer first, then evidence |
| A situation to grasp (status across many items, numbers against last period, what needs attention) | `investigation-dashboard` | The value is in scanning: key numbers and states before detail |
| Work that was shipped (goal, acceptance criteria, verification, before / after) | `implementation` | The reader checks status: what was agreed, what is done, what passed |

- **The user's explicit request wins.** "Make it a dashboard" means `investigation-dashboard`, even for a single question
- **Mixed purposes**: pick the type of the main purpose and put the rest in as sections of that type. A completion report with review findings is `implementation` with a review section
- **Investigation, report or dashboard**: if most of the page would be prose explaining why, use the report form. If most of it would be numbers or rows of items with states, use the dashboard form
- **No type fits** (a game, a tool, a one-off visual): do not force one. Follow `artifact-design` alone

## Step 2: Read only what you need

Load the `artifact-design` skill first (it holds the page contract). Then read from `DESIGN.md`, in the same directory as this file:

1. `## Shared base` (tokens, type, layout, language, Base CSS)
2. `## No-slop list`
3. The one `## Type: ...` section you picked

Do not read the other type sections.

## Step 3: Build from the skeleton

- Copy the skeleton for the type. Replace the `/* @base */` line with the Base CSS block, unchanged
- Replace every `{placeholder}` with real content. No placeholder text may remain
- Keep the required sections in order. Drop a section only when it has nothing to say, and say so in one line where it matters (for example "No visible change" instead of the before / after section)
- Add type-specific CSS only when the content needs it. Do not restyle the base
- Charts: load the `dataviz` skill; do not reuse the state colors as series colors

## Step 4: Check against the No-slop list, then publish

Before publishing, go through the No-slop list once, looking and writing both. The checks that catch the most:

- The `h1` states the conclusion, not the topic
- No gradients, no emoji, no shadows on content, no card around every section, no hairline under every row
- No split header, no three equal cards, no numbered eyebrows, at most one `·` per line
- No UI drawn with divs to fake a screenshot. A real image or nothing
- No stock phrases, no em or en dashes, no perfect-looking numbers you did not measure; numbers, names, and paths instead of adjectives
- The page ends on the next action or the open question, not on a summary
- For `plan`: the headline, sentence, and button fit in the first screen, and no layout repeats

Pass `description` (one sentence) and `icon` on the first publish, as the Artifact tool requires.

## Rules

- **`DESIGN.md` is the single source of truth.** Other skills refer to it; they do not copy the templates
- **This skill fills in the treatment; `artifact-design` holds the contract.** When they seem to conflict on the contract (CDN, size, skeleton), `artifact-design` wins
- **Do not put secret values in the page** (including masked or partial forms)
