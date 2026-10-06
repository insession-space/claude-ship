#!/bin/bash
#  skills/issue-loop/scripts/tick_criteria.py の検証。
#
#    使い方: tests/tick_criteria_test.sh
#
#  issue-loop が Issue 本文に書き戻すとき、検証した受け入れ条件の行だけが変わり、
#  ほかの行（別の見出しのチェック、フェンスやコメントの中）は1バイトも変わらないことを見る。
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TICK="$ROOT/skills/issue-loop/scripts/tick_criteria.py"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"; }
ng() { FAIL=$((FAIL + 1)); printf '  FAIL %s\n' "$1"; }

# $1=説明 $2=期待する本文のファイル $3=実際の本文のファイル
same() { if cmp -s "$2" "$3"; then ok "$1"; else ng "$1"; diff "$2" "$3" | sed 's/^/       /'; fi; }

cat > "$TMP/body.md" <<'EOF'
## 背景
- [ ] validate が通る（背景の中の同じ文）

## 受け入れ条件
### 機能
- [ ] validate が通る
- [ ] test が緑
```md
- [ ] test が緑（フェンスの中）
```
<!--
- [ ] README（コメントの中）
-->
- [ ] README に載っている

## 未決事項
- [ ] test が緑かどうか
EOF

cat > "$TMP/want.md" <<'EOF'
## 背景
- [ ] validate が通る（背景の中の同じ文）

## 受け入れ条件
### 機能
- [x] validate が通る
- [x] test が緑
```md
- [ ] test が緑（フェンスの中）
```
<!--
- [ ] README（コメントの中）
-->
- [ ] README に載っている

## 未決事項
- [ ] test が緑かどうか
EOF

echo "--list で受け入れ条件だけに番号を振る"
python3 -I "$TICK" "$TMP/body.md" --list > "$TMP/list"; code=$?
[ "$code" -eq 0 ] && ok "終了コード 0" || ng "終了コード 0 (実際: $code)"
printf '1 [ ] validate が通る\n2 [ ] test が緑\n3 [ ] README に載っている\n' > "$TMP/list-want"
same "別の見出し・フェンス・コメントの項目に番号を振らない" "$TMP/list-want" "$TMP/list"

echo
echo "番号の行だけにチェックを付ける"
cp "$TMP/body.md" "$TMP/a.md"
python3 -I "$TICK" "$TMP/a.md" 1 2 > /dev/null; code=$?
[ "$code" -eq 0 ] && ok "終了コード 0" || ng "終了コード 0 (実際: $code)"
same "別の見出し・フェンス・コメントの行は変わらない" "$TMP/want.md" "$TMP/a.md"

echo
echo "--untick で戻す"
python3 -I "$TICK" "$TMP/a.md" --untick 1 2 > /dev/null; code=$?
[ "$code" -eq 0 ] && ok "終了コード 0" || ng "終了コード 0 (実際: $code)"
same "元の本文に戻る" "$TMP/body.md" "$TMP/a.md"

echo
echo "範囲外や数字でない番号があれば何も書かない"
cp "$TMP/body.md" "$TMP/b.md"
python3 -I "$TICK" "$TMP/b.md" 1 4 2> "$TMP/err"; code=$?
[ "$code" -eq 1 ] && ok "範囲外は終了コード 1" || ng "範囲外は終了コード 1 (実際: $code)"
same "本文は変わらない" "$TMP/body.md" "$TMP/b.md"
grep -q "4" "$TMP/err" && ok "範囲外の番号を stderr に出す" || ng "範囲外の番号を stderr に出す"
python3 -I "$TICK" "$TMP/b.md" '$(touch '"$TMP"'/pwned)' 2> /dev/null; code=$?
[ "$code" -eq 1 ] && ok "数字でない引数は終了コード 1" || ng "数字でない引数は終了コード 1 (実際: $code)"
same "本文は変わらない" "$TMP/body.md" "$TMP/b.md"

echo
echo "書き出しが同じ条件を取り違えない"
printf -- '## 受け入れ条件\n- [ ] test\n- [ ] test が緑\n' > "$TMP/f.md"
python3 -I "$TICK" "$TMP/f.md" 1 > /dev/null; code=$?
[ "$code" -eq 0 ] && ok "終了コード 0" || ng "終了コード 0 (実際: $code)"
printf -- '## 受け入れ条件\n- [x] test\n- [ ] test が緑\n' > "$TMP/f-want.md"
same "1番だけが変わる" "$TMP/f-want.md" "$TMP/f.md"

echo
echo "受け入れ条件の見出しが無ければ本文のチェックリスト全部を見る"
printf -- '- [ ] one\n- [ ] two\n' > "$TMP/c.md"
python3 -I "$TICK" "$TMP/c.md" 2 > /dev/null; code=$?
[ "$code" -eq 0 ] && ok "終了コード 0" || ng "終了コード 0 (実際: $code)"
printf -- '- [ ] one\n- [x] two\n' > "$TMP/c-want.md"
same "当たった行だけ変わる" "$TMP/c-want.md" "$TMP/c.md"

echo
echo "CRLF の本文は改行を保つ"
printf -- '## Acceptance criteria\r\n- [ ] one\r\n- [ ] two\r\n' > "$TMP/d.md"
python3 -I "$TICK" "$TMP/d.md" 1 > /dev/null; code=$?
[ "$code" -eq 0 ] && ok "終了コード 0" || ng "終了コード 0 (実際: $code)"
printf -- '## Acceptance criteria\r\n- [x] one\r\n- [ ] two\r\n' > "$TMP/d-want.md"
same "CRLF のまま当たった行だけ変わる" "$TMP/d-want.md" "$TMP/d.md"

echo
echo "Non-acceptance criteria は受け入れ条件として扱わない"
printf -- '## Non-acceptance criteria\n- [ ] x\n## Acceptance criteria\n- [ ] y\n' > "$TMP/e.md"
python3 -I "$TICK" "$TMP/e.md" --list > "$TMP/e-list"
printf '1 [ ] y\n' > "$TMP/e-want"
same "番号は Acceptance criteria の y だけに振る" "$TMP/e-want" "$TMP/e-list"

echo
printf 'tick_criteria_test: %d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
