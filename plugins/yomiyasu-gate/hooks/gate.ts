// 残る日本語の文章（gh の PR / Issue の本文とコメント、git commit のメッセージ）を、
// Bash ツールが実行する前に yomiyasu_lint.py にかけ、規則に合わなければ理由を添えて差し戻す mod。
// どこかで失敗したら素通しにする（fail-open）。
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Lang } from '../types'
import type { Target } from './command'
import { findTargets, hasJapanese, stripExcluded } from './command'
import type { Policy } from './verdict'
import { LABELS, denyReason, findingsFromJson, judge, langFromSetting, ruleList } from './verdict'

const denials = atom({ plugin: 'yomiyasu-gate', key: 'denials' } as const, {} as Record<string, number>)
const hasWarned = atom({ plugin: 'yomiyasu-gate', key: 'hasWarned' } as const, false)
const lang = atom({ plugin: 'yomiyasu-gate', key: 'lang' } as const, null as Lang | null)

/** userConfig を指定しないときの yomiyasu_lint.py の探し場所（HOME からの相対） */
const DEFAULT_LINTERS = [
  '.claude/plugins/marketplaces/yomiyasu/skills/yomiyasu/scripts/yomiyasu_lint.py',
  '.claude/plugins/marketplaces/yomiyasu/scripts/yomiyasu_lint.py',
]

const LINT_TIMEOUT_MS = 10_000

const str = (v: unknown, fallback: string) => (typeof v === 'string' ? v : fallback)
const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)

/** リンターの場所を決める。userConfig のパスがあればそれだけを見る。見つからなければ null */
const findLinter = async ($: EngineInterface, configured: string): Promise<string | null> => {
  if (configured.trim() !== '') return (await $.fs.exists(configured.trim())) ? configured.trim() : null
  const home = await $.env.get('HOME')
  if (home === undefined || home === '') return null
  for (const rel of DEFAULT_LINTERS) {
    const path = `${home.replace(/\/$/, '')}/${rel}`
    if (await $.fs.exists(path)) return path
  }
  return null
}

/** 本文の取り出し元から本文を読む。読めない・確定できないときは null（素通し） */
const bodyOf = async ($: EngineInterface, target: Target): Promise<string | null> => {
  if (target.body.kind === 'text') return target.body.text
  if (target.body.kind === 'unknown') return null
  try {
    return await $.fs.read(target.body.path)
  } catch {
    return null
  }
}

/** このセッションで1回だけトーストで知らせる */
const warnOnce = async ($: EngineInterface, text: string) => {
  if (await read($, hasWarned)) return
  await update($, hasWarned, () => true)
  $.ui.toast(text, { timeoutMs: 8000 })
}

export const register: Register = (on, options) => {
  const policy: Policy = {
    minScore: num(options.minScore, 80),
    hardRules: ruleList(str(options.hardRules, 'emoji_prohibited,trailing_colon')),
    ignoreRules: ruleList(str(options.ignoreRules, 'unnatural_halfwidth_space')),
  }
  const maxDenials = Math.max(0, Math.floor(num(options.maxDenials, 2)))
  const includeSubagents = options.includeSubagents !== false
  const linterPath = str(options.linterPath, '')
  const python = str(options.python, 'python3').trim() || 'python3'

  // settings の `language` が決まっていればそれを使い、無ければプロンプトの文字で決める
  let isLangFromSettings = false

  on('session.start', async ($, e, next) => {
    const fromSettings = langFromSetting((await $.settings.read()).language)
    isLangFromSettings = fromSettings !== null
    if (fromSettings !== null) await update($, lang, () => fromSettings)
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const isUserText = e.origin.kind === 'composer' || e.origin.kind === 'bridge'
    if (isUserText && !isLangFromSettings) await update($, lang, () => (hasJapanese(e.text) ? 'ja' : 'en'))
    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (e.agentId !== undefined && !includeSubagents) return next(e)
    const targets = findTargets(e.command)
    if (targets.length === 0) return next(e)

    const bodies: { target: Target; text: string }[] = []
    for (const target of targets) {
      const raw = await bodyOf($, target)
      if (raw === null) continue
      const text = stripExcluded(target.kind, raw)
      if (hasJapanese(text)) bodies.push({ target, text })
    }
    if (bodies.length === 0) return next(e)

    const l = (await read($, lang)) ?? 'en'
    const linter = await findLinter($, linterPath)
    if (linter === null) {
      await warnOnce($, LABELS[l].linterMissing)
      return next(e)
    }

    const reasons: string[] = []
    for (const { target, text } of bodies) {
      let findings
      try {
        const ran = await $.process.run([python, linter, '--json'], { stdin: text, timeoutMs: LINT_TIMEOUT_MS })
        findings = ran.exitCode === 0 ? findingsFromJson(ran.stdout) : null
        if (findings === null) {
          const why = ran.exitCode === 0 ? 'unreadable output' : `exit ${ran.exitCode}: ${ran.stderr.trim().split('\n').pop() ?? ''}`
          await warnOnce($, LABELS[l].linterFailed(why))
          return next(e)
        }
      } catch (err) {
        await warnOnce($, LABELS[l].linterFailed(String(err)))
        return next(e)
      }

      const key = `${e.agentId ?? 'main'}:${target.kind}`
      const verdict = judge(findings, policy)
      if (verdict.kind === 'pass') {
        await update($, denials, cur => {
          const { [key]: _, ...rest } = cur
          return rest
        })
        continue
      }
      const count = (await read($, denials))[key] ?? 0
      if (maxDenials > 0 && count >= maxDenials) {
        // 続けて止めた回数が上限に達した。止め続けると作業が進まないので、今回は通して知らせる
        await update($, denials, cur => {
          const { [key]: _, ...rest } = cur
          return rest
        })
        $.ui.toast(LABELS[l].capped(target.kind, count), { timeoutMs: 8000 })
        continue
      }
      await update($, denials, cur => ({ ...cur, [key]: (cur[key] ?? 0) + 1 }))
      reasons.push(denyReason(l, target.kind, verdict, policy.minScore))
    }

    if (reasons.length > 0) return { deny: reasons.join('\n\n') }
    return next(e)
  }).catch(($, e, next) => next(e)) // fail-open: 判定の途中で失敗したらコマンドを通す
}
