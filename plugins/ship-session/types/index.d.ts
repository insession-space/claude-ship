/** ship-session の進捗。ship-session を起動していないセッションでは持たない（null）。 */
export type ShipProgress = {
  /** 合意した到達点。ユーザーの言語のまま持つ。未確定なら null */
  goal: string | null
  /** 0 到達点 / 1 Issue 作成 / 2 実装ループ / 3 次の一手 */
  phase: 0 | 1 | 2 | 3
  issue: number | null
  pr: number | null
  /** 実装ループ中に code-review を呼んだ回数 */
  reviews: number
  /** ゲートが最後に止めたツール名。到達点が決まったら null に戻す */
  gate: string | null
}

/** バンドの表示言語 */
export type Lang = 'ja' | 'en'

declare module 'claude-code' {
  interface PluginState {
    'ship-session': { progress: ShipProgress | null; lang: Lang | null }
  }
}
