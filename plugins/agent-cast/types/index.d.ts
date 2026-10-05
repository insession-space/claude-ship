/** 走っている（または終わって間もない）子エージェント1体。 */
export type CastAgent = {
  /** `agent.spawn` の結果の agentId。そのループの `tool.call` と `turn.complete` が同じ値を持つ */
  id: string
  /** `Explore` や `general-purpose` などのエージェント種別。顔はこれで決まる */
  type: string
  /** Agent ツールの description（数語の説明） */
  description: string
  /** バックグラウンドで走るか、チームメイトか。メインのターンが終わっても止まらない */
  isDetached: boolean
  /** 開始時刻（`$.clock.now()` のミリ秒） */
  startedAt: number
  /** 終了時刻。走っている間は null */
  endedAt: number | null
  state: 'running' | 'done' | 'aborted'
  /** 今実行しているツール名。ツールを使っていなければ null */
  tool: string | null
}

/** 表示言語 */
export type Lang = 'ja' | 'en'

/** mod の状態。`now` は経過秒の表示に使う時刻で、走っている間は1秒ごとに進める */
export type Cast = { agents: CastAgent[]; now: number }

declare module 'claude-code' {
  interface PluginState {
    'agent-cast': { cast: Cast; lang: Lang | null }
  }
}
