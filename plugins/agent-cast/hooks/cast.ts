// 子エージェントの一覧を、観測したイベントから組み立てる純粋関数と、表示の文言。
// 描画（cast-band.tsx）から切り離して、遷移だけをテストできるようにしている。
import type { Cast, CastAgent, Lang } from '../types'

/** 終わったエージェントを、消すまでに残しておく時間 */
export const LINGER_MS = 5000

/** バンドに出す行数の上限。超えた分は「ほか N 体」の1行にまとめる */
export const MAX_ROWS = 5

/** スピナー行に並べる顔の上限。超えた分は「+N」にする */
export const MAX_FACES = 5

/** 組み込みのエージェント種別の顔。どれも半角5文字で幅を揃える */
export const FACES: Readonly<Record<string, string>> = {
  Explore: '(o.o)',
  Plan: '[-_-]',
  'general-purpose': '(^_^)',
  'claude-code-guide': '(?_?)',
  fork: '(=_=)',
  teammate: '(^o^)',
}

/** 一覧にない種別に、名前のハッシュで割り当てる顔 */
export const SPARE_FACES = ['(*_*)', '(O_O)', '(~_~)', '(@_@)', '(u_u)', '(>_<)', '(T_T)', '(;_;)']

/** 種別名から顔を決める。同じ名前なら常に同じ顔になる。 */
export const faceFor = (type: string): string => {
  const known = FACES[type]
  if (known !== undefined) return known
  let hash = 0
  for (const ch of type) hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) >>> 0
  return SPARE_FACES[hash % SPARE_FACES.length] ?? '(._.)'
}

export const initial = (): Cast => ({ agents: [], now: 0 })

export const onSpawn = (
  c: Cast,
  a: { id: string; type: string; description: string; isDetached: boolean },
  now: number,
): Cast => ({
  now,
  agents: [
    ...c.agents.filter(x => x.id !== a.id),
    { ...a, startedAt: now, endedAt: null, state: 'running', tool: null },
  ],
})

const patch = (c: Cast, id: string, fn: (a: CastAgent) => CastAgent): Cast => {
  if (!c.agents.some(a => a.id === id && a.state === 'running')) return c
  return { ...c, agents: c.agents.map(a => (a.id === id && a.state === 'running' ? fn(a) : a)) }
}

/** そのエージェントのツール呼び出しの開始（tool に名前）と終了（null）。 */
export const onTool = (c: Cast, id: string, tool: string | null): Cast => patch(c, id, a => ({ ...a, tool }))

/** そのエージェントのループが終わった。 */
export const onDone = (c: Cast, id: string, now: number): Cast => ({
  ...patch(c, id, a => ({ ...a, state: 'done', endedAt: now, tool: null })),
  now,
})

/**
 * メインのターンが終わった。フォアグラウンドの子エージェントはメインのターンの中でしか
 * 走らないので、まだ running のものは終了が届かなかった（中断された）とみなす。
 * バックグラウンドとチームメイトは走り続けるので触らない。
 */
export const onMainTurnEnd = (c: Cast, now: number): Cast => ({
  now,
  agents: c.agents.map(a =>
    a.state === 'running' && !a.isDetached ? { ...a, state: 'aborted', endedAt: now, tool: null } : a,
  ),
})

/** 時刻を進め、終わってから LINGER_MS 以上経ったエージェントを消す。 */
export const tick = (c: Cast, now: number): Cast => ({
  now,
  agents: c.agents.filter(a => a.endedAt === null || now - a.endedAt < LINGER_MS),
})

export const running = (c: Cast): CastAgent[] => c.agents.filter(a => a.state === 'running')

/** 経過秒。終わったものは終了時刻で止める。 */
export const elapsedSeconds = (a: CastAgent, now: number): number =>
  Math.max(0, Math.floor(((a.endedAt ?? now) - a.startedAt) / 1000))

/** バンドに出す行と、まとめた残りの体数。 */
export const bandRows = (c: Cast): { rows: CastAgent[]; rest: number } => ({
  rows: c.agents.slice(0, MAX_ROWS),
  rest: Math.max(0, c.agents.length - MAX_ROWS),
})

export const LABELS = {
  ja: {
    title: (n: number) => `子エージェント ${n}体`,
    thinking: '思考中',
    done: '完了',
    aborted: '中断',
    rest: (n: number) => `ほか ${n} 体`,
    working: (n: number) => `${n}体が作業中`,
  },
  en: {
    title: (n: number) => `Subagents: ${n}`,
    thinking: 'thinking',
    done: 'done',
    aborted: 'interrupted',
    rest: (n: number) => `${n} more`,
    working: (n: number) => (n === 1 ? '1 agent working' : `${n} agents working`),
  },
} as const

/** 行の「今の状態」欄の文言。 */
export const statusText = (a: CastAgent, lang: Lang): string => {
  const l = LABELS[lang]
  if (a.state === 'done') return l.done
  if (a.state === 'aborted') return l.aborted
  return a.tool ?? l.thinking
}

/** スピナー行に出す文言（走っているエージェントが0体なら null）。 */
export const spinnerText = (c: Cast, lang: Lang): string | null => {
  const now = running(c)
  if (now.length === 0) return null
  const faces = now.slice(0, MAX_FACES).map(a => faceFor(a.type))
  if (now.length > MAX_FACES) faces.push(`+${now.length - MAX_FACES}`)
  return `${faces.join(' ')} ${LABELS[lang].working(now.length)}`
}

// 表示言語の決め方は ship-session の ship-progress.ts と揃える（別プラグインなので複製している）
export const hasJapanese = (text: string): boolean => /[぀-ヿ一-鿿]/.test(text)

/** settings の `language` から表示言語を決める。決まらなければ null。 */
export const langFromSetting = (language: unknown): Lang | null => {
  if (typeof language !== 'string' || language.trim() === '') return null
  // `ja` / `ja-JP` / `日本語` / `Japanese` だけを日本語とみなす（`Javanese` は含めない）
  return /^(ja([-_].*)?|日本語?|japanese)$/i.test(language.trim()) ? 'ja' : 'en'
}
