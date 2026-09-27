#!/bin/bash
#  DESIGN.md の骨格に Base CSS を差し込み、そのまま開ける HTML に組み立てる。
#
#    使い方: tests/build_skeletons.sh <出力ディレクトリ>
#
#  <出力ディレクトリ>/<type id>.html を書き出す。ブラウザで開いて見た目を確かめるための道具で、
#  skill_test.sh からも「組み立てられること」の検査に使う。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DESIGN="$ROOT/DESIGN.md"
OUT="${1:?出力ディレクトリを指定してください}"
mkdir -p "$OUT"

# マーカー間のコードフェンスの中身だけを取り出す（```css / ```html の行と閉じ ``` は除く）
block() {
  awk -v s="<!-- $1:start -->" -v e="<!-- $1:end -->" '
    $0 == s { on = 1; next }
    $0 == e { on = 0 }
    on && !/^```/ { print }
  ' "$DESIGN"
}

BASE="$(block base-css)"
[ -n "$BASE" ] || { echo "Base CSS が取り出せない" >&2; exit 1; }

for id in plan review investigation-report investigation-dashboard implementation; do
  SK="$(block "skeleton:$id")"
  [ -n "$SK" ] || { echo "骨格 $id が取り出せない" >&2; exit 1; }
  printf '%s\n' "$SK" | BASE="$BASE" awk '
    $0 == "/* @base */" { print ENVIRON["BASE"]; next }
    { print }
  ' | { printf '<!doctype html>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n'; cat; } > "$OUT/$id.html"
done
ls "$OUT"
