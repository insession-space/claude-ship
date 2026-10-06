// yomiyasu_lint.py の JSON 出力を読み、差し戻すかどうかと差し戻しの理由を決める。

import type { Lang } from '../types'

/** yomiyasu_lint.py の指摘1件（`--json` の findings の要素） */
export type Finding = { rule: string; line: number; severity: string; message: string; snippet: string }

export type Verdict =
  | { kind: 'pass'; score: number }
  | { kind: 'deny'; score: number; findings: Finding[]; hardRules: string[] }

export type Policy = {
  /** これを下回ったら差し戻すスコア（0〜100） */
  minScore: number
  /** 1件でもあれば差し戻す規則 */
  hardRules: readonly string[]
  /** 数えない規則 */
  ignoreRules: readonly string[]
}

/** yomiyasu_lint.py の `--json` の出力から指摘を読む。形が違えば null */
export const findingsFromJson = (stdout: string): Finding[] | null => {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const raw = (parsed as { findings?: unknown }).findings
  if (!Array.isArray(raw)) return null
  return raw.flatMap((f): Finding[] => {
    if (typeof f !== 'object' || f === null) return []
    const o = f as Record<string, unknown>
    if (typeof o.rule !== 'string') return []
    return [
      {
        rule: o.rule,
        line: typeof o.line === 'number' ? o.line : 0,
        severity: typeof o.severity === 'string' ? o.severity : 'warn',
        message: typeof o.message === 'string' ? o.message : '',
        snippet: typeof o.snippet === 'string' ? o.snippet : '',
      },
    ]
  })
}

/** yomiyasu_lint.py と同じ減点（warn / error は 5 点、それ以外は 2 点）でスコアを出す */
export const scoreOf = (findings: readonly Finding[]): number =>
  Math.max(0, 100 - findings.reduce((sum, f) => sum + (f.severity === 'warn' || f.severity === 'error' ? 5 : 2), 0))

/** 無視する規則を除いてスコアを計算し直し、差し戻すかを決める */
export const judge = (findings: readonly Finding[], policy: Policy): Verdict => {
  const counted = findings.filter(f => !policy.ignoreRules.includes(f.rule))
  const score = scoreOf(counted)
  const hard = [...new Set(counted.filter(f => policy.hardRules.includes(f.rule)).map(f => f.rule))]
  if (hard.length === 0 && score >= policy.minScore) return { kind: 'pass', score }
  return { kind: 'deny', score, findings: counted, hardRules: hard }
}

/** カンマ区切りの規則名の並び */
export const ruleList = (value: unknown): string[] =>
  typeof value === 'string'
    ? value
        .split(',')
        .map(s => s.trim())
        .filter(s => s !== '')
    : []

const RULE_NAMES: Record<Lang, Record<string, string>> = {
  ja: {
    emoji_prohibited: '絵文字',
    trailing_colon: '文末コロン',
    unnatural_halfwidth_space: '和欧文間の半角空白',
    slop_vocabulary: 'AI頻出語彙',
    metaphor_verb: '比喩動詞',
    meta_filler: '前置き・定型句',
    negative_parallelism: '否定対比',
    sentence_end_repetition: '同じ文末の連続',
    excess_bold: '太字が多い',
    excess_list: '箇条書きが多い',
    redundant_bracket: '言い換えだけのカッコ',
  },
  en: {
    emoji_prohibited: 'emoji',
    trailing_colon: 'trailing colon',
    unnatural_halfwidth_space: 'space between Japanese and Latin text',
    slop_vocabulary: 'AI-typical vocabulary',
    metaphor_verb: 'metaphorical verb',
    meta_filler: 'filler opening or closing',
    negative_parallelism: '"not A but B" construction',
    sentence_end_repetition: 'repeated sentence ending',
    excess_bold: 'too much bold',
    excess_list: 'too many bullet lines',
    redundant_bracket: 'redundant parenthetical',
  },
}

/** 差し戻しの理由に並べる指摘の上限 */
const MAX_LISTED = 8

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s)

/** エージェントが読んで直せるように、違反の行・種類・該当行を並べた差し戻しの理由 */
export const denyReason = (lang: Lang, kind: string, verdict: Extract<Verdict, { kind: 'deny' }>, minScore: number): string => {
  const names = RULE_NAMES[lang]
  // 1件で差し戻す規則を先に並べる
  const sorted = [...verdict.findings].sort(
    (a, b) => Number(verdict.hardRules.includes(b.rule)) - Number(verdict.hardRules.includes(a.rule)) || a.line - b.line,
  )
  const rows = sorted.slice(0, MAX_LISTED).map(f => {
    const name = names[f.rule] ?? f.rule
    const where = f.line > 0 ? `L${f.line} ` : ''
    return `- ${where}${name}: ${clip(f.snippet.trim(), 80)}`
  })
  const rest = sorted.length - rows.length
  if (lang === 'ja') {
    const why =
      verdict.hardRules.length > 0
        ? `${verdict.hardRules.map(r => names[r] ?? r).join('・')}があるため`
        : `スコアが ${verdict.score} でしきい値 ${minScore} を下回ったため`
    return [
      `yomiyasu-gate: \`${kind}\` の本文が yomiyasu の規則に合わず、${why}実行を止めました（スコア ${verdict.score}）。`,
      '次の箇所を書き直してから、同じコマンドを再実行してください。',
      ...rows,
      ...(rest > 0 ? [`- ほか ${rest} 件`] : []),
    ].join('\n')
  }
  const why =
    verdict.hardRules.length > 0
      ? `it contains: ${verdict.hardRules.map(r => names[r] ?? r).join(', ')}`
      : `its score ${verdict.score} is below the threshold ${minScore}`
  return [
    `yomiyasu-gate: stopped \`${kind}\` because its Japanese text does not follow the yomiyasu rules; ${why} (score ${verdict.score}).`,
    'Rewrite the lines below, then run the same command again.',
    ...rows,
    ...(rest > 0 ? [`- and ${rest} more`] : []),
  ].join('\n')
}

/** settings の `language` から表示言語を決める。決まらなければ null（acceptance-progress と同じ規則） */
export const langFromSetting = (language: unknown): Lang | null => {
  if (typeof language !== 'string' || language.trim() === '') return null
  return /^(ja([-_].*)?|日本語?|japanese)$/i.test(language.trim()) ? 'ja' : 'en'
}

export const LABELS = {
  ja: {
    linterMissing: 'yomiyasu-gate: yomiyasu_lint.py が見つからないため、本文を検査せずに通しています',
    linterFailed: (why: string) => `yomiyasu-gate: yomiyasu_lint.py の実行に失敗したため、本文を検査せずに通しています（${why}）`,
    capped: (kind: string, n: number) => `yomiyasu-gate: \`${kind}\` を続けて ${n} 回差し戻したため、今回は検査結果に関わらず通しました`,
  },
  en: {
    linterMissing: 'yomiyasu-gate: yomiyasu_lint.py was not found, so text is passed through unchecked',
    linterFailed: (why: string) => `yomiyasu-gate: running yomiyasu_lint.py failed, so text is passed through unchecked (${why})`,
    capped: (kind: string, n: number) => `yomiyasu-gate: \`${kind}\` was stopped ${n} times in a row, so this run was let through regardless`,
  },
} as const
