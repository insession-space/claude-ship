/** 表示言語 */
export type Lang = 'ja' | 'en'

declare module 'claude-code' {
  interface PluginState {
    'yomiyasu-gate': {
      /** `<エージェント>:<コマンドの種類>` ごとの、続けて差し戻した回数。通したら消す */
      denials: Record<string, number>
      /** リンターが無い・失敗したことを、このセッションでトーストで知らせたか */
      hasWarned: boolean
      lang: Lang | null
    }
  }
}
