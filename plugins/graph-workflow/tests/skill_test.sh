#!/bin/bash
#  graph-workflow スキル文書の構造検証。
#
#    使い方: plugins/graph-workflow/tests/skill_test.sh
#
#  見たい不変条件:
#    1. 承認ゲート（実行前に設計を見せて承認を取る）が消えていない
#    2. Workflow のオプトイン規約への言及が消えていない
#    3. 4フェーズ + 完了シグナルの節が揃っている
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
  has "Phase $n の節がある" "$SKILL" "^## Phase $n[:：]"
done

echo
echo "承認ゲート"
has "承認を取るまで Workflow を呼ばない旨がある" "$SKILL" "承認.*まで Workflow を呼ばない"
has "承認ゲートの節がある" "$SKILL" "承認ゲート"
has "他スキル経由でも承認を省略しない旨がある" "$SKILL" "呼ばれたときも省略しない"
has "mermaid 図の提示がある" "$SKILL" "mermaid"
has "実行可否を選択式で聞く" "$SKILL" 'header: "実行可否"'

echo
echo "スクリプトの規律"
has "workflow-authoring を先に読む旨がある" "$SKILL" "workflow-authoring"
has "pipeline が既定である旨がある" "$SKILL" "pipeline.*既定"
has "schema での構造化がある" "$SKILL" "schema"
has "エージェント数の目安がある" "$SKILL" "15体以下"
has "秘密の値の扱いがある" "$SKILL" "秘密の値"

echo
echo "再開と突き合わせ"
has "resume の手順がある" "$SKILL" "resumeFromRunId"
has "journal.jsonl への言及がある" "$SKILL" "journal\.jsonl"
has "件数の突き合わせがある" "$SKILL" "突き合わせ"

echo
echo "完了シグナル"
has "呼び出し元判定がある" "$SKILL" "呼び出し元"
has "result: の規定がある" "$SKILL" '`result:`'
has "needs input: の規定がある" "$SKILL" '`needs input:`'

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
