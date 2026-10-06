// Issue 本文のチェックリストと、gh コマンドが指す Issue を読み取る純粋関数。
// 描画（acceptance.tsx）から切り離して、解析だけをテストできるようにしている。
import type { ChecklistGroup, ChecklistItem, Lang, TrackedIssue } from '../types'

/**
 * 受け入れ条件の見出し。create-issue のテンプレートの見出しと、その英訳。
 * 見出し全体で比べる（`Non-acceptance criteria` を拾わない）。後ろの補足のカッコだけは許す
 */
const ACCEPTANCE_HEADING =
  /^(受け入れ条件|受入条件|完了条件|acceptance criteria|definition of done)\s*(\(.*\)|（.*）)?\s*:?$/i

/** フェンスの行。記号の並びと、その後ろ（info 文字列）を取る */
const FENCE = /^\s{0,3}(`{3,}|~{3,})(.*)$/
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/
const ITEM = /^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\]\s+(.*)$/

/** 項目の文からマークダウンの記号を落として1行にする。 */
export const plainText = (text: string): string =>
  text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|~~|`)/g, '')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * 本文のチェックリストを見出しごとにまとめる。コードフェンスの中は数えない。
 * 受け入れ条件のグループを先頭に、残りは本文の順に並べる。
 */
export const parseChecklist = (body: string): ChecklistGroup[] => {
  const groups: ChecklistGroup[] = []
  let heading: string | null = null
  // 受け入れ条件の見出しの深さ。その下の小見出し（`### 機能` など）も受け入れ条件として数える
  let acceptanceLevel: number | null = null
  let current: ChecklistItem[] | null = null
  // 開いているフェンスの記号の並び（CommonMark と同じく、同じ記号で同じ長さ以上の行が閉じる）
  let fence: string | null = null

  // HTML コメントの中は GitHub に表示されないので数えない。フェンスの中の `<!--` は例示なので数えない対象にしない
  let isInComment = false
  for (const raw of body.split(/\r?\n/)) {
    let line = raw
    if (isInComment) {
      const end = line.indexOf('-->')
      if (end < 0) continue
      isInComment = false
      line = line.slice(end + 3)
    }
    const f = FENCE.exec(line)
    if (fence === null && f === null && line.includes('<!--')) {
      line = line.replace(/<!--[\s\S]*?-->/g, '')
      const open = line.indexOf('<!--')
      if (open >= 0) {
        isInComment = true
        line = line.slice(0, open)
      }
    }
    if (fence !== null) {
      const closes = f !== null && f[1]?.[0] === fence[0] && (f[1]?.length ?? 0) >= fence.length && f[2]?.trim() === ''
      if (closes) fence = null
      continue
    }
    // バッククォートのフェンスは info 文字列にバッククォートを含まない（行頭のインラインコードと区別する）
    if (f !== null && !(f[1]?.startsWith('`') && f[2]?.includes('`'))) {
      fence = f[1] ?? null
      continue
    }

    const h = HEADING.exec(line)
    if (h !== null) {
      const level = h[1]?.length ?? 1
      heading = plainText(h[2] ?? '')
      if (ACCEPTANCE_HEADING.test(heading)) acceptanceLevel = level
      else if (acceptanceLevel !== null && level <= acceptanceLevel) acceptanceLevel = null
      current = null
      continue
    }
    const item = ITEM.exec(line)
    if (item === null) continue
    if (current === null) {
      current = []
      groups.push({ heading, isAcceptance: acceptanceLevel !== null, items: current })
    }
    current.push({ text: plainText(item[2] ?? ''), isDone: item[1] !== ' ' })
  }

  return [...groups.filter(g => g.isAcceptance), ...groups.filter(g => !g.isAcceptance)]
}

/**
 * 進捗として大きく出すグループ。受け入れ条件の見出しがあればそれだけ、
 * 無ければ全部のチェックリスト。
 */
export const mainGroups = (groups: readonly ChecklistGroup[]): ChecklistGroup[] => {
  const acceptance = groups.filter(g => g.isAcceptance)
  return acceptance.length > 0 ? acceptance : [...groups]
}

/** グループの項目のうち、済んだ数と全体の数。 */
export const countItems = (groups: readonly ChecklistGroup[]): { done: number; total: number } => {
  const items = groups.flatMap(g => g.items)
  return { done: items.filter(i => i.isDone).length, total: items.length }
}

export type IssueRef = { repo: string | null; number: number }

const ISSUE_URL = /https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/(\d+)/
const REPO = /^[\w.-]+\/[\w.-]+$/

/** Issue の URL からリポジトリと番号を取る。 */
export const refFromUrl = (text: string): IssueRef | null => {
  const m = ISSUE_URL.exec(text)
  return m === null ? null : { repo: m[1] ?? null, number: Number(m[2]) }
}

/** 値を取るフラグ（`-R owner/repo` の `-R` など）。この直後の語は Issue 番号として読まない */
const VALUE_FLAGS = new Set([
  '-R', '--repo', '--json', '-q', '--jq', '-t', '--template', '--title', '-b', '--body', '-F', '--body-file',
  '--add-label', '--remove-label', '--add-assignee', '--remove-assignee', '--add-project', '--remove-project',
  '-m', '--milestone', '-e', '--editor-cmd',
])

/**
 * `gh issue view|edit|comment <N>` が指す Issue。番号を書いていないコマンド
 * （ブランチから推定する形など）と、別のコマンドは null。
 */
export const refFromCommand = (command: string): IssueRef | null => {
  // 1行目だけを読む。2行目以降は heredoc の本文やエコーした文のことがあり、
  // そこに書かれた `gh issue view 1 -R ...` を実行されたコマンドとして読まないため
  const firstLine = command.split(/\r?\n/, 1)[0] ?? ''
  // 引用符の中（タイトルや本文）の数字を番号と取り違えないよう、先に1語の印に置き換える。
  // 消してしまうと `--title "…" 7` の値が無くなり、番号の 7 をフラグの値として読み飛ばす。
  // `--repo "acme/app"` のように空白を含まない値は、引用符だけを外して残す
  const bare = firstLine.replace(/"(?:\\.|[^"\\])*"|'[^']*'/g, q => {
    const inner = q.slice(1, -1)
    return /^[\w.\/#:-]+$/.test(inner) ? inner : ' _ '
  })
  // コマンドの位置（行頭か、`&&` `;` `|` の直後）にある gh だけを読む
  const m = /(?:^|&&|\|\||[;|])\s*gh\s+issue\s+(?:view|edit|comment)\b(.*)/.exec(bare)
  if (m === null) return null
  // gh より前で `cd` したり GH_REPO を渡したりしたコマンドは、どのリポジトリを指すか分からない。
  // セッションのカレントで読むと別のリポジトリの同じ番号を出すので、-R か URL が無ければ読まない
  const before = bare.slice(0, m.index + m[0].search(/gh\s/))
  const isElsewhere = /(?:^|[\s;&|])(?:cd|pushd)\s|\bGH_REPO=/.test(before)
  const tokens = (m[1] ?? '').split(/\s*(?:\|\||&&|[|;&])\s*/)[0]?.split(/\s+/).filter(Boolean) ?? []

  let repo: string | null = null
  let ref: IssueRef | null = null
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] ?? ''
    const [flag, inline] = t.split('=', 2) as [string, string | undefined]
    if (flag === '-R' || flag === '--repo') {
      repo = inline ?? tokens[i + 1] ?? null
      if (inline === undefined) i++
      continue
    }
    if (VALUE_FLAGS.has(flag)) {
      if (inline === undefined) i++
      continue
    }
    if (ref !== null || t.startsWith('-')) continue
    const n = /^#?(\d+)$/.exec(t)?.[1]
    ref = n !== undefined ? { repo: null, number: Number(n) } : refFromUrl(t)
  }
  if (ref === null) return null
  // `-R` は `owner/repo` の形だけを受け付ける。gh は `HOST/OWNER/REPO` も読むので、
  // 形を確かめないと任意のホストへ gh が問い合わせる
  const repoOk = repo === null || REPO.test(repo)
  if (ref.repo === null && !repoOk) return null
  const resolved = ref.repo ?? repo
  if (resolved === null && isElsewhere) return null

  return { repo: resolved, number: ref.number }
}

/** 本文を読み直す gh コマンドの引数。 */
export const viewArgv = (ref: IssueRef): string[] => [
  'gh',
  'issue',
  'view',
  String(ref.number),
  ...(ref.repo === null ? [] : ['-R', ref.repo]),
  '--json',
  'number,title,body,url',
]

/** Issue が無い・見られない失敗か（ネットワークや認証の失敗と分ける）。 */
export const isNotFound = (stderr: string): boolean =>
  // `command not found`（gh が無い）などの汎用の not found は含めない。それは failed として前回の表示を残す
  /could not resolve to an? (issue|pullrequest|repository)|http 404|is a pull request/i.test(stderr)

/**
 * `gh issue view --json number,title,body,url` の出力を表示用に組み立てる。
 * 読めない出力は null。
 */
export const issueFromJson = (stdout: string): TrackedIssue | null => {
  let data: unknown
  try {
    data = JSON.parse(stdout)
  } catch {
    return null
  }
  if (data === null || typeof data !== 'object') return null
  const { number, title, body, url } = data as Record<string, unknown>
  if (typeof number !== 'number' || typeof url !== 'string') return null

  return {
    repo: refFromUrl(url)?.repo ?? null,
    number,
    title: typeof title === 'string' ? title : '',
    url,
    groups: parseChecklist(typeof body === 'string' ? body : ''),
    error: null,
  }
}

/** `/acceptance` の引数。 */
export type CommandArg = { kind: 'refresh' } | { kind: 'off' } | { kind: 'on' } | { kind: 'show'; ref: IssueRef } | { kind: 'usage' }

export const parseCommandArg = (args: string): CommandArg => {
  const a = args.trim()
  if (a === '') return { kind: 'refresh' }
  if (/^(off|hide)$/i.test(a)) return { kind: 'off' }
  if (/^(on|show)$/i.test(a)) return { kind: 'on' }
  const n = /^#?(\d+)$/.exec(a)?.[1]
  if (n !== undefined) return { kind: 'show', ref: { repo: null, number: Number(n) } }
  const short = /^([\w.-]+\/[\w.-]+)#(\d+)$/.exec(a)
  if (short !== null) return { kind: 'show', ref: { repo: short[1] ?? null, number: Number(short[2]) } }
  const url = refFromUrl(a)
  return url === null ? { kind: 'usage' } : { kind: 'show', ref: url }
}

/** 文字列に日本語（かな・漢字）が入っているか。 */
export const hasJapanese = (text: string): boolean => /[぀-ヿ一-鿿]/.test(text)

/** settings の `language` から表示言語を決める。決まらなければ null。 */
export const langFromSetting = (language: unknown): Lang | null => {
  if (typeof language !== 'string' || language.trim() === '') return null
  return /^(ja([-_].*)?|日本語?|japanese)$/i.test(language.trim()) ? 'ja' : 'en'
}

/** `done / total` の進捗バー。 */
export const bar = (done: number, total: number, width: number): string => {
  const filled = total === 0 ? 0 : Math.round((done / total) * width)
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled))
}

export const LABELS = {
  ja: {
    acceptance: '受け入れ条件',
    other: 'チェック',
    noHeading: '（見出しなし）',
    allDone: 'すべて完了',
    more: (n: number) => `ほか ${n} 件`,
    failed: '読み直しに失敗',
    usage: '使い方: /acceptance [Issue 番号 | owner/repo#N | URL | off | on]',
    hidden: '受け入れ条件の表示を隠しました。/acceptance on で戻します',
    shown: '受け入れ条件の表示を戻しました',
    none: 'まだ Issue を読んでいません。/acceptance <番号> で指定できます',
    noChecklist: (n: number) => `#${n} にチェックリストがありません`,
    notFound: (n: number) => `#${n} が見つからないか、見る権限がありません`,
    fetchFailed: (n: number) => `#${n} の本文を読めませんでした`,
    showing: (n: number, done: number, total: number) => `#${n} の受け入れ条件 ${done}/${total}`,
  },
  en: {
    acceptance: 'Acceptance criteria',
    other: 'Checklist',
    noHeading: '(no heading)',
    allDone: 'All done',
    more: (n: number) => `${n} more`,
    failed: 'refresh failed',
    usage: 'Usage: /acceptance [issue number | owner/repo#N | URL | off | on]',
    hidden: 'Hid the acceptance criteria. /acceptance on brings them back',
    shown: 'Showing the acceptance criteria again',
    none: 'No issue read yet. Pick one with /acceptance <number>',
    noChecklist: (n: number) => `#${n} has no checklist`,
    notFound: (n: number) => `#${n} was not found, or you cannot see it`,
    fetchFailed: (n: number) => `Could not read #${n}`,
    showing: (n: number, done: number, total: number) => `#${n} acceptance criteria ${done}/${total}`,
  },
} as const
