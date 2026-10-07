/** 表示言語 */
export type Lang = 'ja' | 'en'

/** 伏せる形の種類。置き換え後の `[redacted:<種類>]` に入る */
export type SecretKind = 'github' | 'anthropic' | 'openai' | 'google' | 'aws' | 'slack' | 'stripe' | 'private-key'

declare module 'claude-code' {
  interface PluginState {
    'secret-guard': {
      /** トーストの言語。値そのものや件数は持たない */
      lang: Lang | null
    }
  }
}
