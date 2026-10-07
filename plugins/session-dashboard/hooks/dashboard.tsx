// いまのセッションの状況（要対応・Session・PR・起動中）を1つのペインに出す mod。
// あわせて、ほかのセッションのものまで止める一括停止の Bash 呼び出しを止める。
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { DashboardEntry, DashboardLang, DashboardPr, DashboardPrView } from '../types'
import type { Snapshot } from './observe'
import {
  LABELS,
  UNRESOLVED_QUERY,
  bar,
  containersFromDocker,
  elapsed,
  fillBaseline,
  hasJapanese,
  isNoPr,
  langFromSetting,
  massKillOf,
  nextLedger,
  padCells,
  portsFromLsof,
  prFromJson,
  sameLedger,
  unresolvedFromJson,
} from './observe'

const PANE = 'session-dashboard'
/** 一度開いたか（$.store のキー）。開いていれば次のセッションの開始時に開き直す */
const OPENED_KEY = 'opened'
/** 要対応に並べる受け入れ条件の上限 */
const MAX_OPEN_CRITERIA = 3
const LEDGER_EVERY_MS = 30_000
const CI_EVERY_MS = 60_000

const prView = atom({ plugin: 'session-dashboard', key: 'pr' } as const, { kind: 'unknown' } as DashboardPrView)
const reviewRequests = atom({ plugin: 'session-dashboard', key: 'reviewRequests' } as const, null as number | null)
const baseline = atom(
  { plugin: 'session-dashboard', key: 'baseline' } as const,
  null as { ports: string[] | null; containers: string[] | null } | null,
)
const ledger = atom({ plugin: 'session-dashboard', key: 'ledger' } as const, [] as DashboardEntry[])
const notified = atom({ plugin: 'session-dashboard', key: 'notified' } as const, [] as string[])
const lang = atom({ plugin: 'session-dashboard', key: 'lang' } as const, null as DashboardLang | null)

// ---------- ほかのプラグインの値 ----------
// ship-session と acceptance-progress は必須の依存にしない。両者の契約（PluginState）は
// ここで再宣言せず、読む形だけをこのファイルの中で狭く書いて確かめる。

type ShipProgressLike = { goal: string | null; phase: number; issue: number | null; reviews: number }
type IssueLike = { number: number; title: string; done: number; total: number; open: string[] }
type LooseStateGet = (ref: { plugin: string; key: string }) => Promise<{ value?: unknown }>

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

const shipProgressOf = (v: unknown): ShipProgressLike | null => {
  if (!isRecord(v) || typeof v.phase !== 'number') return null
  return {
    goal: typeof v.goal === 'string' ? v.goal : null,
    phase: v.phase,
    issue: typeof v.issue === 'number' ? v.issue : null,
    reviews: typeof v.reviews === 'number' ? v.reviews : 0,
  }
}

const issueOf = (v: unknown): IssueLike | null => {
  if (!isRecord(v) || typeof v.number !== 'number' || !Array.isArray(v.groups)) return null
  const groups = v.groups.filter(isRecord)
  // acceptance-progress のバンドと同じく、受け入れ条件の見出しがあればそれだけ、無ければ全部を数える
  const acceptance = groups.filter(g => g.isAcceptance === true)
  const items = (acceptance.length > 0 ? acceptance : groups)
    .flatMap(g => (Array.isArray(g.items) ? g.items : []))
    .filter(isRecord)
  return {
    number: v.number,
    title: typeof v.title === 'string' ? v.title : '',
    done: items.filter(i => i.isDone === true).length,
    total: items.length,
    open: items.filter(i => i.isDone !== true).map(i => String(i.text ?? '')),
  }
}

const readOthers = async ($: EngineInterface) => {
  // `$.state.get` はその場で呼ぶ（validate が束縛を受け付けない）。型は読む形だけに狭める
  const [progress, issue] = await Promise.all([
    ($.state.get as unknown as LooseStateGet)({ plugin: 'ship-session', key: 'progress' }).catch(() => ({ value: undefined })),
    ($.state.get as unknown as LooseStateGet)({ plugin: 'acceptance-progress', key: 'issue' }).catch(() => ({ value: undefined })),
  ])
  return { progress: shipProgressOf(progress.value), issue: issueOf(issue.value) }
}

// ---------- 観測 ----------

const run = async ($: EngineInterface, argv: string[]) => {
  try {
    return await $.process.run(argv, { timeoutMs: 15_000 })
  } catch (err) {
    return { exitCode: 1, stdout: '', stderr: String(err) }
  }
}

// 最後に始めた PR の取得の番号。後から始めた取得が先に終わったとき、古い結果で上書きしない
let latestPrFetch = 0

/** 現在のブランチの PR と、レビュー依頼の件数を読み直す。 */
const refreshPr = async ($: EngineInterface): Promise<void> => {
  const mine = ++latestPrFetch
  const view = await run($, ['gh', 'pr', 'view', '--json', 'number,title,state,isDraft,url,statusCheckRollup,reviewDecision'])
  let next: DashboardPrView
  if (view.exitCode !== 0) {
    next = isNoPr(view.stderr) ? { kind: 'none' } : { kind: 'error', last: null }
  } else {
    const base = prFromJson(view.stdout)
    if (base === null) next = { kind: 'error', last: null }
    else {
      const [owner = '', name = ''] = base.repo.split('/')
      const threads = await run($, [
        'gh', 'api', 'graphql', '--paginate', '--slurp',
        '-f', `query=${UNRESOLVED_QUERY}`,
        '-f', `owner=${owner}`,
        '-f', `name=${name}`,
        '-F', `number=${base.number}`,
      ])
      next = { kind: 'pr', pr: { ...base, unresolved: threads.exitCode === 0 ? unresolvedFromJson(threads.stdout) : null } }
    }
  }
  const requests = await run($, ['gh', 'api', '-X', 'GET', 'search/issues', '-f', 'q=is:pr is:open review-requested:@me', '--jq', '.total_count'])
  if (mine !== latestPrFetch) return
  await update($, prView, cur => {
    if (next.kind !== 'error') return next
    // 読めなかったときは、前に読めた PR を残して印を付ける
    const last = cur.kind === 'pr' ? cur.pr : cur.kind === 'error' ? cur.last : null
    return { kind: 'error' as const, last }
  })
  const n = Number(requests.stdout.trim())
  if (requests.exitCode === 0 && Number.isInteger(n)) await update($, reviewRequests, () => n)
}

const snapshot = async ($: EngineInterface): Promise<Snapshot> => {
  const [lsof, docker] = await Promise.all([
    run($, ['lsof', '-nP', '-iTCP', '-sTCP:LISTEN']),
    run($, ['docker', 'ps', '--format', '{{.ID}}\t{{.Names}}\t{{.Image}}']),
  ])
  // lsof は待ち受けが1つも無いと 1 で終わる（出力は空）
  const ports = lsof.exitCode === 0 || (lsof.exitCode === 1 && lsof.stdout === '' && lsof.stderr === '') ? portsFromLsof(lsof.stdout) : null
  const containers = docker.exitCode === 0 ? containersFromDocker(docker.stdout) : null
  return { ports, containers }
}

/** 待ち受けポートとコンテナを撮り直し、基準に無いものを台帳に載せる。 */
const refreshLedger = async ($: EngineInterface): Promise<DashboardEntry[]> => {
  const snap = await snapshot($)
  const now = await $.clock.now()
  const base = fillBaseline(await read($, baseline), snap)
  await update($, baseline, () => base)
  const prev = await read($, ledger)
  const next = nextLedger(base, snap, prev, now)
  if (!sameLedger(prev, next)) await update($, ledger, () => next)
  return next
}

const isPaneOpen = async ($: EngineInterface) => (await $.ui.panes()).some(p => p.id === PANE)

const labelsOf = async ($: EngineInterface) => LABELS[(await read($, lang)) ?? 'en']

const describeEntries = (items: DashboardEntry[]) => items.map(e => (e.kind === 'port' ? `${e.label} ${e.detail}` : `docker ${e.label}`)).join(', ')

/** 背景で走らせた取得の失敗は捨てる（表示は前回の値のまま。次の契機で取り直す） */
const ignore = () => {}

const PUSH_OR_PR = /\b(?:git\s+push|gh\s+pr)\b/

export const register: Register = on => {
  let isLangFromSettings = false

  on('session.start', async ($, e, next) => {
    const fromSettings = langFromSetting((await $.settings.read()).language)
    isLangFromSettings = fromSettings !== null
    if (fromSettings !== null) await update($, lang, () => fromSettings)
    await $.command.register({
      name: 'dashboard',
      description: 'Open or close the session dashboard pane (attention, session, PR, running servers)',
    })
    // セッション開始時点を基準にする。ここで撮ったものは台帳に載らない
    await refreshLedger($)
    void refreshPr($).catch(ignore)
    $.clock.every(LEDGER_EVERY_MS, () => {
      void (async () => {
        const items = await refreshLedger($)
        // 経過時間の表示を進める
        if (items.length > 0) $.ui.invalidate('ui.render')
      })().catch(ignore)
    })
    // CI が実行中のあいだだけ PR を読み直す
    $.clock.every(CI_EVERY_MS, () => {
      void (async () => {
        const cur = await read($, prView)
        if (cur.kind === 'pr' && cur.pr.state === 'OPEN' && cur.pr.pending > 0) await refreshPr($)
      })().catch(ignore)
    })
    if ((await $.store.get(OPENED_KEY)) === true) {
      const l = await labelsOf($)
      void $.ui.open({ id: PANE, title: l.title }).catch(ignore)
    }

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const isUserText = e.origin.kind === 'composer' || e.origin.kind === 'bridge'
    if (isUserText && !isLangFromSettings) await update($, lang, () => (hasJapanese(e.text) ? 'ja' : 'en'))

    return next(e)
  })

  on('command.run', { command: 'dashboard' }, async $ => {
    const l = await labelsOf($)
    if (await isPaneOpen($)) {
      await $.store.set(OPENED_KEY, false)
      await $.ui.close({ id: PANE })
      return { text: l.closedPane }
    }
    await $.store.set(OPENED_KEY, true)
    await refreshLedger($)
    void refreshPr($).catch(ignore)
    await $.ui.open({ id: PANE, title: l.title })
    return { text: l.opened }
  })

  // ユーザーが閉じたら、次のセッションでは開き直さない
  on('ui.close', { id: PANE }, async ($, e, next) => {
    if (e.origin.kind === 'person') await $.store.set(OPENED_KEY, false)
    return next(e)
  })

  // 一括停止を止める。フックが失敗したときは素通しにする（ガードが Bash 全体を止めないように）
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const kind = massKillOf(e.command)
    if (kind !== null) return { deny: (await labelsOf($)).deny(kind) }

    const ran = await next(e)
    void refreshLedger($).catch(ignore)
    if (PUSH_OR_PR.test(e.command)) void refreshPr($).catch(ignore)
    return ran
    // next が呼ばれた後の失敗では、next(e) は決まった結果を返し直すだけで Bash を2回は実行しない
  }).catch(($, e, next) => next(e))

  // ターンの終わりに、このセッションで起動したものが残っていれば知らせる（同じ顔ぶれでは繰り返さない）
  on('turn.complete', async ($, e, next) => {
    const items = await refreshLedger($)
    const before = new Set(await read($, notified))
    const keys = items.map(i => i.key)
    if (keys.some(k => !before.has(k))) $.ui.toast((await labelsOf($)).leftover(describeEntries(items)), { timeoutMs: 8_000 })
    if (keys.length !== before.size || keys.some(k => !before.has(k))) await update($, notified, () => keys)

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const code = (await read($, lang)) ?? 'en'
    const l = LABELS[code]
    const { progress, issue } = await readOthers($)
    const view = await read($, prView)
    const requests = await read($, reviewRequests)
    const items = await read($, ledger)
    const now = await $.clock.now()

    const pr: DashboardPr | null = view.kind === 'pr' ? view.pr : view.kind === 'error' ? view.last : null
    const isOpenPr = pr !== null && pr.state === 'OPEN'

    type Need = { color: 'error' | 'warning' | 'subtle'; mark: string; text: string }
    const needs: Need[] = []
    if (isOpenPr && pr.failed > 0) needs.push({ color: 'error', mark: '✖', text: l.ciFailed(pr.failedNames) })
    if (isOpenPr && (pr.unresolved ?? 0) > 0) needs.push({ color: 'warning', mark: '●', text: l.unresolved(pr.unresolved ?? 0) })
    for (const text of issue?.open.slice(0, MAX_OPEN_CRITERIA) ?? []) needs.push({ color: 'subtle', mark: '○', text })

    const Card = ({ title, color, children }: { title: string; color: string; children?: RenderChildren }) => (
      <Box flexDirection="column" borderStyle="round" borderColor={color} paddingX={1}>
        <Text bold color={color}>
          {title}
        </Text>
        {children}
      </Box>
    )
    const Pill = ({ bg, children }: { bg: string; children?: RenderChildren }) => (
      <Text backgroundColor={bg} color="inverseText" bold>
        {' '}
        {children}{' '}
      </Text>
    )

    const prRows = () => {
      if (pr === null) {
        const text = view.kind === 'none' ? l.noPr : view.kind === 'unknown' ? l.prUnknown : l.prError
        return [<Text dimColor>{text}</Text>]
      }
      const head = (
        <Text wrap="truncate-end">
          <Text bold>#{pr.number}</Text>
          {pr.state === 'MERGED' ? (
            <Text> <Pill bg="merged">{l.merged}</Pill></Text>
          ) : pr.state === 'CLOSED' ? (
            <Text> <Pill bg="subtle">{l.closed}</Pill></Text>
          ) : pr.isDraft ? (
            <Text dimColor> {l.draft}</Text>
          ) : (
            ''
          )}{' '}
          <Text dimColor>{pr.title}</Text>
        </Text>
      )
      if (!isOpenPr) return [head]
      const total = pr.passed + pr.failed + pr.pending
      const checks =
        total === 0 ? (
          <Text dimColor>{l.noChecks}</Text>
        ) : (
          <Text>
            {pr.passed > 0 && <Pill bg="success">✔ {pr.passed}</Pill>}
            {pr.passed > 0 && ' '}
            {pr.failed > 0 && <Pill bg="error">✖ {pr.failed}</Pill>}
            {pr.failed > 0 && ' '}
            {pr.pending > 0 && <Pill bg="warning">● {pr.pending}</Pill>}
          </Text>
        )
      return [
        head,
        <Box columnGap={2}>
          {checks}
          <Text wrap="truncate-end">
            {l.decision(pr.decision)} · {l.unresolvedShort(pr.unresolved)}
          </Text>
        </Box>,
      ]
    }

    return (
      <Box flexDirection="column">
        {needs.length > 0 && (
          <Card title={l.needs(needs.length)} color="error">
            {needs.map(n => (
              <Text wrap="truncate-end">
                <Text color={n.color}>{n.mark} </Text>
                {n.text}
              </Text>
            ))}
          </Card>
        )}
        {(progress !== null || issue !== null) && (
          <Card title={l.session} color="claude">
            {progress !== null && (
              <Text wrap="truncate-end">
                ship-session  <Text bold>{l.phase(progress.phase)}</Text>
                {progress.reviews > 0 ? ` · ${l.round(progress.reviews)}` : ''}  <Text dimColor>{l.goal(progress.goal)}</Text>
                {issue === null && progress.issue !== null ? <Text dimColor>  {l.issueRef(progress.issue)}</Text> : ''}
              </Text>
            )}
            {issue !== null && (
              <Text wrap="truncate-end">
                #{issue.number} <Text color="success">{bar(issue.done, issue.total, 12)}</Text> <Text bold>
                  {issue.done}/{issue.total}
                </Text>  <Text dimColor>{issue.title}</Text>
              </Text>
            )}
          </Card>
        )}
        <Card title={l.pr} color="suggestion">
          {prRows()}
          {view.kind === 'error' && pr !== null && <Text color="warning">{l.stale}</Text>}
          {requests !== null && <Text dimColor>{l.reviewRequests(requests)}</Text>}
        </Card>
        <Card title={l.running(items.length)} color="subtle">
          {items.length === 0 ? (
            <Text dimColor>{l.nothingRunning}</Text>
          ) : (
            items.map(x => (
              <Text wrap="truncate-end">
                {x.kind === 'port' ? padCells(x.label, 8) : padCells('docker', 8)}
                {padCells(x.kind === 'port' ? x.detail : x.label, 18)} <Text dimColor>{elapsed(now - x.since, code)}</Text>
              </Text>
            ))
          )}
        </Card>
      </Box>
    )
  })
}
