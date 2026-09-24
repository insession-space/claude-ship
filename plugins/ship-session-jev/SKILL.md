---
name: ship-session-jev
description: ship-session with Jev (TypeSafe AI's System One model) deciding the goal. Turns a request into a GitHub Issue and implements it in the same session until every acceptance criterion is met, verification is green, and there are zero review findings. Before starting, the goal (Issue / implementation / PR / merge) is fixed exactly once — by Jev when it classifies the request with high confidence, otherwise by asking — and it stops there. Requires the ship-session plugin. Use when the user says "ship this with Jev", "run this through ship-session-jev", or in Japanese 「Jev で ship して」「ship-session-jev で回して」, or invokes /ship-session-jev:ship-session-jev.
---

# ship-session-jev — ship-session, with Jev deciding the goal

This is `ship-session` with one difference: **when the request is invoked, a hook asks Jev (TypeSafe AI's System One model) how far the user wants to go, and if Jev is confident, the goal is recorded without asking.** Creating the Issue and the implementation loop are delegated to the `ship-session` plugin's skills, which must be installed; this skill itself handles the goal (Phase 0) and offers the next step (Phase 3).

Ship the user's request in this order.

0. **Agree on the goal** — decide how far to go (Issue only / implementation only / up to PR / up to merge) **once, at the start**. Jev may have already decided it; check first
1. **Create the Issue** — settle the requirements and create a GitHub Issue (delegate to the `ship-session:create-issue` skill)
2. **Implementation loop** — delegate that Issue to the `ship-session:issue-loop` skill and iterate until the stop conditions are met
3. **Offer the next step** — right after stopping, offer the follow-up options once as a multiple-choice question

The shape of this skill is: **ask about the entry in Phase 0 (unless Jev already answered), ask about the exit in Phase 3.** Do not just report where you stopped and go silent.

## Use the user's language

Questions, progress updates, reports, and Artifacts are written in the user's language. This skill body and its canonical labels are in English; translate them when you output them. How to decide the language and what not to translate are defined in `skills/_shared/user-language.md`.

---

## Phase 0: Decide the goal first

The outcome of ship-session changes a lot depending on how far it goes: a single Issue, or all the way to merge. So **fix it once before starting, and do not ask again afterwards**.

### Step 0: check whether Jev already decided (required, first)

When this skill is invoked, the hook (`hooks/ship-gate.py`) sends the user's request to Jev as a Choice question with five options (`issue_only` / `implementation` / `up_to_pr` / `up_to_merge` / `unspecified`). If the answer is one of the four goals **and** its confidence is at or above the threshold (default 0.85), the hook records the goal and opens the gate before you do anything. There are two entry points, and the hook covers both:

- **The user typed `/ship-session-jev:ship-session-jev <request>`** (or `/ship-session-jev <request>`) → the `UserPromptSubmit` hook classifies the text after the command and hands you a line starting with `[ship-gate]` as additional context in the same turn. **That line is the answer**; read it before doing anything else. If the user types the command again with a *different* request in the same session, the hook treats it as a new task and classifies it afresh (a previous goal is not carried over); typing the same text again just repeats the current state
- **You invoked the skill with the `Skill` tool** (the user asked in prose) → the `PreToolUse` hook classifies the `args` you passed, once per session (a later `Skill` re-invoke does not classify again, whatever its `args`). You get no context line in this case; `status` below is how you read the result

If you did not receive a `[ship-gate]` line, or want to double-check, **run this first, before renaming the session or asking anything**:

```bash
"${CLAUDE_PLUGIN_ROOT}/hooks/ship-goal.sh" status
```

- **`[ship-gate] Jev classified this request as goal: …`, or `goal: <label>` with `jev: decided the goal (…)`** → the goal is fixed. **Do not ask.** Tell the user in one line, in their language, which goal Jev chose and that they can change it (e.g. "Jev read this as *Up to PR* (confidence 0.93); say so if you want a different goal"), then go on to Phase 1. If the user changes it, run `ship-goal.sh record "<new goal>"` before continuing
- **`[ship-gate] The goal for this session is already recorded: …`, or any `goal: <label>` line whose `jev:` line is not `decided the goal` (`decided … but the goal was changed afterwards`, `could not decide (…)`, `not called (…)`, or no `jev:` line at all)** → the goal is fixed too, but not by Jev (the user answered, or ran `record`; when `status` shows a label, the `goal:` line wins over whatever the `jev:` line says). **Do not ask, and do not attribute it to Jev**; state the goal and continue from where you are
- **`[ship-gate] A goal is already recorded in this session from an earlier request: …`** → the user typed the command with no request text while a goal from an earlier request is still recorded. The hook cannot tell whether this is the same task. **If the user is starting something new, fix its goal first** (ask with `header: "Goal"`, or run `record` if they said how far to go); if they are continuing the same task, keep the recorded goal
- **`[ship-gate] Jev did not decide the goal (…)`, or `goal: not decided yet (the gate is armed)` with `jev: could not decide (…)` / `jev: not called (…)`** → Jev did not decide (no API key, disabled, the request does not state how far to go, low confidence, or the API failed). **Fix the goal yourself exactly as `ship-session` does** — the rest of this Phase
- **`goal: not set (no gate is armed)`** → the hook could not arm the gate at all (it could not resolve the session, or the state directory is not writable). Nothing enforces Phase 0 in this case; fix the goal yourself all the same
- The reasons are only for you; do not make the user care about them. Jev never touches anything other than this one classification (not verification, not acceptance criteria, not review)

### Gate: fix the goal before anything else (required)

**Before calling any tool other than `ship-goal.sh status` and renaming the session, fix the goal.** Reading files, running `gh`, launching subagents, and investigating code all come after this gate.

- **Why**: if the goal is not agreed, nothing is left to drive the later phase transitions. Looking at 21 past sessions that invoked ship-session, **all 18 that ran Phase 0 reached the implementation loop, and all 3 that skipped it stopped partway**. They stopped by "ending the turn right after creating one Issue", without telling the user anything
- **This gate is also enforced by a hook** (`hooks/ship-gate.py`). The gate is set when ship-session-jev is invoked, and until the goal is recorded, every tool other than `AskUserQuestion`, session renaming, and the recording script is blocked at PreToolUse. Being blocked means you broke the procedure; follow the message and fix the goal first
- **Record the goal** in one of these ways (recording opens the gate)
  - Jev's classification (done by the hook; see Step 0)
  - Ask with `AskUserQuestion` (`header: "Goal"` or `header: "Approach"`) → **the answer is recorded automatically**. The hook auto-records only when the header is `Goal` / `Approach` / `到達点` / `進め方` while the gate is pending; once the gate is open (Jev decided, or a goal was recorded), only `Goal` / `到達点` answers overwrite it — so **if you ask the Approach question after Jev already opened the gate, run `"${CLAUDE_PLUGIN_ROOT}/hooks/ship-goal.sh" record "<answer>"` yourself**. **If you asked in any other language (e.g. a translated header in French), run the same `record` right after the user answers**
  - If the user's message states the goal explicitly, run `"${CLAUDE_PLUGIN_ROOT}/hooks/ship-goal.sh" record "<goal>"` (e.g. `record "Up to PR"`)
- **"The request is vague, so I want to investigate first" is not a reason to skip the gate.** The investigation may change the goal, but if you start investigating without a goal you never come back to Phase 0. A real stop case: a vague symptom report like "I feel like something is off" went to investigation → Issue creation without asking about the goal, and ended there
- Even when the symptom is vague and "what to build" is unclear, **"how far to go" can be decided first**. They are separate questions, so do not let the vagueness of one postpone the other

### How to ask

If Jev already decided (Step 0), do not ask. If the user's message **states the goal explicitly, do not ask**. Only when you cannot tell, ask one `AskUserQuestion` (`header: "Goal"`, translated into the user's language; `multiSelect: false`). Offer these 4 options **in this order**.

The labels, headers, questions, and descriptions in this skill's tables are canonical English. When you ask, translate them into the user's language (see `skills/_shared/user-language.md`).

| # | Label | What to write in the description | What actually runs |
| --- | --- | --- | --- |
| 1 | **Up to PR (Recommended)** | Once green, create a draft PR and stop. You review and decide on the merge | Phase 1 → Phase 2 |
| 2 | Up to merge | Confirm verification is green, merge the PR, and clean up the branch/worktree | The above + merge + cleanup |
| 3 | Implementation only (no PR) | Implement until green and just commit to the branch | Phase 1 → Phase 2 (no PR) |
| 4 | Issue only | Write the requirements into an Issue and stop | Phase 1 only |

"Up to PR" is recommended because **keeping the user's own visual check before the merge is the safe side**.

### Phrases that count as explicit (proceed without asking)

- 「マージまで」「マージして」「出しきって」, "up to merge", "merge it" → **Up to merge**
- 「PR まで」「PR 作って」「draft PR まで」, "make a PR", "up to a draft PR" → **Up to PR**
- 「Issue だけ」「Issue 化して」, "just the Issue" → **Issue only** (in this case using `ship-session:create-issue` directly is more natural)
- Nothing said → **ask**

Even when the goal is explicit and you proceed without asking, **record it with `ship-goal.sh record` first** (the gate does not open without a record). Jev's decision counts as a record; a goal you read from the message yourself does not until you run `record`.

### When the request is not shippable

Some requests **do not fit** the "write an Issue and implement it" shape — pure questions, root-cause investigation only, fixing an existing PR, release work, and so on. When you judge that, ask about the approach **instead of** the goal question (one `AskUserQuestion`, `header: "Approach"`). Offer these 3 options **in this order**.

| # | Label | What to write in the description |
| --- | --- | --- |
| 1 | **Investigate and answer only (Recommended)** | Do not follow the ship-session procedure; investigate on the spot, answer, and finish |
| 2 | Turn it into an Issue and implement | Reinterpret it as a request and move on to the normal goal question |
| 3 | Hand off to another skill | Name the matching skill and hand it off |

- **If 1 or 3 is chosen, ship-session's job ends there.** Even then, **do not finish silently** — close by reporting what you did / where you handed it off
- Do not make the decision one-way. If it really was a request, the user can pull it back with option 2
- **This branch is part of the gate too.** Do not skip asking and run off to investigate or fix on your own because "it does not look shippable" (2 of the past stop cases were exactly this; the whole ship-session procedure spun idle)

### Handling the goal

- Keep the agreed goal **for the whole session**, and **state it explicitly** in the Phase 1/2 delegation prompts. The delegate does not know this skill's decision (whether Jev or the user made it); if you do not write it, it runs to its default of creating a draft PR.
- **Do not ask again midway.** But if the user later says "actually, up to merge", update it at that point (run `ship-goal.sh record` again with the new goal). This is also how a Jev decision gets corrected.
- **Do not go past the chosen goal.** With "Issue only", do not move on to implementation after creating the Issue. With "Up to PR", do not merge.

### Extra steps only for "Up to merge"

1. Mark the PR ready (`gh pr ready <N>`) → **confirm the checks are green** (`gh pr checks <N>`)
   - **If the repository has no CI, "0 checks" is not green.** Report that, and state the verification results you ran locally as the basis for the merge
2. **Decide the merge method after reading the repository settings** (do not use one method for everything)
   ```bash
   gh api repos/<owner>/<repo> --jq '{squash:.allow_squash_merge, merge:.allow_merge_commit, rebase:.allow_rebase_merge}'
   ```
   Specifying a method that is not allowed makes the merge fail
3. After merging, clean up following `issue-loop`'s "Cleanup after merge"
4. If you cannot merge because of conflicts, red CI, required reviews, etc., **do not force merge**; return to the user with `needs input:`

---

## Phase 1: Create the Issue (delegate to ship-session:create-issue)

1. **Invoke `ship-session:create-issue`** (the `ship-session` plugin's skill; this plugin does not ship its own copy) and pass the task description as args (if empty, target the user's most recent message). create-issue does everything from digging into the requirements to `gh issue create`. **Do not rush the back-and-forth of that digging from the ship-session side.**
2. From the report, **note the created Issue number / URL** (used in Phase 2).
   - ⚠ **Even if create-issue writes `result:`, it is an interim report, not the end of this turn.** If the goal is not "Issue only", go straight on to Phase 2 (details in the matching section of "Rules to keep")
3. If create-issue confirmed the goal with `AskUserQuestion`, **that agreement becomes the basis of the acceptance criteria as-is**. Do not ask again from the ship-session side.
4. **If the goal is "Issue only", finish here.** Report the Issue number / URL and emit the completion signal.

## Phase 2: Implementation loop (delegate to ship-session:issue-loop)

> Run this only when the goal is something other than "Issue only".

1. **Invoke `ship-session:issue-loop`** (the `ship-session` plugin's skill) with the Issue number noted in Phase 1. **State the goal decided in Phase 0 in the args** (e.g. "The goal is Up to PR. Do not merge.").
2. For the loop itself (iterating implement → verify → review → fix gaps, evaluating the stop conditions, commit / push / PR, worktree handling), **follow issue-loop's rules as-is**. Do not reimplement them on the ship-session side.

---

## Phase 3: Offer the next step (required)

After posting the completion report, do not go silent. **Offer "what to do next" as a multiple-choice `AskUserQuestion`.**

ship-session is designed to stop deliberately at the goal, so right after stopping there are always follow-up options. Making the user type them out is a wasted round trip.

- **Exactly one** `AskUserQuestion` (`header: "Next step"`). Put the recommended option first and append `(Recommended)` to its label.
- Choose the options by **where you actually ended up**, not by the Phase 0 agreement (if you were blocked and stopped earlier, use that row).
- When an option is chosen, **act on it right away**. If "Stop here" is chosen, do nothing and close.
- **Do not end the turn after asking the question.** Receive the answer, carry out the chosen work, and then write `result:`.

| Where you actually stopped | Options (in this order, first is recommended) |
| --- | --- |
| **Issue only** | 1. Run the implementation loop next / 2. Stop here |
| **Implementation only (no PR yet)** | 1. Create a draft PR / 2. Fix more / 3. Stop here |
| **Up to PR** | 1. Proceed to merge / 2. Fix more / 3. Stop here |
| **Up to merge** | 1. Check that it landed / 2. Ship the next task / 3. Stop here |
| **Blocked and halted** | 1. Work around the blocker and continue / 2. Only dig deeper into the investigation / 3. Stop here |

### When not to ask

- **When the user has already given the next instruction** (e.g. "after the PR, do X next") → proceed to that instruction without asking
- **When finishing with `failed:`** (structurally impossible) → return the reason without offering options
- **When stopping with `needs input:`** → first ask for what is needed to unblock

---

## Rules to keep

### Ask the user multiple-choice questions

When you need to ask, use `AskUserQuestion` by default. Offer 2–4 reasonable candidates, **put the recommended one first**, and append `(Recommended)` to its label. Bundle independent questions **into one call, up to 4 questions**. Use `multiSelect: true` when options are not mutually exclusive. When there is something to compare (layout options, code options), use `preview`.

Ask for free-form text in prose only **when you need the value itself** (URL / ID / exact wording) and **when only a human can do it, such as authentication**.

**Do not ask about** things you can find out yourself, things already decided in the conversation, or things with a conventional default. Ask only when "the answer changes what you do next".

### Keep secrets out of the conversation

Do not output the **values** of API keys, tokens, or passwords in chat, commit messages, PR bodies, or Issue bodies. That includes masked or partial forms (`sk-...abcd`). Once a value appears in the conversation, the only fix is to rotate it.

- Write directly to `.env` / the secret store with shell redirection, and report only "wrote to `<file name>`"
- Check existence by reporting **presence**, not the value (`present` / `absent`)
- **State the same constraint explicitly to delegated agents** (the delegation prompt is their only context, so it is not passed on automatically)

### Treat a delegate's `result:` as an interim report

`create-issue` / `issue-loop` / `code-review` are **loaded in the same turn** via the `Skill` tool. Their endings carry each skill's own completion signal ("this skill is done here", "close with `result:`", "do not end the final turn with a tool call"), and **they get executed as the most recently read instructions, ending ship-session's turn along with them**.

- **Even if a delegate writes `result:`, it is an interim report for that step, not the end of this turn.** If you have not reached the agreed goal, go straight on to the next Phase
- **You may close the turn in only 3 cases** — when you have reached the agreed goal / when a human is needed and you write `needs input:` / when it is structurally impossible and you write `failed:`
- State in the delegation prompt: "**Called from ship-session (via ship-session-jev). Do not close with `result:`; report the outcome and return to the caller.**" The delegate cannot get this context anywhere else

### Do not stop after announcing the next Phase

**If you announce the next step in prose, like "Returning to Phase 2 (implementation loop)", call the `Skill` tool in the same turn.** Writing only the announcement and ending the turn looks, to the user, the same as stopping silently — worse, because it misleads them into thinking work is progressing.

- **Right after receiving a delegate's report, your output may start with the next `Skill` call instead of a status explanation.** If an explanation is needed, write it in the same turn as the call. If unsure whether to write it, skip it and call
- Announcement text is not a substitute for entering the next Phase. **Do not split the declaration and the execution into separate turns**

A message with no tool call in it ends the turn. Besides the announcement above, these endings also stop the work while the agreed goal is still owed — **do not end a turn in any of them**:

1. **A long summary of what was done that closes by naming the next step**, with no tool call, so the next step never starts
2. **An offer to carry on unless the user prefers otherwise** ("Shall I proceed to the implementation loop?"). The goal was agreed in Phase 0; that agreement is the answer
3. **A list of decisions for the user when, by your own account, none of them blocks the remaining work.** Put your recommendation in the same message and continue with what does not depend on the answer
4. **Deciding this is a good place to report** because the turn has been long or a Phase finished. A finished Phase is a milestone, not the goal

Status notes and recommendations are welcome — **put them in the same message as the next tool call**. If you notice yourself inviting the user to redirect you or offering to wait, delete it and do the next thing.

**Work you started is not finished while it is still running.** If a background command, an external CLI run, or a subagent has not returned, wait for its completion notification and use its output before judging a Phase done.

**When this rule does not apply** (stopping is correct):

- **When a delegate returns with `needs input:` / `failed:`** — do not move on to the next Phase; return its content to the user
- **When you have already reached the agreed goal** — for example, if the goal is "Issue only" and Phase 1 is done, not moving on to Phase 2 is correct. **Check the goal first**; this rule only forbids "stopping before reaching the goal"

### Do not go past the goal

Destructive and outward-facing operations follow each delegate's rules. **Merge a PR only when "Up to merge" was chosen in Phase 0.**

### Do not drop the review step

`ship-session:code-review` is designed to delegate to an external CLI (codex), but **do not skip the step when it is unavailable**. Read the diff from multiple angles with several subagents using separate lenses (details are in the `code-review` skill's rules).

**Do not move on to the completion report with "the review tool was down, so I read it alone".** If you used an alternative, state in the report how you ran it (how many agents / which lenses) and what scope you could not read.

---

## Completion report

Do not settle for prose alone; **by default, publish the result as an Artifact and share it** (the `Artifact` tool; private by default, visible only to the user).

**Always include**:

- **The goal agreed in Phase 0 (and whether Jev or the user decided it), and how far you actually got**
- Issue number / URL and the PR
- A summary of what the delegates (create-issue / issue-loop) ran
- Status of the stop conditions (acceptance criteria, verification, review findings)
- **If you changed the UI, before / after screenshots side by side** (embedded as data URIs; after-only is not acceptable)
  - Follow `skills/_shared/artifact-images.md` for how to embed them (**make them click-to-enlarge before publishing**)

**When you do not need one**: when the goal is "Issue only" (the Issue itself is the deliverable, so prose is enough). If a delegate already created an Artifact, do not duplicate it; reference its URL.

Read the `artifact-design` skill before writing the Artifact. Always pass `favicon` (1–2 emoji) and `description` (one sentence).

## Completion signal

When you finish, always close with **`result:` plus a self-contained one-line headline on its own line**.

```
result: Implemented dark mode for Issue #123, verification green, created draft PR #124
```

- If progress needs a single human action (authentication, a decision, granting permission), start the line with `needs input:`
- If it is structurally impossible (a false premise, the target does not exist), start the line with `failed:`
- **Do not end the final turn with a tool call.** Always close with text after creating a PR or publishing an Artifact

**Order with Phase 3**: completion report → Phase 3 `AskUserQuestion` → write `result:` after receiving the answer. Do not end the turn after asking the question. If a follow-up is chosen, **carry out that work first**, then write `result:` (the headline states where you finally ended up).
