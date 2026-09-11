#!/bin/bash
#  graph-workflow スキル文書の構造検証。
#
#    使い方: plugins/graph-workflow/tests/skill_test.sh
#
#  見たい不変条件:
#    1. 承認ゲート（実行前に設計を見せて承認を取る）が消えていない
#    2. Workflow のオプトイン規約への言及が消えていない
#    3. 4フェーズ + 完了シグナルの節が揃っている
#    4. ユーザーへの出力をユーザーの言語で出す規定がある（SKILL.md は英語で書く）
#
#  **文言の完全一致では検査しない。** 節や要素の存在だけを見る。
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SKILL="$ROOT/SKILL.md"

PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"; }
ng() { FAIL=$((FAIL + 1)); printf '  FAIL %s\n' "$1"; }

has() {
  if [ ! -f "$2" ]; then ng "$1 (ファイルが無い: $2)"; return; fi
  if grep -qE "$3" "$2"; then ok "$1"; else ng "$1 (見つからない: $3)"; fi
}

echo "フェーズが揃っている"
for n in 0 1 2 3 4; do
  has "Phase $n の節がある" "$SKILL" "^## Phase $n:"
done

echo
echo "承認ゲート"
has "承認を取るまで Workflow を呼ばない旨がある" "$SKILL" "Do not call Workflow until the user approves"
has "承認ゲートの節がある" "$SKILL" "Approval gate"
has "質問なし実行の条件がある" "$SKILL" "run without asking"
has "委譲経由では承認を取る旨がある" "$SKILL" "launched via delegation"
has "書き込みありでは承認を取る旨がある" "$SKILL" "involves writes"
has "スキップ時も設計を提示する旨がある" "$SKILL" "never run it silently"
has "mermaid 図の提示がある" "$SKILL" "mermaid"
has "実行可否を選択式で聞く" "$SKILL" 'header: "Approval"'

echo
echo "スクリプトの規律"
has "workflow-authoring を先に読む旨がある" "$SKILL" "workflow-authoring"
has "pipeline が既定である旨がある" "$SKILL" "pipeline is the default"
has "schema での構造化がある" "$SKILL" "schema"
has "エージェント数の目安がある" "$SKILL" "15 agents or fewer"
has "秘密の値の扱いがある" "$SKILL" "secret values"

echo
echo "再開と突き合わせ"
has "resume の手順がある" "$SKILL" "resumeFromRunId"
has "journal.jsonl への言及がある" "$SKILL" "journal\.jsonl"
has "件数の突き合わせがある" "$SKILL" "reconcile"

echo
echo "完了シグナル"
has "呼び出し元判定がある" "$SKILL" "caller"
has "result: の規定がある" "$SKILL" '`result:`'
has "needs input: の規定がある" "$SKILL" '`needs input:`'

echo
echo "ユーザーの言語"
has "ユーザーの言語の節がある" "$SKILL" "^## Use the user's language"
has "language 設定を最優先で見る" "$SKILL" "language. setting"
has "直近の発話の言語に倒す" "$SKILL" "most recent message"
has "result: などの接頭辞は訳さない" "$SKILL" "Do not translate"
DESC="$(head -n 5 "$SKILL" | grep -E '^description: ' | head -n 1)"
printf '%s' "$DESC" | grep -qE '^description: [A-Za-z]' && ok "description が英語で始まる" || ng "description が英語で始まる"
printf '%s' "$DESC" | grep -qE '"[A-Za-z][^"]*"' && ok "英語のトリガー例がある" || ng "英語のトリガー例がある"
printf '%s' "$DESC" | grep -q '「' && ok "日本語のトリガー例がある" || ng "日本語のトリガー例がある"

echo
echo "プラグイン定義"
PJ="$ROOT/.claude-plugin/plugin.json"
if python3 -c "import json;json.load(open('$PJ'))" 2>/dev/null; then
  ok "plugin.json が JSON として読める"
else
  ng "plugin.json が JSON として読める"
fi
has "plugin.json の name が graph-workflow" "$PJ" '"name": "graph-workflow"'

echo
printf 'skill_test: pass=%d fail=%d\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
