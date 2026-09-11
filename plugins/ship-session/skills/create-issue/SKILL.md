---
name: create-issue
description: Dig into the requirements and specification of a task or request, then create a GitHub Issue at a granularity that can be implemented (creation only; no implementation). Use when the user says "create an Issue for this", "turn this into a ticket with the requirements worked out", 「Issue を作って」「これを Issue 化して」「要件を詰めてチケットにして」, or similar. If the user wants it carried through implementation, use ship-session instead.
---

# create-issue — dig into requirements and specification, then create an Issue

Turn the user's request into **a GitHub Issue at a granularity where the implementer can start without asking back about the specification**.
Once the Issue is created, stop — no implementation, no branch creation.

**Overall approach**: agree on the goal → investigate the code only when needed → **dig into the specification (required)** → fill in the template → `gh issue create`.

**Digging in is not something to shortcut.** Taking a one-sentence request and reformatting it as "background + two lines of acceptance criteria" is this skill's failure pattern. The ambiguity has not gone away; it just turns into back-and-forth during implementation. **One round spent digging in prevents five rounds during implementation.**

---

## Phase 1: Pin down the requirements

### 0. Clarify the goal first (required)

Always put into words, and agree on, "the goal this Issue wants to achieve (whose problem, what problem, how it gets solved)". Do not move on to investigation or creation while it is vague.

- **Make it a choice whenever possible.** Draft 2–4 candidate goals inferred from the request and present them with `AskUserQuestion`. Put the one you think is most reasonable first, and append the recommended marker to its label ("(Recommended)" in English, "（推奨）" in Japanese).
- Even when the request states the goal outright in one sentence, **state the goal as you understood it in one line before proceeding**.
- The goal pinned down here becomes the foundation of the Issue body's "Background / goal" and its acceptance criteria.

### 1. Decide first whether investigation is needed

If the request is already concrete enough to implement (target files and behavior are clear, or it is a new independent feature whose hook point is obvious), **skip investigation** and go to Phase 1.5. **Do not skip digging in.**

Investigate only when the granularity cannot be settled without identifying hook points or reusable parts of the existing code.

### 2. Delegate the investigation

Delegate read-only investigation to an external CLI (`codex exec`, etc.) if one is available, otherwise to a read-only subagent. **Have it return only conclusions** (do not have it bring back file dumps).

Ask for exactly these 5 points, 1–3 lines each.

1. Hook points (`file:line`)
2. Existing functions / patterns that can be reused
3. Affected files
4. Conventions to follow (the repository's `CLAUDE.md`, etc.)
5. Concerns

If you run an external CLI in the background, add `< /dev/null` (without it, it hangs waiting on stdin). **Do not wait for completion with a foreground sleep loop.**

---

## Phase 1.5: Dig into the specification (required; do not shortcut)

Deciding the goal does not decide the specification. **Work through the aspects below one by one** before writing the body.

### Aspects to work through

You may drop an aspect after judging it "not applicable". **Do not skip one silently.**

1. **Main use cases / flows** — at least one "who, in what situation, does what, and what happens". Several if there are branches. If UI is involved, go down to screen transitions and the order of operations
2. **Input and output** — what it receives and what it returns / displays. Units, formats, limits
3. **Error cases / edge cases** — empty / 0 items / large volume / duplicates / no permission / network failure / concurrent operations. **Decide "what happens then" too**
4. **State and data** — whether it persists, where it lives, consistency with existing data, whether a migration is needed
5. **Target users / permissions** — who can see it and who cannot
6. **Interference with existing features** — does it coexist with a similar existing feature or replace it; existing behavior that could break
7. **Non-functional** — only when needed (performance, accessibility, i18n)
8. **Explicit out of scope** — **always** name at least one "thing not done this time". If you cannot, you have not narrowed the scope yet

### How to fill in each aspect (decide in this order)

- **(a) If you can decide it yourself, decide it.** Do not ask about things with a conventional default, things you can learn by reading the code, or things with only one answer. **Once decided, state it explicitly in the body as an "assumption"** (do not decide silently)
- **(b) If the answer changes the content of the Issue, ask.** Multiple choice via `AskUserQuestion`. **Bundle independent points into one call, up to 4 questions**
- **(c) If you cannot decide it and asking will not produce an answer now, leave it as an "open question".** Do not mix it into the acceptance criteria while it is still ambiguous

**At most 2 rounds of questions in total** (including the goal confirmation in Phase 1). Beyond that, either decide the rest as (a) assumptions or drop them into (c) open questions.

### Quality gate for acceptance criteria

Self-check before moving on to Phase 2.

- [ ] Is each criterion **verifiable by a third party** (no vague words like "works correctly" or "easy to use")?
- [ ] Besides the happy path, is **at least one of the error cases you identified** included in the criteria?
- [ ] Are the criteria **sufficient to meet the goal** (if meeting all of them still does not reach the goal, they are not enough)?
- [ ] Is **out of scope** stated explicitly, and do the criteria stay out of it?

If any item fails, go back to Phase 1.5.

---

## Phase 2: Create the Issue

### Shape of the body

**Always put what you worked through in Phase 1.5 into the body** (resolving it in your head and not writing it in the body is the most common omission).

The headings below are canonical English. Write the Issue in the repository's existing language convention (existing Issues, `CLAUDE.md`), and if there is no clear convention, in the user's language — see `../_shared/user-language.md`.

```markdown
## Background / goal
(whose problem, what problem, how it gets solved)

## Main use cases
- (in a situation where ..., the user does ... → ... happens)

## Requirements
### In scope
-
### Out of scope
-

## Specification
(input/output, state/data, target users and permissions, relationship to existing features. Write decisions in assertive form)

## Error cases / edge cases
- (case → behavior in that case)

## Assumptions (decided in this Issue)
- (add a one-line reason so the implementer can overturn it)

## Acceptance criteria
- [ ] (verifiable criterion. Include at least one error case)
```

You may drop a section entirely if nothing applies, but **always fill in "Main use cases", "Out of scope", and "Acceptance criteria"**.

- If there are open questions, add `## Open questions` and leave them in the form `- [ ] (point) — until this is decided, ... cannot be finalized`
- **Only if you investigated in Phase 1**, add "Implementation approach (hook point `file:line`)" and "Affected files". Do not write a speculative implementation approach for a request you did not investigate

### Filing

**The default is `--body-file`** (there are many sections and line breaks need formatting). Write to a temporary file, then file.

```bash
gh issue create --title "..." --body-file <path> --label "status: todo"
```

Use `--body "..."` only when the body fits in a few lines.

### Progress labels

Put `status: todo` on the Issue you filed. In repositories where the labels are not set up, create only the missing ones once (`--force` does not break existing ones).

```bash
gh label create "status: todo"        --color d4c5f9 --description "Filed, not started" --force
gh label create "status: in-progress" --color fbca04 --description "In progress" --force
gh label create "status: in-review"   --color 1d76db --description "PR open, awaiting review" --force
gh label create "status: blocked"     --color b60205 --description "Blocked, needs user input" --force
gh label create "status: done"        --color 0e8a16 --description "Done, merged" --force
```

Always relabel by "adding the new status + removing the old status", so that more than one `status:` label is never attached at the same time.

```bash
gh issue edit <N> --add-label "status: in-progress" --remove-label "status: todo"
```

Report the URL / number of the created Issue and you are done.

---

## Rules

- **Phase 1.5 must not be skipped.** "The request seems clear" is not a reason — what is clear is the goal; error cases, out of scope, and assumptions are not decided yet. You may omit individual aspects only when they do not apply; never skip the step itself
- **Digging in does not mean firing off questions.** Decide most things yourself and state them as "assumptions". Only put to the user "points whose answer changes the content of the Issue"
- **Ask the user questions via `AskUserQuestion` (multiple choice) by default.** 2–4 options, recommended first, independent points bundled into one call of up to 4 questions. Free-text questions in prose are allowed only when asking for a value itself (URL / ID / specific wording) and when only manual action will do, such as authentication
- **Write questions, reports, and Artifacts in the user's language.** Follow `../_shared/user-language.md`
- **This skill is complete once the Issue is created.** No implementation, branch creation, commits, push, or PRs. If the user wants it carried through implementation, point them to `ship-session` (when called from `ship-session` it also does not proceed to implementation, but **it does not end the turn; it returns to the caller**. See "Completion signal")
- **Do not put secret values in chat or the Issue body** (including masked or partial display)
- You may treat invoking this skill as approval to create the Issue. Do not perform any other outward-facing operation

## Completion report

If the work involved judgments, investigation, or trade-offs, publish the result as an **Artifact** and share it, written in the user's language. Items it must include:

- Number / URL / title of the created Issue
- Main use cases and acceptance criteria
- **Cases picked up as error cases**
- **Assumptions decided** and what was put out of scope
- Open questions (if any)

If you **only created one Issue** and no further explanation is needed, skip the Artifact and write it in plain text.

**If you include screenshots**, follow `../_shared/artifact-images.md` for how to embed them (**make them click-to-enlarge before publishing**).

## Completion signal

**First, determine whether there is a caller.** That decides how to close.

**When called from `ship-session`, do not write `result:`.** In that case this is the middle of a process, not the end of a turn — report the outcome (Issue number / URL, PR, review results, etc.) and **return to the caller so ship-session can continue with the next Phase**. Ending the turn after writing only text that announces the next Phase is the same stop, and does not count as a report.

**The stop signals are the same even when called from a caller.** If human action is needed, write `needs input:` at the start of a line; if it is structurally impossible, write `failed:`; then return. The caller looks at these two to decide "do not proceed to the next Phase", so returning without writing them means **the next Phase runs without the stop ever being communicated**.

**When invoked on its own**, always close with **`result:` + a self-contained one-line headline on its own line**. When blocked, `needs input:`; when structurally impossible, `failed:`. **Do not end the final turn with a tool call.**
