[English](README.md) | 日本語

# artifact-templates

Artifact を作るとき、**用途から型を選んで**その骨格で組み立てるプラグイン。同じ種類の報告はいつも同じ見た目になり、機械が作ったような見た目と文章を避けます。

## 入れる

```bash
claude plugin marketplace add insession-space/claude-ship
claude plugin install artifact-templates@claude-ship
```

## 使う

```
この企画を Artifact にして
レビュー結果をレポートにまとめて
各サービスの状況をダッシュボードで見せて
```

ページはあなたの言語で書かれます（Claude Code の `language` 設定、なければ話しかけた言語、どちらも無ければ英語）。

## 型

| 型 | 使う場面 | 形 |
|---|---|---|
| `plan` | 企画・提案・方針など、読み手が決める必要があるもの | LP。提案を1文で先に出し、最後に「決めてほしいこと」 |
| `review` | コードレビュー・セキュリティレビュー・監査の指摘 | テクニカルレポート。重大度と `file:line` の表が主役 |
| `investigation-report` | 原因調査・比較など、1つの問いに答えるもの | レポート。答え → 根拠（出典付き）→ 否定した仮説 → 未解明 |
| `investigation-dashboard` | 多数の項目の状況把握、前期比の数字 | ダッシュボード。主要な数字 → 要対応 → 全件の表 |
| `implementation` | 出荷した作業の報告 | 到達点・受け入れ条件・検証の exit code・before / after |

## 設計の考え方

- **正本は `DESIGN.md` の1か所。** 共通土台（色トークン・書体・レイアウト・Base CSS）、slop 禁止リスト、5つの型の骨格が入っています。他のスキルはここを参照し、中身を複製しません
- **既定はダーク。** OS の設定に関わらずダークで表示し、ライトは閲覧者が明示的に選んだとき（`data-theme="light"`）だけです
- **見た目は実務文書寄り。** 青みグレーの地に藍1色、IBM Plex Sans JP。カードや影ではなく罫線と余白で区切ります
- **AI 臭さを消す。** グラデーション・絵文字見出し・全部カード・中央揃え・定型句（「〜することができます」「シームレス」など）を禁止し、見出しに結論を、形容詞の代わりに数字と固有名を書きます
- **`artifact-design` スキルと併用します。** ページの契約（CDN・サイズ・テーマ）はそちらが持ち、このプラグインは用途ごとの型を足すだけです
- **どの型にも当てはまらないもの**（ゲーム・ツールなど）には型を使いません

## ship-session との関係

`ship-session` の完了報告（実装完了・レビュー指摘・Issue の判断まとめ）は、このプラグインが入っていれば対応する型で作ります。入っていなくても `ship-session` は動きます。

## 検証

```bash
plugins/artifact-templates/tests/skill_test.sh
plugins/artifact-templates/tests/build_skeletons.sh <出力先>   # 骨格を開ける HTML に組み立てる
```
