[English](README.md) | 日本語

# ship-session-jev

[`ship-session`](../ship-session/README.ja.md) のアドオンです。TypeSafe AI の System One モデル **Jev** に、依頼文から到達点（Issue のみ / 実装のみ / PR まで / merge まで）を判定させます。Jev の確信が高ければ **Phase 0 の質問を省き**、そうでなければ ── Jev がそもそも使えない場合も含めて ── `ship-session` とまったく同じに動きます。

- **完全に任意。** `TYPESAFE_API_KEY` が無ければ hook はリクエストを出しません
- **フェイルオープン。** ネットワーク失敗・タイムアウト・4xx/5xx・本文不正のどれでも、従来の質問に倒れます。作業を止めることはありません
- **到達点だけ。** Jev が判定するのは意図の分類だけです。検証の緑判定（exit code）・受け入れ条件・レビューには関与しません

## 入れる

`ship-session-jev` は Issue 作成・実装ループ・レビューを `ship-session` プラグインのスキルに委譲するので、**両方入れます**。

```bash
claude plugin marketplace add insession-space/claude-ship
claude plugin install ship-session@claude-ship
claude plugin install ship-session-jev@claude-ship
```

TypeSafe の API キーは、Claude Code の hook から見える場所に置きます。Claude Code を起動するシェルの環境変数か、`~/.claude/settings.json` の `env` ブロックのどちらかです。Claude Code を再起動すると使えます。

## 使い方

```
/ship-session-jev:ship-session-jev 設定にダークモードの切替を足して。PR まで。
```

コマンドの後ろの文が Jev に渡ります。どこまで進めるか（「PR まで」「マージまで」「Issue だけ」）が書かれていれば Jev が到達点を記録し、エージェントは「Jev の判定で到達点を PR までにしました」と 1 行告げてそのまま Issue 作成に進みます。書かれていない、または Jev の確信が足りなければ、`ship-session` と同じ到達点の質問が出ます。

従来の `/ship-session:ship-session` は、このプラグインを入れても変わらずそのまま使えます。

## 何が起きるか

```
/ship-session-jev:… <依頼>   ──►  UserPromptSubmit hook  ─┐
  （コマンドを打つ）                                      ├─► 依頼文を Jev に送る（1 回だけ、800ms 以内）
散文で「Jev で ship して」    ──►  エージェントが Skill を呼ぶ │
                                  ──► PreToolUse hook   ─┘
                 │
                 ├─ 確信が高く（0.85 以上）4 ゴールのどれか ──► 到達点を記録、ゲートを開く
                 │                                            （スラッシュコマンドならコンテキストで伝える）
                 └─ それ以外 ──► 従来どおりゲートを張る
                                       │
Phase 0  エージェントがコンテキスト行を読む / ship-goal.sh status を実行 ┘
         到達点あり → 1 行で告げて先へ
         なし       → 1 回だけ聞く（ship-session と同じ質問）
   ↓
Phase 1  ship-session:create-issue
   ↓
Phase 2  ship-session:issue-loop
   ↓
Phase 3  次の一手を提示
```

## Jev があれば Phase 0 を自動化（任意）

### 設定

すべて hook（`hooks/jev.py`）が環境変数から読みます。Claude Code は自分の環境を hook に渡すので、シェルの環境変数でも `~/.claude/settings.json` の `env` でも効きます。

| 変数 | 既定 | 意味 |
| --- | --- | --- |
| `TYPESAFE_API_KEY` | — | **これが無いと機能ごと無効。** 未設定・空なら Jev を呼ばない |
| `SHIP_JEV_ENABLED` | `1` | `0` / `false` / `no` / `off` で、キーを残したまま Jev を止める |
| `SHIP_JEV_THRESHOLD` | `0.85` | 質問せずに記録する confidence の下限。0〜1 の外や解釈できない値は既定に戻る |
| `SHIP_JEV_TIMEOUT_MS` | `800` | リクエスト全体の壁時計の上限。`5000` で頭打ち（hook 自体は 10 秒で Claude Code に殺される）。超えたら諦めて従来の質問に倒れる |
| `SHIP_JEV_ENDPOINT` | `https://api.typesafe.ai/v1/systemone` | プロキシやテスト向けの差し替え |

既定値は `hooks/jev.py` 冒頭の定数です。

### 何を送るか

[TypeSafe の API リファレンス](https://docs.typesafe.ai/api)に沿った Choice 質問 1 つです。`state` はスラッシュコマンドの後ろに書いた文（エージェント自身がスキルを呼んだときは、その `args`）そのままです。

```json
{
  "model": "jev-latest",
  "state": "<依頼文>",
  "questions": {
    "goal": {
      "type": "choice",
      "instructions": "How far does the user explicitly ask this task to be taken? Pick unspecified when the message does not state how far to go.",
      "criteria": {
        "issue_only":     "Only write a GitHub Issue; no implementation",
        "implementation": "Implement and commit, but do not open a pull request",
        "up_to_pr":       "Implement and open a (draft) pull request; do not merge",
        "up_to_merge":    "Implement, open a pull request, and merge it",
        "unspecified":    "The message does not say how far to go"
      }
    }
  }
}
```

4 つのゴールは `ship-session` の正準ラベル（`Issue only` / `Implementation only (no PR)` / `Up to PR` / `Up to merge`）に 1:1 で写ります。`unspecified` は TypeSafe のドキュメントが推奨する「どれにも当てはまらない」の受け皿で、これが最有力のときは confidence がいくら高くても記録しません。

### 質問に倒れる条件

| 状況 | 結果 |
| --- | --- |
| `TYPESAFE_API_KEY` が無い・`SHIP_JEV_ENABLED=0`・`args` が空 | Jev を呼ばない |
| `SHIP_JEV_ENDPOINT` が `https://` でない（`http://` はループバックのホストにだけ許す） | Jev を呼ばない ── キーを平文で流さない |
| 答えが `unspecified` | 質問する |
| confidence がしきい値未満 | 質問する |
| 接続失敗・タイムアウト・3xx（リダイレクトは追わない）・401 / 422 / 429 / 5xx / 529 | 質問する（リトライしない） |
| 本文が JSON でない・`answers.goal` が無い・`choice` / `confidence` の型が違う・`choice` が 5 つの criteria に無い・`confidence` が 0〜1 の外（`NaN` / `Infinity` 含む） | 質問する |
| 同じ依頼文をスラッシュコマンドでもう一度打った | Jev を呼び直さず、今の状態をコンテキストとしてエージェントに繰り返す |
| 最初の分類の後にエージェントが `Skill` ツールでスキルを再 invoke した | Jev を呼び直さず、何も出さない。エージェントは `ship-goal.sh status` で読む |
| 同じセッションで **別の依頼文** でスラッシュコマンドを打った | 次の依頼として扱い、Jev を呼び直す。前の到達点は引き継がない |

プロキシ: `https://` のエンドポイントでは環境変数の `https_proxy` / `HTTPS_PROXY` を使います（キーは TLS の中）。macOS のシステムプロキシ設定は読まず、平文の `http://`（ループバック）をプロキシに通すことはありません。

hook 自体は `ship-session` のフェイルオープン規則をそのまま持っています。hook の中で何かが壊れても、ツール呼び出しは素通しです。

### Jev の判定を変える

Jev の判定は普通の到達点の記録と同じ扱いです。「やっぱり Issue だけで」と言えば、エージェントが `hooks/ship-goal.sh record "Issue only"` で上書きします。エージェントが到達点の質問をしてきた場合も、その回答が Jev の記録を上書きします。`hooks/ship-goal.sh status` は今の到達点と Jev の判定の両方を出します。

```
goal: Up to PR
jev: decided the goal (up_to_pr, confidence 0.93)
```

上書きした後は、2 行目が経緯を残します。

```
goal: Issue only
jev: decided Up to PR but the goal was changed afterwards (up_to_pr, confidence 0.93)
```

Jev が決めなかったときは理由を出します（`jev: could not decide (low_confidence, up_to_pr, confidence 0.61)` / `jev: not called (no_api_key)`）。

### ログ

試行のたびに `~/.claude/cache/ship-gate-jev/jev.log` へ 1 行追記します。

```
2026-09-22T10:35:00+0900 pid=12345 result=recorded choice=up_to_pr confidence=0.93 elapsed_ms=412
2026-09-22T10:36:00+0900 pid=12346 result=fallback reason=low_confidence choice=up_to_pr confidence=0.61 elapsed_ms=380
2026-09-22T10:37:00+0900 pid=12347 result=fallback reason=http_429 elapsed_ms=120
2026-09-22T10:38:00+0900 pid=12348 result=skipped reason=no_api_key elapsed_ms=0
```

API キー・リクエスト本文・レスポンス本文・依頼文は、ログにもゲートの状態ファイル（`~/.claude/cache/ship-gate-jev/<pid>.json`）にも **書きません**。

## ship-session との共存

- このプラグインのゲート hook は `ship-session-jev`（スラッシュコマンドと `Skill` ツール）にだけ反応し、`ship-session` の hook は `ship-session` にだけ反応します。状態ディレクトリも別（`ship-gate-jev/` と `ship-gate/`）なので、互いの判定を共有したり上書きしたりしません
- セッション名の促し（`UserPromptSubmit`）は `ship-session` の担当のままです。このプラグイン自身の `UserPromptSubmit` hook は自分のスラッシュコマンドだけを見て、それ以外では何も出しません
- `create-issue` / `issue-loop` / `code-review` は同梱していません。`ship-session:create-issue` と `ship-session:issue-loop` を呼ぶので、`ship-session` が入っていないと Phase 1 で止まります

## テスト

```bash
plugins/ship-session-jev/tests/jev_test.sh     # ローカルのモックサーバー相手に全分岐（ネットワーク不要）
plugins/ship-session-jev/tests/gate_test.sh    # ゲート本体。ship-session と同じ検査
plugins/ship-session-jev/tests/skills_test.sh  # SKILL.md / README / manifest の構造
plugins/ship-session-jev/tests/run_all.sh      # 上の 3 本 + ship-session と graph-workflow のテスト
```

テストは使い捨ての `HOME` とダミーのキーで回し、キーの値がログにも出力にも現れないことを検査します。

## ライセンス

MIT
