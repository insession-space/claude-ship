#!/bin/bash
#  スキル文書の構造検証。
#
#    使い方: tests/skills_test.sh
#
#  ship-session が「Issue を作ったところで無言で止まる」のを防いでいるゲート
#  （Phase 0 の先行実行・委譲先の result: の扱い・出荷型でない依頼の分岐）が
#  SKILL.md 群から消えていないことを見る。
#
#  **文言の完全一致では検査しない。** 節や要素の存在だけを見る。文言を調整する
#  たびに赤くなるテストは維持されないため。
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"; }
ng() { FAIL=$((FAIL + 1)); printf '  FAIL %s\n' "$1"; }

# $1=説明 $2=ファイル $3=grep -E のパターン
has() {
  if [ ! -f "$2" ]; then ng "$1 (ファイルが無い: $2)"; return; fi
  if grep -qE "$3" "$2"; then ok "$1"; else ng "$1 (見つからない: $3)"; fi
}

SHIP="$ROOT/SKILL.md"
DELEGATES="create-issue issue-loop code-review"

echo "ship-session SKILL.md: フェーズが揃っている"
for n in 0 1 2 3; do
  has "Phase $n の節がある" "$SHIP" "^## Phase $n[:：]"
done

echo
echo "ship-session SKILL.md: Phase 0 のゲート"
# 到達点を先に確定させる旨。「セッション名（のリネーム）以外」という例外の明示を見る。
has "到達点を他のツール呼び出しより先に確定させる旨がある" "$SHIP" "セッション名.*以外"
has "調査が先に要る依頼でも例外にしない旨がある" "$SHIP" "ゲートを飛ばす理由にならない"

echo
echo "ship-session SKILL.md: 到達点の選択肢が変わっていない"
has "選択肢 PR作成まで（推奨）" "$SHIP" '\*\*PR作成まで（推奨）\*\*'
has "選択肢 マージまで" "$SHIP" '\| マージまで \|'
has "選択肢 実装まで（PRは作らない）" "$SHIP" '\| 実装まで（PRは作らない） \|'
has "選択肢 Issue作成まで" "$SHIP" '\| Issue作成まで \|'
# 順序: PR作成まで → マージまで → 実装まで → Issue作成まで
# 表の行（| 1 | … | 4 |）だけを見る。概要の箇条書きにも同じ語が出るため。
ORDER="$(grep -E '^\| [1-4] \|' "$SHIP" | head -n 4 \
  | awk -F'|' '{gsub(/^ +| +$/, "", $3); gsub(/\*\*/, "", $3); print $3}' | tr '\n' ',')"
if [ "$ORDER" = "PR作成まで（推奨）,マージまで,実装まで（PRは作らない）,Issue作成まで," ]; then
  ok "選択肢の順序が変わっていない"
else
  ng "選択肢の順序が変わっていない (実際: $ORDER)"
fi

echo
echo "ship-session SKILL.md: 委譲先の result: の扱い"
has "委譲先の result: を中間報告として扱う節がある" "$SHIP" "^### 委譲先の .result:. は中間報告"
has "ターンを締めてよい条件が書かれている" "$SHIP" "到達点に達し"

echo
echo "ship-session SKILL.md: 出荷型でない依頼の分岐"
has "出荷型でない依頼の節がある" "$SHIP" "^### 出荷型でない依頼のとき"
has "header: \"進め方\" で聞く旨がある" "$SHIP" 'header: "進め方"'
has "選択肢 調査・回答だけする（推奨）" "$SHIP" '\*\*調査・回答だけする（推奨）\*\*'
has "選択肢 Issue 化して実装まで回す" "$SHIP" 'Issue 化して実装まで回す'
has "選択肢 別のスキルに任せる" "$SHIP" '別のスキルに任せる'

echo
echo "委譲先スキル: ship-session 経由では result: で締めない"
for s in $DELEGATES; do
  f="$ROOT/skills/$s/SKILL.md"
  has "$s: ship-session から呼ばれたときの分岐がある" "$f" 'ship-session. から呼ばれているときは .result:. を書かない'
  has "$s: 単体起動時は result: で締める旨が残っている" "$f" '単体で起動されたときは'
done

echo
echo "全 SKILL.md: frontmatter に name と description がある"
for f in "$SHIP" "$ROOT"/skills/*/SKILL.md; do
  rel="${f#"$ROOT"/}"
  head -n 5 "$f" | grep -qE '^name: ' && ok "$rel: name" || ng "$rel: name"
  head -n 5 "$f" | grep -qE '^description: ' && ok "$rel: description" || ng "$rel: description"
done

echo
printf 'skills_test: %d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
