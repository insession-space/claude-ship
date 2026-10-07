// Bash のコマンド文字列から、残る文章を出すコマンド（gh の PR / Issue、git commit）とその本文を取り出す。
// シェルを完全には解釈しない。内容を確定できない形（変数展開・コマンド置換など）は unknown として返し、
// 呼び出し側はそれを素通しにする。

/** 1語。`isDynamic` は変数展開やコマンド置換を含み、実行時まで中身が決まらない語 */
export type Word = { text: string; isDynamic: boolean }

/** `;` `&&` `|` 改行などで区切った1つの単純コマンド。`stdin` はその行に付いた heredoc / here-string */
export type Segment = { words: Word[]; stdin: string | null }

/** 本文の取り出し元 */
export type BodySource =
  | { kind: 'text'; text: string }
  | { kind: 'file'; path: string }
  | { kind: 'unknown' }

/** 対象のコマンド1つ。`kind` は `gh pr create` / `git commit` など */
export type Target = { kind: string; body: BodySource }

const isSpace = (c: string | undefined) => c === ' ' || c === '\t'

/** 引用符で囲まない区切りの heredoc は、実行時に展開される。展開を含む本文は中身が決まらない */
const hasExpansion = (body: string) => /\$[A-Za-z_{(?!#@*$0-9-]|`/.test(body)
const isName = (c: string | undefined) => c !== undefined && /[A-Za-z0-9_]/.test(c)

/**
 * `$(cat <<'EOF' ... EOF)` の形のコマンド置換を `at` の位置で読む。
 * 読めたら本文と、置換の直後の位置を返す。ほかの形なら null。
 */
const readCatHeredoc = (src: string, at: number): { body: string; isDynamic: boolean; end: number } | null => {
  const head = /\$\(\s*cat\s*<<(-?)\s*(['"]?)([A-Za-z_][\w-]*)\2[ \t]*\n/y
  head.lastIndex = at
  const m = head.exec(src)
  if (m === null) return null
  const strip = m[1] === '-'
  const isQuoted = m[2] !== ''
  const delim = m[3] ?? ''
  const lines: string[] = []
  let pos = head.lastIndex
  for (;;) {
    if (pos > src.length) return null
    const nl = src.indexOf('\n', pos)
    const line = nl === -1 ? src.slice(pos) : src.slice(pos, nl)
    const cmp = strip ? line.replace(/^\t+/, '') : line
    if (cmp.trim() === delim) {
      const tail = /\s*\)/y
      tail.lastIndex = nl === -1 ? src.length : nl
      const t = tail.exec(src)
      if (t === null) return null
      const body = lines.join('\n')
      return { body, isDynamic: !isQuoted && hasExpansion(body), end: tail.lastIndex }
    }
    lines.push(strip ? line.replace(/^\t+/, '') : line)
    if (nl === -1) return null
    pos = nl + 1
  }
}

/** `$(` から対応する `)` の直後までを読み飛ばす（引用符の中の括弧は数えない） */
const skipSubst = (src: string, at: number): number => {
  let depth = 0
  let i = at + 1
  while (i < src.length) {
    const c = src[i]
    if (c === '\\') i += 2
    else if (c === "'") {
      const close = src.indexOf("'", i + 1)
      i = close === -1 ? src.length : close + 1
    } else if (c === '(') {
      depth++
      i++
    } else if (c === ')') {
      depth--
      i++
      if (depth === 0) return i
    } else i++
  }
  return src.length
}

/** `$` で始まる展開を `at` の位置で読む。heredoc の cat なら本文を返し、ほかは動的な語として読み飛ばす */
const readDollar = (src: string, at: number): { text: string; isDynamic: boolean; end: number } => {
  const next = src[at + 1]
  if (next === '(') {
    const hd = readCatHeredoc(src, at)
    if (hd !== null) return { text: hd.body, isDynamic: hd.isDynamic, end: hd.end }
    return { text: '', isDynamic: true, end: skipSubst(src, at) }
  }
  if (next === '{') {
    const close = src.indexOf('}', at + 2)
    return { text: '', isDynamic: true, end: close === -1 ? src.length : close + 1 }
  }
  if (isName(next) || (next !== undefined && '?!#@*$-'.includes(next))) {
    let i = at + 2
    if (isName(next)) while (isName(src[i])) i++
    return { text: '', isDynamic: true, end: i }
  }
  return { text: '$', isDynamic: false, end: at + 1 }
}

const ANSI_C: Record<string, string> = { n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"', a: '\x07', e: '\x1b' }

/**
 * コマンド文字列を単純コマンドの並びに分ける。引用符・エスケープ・heredoc・`$(cat <<EOF)` を読み、
 * リダイレクトの行き先は語から外す。
 */
export const splitCommand = (src: string): Segment[] => {
  const segments: Segment[] = []
  let seg: Segment = { words: [], stdin: null }
  let word: Word | null = null
  let redirectNext = false
  let herestringNext = false
  const pending: { seg: Segment; delim: string; strip: boolean; isQuoted: boolean }[] = []

  const endWord = () => {
    if (word === null) return
    if (herestringNext) {
      seg.stdin = word.isDynamic ? null : word.text
      herestringNext = false
    } else if (redirectNext) {
      redirectNext = false
    } else seg.words.push(word)
    word = null
  }
  const endSegment = () => {
    endWord()
    if (seg.words.length > 0 || seg.stdin !== null || pending.some(p => p.seg === seg)) segments.push(seg)
    seg = { words: [], stdin: null }
  }
  const w = (): Word => (word ??= { text: '', isDynamic: false })

  let i = 0
  while (i < src.length) {
    const c = src[i] as string
    if (isSpace(c)) {
      endWord()
      i++
    } else if (c === '\n') {
      endSegment()
      i++
      // この行で始まった heredoc の本文を読む
      while (pending.length > 0) {
        const p = pending.shift()!
        const lines: string[] = []
        let closed = false
        while (i <= src.length) {
          const nl = src.indexOf('\n', i)
          const line = nl === -1 ? src.slice(i) : src.slice(i, nl)
          i = nl === -1 ? src.length + 1 : nl + 1
          const cmp = p.strip ? line.replace(/^\t+/, '') : line
          if (cmp === p.delim) {
            closed = true
            break
          }
          lines.push(cmp)
          if (nl === -1) break
        }
        const body = lines.join('\n')
        p.seg.stdin = closed && (p.isQuoted || !hasExpansion(body)) ? body : null
      }
    } else if (c === '#' && word === null) {
      const nl = src.indexOf('\n', i)
      i = nl === -1 ? src.length : nl
    } else if (c === ';' || c === '&' || c === '|' || c === '(' || c === ')') {
      if (c === '&' && src[i - 1] === '>') {
        i++
        continue
      }
      endSegment()
      i++
    } else if (c === '<' && src[i + 1] === '<' && src[i + 2] === '<') {
      endWord()
      herestringNext = true
      i += 3
    } else if (c === '<' && src[i + 1] === '<') {
      endWord()
      i += 2
      const strip = src[i] === '-'
      if (strip) i++
      while (isSpace(src[i])) i++
      const m = /(['"]?)([^\s'";&|<>()]+)\1/y
      m.lastIndex = i
      const got = m.exec(src)
      if (got === null) continue
      pending.push({ seg, delim: got[2] ?? '', strip, isQuoted: got[1] !== '' })
      i = m.lastIndex
    } else if (c === '<' || c === '>') {
      // `2>` のような番号付きのリダイレクトは、直前の数字を語にしない
      // word は閉じ込めた関数の中でも書き換えるため、TypeScript の絞り込みに頼らずに読む
      const before = word as Word | null
      if (before !== null && /^\d+$/.test(before.text) && !before.isDynamic) word = null
      endWord()
      i++
      while (src[i] === '>' || src[i] === '&') i++
      while (isSpace(src[i])) i++
      // `>&2` のように番号だけを指すものは行き先の語を持たない
      if (/\d/.test(src[i] ?? '') && !/\S/.test(src[i + 1] ?? ' ')) {
        i++
        continue
      }
      redirectNext = true
    } else if (c === '\\') {
      if (src[i + 1] === '\n') i += 2
      else {
        w().text += src[i + 1] ?? ''
        i += 2
      }
    } else if (c === "'") {
      const close = src.indexOf("'", i + 1)
      const end = close === -1 ? src.length : close
      w().text += src.slice(i + 1, end)
      i = end + 1
    } else if (c === '$' && src[i + 1] === "'") {
      i += 2
      const cur = w()
      while (i < src.length && src[i] !== "'") {
        if (src[i] === '\\') {
          cur.text += ANSI_C[src[i + 1] ?? ''] ?? src[i + 1] ?? ''
          i += 2
        } else cur.text += src[i++]
      }
      i++
    } else if (c === '"') {
      i++
      const cur = w()
      while (i < src.length && src[i] !== '"') {
        const d = src[i] as string
        if (d === '\\' && src[i + 1] !== undefined && '"\\$`\n'.includes(src[i + 1] as string)) {
          if (src[i + 1] !== '\n') cur.text += src[i + 1]
          i += 2
        } else if (d === '$') {
          const got = readDollar(src, i)
          cur.text += got.text
          cur.isDynamic ||= got.isDynamic
          i = got.end
        } else if (d === '`') {
          const close = src.indexOf('`', i + 1)
          cur.isDynamic = true
          i = close === -1 ? src.length : close + 1
        } else cur.text += src[i++]
      }
      i++
    } else if (c === '$') {
      const got = readDollar(src, i)
      const cur = w()
      cur.text += got.text
      cur.isDynamic ||= got.isDynamic
      i = got.end
    } else if (c === '`') {
      const close = src.indexOf('`', i + 1)
      w().isDynamic = true
      i = close === -1 ? src.length : close + 1
    } else {
      w().text += c
      i++
    }
  }
  endSegment()

  return segments
}

const GH_TARGETS: Record<string, readonly string[]> = {
  pr: ['create', 'edit', 'comment'],
  issue: ['create', 'edit', 'comment'],
}

/** 値を取る git のグローバルオプション */
const GIT_GLOBAL_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path'])

/** 値を取る git commit の短いオプション（本文以外も、値を読み飛ばすために並べる） */
const COMMIT_SHORT_WITH_VALUE = new Set(['m', 'F', 'C', 'c', 't'])
const COMMIT_LONG_WITH_VALUE = new Set([
  '--message',
  '--file',
  '--reuse-message',
  '--reedit-message',
  '--fixup',
  '--squash',
  '--template',
  '--author',
  '--date',
  '--cleanup',
  '--trailer',
  '--pathspec-from-file',
])

const sourceOf = (word: Word, kind: 'text' | 'file'): BodySource => {
  if (word.isDynamic) return { kind: 'unknown' }
  return kind === 'text' ? { kind: 'text', text: word.text } : { kind: 'file', path: word.text }
}

/** gh の `--body` / `-b` / `--body-file` / `-F` を読む。最後に書いたものを使う */
const ghBody = (words: Word[], stdin: string | null): BodySource | null => {
  let body: BodySource | null = null
  const fileOrStdin = (word: Word): BodySource =>
    word.text === '-' && !word.isDynamic ? (stdin === null ? { kind: 'unknown' } : { kind: 'text', text: stdin }) : sourceOf(word, 'file')
  for (let i = 0; i < words.length; i++) {
    const t = (words[i] as Word).text
    const next = words[i + 1]
    if (t === '--') break
    if (t === '--body' || t === '-b') {
      body = next === undefined ? { kind: 'unknown' } : sourceOf(next, 'text')
      i++
    } else if (t === '--body-file' || t === '-F') {
      body = next === undefined ? { kind: 'unknown' } : fileOrStdin(next)
      i++
    } else if (t.startsWith('--body=')) {
      body = sourceOf({ ...(words[i] as Word), text: t.slice('--body='.length) }, 'text')
    } else if (t.startsWith('--body-file=')) {
      body = fileOrStdin({ ...(words[i] as Word), text: t.slice('--body-file='.length) })
    } else if (/^-b./.test(t)) {
      body = sourceOf({ ...(words[i] as Word), text: t.slice(2) }, 'text')
    } else if (/^-F./.test(t)) {
      body = fileOrStdin({ ...(words[i] as Word), text: t.slice(2) })
    }
  }
  return body
}

/** git commit の `-m`（複数なら段落にしてつなぐ）/ `-F` / `--message` / `--file` を読む */
const commitBody = (words: Word[], stdin: string | null): BodySource | null => {
  const messages: Word[] = []
  let file: Word | null = null
  for (let i = 0; i < words.length; i++) {
    const word = words[i] as Word
    const t = word.text
    const next = words[i + 1]
    if (t === '--') break
    if (t.startsWith('--')) {
      const eq = t.indexOf('=')
      const name = eq === -1 ? t : t.slice(0, eq)
      if (!COMMIT_LONG_WITH_VALUE.has(name)) continue
      const value = eq === -1 ? next : { ...word, text: t.slice(eq + 1) }
      if (eq === -1) i++
      if (value === undefined) return { kind: 'unknown' }
      if (name === '--message') messages.push(value)
      else if (name === '--file') file = value
      continue
    }
    if (!/^-[A-Za-z]/.test(t)) continue
    // `-am "..."` のような短いオプションのまとまり。値を取る文字の後ろは値
    for (let j = 1; j < t.length; j++) {
      const ch = t[j] as string
      if (!COMMIT_SHORT_WITH_VALUE.has(ch)) continue
      const rest = t.slice(j + 1)
      let value: Word | undefined
      if (rest !== '') value = { ...word, text: rest }
      else {
        value = next
        i++
      }
      if (value === undefined) return { kind: 'unknown' }
      if (ch === 'm') messages.push(value)
      else if (ch === 'F') file = value
      break
    }
  }
  if (file !== null) {
    if (file.text === '-' && !file.isDynamic) return stdin === null ? { kind: 'unknown' } : { kind: 'text', text: stdin }
    return sourceOf(file, 'file')
  }
  if (messages.length === 0) return null
  if (messages.some(m => m.isDynamic)) return { kind: 'unknown' }
  return { kind: 'text', text: messages.map(m => m.text).join('\n\n') }
}

/** 単純コマンド1つが対象なら、その種類と本文の取り出し元を返す。本文を渡していないコマンドは null */
const targetOf = (segment: Segment): Target | null => {
  const words = [...segment.words]
  // 先頭の `VAR=value` と env / command は読み飛ばす
  while (words.length > 0) {
    const t = (words[0] as Word).text
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t) || t === 'env' || t === 'command') words.shift()
    else break
  }
  const head = words[0]?.text
  if (head === 'gh') {
    const group = words[1]?.text ?? ''
    const verb = words[2]?.text ?? ''
    if (!(GH_TARGETS[group] ?? []).includes(verb)) return null
    const body = ghBody(words.slice(3), segment.stdin)
    return body === null ? null : { kind: `gh ${group} ${verb}`, body }
  }
  if (head === 'git') {
    let i = 1
    while (i < words.length && (words[i] as Word).text.startsWith('-')) {
      i += GIT_GLOBAL_WITH_VALUE.has((words[i] as Word).text) ? 2 : 1
    }
    if (words[i]?.text !== 'commit') return null
    const body = commitBody(words.slice(i + 1), segment.stdin)
    return body === null ? null : { kind: 'git commit', body }
  }
  return null
}

/** コマンド文字列の中の対象コマンドを、書かれた順に返す。 */
export const findTargets = (command: string): Target[] =>
  splitCommand(command)
    .map(targetOf)
    .filter((t): t is Target => t !== null)

/** PR（本文とコメント）の末尾の帰属行とセッション URL */
const PR_ATTRIBUTION = [
  /^\s*🤖 Generated with \[Claude Code\]\(https:\/\/claude\.com\/claude-code\)\s*$/,
  /^\s*https:\/\/claude\.ai\/code\/session_\S+\s*$/,
]

/** コミットのトレーラー */
const COMMIT_TRAILERS = [/^\s*Co-Authored-By:.*$/i, /^\s*Claude-Session:.*$/i]

/** コマンドの種類ごとに検査から外す行 */
const excludedLinesOf = (kind: string): readonly RegExp[] =>
  kind === 'git commit' ? COMMIT_TRAILERS : kind.startsWith('gh pr ') ? PR_ATTRIBUTION : []

/** 除外する行を空行に置き換える。行番号はリンターの指摘とそろえるため保つ */
export const stripExcluded = (kind: string, body: string): string => {
  const excluded = excludedLinesOf(kind)
  return body
    .split('\n')
    .map(line => (excluded.some(re => re.test(line)) ? '' : line))
    .join('\n')
}

/** かなか漢字を含むか */
export const hasJapanese = (text: string): boolean => /[぀-ヿ一-鿿]/.test(text)
