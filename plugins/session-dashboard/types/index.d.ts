/** 現在のブランチの PR。`gh pr view --json` から読んだもの。 */
export type DashboardPr = {
  /** `owner/name`。PR の URL から取る */
  repo: string
  number: number
  title: string
  state: 'OPEN' | 'MERGED' | 'CLOSED'
  isDraft: boolean
  /** CI のチェックの数（成功・中立・スキップは passed に数える） */
  passed: number
  failed: number
  pending: number
  /** 失敗したチェックの名前 */
  failedNames: string[]
  /** `APPROVED` / `CHANGES_REQUESTED` / `REVIEW_REQUIRED`。判定が無ければ null */
  decision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null
  /** 未解決のレビュースレッドの数。読めなかったときは null */
  unresolved: number | null
}

/** PR 区画の状態。 */
export type DashboardPrView =
  /** まだ読んでいない */
  | { kind: 'unknown' }
  /** 現在のブランチに PR が無い（git のリポジトリでない場合も含む） */
  | { kind: 'none' }
  /** 読めなかった。前に読めた PR があれば `last` に残す */
  | { kind: 'error'; last: DashboardPr | null }
  | { kind: 'pr'; pr: DashboardPr }

/** このセッションで増えた待ち受けポートか docker コンテナ。 */
export type DashboardEntry = {
  /** `port:<番号>` か `docker:<コンテナ ID>` */
  key: string
  kind: 'port' | 'docker'
  /** ポートなら `:5173`、コンテナならコンテナ名 */
  label: string
  /** ポートならプロセス名、コンテナならイメージ名 */
  detail: string
  /** 初めて見た時刻（ミリ秒） */
  since: number
}

/** セッション開始時点に既にあったもの。取得に失敗した種類は null（次に読めたときを基準にする） */
export type DashboardBaseline = { ports: string[] | null; containers: string[] | null }

/** 表示言語 */
export type DashboardLang = 'ja' | 'en'

declare module 'claude-code' {
  interface PluginState {
    'session-dashboard': {
      pr: DashboardPrView
      /** ユーザーがレビュアーに指定されている open の PR の件数。読めなければ null */
      reviewRequests: number | null
      baseline: DashboardBaseline | null
      ledger: DashboardEntry[]
      /** 最後にトーストで知らせた台帳のキー */
      notified: string[]
      lang: DashboardLang | null
    }
  }
}
