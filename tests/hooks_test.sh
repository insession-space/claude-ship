#!/bin/bash
#  セッション名まわりの hook / スクリプトの検証。
#
#    使い方: tests/hooks_test.sh
#
#  **本物の `~/.claude` は触らない。** 使い捨ての HOME を掘り、そこに
#  `settings.json` / `sessions/<pid>.json` / `jobs/<id>/state.json` を並べて回す。
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RENAME="$ROOT/hooks/rename-session.sh"
REMIND="$ROOT/hooks/session-name-reminder.py"

PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"; }
ng() { FAIL=$((FAIL + 1)); printf '  FAIL %s\n' "$1"; }
check() { if [ "$2" = "$3" ]; then ok "$1"; else ng "$1 (期待: $3 / 実際: $2)"; fi; }

PID=424242
SOCK="/tmp/cc-socks/$PID.sock"

# 使い捨ての HOME を作る。$1=language（空なら settings.json を置かない）
# $2=nameSource（空なら書かない）$3=state.json の中身を壊すか（broken）
setup() {
  SANDBOX="$(mktemp -d)"
  mkdir -p "$SANDBOX/.claude/sessions" "$SANDBOX/.claude/jobs/job-1"
  [ -n "${1:-}" ] && printf '{"language":"%s"}' "$1" > "$SANDBOX/.claude/settings.json"
  printf '{"sessionId":"s-1","jobId":"job-1","name":"fix-login-bug"}' \
    > "$SANDBOX/.claude/sessions/$PID.json"
  if [ "${3:-}" = "broken" ]; then
    printf 'not json at all' > "$SANDBOX/.claude/jobs/job-1/state.json"
  else
    local src=""
    [ -n "${2:-}" ] && src=",\"nameSource\":\"$2\""
    printf '{"state":"running","tokens":12345,"cwd":"/tmp/x","name":"fix-login-bug"%s}' \
      "$src" > "$SANDBOX/.claude/jobs/job-1/state.json"
  fi
}

# rename を走らせる。CLAUDE_JOB_DIR は渡さない（sessions.json 経由の解決を通す）
run_rename() {
  env -u CLAUDE_JOB_DIR HOME="$SANDBOX" CLAUDE_CODE_MESSAGING_SOCKET="$SOCK" \
    "$RENAME" "$@" > "$SANDBOX/out" 2> "$SANDBOX/err"
}

# 催促 hook を走らせて標準出力を返す
run_remind() {
  echo '{"session_id":"s-1"}' | env -u CLAUDE_JOB_DIR HOME="$SANDBOX" \
    CLAUDE_CODE_MESSAGING_SOCKET="$SOCK" "$REMIND" 2>/dev/null
}

# 名前の文字数。`wc -m` はロケール次第でバイト数を返すので使わない
name_chars() {
  python3 -c 'import json,sys;print(len(json.load(open(sys.argv[1]))["name"]))' \
    "$SANDBOX/.claude/jobs/job-1/state.json"
}

state_field() {
  HOME="$SANDBOX" python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get(sys.argv[2],""))' \
    "$SANDBOX/.claude/jobs/job-1/state.json" "$1"
}

echo "== rename-session.sh =="

setup "日本語"
BEFORE_SESSION="$(cat "$SANDBOX/.claude/sessions/$PID.json")"
run_rename "セッション名の自動リネームを仕込む"; code=$?
check "終了コード0で終わる" "$code" "0"
check "state.json の name が書き換わる" "$(state_field name)" "セッション名の自動リネームを仕込む"
check "nameSource が user になる" "$(state_field nameSource)" "user"
check "無関係なフィールド(tokens)が保たれる" "$(state_field tokens)" "12345"
check "無関係なフィールド(cwd)が保たれる" "$(state_field cwd)" "/tmp/x"
check "sessions/<pid>.json は書き換わらない" \
  "$(cat "$SANDBOX/.claude/sessions/$PID.json")" "$BEFORE_SESSION"
check "付け直し済みの印が置かれる" \
  "$([ -f "$SANDBOX/.claude/cache/session-renamed/$PID" ] && echo yes || echo no)" "yes"
rm -rf "$SANDBOX"

setup "日本語"
LONG="あ"; for _ in $(seq 1 29); do LONG="$LONG""あ"; done   # 全角30文字 = 60幅
run_rename "$LONG"
check "40幅を超える名前が切り詰められる(全角20文字)" "$(name_chars)" "20"
rm -rf "$SANDBOX"

setup "日本語" "" broken
run_rename "壊れた state を直さない"; code=$?
check "壊れた state.json では終了コード1" "$code" "1"
rm -rf "$SANDBOX"

setup "日本語"
run_rename ""; code=$?
check "名前が空なら終了コード1" "$code" "1"
check "空の実行で name が壊れない" "$(state_field name)" "fix-login-bug"
rm -rf "$SANDBOX"

setup "日本語"
rm "$SANDBOX/.claude/sessions/$PID.json"
run_rename "ジョブが無いセッション"; code=$?
check "対応するジョブが無ければ終了コード1" "$code" "1"
rm -rf "$SANDBOX"

echo "== session-name-reminder.py =="

setup "日本語"
OUT="$(run_remind)"; code=$?
check "日本語・未命名なら終了コード0" "$code" "0"
check "促しが出る" "$(printf '%s' "$OUT" | grep -c 'UserPromptSubmit')" "1"
check "促しに rename-session.sh のパスが載る" \
  "$(printf '%s' "$OUT" | grep -c 'rename-session.sh')" "1"
rm -rf "$SANDBOX"

setup "English"
check "表示言語が英語なら何も出さない" "$(run_remind)" ""
rm -rf "$SANDBOX"

setup ""
check "language 未設定なら何も出さない(AppleLocale が ja でない限り)" \
  "$(env -u CLAUDE_JOB_DIR HOME="$SANDBOX" PATH=/nonexistent \
     CLAUDE_CODE_MESSAGING_SOCKET="$SOCK" python3 "$REMIND" <<< '{"session_id":"s-1"}' 2>/dev/null)" ""
rm -rf "$SANDBOX"

setup "日本語" "user"
check "既に user 由来の名前なら何も出さない" "$(run_remind)" ""
rm -rf "$SANDBOX"

setup "日本語"
python3 -c 'import json,sys;p=sys.argv[1];d=json.load(open(p));d["name"]="リリース手順の署名検証を通す";json.dump(d,open(p,"w"),ensure_ascii=False)'   "$SANDBOX/.claude/jobs/job-1/state.json"
check "既に表示言語の名前が付いていれば何も出さない" "$(run_remind)" ""
rm -rf "$SANDBOX"

setup "日本語" "" broken
OUT="$(run_remind)"; code=$?
check "壊れた state.json では何も出さない" "$OUT" ""
check "壊れた state.json でも終了コード0" "$code" "0"
rm -rf "$SANDBOX"

setup "日本語"
rm "$SANDBOX/.claude/sessions/$PID.json"
check "ジョブが無いセッションでは何も出さない" "$(run_remind)" ""
rm -rf "$SANDBOX"

setup "日本語"
run_remind > /dev/null; run_remind > /dev/null; run_remind > /dev/null
check "促しは上限3回まで" "$(run_remind)" ""
rm -rf "$SANDBOX"

setup "日本語"
echo 'not json' | env -u CLAUDE_JOB_DIR HOME="$SANDBOX" \
  CLAUDE_CODE_MESSAGING_SOCKET="$SOCK" "$REMIND" > /dev/null 2>&1
check "stdin が JSON でなくても終了コード0" "$?" "0"
rm -rf "$SANDBOX"

echo
echo "pass=$PASS fail=$FAIL"
[ "$FAIL" -eq 0 ]
