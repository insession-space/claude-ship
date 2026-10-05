// 子エージェント（サブエージェントとチームメイト）が走っている間、1体ずつキャラクターとして出す mod。
// 入力欄の上のバンドに1体1行、スピナー行の先頭に顔を並べる。
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Cast } from '../types'
import {
  LABELS,
  bandRows,
  elapsedSeconds,
  faceFor,
  hasJapanese,
  initial,
  langFromSetting,
  onDone,
  onMainTurnEnd,
  onSpawn,
  onTool,
  spinnerText,
  statusText,
  tick,
} from './cast'

const cast = atom({ plugin: 'agent-cast', key: 'cast' } as const, initial() as Cast)
const lang = atom({ plugin: 'agent-cast', key: 'lang' } as const, null as 'ja' | 'en' | null)

// 経過秒を進め、終わったエージェントを消すためのタイマー。一覧が空になったら止める。
// 再読み込みでこの変数は消えるが、session.start で一覧が残っていれば張り直す
let ticker: Timer | null = null

const step = async ($: EngineInterface) => {
  const now = await $.clock.now()
  const next = await update($, cast, c => tick(c, now))
  if (next.agents.length === 0) {
    ticker?.cancel()
    ticker = null
  }
}

const ensureTicker = ($: EngineInterface) => {
  if (ticker === null) ticker = $.clock.every(1000, () => void step($))
}

export const register: Register = on => {
  // settings の `language` が決まっていればそれを使い、無ければプロンプトの文字で決める
  let isLangFromSettings = false

  on('session.start', async ($, e, next) => {
    const fromSettings = langFromSetting((await $.settings.read()).language)
    isLangFromSettings = fromSettings !== null
    if (fromSettings !== null) await update($, lang, () => fromSettings)
    if ((await read($, cast)).agents.length > 0) ensureTicker($)

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      ticker?.cancel()
      ticker = null
      await update($, cast, () => initial())
    }

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const isUserText = e.origin.kind === 'composer' || e.origin.kind === 'bridge'
    if (isUserText && !isLangFromSettings) await update($, lang, () => (hasJapanese(e.text) ? 'ja' : 'en'))

    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.agentId === undefined) return ran

    const agent = {
      id: ran.agentId,
      type: e.subagentType,
      description: e.description,
      isDetached: e.background || e.isTeammate === true,
    }
    const now = await $.clock.now()
    await update($, cast, c => onSpawn(c, agent, now))
    ensureTicker($)

    return ran
  })

  // 子エージェントのループのツール呼び出し。実行中だけツール名を出す
  on('tool.call', async ($, e, next) => {
    const id = e.agentId
    if (id === undefined || !(await read($, cast)).agents.some(a => a.id === id)) return next(e)

    await update($, cast, c => onTool(c, id, e.tool))
    try {
      return await next(e)
    } finally {
      await update($, cast, c => (c.agents.find(a => a.id === id)?.tool === e.tool ? onTool(c, id, null) : c))
    }
  })

  on('turn.complete', async ($, e, next) => {
    const now = await $.clock.now()
    const id = e.agentId
    const { agents } = await read($, cast)
    if (id !== undefined) {
      if (agents.some(a => a.id === id)) await update($, cast, c => onDone(c, id, now))
    } else if (agents.some(a => a.state === 'running' && !a.isDetached)) {
      await update($, cast, c => onMainTurnEnd(c, now))
    }

    return next(e)
  })

  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    // 圧縮中などエンジンが message を出しているときは、そちらを優先する
    if (e.props.message !== null) return next(e)
    const text = spinnerText(await read($, cast), (await read($, lang)) ?? 'en')
    if (text === null) return next(e)

    return next({ ...e, props: { ...e.props, message: text } })
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const c = await read($, cast)
    if (e.props.hasSurvey || c.agents.length === 0) return next(e)

    // 他のプラグイン（ship-session のバンドなど）が描くものの下に並べる
    const below = await next(e)
    const { Box, Text } = $.ui.resolve(e)
    const l = (await read($, lang)) ?? 'en'
    const { rows, rest } = bandRows(c)
    // 種別名の長さが違っても説明の列が揃うよう、種別の列を一番長い名前の幅にする
    const typeWidth = Math.max(...rows.map(a => a.type.length))

    return (
      <Box flexDirection="column">
        {below}
        <Box flexDirection="column" borderStyle="round" borderColor="magenta" paddingX={1}>
          <Text bold color="magenta">
            {LABELS[l].title(c.agents.length)}
          </Text>
          {rows.map(a => (
            <Box key={a.id} columnGap={1}>
              <Text color={a.state === 'running' ? 'magenta' : undefined} dimColor={a.state !== 'running'}>
                {faceFor(a.type)}
              </Text>
              <Box width={typeWidth} flexShrink={0}>
                <Text bold>{a.type}</Text>
              </Box>
              <Box flexGrow={1} flexShrink={1}>
                <Text wrap="truncate-end">{a.description}</Text>
              </Box>
              <Text
                color={a.state === 'done' ? 'green' : a.state === 'aborted' ? 'red' : 'yellow'}
                bold={a.state === 'running' && a.tool !== null}
              >
                {statusText(a, l)}
              </Text>
              <Text dimColor>{elapsedSeconds(a, c.now)}s</Text>
            </Box>
          ))}
          {rest > 0 && <Text dimColor>{LABELS[l].rest(rest)}</Text>}
        </Box>
      </Box>
    )
  })
}
