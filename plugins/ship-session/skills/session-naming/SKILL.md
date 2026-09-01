---
name: session-naming
description: セッション名を、ユーザーの表示言語の簡潔な名前に付け直す。Claude Code の自動命名は英語の kebab-case 固定なので、一覧で見分けがつくよう主題が確定した時点で1回だけ付け直す。「セッション名を付けて」「名前を日本語にして」「rename this session」と言われたとき、および UserPromptSubmit の催促（[セッション名] / [Session name] で始まる追加コンテキスト）を受け取ったときに使う。
---

# session-naming — セッション名を表示言語で付け直す

Claude Code が自動で付けるセッション名は **英語の kebab-case 固定**（本体の命名プロンプトに
`fix-login-bug` のような英語例が埋め込まれているため、`~/.claude/CLAUDE.md` の言語指定では
変わらない）。一覧が `skill-session-naming-japanese` のような機械的な名前で並ぶと、
セッションの見分けがつかない。**これは日本語で作業しているときに限った話ではない** —
英語で作業していても、`fix-login-bug` より `Fix the login redirect` のほうが見分けがつく。

**主題が掴めた時点で、ユーザーの表示言語の名前に自分で付け直す。**

## やり方

```bash
"${CLAUDE_PLUGIN_ROOT}/hooks/rename-session.sh" "セッション名の自動リネームを仕込む"
```

- **付けるタイミング**: ユーザーの依頼を読んで主題が確定した直後、最初の実作業と同じターンで1回。
  依頼が来る前・主題が曖昧なうちは付けない（付け直しが増えるだけ）。
- **付け直し**: 会話の途中で主題が大きく変わったら、そのときもう一度実行してよい。
  細かい寄り道では変えない。
- **報告しない**: 名前を付けたことはユーザーへの報告に含めない（作業の結果ではない）。

## 名前の書き方

- 「何をしているか」が一行で分かること。リポジトリ名やブランチ名は一覧の別列に出るので入れない。
- 記号・引用符・絵文字は使わない。
- 長さの目安は文字の幅で決まる。**全角2幅・半角1幅で数えて40幅**を超える分は、スクリプト側で
  切り詰められる。

| 表示言語 | 書き方 | 長さの目安 |
|---|---|---|
| 日本語 | 体言止め | 全角10〜20文字 |
| ラテン文字の言語 | 短い名詞句。文にしない | 20〜40文字 |

| 良い | 悪い |
|---|---|
| ホーム画面のセッション選択を直す | fix-home-session-nav |
| リリース手順の署名検証を通す | 作業 |
| Fix the login redirect | fix-login-bug |
| Sign the release build | Work on some things |
| セッション名の自動リネームを仕込む | session-desk のセッション名まわりの調査と実装（長すぎ） |

## スクリプトが触るもの

`hooks/rename-session.sh` は自セッションの pid を解決して次を書き換える。

- `~/.claude/jobs/<jobId>/state.json` の `name` / `nameSource: "user"`
  （**書き換えるのはここだけ**。Session Desk などの一覧はこの値を読む）
- `~/.claude/cache/session-renamed/<pid>`（付け直し済みの印。催促 hook が再度促さないため）

`~/.claude/sessions/<pid>.json` は `jobId` を引くために **読むだけ** で、書き換えない。

pid は `CLAUDE_CODE_MESSAGING_SOCKET`（`/tmp/cc-socks/<pid>.sock`）から取り、無ければ親プロセスを
辿って `claude` を探す。

## 効かないとき

次の場合、スクリプトは終了コード1で止まり、催促 hook は何も出さない（いずれも異常ではない）。

- バックグラウンドジョブ以外のセッション（対応する `jobs/<jobId>` が無い）
- `state.json` がまだ書かれていない / 壊れている
- 既にユーザー由来の名前が付いている（`nameSource: "user"`、または付け直し済みの印がある）

表示言語は `~/.claude/settings.local.json` → `~/.claude/settings.json` の `language`、
無ければ `AppleLocale` の順に見る。**どれからも判定できないときは英語として促す**（黙らない）。
