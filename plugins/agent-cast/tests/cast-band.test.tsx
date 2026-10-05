// cast-band.tsx（子エージェントのバンドとスピナー行）のテスト。`claude plugin test plugins/agent-cast` で走る。
// テストの `on` で登録したフックはプラグインの下に入り、エンジン（エージェントの起動やツールの実行）の代わりをする。
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { FACES, LINGER_MS, faceFor } from '../hooks/cast'

const SURFACES = ['terminal', 'desktop'] as const
type Surface = (typeof SURFACES)[number]

const BAND_PROPS = {
  hasSurvey: false,
  isWorking: true,
  maxRows: 12,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 12 },
  view: {},
}

const SPINNER_PROPS = { word: 'Sauteing', message: null, suffix: '…', mode: 'tool-use' as const }

/** エージェントの起動に、呼ばれた順の agentId（a1, a2, …）で答える。`deny` を含む説明は拒否する。 */
const answerSpawns = (on: On) => {
  let n = 0
  on('agent.spawn', (_$, e) => {
    if (e.description.includes('deny')) return { deny: 'refused' }
    n += 1
    return { model: 'claude-sonnet-5-5', agentId: `a${n}` }
  })
}

/** バンドやスピナーを譲ったときにエンジンが描くものと、ターンの終わり。 */
const answerEngineDrawing = (on: On) => {
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  on('ui.render', { component: 'Spinner' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.message ?? e.props.word}</Text>
  })
}

const spawn = ($: Engine, subagentType: string, description: string, background = false) =>
  $.agent.spawn({
    tool_use_id: `toolu_${description}`,
    prompt: description,
    description,
    subagentType,
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-opus-5-5',
    background,
    fork: false,
  })

const finish = ($: Engine, agentId?: string) =>
  $.turn.complete({
    answer: '',
    durationMs: 1000,
    isAborted: false,
    turnId: 'turn-1',
    reason: 'answer',
    ...(agentId !== undefined && { agentId }),
  })

/** 描かれた文字を、要素の順に1本の文字列にする。 */
const drawn = async ($: Engine, surface: Surface, component: 'AbovePrompt' | 'Spinner') => {
  const ui = await $.ui.mount({
    plugin: 'agent-cast',
    surface,
    component,
    props: component === 'AbovePrompt' ? BAND_PROPS : SPINNER_PROPS,
  })
  const texts = await ui.findAll({ type: 'Text' })
  return texts.map(t => t.text).join(' | ')
}

describe('顔の割り当て', () => {
  test('組み込みの6種はそれぞれ別の顔で、未知の種別は名前で決まる', () => {
    const builtins = ['Explore', 'Plan', 'general-purpose', 'claude-code-guide', 'fork', 'teammate']
    const faces = builtins.map(faceFor)
    expect(new Set(faces).size).toBe(6)
    for (const t of builtins) expect(faceFor(t)).toBe(FACES[t])

    expect(faceFor('my-plugin:reviewer')).toBe(faceFor('my-plugin:reviewer'))
    expect(builtins.map(faceFor)).not.toContain(faceFor('my-plugin:reviewer'))
    for (const f of [...faces, faceFor('x'), faceFor('another-agent')]) expect(f.length).toBe(5)
  })
})

describe('子エージェントのバンドとスピナー行', () => {
  for (const surface of SURFACES) {
    test(`${surface}: 子エージェントが0体ならエンジンの描画のまま`, async ($, on) => {
      mock.clock(on)
      answerEngineDrawing(on)
      expect(await drawn($, surface, 'AbovePrompt')).toBe('engine')
      expect(await drawn($, surface, 'Spinner')).toBe('Sauteing')
    })

    test(`${surface}: 1体起動すると、バンドに1行、スピナー行に顔が出る`, async ($, on) => {
      const clock = mock.clock(on)
      answerSpawns(on)
      answerEngineDrawing(on)

      await spawn($, 'Explore', 'find the auth code')
      await clock.advance(3000)
      const band = await drawn($, surface, 'AbovePrompt')
      expect(band).toContain('Subagents: 1')
      expect(band).toContain('(o.o) | Explore | find the auth code | thinking | 3s')
      expect(await drawn($, surface, 'Spinner')).toBe('(o.o) 1 agent working')
    })

    test(`${surface}: ツールの実行中だけ、その行の状態がツール名になる`, async ($, on) => {
      const clock = mock.clock(on)
      answerSpawns(on)
      answerEngineDrawing(on)
      // ツールの実行を止めておき、その間にバンドを見る
      let release = () => {}
      const held = new Promise<void>(resolve => (release = resolve))
      on('tool.call', async () => {
        await held
        return { result: 'ok', text: 'ok' }
      })

      await spawn($, 'Explore', 'find the auth code')
      // エンジンは子エージェントのループの呼び出しに agentId を付けて流す。$.tool.call の型は
      // プラグインから呼ぶ形なので agentId を持たず、変数に入れて渡す
      const input = { tool: 'Read' as const, file_path: '/src/auth.ts', agentId: 'a1' }
      const call = $.tool.call(input)
      await clock.advance(0)
      expect(await drawn($, surface, 'AbovePrompt')).toContain('| Read |')
      release()
      await call
      expect(await drawn($, surface, 'AbovePrompt')).toContain('| thinking |')
    })

    test(`${surface}: 終わったら「完了」になり、5秒後に消える`, async ($, on) => {
      const clock = mock.clock(on)
      answerSpawns(on)
      answerEngineDrawing(on)

      await spawn($, 'Plan', 'plan the change')
      await clock.advance(2000)
      await finish($, 'a1')
      let band = await drawn($, surface, 'AbovePrompt')
      expect(band).toContain('| done | 2s')
      expect(await drawn($, surface, 'Spinner')).toBe('Sauteing')

      await clock.advance(LINGER_MS - 1000)
      expect(await drawn($, surface, 'AbovePrompt')).toContain('plan the change')
      await clock.advance(1000)
      band = await drawn($, surface, 'AbovePrompt')
      expect(band).toBe('engine')
    })

    test(`${surface}: 起動が拒否されたら何も出さない`, async ($, on) => {
      mock.clock(on)
      answerSpawns(on)
      answerEngineDrawing(on)

      const ran = await spawn($, 'Explore', 'please deny this')
      expect(ran.deny).toBe('refused')
      expect(await drawn($, surface, 'AbovePrompt')).toBe('engine')
    })

    test(`${surface}: 終了が届かずにメインのターンが終わると「中断」になり、バックグラウンドは残る`, async ($, on) => {
      const clock = mock.clock(on)
      answerSpawns(on)
      answerEngineDrawing(on)

      await spawn($, 'Explore', 'foreground task')
      await spawn($, 'general-purpose', 'background task', true)
      await finish($)
      let band = await drawn($, surface, 'AbovePrompt')
      expect(band).toContain('foreground task | interrupted')
      expect(band).toContain('background task | thinking')

      await clock.advance(LINGER_MS)
      band = await drawn($, surface, 'AbovePrompt')
      expect(band).not.toContain('foreground task')
      expect(band).toContain('background task')
      expect(await drawn($, surface, 'Spinner')).toBe('(^_^) 1 agent working')
    })

    test(`${surface}: 6体以上なら5行と「ほか N 体」、スピナーの顔は5つと「+N」`, async ($, on) => {
      mock.clock(on)
      answerSpawns(on)
      answerEngineDrawing(on)

      for (let i = 1; i <= 7; i++) await spawn($, 'Explore', `task ${i}`)
      const band = await drawn($, surface, 'AbovePrompt')
      expect(band).toContain('Subagents: 7')
      expect(band).toContain('task 5')
      expect(band).not.toContain('task 6')
      expect(band).toContain('2 more')
      expect(await drawn($, surface, 'Spinner')).toBe('(o.o) (o.o) (o.o) (o.o) (o.o) +2 7 agents working')
    })

    test(`${surface}: 他のプラグインがバンドを描いていても、両方を出す`, async ($, on) => {
      mock.clock(on)
      answerSpawns(on)
      answerEngineDrawing(on)

      await spawn($, 'Explore', 'find the auth code')
      const band = await drawn($, surface, 'AbovePrompt')
      expect(band.startsWith('engine | ')).toBe(true)
      expect(band).toContain('find the auth code')
    })

    test(`${surface}: language が日本語なら日本語で出す`, async ($, on) => {
      mock.clock(on)
      answerSpawns(on)
      answerEngineDrawing(on)
      on('prompt.submit', (_$, e) => ({ text: e.text }))

      await $.prompt.submit({ text: '認証まわりを調べて', wait: false, origin: { kind: 'composer' } })
      await spawn($, 'Explore', '認証まわりを探す')
      await spawn($, 'Plan', '方針を立てる')
      await finish($, 'a2')
      const band = await drawn($, surface, 'AbovePrompt')
      expect(band).toContain('子エージェント 2体')
      expect(band).toContain('思考中')
      expect(band).toContain('完了')
      expect(await drawn($, surface, 'Spinner')).toBe('(o.o) 1体が作業中')
    })

    test(`${surface}: /clear で一覧を空にする`, async ($, on) => {
      mock.clock(on)
      answerSpawns(on)
      answerEngineDrawing(on)
      on('session.end', (_$, e) => ({ sessionId: e.sessionId }))

      await spawn($, 'Explore', 'find the auth code')
      await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
      expect(await drawn($, surface, 'AbovePrompt')).toBe('engine')
    })
  }
})
