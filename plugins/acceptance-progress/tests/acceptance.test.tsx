// acceptance.tsx（入力欄の上のバンド）と checklist.ts のテスト。`claude plugin test plugins/acceptance-progress` で走る。
// テストの `on` で登録したフックはプラグインの下に入り、エンジン（Bash の実行結果と gh の出力）の代わりをする。
import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { parseChecklist, parseCommandArg, refFromCommand } from '../hooks/checklist'

const SURFACES = ['terminal', 'desktop'] as const

const PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 12,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 12 },
  view: {},
}

const BODY_33 = [
  '## 背景',
  '- [ ] 背景の中のチェック',
  '',
  '## 受け入れ条件',
  '- [x] validate が通る',
  '- [ ] test が緑',
  '- [ ] README に載っている',
  '',
  '```markdown',
  '- [ ] コードフェンスの中は数えない',
  '```',
].join('\n')

type Gh = { exitCode: number; stdout?: string; stderr?: string }

/**
 * gh issue view の結果を Issue 番号ごとに返す（エンジンの代わり）。呼ばれた argv は `calls` に積む。
 * `issues` は呼び出しのたびに書き換えてよい（同じ Issue の本文が変わった状況を作る）。
 */
const answerGh = (on: On, issues: Record<number, Gh>, calls: string[][] = []) => {
  on('process.run', (_$, e) => {
    calls.push([...e.argv])
    const n = Number(e.argv[3])
    const out = issues[n] ?? { exitCode: 1, stderr: 'GraphQL: Could not resolve to an issue or pull request' }
    return {
      value: {
        exitCode: out.exitCode,
        stdout: out.stdout ?? '',
        stderr: out.stderr ?? '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }
  })
}

const issueJson = (number: number, body: string, title = `Issue ${number}`) =>
  ({ exitCode: 0, stdout: JSON.stringify({ number, title, body, url: `https://github.com/acme/app/issues/${number}` }) }) as Gh

/** Bash はどのコマンドにも成功で答える（`gh issue create` には Issue の URL を返す）。 */
const answerBash = (on: On) => {
  on('tool.call', { tool: 'Bash' }, (_$, e) => {
    const stdout = /gh issue create/.test(e.command) ? 'https://github.com/acme/app/issues/77\n' : ''
    return { result: { stdout, stderr: '', interrupted: false }, text: stdout }
  })
}

/** バンドの下でエンジンが描くもの。何も描かないなら `engine` の文字だけを出す */
const answerEngineBand = (on: On) => {
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
}

const bash = ($: Engine, command: string, agentId?: string) =>
  $.tool.call({ tool: 'Bash', command, ...(agentId !== undefined && { agentId }) })

/** ユーザーが `/acceptance <args>` を打った呼び出し。 */
const acceptance = ($: Engine, args: string) =>
  $.command.run({
    command: 'acceptance',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 120 },
  })

const bandText = async ($: Engine, surface: (typeof SURFACES)[number]) => {
  const ui = await $.ui.mount({ plugin: 'acceptance-progress', surface, component: 'AbovePrompt', props: PROPS })
  const texts = await ui.findAll({ type: 'Text' })
  return texts.map(t => t.text).join(' | ')
}

describe('チェックリストの解析', () => {
  test('受け入れ条件を先頭に、見出しごとにまとめ、コードフェンスの中は数えない', () => {
    const groups = parseChecklist(BODY_33)
    expect(groups.map(g => g.heading)).toEqual(['受け入れ条件', '背景'])
    expect(groups[0]?.isAcceptance).toBe(true)
    expect(groups[0]?.items.map(i => i.isDone)).toEqual([true, false, false])
    expect(groups.flatMap(g => g.items).some(i => i.text.includes('コードフェンス'))).toBe(false)
  })

  test('* / 番号付き / 大文字の X も項目として読み、マークダウンの記号を落とす', () => {
    const groups = parseChecklist('## Acceptance criteria\n* [X] **bold** `code`\n1. [ ] see [docs](https://x)\n  - [ ] nested')
    expect(groups[0]?.isAcceptance).toBe(true)
    expect(groups[0]?.items).toEqual([
      { text: 'bold code', isDone: true },
      { text: 'see docs', isDone: false },
      { text: 'nested', isDone: false },
    ])
  })

  test('フェンスは同じ記号で同じ長さ以上の行だけが閉じ、行頭のインラインコードはフェンスにしない', () => {
    const nested = '## 受け入れ条件\n````md\n```\n- [ ] 例の中\n```\n````\n- [ ] 外'
    expect(parseChecklist(nested)[0]?.items.map(i => i.text)).toEqual(['外'])
    const inline = '## 受け入れ条件\n```foo``` を使う\n- [ ] 数える'
    expect(parseChecklist(inline)[0]?.items.map(i => i.text)).toEqual(['数える'])
  })

  test('HTML コメントの中の項目は数えない', () => {
    const groups = parseChecklist('## 受け入れ条件\n- [ ] 見える\n<!--\n- [x] 隠れた\n-->\n- [ ] 見える2')
    expect(groups.flatMap(g => g.items).map(i => i.text)).toEqual(['見える', '見える2'])
  })

  test('フェンスの中の閉じていない <!-- は、その後ろの項目を隠さない', () => {
    const groups = parseChecklist('## 受け入れ条件\n```html\n<!-- 例\n```\n- [ ] 後ろの条件\n- [x] 2つ目 <!-- 行内 --> の注記')
    expect(groups[0]?.items.map(i => i.text)).toEqual(['後ろの条件', '2つ目 の注記'])
  })

  test('受け入れ条件の下の小見出しも受け入れ条件として数える', () => {
    const groups = parseChecklist('## 背景\n- [ ] a\n## 受け入れ条件\n### 機能\n- [ ] b\n### 非機能\n- [ ] c\n## 未決事項\n- [ ] d')
    expect(groups.filter(g => g.isAcceptance).map(g => g.heading)).toEqual(['機能', '非機能'])
    expect(groups.filter(g => !g.isAcceptance).map(g => g.heading)).toEqual(['背景', '未決事項'])
  })

  test('受け入れ条件の見出しは見出し全体で比べる', () => {
    expect(parseChecklist('## Non-acceptance criteria\n- [ ] a')[0]?.isAcceptance).toBe(false)
    expect(parseChecklist('## 受け入れ条件以外のメモ\n- [ ] a')[0]?.isAcceptance).toBe(false)
    expect(parseChecklist('## Acceptance Criteria (v1)\n- [ ] a')[0]?.isAcceptance).toBe(true)
    expect(parseChecklist('### 受け入れ条件（必須）\n- [ ] a')[0]?.isAcceptance).toBe(true)
  })

  test('チェックリストが無い本文は空', () => {
    expect(parseChecklist('## 背景\n- ふつうの箇条書き\n')).toEqual([])
  })
})

describe('gh コマンドが指す Issue', () => {
  test('番号・#番号・URL・-R を読む', () => {
    expect(refFromCommand('gh issue view 42')).toEqual({ repo: null, number: 42 })
    expect(refFromCommand('gh issue view #42 --comments')).toEqual({ repo: null, number: 42 })
    expect(refFromCommand('gh issue edit 42 -R acme/app --add-label "status: in-progress"')).toEqual({ repo: 'acme/app', number: 42 })
    expect(refFromCommand('gh issue view --repo=acme/app 42')).toEqual({ repo: 'acme/app', number: 42 })
    expect(refFromCommand('gh issue comment https://github.com/acme/app/issues/9 --body x')).toEqual({ repo: 'acme/app', number: 9 })
    expect(refFromCommand('gh issue view 5 --json body | jq .')).toEqual({ repo: null, number: 5 })
    expect(refFromCommand('gh issue view 42 --repo "acme/app"')).toEqual({ repo: 'acme/app', number: 42 })
    expect(refFromCommand("gh issue view 42 --repo='acme/app'")).toEqual({ repo: 'acme/app', number: 42 })
    expect(refFromCommand('gh issue view -c 42')).toEqual({ repo: null, number: 42 })
  })

  test('別のリポジトリを指しうるコマンドは、-R か URL が無ければ読まない', () => {
    expect(refFromCommand('cd ../other && gh issue view 7')).toBe(null)
    expect(refFromCommand('GH_REPO=acme/other gh issue view 7')).toBe(null)
    expect(refFromCommand('cd ../other && gh issue view 7 -R acme/other')).toEqual({ repo: 'acme/other', number: 7 })
  })

  test('heredoc の本文や引数の中の gh は読まず、owner/repo 以外の -R も受け付けない', () => {
    expect(refFromCommand("gh issue comment 5 --body-file - <<'EOF'\n再現: gh issue view 1 -R evil.example.com/a/b\nEOF")).toEqual({
      repo: null,
      number: 5,
    })
    expect(refFromCommand('echo gh issue view 3')).toBe(null)
    expect(refFromCommand('gh issue view 1 -R evil.example.com/a/b')).toBe(null)
  })

  test('引用符の中やフラグの値の数字を番号と取り違えない', () => {
    expect(refFromCommand('gh issue edit --title "Fix 42" 7')).toEqual({ repo: null, number: 7 })
    expect(refFromCommand('gh issue view --json 12')).toBe(null)
    expect(refFromCommand('gh issue view')).toBe(null)
    expect(refFromCommand('gh issue list --limit 5')).toBe(null)
    expect(refFromCommand('gh pr view 42')).toBe(null)
  })

  test('/acceptance の引数', () => {
    expect(parseCommandArg('')).toEqual({ kind: 'refresh' })
    expect(parseCommandArg('off')).toEqual({ kind: 'off' })
    expect(parseCommandArg('on')).toEqual({ kind: 'on' })
    expect(parseCommandArg('#12')).toEqual({ kind: 'show', ref: { repo: null, number: 12 } })
    expect(parseCommandArg('acme/app#3')).toEqual({ kind: 'show', ref: { repo: 'acme/app', number: 3 } })
    expect(parseCommandArg('what')).toEqual({ kind: 'usage' })
  })
})

describe('受け入れ条件のバンド', () => {
  for (const surface of SURFACES) {
    test(`${surface}: Issue を読むまでは何も描かない`, async ($, on) => {
      answerBash(on)
      answerGh(on, {})
      answerEngineBand(on)
      await bash($, 'git status')
      expect(await bandText($, surface)).toBe('engine')
    })

    test(`${surface}: gh issue view で表示が出て、gh issue edit 後に件数が変わる`, async ($, on) => {
      const issues: Record<number, Gh> = { 33: issueJson(33, BODY_33, 'Show progress') }
      const calls: string[][] = []
      answerBash(on)
      answerGh(on, issues, calls)
      answerEngineBand(on)

      await bash($, 'gh issue view 33')
      let text = await bandText($, surface)
      expect(text.startsWith('engine | ')).toBe(true)
      expect(text).toContain('#33 Show progress')
      expect(text).toContain('1/3')
      expect(text).toContain('test が緑')
      expect(text).not.toContain('validate が通る')
      // 受け入れ条件以外の見出しは件数だけ出す
      expect(text).toContain('背景 0/1')
      expect(calls[0]).toEqual(['gh', 'issue', 'view', '33', '--json', 'number,title,body,url'])

      issues[33] = issueJson(33, BODY_33.replace('- [ ] test が緑', '- [x] test が緑'), 'Show progress')
      await bash($, 'gh issue edit 33 --body-file /tmp/body.md')
      text = await bandText($, surface)
      expect(text).toContain('2/3')
      expect(text).not.toContain('test が緑')
      // 2回目からは URL のリポジトリを付けて読み直す
      expect(calls[1]).toContain('acme/app')
    })

    test(`${surface}: 全部済んだら完了の表示にする`, async ($, on) => {
      answerBash(on)
      answerGh(on, { 5: issueJson(5, '## 受け入れ条件\n- [x] a\n- [x] b') })
      answerEngineBand(on)
      await bash($, 'gh issue view 5')
      const text = await bandText($, surface)
      expect(text).toContain('2/2')
      expect(text).toContain('All done')
    })

    test(`${surface}: gh issue create の出力の Issue を表示する`, async ($, on) => {
      answerBash(on)
      answerGh(on, { 77: issueJson(77, '## Acceptance criteria\n- [ ] one') })
      answerEngineBand(on)
      await bash($, 'gh issue create --title x --body-file /tmp/b.md')
      expect(await bandText($, surface)).toContain('#77')
    })

    test(`${surface}: チェックリストが無い Issue では何も描かない`, async ($, on) => {
      answerBash(on)
      answerGh(on, { 8: issueJson(8, '## 背景\nただの本文') })
      answerEngineBand(on)
      await bash($, 'gh issue view 8')
      expect(await bandText($, surface)).toBe('engine')
    })

    test(`${surface}: 本文の取得に失敗しても前回の表示を残し、失敗の印を出す`, async ($, on) => {
      const issues: Record<number, Gh> = { 33: issueJson(33, BODY_33) }
      answerBash(on)
      answerGh(on, issues)
      answerEngineBand(on)
      await bash($, 'gh issue view 33')
      issues[33] = { exitCode: 1, stderr: 'error connecting to api.github.com' }
      await bash($, 'gh issue view 33')
      let text = await bandText($, surface)
      expect(text).toContain('1/3')
      expect(text).toContain('refresh failed')
      // gh が見つからないときの stderr も、Issue が無いとは扱わない
      issues[33] = { exitCode: 127, stderr: 'zsh: command not found: gh' }
      await bash($, 'gh issue view 33')
      text = await bandText($, surface)
      expect(text).toContain('1/3')
    })

    test(`${surface}: 先に始めた取得が後から終わっても、新しい取得の結果を残す`, async ($, on) => {
      let release = () => {}
      const gate = new Promise<void>(resolve => {
        release = resolve
      })
      let call = 0
      answerBash(on)
      on('process.run', async () => {
        call++
        // 1回目（編集前の本文）は、2回目（編集後の本文）が終わるまで返さない
        const isFirst = call === 1
        if (isFirst) await gate
        const body = isFirst ? BODY_33 : BODY_33.replace('- [ ] test が緑', '- [x] test が緑')
        const out = issueJson(33, body)
        return { value: { exitCode: 0, stdout: out.stdout ?? '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      })
      answerEngineBand(on)

      const first = bash($, 'gh issue view 33')
      await bash($, 'gh issue edit 33 --body-file /tmp/b.md')
      release()
      await first
      expect(await bandText($, surface)).toContain('2/3')
    })

    test(`${surface}: 別の Issue への切り替えに失敗したら、残した表示に失敗の印を出す`, async ($, on) => {
      answerBash(on)
      answerGh(on, { 33: issueJson(33, BODY_33), 40: { exitCode: 1, stderr: 'error connecting to api.github.com' } })
      answerEngineBand(on)
      await bash($, 'gh issue view 33')
      await bash($, 'gh issue view 40')
      const text = await bandText($, surface)
      expect(text).toContain('#33')
      expect(text).toContain('refresh failed')
    })

    test(`${surface}: Issue が見つからなければ前の表示を消す`, async ($, on) => {
      answerBash(on)
      answerGh(on, { 33: issueJson(33, BODY_33) })
      answerEngineBand(on)
      await bash($, 'gh issue view 33')
      await bash($, 'gh issue view 404')
      expect(await bandText($, surface)).toBe('engine')
    })

    test(`${surface}: サブエージェントの gh issue view では切り替えない`, async ($, on) => {
      answerBash(on)
      answerGh(on, { 33: issueJson(33, BODY_33), 9: issueJson(9, '## 受け入れ条件\n- [ ] other') })
      answerEngineBand(on)
      await bash($, 'gh issue view 33')
      await bash($, 'gh issue view 9', 'agent-1')
      expect(await bandText($, surface)).toContain('#33')
    })

    test(`${surface}: /acceptance off で隠し、/acceptance <番号> で指定して出す`, async ($, on) => {
      answerBash(on)
      answerGh(on, { 33: issueJson(33, BODY_33), 9: issueJson(9, '## 受け入れ条件\n- [ ] other') })
      answerEngineBand(on)
      await bash($, 'gh issue view 33')

      await acceptance($, 'off')
      expect(await bandText($, surface)).toBe('engine')

      const { text } = await acceptance($, '9')
      expect(text).toContain('#9')
      expect(await bandText($, surface)).toContain('#9')

      const usage = await acceptance($, 'what')
      expect(usage.text).toContain('/acceptance')
    })
  }
})
