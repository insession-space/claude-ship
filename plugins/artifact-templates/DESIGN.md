# Artifact design templates

Five page types, one shared base. This file is the single source of truth for them.
`SKILL.md` says which type to pick; this file says what each type looks like.

- **Read only what you need**: the Shared base, the No-slop list, and the one type section you picked
- **Use together with the `artifact-design` skill**, which holds the page contract (skeleton, CDN allowlist, size, theming). This file fills in the treatment; it never overrides the contract
- **The user's own words win.** If they ask for a specific look, follow it, even when it contradicts this file

| Type id | Type | Use it for |
|---|---|---|
| `plan` | Plan (landing page) | Proposals, plans, pitches: something the reader has to decide on |
| `review` | Review report (technical report) | Code review results, audit findings |
| `investigation-report` | Investigation (report form) | Answering a question: root cause, research, comparison |
| `investigation-dashboard` | Investigation (dashboard form) | Grasping a situation: status across many items, numbers over time |
| `implementation` | Implementation report | What was shipped: goal, acceptance criteria, verification, before / after |

---

## Shared base

Every skeleton pastes the same Base CSS. Do not restyle it per page; add only what the type needs.

### Direction

A working document, not a brochure. Blue-grey neutrals, one indigo accent, rules instead of cards, state shown as small tinted pills.
The page should look like something an engineer wrote carefully, not like a marketing site.

### Tokens

**Dark is the default.** Bare `:root` holds the dark palette with `color-scheme: dark`, so the page is dark whatever the OS setting.
Light applies only when the viewer explicitly picks it (`data-theme="light"`). There is no `prefers-color-scheme` block on purpose.

| Token | Dark (default) | Light | Role |
|---|---|---|---|
| `--bg` | `#0f141b` | `#f6f8fa` | Page ground |
| `--surface` | `#151b24` | `#ffffff` | The rare element that needs to stand apart (a KPI tile, a code block) |
| `--text` | `#e2e7ee` | `#1c2330` | Body text |
| `--text-2` | `#bcc5d1` | `#3a4454` | Lead paragraphs, secondary text |
| `--muted` | `#8e9aab` | `#5b6576` | Meta lines, table headers, labels |
| `--rule` | `#2c3643` | `#d5dbe3` | Header rules |
| `--rule-soft` | `#1f2833` | `#e3e8ee` | Row rules |
| `--accent` | `#86aee8` | `#1f4e8c` | Links, `h1`, code identifiers. The only decorative color |
| `--accent-soft` | `#1a2a42` | `#e4ecf7` | Tint behind an info pill |
| `--crit` / `--crit-soft` | `#f19a97` / `#3b1a1c` | `#a4161a` / `#fde2e1` | Must fix, failing, down |
| `--warn` / `--warn-soft` | `#e8c16a` / `#36290f` | `#8a5a00` / `#fcefd2` | Should fix, at risk |
| `--ok` / `--ok-soft` | `#7fd09a` / `#15301f` | `#1d6b3a` / `#dcf1e3` | Done, passing, healthy |
| `--neutral-soft` | `#232c38` | `#e6ebf1` | Tint behind a neutral pill |
| `--overlay` | `rgb(5 8 12 / 0.9)` | `rgb(28 35 48 / 0.85)` | Backdrop behind an enlarged image |

State colors (`crit` / `warn` / `ok`) are semantic and do not count as a second accent. Always pair them with a word (`高` / `Must fix` / `exit 0`), never color alone.

### Type

- **IBM Plex Sans JP** for everything, **IBM Plex Mono** for paths, commands, identifiers, and numbers in code
- Scale: `h1` 22–28px (40px only in the `plan` hero), `h2` 18px, body 15px, table 14px, meta and labels 12–13px
- Weights: 400 body, 500 labels and pills, 700 headings. No other weights
- Running text stays under about 40 full-width characters / 70 half-width characters per line (`max-width: 40em`)

### Layout

- One column, `max-width` 760px (`plan` and `investigation-dashboard` widen to 880 / 1040px), left-aligned
- Side gutter `clamp(16px, 4vw, 32px)` on the `.page` wrapper
- Hierarchy comes from spacing and type size. 40px before each `h2`, 12px inside a group
- Tables sit in `.table-wrap` (`overflow-x: auto`) so only the table scrolls on a phone
- Cards only where the element really is a separate object (a KPI tile). Never wrap every section in a box

### Language

The page is written in the user's language. Decide it in this order: (1) Claude Code's `language` setting (`~/.claude/settings.local.json`, then `~/.claude/settings.json`), (2) the language of the user's most recent message, (3) English.
Set the code of the language you decided on the wrapper (`<div class="page" lang="ja">` for Japanese, `lang="en"` for English). The placeholder text in the skeletons below is in English only to show the slot; replace all of it.
Do not translate code, commands, paths, or identifiers.

### Base CSS

Replace the `/* @base */` line in a skeleton with this block, unchanged.

<!-- base-css:start -->
```css
:root {
  color-scheme: dark;
  --bg: #0f141b; --surface: #151b24;
  --text: #e2e7ee; --text-2: #bcc5d1; --muted: #8e9aab;
  --rule: #2c3643; --rule-soft: #1f2833;
  --accent: #86aee8; --accent-soft: #1a2a42;
  --crit: #f19a97; --crit-soft: #3b1a1c;
  --warn: #e8c16a; --warn-soft: #36290f;
  --ok: #7fd09a; --ok-soft: #15301f;
  --neutral-soft: #232c38;
  --overlay: rgb(5 8 12 / 0.9);
  --font-sans: "IBM Plex Sans JP", "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif;
  --font-mono: "IBM Plex Mono", ui-monospace, "SFMono-Regular", Menlo, monospace;
}
:root[data-theme="light"] {
  color-scheme: light;
  --bg: #f6f8fa; --surface: #ffffff;
  --text: #1c2330; --text-2: #3a4454; --muted: #5b6576;
  --rule: #d5dbe3; --rule-soft: #e3e8ee;
  --accent: #1f4e8c; --accent-soft: #e4ecf7;
  --crit: #a4161a; --crit-soft: #fde2e1;
  --warn: #8a5a00; --warn-soft: #fcefd2;
  --ok: #1d6b3a; --ok-soft: #dcf1e3;
  --neutral-soft: #e6ebf1;
  --overlay: rgb(28 35 48 / 0.85);
}
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.75 var(--font-sans); }
.page { max-width: 760px; margin-inline: auto; padding-inline: clamp(16px, 4vw, 32px); padding-block: 40px 72px; display: flex; flex-direction: column; gap: 12px; }
h1, h2, h3 { margin: 0; line-height: 1.4; text-wrap: balance; }
h1 { font-size: clamp(22px, 4.2vw, 28px); font-weight: 700; color: var(--accent); }
h2 { font-size: 18px; font-weight: 700; margin-top: 28px; }
h3 { font-size: 15px; font-weight: 700; margin-top: 12px; }
p, ul, ol { margin: 0; max-width: 40em; }
ul, ol { padding-left: 1.4em; }
li + li { margin-top: 4px; }
a { color: var(--accent); text-underline-offset: 3px; }
.meta { font-size: 13px; color: var(--muted); }
.lead { font-size: 16px; color: var(--text-2); }
code, kbd, pre { font-family: var(--font-mono); font-size: 0.87em; }
code { color: var(--accent); overflow-wrap: anywhere; }
pre { margin: 0; padding: 12px 14px; background: var(--surface); border: 1px solid var(--rule-soft); border-radius: 4px; overflow-x: auto; line-height: 1.6; }
pre code { color: var(--text); }
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th { text-align: left; font-size: 12px; font-weight: 500; color: var(--muted); padding: 8px; border-bottom: 1px solid var(--rule); white-space: nowrap; }
td { padding: 10px 8px; border-bottom: 1px solid var(--rule-soft); vertical-align: top; }
th:first-child, td:first-child { padding-left: 0; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
.pill { display: inline-block; padding: 0 8px; border-radius: 3px; font-size: 12px; font-weight: 500; line-height: 1.7; white-space: nowrap; background: var(--neutral-soft); color: var(--text-2); }
.pill.crit { background: var(--crit-soft); color: var(--crit); }
.pill.warn { background: var(--warn-soft); color: var(--warn); }
.pill.ok { background: var(--ok-soft); color: var(--ok); }
.pill.info { background: var(--accent-soft); color: var(--accent); }
dl.facts { display: grid; grid-template-columns: max-content 1fr; gap: 6px 20px; margin: 0; font-size: 14px; }
dl.facts dt { color: var(--muted); }
dl.facts dd { margin: 0; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
```
<!-- base-css:end -->

Font link (first lines of every skeleton):

```html
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans+JP:wght@400;500;700&display=swap">
```

Charts are not part of the base. If a page needs one, load the `dataviz` skill and take the series colors from it, not from the state colors.

---

## No-slop list

Pages that look and read as machine-made get skimmed and distrusted. Check the draft against this list before publishing. It applies to every type.

### Look

- No gradients: not on backgrounds, not on text, not on buttons
- No emoji as section markers or bullet decoration, and no decorative icons that carry no information
- No glassmorphism (`backdrop-filter`), no glow, no drop shadows on content blocks
- No "every section is a rounded card with a shadow". Rules and spacing do the grouping
- No accent bar on the left edge of rounded cards
- No centered body text. Headings and body are left-aligned, including the `plan` hero
- No numbered markers (01 / 02 / 03) unless the content really is an ordered sequence
- No second accent color. Indigo plus the state colors, nothing else
- No oversized hero that fills the first screen. The first screen shows the conclusion and the start of the evidence

### Writing

- The `h1` states the conclusion or the decision, not the topic. `指摘2件、うち1件はマージ前に直す`, not `コードレビュー結果`
- Section headings say what the section found. `原因は再試行の上限が0だったこと`, not `原因分析`
- Use numbers, names, paths, and dates instead of adjectives. `p95 が 840ms から 210ms`, not `大幅に高速化`
- No stock phrases. Japanese: `〜することができます`, `シームレス`, `革新的`, `〜を実現します`, `さまざまな`, `〜と言えるでしょう`, `いかがでしたか`, `まとめると`. English: `seamless`, `cutting-edge`, `unlock`, `empower`, `leverage`, `delve`, `in today's fast-paced`
- No padding by threes. List as many items as exist: two, four, or one
- No summary line at the end that repeats the page. End on the next action or the open question
- No em-dash asides and no "not X but Y" framing. Short, direct sentences
- When something is unknown, say it is unknown. Do not smooth it over

---

## Type: Plan (landing page)

**Use it when** the reader has to decide on something: a proposal, a plan, a feature pitch, a direction change.

**Required sections, in order**

1. Hero: meta line (project, date, author) → `h1` = the proposal in one sentence → lead = who benefits and what changes → the decision asked for
2. The problem, with at least one number or a concrete incident
3. The proposal: what gets built, in a short flow or list
4. What changes: a before / after comparison
5. Plan and cost: dates, effort, what it depends on
6. Decisions needed: the questions the reader has to answer, each with the recommended answer

**Tone**: confident and specific. It is still a working document; persuasion comes from the numbers, not from adjectives.

**Layout**: the hero widens to 880px with a 40px `h1`. Below it, the standard 760px column. Before / after sits in two columns that stack under 640px. No call-to-action buttons (there is nowhere for them to go).

<!-- skeleton:plan:start -->
```html
<title>{Proposal name}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans+JP:wght@400;500;700&display=swap">
<style>
/* @base */
.page { max-width: 880px; }
.hero { display: flex; flex-direction: column; gap: 14px; padding-block: 16px 28px; border-bottom: 1px solid var(--rule); }
.hero h1 { font-size: clamp(28px, 5.4vw, 40px); line-height: 1.3; max-width: 22em; }
.ask { font-size: 14px; color: var(--text); }
.ask b { color: var(--accent); font-weight: 500; }
.compare { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
.compare h3 { margin: 0 0 6px; font-size: 13px; font-weight: 500; color: var(--muted); }
@media (max-width: 640px) { .compare { grid-template-columns: 1fr; } }
</style>
<div class="page" lang="{language code}">
  <header class="hero">
    <p class="meta">{Project} · {YYYY-MM-DD} · {Author}</p>
    <h1>{The proposal in one sentence}</h1>
    <p class="lead">{Who benefits, and what changes for them}</p>
    <p class="ask"><b>{Label: decision needed}</b> {The one decision, and by when}</p>
  </header>

  <h2>{What is wrong today, stated as a finding}</h2>
  <p>{The problem with a number or a concrete incident}</p>

  <h2>{What we build, stated as a finding}</h2>
  <ol>
    <li>{Step of the flow the user goes through}</li>
    <li>{Next step}</li>
  </ol>

  <h2>{What changes}</h2>
  <div class="compare">
    <div><h3>{Label: today}</h3><p>{How it works now}</p></div>
    <div><h3>{Label: after}</h3><p>{How it works after}</p></div>
  </div>

  <h2>{Plan and cost}</h2>
  <div class="table-wrap"><table>
    <thead><tr><th>{Label: when}</th><th>{Label: what}</th><th class="num">{Label: effort}</th></tr></thead>
    <tbody><tr><td>{YYYY-MM-DD}</td><td>{Milestone}</td><td class="num">{n days}</td></tr></tbody>
  </table></div>

  <h2>{Decisions needed}</h2>
  <ul>
    <li>{Question} <span class="pill info">{Label: recommended}</span> {Recommended answer and why}</li>
  </ul>
</div>
```
<!-- skeleton:plan:end -->

---

## Type: Review report (technical report)

**Use it when** reporting findings on code or a document: code review, security review, audit.

**Required sections, in order**

1. Meta line (target, PR / commit, date) → `h1` = the count and what must happen (`指摘2件、うち1件はマージ前に直す`) → lead = the most important finding in one sentence
2. Facts: what was read, how (tool / lenses), what was not read
3. Findings table: severity pill, location (`file:line` in mono), the finding in one line, adopted or dropped
4. Details per finding: location as `h3`, what breaks and under which input, suggested fix (code block)
5. Out of scope / not read, if anything

**Tone**: technical and flat. Each finding names a failing input or a concrete consequence; no "might want to consider".

**Layout**: standard 760px column. The table carries the page; details follow in the same order as the table.

<!-- skeleton:review:start -->
```html
<title>{Target} review</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans+JP:wght@400;500;700&display=swap">
<style>
/* @base */
.finding { display: flex; flex-direction: column; gap: 8px; padding-top: 16px; border-top: 1px solid var(--rule-soft); }
.finding h3 { margin: 0; display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; }
.finding h3 code { font-weight: 500; }
</style>
<div class="page" lang="{language code}">
  <p class="meta">{Label: code review} · {PR #n / commit} · {YYYY-MM-DD}</p>
  <h1>{n findings, m to fix before merge}</h1>
  <p class="lead">{The most important finding in one sentence}</p>

  <dl class="facts">
    <dt>{Label: scope}</dt><dd>{n files, +a / -b lines}</dd>
    <dt>{Label: method}</dt><dd>{Tool, or n agents with lenses x / y}</dd>
    <dt>{Label: not read}</dt><dd>{What was out of reach, or "none"}</dd>
  </dl>

  <h2>{Label: findings}</h2>
  <div class="table-wrap"><table>
    <thead><tr><th>{Label: severity}</th><th>{Label: location}</th><th>{Label: finding}</th><th>{Label: status}</th></tr></thead>
    <tbody>
      <tr><td><span class="pill crit">{High}</span></td><td><code>{path/to/file.py:88}</code></td><td>{What breaks, in one line}</td><td>{Adopted}</td></tr>
      <tr><td><span class="pill">{Low}</span></td><td><code>{path/to/other.md:12}</code></td><td>{What is off, in one line}</td><td>{Dropped: reason}</td></tr>
    </tbody>
  </table></div>

  <h2>{Label: details}</h2>
  <section class="finding">
    <h3><span class="pill crit">{High}</span><code>{path/to/file.py:88}</code></h3>
    <p>{The failing input and what happens}</p>
    <pre><code>{Suggested fix}</code></pre>
  </section>
</div>
```
<!-- skeleton:review:end -->

---

## Type: Investigation, report form

**Use it when** the page answers one question: why did X happen, which option is better, what does this codebase do.
Pick this form when the value is in the explanation. Pick the dashboard form when the value is in scanning many items or numbers.

**Required sections, in order**

1. Meta line (question owner, date, sources) → `h1` = the answer → lead = the answer's main reason
2. Evidence: each piece with its source (`file:line`, log line, URL, command output)
3. What was ruled out, and why
4. What is still unknown
5. Next step

**Tone**: the answer first, then proof. State confidence plainly (`確認済み` / `推測`), and mark which claims are which.

**Layout**: standard 760px column. Evidence as a table when there are three or more pieces, otherwise as a list.

<!-- skeleton:investigation-report:start -->
```html
<title>{Question as a name}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans+JP:wght@400;500;700&display=swap">
<style>
/* @base */
.answer { display: flex; flex-direction: column; gap: 10px; padding-bottom: 20px; border-bottom: 1px solid var(--rule); }
</style>
<div class="page" lang="{language code}">
  <header class="answer">
    <p class="meta">{Label: investigation} · {YYYY-MM-DD} · {Sources: repo, logs, docs}</p>
    <h1>{The answer}</h1>
    <p class="lead">{The main reason, in one sentence}</p>
  </header>

  <h2>{Label: evidence}</h2>
  <div class="table-wrap"><table>
    <thead><tr><th>{Label: claim}</th><th>{Label: source}</th><th>{Label: confidence}</th></tr></thead>
    <tbody>
      <tr><td>{What the evidence shows}</td><td><code>{path/to/file.ts:42}</code></td><td><span class="pill ok">{Confirmed}</span></td></tr>
      <tr><td>{What the evidence suggests}</td><td>{Log line or URL}</td><td><span class="pill warn">{Inferred}</span></td></tr>
    </tbody>
  </table></div>

  <h2>{Label: ruled out}</h2>
  <ul><li>{Hypothesis}: {why it does not hold}</li></ul>

  <h2>{Label: still unknown}</h2>
  <ul><li>{Open question, and what would settle it}</li></ul>

  <h2>{Label: next step}</h2>
  <p>{The one thing to do next}</p>
</div>
```
<!-- skeleton:investigation-report:end -->

---

## Type: Investigation, dashboard form

**Use it when** the reader needs to grasp a situation at a glance: status across many items, a few numbers compared with the previous period, what needs attention now.

**Required sections, in order**

1. Header: `h1` = the state in one line (`12件中2件が要対応`) → as-of timestamp and data source
2. Key numbers: 2–4 tiles, each with label, value, and change from the previous period. Only numbers the reader acts on
3. Needs attention: the items in a bad state, worst first, each with a state pill and the next action
4. Full list: every item in a table, sortable by eye (state column first)

**Tone**: terse labels, no prose paragraphs above the fold.

**Layout**: widens to 1040px. Tiles in an auto-fit grid (`minmax(160px, 1fr)`) so they wrap on a phone. Tiles are the one place the base allows a surface box.

<!-- skeleton:investigation-dashboard:start -->
```html
<title>{Subject} status</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans+JP:wght@400;500;700&display=swap">
<style>
/* @base */
.page { max-width: 1040px; }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-top: 8px; }
.tile { display: flex; flex-direction: column; gap: 2px; padding: 14px 16px; background: var(--surface); border: 1px solid var(--rule-soft); border-radius: 4px; }
.tile .label { font-size: 12px; font-weight: 500; color: var(--muted); }
.tile .value { font-family: var(--font-mono); font-size: 26px; font-weight: 500; font-variant-numeric: tabular-nums; line-height: 1.3; }
.tile .delta { font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
.attention { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 8px; max-width: none; }
.attention li { display: flex; flex-wrap: wrap; align-items: baseline; gap: 10px; margin: 0; }
</style>
<div class="page" lang="{language code}">
  <h1>{The state in one line}</h1>
  <p class="meta">{Label: as of} {YYYY-MM-DD HH:MM} · {Data source}</p>

  <div class="tiles">
    <div class="tile"><span class="label">{Metric}</span><span class="value">{12}</span><span class="delta">{+3 vs last week}</span></div>
    <div class="tile"><span class="label">{Metric}</span><span class="value">{2}</span><span class="delta">{-1 vs last week}</span></div>
  </div>

  <h2>{Label: needs attention}</h2>
  <ul class="attention">
    <li><span class="pill crit">{Down}</span><b>{Item}</b><span>{Why, and the next action}</span></li>
    <li><span class="pill warn">{At risk}</span><b>{Item}</b><span>{Why, and the next action}</span></li>
  </ul>

  <h2>{Label: all items}</h2>
  <div class="table-wrap"><table>
    <thead><tr><th>{Label: state}</th><th>{Label: item}</th><th>{Label: owner}</th><th class="num">{Label: metric}</th><th>{Label: updated}</th></tr></thead>
    <tbody>
      <tr><td><span class="pill crit">{Down}</span></td><td>{Item}</td><td>{Owner}</td><td class="num">{0.0}</td><td>{YYYY-MM-DD}</td></tr>
      <tr><td><span class="pill ok">{Healthy}</span></td><td>{Item}</td><td>{Owner}</td><td class="num">{0.0}</td><td>{YYYY-MM-DD}</td></tr>
    </tbody>
  </table></div>
</div>
```
<!-- skeleton:investigation-dashboard:end -->

---

## Type: Implementation report

**Use it when** reporting shipped work: what the goal was, how far it got, whether it is verified.

**Required sections, in order**

1. Meta line (Issue, PR, branch) → `h1` = what shipped and where it stopped (`ダークモードを実装し、draft PR #124 まで`) → lead = what the user can now do
2. Facts: agreed goal, reached point, Issue, PR
3. Acceptance criteria: each with a done / not done pill
4. Verification: each command with its exit code
5. Before / after, when the UI changed: side by side, click to enlarge. When nothing visible changed, one line saying so
6. Review: result, method, anything not read
7. Iterations: what failed, what was fixed, per round

**Tone**: a status report. Exit codes and counts, not "everything looks good".

**Layout**: standard 760px column. Before / after in two columns that stack under 640px. The skeleton includes a lightbox: click or Enter / Space opens the image at up to its natural size, and Esc, a backdrop click, or the close button closes it and returns focus. Keep all three ways to close. With zero images it does nothing. When there is no before / after section, delete the `<dialog>` and its script too.

<!-- skeleton:implementation:start -->
```html
<title>{Feature name}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans+JP:wght@400;500;700&display=swap">
<style>
/* @base */
.criteria { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 6px; max-width: none; }
.criteria li { display: flex; align-items: baseline; gap: 10px; margin: 0; }
.shots { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.shots figure { margin: 0; display: flex; flex-direction: column; gap: 6px; }
.shots img { width: 100%; height: auto; border: 1px solid var(--rule); border-radius: 4px; cursor: zoom-in; }
.shots figcaption { font-size: 12px; color: var(--muted); }
@media (max-width: 640px) { .shots { grid-template-columns: 1fr; } }
.lightbox { padding: 0; border: 0; background: transparent; max-width: 100vw; max-height: 100vh; }
.lightbox::backdrop { background: var(--overlay); }
.lightbox img { display: block; max-width: 95vw; max-height: 95vh; width: auto; height: auto; object-fit: contain; }
.lightbox button { position: fixed; top: calc(12px + env(safe-area-inset-top, 0px)); right: 12px; padding: 4px 12px; font: 500 13px var(--font-sans); color: var(--text); background: var(--surface); border: 1px solid var(--rule); border-radius: 4px; cursor: pointer; }
body.lightbox-open { overflow: hidden; }
</style>
<div class="page" lang="{language code}">
  <p class="meta">{Issue #n} · {PR #n} · <code>{branch}</code></p>
  <h1>{What shipped, and where it stopped}</h1>
  <p class="lead">{What the user can do now}</p>

  <dl class="facts">
    <dt>{Label: agreed goal}</dt><dd>{Up to PR}</dd>
    <dt>{Label: reached}</dt><dd>{Draft PR created}</dd>
    <dt>{Label: PR}</dt><dd><a href="{PR URL}">{#n}</a></dd>
  </dl>

  <h2>{Label: acceptance criteria}</h2>
  <ul class="criteria">
    <li><span class="pill ok">{Done}</span><span>{Criterion}</span></li>
    <li><span class="pill crit">{Not done}</span><span>{Criterion, and why}</span></li>
  </ul>

  <h2>{Label: verification}</h2>
  <div class="table-wrap"><table>
    <thead><tr><th>{Label: command}</th><th class="num">{Label: exit}</th></tr></thead>
    <tbody><tr><td><code>{npm test}</code></td><td class="num"><span class="pill ok">0</span></td></tr></tbody>
  </table></div>

  <h2>{Label: before / after}</h2>
  <div class="shots">
    <figure><img src="{data URI}" alt="{Before: what it shows}" role="button" tabindex="0"><figcaption>{Label: before}</figcaption></figure>
    <figure><img src="{data URI}" alt="{After: what it shows}" role="button" tabindex="0"><figcaption>{Label: after}</figcaption></figure>
  </div>

  <h2>{Label: review}</h2>
  <p>{n findings, method, anything not read}</p>

  <h2>{Label: iterations}</h2>
  <div class="table-wrap"><table>
    <thead><tr><th class="num">#</th><th>{Label: failed}</th><th>{Label: fixed}</th></tr></thead>
    <tbody><tr><td class="num">1</td><td>{What failed}</td><td>{What was changed}</td></tr></tbody>
  </table></div>
</div>
<dialog class="lightbox" aria-label="{Label: enlarged image}"><img alt=""><button type="button">{Label: close}</button></dialog>
<script>
(() => {
  const box = document.querySelector(".lightbox");
  const big = box.querySelector("img");
  let from = null;
  const open = (img) => {
    from = img; big.src = img.src; big.alt = img.alt;
    document.body.classList.add("lightbox-open");
    box.showModal();
  };
  const shut = () => {
    box.close();
    document.body.classList.remove("lightbox-open");
    if (from) from.focus();
  };
  box.addEventListener("cancel", (e) => { e.preventDefault(); shut(); });
  box.querySelector("button").addEventListener("click", shut);
  box.addEventListener("click", (e) => { if (e.target === box) shut(); });
  document.querySelectorAll(".shots img").forEach((img) => {
    img.addEventListener("click", () => open(img));
    img.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(img); }
    });
  });
})();
</script>
```
<!-- skeleton:implementation:end -->
