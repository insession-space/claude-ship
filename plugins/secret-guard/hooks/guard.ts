// シークレットの形をした文字列を、会話に記録される前に `[redacted:<種類>]` へ置き換える mod。
// ユーザーの入力は prompt.submit で、モデルの返答は session.append（door `response`）で伏せる。
import { atom, read, update } from 'claude-code'
import type { ApiContentBlock, Register, SessionAppendInput } from 'claude-code'

import type { Lang } from '../types'
import { LABELS, hasJapanese, langFromSetting, redact } from './patterns'

const lang = atom({ plugin: 'secret-guard', key: 'lang' } as const, null as Lang | null)

/** 伏せる処理そのものが失敗したときに、返答の text ブロックの代わりに置く文字列 */
const FAILED_PLACEHOLDER = '[redacted:secret-guard-error]'

/** 返答の行の text ブロックを伏せる。何も伏せなかったら null を返す。 */
const redactRow = (e: SessionAppendInput): SessionAppendInput | null => {
  let isChanged = false
  const content = e.message.content.map((block): ApiContentBlock => {
    if (block.type !== 'text' || typeof block.text !== 'string') return block
    const r = redact(block.text)
    if (r.count === 0) return block
    isChanged = true
    return { ...block, text: r.text }
  })
  return isChanged ? { ...e, message: { ...e.message, content } } : null
}

export const register: Register = on => {
  // settings の `language` が決まっていればそれを使い、無ければプロンプトの文字で決める
  let isLangFromSettings = false

  on('session.start', async ($, e, next) => {
    const fromSettings = langFromSetting((await $.settings.read()).language)
    isLangFromSettings = fromSettings !== null
    if (fromSettings !== null) await update($, lang, () => fromSettings)

    return next(e)
  })

  // ユーザーの入力。送る前に伏せ、件数と種類だけをトーストで伝える（値そのものは出さない）
  on('prompt.submit', async ($, e, next) => {
    // ユーザーが打った文だけで言語を決める（タスク通知などエンジン由来の文は英語で来る）
    const isUserText = e.origin.kind === 'composer' || e.origin.kind === 'bridge'
    if (isUserText && !isLangFromSettings) await update($, lang, () => (hasJapanese(e.text) ? 'ja' : 'en'))

    const r = redact(e.text)
    if (r.count === 0) return next(e)
    const l = LABELS[(await read($, lang)) ?? 'en']
    $.ui.toast(l.redacted(r.count, r.kinds), { timeoutMs: 10_000 })

    return next({ ...e, text: r.text })
  }).catch(async ($, e, next) => {
    if (next.called) return next(e)
    // 伏せられたか分からない入力は通さない
    const saved = await read($, lang).catch(() => null)
    return { drop: LABELS[saved ?? 'en'].failed }
  })

  // モデルの返答。保存とモデルへの送り直しの前に text ブロックを伏せる。
  // ツール結果（door `tool-result`）は伏せない。理由は README の「伏せないもの」に書いた
  on('session.append', { door: 'response' }, async ($, e, next) => next(redactRow(e) ?? e)).catch(($, e, next) => {
    if (next.called) return next(e)
    // 伏せられたか分からない text ブロックは残さない
    const content = e.message.content.map(b => (b.type === 'text' ? { ...b, text: FAILED_PLACEHOLDER } : b))
    return next({ ...e, message: { ...e.message, content } })
  })
}
