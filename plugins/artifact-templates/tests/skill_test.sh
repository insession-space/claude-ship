#!/bin/bash
#  artifact-templates の構造検証。
#
#    使い方: plugins/artifact-templates/tests/skill_test.sh
#
#  見たい不変条件:
#    1. 5つの型（企画 / レビュー報告 / 調査レポート / 調査ダッシュボード / 実装完了報告）の節と骨格がある
#    2. 共通土台（Base CSS）が1か所にあり、各骨格はそれを差し込む形で使っている
#    3. 既定がダーク（素の :root がダーク、ライトは data-theme="light" のときだけ）
#    4. 骨格に AI 臭さ（グラデーション・絵文字・ガラス風・定型句）が無い
#    5. SKILL.md に文脈 → 型の判定表とユーザーの言語の規定がある
#
#  **文言の完全一致では検査しない。** 節や要素の存在だけを見る。
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SKILL="$ROOT/SKILL.md"
DESIGN="$ROOT/DESIGN.md"
MARKET="$ROOT/../../.claude-plugin/marketplace.json"
TYPES="plan review investigation-report investigation-dashboard implementation"

PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"; }
ng() { FAIL=$((FAIL + 1)); printf '  FAIL %s\n' "$1"; }

has() {
  if [ ! -f "$2" ]; then ng "$1 (ファイルが無い: $2)"; return; fi
  if grep -qE "$3" "$2"; then ok "$1"; else ng "$1 (見つからない: $3)"; fi
}

block() {
  awk -v s="<!-- $1:start -->" -v e="<!-- $1:end -->" '
    $0 == s { on = 1; next }
    $0 == e { on = 0 }
    on && !/^```/ { print }
  ' "$DESIGN"
}

echo "配布: プラグインとして登録されている"
has "plugin.json がある" "$ROOT/.claude-plugin/plugin.json" '"name": "artifact-templates"'
has "marketplace.json に登録されている" "$MARKET" '"source": "./plugins/artifact-templates"'
has "README（英）がある" "$ROOT/README.md" "artifact-templates"
has "README（日）がある" "$ROOT/README.ja.md" "artifact-templates"

echo
echo "DESIGN.md: 型の節が揃っている"
has "共通土台の節がある" "$DESIGN" "^## Shared base"
has "slop 禁止リストの節がある" "$DESIGN" "^## No-slop list"
has "企画（LP）の型" "$DESIGN" "^## Type: Plan \(landing page\)"
has "レビュー報告の型" "$DESIGN" "^## Type: Review report"
has "調査（レポート）の型" "$DESIGN" "^## Type: Investigation, report form"
has "調査（ダッシュボード）の型" "$DESIGN" "^## Type: Investigation, dashboard form"
has "実装完了報告の型" "$DESIGN" "^## Type: Implementation report"
n="$(grep -cE '^\*\*Use it when\*\*' "$DESIGN")"
[ "$n" -eq 5 ] && ok "5つの型すべてに「使う文脈」がある" || ng "5つの型すべてに「使う文脈」がある (実際: $n)"
n="$(grep -cE '^\*\*Required sections, in order\*\*' "$DESIGN")"
[ "$n" -eq 5 ] && ok "5つの型すべてに必須セクションがある" || ng "5つの型すべてに必須セクションがある (実際: $n)"
n="$(grep -cE '^\*\*Tone\*\*' "$DESIGN")"
[ "$n" -eq 5 ] && ok "5つの型すべてにトーンがある" || ng "5つの型すべてにトーンがある (実際: $n)"

echo
echo "DESIGN.md: 共通土台（Base CSS）は1か所"
BASE="$(block base-css)"
[ -n "$BASE" ] && ok "Base CSS が取り出せる" || ng "Base CSS が取り出せる"
n="$(grep -c '<!-- base-css:start -->' "$DESIGN")"
[ "$n" -eq 1 ] && ok "Base CSS のブロックは1つだけ" || ng "Base CSS のブロックは1つだけ (実際: $n)"
printf '%s\n' "$BASE" | grep -qE '^:root \{' && ok "素の :root に色トークンがある" || ng "素の :root に色トークンがある"
printf '%s\n' "$BASE" | awk '/^:root \{/,/^\}/' | grep -q 'color-scheme: dark' \
  && ok "既定（素の :root）はダーク" || ng "既定（素の :root）はダーク"
printf '%s\n' "$BASE" | grep -q ':root\[data-theme="light"\]' && ok "ライトは data-theme=\"light\" で上書き" || ng "ライトは data-theme=\"light\" で上書き"
printf '%s\n' "$BASE" | grep -q 'prefers-color-scheme' && ng "OS 設定でライトに切り替えない（既定ダーク）" || ok "OS 設定でライトに切り替えない（既定ダーク）"
printf '%s\n' "$BASE" | grep -qE '^body \{.*background: var\(--bg\)' && ok "body の背景をトークンで塗っている" || ng "body の背景をトークンで塗っている"
printf '%s\n' "$BASE" | grep -q 'padding-inline: clamp(16px' && ok "16px 以上の左右ガター" || ng "16px 以上の左右ガター"
printf '%s\n' "$BASE" | grep -q 'overflow-x: auto' && ok "表は自分のコンテナで横スクロール" || ng "表は自分のコンテナで横スクロール"
# ライトで上書きするトークンが素の :root にも全部ある（片方にしか無い色を作らない）
DARK_TOK="$(printf '%s\n' "$BASE" | awk '/^:root \{/,/^\}/' | grep -oE -- '--[a-z0-9-]+:' | sort -u)"
LIGHT_TOK="$(printf '%s\n' "$BASE" | awk '/^:root\[data-theme="light"\] \{/,/^\}/' | grep -oE -- '--[a-z0-9-]+:' | sort -u)"
missing="$(comm -13 <(printf '%s\n' "$DARK_TOK") <(printf '%s\n' "$LIGHT_TOK"))"
[ -z "$missing" ] && ok "ライトのトークンはすべて素の :root で定義済み" || ng "ライトのトークンはすべて素の :root で定義済み (欠け: $missing)"

echo
echo "DESIGN.md: 骨格"
for id in $TYPES; do
  SK="$(block "skeleton:$id")"
  if [ -z "$SK" ]; then ng "$id: 骨格が取り出せる"; continue; fi
  ok "$id: 骨格が取り出せる"
  printf '%s\n' "$SK" | grep -qx '/\* @base \*/' && ok "$id: Base CSS を差し込む形" || ng "$id: Base CSS を差し込む形"
  printf '%s\n' "$SK" | grep -q '^<title>' && ok "$id: <title> がある" || ng "$id: <title> がある"
  printf '%s\n' "$SK" | grep -q 'fonts.googleapis.com/css2?family=IBM+Plex' && ok "$id: 共通の書体を読み込む" || ng "$id: 共通の書体を読み込む"
  printf '%s\n' "$SK" | grep -qE 'class="page[^"]*" lang=' && ok "$id: ラッパーに lang がある" || ng "$id: ラッパーに lang がある"
  # 骨格で色を直書きしない（色はトークン経由）
  printf '%s\n' "$SK" | grep -qE '#[0-9a-fA-F]{3,6}\b' && ng "$id: 色を直書きしていない" || ok "$id: 色を直書きしていない"
done

echo
echo "DESIGN.md: 骨格と Base CSS に AI 臭さが無い"
ALL="$(block base-css; for id in $TYPES; do block "skeleton:$id"; done)"
nope() {
  if printf '%s\n' "$ALL" | grep -qiE "$2"; then ng "$1 (見つかった: $2)"; else ok "$1"; fi
}
nope "グラデーションを使わない" 'gradient'
nope "ガラス風（backdrop-filter）を使わない" 'backdrop-filter'
nope "影を使わない" 'box-shadow|text-shadow|drop-shadow'
nope "中央揃えを使わない" 'text-align: *center'
nope "英語の定型句が無い" 'seamless|cutting-edge|unlock|empower|leverage|delve'
nope "日本語の定型句が無い" 'することができ|シームレス|革新的|を実現|いかがでしたか'
nope "全画面高さのブロックが無い" '(^|[ ;{])(min-)?height: *100vh'
nope "見出しを <br> で割っていない" '<h[1-3][^>]*>[^<]*<br'
if printf '%s\n' "$ALL" | grep -q '·.*·'; then ng "1行に · は1つまで"; else ok "1行に · は1つまで"; fi
# 表の全行に罫線を引かない（行の区切りはダッシュボードの table.dense だけ）
printf '%s\n' "$(block base-css)" | grep -E '^td \{' | grep -q 'border' \
  && ng "Base CSS の td に罫線が無い" || ok "Base CSS の td に罫線が無い"
# ダッシュ（em / en）はページにもスキル文書にも使わない
for f in "$SKILL" "$DESIGN" "$ROOT/README.md" "$ROOT/README.ja.md"; do
  if grep -qF -e '—' -e '–' "$f"; then ng "${f#"$ROOT"/}: em / en ダッシュが無い"; else ok "${f#"$ROOT"/}: em / en ダッシュが無い"; fi
done
if printf '%s\n' "$ALL" | perl -CS -ne 'exit 1 if /[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}\x{2B50}\x{2705}]/' ; then
  ok "絵文字が無い"
else
  ng "絵文字が無い"
fi

echo
echo "DESIGN.md: slop 禁止リストの中身"
has "見た目の禁止リストがある" "$DESIGN" "^### Look"
has "レイアウトの禁止リストがある" "$DESIGN" "^### Layout$"
has "ラベル・装飾の禁止リストがある" "$DESIGN" "^### Labels and ornaments"
has "文章の禁止リストがある" "$DESIGN" "^### Writing"
has "taste-skill を参照元として示している" "$DESIGN" "github.com/Leonxlnx/taste-skill"
has "split header 禁止" "$DESIGN" "No split header"
has "均等3カード禁止" "$DESIGN" "No three equal cards"
has "div で描いた偽スクショ禁止" "$DESIGN" "No UI drawn with divs"
has "番号付き eyebrow 禁止" "$DESIGN" "never a numbered one"
has "測っていない綺麗な数字禁止" "$DESIGN" "perfect-looking figures"
has "グラデーション禁止" "$DESIGN" "No gradients"
has "絵文字見出し禁止" "$DESIGN" "No emoji"
has "定型句禁止（日英）" "$DESIGN" "No stock phrases"
has "見出しに結論を書く" "$DESIGN" "states the conclusion"

echo
echo "DESIGN.md: plan は LP の形をしている"
PLAN="$(block skeleton:plan)"
HERO="$(printf '%s\n' "$PLAN" | awk '/<header class="hero">/,/<\/header>/')"
printf '%s\n' "$HERO" | grep -q '<h1>' && ok "ヒーローに見出し" || ng "ヒーローに見出し"
printf '%s\n' "$HERO" | grep -q 'class="cta" href="#decide"' && ok "ヒーローに決定セクションへの CTA" || ng "ヒーローに決定セクションへの CTA"
printf '%s\n' "$HERO" | grep -q '<img ' && ok "ヒーローに実物のビジュアル（img）" || ng "ヒーローに実物のビジュアル（img）"
printf '%s\n' "$HERO" | grep -q 'class="meta"' && ng "ヒーローにメタ行を置かない" || ok "ヒーローにメタ行を置かない"
n="$(printf '%s\n' "$HERO" | grep -cE '<(h1|p|a) ')"; n2="$(printf '%s\n' "$HERO" | grep -c '<h1>')"
[ $((n + n2)) -le 4 ] && ok "ヒーローの文字要素は4つまで ($((n + n2)))" || ng "ヒーローの文字要素は4つまで ($((n + n2)))"
printf '%s\n' "$PLAN" | grep -q 'id="decide"' && ok "CTA の着地点がある" || ng "CTA の着地点がある"
for cls in problem points compare timeline decide; do
  printf '%s\n' "$PLAN" | grep -q "class=\"$cls\"" && ok "セクションの型: $cls" || ng "セクションの型: $cls"
done

echo
echo "DESIGN.md: 実装完了報告の画像は拡大できる"
IMPL="$(block skeleton:implementation)"
for pat in 'showModal' '"Enter"' '" "' 'e.target === box' '"cancel"' 'box.close\(\)' 'from.focus\(\)' 'lightbox-open' 'tabindex="0"' 'max-width: 95vw'; do
  printf '%s\n' "$IMPL" | grep -qE "$pat" && ok "lightbox: $pat" || ng "lightbox: $pat"
done

echo
echo "骨格を組み立てられる"
TMP="$(mktemp -d)"
if "$ROOT/tests/build_skeletons.sh" "$TMP" >/dev/null 2>&1; then
  ok "build_skeletons.sh が exit 0"
  for id in $TYPES; do
    f="$TMP/$id.html"
    if [ -f "$f" ] && grep -q -- '--bg: #0f141b' "$f" && ! grep -q '/\* @base \*/' "$f"; then
      ok "$id: Base CSS が差し込まれている"
    else
      ng "$id: Base CSS が差し込まれている"
    fi
  done
else
  ng "build_skeletons.sh が exit 0"
fi
rm -rf "$TMP"

echo
echo "SKILL.md"
has "frontmatter の name" "$SKILL" '^name: artifact-templates$'
desc="$(head -n 5 "$SKILL" | grep -E '^description: ' | head -n 1)"
printf '%s' "$desc" | grep -qE '^description: [A-Za-z]' && ok "description が英語で始まる" || ng "description が英語で始まる"
printf '%s' "$desc" | grep -qE '"[A-Za-z][^"]*"' && ok "英語のトリガー例がある" || ng "英語のトリガー例がある"
printf '%s' "$desc" | grep -q '「' && ok "日本語のトリガー例がある" || ng "日本語のトリガー例がある"
len="$(printf '%s' "${desc#description: }" | wc -m | tr -d ' ')"
[ "$len" -le 1024 ] && ok "description が 1024 文字以内 ($len)" || ng "description が 1024 文字以内 ($len)"
has "文脈 → 型の判定の節がある" "$SKILL" "^## Step 1: Pick the type"
for id in $TYPES; do
  has "判定表に $id がある" "$SKILL" "\| \`$id\` \|"
done
has "明示の依頼が優先" "$SKILL" "explicit request wins"
has "どの型にも当てはまらないときは型を使わない" "$SKILL" "No type fits"
has "artifact-design と併用する" "$SKILL" "artifact-design"
has "ユーザーの言語の節がある" "$SKILL" "^## Use the user's language"
has "language 設定を最優先で見る" "$SKILL" "Claude Code's .language. setting"
has "直近の発話の言語に倒す" "$SKILL" "most recent message"
has "日本語の文章は yomiyasu に沿う" "$SKILL" "Japanese text follows the .*yomiyasu"
has "日本語の文では yomiyasu を優先する" "$SKILL" "yomiyasu wins"
has "README（英）に yomiyasu の導入手順がある" "$ROOT/README.md" "claude plugin install yomiyasu@yomiyasu"
has "README（日）に yomiyasu の導入手順がある" "$ROOT/README.ja.md" "claude plugin install yomiyasu@yomiyasu"
has "DESIGN.md が正本" "$SKILL" "single source of truth"

echo
printf 'skill_test: %d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
