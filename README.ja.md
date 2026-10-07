[English](README.md) | 日本語

# claude-ship

Claude Code 用プラグインのマーケットプレイスです。複数のプラグインを1つのリポジトリで管理しています。

プラグインは、質問・報告・Artifact をユーザーの言語（Claude Code の `language` 設定、無ければ直近の発話の言語）で書きます。

## 入れる

```bash
claude plugin marketplace add insession-space/claude-ship
claude plugin install ship-session@claude-ship
```

Claude Code を再起動すると使えます。

## 含まれるプラグイン

| プラグイン | 何をするか | ドキュメント |
| --- | --- | --- |
| `ship-session` | 要望を GitHub Issue にして、受け入れ条件が全て埋まり・検証が緑・レビュー指摘0件になるまで同じセッションで実装しきる | [plugins/ship-session](plugins/ship-session/README.ja.md) |
| `ship-session-jev` | `ship-session` のアドオン。Jev（TypeSafe AI）に依頼文から到達点を判定させ、確信が高ければ Phase 0 の質問を省く。任意・フェイルオープンで、`TYPESAFE_API_KEY` が無ければ `ship-session` と同じに動く。`ship-session` が前提 | [plugins/ship-session-jev](plugins/ship-session-jev/README.ja.md) |
| `graph-workflow` | タスクをノード/エッジのグラフに分解し、Workflow ツールで決定的に並列実行する（設計→承認→実行→resume） | [plugins/graph-workflow](plugins/graph-workflow/README.ja.md) |
| `artifact-templates` | Artifact のデザインを用途で選ぶ（企画→LP、レビュー→テクニカルレポート、調査→レポートかダッシュボード、出荷→実装完了報告）。既定ダークの共通土台と AI 臭さの禁止リスト付き | [plugins/artifact-templates](plugins/artifact-templates/README.ja.md) |
| `agent-cast` | 子エージェント（サブエージェントとチームメイト）が走っている間、入力欄の上のバンドに1体1行でキャラクター・種別・説明・今のツール・経過秒を出し、スピナー行の先頭に顔を並べる mod。顔はエージェント種別ごとに決まっている | [plugins/agent-cast](plugins/agent-cast/README.ja.md) |
| `acceptance-progress` | エージェントが gh で触った GitHub Issue の本文からチェックリストを読み直し、受け入れ条件の済んだ数と残りの項目を入力欄の上のバンドに出す mod | [plugins/acceptance-progress](plugins/acceptance-progress/README.ja.md) |
| `secret-guard` | シークレットの形をした文字列（既知の接頭辞を持つ API キーと PEM 秘密鍵）を、入力は送信前に、モデルの返答は保存前に `[redacted:<種類>]` へ置き換える mod。貼ってしまったキーにはローテーションを勧めるトーストを出す | [plugins/secret-guard](plugins/secret-guard/README.ja.md) |
| `yomiyasu-gate` | エージェントが PR・Issue の本文やコミットメッセージに書いた日本語を、Bash ツールが実行する前に yomiyasu のリンターで検査し、規則に合わなければ違反の行を添えて差し戻す mod。リンターが無ければ何もせずに通す | [plugins/yomiyasu-gate](plugins/yomiyasu-gate/README.ja.md) |
| `session-dashboard` | 要対応の項目、ship-session と受け入れ条件の進捗、現在のブランチの PR（CI とレビュー）、このセッションで起動したサーバーとコンテナを1つのペインにまとめて出し、`pkill -f` などの一括停止を止める mod | [plugins/session-dashboard](plugins/session-dashboard/README.ja.md) |

## リポジトリ構成

```
.claude-plugin/marketplace.json   マーケットプレイスの定義（プラグイン一覧）
plugins/<name>/                   各プラグイン本体
  .claude-plugin/plugin.json      プラグインの manifest
  SKILL.md / skills/ / hooks/     スキルと hook
  tests/                          テスト
```

プラグインを追加するときは `plugins/<name>/` を作り、`marketplace.json` の `plugins` 配列にエントリを足します。バージョンは各プラグインの `plugin.json` で独立に管理します。

## ライセンス

MIT
