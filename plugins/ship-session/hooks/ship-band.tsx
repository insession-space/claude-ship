// ship-session の進捗とゲートのブロックを、プロンプト入力欄の上のバンドに出す mod。
// command hook（ship-gate.py など）とは別に、hooks.json の `modules` から読まれる。
// mods を知らない Claude Code ではこのファイルは読まれず、command hook だけが動く。
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Lang, ShipProgress } from '../types'
import {
  GATE_MARKER,
  LABELS,
  NEXT_HEADERS,
  currentStep,
  goalFromAnswers,
  goalFromRecord,
  hasJapanese,
  isGoalRecord,
  isIssueCreate,
  isPrCreate,
  langFromSetting,
  numberFromUrl,
  onSkill,
  slashSkill,
} from './ship-progress'

const progress = atom({ plugin: 'ship-session', key: 'progress' } as const, null as ShipProgress | null)
const lang = atom({ plugin: 'ship-session', key: 'lang' } as const, null as Lang | null)

/**
 * ship-session の進行として数える呼び出しか。ship-session を起動していない
 * セッションと、サブエージェントの呼び出しは数えない。
 */
const isTracked = async ($: EngineInterface, agentId: string | undefined): Promise<boolean> =>
  agentId === undefined && (await read($, progress)) !== null

export const register: Register = on => {
  // settings の `language` が決まっていればそれを使い、無ければプロンプトの文字で決める
  // （skills/_shared/user-language.md と同じ優先順位）
  let isLangFromSettings = false

  on('session.start', async ($, e, next) => {
    const fromSettings = langFromSetting((await $.settings.read()).language)
    isLangFromSettings = fromSettings !== null
    if (fromSettings !== null) await update($, lang, () => fromSettings)

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    // ユーザーが打った文だけを見る（タスク通知などエンジン由来の文は英語で来る）
    const isUserText = e.origin.kind === 'composer' || e.origin.kind === 'bridge'
    if (isUserText && !isLangFromSettings) {
      await update($, lang, () => (hasJapanese(e.text) ? 'ja' : 'en'))
    }
    // `/ship-session:ship-session ...` と打たれた起動。skill.prompt はユーザー層の
    // プラグインに届かない（組み込みのセキュリティ層が素通しする）ので、入力から拾う
    const typed = isUserText ? slashSkill(e.text) : null
    if (typed !== null) await update($, progress, p => onSkill(p, typed))

    return next(e)
  })

  // エージェントが Skill ツールで呼んだ起動と委譲
  on('tool.call', { tool: 'Skill' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true && e.agentId === undefined) {
      await update($, progress, p => onSkill(p, e.skill))
    }

    return ran
  })

  // ゲート（ship-gate.py の PreToolUse）が止めた呼び出しは、エラー本文に印が入って返る
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (!(await isTracked($, e.agentId))) return ran

    const blocked = ran.deny ?? (ran.isError === true ? ran.text : undefined)
    if (blocked?.includes(GATE_MARKER)) {
      await update($, progress, p => (p === null ? p : { ...p, gate: e.tool }))
      $.ui.toast(LABELS[(await read($, lang)) ?? 'en'].toast(e.tool))
    }

    return ran
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true || !(await isTracked($, e.agentId))) return ran

    const text = ran.text ?? ''
    const goal = isGoalRecord(e.command) ? goalFromRecord(text) : null
    const issue = isIssueCreate(e.command) ? numberFromUrl(text, 'issues') : null
    const pr = isPrCreate(e.command) ? numberFromUrl(text, 'pull') : null
    // 進捗に関係ないコマンドで状態を書くと、バンドが毎回描き直される
    if (goal === null && issue === null && pr === null) return ran
    await update($, progress, p =>
      p === null
        ? p
        : {
            ...p,
            ...(goal !== null && { goal, gate: null }),
            ...(issue !== null && { issue }),
            ...(pr !== null && { pr }),
          },
    )

    return ran
  })

  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true || !(await isTracked($, e.agentId))) return ran

    const { questions, answers } = ran.result
    const goal = goalFromAnswers(questions, answers)
    const isNext = questions.some(q => NEXT_HEADERS.includes(q.header))
    if (goal === null && !isNext) return ran
    await update($, progress, p =>
      p === null
        ? p
        : {
            ...p,
            ...(goal !== null && { goal, gate: null }),
            ...(isNext && { phase: 3 as const }),
          },
    )

    return ran
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const p = await read($, progress)
    if (e.props.hasSurvey || p === null) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const l = LABELS[(await read($, lang)) ?? 'en']
    const step = currentStep(p)

    return (
      <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
        <Box justifyContent="space-between">
          <Text bold color="cyan">
            {l.title}
          </Text>
          <Text>
            <Text dimColor>{l.goal} </Text>
            <Text bold>{p.goal ?? '…'}</Text>
          </Text>
        </Box>
        <Box flexWrap="wrap" columnGap={2}>
          {l.steps.map((label, i) =>
            i < step ? (
              <Text color="green">✔ {label}</Text>
            ) : i === step ? (
              <Text bold color="black" backgroundColor="yellow">
                {' '}▶ {label}{' '}
              </Text>
            ) : (
              <Text dimColor>○ {label}</Text>
            ),
          )}
        </Box>
        <Box columnGap={3}>
          <Text>
            Issue <Text bold>{p.issue === null ? l.none : `#${p.issue}`}</Text>
          </Text>
          <Text>
            PR <Text bold>{p.pr === null ? l.none : `#${p.pr}`}</Text>
          </Text>
          {p.phase >= 2 && <Text dimColor>{l.reviews(p.reviews)}</Text>}
        </Box>
        {p.gate !== null && (
          <Box columnGap={1}>
            <Text bold color="black" backgroundColor="red">
              {' '}
              {l.gate}{' '}
            </Text>
            <Text color="red">{l.gateText(p.gate)}</Text>
          </Box>
        )}
      </Box>
    )
  })
}
