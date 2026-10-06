/** チェックリストの1項目（`- [ ]` / `- [x]` の1行）。 */
export type ChecklistItem = {
  /** マークダウンの記号を落とした項目の文 */
  text: string
  isDone: boolean
}

/** 見出し1つ分のチェックリスト。 */
export type ChecklistGroup = {
  /** 直前の `##`〜`####` 見出し。見出しより前の項目は null */
  heading: string | null
  /** 受け入れ条件の見出し（`受け入れ条件` / `Acceptance criteria` など）か */
  isAcceptance: boolean
  items: ChecklistItem[]
}

/** 表示中の Issue。GitHub の本文から読んだもの。 */
export type TrackedIssue = {
  /** `owner/name`。コマンドにも URL にも無ければ null（セッションのカレントのリポジトリ） */
  repo: string | null
  number: number
  title: string
  url: string
  /** 受け入れ条件のグループが先頭に来る */
  groups: ChecklistGroup[]
  /** 最後に読み直しに失敗したときの理由。成功したら null に戻す */
  error: string | null
}

/** 表示言語 */
export type Lang = 'ja' | 'en'

declare module 'claude-code' {
  interface PluginState {
    'acceptance-progress': {
      /** 表示中の Issue。チェックリストを持たない Issue と、まだ何も読んでいないときは null */
      issue: TrackedIssue | null
      /** `/acceptance off` で隠したか */
      isHidden: boolean
      lang: Lang | null
    }
  }
}
