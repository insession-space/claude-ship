// ship-session の進捗を、観測したイベントから組み立てる純粋関数。
// 描画（ship-band.tsx）から切り離して、遷移だけをテストできるようにしている。
import type { Lang, ShipProgress } from '../types'

/** ship-gate.py の GOAL_HEADERS と揃える（到達点を聞く質問の header） */
export const GOAL_HEADERS = ['Goal', 'Approach', '到達点', '進め方']

/** Phase 3 で次の一手を聞く質問の header。SKILL.md の `Next step` と、その日本語訳 */
export const NEXT_HEADERS = ['Next step', '次の一手', '次のステップ', '次の手順']

/** ship-gate.py の block_message() の先頭。これを含むエラーをゲートのブロックとみなす */
export const GATE_MARKER = '[ship-gate]'

export const initial = (): ShipProgress => ({
  goal: null,
  phase: 0,
  issue: null,
  pr: null,
  reviews: 0,
  gate: null,
})

/** `plugin:skill` の skill 側。 */
export const skillName = (skill: string): string => skill.split(':').pop() ?? skill

/**
 * スキルの展開を受けて進める。ship-session 本体は状態を作り直し、
 * 委譲先のスキルはフェーズを進める。ship-session の外で呼ばれた委譲先は無視する。
 */
export const onSkill = (p: ShipProgress | null, skill: string): ShipProgress | null => {
  const name = skillName(skill)
  if (name === 'ship-session') return initial()
  if (p === null) return null
  if (name === 'create-issue') return { ...p, phase: Math.max(p.phase, 1) as ShipProgress['phase'] }
  if (name === 'issue-loop') return { ...p, phase: Math.max(p.phase, 2) as ShipProgress['phase'] }
  if (name === 'code-review' && p.phase === 2) return { ...p, reviews: p.reviews + 1 }
  return p
}

/** `/ship-session:ship-session 依頼` のようなスラッシュコマンドのスキル名。コマンドでなければ null。 */
export const slashSkill = (text: string): string | null => /^\/([\w-]+(?::[\w-]+)?)(?:\s|$)/.exec(text.trim())?.[1] ?? null

/** ship-goal.sh record の出力（`Recorded the goal: <goal>`）から到達点を取る。 */
export const goalFromRecord = (text: string): string | null => {
  const goal = /Recorded the goal: (.+)/.exec(text)?.[1]?.trim()
  return goal ? goal : null
}

/**
 * AskUserQuestion の回答から、到達点の質問への答えを取る。回答は質問文と header の
 * どちらをキーにしても来るので、ship-gate.py と同じく両方を引く。
 */
export const goalFromAnswers = (
  questions: readonly { question: string; header: string }[],
  answers: unknown,
): string | null => {
  if (answers === null || typeof answers !== 'object') return null
  const map = answers as Record<string, unknown>
  for (const q of questions) {
    if (!GOAL_HEADERS.includes(q.header)) continue
    for (const key of [q.question, q.header]) {
      const a = map[key]
      if (typeof a === 'string' && a.trim() !== '') return a.trim()
    }
  }
  return null
}

/** `gh issue create` / `gh pr create` の出力の URL から番号を取る。取れなければ null。 */
export const numberFromUrl = (text: string, kind: 'issues' | 'pull'): number | null => {
  const n = new RegExp(`https://github\\.com/[^\\s/]+/[^\\s/]+/${kind}/(\\d+)`).exec(text)?.[1]
  return n === undefined ? null : Number(n)
}

export const isIssueCreate = (command: string): boolean => /\bgh\s+issue\s+create\b/.test(command)
export const isPrCreate = (command: string): boolean => /\bgh\s+pr\s+create\b/.test(command)
export const isGoalRecord = (command: string): boolean => /ship-goal\.sh["']?\s+record\b/.test(command)

/** 文字列に日本語（かな・漢字）が入っているか。 */
export const hasJapanese = (text: string): boolean => /[぀-ヿ一-鿿]/.test(text)

/** settings の `language` から表示言語を決める。決まらなければ null。 */
export const langFromSetting = (language: unknown): Lang | null => {
  if (typeof language !== 'string' || language.trim() === '') return null
  // `ja` / `ja-JP` / `日本語` / `Japanese` だけを日本語とみなす（`Javanese` は含めない）
  return /^(ja([-_].*)?|日本語?|japanese)$/i.test(language.trim()) ? 'ja' : 'en'
}

export const LABELS = {
  ja: {
    title: 'ship-session',
    goal: '到達点',
    steps: ['到達点', 'Issue', '実装ループ', '次の一手'],
    reviews: (n: number) => `レビュー ${n} 回`,
    none: 'まだ',
    gate: 'ゲート',
    gateText: (tool: string) => `到達点が決まっていないので ${tool} を止めました`,
    toast: (tool: string) => `ship-session: 到達点が決まっていないので ${tool} を止めました`,
  },
  en: {
    title: 'ship-session',
    goal: 'Goal',
    steps: ['Goal', 'Issue', 'Implementation loop', 'Next step'],
    reviews: (n: number) => (n === 1 ? '1 review' : `${n} reviews`),
    none: 'not yet',
    gate: 'Gate',
    gateText: (tool: string) => `Stopped ${tool} because the goal is not decided yet`,
    toast: (tool: string) => `ship-session: stopped ${tool} because the goal is not decided yet`,
  },
} as const

/** 今いるステップの番号（0 到達点 / 1 Issue / 2 実装ループ / 3 次の一手）。 */
export const currentStep = (p: ShipProgress): number => (p.goal === null ? 0 : Math.max(p.phase, 1))
