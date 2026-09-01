#!/bin/bash
#  Phase 0 ゲート（ship-gate.py / ship-goal.sh）の検証。
#
#    使い方: tests/gate_test.sh
#
#  **本物の `~/.claude` は触らない。** 使い捨ての HOME を掘って回す。
#  見たい不変条件は3つ:
#    1. ship-session を invoke すると、到達点が決まるまで実作業ツールがブロックされる
#    2. 到達点は record スクリプトでも AskUserQuestion の回答でも記録できる
#    3. ゲートに関係しないセッションは絶対に止めない（フェイルオープン）
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GATE="$ROOT/hooks/ship-gate.py"
GOAL="$ROOT/hooks/ship-goal.sh"

PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"; }
ng() { FAIL=$((FAIL + 1)); printf '  FAIL %s\n' "$1"; }
check() { if [ "$2" = "$3" ]; then ok "$1"; else ng "$1 (期待: $3 / 実際: $2)"; fi; }

PID=424242
SOCK="/tmp/cc-socks/$PID.sock"
SID="s-gate-1"

setup() {
  SANDBOX="$(mktemp -d)"
  mkdir -p "$SANDBOX/.claude"
}

STATE_FILE() { echo "$SANDBOX/.claude/cache/ship-gate/$PID.json"; }

# PreToolUse を投げる。$1=tool_name $2=tool_input(JSON)
run_pre() {
  printf '{"hook_event_name":"PreToolUse","session_id":"%s","tool_name":"%s","tool_input":%s}' \
    "$SID" "$1" "$2" \
    | env HOME="$SANDBOX" CLAUDE_CODE_MESSAGING_SOCKET="$SOCK" \
      "$GATE" > "$SANDBOX/out" 2> "$SANDBOX/err"
}

# PostToolUse (AskUserQuestion) を投げる。$1=tool_input $2=tool_response
run_post() {
  printf '{"hook_event_name":"PostToolUse","session_id":"%s","tool_name":"AskUserQuestion","tool_input":%s,"tool_response":%s}' \
    "$SID" "$1" "$2" \
    | env HOME="$SANDBOX" CLAUDE_CODE_MESSAGING_SOCKET="$SOCK" \
      "$GATE" > "$SANDBOX/out" 2> "$SANDBOX/err"
}

run_goal() {
  env HOME="$SANDBOX" CLAUDE_CODE_MESSAGING_SOCKET="$SOCK" \
    "$GOAL" "$@" > "$SANDBOX/out" 2> "$SANDBOX/err"
}

state_field() {
  python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get(sys.argv[2],""))' \
    "$(STATE_FILE)" "$1" 2>/dev/null
}

arm() { run_pre "Skill" '{"skill":"ship-session:ship-session"}'; }

echo "ゲートを張る"
setup
run_pre "Bash" '{"command":"ls"}'; check "状態が無ければ何でも通る" "$?" "0"
arm; check "ship-session の invoke は通る" "$?" "0"
check "invoke で pending になる" "$(state_field phase)" "pending"
check "session_id が記録される" "$(state_field session_id)" "$SID"
run_pre "Skill" '{"skill":"ship-session:issue-loop"}'
check "サブスキルの invoke ではゲートを張らない…が pending 中はブロックされる" "$?" "2"

echo
echo "pending 中のブロックと許可"
setup; arm
run_pre "Bash" '{"command":"ls"}'; check "Bash(ls) はブロック" "$?" "2"
grep -q "到達点" "$SANDBOX/err" && ok "ブロック文が到達点に言及する" || ng "ブロック文が到達点に言及する"
grep -q "ship-goal.sh" "$SANDBOX/err" && ok "ブロック文が記録スクリプトのパスを含む" || ng "ブロック文が記録スクリプトのパスを含む"
run_pre "Read" '{"file_path":"/tmp/x"}'; check "Read もブロック（調査もゲートの後）" "$?" "2"
run_pre "Agent" '{"prompt":"x"}'; check "Agent もブロック" "$?" "2"
run_pre "AskUserQuestion" '{"questions":[]}'; check "AskUserQuestion は通る" "$?" "0"
run_pre "Bash" '{"command":"\"/x/hooks/rename-session.sh\" \"名前\""}'
check "rename-session.sh は通る" "$?" "0"
run_pre "Bash" "{\"command\":\"\\\"$GOAL\\\" record \\\"PR作成まで\\\"\"}"
check "ship-goal.sh は通る" "$?" "0"
run_pre "Skill" '{"skill":"ship-session:ship-session"}'
check "ship-session の再 invoke は通る" "$?" "0"

echo
echo "record でゲートが開く"
setup; arm
run_goal record "PR作成まで"; check "record が成功する" "$?" "0"
check "active になる" "$(state_field phase)" "active"
check "goal が記録される" "$(state_field goal)" "PR作成まで"
check "session_id が保持される" "$(state_field session_id)" "$SID"
run_pre "Bash" '{"command":"ls"}'; check "active なら Bash が通る" "$?" "0"
arm
check "active 後の再 invoke で pending に戻さない" "$(state_field phase)" "active"
run_goal status
grep -q "PR作成まで" "$SANDBOX/out" && ok "status が goal を出す" || ng "status が goal を出す"
run_goal clear; check "clear が成功する" "$?" "0"
[ ! -f "$(STATE_FILE)" ] && ok "clear で状態が消える" || ng "clear で状態が消える"

echo
echo "AskUserQuestion の回答で自動記録される"
setup; arm
Q='{"questions":[{"question":"どこまで進めますか？","header":"到達点","options":[],"multiSelect":false}]}'
run_post "$Q" '{"answers":{"どこまで進めますか？":"マージまで"}}'
check "自動記録が成功する" "$?" "0"
check "active になる" "$(state_field phase)" "active"
check "回答が goal になる" "$(state_field goal)" "マージまで"
setup; arm
Q2='{"questions":[{"question":"どう進めますか？","header":"進め方","options":[],"multiSelect":false}]}'
run_post "$Q2" '{"answers":{"どう進めますか？":"調査・回答だけする"}}'
check "進め方の回答も記録される" "$(state_field goal)" "調査・回答だけする"
setup; arm
Q3='{"questions":[{"question":"色は？","header":"配色","options":[],"multiSelect":false}]}'
run_post "$Q3" '{"answers":{"色は？":"青"}}'
check "無関係な質問では記録しない" "$(state_field phase)" "pending"

echo
echo "フェイルオープン"
setup; arm
printf '{"hook_event_name":"PreToolUse","session_id":"s-other","tool_name":"Bash","tool_input":{"command":"ls"}}' \
  | env HOME="$SANDBOX" CLAUDE_CODE_MESSAGING_SOCKET="$SOCK" "$GATE" >/dev/null 2>&1
check "別セッションの残骸ではブロックしない" "$?" "0"
[ ! -f "$(STATE_FILE)" ] && ok "残骸は掃除される" || ng "残骸は掃除される"
setup
mkdir -p "$SANDBOX/.claude/cache/ship-gate"
printf 'not json' > "$(STATE_FILE)"
run_pre "Bash" '{"command":"ls"}'; check "壊れた状態ファイルでは素通し" "$?" "0"
setup
printf 'not json' | env HOME="$SANDBOX" CLAUDE_CODE_MESSAGING_SOCKET="$SOCK" "$GATE" >/dev/null 2>&1
check "壊れた入力では素通し" "$?" "0"

echo
printf 'gate_test: pass=%d fail=%d\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
