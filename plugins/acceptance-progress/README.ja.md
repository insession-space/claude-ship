[English](README.md) | 日本語

# acceptance-progress

作業中の GitHub Issue にある受け入れ条件とチェックリストの進捗を、入力欄の上に出す Claude Code の mod です。何個の条件が済んで何が残っているかを、Issue のページを開かずに確認できます。

## 入れる

```bash
claude plugin marketplace add insession-space/claude-ship
claude plugin install acceptance-progress@claude-ship
```

Claude Code を再起動すると読み込まれます。mod は `hooks/hooks.json` の `modules` に書いたフックモジュール（`hooks/acceptance.tsx`）です。mods に対応していない Claude Code はこのモジュールを読まないので、何も起きません。本文の取得に `gh` を使うので、`gh auth login` を済ませておいてください。

## 何が出るか

エージェントがチェックリストを持つ Issue を `gh` で触ると、入力欄の上にバンドを出します。

```
╭──────────────────────────────────────────────────────────────────────╮
│ #33 進捗を画面に出す mod を作る          受け入れ条件 ████░░░░ 2/6 │
│ ○ claude plugin test が緑                                           │
│ ○ README に載っている                                               │
│ ○ 既存のテストが緑のまま                                            │
│ ほか 1 件                                                           │
│ 未決事項 0/2                                                        │
╰──────────────────────────────────────────────────────────────────────╯
```

- 1行目は Issue 番号とタイトル、受け入れ条件の進捗バーと件数です。タイトルが長いときは末尾を省略します
- 続けて、まだ済んでいない受け入れ条件を3件まで出します。残りは「ほか N 件」にまとめます
- 全部済んだら、未完了の一覧の代わりに「すべて完了」を出します
- 受け入れ条件以外の見出しのチェックリスト（`## 未決事項` など）は、最後の行に見出しと件数だけを出します
- ship-session の進捗バンドや agent-cast など、他の mod も入力欄の上にバンドを出している場合は、縦に並べて出します

### 受け入れ条件の見分け方

見出しが `受け入れ条件` / `受入条件` / `完了条件` / `Acceptance criteria` / `Definition of done` のチェックリストを受け入れ条件として数えます。その見出しの下の小見出し（`### 機能` など）のチェックリストも受け入れ条件に入ります。どの見出しにも当たらない Issue では、本文のチェックリスト全部を数えます。行頭の `- [ ]` / `* [ ]` / `1. [ ]` と、印の付いた `[x]` / `[X]` を項目とし、コードフェンスと HTML コメントの中は数えません。

## いつ読み直すか

メインのエージェントが次のコマンドに成功したとき、その Issue の本文を `gh issue view --json` で GitHub から読み直します。

- `gh issue view <N>` / `gh issue edit <N>` / `gh issue comment <N>`（`-R owner/repo` や Issue の URL も読みます）
- `gh issue create`（出力の URL の Issue）

表示するのは最後に触れた1件です。ship-session の issue-loop は、検証できた受け入れ条件から本文のチェックボックスに印を付けるので、そのたびに件数が進みます。

次のときは読み直しも表示の切り替えもしません。

- サブエージェントが実行した `gh` のコマンド全般（委譲先が関連 Issue を読むたびに表示が変わらないように）。サブエージェントがチェックを付けた分は `/acceptance` で反映します
- 番号を書いていない `gh issue view`（ブランチから推定する形）
- `-R` も URL も無く、`gh` より前で `cd` したり `GH_REPO` を渡したりしたコマンド（どのリポジトリの番号か分からないため）
- 2行目以降に書かれた `gh`（heredoc の本文など）と、`owner/repo` の形でない `-R`

定期的な読み直しはしません。人が GitHub で直接チェックを付けた分は、次に Issue を触ったときか `/acceptance` で反映します。

## コマンド

| コマンド | 動き |
| --- | --- |
| `/acceptance` | 表示中の Issue を読み直す |
| `/acceptance 42` / `/acceptance owner/repo#42` / `/acceptance <Issue の URL>` | その Issue を表示する |
| `/acceptance off` | バンドを隠す |
| `/acceptance on` | 隠したバンドを戻す |

## 失敗したとき

- `gh` が無い、未認証、ネットワークの失敗で読めなかったとき: 前回の表示を残し、バンドに「読み直しに失敗」を出します。別の Issue へ切り替えようとして失敗したときも同じで、残った表示が最新でないことを示します
- Issue が無い、見る権限が無いとき: バンドを消します
- チェックリストが無い Issue のとき: 何も出しません

本文の文字列は表示するだけで、コマンドや設定として解釈しません。

## 表示の言語

Claude Code の `language` 設定、直近のあなたの発話の言語、英語の順に決めます。

## 出さないもの

- Notion ページなど GitHub Issue 以外のチケット
- PR 本文のチェックリスト
- 複数の Issue の同時表示

## テスト

```bash
claude plugin validate plugins/acceptance-progress
claude plugin test plugins/acceptance-progress
```
