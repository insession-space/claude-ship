// guard.ts（入力と返答を伏せるフック）と patterns.ts のテスト。`claude plugin test plugins/secret-guard` で走る。
// テストの `on` で登録したフックはプラグインの下に入り、エンジン（入力の受け取り・行の保存・トースト）の代わりをする。
//
// ここに書く値はすべて偽物。本物の接頭辞を持つ文字列は、ソースや diff に本物らしい形で現れないよう、
// 接頭辞を2つに割って実行時に連結して組み立てる。
import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { redact } from '../hooks/patterns'

const FAKE = {
  github: 'gh' + 'p_' + 'FAKE' + 'x0'.repeat(16),
  githubPat: 'github' + '_pat_' + 'FAKE0'.repeat(15),
  anthropic: 'sk-' + 'ant-' + 'api03-' + 'FAKE'.repeat(10),
  openaiProject: 'sk-' + 'proj-' + 'FAKEfake0'.repeat(5),
  openaiLegacy: 'sk-' + 'FAKEfake0123'.repeat(4),
  google: 'AI' + 'za' + 'FAKEfake0'.repeat(3) + 'FAKEfake',
  aws: 'AK' + 'IA' + 'FAKE0FAKE0FAKE00',
  slack: 'xo' + 'xb-' + '000000000000-' + 'FAKEfake0000',
  stripe: 'sk' + '_live_' + 'FAKEfake0'.repeat(3),
  pem: ['-----BEGIN ' + 'RSA PRIVATE' + ' KEY-----', 'FAKEfake'.repeat(8), 'FAKEfake'.repeat(4) + '==', '-----END RSA PRIVATE KEY-----'].join('\n'),
}

const ALL_FAKES = Object.values(FAKE)

type Toasts = string[]

type Block = { type: string; [k: string]: unknown }

/**
 * エンジンの代わりに、届いた入力の文を `prompts` に、トーストの文を `toasts` に、
 * プラグインの下まで届いた行の content を `rows` に積む。
 */
const answerEngine = (on: On, prompts: string[], toasts: Toasts, stateWrites: string[] = [], rows: Block[][] = []) => {
  on('prompt.submit', (_$, e) => {
    prompts.push(e.text)
    return { text: e.text }
  })
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  // テストのフックは行に自分の答えを返せない（next を呼ばない答えは飛ばされる）。
  // そこで届いた content を控えてから next に渡す。下には何も無いので呼び出しは失敗する
  on('session.append', (_$, e, next) => {
    rows.push(e.message.content)
    return next(e)
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  // プラグインが $.state に書いた値をすべて控える（値そのものが残っていないことを確かめる）
  on('state.set', (_$, e, next) => {
    stateWrites.push(JSON.stringify(e))
    return next(e)
  })
}

const submit = ($: Engine, text: string) => $.prompt.submit({ text, origin: { kind: 'composer' }, wait: false })

/** 行を1つ追加し、プラグインを通ってエンジンの位置まで届いた content を返す。 */
const appendRow = async ($: Engine, rows: Block[][], door: 'response' | 'tool-result', content: Block[]) => {
  await $.session
    .append({
      message: door === 'response' ? { type: 'assistant', role: 'assistant', content } : { type: 'user', role: 'user', content },
      door,
      origin: door === 'response' ? { kind: 'model', model: 'test-model' } : { kind: 'tool', tool: 'Bash' },
      uuid: `row-${door}`,
    })
    .catch(() => undefined)
  return rows.at(-1)
}

describe('形の検出', () => {
  test('それぞれの形を種類つきで伏せる', () => {
    const cases: [string, string][] = [
      [FAKE.github, 'github'],
      [FAKE.githubPat, 'github'],
      [FAKE.anthropic, 'anthropic'],
      [FAKE.openaiProject, 'openai'],
      [FAKE.openaiLegacy, 'openai'],
      [FAKE.google, 'google'],
      [FAKE.aws, 'aws'],
      [FAKE.slack, 'slack'],
      [FAKE.stripe, 'stripe'],
      [FAKE.pem, 'private-key'],
    ]
    for (const [value, kind] of cases) {
      const r = redact(`key: ${value} end`)
      expect(r.text).toBe(`key: [redacted:${kind}] end`)
      expect(r.count).toBe(1)
      expect(r.kinds).toEqual([kind])
    }
  })

  test('1つの文の中の複数の値を数え、種類は初出順に重複なく返す', () => {
    const r = redact(`A=${FAKE.github}\nB="${FAKE.aws}"\nC=${FAKE.github.replace('FAKE', 'FAKF')}`)
    expect(r.count).toBe(3)
    expect(r.kinds).toEqual(['github', 'aws'])
    expect(r.text).toBe('A=[redacted:github]\nB="[redacted:aws]"\nC=[redacted:github]')
  })

  test('伏せた結果をもう一度通しても変わらない', () => {
    const once = redact(ALL_FAKES.join(' ')).text
    expect(redact(once)).toEqual({ text: once, count: 0, kinds: [] })
    for (const v of ALL_FAKES) expect(once).not.toContain(v)
  })

  test('END の無い PEM ブロックも、続く base64 の行まで伏せる', () => {
    const cut = ['-----BEGIN ' + 'PRIVATE' + ' KEY-----', 'FAKEfake'.repeat(8), 'FAKEfake'.repeat(8)].join('\n')
    const r = redact(`貼った鍵\n${cut}\n以上`)
    expect(r.text).toBe('貼った鍵\n[redacted:private-key]\n以上')
  })

  test('誤検知しない', () => {
    const benign = [
      'ふつうの日本語の文と English text',
      'sk-' + 'this-is-a-very-long-kebab-case-identifier-name-for-css',
      'sk-' + 'abcdefghijklmnopqrstuvwxyzabcdefghij',
      'disk-' + 'FAKEfake0123'.repeat(4),
      'gh' + 'p_' + 'short',
      'github' + '_pat_',
      'AK' + 'IA' + 'SHORT',
      'AK' + 'IA' + 'FAKE0FAKE0FAKE00X',
      'AI' + 'za' + 'tooShort0123',
      'xo' + 'xb-' + 'your-token-here',
      'sk' + '_test_' + 'FAKEfake0'.repeat(3),
      '-----BEGIN ' + 'PRIVATE' + ' KEY-----',
      ['-----BEGIN ' + 'PRIVATE' + ' KEY-----', '...', '-----END PRIVATE KEY-----'].join('\n'),
      '-----BEGIN ' + 'CERTIFICATE-----\n' + 'FAKEfake'.repeat(8) + '\n-----END CERTIFICATE-----',
      '[redacted:github] はすでに伏せてある',
    ]
    for (const text of benign) expect(redact(text)).toEqual({ text, count: 0, kinds: [] })
  })
})

describe('ユーザーの入力', () => {
  test('値を伏せてから送り、件数と種類だけをトーストで伝える', async ($, on) => {
    const prompts: string[] = []
    const toasts: Toasts = []
    const stateWrites: string[] = []
    answerEngine(on, prompts, toasts, stateWrites)

    const result = await submit($, `このキーで試して ${FAKE.google} と ${FAKE.anthropic}`)
    expect(prompts).toEqual(['このキーで試して [redacted:google] と [redacted:anthropic]'])
    expect(result.text).toBe('このキーで試して [redacted:google] と [redacted:anthropic]')
    expect(toasts.length).toBe(1)
    expect(toasts[0]).toContain('2 件')
    expect(toasts[0]).toContain('ローテーション')
    expect(stateWrites.length).toBeGreaterThan(0)
    for (const v of ALL_FAKES) {
      expect(toasts[0]).not.toContain(v)
      for (const w of stateWrites) expect(w).not.toContain(v)
    }
  })

  test('英語の入力には英語のトーストを出す', async ($, on) => {
    const prompts: string[] = []
    const toasts: Toasts = []
    answerEngine(on, prompts, toasts)
    await submit($, `use ${FAKE.github}`)
    expect(toasts[0]).toContain('redacted 1 secret-shaped string')
    expect(toasts[0]).toContain('github')
    expect(toasts[0]).not.toContain(FAKE.github)
  })

  test('settings の language が入力の文字より優先される', async ($, on) => {
    const prompts: string[] = []
    const toasts: Toasts = []
    answerEngine(on, prompts, toasts)
    on('settings.read', () => ({ value: { language: 'English' } }))
    await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
    await submit($, `このキー ${FAKE.stripe}`)
    expect(toasts[0]).toContain('Consider rotating')
  })

  test('シークレットの形が無ければそのまま送り、トーストも出さない', async ($, on) => {
    const prompts: string[] = []
    const toasts: Toasts = []
    answerEngine(on, prompts, toasts)
    const text = 'gh issue view 35 を読んで、sk-' + 'learn の README を直して'
    await submit($, text)
    expect(prompts).toEqual([text])
    expect(toasts).toEqual([])
  })

  test('エンジン由来の入力も伏せる', async ($, on) => {
    const prompts: string[] = []
    const toasts: Toasts = []
    answerEngine(on, prompts, toasts)
    await $.prompt.submit({ text: `task output: ${FAKE.slack}`, origin: { kind: 'task-notification' }, wait: false })
    expect(prompts).toEqual(['task output: [redacted:slack]'])
  })
})

describe('モデルの返答', () => {
  test('返答の text ブロックを伏せ、ほかのブロックは触らない', async ($, on) => {
    const prompts: string[] = []
    const toasts: Toasts = []
    const stateWrites: string[] = []
    const rows: Block[][] = []
    answerEngine(on, prompts, toasts, stateWrites, rows)
    const toolUse = { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'echo ok' } }
    const stored = await appendRow($, rows, 'response', [
      { type: 'text', text: `キーは ${FAKE.pem} です` },
      toolUse,
      { type: 'text', text: `もう1つ ${FAKE.openaiProject}` },
    ])
    expect(stored).toEqual([
      { type: 'text', text: 'キーは [redacted:private-key] です' },
      toolUse,
      { type: 'text', text: 'もう1つ [redacted:openai]' },
    ])
    // 返答ではトーストを出さない
    expect(toasts).toEqual([])
    for (const v of ALL_FAKES) for (const w of stateWrites) expect(w).not.toContain(v)
  })

  test('シークレットの形が無い返答はそのまま保存する', async ($, on) => {
    const rows: Block[][] = []
    answerEngine(on, [], [], [], rows)
    const content = [{ type: 'text', text: 'ふつうの返答です。sk-' + 'learn を使います。' }]
    expect(await appendRow($, rows, 'response', content)).toEqual(content)
  })

  test('ツール結果の行は伏せない', async ($, on) => {
    const rows: Block[][] = []
    answerEngine(on, [], [], [], rows)
    const content = [{ type: 'tool_result', tool_use_id: 'toolu_1', content: `AWS_ACCESS_KEY_ID=${FAKE.aws}` }]
    expect(await appendRow($, rows, 'tool-result', content)).toEqual(content)
  })
})
