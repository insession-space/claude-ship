[English](README.md) | 日本語

# yomiyasu-gate

エージェントが PR・Issue・コミットに日本語の文章を書くとき、Bash ツールがそのコマンドを実行する前に [yomiyasu](https://github.com/nanaism/yomiyasu) のリンター `yomiyasu_lint.py` で本文を検査する Claude Code の mod です。本文が規則に合わなければ、mod はコマンドを実行させずに違反の行と種類をエージェントへ返します。エージェントは本文を直して同じコマンドを再実行します。

## 入れる

```bash
claude plugin marketplace add insession-space/claude-ship
claude plugin install yomiyasu-gate@claude-ship
```

Claude Code を再起動すると読み込まれます。mod は `hooks/hooks.json` の `modules` に書いたフックモジュール（`hooks/gate.ts`）です。mods に対応していない Claude Code はこのモジュールを読まないので、何も起きません。

リンターは yomiyasu プラグインに入っています。yomiyasu を入れていない環境では、mod は本文を検査せずにコマンドを通します。

```bash
claude plugin marketplace add nanaism/yomiyasu
claude plugin install yomiyasu@yomiyasu
```

## 検査するコマンド

| コマンド | 本文の取り出し元 |
| --- | --- |
| `gh pr create` / `gh pr edit` / `gh pr comment` | `--body` / `-b` / `--body-file` / `-F` |
| `gh issue create` / `gh issue edit` / `gh issue comment` | `--body` / `-b` / `--body-file` / `-F` |
| `git commit` | `-m`（複数あれば段落としてつなぐ）/ `--message` / `-F` / `--file` |

`--body-file -` と `-F -` を使うコマンドでは、mod は同じ行の heredoc か here-string を本文として読みます。`--body "$(cat <<'EOF' ... EOF)"` の形のコマンド置換も本文の取り出し元です。`&&` や `;` でつないだコマンドは1つずつ見ます。

次の場合、mod は本文を検査せずにコマンドを通します。

- 本文に `$VAR` やほかのコマンド置換が含まれ、実行するまで中身が決まらないとき
- `--body-file` のファイルを読めないとき
- 本文にかなも漢字も無いとき（英語の文章は検査しません）

## 検査から外す行

mod は次の行を空行に置き換えてからリンターに渡します。行番号はリンターの指摘とそろったままです。

- PR 本文末尾の、`Generated with [Claude Code](https://claude.com/claude-code)` を含む帰属行と、`https://claude.ai/code/session_...` だけの行
- コミットの `Co-Authored-By:` 行と `Claude-Session:` 行

## 差し戻す条件

mod はリンターの `--json` の指摘から、無視する規則の指摘を除いてスコアを計算し直します。計算はリンターと同じで、100 点から warn 1件につき 5 点、info 1件につき 2 点を引きます。次のどちらかに当たると、mod はコマンドを差し戻します。

- 1件で差し戻す規則（既定は絵文字と文末コロン）の指摘がある
- スコアがしきい値（既定は 80）を下回る

既定のしきい値 80 は、このリポジトリで直近にマージした PR 本文の検査結果（和欧文間の半角空白を除くと 85〜100 点）をもとに決めました。

和欧文間の半角空白の警告は、既定では無視します。このリポジトリとユーザーのリポジトリは英単語の前後に半角空白を入れる書き方をしているためです。

差し戻しの理由には、違反の行番号・規則の種類・該当行が最大 8 件入ります。並び順は、1件で差し戻す規則の指摘が先です。

## 続けて差し戻したとき

mod は、同じエージェントの同じ種類のコマンド（`git commit`、`gh pr create` など）を続けて差し戻した回数を記録しています。回数が上限（既定は 2）に達すると、mod は次の1回を検査結果に関わらず通し、トーストで知らせて回数を数え直します。検査に通った時点でも回数を数え直します。

mod はコマンドの種類ごとに回数を数えます。エージェントが本文を少しずつ書き換えながら再実行を続けたときにも、上限で止め続けないようにするためです。

## サブエージェント

mod は既定でサブエージェントのコマンドも検査します。委譲先のエージェントもコミットや PR を作り、そこで書いた文章もメインのエージェントの文章と同じように残るためです。`includeSubagents` を `false` にすると、mod はメインのエージェントのコマンドだけを検査します。

## リンターが見つからない・失敗したとき

次の場合、mod はコマンドを通し、トーストで1回だけ知らせます。トーストはセッションごとに1回です。

- リンターが見つからないとき
- Python が起動しない、リンターが 0 以外で終わる、出力が JSON として読めないとき
- 10 秒以内に終わらないとき

mod の処理が途中で例外を投げたときも、コマンドを通します。

## 設定

`/config` か settings の `pluginConfigs["yomiyasu-gate"].options` で変えられます。

| キー | 既定値 | 意味 |
| --- | --- | --- |
| `linterPath` | 空 | `yomiyasu_lint.py` の絶対パス。空なら `~/.claude/plugins/marketplaces/yomiyasu/skills/yomiyasu/scripts/` と `~/.claude/plugins/marketplaces/yomiyasu/scripts/` の順に探します |
| `python` | `python3` | リンターを実行する Python |
| `minScore` | `80` | このスコアを下回ったら差し戻す |
| `hardRules` | `emoji_prohibited,trailing_colon` | 1件で差し戻す規則（カンマ区切り） |
| `ignoreRules` | `unnatural_halfwidth_space` | 数えない規則（カンマ区切り） |
| `maxDenials` | `2` | 続けて差し戻す回数の上限。`0` にすると上限を設けない |
| `includeSubagents` | `true` | サブエージェントのコマンドも検査する |

## 表示の言語

差し戻しの理由とトーストの言語は、Claude Code の `language` 設定、直近のあなたの発話の言語、英語の順に決めます。

## しないこと

- 文章の自動書き換え
- チャットの返答の検査
- 英語の文章の検査
- PR や Issue のタイトルの検査

## テスト

```bash
claude plugin validate plugins/yomiyasu-gate
claude plugin test plugins/yomiyasu-gate
```
