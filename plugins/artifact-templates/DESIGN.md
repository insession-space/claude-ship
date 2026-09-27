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

The No-slop list and the `plan` landing page draw on [taste-skill](https://github.com/Leonxlnx/taste-skill). Where this file differs from it, the reason is the Artifact sandbox or a choice the user made:

- Fonts load from a Google Fonts `<link>` (the Artifact CSP allows only that host), not self-hosted
- Dark is the default and there is no `prefers-color-scheme` switch (the user's choice)
- taste-skill covers landing pages only. The four document types follow its copy and micro-label rules, and use dashboard density rules (1px dividers, mono numbers) only where the page is a dashboard

---

## Shared base

Every skeleton pastes the same Base CSS. Do not restyle it per page; add only what the type needs.

### Direction

A working document, not a brochure. Blue-grey neutrals, one indigo accent, spacing instead of cards, state shown as small tinted pills.
The page should look like something an engineer wrote carefully. The `plan` type is the one exception: it is a real landing page, built on the same tokens.

### Tokens

**Dark is the default.** Bare `:root` holds the dark palette with `color-scheme: dark`, so the page is dark whatever the OS setting.
Light applies only when the viewer explicitly picks it (`data-theme="light"`). There is no `prefers-color-scheme` block on purpose.

| Token | Dark (default) | Light | Role |
|---|---|---|---|
| `--bg` | `#0f141b` | `#f6f8fa` | Page ground |
| `--surface` | `#151b24` | `#ffffff` | The rare element that needs to stand apart (a KPI tile, a code block, the decision band) |
| `--text` | `#e2e7ee` | `#1c2330` | Body text |
| `--text-2` | `#bcc5d1` | `#3a4454` | Lead paragraphs, secondary text |
| `--muted` | `#8e9aab` | `#5b6576` | Meta lines, table headers, labels |
| `--rule` | `#2c3643` | `#d5dbe3` | Table header rule, image border |
| `--rule-soft` | `#1f2833` | `#e3e8ee` | Code block border, dashboard row dividers |
| `--accent` | `#86aee8` | `#1f4e8c` | Links, `h1`, code identifiers, the primary button. The only decorative color |
| `--accent-ink` | `#0f141b` | `#ffffff` | Text on the primary button |
| `--accent-soft` | `#1a2a42` | `#e4ecf7` | Tint behind an info pill |
| `--crit` / `--crit-soft` | `#f19a97` / `#3b1a1c` | `#a4161a` / `#fde2e1` | Must fix, failing, down |
| `--warn` / `--warn-soft` | `#e8c16a` / `#36290f` | `#8a5a00` / `#fcefd2` | Should fix, at risk |
| `--ok` / `--ok-soft` | `#7fd09a` / `#15301f` | `#1d6b3a` / `#dcf1e3` | Done, passing, healthy |
| `--neutral-soft` | `#232c38` | `#e6ebf1` | Tint behind a neutral pill |
| `--overlay` | `rgb(5 8 12 / 0.9)` | `rgb(28 35 48 / 0.85)` | Backdrop behind an enlarged image |
| `--radius` | `6px` | `6px` | The one corner radius: pills, tiles, code, images, buttons |

State colors (`crit` / `warn` / `ok`) are semantic and do not count as a second accent. Always pair them with a word (`高` / `Must fix` / `exit 0`), never color alone.

### Type

- **IBM Plex Sans JP** for everything, **IBM Plex Mono** for paths, commands, identifiers, and numbers that line up
- Scale in documents: `h1` 22 to 28px, `h2` 18px, body 15px, table 14px, meta and labels 12 to 13px. The `plan` type has its own larger scale
- Weights: 400 body, 500 labels and pills, 700 headings. No other weights
- Headings break at phrase boundaries (`word-break: auto-phrase`), so a Japanese headline never splits inside a word like `用／途`
- Emphasis inside a heading uses the same family (bold or the accent color). Never drop in a word from another font
- Running text stays under about 40 full-width characters / 70 half-width characters per line (`max-width: 40em`)

### Layout

- One column, `max-width` 760px (`investigation-dashboard` widens to 1040px, `plan` to 1120px), left-aligned
- Side gutter `clamp(16px, 4vw, 32px)` on the `.page` wrapper
- Hierarchy comes from spacing and type size. 40px before each `h2`, 12px inside a group
- Tables have one rule under the header and none between rows; row padding does the separating. Only the dashboard adds row dividers
- Tables sit in `.table-wrap` (`overflow-x: auto`) so only the table scrolls on a phone
- Cards only where the element really is a separate object (a KPI tile, the decision band). Never wrap every section in a box

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
  --accent: #86aee8; --accent-ink: #0f141b; --accent-soft: #1a2a42;
  --crit: #f19a97; --crit-soft: #3b1a1c;
  --warn: #e8c16a; --warn-soft: #36290f;
  --ok: #7fd09a; --ok-soft: #15301f;
  --neutral-soft: #232c38;
  --overlay: rgb(5 8 12 / 0.9);
  --radius: 6px;
  --font-sans: "IBM Plex Sans JP", "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif;
  --font-mono: "IBM Plex Mono", ui-monospace, "SFMono-Regular", Menlo, monospace;
}
:root[data-theme="light"] {
  color-scheme: light;
  --bg: #f6f8fa; --surface: #ffffff;
  --text: #1c2330; --text-2: #3a4454; --muted: #5b6576;
  --rule: #d5dbe3; --rule-soft: #e3e8ee;
  --accent: #1f4e8c; --accent-ink: #ffffff; --accent-soft: #e4ecf7;
  --crit: #a4161a; --crit-soft: #fde2e1;
  --warn: #8a5a00; --warn-soft: #fcefd2;
  --ok: #1d6b3a; --ok-soft: #dcf1e3;
  --neutral-soft: #e6ebf1;
  --overlay: rgb(28 35 48 / 0.85);
}
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.75 var(--font-sans); }
.page { max-width: 760px; margin-inline: auto; padding-inline: clamp(16px, 4vw, 32px); padding-block: 40px 72px; display: flex; flex-direction: column; gap: 12px; }
h1, h2, h3 { margin: 0; line-height: 1.4; text-wrap: balance; word-break: auto-phrase; }
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
pre { margin: 0; padding: 12px 14px; background: var(--surface); border: 1px solid var(--rule-soft); border-radius: var(--radius); overflow-x: auto; line-height: 1.6; }
pre code { color: var(--text); }
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th { text-align: left; font-size: 12px; font-weight: 500; color: var(--muted); padding: 8px; border-bottom: 1px solid var(--rule); white-space: nowrap; }
td { padding: 12px 8px 4px; vertical-align: top; }
th:first-child, td:first-child { padding-left: 0; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
.pill { display: inline-block; padding: 0 8px; border-radius: var(--radius); font-size: 12px; font-weight: 500; line-height: 1.7; white-space: nowrap; background: var(--neutral-soft); color: var(--text-2); }
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

- No gradients: not on backgrounds, not on text, not on buttons. No gradient blob behind a headline
- No glassmorphism (`backdrop-filter`), no glow, no drop shadows on content blocks
- No emoji anywhere on the page, and no decorative icons that carry no information
- No pure `#000000` or `#ffffff` as a page ground. No second accent color: indigo plus the state colors, nothing else
- One corner radius (`--radius`) for everything. No mix of pill buttons, 4px cards, and 16px images
- No centered body text. Headings and body are left-aligned, including the `plan` hero
- No `100vh` blocks; size a section to its content

### Layout

- No "every section is a rounded card with a shadow". Spacing does the grouping
- No three equal cards by default. Show as many items as exist, as text in a grid, not as boxes
- No split header: a big headline on the left with a small paragraph floating on the right. Stack headline, text, and action
- No hairline under every table row (the dashboard is the one exception)
- No accent bar on the left edge of rounded cards
- No bento grid with empty cells
- On a landing page, no layout used twice. Each section takes a different shape

### Labels and ornaments

- At most one small eyebrow label per three sections, and never a numbered one (`01 / Overview`, `Phase 01`)
- No numbered markers unless the content really is an ordered sequence
- At most one middle dot `·` per line
- No version or status badges in a heading (`BETA`, `v0.6`, `EARLY ACCESS`)
- No decorative colored dots, no pills laid over images
- No scroll cues, no text strips under the hero (`DESIGN · BUILD · SHIP`), no locale, time, or build footers
- No UI drawn with divs to look like a screenshot, terminal, or dashboard. Use a real screenshot, a real chart, or nothing
- No hand-drawn SVG illustrations

### Writing

- The `h1` states the conclusion or the decision, not the topic. `指摘2件、うち1件はマージ前に直す`, not `コードレビュー結果`
- Section headings say what the section found. `原因は再試行の上限が0だったこと`, not `原因分析`
- Use numbers, names, paths, and dates instead of adjectives. `p95 が 840ms から 210ms`, not `大幅に高速化`
- Numbers are the measured ones, messy as they are (`47.2%`). No round or perfect-looking figures you did not measure (`99.99%`, `50%`, `10x`)
- No stock phrases. Japanese: `〜することができます`, `シームレス`, `革新的`, `〜を実現します`, `さまざまな`, `〜と言えるでしょう`, `いかがでしたか`, `まとめると`, `次世代`. English: `seamless`, `cutting-edge`, `unlock`, `empower`, `leverage`, `delve`, `elevate`, `next-gen`, `revolutionize`, `in today's fast-paced`
- No placeholder people or companies (`John Doe`, `Acme`, `山田太郎`). Use the real names or leave the slot out
- No em dash or en dash. Use a hyphen, `、`, `:`, or two sentences
- No padding by threes. List as many items as exist: two, four, or one
- No one-line explainer under a heading that only restates it
- One register per page. Do not mix `です・ます` and `だ・である`
- One call to action per intent. `決めてほしいこと` and `ご判断ください` side by side is the same button twice
- No summary line at the end that repeats the page. End on the next action or the open question
- No "not X but Y" framing. Short, direct sentences
- When something is unknown, say it is unknown. Do not smooth it over

---

## Type: Plan (landing page)

**Use it when** the reader has to decide on something: a proposal, a plan, a feature pitch, a direction change.

**Required sections, in order**

1. Hero: `h1` = the proposal in one sentence, at most two lines → one sentence on who benefits and what changes (at most about 60 full-width characters) → one primary button that jumps to the decisions → a full-width visual below
2. The problem: one real number, large, with two or three sentences beside it
3. The proposal: what gets built, as short points in a grid (as many as exist)
4. What changes: today and after, side by side
5. Plan and cost: dates, effort, and what it depends on, as a timeline
6. Decisions needed: a band with each question and its recommended answer. The hero button lands here

Author and date go in a one-line footer at the bottom, not above the headline.

**Hero rules**

- Four text elements at most: headline, sentence, button, and nothing else. No eyebrow, no meta line, no tagline under the button, no trust strip
- The headline, sentence, and button fit in the first screen at 1280×800 and at 375px wide
- The visual is real: a screenshot of the prototype or the current screen, a photo, or a real chart made with the `dataviz` skill, embedded as a data URI. If none exists, leave the visual out; never draw a fake UI with divs
- The button label is three words or fewer and stays on one line

**Section rules**

- Section headings are short: about 16 full-width characters or 8 words. The sentence under them is at most about 60 full-width characters or 25 words
- Every section uses a different layout. The skeleton already does: stat split, point grid, side-by-side panels, timeline, band

**Tone**: confident and specific. Persuasion comes from the numbers and the visual, not from adjectives.

**Layout**: `max-width` 1120px, left-aligned. Sections are separated by 64 to 112px of space, not by rules. Everything stacks to one column under 720px.

<!-- skeleton:plan:start -->
```html
<title>{Proposal name}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans+JP:wght@400;500;700&display=swap">
<style>
/* @base */
.page.lp { max-width: 1120px; padding-inline: clamp(16px, 5vw, 56px); padding-block: 0 40px; gap: 0; }
.lp section { padding-block: clamp(64px, 10vw, 112px) 0; display: flex; flex-direction: column; gap: 20px; }
.lp h2 { margin: 0; font-size: clamp(24px, 3.2vw, 34px); line-height: 1.3; }
.lp .sub { font-size: 16px; color: var(--text-2); max-width: 34em; }
.hero { padding-block: clamp(56px, 9vw, 96px) 0; display: flex; flex-direction: column; gap: 22px; }
.hero h1 { font-size: clamp(34px, 5.6vw, 64px); line-height: 1.15; color: var(--text); max-width: 15em; }
.hero .sub { font-size: clamp(16px, 1.6vw, 19px); }
.cta { align-self: flex-start; padding: 12px 22px; border-radius: var(--radius); background: var(--accent); color: var(--accent-ink); font-weight: 700; text-decoration: none; white-space: nowrap; }
.cta:active { transform: translateY(1px); }
.hero-visual { margin: clamp(24px, 4vw, 48px) 0 0; max-height: 480px; overflow: hidden; border: 1px solid var(--rule); border-bottom: 0; border-radius: var(--radius) var(--radius) 0 0; }
.hero-visual img { display: block; width: 100%; height: auto; }
.lp .problem { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr); gap: clamp(24px, 5vw, 64px); align-items: end; }
.lp .problem > div { display: flex; flex-direction: column; gap: 12px; }
.stat { font: 500 clamp(56px, 10vw, 120px)/1 var(--font-mono); color: var(--accent); font-variant-numeric: tabular-nums; }
.points { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 28px 40px; margin-top: 8px; }
.points h3 { margin: 0 0 4px; font-size: 18px; }
.compare { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 8px; }
.compare > div { display: flex; flex-direction: column; gap: 8px; padding: 24px; border: 1px solid transparent; border-radius: var(--radius); background: var(--surface); }
.compare .after { border-color: var(--accent); }
.compare .label { font-size: 13px; font-weight: 500; color: var(--muted); }
.timeline { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 14px; max-width: none; margin-top: 8px; }
.timeline li { display: grid; grid-template-columns: 7.5em minmax(0, 1fr) auto; gap: 16px; align-items: baseline; margin: 0; }
.timeline time, .timeline .effort { font-family: var(--font-mono); font-size: 14px; color: var(--muted); font-variant-numeric: tabular-nums; }
.decide { margin-top: clamp(64px, 10vw, 112px); padding: clamp(24px, 5vw, 48px); border-radius: var(--radius); background: var(--surface); display: flex; flex-direction: column; gap: 20px; }
.decide ol { display: flex; flex-direction: column; gap: 16px; max-width: 44em; }
.decide li { margin: 0; }
.decide li p { color: var(--text-2); margin-top: 4px; }
.lp footer { margin-top: 40px; }
@media (max-width: 720px) {
  .lp .problem, .compare { grid-template-columns: 1fr; }
  .timeline li { grid-template-columns: 1fr auto; }
  .timeline time { grid-column: 1 / -1; }
}
</style>
<div class="page lp" lang="{language code}">
  <header class="hero">
    <h1>{The proposal in one sentence}</h1>
    <p class="sub">{Who benefits, and what changes for them}</p>
    <a class="cta" href="#decide">{Label: decisions}</a>
    <figure class="hero-visual"><img src="{data URI of a real screenshot, photo, or chart}" alt="{What the visual shows}"></figure>
  </header>

  <section class="problem">
    <p class="stat">{Measured number}</p>
    <div>
      <h2>{What is wrong today, as a finding}</h2>
      <p class="sub">{Where the number comes from, and what it costs}</p>
    </div>
  </section>

  <section>
    <h2>{What we build, as a finding}</h2>
    <div class="points">
      <div><h3>{Point}</h3><p class="sub">{One sentence}</p></div>
      <div><h3>{Point}</h3><p class="sub">{One sentence}</p></div>
    </div>
  </section>

  <section>
    <h2>{What changes, as a finding}</h2>
    <div class="compare">
      <div><span class="label">{Label: today}</span><p>{How it works now}</p></div>
      <div class="after"><span class="label">{Label: after}</span><p>{How it works after}</p></div>
    </div>
  </section>

  <section>
    <h2>{When it lands, and what it costs}</h2>
    <ol class="timeline">
      <li><time>{YYYY-MM-DD}</time><span>{Milestone}</span><span class="effort">{n days}</span></li>
      <li><time>{YYYY-MM-DD}</time><span>{Milestone}</span><span class="effort">{n days}</span></li>
    </ol>
  </section>

  <div class="decide" id="decide">
    <h2>{Decisions needed, and by when}</h2>
    <ol>
      <li><b>{Question}</b><p><span class="pill info">{Label: recommended}</span> {Recommended answer and why}</p></li>
    </ol>
  </div>

  <footer class="meta">{Author} · {YYYY-MM-DD}</footer>
</div>
```
<!-- skeleton:plan:end -->

---

## Type: Review report (technical report)

**Use it when** reporting findings on code or a document: code review, security review, audit.

**Required sections, in order**

1. Meta line (target and date) → `h1` = the count and what must happen (`指摘2件、うち1件はマージ前に直す`) → lead = the most important finding in one sentence
2. Facts: what was read, how (tool / lenses), what was not read
3. Findings table: severity pill, location (`file:line` in mono), the finding in one line, adopted or dropped
4. Details per finding: location as `h3`, what breaks and under which input, suggested fix (code block)
5. Out of scope / not read, if anything

**Tone**: technical and flat. Each finding names a failing input or a concrete consequence; no "might want to consider".

**Layout**: standard 760px column. The table carries the page; details follow in the same order as the table, separated by space, not rules.

<!-- skeleton:review:start -->
```html
<title>{Target} review</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans+JP:wght@400;500;700&display=swap">
<style>
/* @base */
.findings { display: flex; flex-direction: column; gap: 28px; margin-top: 4px; }
.finding { display: flex; flex-direction: column; gap: 8px; }
.finding h3 { margin: 0; display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; }
.finding h3 code { font-weight: 500; }
</style>
<div class="page" lang="{language code}">
  <p class="meta">{PR #n or commit} · {YYYY-MM-DD}</p>
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
  <div class="findings">
    <section class="finding">
      <h3><span class="pill crit">{High}</span><code>{path/to/file.py:88}</code></h3>
      <p>{The failing input and what happens}</p>
      <pre><code>{Suggested fix}</code></pre>
    </section>
  </div>
</div>
```
<!-- skeleton:review:end -->

---

## Type: Investigation, report form

**Use it when** the page answers one question: why did X happen, which option is better, what does this codebase do.
Pick this form when the value is in the explanation. Pick the dashboard form when the value is in scanning many items or numbers.

**Required sections, in order**

1. Meta line (date and sources) → `h1` = the answer → lead = the answer's main reason
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
.answer { display: flex; flex-direction: column; gap: 10px; padding-bottom: 12px; }
</style>
<div class="page" lang="{language code}">
  <header class="answer">
    <p class="meta">{YYYY-MM-DD} · {Sources: repo, logs, docs}</p>
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
2. Key numbers: two to four tiles, each with label, value, and change from the previous period. Only numbers the reader acts on
3. Needs attention: the items in a bad state, worst first, each with a state pill and the next action
4. Full list: every item in a table, sortable by eye (state column first)

**Tone**: terse labels, no prose paragraphs above the fold.

**Layout**: widens to 1040px. Tiles in an auto-fit grid (`minmax(160px, 1fr)`) so they wrap on a phone. Tiles are the one place the base allows a surface box. This is the dense type: the full list gets 1px row dividers and every number is mono.

<!-- skeleton:investigation-dashboard:start -->
```html
<title>{Subject} status</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans+JP:wght@400;500;700&display=swap">
<style>
/* @base */
.page { max-width: 1040px; }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-top: 8px; }
.tile { display: flex; flex-direction: column; gap: 2px; padding: 14px 16px; background: var(--surface); border: 1px solid var(--rule-soft); border-radius: var(--radius); }
.tile .label { font-size: 12px; font-weight: 500; color: var(--muted); }
.tile .value { font-family: var(--font-mono); font-size: 26px; font-weight: 500; font-variant-numeric: tabular-nums; line-height: 1.3; }
.tile .delta { font-family: var(--font-mono); font-size: 12px; color: var(--muted); }
.attention { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 8px; max-width: none; }
.attention li { display: flex; flex-wrap: wrap; align-items: baseline; gap: 10px; margin: 0; }
table.dense td { padding-block: 8px; border-top: 1px solid var(--rule-soft); }
table.dense .num { font-family: var(--font-mono); }
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
  <div class="table-wrap"><table class="dense">
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

1. Meta line (Issue and PR) → `h1` = what shipped and where it stopped (`ダークモードを実装し、draft PR #124 まで`) → lead = what the user can now do
2. Facts: agreed goal, reached point, PR, branch
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
.shots img { width: 100%; height: auto; border: 1px solid var(--rule); border-radius: var(--radius); cursor: zoom-in; }
.shots figcaption { font-size: 12px; color: var(--muted); }
@media (max-width: 640px) { .shots { grid-template-columns: 1fr; } }
.lightbox { padding: 0; border: 0; background: transparent; max-width: 100vw; max-height: 100vh; }
.lightbox::backdrop { background: var(--overlay); }
.lightbox img { display: block; max-width: 95vw; max-height: 95vh; width: auto; height: auto; object-fit: contain; }
.lightbox button { position: fixed; top: calc(12px + env(safe-area-inset-top, 0px)); right: 12px; padding: 4px 12px; font: 500 13px var(--font-sans); color: var(--text); background: var(--surface); border: 1px solid var(--rule); border-radius: var(--radius); cursor: pointer; }
body.lightbox-open { overflow: hidden; }
</style>
<div class="page" lang="{language code}">
  <p class="meta">{Issue #n} · {PR #n}</p>
  <h1>{What shipped, and where it stopped}</h1>
  <p class="lead">{What the user can do now}</p>

  <dl class="facts">
    <dt>{Label: agreed goal}</dt><dd>{Up to PR}</dd>
    <dt>{Label: reached}</dt><dd>{Draft PR created}</dd>
    <dt>{Label: PR}</dt><dd><a href="{PR URL}">{#n}</a></dd>
    <dt>{Label: branch}</dt><dd><code>{branch}</code></dd>
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
