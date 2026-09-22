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
