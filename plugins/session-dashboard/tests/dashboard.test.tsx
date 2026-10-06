// dashboard.tsx（ペインとガード）と observe.ts のテスト。`claude plugin test plugins/session-dashboard` で走る。
// テストの `on` で登録したフックはプラグインの下に入り、エンジン（gh・lsof・docker の出力、ペイン、トースト）の代わりをする。
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { classifyCheck, containersFromDocker, massKillOf, nextLedger, portsFromLsof, prFromJson, unresolvedFromJson } from '../hooks/observe'

const SURFACES = ['terminal', 'desktop'] as const
type Surface = (typeof SURFACES)[number]

const PANE = 'session-dashboard'
const PANE_PROPS = {
  title: 'セッション',
  isFocused: false,
  bodyColumns: 64,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
} as const

/** 何も起動していないときの lsof の出力（見出しと、セッション開始前からある 5432）。 */
const LSOF_BASE = [
  'COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME',
  'postgres 100 me    7u  IPv6 0x1      0t0  TCP [::1]:5432 (LISTEN)',
  'postgres 100 me    8u  IPv4 0x2      0t0  TCP 127.0.0.1:5432 (LISTEN)',
].join('\n')
const LSOF_VITE = `${LSOF_BASE}\nnode      200 me   20u  IPv4 0x3      0t0  TCP *:5173 (LISTEN)`

type Gh = { exitCode: number; stdout?: string; stderr?: string }

const PR_OPEN = {
  number: 34,
  title: '作業中の Issue の受け入れ条件の進捗を出す mod を足し、issue-loop にチェックを付けさせる',
  state: 'OPEN',
  isDraft: true,
  url: 'https://github.com/acme/app/pull/34',
  reviewDecision: 'CHANGES_REQUESTED',
  statusCheckRollup: [
    { __typename: 'CheckRun', name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS' },
    { __typename: 'CheckRun', name: 'build', status: 'COMPLETED', conclusion: 'SKIPPED' },
    { __typename: 'CheckRun', name: 'test (ubuntu-latest)', status: 'COMPLETED', conclusion: 'FAILURE' },
    { __typename: 'CheckRun', name: 'e2e', status: 'IN_PROGRESS', conclusion: null },
    { __typename: 'StatusContext', context: 'deploy/preview', state: 'SUCCESS' },
  ],
}
const THREADS = (resolved: boolean[]) =>
  JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { nodes: resolved.map(isResolved => ({ isResolved })) } } } } })

/** 外の世界の代わり。値は呼び出しのたびに書き換えてよい。 */
type World = { pr: Gh; threads: Gh; requests: Gh; lsof: Gh; docker: Gh; calls: string[][] }

const world = (over: Partial<World> = {}): World => ({
  pr: { exitCode: 0, stdout: JSON.stringify(PR_OPEN) },
  threads: { exitCode: 0, stdout: THREADS([false, true]) },
  requests: { exitCode: 0, stdout: '2\n' },
  lsof: { exitCode: 0, stdout: LSOF_BASE },
  docker: { exitCode: 0, stdout: 'aaa111\tother-db\tpostgres:17\n' },
  calls: [],
  ...over,
})

const answerWorld = (on: On, w: World) => {
  on('process.run', (_$, e) => {
    const argv = [...e.argv]
    w.calls.push(argv)
    const line = argv.join(' ')
    const out = line.startsWith('gh pr view')
      ? w.pr
      : line.startsWith('gh api graphql')
        ? w.threads
        : line.startsWith('gh api')
          ? w.requests
          : line.startsWith('lsof')
            ? w.lsof
            : line.startsWith('docker')
              ? w.docker
              : { exitCode: 127, stderr: 'not found' }
    return {
      value: { exitCode: out.exitCode, stdout: out.stdout ?? '', stderr: out.stderr ?? '', isStdoutTruncated: false, isStderrTruncated: false },
    }
  })
}

/** ペインの開閉とトーストを覚えておく（エンジンの代わり）。 */
const answerUi = (on: On) => {
  const open = new Set<string>()
  const toasts: string[] = []
  on('ui.open', (_$, e) => {
    open.add(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_$, e) => {
    open.delete(e.id)
    return { value: undefined }
  })
  on('ui.panes', () => ({ value: [...open].map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })) }))
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('settings.read', () => ({ value: { language: '日本語' } }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  // Bash はどのコマンドにも成功で答える
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: 'ok', stderr: '', interrupted: false }, text: 'ok' }))
  return { open, toasts }
}

/** 一式を用意してセッションを始める。 */
const start = async ($: Engine, on: On, w: World) => {
  answerWorld(on, w)
  const ui = answerUi(on)
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  await clock.settle()
  return { ...ui, clock }
}

const dashboard = ($: Engine) =>
  $.command.run({ command: 'dashboard', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 150 } })

const bash = ($: Engine, command: string) => $.tool.call({ tool: 'Bash', command })

const finishTurn = ($: Engine) =>
  $.turn.complete({ answer: '', durationMs: 1000, isAborted: false, turnId: 'turn-1', reason: 'answer' })

const paneText = async ($: Engine, surface: Surface) => {
  const ui = await $.ui.mount({
    plugin: 'session-dashboard',
    surface,
    component: 'Pane',
    requestId: PANE,
    props: PANE_PROPS,
    viewport: { columns: 66, rows: 40, isFullscreen: true },
  })
  const texts = await ui.findAll({ type: 'Text' })
  await ui.unmount()
  return texts.map(t => t.text).join(' | ')
}

// ship-session と acceptance-progress の代わり。自分の値を session.start で書く
const SHIP = {
  name: 'ship-session',
  register(on: On) {
    on('session.start', async ($, e, next) => {
      const ref = { plugin: 'ship-session', key: 'progress' } as never
      await $.state.set(ref, { goal: 'PR まで', phase: 2, issue: 33, pr: 34, reviews: 2, gate: null } as never)
      return next(e)
    })
  },
}
const ACCEPTANCE = {
  name: 'acceptance-progress',
  register(on: On) {
    on('session.start', async ($, e, next) => {
      const ref = { plugin: 'acceptance-progress', key: 'issue' } as never
      const items = [
        { text: 'validate が通る', isDone: true },
        { text: 'README に載っている', isDone: false },
        { text: 'test が緑', isDone: false },
        { text: '既存のテストが緑', isDone: false },
        { text: 'スクリーンショットを添付', isDone: false },
      ]
      const groups = [{ heading: '受け入れ条件', isAcceptance: true, items }]
      await $.state.set(ref, { repo: 'acme/app', number: 33, title: '進捗を出す', url: 'https://github.com/acme/app/issues/33', groups, error: null } as never)
      return next(e)
    })
  },
}

describe('観測の読み取り', () => {
  test('CI のチェックを成功・失敗・実行中に振り分ける', () => {
    expect(classifyCheck({ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'NEUTRAL' })).toBe('passed')
    expect(classifyCheck({ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'CANCELLED' })).toBe('failed')
    expect(classifyCheck({ __typename: 'CheckRun', status: 'QUEUED', conclusion: null })).toBe('pending')
    expect(classifyCheck({ __typename: 'StatusContext', state: 'PENDING' })).toBe('pending')
    expect(classifyCheck({ __typename: 'StatusContext', state: 'ERROR' })).toBe('failed')
    const pr = prFromJson(JSON.stringify(PR_OPEN))
    expect(pr).toEqual({
      repo: 'acme/app',
      number: 34,
      title: PR_OPEN.title,
      state: 'OPEN',
      isDraft: true,
      passed: 3,
      failed: 1,
      pending: 1,
      failedNames: ['test (ubuntu-latest)'],
      decision: 'CHANGES_REQUESTED',
    })
    expect(prFromJson('not json')).toBe(null)
  })

  test('未解決スレッドは全ページを合計する', () => {
    const page = (resolved: boolean[]) => JSON.parse(THREADS(resolved))
    expect(unresolvedFromJson(JSON.stringify([page([false, true]), page([false, false])]))).toBe(3)
    expect(unresolvedFromJson(THREADS([false]))).toBe(1)
    expect(unresolvedFromJson('{"errors":[]}')).toBe(null)
  })

  test('lsof は IPv4 と IPv6 を1件にまとめ、docker ps はタブ区切りを読む', () => {
    expect(portsFromLsof(LSOF_VITE).map(p => p.key)).toEqual(['port:5432', 'port:5173'])
    expect(portsFromLsof('').length).toBe(0)
    expect(containersFromDocker('abc\tapp-db\tpostgres:17\n\n')).toEqual([{ key: 'docker:abc', kind: 'docker', label: 'app-db', detail: 'postgres:17' }])
  })

  test('台帳は基準にあったものを出さず、初めて見た時刻を保ち、読めなかった種類は前回の分を残す', () => {
    const base = { ports: ['port:5432'], containers: ['docker:aaa111'] }
    const snap = {
      ports: portsFromLsof(LSOF_VITE),
      containers: containersFromDocker('aaa111\tother-db\tpostgres:17\nbbb222\tapp-db\tpostgres:17'),
    }
    const first = nextLedger(base, snap, [], 10)
    expect(first.map(e => [e.key, e.since])).toEqual([['port:5173', 10], ['docker:bbb222', 10]])
    const second = nextLedger(base, { ports: snap.ports, containers: null }, first, 99)
    expect(second.map(e => [e.key, e.since])).toEqual([['port:5173', 10], ['docker:bbb222', 10]])
  })
})

describe('一括停止のガード', () => {
  test('pkill -f / killall / docker stop $(docker ps -q) を一括停止とみなす', () => {
    expect(massKillOf('pkill -f vite')).toBe('pkill')
    expect(massKillOf('pkill -9f "node server"')).toBe('pkill')
    expect(massKillOf('cd app && sudo pkill --full next')).toBe('pkill')
    expect(massKillOf('killall node')).toBe('killall')
    expect(massKillOf('docker stop $(docker ps -q)')).toBe('docker')
    expect(massKillOf('docker rm -f $(docker ps -aq)')).toBe('docker')
    expect(massKillOf('docker ps -q | xargs docker stop')).toBe('docker')
    expect(massKillOf('docker stop $(docker ps --quiet)')).toBe('docker')
    expect(massKillOf('docker ps --all --quiet | xargs docker rm')).toBe('docker')
    expect(massKillOf('env FOO=1 pkill -f node')).toBe('pkill')
    expect(massKillOf('NODE_ENV=dev killall node')).toBe('killall')
    expect(massKillOf("bash -c 'pkill -f node'")).toBe('pkill')
    expect(massKillOf('sh -c "docker stop $(docker ps -q)"')).toBe('docker')
  })

  test('PID・ポート・名前を指定した止め方は通す', () => {
    expect(massKillOf('kill 12345')).toBe(null)
    expect(massKillOf('lsof -ti :5173 | xargs kill')).toBe(null)
    expect(massKillOf('pkill vite')).toBe(null)
    expect(massKillOf('docker stop app-db')).toBe(null)
    expect(massKillOf('docker stop $(docker ps -q --filter name=app)')).toBe(null)
    expect(massKillOf('echo "do not use killall"')).toBe(null)
    expect(massKillOf('echo "pkill -f x"')).toBe(null)
    expect(massKillOf('echo "docker stop $(docker ps -q)"')).toBe(null)
  })

  test('Bash の呼び出しで一括停止を止め、指定した止め方の例を理由に返し、kill <PID> は通す', async ($, on) => {
    const w = world()
    await start($, on, w)
    for (const command of ['pkill -f vite', 'killall node', 'docker stop $(docker ps -q)']) {
      const ran = await bash($, command)
      expect(ran.deny ?? '').toMatch(/例: (lsof -ti :5173|docker stop app-db)/)
    }
    const ok = await bash($, 'kill 12345')
    expect(ok.deny).toBe(undefined)
    expect(ok.text).toBe('ok')
  })
})

describe('ダッシュボードのペイン', () => {
  for (const surface of SURFACES) {
    test(`${surface}: 4区画を 要対応 → Session → PR → 起動中 の順に出す`, { plugins: [SHIP, ACCEPTANCE] }, async ($, on) => {
      const w = world()
      const { open } = await start($, on, w)
        w.lsof = { exitCode: 0, stdout: LSOF_VITE }
      w.docker = { exitCode: 0, stdout: 'aaa111\tother-db\tpostgres:17\nbbb222\tapp-db\tpostgres:17\n' }

      const res = await dashboard($)
      expect(res.text).toContain('開きました')
      expect(open.has(PANE)).toBe(true)
      const text = await paneText($, surface)

      const order = ['要対応 5', 'Session', 'PR', '起動中 2'].map(s => text.indexOf(s))
      expect(order.every(i => i >= 0)).toBe(true)
      expect([...order].sort((a, b) => a - b)).toEqual(order)
      // 要対応: CI の失敗、未解決スレッド、残りの受け入れ条件（最大3件）
      expect(text).toContain('CI 失敗  test (ubuntu-latest)')
      expect(text).toContain('未解決のレビュースレッド 1 件')
      expect(text).toContain('README に載っている')
      expect(text).toContain('既存のテストが緑')
      expect(text).not.toContain('スクリーンショットを添付')
      // Session
      expect(text).toContain('実装ループ')
      expect(text).toContain('2周目')
      expect(text).toContain('到達点 PR まで')
      expect(text).toContain('1/5')
      // PR（CI のピルを含む）
      expect(text).toContain('#34')
      expect(text).toContain('draft')
      expect(text).toContain('✔ 3')
      expect(text).toContain('✖ 1')
      expect(text).toContain('● 1')
      expect(text).toContain('修正依頼')
      expect(text).toContain('未解決 1')
      expect(text).toContain('自分がレビュアーの open PR 2 件')
      // 起動中: セッション開始時からある 5432 と other-db は出さない
      expect(text).toContain(':5173')
      expect(text).toContain('node')
      expect(text).toContain('app-db')
      expect(text).not.toContain('5432')
      expect(text).not.toContain('other-db')

      // もう一度打つと閉じる
      await dashboard($)
      expect(open.has(PANE)).toBe(false)
    })

    test(`${surface}: 区画1の値が両方 null なら Session を出さず、要対応も無ければ出さない`, async ($, on) => {
      const w = world({ pr: { exitCode: 0, stdout: JSON.stringify({ ...PR_OPEN, statusCheckRollup: [], isDraft: false, reviewDecision: 'APPROVED' }) }, threads: { exitCode: 0, stdout: THREADS([true]) } })
      await start($, on, w)
      await dashboard($)
      const text = await paneText($, surface)
      expect(text).not.toContain('Session')
      expect(text).not.toContain('要対応')
      expect(text).toContain('CI チェックなし')
      expect(text).toContain('承認済み')
      expect(text).toContain('このセッションで増えたものはありません')
    })

    test(`${surface}: MERGED の PR は状態だけを出し、CI とレビューの要対応を出さない`, async ($, on) => {
      const w = world({ pr: { exitCode: 0, stdout: JSON.stringify({ ...PR_OPEN, state: 'MERGED' }) } })
      await start($, on, w)
      await dashboard($)
      const text = await paneText($, surface)
      expect(text).toContain('マージ済み')
      expect(text).not.toContain('要対応')
      expect(text).not.toContain('修正依頼')
      expect(text).not.toContain('✖ 1')
    })

    test(`${surface}: CLOSED の PR はクローズと出す`, async ($, on) => {
      const w = world({ pr: { exitCode: 0, stdout: JSON.stringify({ ...PR_OPEN, state: 'CLOSED' }) } })
      await start($, on, w)
      await dashboard($)
      expect(await paneText($, surface)).toContain('クローズ')
    })

    test(`${surface}: PR が無いブランチでは PR なし、読めなければ前回の値に印を付ける`, async ($, on) => {
      const w = world({ pr: { exitCode: 1, stderr: 'no pull requests found for branch "feat/x"' } })
      const { clock } = await start($, on, w)
      await dashboard($)
      expect(await paneText($, surface)).toContain('PR なし')

      w.pr = { exitCode: 0, stdout: JSON.stringify(PR_OPEN) }
      await bash($, 'git push -u origin feat/x')
      await clock.settle()
      expect(await paneText($, surface)).toContain('#34')

      w.pr = { exitCode: 1, stderr: 'error connecting to api.github.com' }
      await bash($, 'gh pr view')
      await clock.settle()
      const text = await paneText($, surface)
      expect(text).toContain('#34')
      expect(text).toContain('読み直しに失敗')
    })
  }

  test('ターンの終わりに残っているものをトーストで1回だけ知らせる', async ($, on) => {
    const w = world()
    const { toasts } = await start($, on, w)
    await finishTurn($)
    expect(toasts.length).toBe(0)

    w.lsof = { exitCode: 0, stdout: LSOF_VITE }
    await finishTurn($)
    expect(toasts.length).toBe(1)
    expect(toasts[0]).toContain(':5173 node')
    await finishTurn($)
    expect(toasts.length).toBe(1)
  })
})
