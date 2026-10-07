// session-dashboard の観測と判定（副作用なし）。gh・lsof・docker の出力を読み、台帳の差分と一括停止の判定を行う。
import type { DashboardBaseline, DashboardEntry, DashboardLang, DashboardPr } from '../types'

// ---------- PR ----------

type Check = {
  __typename?: string
  name?: string
  context?: string
  status?: string
  conclusion?: string | null
  state?: string
}

const PASSED = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED'])
const PENDING_STATES = new Set(['PENDING', 'EXPECTED'])

/** statusCheckRollup の1件を passed / failed / pending に振り分ける。 */
export const classifyCheck = (c: Check): 'passed' | 'failed' | 'pending' => {
  if (c.__typename === 'StatusContext' || (c.status === undefined && c.state !== undefined)) {
    const s = c.state ?? ''
    if (s === 'SUCCESS') return 'passed'
    return PENDING_STATES.has(s) ? 'pending' : 'failed'
  }
  if (c.status !== undefined && c.status !== 'COMPLETED') return 'pending'
  return PASSED.has(c.conclusion ?? '') ? 'passed' : 'failed'
}

/** PR の URL から `owner/name` を取る。 */
export const repoFromUrl = (url: string): string | null => {
  const m = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/\d+/.exec(url)
  return m?.[1] ?? null
}

/** `gh pr view --json number,title,state,isDraft,url,statusCheckRollup,reviewDecision` の出力を読む。 */
export const prFromJson = (stdout: string): Omit<DashboardPr, 'unresolved'> | null => {
  try {
    const j = JSON.parse(stdout) as Record<string, unknown>
    const repo = typeof j.url === 'string' ? repoFromUrl(j.url) : null
    if (typeof j.number !== 'number' || repo === null) return null
    let passed = 0
    let failed = 0
    let pending = 0
    const failedNames: string[] = []
    for (const c of Array.isArray(j.statusCheckRollup) ? (j.statusCheckRollup as Check[]) : []) {
      const kind = classifyCheck(c)
      if (kind === 'passed') passed++
      else if (kind === 'pending') pending++
      else {
        failed++
        failedNames.push(c.name ?? c.context ?? '?')
      }
    }
    const state = j.state === 'MERGED' || j.state === 'CLOSED' ? j.state : 'OPEN'
    const d = j.reviewDecision
    const decision = d === 'APPROVED' || d === 'CHANGES_REQUESTED' || d === 'REVIEW_REQUIRED' ? d : null
    return {
      repo,
      number: j.number,
      title: typeof j.title === 'string' ? j.title : '',
      state,
      isDraft: j.isDraft === true,
      passed,
      failed,
      pending,
      failedNames,
      decision,
    }
  } catch {
    return null
  }
}

/** `gh pr view` が失敗したとき、PR が無いだけか（読めなかったのではないか）。 */
export const isNoPr = (stderr: string): boolean =>
  /no pull requests found|not a git repository|could not determine current branch|no default remote/i.test(stderr)

/** `gh api graphql --paginate --slurp` で全ページを読む（`$endCursor` と `pageInfo` は gh のページ送りの決まり） */
export const UNRESOLVED_QUERY =
  'query($owner:String!,$name:String!,$number:Int!,$endCursor:String){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100,after:$endCursor){nodes{isResolved}pageInfo{hasNextPage endCursor}}}}}'

/** GraphQL の応答（`--slurp` ならページの配列）から未解決のスレッド数を数える。読めなければ null。 */
export const unresolvedFromJson = (stdout: string): number | null => {
  try {
    const parsed: unknown = JSON.parse(stdout)
    let count = 0
    for (const page of Array.isArray(parsed) ? parsed : [parsed]) {
      const nodes = (page as { data?: { repository?: { pullRequest?: { reviewThreads?: { nodes?: unknown } } } } })?.data?.repository
        ?.pullRequest?.reviewThreads?.nodes
      if (!Array.isArray(nodes)) return null
      count += nodes.filter((n: { isResolved?: boolean }) => n?.isResolved === false).length
    }
    return count
  } catch {
    return null
  }
}

// ---------- 台帳 ----------

export type Seen = Omit<DashboardEntry, 'since'>

/** `lsof -nP -iTCP -sTCP:LISTEN` の出力から、待ち受けポートを1つ1件で読む（IPv4 と IPv6 は1件にまとめる）。 */
export const portsFromLsof = (stdout: string): Seen[] => {
  const byKey = new Map<string, Seen>()
  for (const line of stdout.split('\n').slice(1)) {
    const cols = line.trim().split(/\s+/)
    // 末尾は `(LISTEN)`、その前が `*:5173` や `[::1]:5173`
    const addr = cols[cols.length - 1] === '(LISTEN)' ? cols[cols.length - 2] : undefined
    const port = addr === undefined ? undefined : /:(\d+)$/.exec(addr)?.[1]
    if (port === undefined) continue
    const key = `port:${port}`
    if (!byKey.has(key)) byKey.set(key, { key, kind: 'port', label: `:${port}`, detail: (cols[0] ?? '?').replace(/\\x20/g, ' ') })
  }
  return [...byKey.values()]
}

/** `docker ps --format '{{.ID}}\t{{.Names}}\t{{.Image}}'` の出力を読む。 */
export const containersFromDocker = (stdout: string): Seen[] =>
  stdout
    .split('\n')
    .map(line => line.split('\t'))
    .filter((cols): cols is [string, string, ...string[]] => cols.length >= 2 && cols[0] !== '' && cols[1] !== '')
    .map(([id, name, image]) => ({ key: `docker:${id}`, kind: 'docker' as const, label: name, detail: image ?? '' }))

/** 1回の観測。取得に失敗した種類は null。 */
export type Snapshot = { ports: Seen[] | null; containers: Seen[] | null }

/** 基準の無い種類は、今回読めた分を基準にする。 */
export const fillBaseline = (base: DashboardBaseline | null, snap: Snapshot): DashboardBaseline => ({
  ports: base?.ports ?? snap.ports?.map(s => s.key) ?? null,
  containers: base?.containers ?? snap.containers?.map(s => s.key) ?? null,
})

/**
 * 基準に無いものだけを台帳に残す。前から載っているものは初めて見た時刻を保つ。
 * 今回読めなかった種類は、前回の台帳の分をそのまま残す（一時的な失敗で消さない）。
 */
export const nextLedger = (base: DashboardBaseline, snap: Snapshot, prev: DashboardEntry[], now: number): DashboardEntry[] => {
  const prevByKey = new Map(prev.map(e => [e.key, e]))
  const pick = (kind: 'port' | 'docker', seen: Seen[] | null, known: string[] | null): DashboardEntry[] => {
    if (seen === null || known === null) return prev.filter(e => e.kind === kind)
    const skip = new Set(known)
    return seen.filter(s => !skip.has(s.key)).map(s => ({ ...s, since: prevByKey.get(s.key)?.since ?? now }))
  }
  return [...pick('port', snap.ports, base.ports), ...pick('docker', snap.containers, base.containers)]
}

export const sameLedger = (a: DashboardEntry[], b: DashboardEntry[]): boolean =>
  a.length === b.length && a.every((e, i) => e.key === b[i]?.key && e.label === b[i]?.label && e.detail === b[i]?.detail)

// ---------- 一括停止のガード ----------

// コマンドの頭: 行頭・; & | ( の後・$( の後と、`bash -c '...'` / `sh -c "..."` の引用符の直後。
// 続く sudo / env などの前置きと `VAR=値` は飛ばす。`echo "pkill -f x"` のような引数の中は頭とみなさない
const HEAD = String.raw`(?:^|[;&|(\n]|\$\(|\b(?:ba|z|da|k)?sh\s+(?:-\S+\s+)*-c\s+['"])\s*(?:(?:sudo|command|env|nohup|exec|time)\s+(?:-\S+\s+)*|[A-Za-z_]\w*=\S*\s+)*`

const PKILL_F = new RegExp(`${HEAD}pkill\\b[^;&|\\n]*\\s(?:-[a-zA-Z0-9]*f[a-zA-Z0-9]*|--full)\\b`)
const KILLALL = new RegExp(`${HEAD}killall\\b`)
const DOCKER = String.raw`docker\s+(?:container\s+)?`
// docker stop/kill/rm $(docker ps -q ...)。--filter / -f で絞ったものは通す
const DOCKER_SUBST = new RegExp(String.raw`${HEAD}${DOCKER}(?:stop|kill|rm)\b[^\n]*\$\(\s*${DOCKER}(?:ps|ls)\b([^)]*)\)`)
// docker ps -q | xargs docker stop
const DOCKER_XARGS = new RegExp(String.raw`${HEAD}${DOCKER}(?:ps|ls)\b([^|\n]*)\|\s*xargs\s+(?:-\S+\s+)*${DOCKER}(?:stop|kill|rm)\b`)

const isUnfilteredQuiet = (args: string) => /\s(?:-[a-zA-Z]*q|--quiet\b)/.test(` ${args}`) && !/(?:--filter|\s-f)\b/.test(` ${args}`)

/** 一括停止の形なら、その種類を返す。 */
export const massKillOf = (command: string): 'pkill' | 'killall' | 'docker' | null => {
  if (PKILL_F.test(command)) return 'pkill'
  if (KILLALL.test(command)) return 'killall'
  const sub = DOCKER_SUBST.exec(command)
  if (sub !== null && isUnfilteredQuiet(sub[1] ?? '')) return 'docker'
  const xa = DOCKER_XARGS.exec(command)
  if (xa !== null && isUnfilteredQuiet(xa[1] ?? '')) return 'docker'
  return null
}

// ---------- 表示 ----------

export const hasJapanese = (text: string) => /[぀-ヿ㐀-鿿]/.test(text)

export const langFromSetting = (language: unknown): DashboardLang | null => {
  if (typeof language !== 'string' || language.trim() === '') return null
  return /^(ja|japanese)\b|日本語/i.test(language.trim()) ? 'ja' : 'en'
}

/** 経過時間を短く書く。 */
export const elapsed = (ms: number, lang: DashboardLang): string => {
  const m = Math.max(0, Math.floor(ms / 60_000))
  if (lang === 'ja') return m < 1 ? '1分未満' : m < 60 ? `${m}分` : `${Math.floor(m / 60)}時間${m % 60}分`
  return m < 1 ? '<1m' : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60}m`
}

export const bar = (done: number, total: number, width: number) => {
  const filled = total === 0 ? 0 : Math.round((done / total) * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

/** 表示幅（全角は2桁）に合わせて末尾を詰める。 */
export const padCells = (text: string, width: number): string => {
  let out = ''
  let used = 0
  for (const ch of text) {
    const w = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch) ? 2 : 1
    if (used + w > width) {
      out = `${out.slice(0, -1)}…`
      used = width
      break
    }
    out += ch
    used += w
  }
  return out + ' '.repeat(Math.max(0, width - used))
}

const PHASES = {
  ja: ['到達点を決める', 'Issue 作成', '実装ループ', '次の一手'],
  en: ['Choosing the goal', 'Creating the issue', 'Implementation loop', 'Next step'],
}

export const LABELS = {
  ja: {
    title: 'セッション',
    needs: (n: number) => `要対応 ${n}`,
    ciFailed: (names: string[]) => `CI 失敗  ${names.join(', ')}`,
    unresolved: (n: number) => `未解決のレビュースレッド ${n} 件`,
    session: 'Session',
    phase: (p: number) => PHASES.ja[p] ?? '?',
    round: (n: number) => `${n}周目`,
    goal: (g: string | null) => `到達点 ${g ?? '未確定'}`,
    issueRef: (n: number) => `Issue #${n}`,
    pr: 'PR',
    noPr: 'PR なし',
    prUnknown: 'PR を読んでいます',
    prError: 'PR を読めません',
    stale: '⚠ 読み直しに失敗',
    draft: 'draft',
    merged: 'マージ済み',
    closed: 'クローズ',
    noChecks: 'CI チェックなし',
    decision: (d: DashboardPr['decision']) => (d === 'APPROVED' ? '承認済み' : d === 'CHANGES_REQUESTED' ? '修正依頼' : 'レビュー待ち'),
    unresolvedShort: (n: number | null) => `未解決 ${n ?? '?'}`,
    reviewRequests: (n: number) => `自分がレビュアーの open PR ${n} 件`,
    running: (n: number) => `起動中 ${n}`,
    nothingRunning: 'このセッションで増えたものはありません',
    opened: 'ダッシュボードを開きました。もう一度 /dashboard で閉じます',
    closedPane: 'ダッシュボードを閉じました',
    leftover: (items: string) => `このセッションで起動したものが残っています: ${items}`,
    deny: (kind: 'pkill' | 'killall' | 'docker') =>
      kind === 'docker'
        ? 'docker stop $(docker ps -q) は、ほかのセッションやプロジェクトのコンテナも止めます。止めるコンテナを名前で指定してください（例: docker stop app-db、docker compose down）。'
        : `${kind === 'pkill' ? 'pkill -f' : 'killall'} は、名前の一致するほかのセッションのプロセスも止めます。ポートか PID を指定して止めてください（例: lsof -ti :5173 | xargs kill、kill 12345）。`,
  },
  en: {
    title: 'Session',
    needs: (n: number) => `Needs attention ${n}`,
    ciFailed: (names: string[]) => `CI failed  ${names.join(', ')}`,
    unresolved: (n: number) => `${n} unresolved review thread${n === 1 ? '' : 's'}`,
    session: 'Session',
    phase: (p: number) => PHASES.en[p] ?? '?',
    round: (n: number) => `round ${n}`,
    goal: (g: string | null) => `goal ${g ?? 'not set'}`,
    issueRef: (n: number) => `Issue #${n}`,
    pr: 'PR',
    noPr: 'No PR',
    prUnknown: 'Reading the PR',
    prError: 'Could not read the PR',
    stale: '⚠ refresh failed',
    draft: 'draft',
    merged: 'Merged',
    closed: 'Closed',
    noChecks: 'No CI checks',
    decision: (d: DashboardPr['decision']) => (d === 'APPROVED' ? 'Approved' : d === 'CHANGES_REQUESTED' ? 'Changes requested' : 'Review required'),
    unresolvedShort: (n: number | null) => `unresolved ${n ?? '?'}`,
    reviewRequests: (n: number) => `${n} open PR${n === 1 ? '' : 's'} awaiting your review`,
    running: (n: number) => `Running ${n}`,
    nothingRunning: 'Nothing new started in this session',
    opened: 'Dashboard opened. Run /dashboard again to close it',
    closedPane: 'Dashboard closed',
    leftover: (items: string) => `Still running from this session: ${items}`,
    deny: (kind: 'pkill' | 'killall' | 'docker') =>
      kind === 'docker'
        ? 'docker stop $(docker ps -q) also stops containers of other sessions and projects. Name the containers to stop (e.g. docker stop app-db, docker compose down).'
        : `${kind === 'pkill' ? 'pkill -f' : 'killall'} also stops matching processes of other sessions. Stop by port or PID instead (e.g. lsof -ti :5173 | xargs kill, kill 12345).`,
  },
}
