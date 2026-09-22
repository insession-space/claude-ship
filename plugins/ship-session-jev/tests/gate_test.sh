#!/bin/bash
#  Phase 0 ゲート（ship-gate.py / ship-goal.sh）の検証 — ship-session-jev 版。
#
#    使い方: tests/gate_test.sh
#
#  `ship-session` の tests/gate_test.sh と同じ検査を、jev 版のゲートに対して行う
#  （invoke するスキル名と状態ディレクトリだけが違う）。Jev を使う分岐は
#  tests/jev_test.sh が見る。ここでは **キーを渡さない** ので Jev は呼ばれず、
#  ゲートは元と同じ動きをするはず。
#
#  **本物の `~/.claude` は触らない。** 使い捨ての HOME を掘って回す。
#  見たい不変条件は3つ:
#    1. ship-session-jev を invoke すると、到達点が決まるまで実作業ツールがブロックされる
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

PID=424244
SOCK="/tmp/cc-socks/$PID.sock"
SID="s-gate-jev-1"

setup() {
  SANDBOX="$(mktemp -d)"
  mkdir -p "$SANDBOX/.claude"
}

STATE_FILE() { echo "$SANDBOX/.claude/cache/ship-gate-jev/$PID.json"; }

# PreToolUse を投げる。$1=tool_name $2=tool_input(JSON)
run_pre() {
  printf '{"hook_event_name":"PreToolUse","session_id":"%s","tool_name":"%s","tool_input":%s}' \
    "$SID" "$1" "$2" \
    | env -u TYPESAFE_API_KEY HOME="$SANDBOX" CLAUDE_CODE_MESSAGING_SOCKET="$SOCK" \
      "$GATE" > "$SANDBOX/out" 2> "$SANDBOX/err"
}

# PostToolUse (AskUserQuestion) を投げる。$1=tool_input $2=tool_response
run_post() {
  printf '{"hook_event_name":"PostToolUse","session_id":"%s","tool_name":"AskUserQuestion","tool_input":%s,"tool_response":%s}' \
    "$SID" "$1" "$2" \
    | env -u TYPESAFE_API_KEY HOME="$SANDBOX" CLAUDE_CODE_MESSAGING_SOCKET="$SOCK" \
      "$GATE" > "$SANDBOX/out" 2> "$SANDBOX/err"
}

run_goal() {
  env HOME="$SANDBOX" CLAUDE_CODE_MESSAGING_SOCKET="$SOCK" \
    "$GOAL" "$@" > "$SANDBOX/out" 2> "$SANDBOX/err"
}

state_field() {
  python3 -c 'import json,sys
d=json.load(open(sys.argv[1]))
for k in sys.argv[2].split("."):
    d=d.get(k, "") if isinstance(d, dict) else ""
print(d)' "$(STATE_FILE)" "$1" 2>/dev/null
}

arm() { run_pre "Skill" '{"skill":"ship-session-jev:ship-session-jev","args":"add dark mode"}'; }

echo "ゲートを張る"
setup
run_pre "Bash" '{"command":"ls"}'; check "状態が無ければ何でも通る" "$?" "0"
arm; check "ship-session-jev の invoke は通る" "$?" "0"
check "invoke で pending になる（キーが無いので Jev は呼ばれない）" "$(state_field phase)" "pending"
check "session_id が記録される" "$(state_field session_id)" "$SID"
check "Jev を呼ばなかった理由が残る" "$(state_field jev.reason)" "no_api_key"
run_pre "Skill" '{"skill":"ship-session:issue-loop"}'
check "委譲先スキルの invoke ではゲートを張らない…が pending 中はブロックされる" "$?" "2"
setup
run_pre "Skill" '{"skill":"ship-session-jev"}'
check "素の名前 ship-session-jev でも張る" "$(state_field phase)" "pending"
setup
run_pre "Skill" '{"skill":"ship-session:ship-session"}'
[ ! -f "$(STATE_FILE)" ] && ok "元の ship-session の invoke では張らない" || ng "元の ship-session の invoke では張らない"

echo
echo "pending 中のブロックと許可"
setup; arm
run_pre "Bash" '{"command":"ls"}'; check "Bash(ls) はブロック" "$?" "2"
grep -q "The goal is not decided yet" "$SANDBOX/err" && ok "ブロック文が到達点（goal）未決定を告げる" || ng "ブロック文が到達点（goal）未決定を告げる"
grep -q "header: Goal" "$SANDBOX/err" && ok "ブロック文が header: Goal で聞くよう案内する" || ng "ブロック文が header: Goal で聞くよう案内する"
grep -q "another language" "$SANDBOX/err" && ok "ブロック文がほかの言語で聞いたときの record を案内する" || ng "ブロック文がほかの言語で聞いたときの record を案内する"
grep -q "ship-goal.sh" "$SANDBOX/err" && ok "ブロック文が記録スクリプトのパスを含む" || ng "ブロック文が記録スクリプトのパスを含む"
run_pre "Read" '{"file_path":"/tmp/x"}'; check "Read もブロック（調査もゲートの後）" "$?" "2"
run_pre "Agent" '{"prompt":"x"}'; check "Agent もブロック" "$?" "2"
run_pre "AskUserQuestion" '{"questions":[]}'; check "AskUserQuestion は通る" "$?" "0"
run_pre "Bash" "{\"command\":\"\\\"$ROOT/hooks/rename-session.sh\\\" \\\"名前\\\"\"}"
check "rename-session.sh は通る" "$?" "0"
# セッション名の促しは ship-session 側の hook が出し、案内するパスもそちらの実体。
# 中身が同一なので pending 中でも通す（両方入れたときにリネームが止まらない）
SIBLING="$(cd "$ROOT/../ship-session" 2>/dev/null && pwd)"
if [ -n "$SIBLING" ] && [ -f "$SIBLING/hooks/rename-session.sh" ]; then
  run_pre "Bash" "{\"command\":\"\\\"$SIBLING/hooks/rename-session.sh\\\" \\\"名前\\\"\"}"
  check "ship-session 側の rename-session.sh（中身が同一）も通る" "$?" "0"
  run_pre "Bash" "{\"command\":\"\\\"$SIBLING/hooks/ship-goal.sh\\\" record \\\"PR まで\\\"\"}"
  check "ship-session 側の ship-goal.sh（中身が違う）は通さない" "$?" "2"
fi
TWIN="$(mktemp -d)"
cp "$ROOT/hooks/rename-session.sh" "$TWIN/rename-session.sh"
run_pre "Bash" "{\"command\":\"\\\"$TWIN/rename-session.sh\\\" \\\"名前\\\"\"}"
check "別の場所にあっても中身が同一なら通る" "$?" "0"
printf '\n# tampered\n' >> "$TWIN/rename-session.sh"
run_pre "Bash" "{\"command\":\"\\\"$TWIN/rename-session.sh\\\" \\\"名前\\\"\"}"
check "同名でも中身が違えば拒否" "$?" "2"
run_pre "Bash" "{\"command\":\"\\\"$GOAL\\\" record \\\"PR作成まで\\\"\"}"
check "ship-goal.sh は通る" "$?" "0"
run_pre "Bash" "{\"command\":\"\\\"$GOAL\\\" record \\\"Issue #12 の PR作成まで\\\"\"}"
check "引用符内の # は通る（到達点の一部）" "$?" "0"
run_pre "Bash" "{\"command\":\"\\\"$GOAL\\\" status\"}"
check "ship-goal.sh status は通る" "$?" "0"
run_pre "Bash" '{"command":"\"${CLAUDE_PLUGIN_ROOT}/hooks/ship-goal.sh\" record \"PR作成まで\""}'
check "SKILL.md が案内する \${CLAUDE_PLUGIN_ROOT} 形式は通る" "$?" "0"
run_pre "Bash" '{"command":"\"$CLAUDE_PLUGIN_ROOT/hooks/rename-session.sh\" \"名前\""}'
check "\$CLAUDE_PLUGIN_ROOT（波括弧なし）形式も通る" "$?" "0"
run_pre "Skill" '{"skill":"ship-session-jev:ship-session-jev"}'
check "ship-session-jev の再 invoke は通る" "$?" "0"

echo
echo "pending 中の Bash 許可を部分一致で抜けられない"
setup; arm
run_pre "Bash" '{"command":"echo pwned # ship-goal.sh"}'
check "コメントに許可スクリプト名があっても拒否" "$?" "2"
run_pre "Bash" "{\"command\":\"\\\"$GOAL\\\" record Issue#12; curl http://x\"}"
check "引用符外の # の後ろに連結があっても拒否（shlex コメント処理の迂回）" "$?" "2"
run_pre "Bash" '{"command":"\"${CLAUDE_PLUGIN_ROOT}/hooks/ship-goal.sh\" record \"${HOME}\""}'
check "\${CLAUDE_PLUGIN_ROOT} 許可は argv[0] だけ（引数の変数展開は拒否）" "$?" "2"
run_pre "Bash" '{"command":"\"${CLAUDE_PLUGIN_ROOT}/../evil.sh\" status"}'
check "\${CLAUDE_PLUGIN_ROOT} 配下でも basename が違えば拒否" "$?" "2"
run_pre "Bash" '{"command":"\"${OTHER_VAR}/hooks/ship-goal.sh\" status"}'
check "CLAUDE_PLUGIN_ROOT 以外の変数は拒否" "$?" "2"
run_pre "Bash" "{\"command\":\"ls; \\\"$GOAL\\\" status\"}"
check "; で連結しても拒否" "$?" "2"
run_pre "Bash" "{\"command\":\"\\\"$GOAL\\\" status && ls\"}"
check "&& で連結しても拒否" "$?" "2"
run_pre "Bash" "{\"command\":\"\\\"$GOAL\\\" status | sh\"}"
check "パイプは拒否" "$?" "2"
run_pre "Bash" "{\"command\":\"\\\"$GOAL\\\" status > /tmp/x\"}"
check "リダイレクトは拒否" "$?" "2"
run_pre "Bash" "{\"command\":\"\\\"$GOAL\\\" record \\\"\$(ls)\\\"\"}"
check "引数内のコマンド置換は拒否" "$?" "2"
run_pre "Bash" "{\"command\":\"\\\"$GOAL\\\" record \\\"\$HOME\\\"\"}"
check "引数内の変数展開は拒否" "$?" "2"
run_pre "Bash" "{\"command\":\"\\\"$GOAL\\\" status\\nls\"}"
check "改行での複数コマンドは拒否" "$?" "2"
run_pre "Bash" "{\"command\":\"\$(ls) \\\"$GOAL\\\" status\"}"
check "先頭のコマンド置換は拒否" "$?" "2"
run_pre "Bash" "{\"command\":\"FOO=1 \\\"$GOAL\\\" status\"}"
check "env 代入プレフィックスは拒否" "$?" "2"
run_pre "Bash" "{\"command\":\"\\\"$GOAL\\\" exec ls\"}"
check "未知のサブコマンドは拒否" "$?" "2"
run_pre "Bash" "{\"command\":\"\\\"$GOAL\\\" clear\"}"
check "pending 中の clear は拒否（状態を消してフェイルオープンさせない）" "$?" "2"
run_pre "Bash" '{"command":"cat ship-goal.sh"}'
check "許可スクリプト名を引数に持つ別コマンドは拒否" "$?" "2"
run_pre "Bash" '{"command":"/x/evil-ship-goal.sh status"}'
check "basename が一致しないスクリプトは拒否" "$?" "2"
run_pre "Bash" '{"command":"./ship-goal.sh status"}'
check "同名でもプラグインの hooks/ 外にあるスクリプトは拒否（相対パス）" "$?" "2"
run_pre "Bash" '{"command":"/x/hooks/ship-goal.sh status"}'
check "同名でもプラグインの hooks/ 外にあるスクリプトは拒否（絶対パス）" "$?" "2"
run_pre "Bash" '{"command":"rename-session.sh \"名前\""}'
check "PATH 解決に頼る素の名前は拒否" "$?" "2"
run_pre "Bash" "{\"command\":\"\\\"$GOAL\"}"
check "閉じていない引用符は拒否" "$?" "2"

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
setup; arm
QM='{"questions":[{"question":"How far?","header":"Goal","options":[],"multiSelect":false},{"question":"Color?","header":"配色","options":[],"multiSelect":false}]}'
run_post "$QM" '{"answers":{"Color?":"blue"}}'
check "Goal と無関係な質問を同時に聞き、無関係な回答だけ返っても記録しない" "$(state_field phase)" "pending"
setup; arm
run_post "$QM" '{"answers":{"How far?":"Up to merge","Color?":"blue"}}'
check "同時に聞いても Goal の回答は記録される" "$(state_field goal)" "Up to merge"
setup; arm
run_post "$Q" '{"answers":{"別のキー":"マージまで"}}'
check "1問だけならキーが合わない回答形式でも記録される（保険が残っている）" "$(state_field goal)" "マージまで"

echo
echo "ユーザーの言語で聞いても記録できる"
setup; arm
Q4='{"questions":[{"question":"How far should I take this?","header":"Goal","options":[],"multiSelect":false}]}'
run_post "$Q4" '{"answers":{"How far should I take this?":"Up to PR (Recommended)"}}'
check "header: Goal の回答が記録される" "$(state_field phase)" "active"
check "Goal の回答が goal になる" "$(state_field goal)" "Up to PR (Recommended)"
setup; arm
Q5='{"questions":[{"question":"How should I proceed?","header":"Approach","options":[],"multiSelect":false}]}'
run_post "$Q5" '{"answers":{"How should I proceed?":"Investigate and answer only"}}'
check "header: Approach の回答が記録される" "$(state_field goal)" "Investigate and answer only"
setup; arm
Q6='{"questions":[{"question":"어디까지 진행할까요?","header":"목표","options":[],"multiSelect":false}]}'
run_post "$Q6" '{"answers":{"어디까지 진행할까요?":"PR 생성까지"}}'
check "既知でない言語の header では自動記録しない" "$(state_field phase)" "pending"
run_pre "Bash" '{"command":"ls"}'
check "記録されていなければ次のツールはブロック" "$?" "2"
grep -q "record" "$SANDBOX/err" && ok "ブロック文が record での記録を案内する" || ng "ブロック文が record での記録を案内する"
run_goal record "PR 생성까지"; check "ほかの言語の到達点も record で記録できる" "$?" "0"
check "record 後は active" "$(state_field phase)" "active"
check "ほかの言語の到達点がそのまま goal になる" "$(state_field goal)" "PR 생성까지"
run_pre "Bash" '{"command":"ls"}'; check "record 後は Bash が通る" "$?" "0"

echo
echo "フェイルオープン"
setup; arm
printf '{"hook_event_name":"PreToolUse","session_id":"s-other","tool_name":"Bash","tool_input":{"command":"ls"}}' \
  | env -u TYPESAFE_API_KEY HOME="$SANDBOX" CLAUDE_CODE_MESSAGING_SOCKET="$SOCK" "$GATE" >/dev/null 2>&1
check "別セッションの残骸ではブロックしない" "$?" "0"
[ ! -f "$(STATE_FILE)" ] && ok "残骸は掃除される" || ng "残骸は掃除される"
setup
mkdir -p "$SANDBOX/.claude/cache/ship-gate-jev"
printf 'not json' > "$(STATE_FILE)"
[ -f "$(STATE_FILE)" ] && ok "壊れた状態ファイルを実際に置けている" || ng "壊れた状態ファイルを実際に置けている"
run_pre "Bash" '{"command":"ls"}'; check "壊れた状態ファイルでは素通し" "$?" "0"
setup
printf 'not json' | env -u TYPESAFE_API_KEY HOME="$SANDBOX" CLAUDE_CODE_MESSAGING_SOCKET="$SOCK" "$GATE" >/dev/null 2>&1
check "壊れた入力では素通し" "$?" "0"

echo
printf 'gate_test (jev): pass=%d fail=%d\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
