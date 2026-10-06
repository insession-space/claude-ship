// gate.ts（Bash の tool.call のガード）と command.ts / verdict.ts のテスト。`claude plugin test plugins/yomiyasu-gate` で走る。
// テストの `on` で登録したフックはプラグインの下に入り、エンジン（HOME・ファイル・リンターの実行・Bash の実行）の代わりをする。
import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { findTargets, splitCommand, stripExcluded } from '../hooks/command'
import { judge, scoreOf } from '../hooks/verdict'
import type { Finding } from '../hooks/verdict'

const LINTER = '/home/u/.claude/plugins/marketplaces/yomiyasu/skills/yomiyasu/scripts/yomiyasu_lint.py'

/**
 * yomiyasu_lint.py の代わり。文末コロン・絵文字・和欧文間の半角空白・「重要なのは」だけを見て、
 * 本物と同じ形の JSON を返す。
 */
const fakeLint = (text: string) => {
  const findings: Finding[] = []
  text.split('\n').forEach((line, idx) => {
    const n = idx + 1
    if (/[：:]$/.test(line)) findings.push({ rule: 'trailing_colon', line: n, severity: 'warn', message: '', snippet: line })
    if (/[\u{1F300}-\u{1FAFF}☀-➿]/u.test(line))
      findings.push({ rule: 'emoji_prohibited', line: n, severity: 'warn', message: '', snippet: line })
    if (/[ぁ-んァ-ヶ一-龥]\s+[a-zA-Z0-9_-]{2,}\s+[ぁ-ん]/.test(line))
      findings.push({ rule: 'unnatural_halfwidth_space', line: n, severity: 'warn', message: '', snippet: line })
    if (/^重要なのは/.test(line)) findings.push({ rule: 'meta_filler', line: n, severity: 'warn', message: '', snippet: line })
  })
  const score = scoreOf(findings)
  return JSON.stringify({ score, is_clean: findings.length === 0, metrics: {}, findings })
}

type Env = {
  /** 存在するファイル（パス → 中身） */
  files?: Record<string, string>
  /** リンターの実行を差し替える。省略時は fakeLint */
  lint?: (stdin: string) => { exitCode: number; stdout: string; stderr?: string } | 'throw'
  /** リンターに渡った本文 */
  linted?: string[]
  /** 出たトースト */
  toasts?: string[]
  /** 実際に走った Bash のコマンド */
  ran?: string[]
}

/** エンジンの代わりをまとめて登録する。 */
const engine = (on: On, env: Env = {}) => {
  const files = env.files ?? { [LINTER]: '# linter' }
  on('env.get', () => ({ value: '/home/u' }))
  on('fs.exists', (_$, e) => ({ value: Object.hasOwn(files, e.path) }))
  on('fs.read', (_$, e) => {
    const text = files[e.path]
    if (text === undefined) throw new Error(`ENOENT: ${e.path}`)
    return { value: text }
  })
  on('process.run', (_$, e) => {
    const stdin = e.init?.stdin ?? ''
    env.linted?.push(stdin)
    const out = env.lint?.(stdin) ?? { exitCode: 0, stdout: fakeLint(stdin) }
    if (out === 'throw') throw new Error('spawn python3 ENOENT')
    return {
      value: { exitCode: out.exitCode, stdout: out.stdout, stderr: out.stderr ?? '', isStdoutTruncated: false, isStderrTruncated: false },
    }
  })
  on('ui.toast', (_$, e) => {
    env.toasts?.push(e.text)
    return { value: undefined }
  })
  on('tool.call', { tool: 'Bash' }, (_$, e) => {
    env.ran?.push(e.command)
    return { result: { stdout: '', stderr: '', interrupted: false }, text: '' }
  })
}

const bash = ($: Engine, command: string, agentId?: string) =>
  $.tool.call({ tool: 'Bash', command, ...(agentId !== undefined && { agentId }) })

/** 差し戻されたらその理由、通ったら undefined */
const denied = async ($: Engine, command: string, agentId?: string): Promise<string | undefined> => {
  const got: { deny?: string; isError?: boolean; text?: string } = await bash($, command, agentId)
  return got.deny ?? (got.isError === true ? got.text : undefined)
}

const CLEAN = 'mod を足した。\n\nテストは緑のまま通る。'
const COLON = '変更点は次のとおり:\n- mod を足した'

describe('本文の取り出し', () => {
  test('gh の --body / -b / --body= / -F ファイル / --body-file - と heredoc', () => {
    expect(findTargets('gh pr create --title t --body "本文"')).toEqual([{ kind: 'gh pr create', body: { kind: 'text', text: '本文' } }])
    expect(findTargets("gh issue comment 5 -b '本文'")[0]?.body).toEqual({ kind: 'text', text: '本文' })
    expect(findTargets('gh pr edit 3 --body=本文')[0]?.body).toEqual({ kind: 'text', text: '本文' })
    expect(findTargets('gh issue create -F /tmp/b.md')[0]?.body).toEqual({ kind: 'file', path: '/tmp/b.md' })
    expect(findTargets("gh pr comment 9 --body-file - <<'EOF'\n一行目\n二行目\nEOF")[0]?.body).toEqual({
      kind: 'text',
      text: '一行目\n二行目',
    })
  })

  test('$(cat <<EOF ...) のコマンド置換は本文として読み、中の引用符で語を切らない', () => {
    const cmd = 'gh pr create --title "t" --body "$(cat <<\'EOF\'\n## 概要\n"引用" を含む本文\n\nCloses #1\nEOF\n)" --draft'
    expect(findTargets(cmd)).toEqual([{ kind: 'gh pr create', body: { kind: 'text', text: '## 概要\n"引用" を含む本文\n\nCloses #1' } }])
  })

  test('git commit の -m（複数は段落）/ -am / --message= / -F / heredoc', () => {
    expect(findTargets('git commit -m "件名" -m "本文"')[0]?.body).toEqual({ kind: 'text', text: '件名\n\n本文' })
    expect(findTargets('git commit -am "件名"')[0]?.body).toEqual({ kind: 'text', text: '件名' })
    expect(findTargets('git commit --message=件名')[0]?.body).toEqual({ kind: 'text', text: '件名' })
    expect(findTargets('git -C sub commit -F msg.txt')[0]?.body).toEqual({ kind: 'file', path: 'msg.txt' })
    const heredoc = 'git add -A && git commit -m "$(cat <<\'EOF\'\n件名\n\nCo-Authored-By: X <x@example.com>\nEOF\n)"'
    expect(findTargets(heredoc)).toEqual([{ kind: 'git commit', body: { kind: 'text', text: '件名\n\nCo-Authored-By: X <x@example.com>' } }])
  })

  test('変数展開やコマンド置換を含む本文は unknown、本文を渡さないコマンドは対象外', () => {
    expect(findTargets('gh pr create --body "$BODY"')[0]?.body).toEqual({ kind: 'unknown' })
    expect(findTargets('git commit -m "$(date)"')[0]?.body).toEqual({ kind: 'unknown' })
    expect(findTargets('gh pr comment 3 --body-file -')[0]?.body).toEqual({ kind: 'unknown' })
    expect(findTargets('git commit --amend --no-edit')).toEqual([])
    expect(findTargets('gh pr create --fill')).toEqual([])
    expect(findTargets('gh pr view 3')).toEqual([])
    expect(findTargets('echo gh pr create --body x')).toEqual([])
    expect(findTargets('git log -m')).toEqual([])
  })

  test('区切り・リダイレクト・コメントを語にしない', () => {
    expect(splitCommand('cd a && git status 2>&1 | head -3; echo x > out.txt # note').map(s => s.words.map(w => w.text))).toEqual([
      ['cd', 'a'],
      ['git', 'status'],
      ['head', '-3'],
      ['echo', 'x'],
    ])
  })

  test('帰属行とトレーラーは空行に置き換え、行番号を保つ', () => {
    const body = [
      '本文',
      'Co-Authored-By: Claude <noreply@anthropic.com>',
      'Claude-Session: https://claude.ai/code/session_x',
      '🤖 Generated with [Claude Code](https://claude.com/claude-code)',
      'https://claude.ai/code/session_01ABC',
    ].join('\n')
    // PR は帰属行とセッション URL だけ、コミットはトレーラーだけ、Issue は何も外さない
    expect(stripExcluded('gh pr create', body)).toBe(`本文\n${body.split('\n')[1]}\n${body.split('\n')[2]}\n\n`)
    expect(stripExcluded('git commit', body)).toBe(`本文\n\n\n${body.split('\n')[3]}\n${body.split('\n')[4]}`)
    expect(stripExcluded('gh issue create', body)).toBe(body)
  })

  test('引用符で囲まない区切りの heredoc に展開があれば unknown、囲んだ区切りならそのまま本文', () => {
    expect(findTargets('gh pr create --body "$(cat <<EOF\n日本語 $BODY\nEOF\n)"')[0]?.body).toEqual({ kind: 'unknown' })
    expect(findTargets('gh pr create --body "$(cat <<EOF\n日本語 `date`\nEOF\n)"')[0]?.body).toEqual({ kind: 'unknown' })
    expect(findTargets('gh pr create --body "$(cat <<EOF\n日本語だけ\nEOF\n)"')[0]?.body).toEqual({ kind: 'text', text: '日本語だけ' })
    expect(findTargets("gh pr create --body \"$(cat <<'EOF'\n日本語 $BODY\nEOF\n)\"")[0]?.body).toEqual({ kind: 'text', text: '日本語 $BODY' })
    expect(findTargets('gh pr comment 1 -F - <<EOF\n日本語 $X\nEOF')[0]?.body).toEqual({ kind: 'unknown' })
    expect(findTargets("gh pr comment 1 -F - <<'EOF'\n日本語 $X\nEOF")[0]?.body).toEqual({ kind: 'text', text: '日本語 $X' })
  })
})

describe('判定', () => {
  const f = (rule: string, severity = 'warn'): Finding => ({ rule, line: 1, severity, message: '', snippet: '' })
  const policy = { minScore: 80, hardRules: ['emoji_prohibited', 'trailing_colon'], ignoreRules: ['unnatural_halfwidth_space'] }

  test('しきい値・1件で差し戻す規則・無視する規則', () => {
    expect(judge([f('excess_list'), f('meta_filler'), f('negative_parallelism', 'info')], policy).kind).toBe('pass')
    expect(judge([f('meta_filler'), f('meta_filler'), f('meta_filler'), f('meta_filler', 'info'), f('excess_list')], policy)).toMatchObject({
      kind: 'deny',
      score: 78,
      hardRules: [],
    })
    expect(judge([f('trailing_colon')], policy)).toMatchObject({ kind: 'deny', score: 95, hardRules: ['trailing_colon'] })
    expect(judge(Array.from({ length: 10 }, () => f('unnatural_halfwidth_space')), policy)).toEqual({ kind: 'pass', score: 100 })
  })
})

describe('Bash のガード', () => {
  test('文末コロンのある本文を、行と種類を添えて差し戻す', async ($, on) => {
    const ran: string[] = []
    engine(on, { ran })
    const got = await denied($, `gh pr create --title t --body '${COLON}'`)
    expect(got).toContain('L1')
    expect(got).toContain('trailing colon')
    expect(got).toContain('変更点は次のとおり:')
    expect(ran).toEqual([])
  })

  test('規則に合う本文・英語だけの本文・対象でないコマンドは通す', async ($, on) => {
    const ran: string[] = []
    const linted: string[] = []
    engine(on, { ran, linted })
    await bash($, `git commit -m '${CLEAN}'`)
    await bash($, 'gh issue comment 3 --body "Done:"')
    await bash($, 'git status')
    expect(ran.length).toBe(3)
    expect(linted).toEqual([CLEAN])
  })

  test('本文を確定できない形は検査せずに通す', async ($, on) => {
    const ran: string[] = []
    const linted: string[] = []
    engine(on, { ran, linted })
    await bash($, 'gh pr create --body "$(cat body.md)"')
    await bash($, 'gh pr create --body-file missing.md')
    expect(ran.length).toBe(2)
    expect(linted).toEqual([])
  })

  test('--body-file のファイルを読んで検査する', async ($, on) => {
    const ran: string[] = []
    engine(on, { ran, files: { [LINTER]: '#', '/tmp/body.md': COLON } })
    expect(await denied($, 'gh issue create --title t --body-file /tmp/body.md')).toBeDefined()
    expect(ran).toEqual([])
  })

  test('帰属行とトレーラーは検査から外し、和欧文間の半角空白では止めない', async ($, on) => {
    const ran: string[] = []
    const linted: string[] = []
    engine(on, { ran, linted })
    const body = `${CLEAN}\nこの PR は README を直す\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\n\nhttps://claude.ai/code/session_01X`
    await bash($, `gh pr create --body '${body}'`)
    await bash($, `git commit -m '件名を書く\n\nCo-Authored-By: Claude <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01X'`)
    expect(ran.length).toBe(2)
    expect(linted[0]).not.toContain('Generated with')
    expect(linted[1]).toBe('件名を書く\n\n\n')
  })

  test('ignoreRules を空にすると和欧文間の半角空白でもスコアに数える', { options: { ignoreRules: '', minScore: 100 } }, async ($, on) => {
    const ran: string[] = []
    engine(on, { ran })
    expect(await denied($, "gh pr create --body 'この PR は README を直す'")).toBeDefined()
    expect(ran).toEqual([])
  })

  test('リンターが無いときは通し、トーストは1回だけ出す', async ($, on) => {
    const ran: string[] = []
    const toasts: string[] = []
    engine(on, { ran, toasts, files: {} })
    await bash($, `gh pr create --body '${COLON}'`)
    await bash($, `gh pr create --body '${COLON}'`)
    expect(ran.length).toBe(2)
    expect(toasts.length).toBe(1)
    expect(toasts[0]).toContain('not found')
  })

  test('リンターが失敗・起動できない・JSON を返さないときは通し、トーストは1回だけ出す', async ($, on) => {
    const ran: string[] = []
    const toasts: string[] = []
    const answers = ['throw', { exitCode: 2, stdout: '', stderr: 'boom' }, { exitCode: 0, stdout: 'not json' }] as const
    let n = 0
    engine(on, { ran, toasts, lint: () => answers[n++] ?? 'throw' })
    for (let i = 0; i < 3; i++) await bash($, `gh pr create --body '${COLON}'`)
    expect(ran.length).toBe(3)
    expect(toasts.length).toBe(1)
  })

  test('userConfig のパスにリンターが無ければ既定の場所を見ずに通す', { options: { linterPath: '/opt/lint.py' } }, async ($, on) => {
    const ran: string[] = []
    engine(on, { ran })
    await bash($, `gh pr create --body '${COLON}'`)
    expect(ran.length).toBe(1)
  })

  test('続けて2回差し戻したら3回目は通してトーストを出し、数え直す', async ($, on) => {
    const ran: string[] = []
    const toasts: string[] = []
    engine(on, { ran, toasts })
    const cmd = `git commit -m '${COLON}'`
    expect(await denied($, cmd)).toBeDefined()
    expect(await denied($, `git commit -m '別の書き方:'`)).toBeDefined()
    expect(await denied($, cmd)).toBeUndefined()
    expect(toasts.length).toBe(1)
    expect(toasts[0]).toContain('2 times')
    // 通したあとは数え直すので、次の違反はまた差し戻す
    expect(await denied($, cmd)).toBeDefined()
    expect(ran.length).toBe(1)
  })

  test('通ったら差し戻しの回数を数え直す。種類が違うコマンドは別に数える', async ($, on) => {
    const ran: string[] = []
    engine(on, { ran })
    await bash($, `git commit -m '${COLON}'`)
    await bash($, `git commit -m '${CLEAN}'`)
    await bash($, `git commit -m '${COLON}'`)
    await bash($, `gh pr comment 1 --body '${COLON}'`)
    expect(await denied($, `git commit -m '${COLON}'`)).toBeDefined()
    expect(ran.length).toBe(1)
  })

  test('maxDenials を 0 にすると止め続ける', { options: { maxDenials: 0 } }, async ($, on) => {
    const ran: string[] = []
    engine(on, { ran })
    for (let i = 0; i < 4; i++) await bash($, `git commit -m '${COLON}'`)
    expect(ran).toEqual([])
  })

  test('サブエージェントの呼び出しも既定で検査する', async ($, on) => {
    const ran: string[] = []
    engine(on, { ran })
    expect(await denied($, `git commit -m '${COLON}'`, 'agent-1')).toBeDefined()
    expect(ran).toEqual([])
  })

  test('includeSubagents が false ならサブエージェントの呼び出しは通す', { options: { includeSubagents: false } }, async ($, on) => {
    const ran: string[] = []
    engine(on, { ran })
    await bash($, `git commit -m '${COLON}'`, 'agent-1')
    expect(ran.length).toBe(1)
    expect(await denied($, `git commit -m '${COLON}'`)).toBeDefined()
  })

  test('ユーザーが日本語で打ったら差し戻しの理由も日本語', async ($, on) => {
    engine(on)
    on('prompt.submit', (_$, e) => ({ text: e.text }))
    await $.prompt.submit({ text: 'PR を出して', wait: false, origin: { kind: 'composer' } })
    const got = await denied($, `gh pr create --body '${COLON}'`)
    expect(got).toContain('文末コロン')
    expect(got).toContain('再実行してください')
  })
})
