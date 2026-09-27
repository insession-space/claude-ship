# Which page type each completion report uses

The completion reports of `ship-session` / `ship-session-jev` / `issue-loop` / `code-review` / `create-issue` are built from the page types of the `artifact-templates` plugin.
This file only maps each report to a type. The types themselves (layout, required sections, skeletons, no-slop list) live in that plugin's `DESIGN.md`; **do not copy them here**.

## Mapping

| Report | Type id |
|---|---|
| `ship-session` / `ship-session-jev` completion report | `implementation` |
| `issue-loop` completion report | `implementation` |
| `code-review` findings | `review` |
| `create-issue` summary of decisions | `investigation-report` |

If one report mixes purposes (for example an implementation report that carries review findings), keep the type of the skill writing it and put the rest in as a section.

## When `artifact-templates` is installed

Load the `artifact-templates` skill and build the page from the type above. Its rules (dark-first base, no-slop list, user's language) apply.

## When it is not installed

Do not recreate the templates. Build the page with the `artifact-design` skill alone, and use the report's own "must include" list (in each skill's Completion report section) as the section order.
Even then, keep these from the no-slop idea, since they cost nothing:

- The `h1` states the conclusion (`指摘2件、うち1件はマージ前に直す`), not the topic (`コードレビュー結果`)
- Numbers, paths, and exit codes instead of adjectives
- No gradients, no emoji section markers, no stock phrases
