// シークレットの形をした文字列を見つけて `[redacted:<種類>]` に置き換える純粋関数と、トーストの文言。
// 誤検知を抑えるため、既知の接頭辞を持つ形だけを探す。汎用の高エントロピー文字列は探さない。
import type { Lang, SecretKind } from '../types'

type Rule = {
  kind: SecretKind
  /** g フラグ付き。String.prototype.replace が lastIndex を戻すので使い回してよい */
  pattern: RegExp
  /** 形は合っていても値らしくないもの（説明用の例など）を外すときの追加の判定 */
  accept?: (match: string) => boolean
}

/** 前後が英数字につながっていないこと（`disk-...` の中の `sk-` などを拾わない） */
const L = '(?<![A-Za-z0-9_])'
const R = '(?![A-Za-z0-9_])'

const hasBase64Run = (s: string): boolean => /[A-Za-z0-9+/]{16,}/.test(s)

// 並び順に意味がある。PEM ブロックを最初に伏せ、`sk-ant-` / `sk-proj-` を長い `sk-` より先に伏せる
const RULES: readonly Rule[] = [
  {
    kind: 'private-key',
    pattern: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----/g,
    accept: hasBase64Run,
  },
  {
    // END が無いブロック（貼り付けの途中で切れたもの）。ヘッダ行のあとに base64 の行が続く範囲を伏せる
    kind: 'private-key',
    pattern:
      /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----(?:\r?\n[A-Za-z-]+: [^\r\n]*|\r?\n[ \t]*)*(?:\r?\n[ \t]*[A-Za-z0-9+/=]{16,}[ \t]*)+/g,
  },
  { kind: 'anthropic', pattern: new RegExp(`${L}sk-ant-[A-Za-z0-9_-]{32,}`, 'g') },
  { kind: 'openai', pattern: new RegExp(`${L}sk-proj-[A-Za-z0-9_-]{32,}`, 'g') },
  { kind: 'github', pattern: new RegExp(`${L}gh[pousr]_[A-Za-z0-9]{36,251}${R}`, 'g') },
  { kind: 'github', pattern: new RegExp(`${L}github_pat_[A-Za-z0-9_]{70,}`, 'g') },
  { kind: 'stripe', pattern: new RegExp(`${L}[sr]k_live_[A-Za-z0-9]{16,}${R}`, 'g') },
  { kind: 'google', pattern: new RegExp(`${L}AIza[0-9A-Za-z_-]{35}(?![0-9A-Za-z_-])`, 'g') },
  { kind: 'aws', pattern: new RegExp(`${L}(?:AKIA|ASIA)[A-Z0-9]{16}${R}`, 'g') },
  { kind: 'slack', pattern: new RegExp(`${L}xox[abprs]-[0-9]+-[A-Za-z0-9-]{8,}`, 'g') },
  {
    // 旧形式の `sk-` と英数字48文字など。ケバブケースの長い識別子を拾わないよう、
    // 大文字・小文字・数字がそろっているものだけを伏せる
    kind: 'openai',
    pattern: new RegExp(`${L}sk-[A-Za-z0-9_-]{32,}`, 'g'),
    accept: m => /[A-Z]/.test(m) && /[a-z]/.test(m.slice(3)) && /[0-9]/.test(m),
  },
]

export type Redaction = {
  text: string
  /** 伏せた件数の合計 */
  count: number
  /** 伏せた種類（初出順、重複なし） */
  kinds: SecretKind[]
}

export const placeholder = (kind: SecretKind): string => `[redacted:${kind}]`

/** 文字列の中のシークレットの形を伏せる。見つからなければ同じ文字列と count 0 を返す。 */
export const redact = (input: string): Redaction => {
  let count = 0
  const kinds: SecretKind[] = []
  let text = input
  for (const rule of RULES) {
    text = text.replace(rule.pattern, match => {
      if (rule.accept !== undefined && !rule.accept(match)) return match
      count++
      if (!kinds.includes(rule.kind)) kinds.push(rule.kind)
      return placeholder(rule.kind)
    })
  }
  return { text, count, kinds }
}

/** ひらがな・カタカナ・漢字を含むか（acceptance-progress と同じ判定）。 */
export const hasJapanese = (text: string): boolean => /[぀-ヿ一-鿿]/.test(text)

/** settings の `language` から表示言語を決める。決まらなければ null。 */
export const langFromSetting = (language: unknown): Lang | null => {
  if (typeof language !== 'string' || language.trim() === '') return null
  return /^(ja([-_].*)?|日本語?|japanese)$/i.test(language.trim()) ? 'ja' : 'en'
}

export const LABELS = {
  ja: {
    redacted: (count: number, kinds: readonly SecretKind[]) =>
      `secret-guard: シークレットの形をした文字列を ${count} 件伏せてから送りました（${kinds.join(', ')}）。値のローテーションを検討してください。`,
    failed: 'secret-guard: 入力の検査に失敗したので、送信を止めました。もう一度送ってください。',
  },
  en: {
    redacted: (count: number, kinds: readonly SecretKind[]) =>
      `secret-guard: redacted ${count} secret-shaped string${count === 1 ? '' : 's'} before sending (${kinds.join(', ')}). Consider rotating ${count === 1 ? 'it' : 'them'}.`,
    failed: 'secret-guard: could not check the prompt, so it was not sent. Please send it again.',
  },
} as const
