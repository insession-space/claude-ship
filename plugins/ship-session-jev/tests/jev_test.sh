#!/bin/bash
#  Jev による到達点の自動分類（ship-gate.py + jev.py）の検証。
#
#    使い方: tests/jev_test.sh
#
#  **本物の `~/.claude` にも本物の API にも触らない。** 使い捨ての HOME を掘り、
#  ローカルのモック Jev サーバー（tests/mock_jev_server.py）に向けて回す。
#  見たい不変条件は 4 つ:
#    1. キーが無い / 無効化されている / 依頼文が空なら、HTTP を出さず従来どおり pending
#    2. 確信が高ければ質問せずに active（正準ラベルが goal になる）
#    3. 確信が低い・unspecified・API 失敗・本文不正・タイムアウトは、必ず pending に倒れる
#       （hook の終了コードは 0 のまま。ユーザーの作業を止めない）
#    4. キーの値と依頼文が、ログにもテスト出力にも現れない
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GATE="$ROOT/hooks/ship-gate.py"
GOAL="$ROOT/hooks/ship-goal.sh"
MOCK="$ROOT/tests/mock_jev_server.py"

PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"; }
ng() { FAIL=$((FAIL + 1)); printf '  FAIL %s\n' "$1"; }
check() { if [ "$2" = "$3" ]; then ok "$1"; else ng "$1 (期待: $3 / 実際: $2)"; fi; }

PID=424243
SOCK="/tmp/cc-socks/$PID.sock"
SID="s-jev-1"
# テスト用のダミーキー。**この値を echo しない**（出力に出ないことも検査する）
DUMMY_KEY="test-only-key-$RANDOM$RANDOM"
# 依頼文にも目印を入れて、ログに漏れていないことを見る
REQUEST_TEXT="ZZZREQUESTTEXT add dark mode, up to PR"

# モックサーバーを 1 回だけ起動する。終了時に **その PID だけ** を kill する
CTRL="$(mktemp -d)"
MOCK_EXPECT_KEY="$DUMMY_KEY" python3 "$MOCK" "$CTRL" &
MOCK_PID=$!
trap 'kill "$MOCK_PID" 2>/dev/null; wait "$MOCK_PID" 2>/dev/null' EXIT
for _ in $(seq 1 50); do [ -s "$CTRL/port" ] && break; sleep 0.1; done
[ -s "$CTRL/port" ] || { echo "mock server did not start" >&2; exit 1; }
ENDPOINT="http://127.0.0.1:$(cat "$CTRL/port")/v1/systemone"
# 最初の 1 接続は macOS 側の初回コスト（Gatekeeper・ファイアウォールの確認）で
# 遅れることがあり、800ms の壁時計に引っかかる。検査対象は hook の判定なので、
# ここで 1 回ウォームアップしてから始める
printf 'answer:unspecified:0.9' > "$CTRL/mode"
python3 -c 'import sys,urllib.request
urllib.request.urlopen(urllib.request.Request(sys.argv[1], data=b"{}", method="POST"), timeout=10).read()' "$ENDPOINT" >/dev/null 2>&1

setup() {
  SANDBOX="$(mktemp -d)"
  mkdir -p "$SANDBOX/.claude"
  : > "$CTRL/requests.log"
}

STATE_FILE() { echo "$SANDBOX/.claude/cache/ship-gate-jev/$PID.json"; }
LOG_FILE() { echo "$SANDBOX/.claude/cache/ship-gate-jev/jev.log"; }

set_mode() { printf '%s' "$1" > "$CTRL/mode"; }
request_count() { wc -l < "$CTRL/requests.log" | tr -d ' '; }
last_request() {
  python3 -c 'import json,sys
lines=[l for l in open(sys.argv[1]) if l.strip()]
print(json.loads(lines[-1]).get(sys.argv[2], "") if lines else "")' "$CTRL/requests.log" "$1"
}
last_request_body_field() {
  python3 -c 'import json,sys
lines=[l for l in open(sys.argv[1]) if l.strip()]
body=json.loads(json.loads(lines[-1])["body"])
cur=body
for k in sys.argv[2].split("."):
    cur=cur[k]
print(json.dumps(cur, ensure_ascii=False, sort_keys=True) if not isinstance(cur, str) else cur)' \
    "$CTRL/requests.log" "$1"
}

# 既定の環境（キーあり・モックに向ける）で PreToolUse を投げる。
# $1=tool_name $2=tool_input(JSON)、以降は env の上書き（KEY=VALUE。後勝ち）
# タイムアウトは長めに固定する。時間が主題の検査は自分で SHIP_JEV_TIMEOUT_MS を渡す
# （マシンが重いと 800ms の既定に引っかかり、無関係な検査が揺れる）
SLOW_OK="SHIP_JEV_TIMEOUT_MS=5000"
run_pre() {
  local tool="$1" input="$2"; shift 2
  printf '{"hook_event_name":"PreToolUse","session_id":"%s","tool_name":"%s","tool_input":%s}' \
    "$SID" "$tool" "$input" \
    | env HOME="$SANDBOX" CLAUDE_CODE_MESSAGING_SOCKET="$SOCK" \
      TYPESAFE_API_KEY="$DUMMY_KEY" SHIP_JEV_ENDPOINT="$ENDPOINT" "$SLOW_OK" "$@" \
      "$GATE" > "$SANDBOX/out" 2> "$SANDBOX/err"
}

# ship-session-jev を invoke する（$1=args、以降は env の上書き）
arm_with() {
  local args="$1"; shift
  local input
  input="$(python3 -c 'import json,sys;print(json.dumps({"skill":"ship-session-jev:ship-session-jev","args":sys.argv[1]}, ensure_ascii=False))' "$args")"
  run_pre "Skill" "$input" "$@"
}

# UserPromptSubmit を投げる。$1=prompt（生の文字列）、以降は env の上書き
run_prompt() {
  local prompt="$1"; shift
  python3 -c 'import json,sys;print(json.dumps({"hook_event_name":"UserPromptSubmit","session_id":sys.argv[1],"prompt":sys.argv[2]}, ensure_ascii=False))' "$SID" "$prompt" \
    | env HOME="$SANDBOX" CLAUDE_CODE_MESSAGING_SOCKET="$SOCK" \
      TYPESAFE_API_KEY="$DUMMY_KEY" SHIP_JEV_ENDPOINT="$ENDPOINT" "$SLOW_OK" "$@" \
      "$GATE" > "$SANDBOX/out" 2> "$SANDBOX/err"
}

# hook の stdout（additionalContext）を取り出す。無ければ空。
# JSON として読めない出力は PARSE_ERROR にする（「何も出さない」の検査が、壊れた
# 出力でも通ってしまわないように）
prompt_context() {
  python3 -c 'import json,sys
raw=open(sys.argv[1]).read().strip()
if not raw: print(""); sys.exit(0)
try:
    print(json.loads(raw)["hookSpecificOutput"]["additionalContext"])
except Exception:
    print("PARSE_ERROR:" + raw[:80])' "$SANDBOX/out"
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

echo "Jev を呼ばない条件（HTTP を出さず、従来どおり pending）"
setup; set_mode "answer:up_to_pr:0.99"
arm_with "$REQUEST_TEXT" TYPESAFE_API_KEY=
check "キーが空なら hook は 0 で返る" "$?" "0"
check "キーが空なら pending" "$(state_field phase)" "pending"
check "キーが空ならリクエストを出さない" "$(request_count)" "0"
check "状態に skipped の理由が残る" "$(state_field jev.reason)" "no_api_key"
grep -q "result=skipped reason=no_api_key" "$(LOG_FILE)" && ok "ログに skipped が残る" || ng "ログに skipped が残る"
setup
printf '{"hook_event_name":"PreToolUse","session_id":"%s","tool_name":"Skill","tool_input":{"skill":"ship-session-jev:ship-session-jev","args":"%s"}}' "$SID" "$REQUEST_TEXT" \
  | env -u TYPESAFE_API_KEY HOME="$SANDBOX" CLAUDE_CODE_MESSAGING_SOCKET="$SOCK" SHIP_JEV_ENDPOINT="$ENDPOINT" \
    "$GATE" > "$SANDBOX/out" 2> "$SANDBOX/err"
check "キーが未設定（変数自体が無い）でも pending" "$(state_field phase)" "pending"
check "キーが未設定ならリクエストを出さない" "$(request_count)" "0"
setup
arm_with "$REQUEST_TEXT" SHIP_JEV_ENABLED=0
check "SHIP_JEV_ENABLED=0 なら pending" "$(state_field phase)" "pending"
check "SHIP_JEV_ENABLED=0 ならリクエストを出さない" "$(request_count)" "0"
check "状態に disabled の理由が残る" "$(state_field jev.reason)" "disabled"
for off in false no off OFF False; do
  setup
  arm_with "$REQUEST_TEXT" SHIP_JEV_ENABLED="$off"
  check "SHIP_JEV_ENABLED=$off でも止まる" "$(request_count)" "0"
done
setup; set_mode "answer:up_to_pr:0.93"
arm_with "$REQUEST_TEXT" SHIP_JEV_ENABLED=
check "SHIP_JEV_ENABLED が空なら既定（有効）" "$(state_field phase)" "active"
run_goal status
setup
run_goal status
grep -q "^goal: not set (no gate is armed)" "$SANDBOX/out" && ok "status: 状態が無ければ not set" || ng "status: 状態が無ければ not set"
arm_with "$REQUEST_TEXT" TYPESAFE_API_KEY=
run_goal status
grep -q "^jev: not called (no_api_key)$" "$SANDBOX/out" && ok "status: 呼ばなかったときは not called (理由)" || ng "status: 呼ばなかったときは not called (理由) ($(cat "$SANDBOX/out"))"
setup
arm_with ""
check "args が空なら pending" "$(state_field phase)" "pending"
check "args が空ならリクエストを出さない" "$(request_count)" "0"
check "状態に no_args の理由が残る" "$(state_field jev.reason)" "no_args"
setup
run_pre "Skill" '{"skill":"ship-session-jev:ship-session-jev"}'
check "args キー自体が無くても pending" "$(state_field phase)" "pending"
check "args キーが無ければリクエストを出さない" "$(request_count)" "0"
setup
run_pre "Skill" '{"skill":"ship-session:ship-session","args":"add dark mode, up to PR"}'
check "元の ship-session の invoke では hook は 0 で返る" "$?" "0"
[ ! -f "$(STATE_FILE)" ] && ok "元の ship-session の invoke ではゲートを張らない" || ng "元の ship-session の invoke ではゲートを張らない"
check "元の ship-session の invoke ではリクエストを出さない" "$(request_count)" "0"
run_pre "Bash" '{"command":"ls"}'
check "元の ship-session を使うセッションは何もブロックしない" "$?" "0"
setup
run_pre "Skill" '{"skill":"ship-session:issue-loop","args":"#19"}'
[ ! -f "$(STATE_FILE)" ] && ok "委譲先スキルの invoke では張らない" || ng "委譲先スキルの invoke では張らない"

echo
echo "確信が高ければ質問せずに active"
setup; set_mode "answer:up_to_pr:0.93"
arm_with "$REQUEST_TEXT"
check "hook は 0 で返る" "$?" "0"
check "active になる（jev: $(state_field jev.result) $(state_field jev.reason)）" "$(state_field phase)" "active"
check "goal が正準ラベル Up to PR になる" "$(state_field goal)" "Up to PR"
check "session_id が記録される" "$(state_field session_id)" "$SID"
check "状態に choice が残る" "$(state_field jev.choice)" "up_to_pr"
check "状態に confidence が残る" "$(state_field jev.confidence)" "0.93"
check "状態に result=recorded が残る" "$(state_field jev.result)" "recorded"
check "リクエストは 1 回" "$(request_count)" "1"
run_pre "Bash" '{"command":"ls"}'; check "active なので Bash が通る" "$?" "0"
run_pre "Read" '{"file_path":"/tmp/x"}'; check "active なので Read が通る" "$?" "0"
check "他のツール呼び出しでは HTTP を出さない" "$(request_count)" "1"
arm_with "$REQUEST_TEXT"
check "active 後の再 invoke でも pending に戻さない" "$(state_field phase)" "active"
check "active 後の再 invoke では Jev を呼ばない" "$(request_count)" "1"
run_goal status
grep -q "^goal: Up to PR" "$SANDBOX/out" && ok "status が goal を出す" || ng "status が goal を出す"
grep -q "jev: decided the goal (up_to_pr, confidence 0.93)" "$SANDBOX/out" && ok "status が Jev の判定を出す" || ng "status が Jev の判定を出す ($(cat "$SANDBOX/out"))"
grep -q "result=recorded choice=up_to_pr confidence=0.93 elapsed_ms=" "$(LOG_FILE)" && ok "ログに recorded / choice / confidence / 所要時間が残る" || ng "ログに recorded / choice / confidence / 所要時間が残る"
run_goal record "Issue only"
check "ユーザーの言い直しで goal を上書きできる" "$(state_field goal)" "Issue only"
run_goal status
grep -q "jev: decided Up to PR but the goal was changed afterwards" "$SANDBOX/out" && ok "status が上書きされた旨を出す" || ng "status が上書きされた旨を出す ($(cat "$SANDBOX/out"))"

echo
echo "スラッシュコマンド（UserPromptSubmit）でもゲートを張り、Jev が決める"
setup; set_mode "answer:up_to_pr:0.93"
run_prompt "/ship-session-jev:ship-session-jev $REQUEST_TEXT"
check "hook は 0 で返る" "$?" "0"
check "スラッシュコマンドで active になる（jev: $(state_field jev.result) $(state_field jev.reason)）" "$(state_field phase)" "active"
check "goal が Up to PR" "$(state_field goal)" "Up to PR"
check "session_id が記録される" "$(state_field session_id)" "$SID"
check "state はコマンド名を除いた依頼文" "$(last_request_body_field state)" "$REQUEST_TEXT"
CTX="$(prompt_context)"
printf '%s' "$CTX" | grep -q "Jev classified this request as goal: Up to PR" && ok "additionalContext が Jev の到達点を伝える" || ng "additionalContext が Jev の到達点を伝える ($CTX)"
printf '%s' "$CTX" | grep -q "confidence 0.93" && ok "additionalContext に confidence がある" || ng "additionalContext に confidence がある"
printf '%s' "$CTX" | grep -q "do not ask" && ok "additionalContext が質問しないよう伝える" || ng "additionalContext が質問しないよう伝える"
check "additionalContext にキーの値が無い" "$(printf '%s' "$CTX" | grep -c "$DUMMY_KEY")" "0"
check "additionalContext に依頼文が無い" "$(printf '%s' "$CTX" | grep -c "ZZZREQUESTTEXT")" "0"
run_pre "Bash" '{"command":"ls"}'; check "active なので Bash が通る" "$?" "0"
run_prompt "/ship-session-jev:ship-session-jev $REQUEST_TEXT"
check "active 後に同じ文でコマンドを打ち直しても張り直さない" "$(state_field goal)" "Up to PR"
check "同じ文の打ち直しでは Jev を呼ばない" "$(request_count)" "1"
printf '%s' "$(prompt_context)" | grep -q "already recorded: Up to PR" && ok "同じ文の打ち直しには記録済みの到達点を伝える" || ng "同じ文の打ち直しには記録済みの到達点を伝える ($(prompt_context))"
set_mode "answer:issue_only:0.95"
run_prompt "/ship-session-jev:ship-session-jev remove the legacy API, issue only"
check "別の文でコマンドを打てば次の依頼として分類し直す" "$(request_count)" "2"
check "次の依頼の到達点で上書きされる（前の Up to PR を引き継がない）" "$(state_field goal)" "Issue only"
printf '%s' "$(prompt_context)" | grep -q "Jev classified this request as goal: Issue only" && ok "次の依頼の判定を additionalContext で伝える" || ng "次の依頼の判定を additionalContext で伝える"
set_mode "answer:unspecified:0.9"
run_prompt "/ship-session-jev:ship-session-jev something vague"
check "次の依頼で決まらなければ pending に戻る（前の到達点で走らない）" "$(state_field phase)" "pending"
run_pre "Bash" '{"command":"ls"}'; check "pending に戻ったので Bash はブロック" "$?" "2"
setup; set_mode "answer:up_to_pr:0.93"
run_prompt "/ship-session-jev:ship-session-jev $REQUEST_TEXT"
arm_with "totally different agent paraphrase"
check "active 中の Skill ツール経由（エージェントの言い換え）では張り直さない" "$(state_field goal)" "Up to PR"
check "その場合 Jev も呼ばない" "$(request_count)" "1"
setup; set_mode "answer:up_to_pr:0.93"
run_prompt "/ship-session-jev $REQUEST_TEXT"
check "短い形 /ship-session-jev でも張る" "$(state_field phase)" "active"
check "短い形でも state は依頼文だけ" "$(last_request_body_field state)" "$REQUEST_TEXT"
setup; set_mode "answer:up_to_merge:0.9"
run_prompt "<command-message>ship-session-jev:ship-session-jev</command-message>
<command-name>/ship-session-jev:ship-session-jev</command-name>
<command-args>$REQUEST_TEXT</command-args>"
check "展開済みの形（command-name / command-args）でも張る" "$(state_field phase)" "active"
check "展開済みの形でも state は command-args の中身" "$(last_request_body_field state)" "$REQUEST_TEXT"
setup; set_mode "answer:up_to_pr:0.60"
run_prompt "/ship-session-jev:ship-session-jev $REQUEST_TEXT"
check "低 confidence なら pending" "$(state_field phase)" "pending"
CTX="$(prompt_context)"
printf '%s' "$CTX" | grep -q "Jev did not decide the goal (low_confidence)" && ok "additionalContext が決めなかった理由を伝える" || ng "additionalContext が決めなかった理由を伝える ($CTX)"
printf '%s' "$CTX" | grep -q "header: Goal" && ok "additionalContext が header: Goal で聞くよう案内する" || ng "additionalContext が header: Goal で聞くよう案内する"
run_pre "Bash" '{"command":"ls"}'; check "pending なので Bash はブロック" "$?" "2"
arm_with "$REQUEST_TEXT"
check "pending で Jev を試みた後の Skill invoke では呼び直さない" "$(request_count)" "1"
check "その状態は pending のまま" "$(state_field phase)" "pending"
check "Jev の判定要約も残る" "$(state_field jev.reason)" "low_confidence"
setup; set_mode "answer:up_to_pr:0.93"
run_prompt "/ship-session-jev:ship-session-jev"
check "引数の無いスラッシュコマンドは pending" "$(state_field phase)" "pending"
check "引数が無ければリクエストを出さない" "$(request_count)" "0"
check "理由は no_args" "$(state_field jev.reason)" "no_args"
printf '%s' "$(prompt_context)" | grep -q "did not decide the goal (no_args)" && ok "additionalContext が no_args を伝える" || ng "additionalContext が no_args を伝える"
setup; set_mode "answer:up_to_pr:0.93"
run_prompt "/ship-session-jev:ship-session-jev $REQUEST_TEXT" TYPESAFE_API_KEY=
check "キーが無くてもスラッシュコマンドでゲートは張る" "$(state_field phase)" "pending"
printf '%s' "$(prompt_context)" | grep -q "did not decide the goal (no_api_key)" && ok "additionalContext がキー無しを伝える" || ng "additionalContext がキー無しを伝える"
setup
run_prompt "please add dark mode, up to PR"
check "普通の発話では hook は 0" "$?" "0"
[ ! -f "$(STATE_FILE)" ] && ok "普通の発話ではゲートを張らない" || ng "普通の発話ではゲートを張らない"
[ -z "$(prompt_context)" ] && ok "普通の発話では何も出さない" || ng "普通の発話では何も出さない"
check "普通の発話ではリクエストを出さない" "$(request_count)" "0"
setup
run_prompt "/ship-session:ship-session $REQUEST_TEXT"
[ ! -f "$(STATE_FILE)" ] && ok "元の /ship-session:ship-session では張らない" || ng "元の /ship-session:ship-session では張らない"
check "元のコマンドではリクエストを出さない" "$(request_count)" "0"
setup
run_prompt "/ship-session-jev-other $REQUEST_TEXT"
[ ! -f "$(STATE_FILE)" ] && ok "前方一致だけの別コマンドでは張らない" || ng "前方一致だけの別コマンドでは張らない"
setup
run_prompt "What does this hook log mean? <command-name>/ship-session-jev:ship-session-jev</command-name> <command-args>x</command-args>"
[ ! -f "$(STATE_FILE)" ] && ok "文中に展開済みの形が現れただけでは張らない（先頭で照合）" || ng "文中に展開済みの形が現れただけでは張らない（先頭で照合）"
check "文中に現れただけではリクエストを出さない" "$(request_count)" "0"
setup; set_mode "answer:up_to_pr:0.93"
run_prompt "   /ship-session-jev:ship-session-jev $REQUEST_TEXT"
check "先頭の空白は無視して張る" "$(state_field phase)" "active"
setup; set_mode "answer:up_to_pr:0.93"
run_prompt "/ship-session-jev:ship-session-jev
$REQUEST_TEXT"
check "コマンドの後ろが改行でも張る" "$(state_field phase)" "active"
check "改行の後ろの文が state になる" "$(last_request_body_field state)" "$REQUEST_TEXT"
setup; set_mode "answer:up_to_pr:0.93"
run_prompt "<command-name>/ship-session-jev</command-name>
<command-args>$REQUEST_TEXT</command-args>"
check "展開済みの短い形（command-message 無し）でも張る" "$(state_field phase)" "active"
setup; set_mode "answer:up_to_pr:0.93"
run_prompt "<command-message>ship-session-jev:ship-session-jev</command-message>
<command-name>/ship-session-jev:ship-session-jev</command-name>"
check "展開済みで command-args が無ければ引数無し（pending）" "$(state_field phase)" "pending"
check "その理由は no_args" "$(state_field jev.reason)" "no_args"
# pid が再利用された別セッションの残骸があっても、新しいセッションは自分の判定で張り直す
setup; set_mode "answer:up_to_pr:0.93"
mkdir -p "$SANDBOX/.claude/cache/ship-gate-jev"
printf '{"phase":"active","goal":"Up to merge","session_id":"s-stale","jev":{"result":"recorded","args_digest":"x"}}' > "$(STATE_FILE)"
run_prompt "/ship-session-jev:ship-session-jev $REQUEST_TEXT"
check "別セッションの残骸は上書きされる" "$(state_field session_id)" "$SID"
check "残骸の到達点を引き継がない" "$(state_field goal)" "Up to PR"

echo
echo "言い直しは分類し直す（ユーザーの入力だけ）"
setup; set_mode "answer:unspecified:0.9"
run_prompt "/ship-session-jev:ship-session-jev add dark mode"
check "到達点が書かれていない → pending" "$(state_field jev.reason)" "unspecified"
set_mode "answer:up_to_pr:0.93"
run_prompt "/ship-session-jev:ship-session-jev add dark mode"
check "同じ文を打ち直しても呼び直さない" "$(request_count)" "1"
printf '%s' "$(prompt_context)" | grep -q "did not decide the goal (unspecified)" && ok "同じ文の打ち直しでも前回の判定を伝える" || ng "同じ文の打ち直しでも前回の判定を伝える"
run_prompt "/ship-session-jev:ship-session-jev add dark mode, up to PR"
check "違う文で打ち直したら分類し直す" "$(request_count)" "2"
check "言い直しで active になる" "$(state_field phase)" "active"
check "言い直しの到達点が goal になる" "$(state_field goal)" "Up to PR"
printf '%s' "$(prompt_context)" | grep -q "Jev classified this request as goal: Up to PR" && ok "言い直しの結果も additionalContext で伝える" || ng "言い直しの結果も additionalContext で伝える"
setup; set_mode "answer:unspecified:0.9"
run_prompt "/ship-session-jev:ship-session-jev add dark mode"
set_mode "answer:up_to_pr:0.93"
arm_with "add dark mode, up to PR"
check "Skill ツール経由（エージェントの言い換え）では分類し直さない" "$(request_count)" "1"
check "その状態は pending のまま" "$(state_field phase)" "pending"
setup; set_mode "answer:unspecified:0.9"
run_prompt "/ship-session-jev:ship-session-jev add dark mode"
run_prompt "/ship-session-jev:ship-session-jev"
check "引数の無い打ち直しでは呼び直さない" "$(request_count)" "1"
check "状態ファイルに依頼文の指紋だけが残る（本文は残らない）" "$(grep -c "add dark mode" "$(STATE_FILE)")" "0"
[ -n "$(state_field jev.args_digest)" ] && ok "args_digest がある" || ng "args_digest がある"
# 空白の違いは同じ文（Skill 経由の末尾改行と、スラッシュコマンドの strip 済みの文）
setup; set_mode "answer:up_to_pr:0.60"
arm_with "add dark mode
"
run_goal record "Up to PR"
run_prompt "/ship-session-jev:ship-session-jev add   dark mode"
check "空白・改行だけが違う文は同じ文として扱う（呼び直さない）" "$(request_count)" "1"
check "同じ文なので goal を消さない" "$(state_field goal)" "Up to PR"
# 古い版が書いた指紋の無い要約は「同じ文」扱い（合意を消さない）
setup; set_mode "answer:up_to_pr:0.93"
mkdir -p "$SANDBOX/.claude/cache/ship-gate-jev"
printf '{"phase":"active","goal":"Up to PR","session_id":"%s","jev":{"result":"skipped","reason":"no_api_key"}}' "$SID" > "$(STATE_FILE)"
run_prompt "/ship-session-jev:ship-session-jev $REQUEST_TEXT"
check "指紋の無い古い状態では張り直さない" "$(state_field goal)" "Up to PR"
check "指紋の無い古い状態では Jev を呼ばない" "$(request_count)" "0"
# ゲートを張る前に record しただけの状態（session_id 無し）は、Skill invoke で消さない
setup; set_mode "answer:unspecified:0.9"
run_goal record "Up to PR"
check "先に record した状態には session_id が無い" "$(state_field session_id)" ""
arm_with "$REQUEST_TEXT"
check "先に record した到達点を Skill invoke で消さない" "$(state_field goal)" "Up to PR"
check "その場合 Jev も呼ばない" "$(request_count)" "0"
run_prompt "/ship-session-jev:ship-session-jev $REQUEST_TEXT"
check "record だけの状態に依頼文付きのコマンドが来たら、その文を分類する" "$(request_count)" "1"
check "（unspecified なので pending に戻る）" "$(state_field phase)" "pending"
# 依頼文の無いコマンドが前の依頼の active に来たら、続きか次かは分からない旨を伝える
setup; set_mode "answer:issue_only:0.95"
run_prompt "/ship-session-jev:ship-session-jev remove the legacy API, issue only"
run_prompt "/ship-session-jev:ship-session-jev"
check "依頼文の無いコマンドでは張り直さない" "$(state_field goal)" "Issue only"
printf '%s' "$(prompt_context)" | grep -q "from an earlier request: Issue only" && ok "前の依頼の到達点であることを伝える" || ng "前の依頼の到達点であることを伝える ($(prompt_context))"
printf '%s' "$(prompt_context)" | grep -q "header: Goal" && ok "新しい依頼なら到達点を決め直すよう案内する" || ng "新しい依頼なら到達点を決め直すよう案内する"
setup
printf 'not json' | env HOME="$SANDBOX" CLAUDE_CODE_MESSAGING_SOCKET="$SOCK" TYPESAFE_API_KEY="$DUMMY_KEY" "$GATE" > "$SANDBOX/out" 2>&1
check "壊れた UserPromptSubmit 入力でも 0" "$?" "0"
printf '{"hook_event_name":"UserPromptSubmit","session_id":"%s"}' "$SID" | env HOME="$SANDBOX" CLAUDE_CODE_MESSAGING_SOCKET="$SOCK" TYPESAFE_API_KEY="$DUMMY_KEY" "$GATE" > "$SANDBOX/out" 2>&1
check "prompt が無い UserPromptSubmit でも 0" "$?" "0"

echo
echo "4 つの到達点がそれぞれ正準ラベルに写る"
for pair in "issue_only|Issue only" "implementation|Implementation only (no PR)" "up_to_pr|Up to PR" "up_to_merge|Up to merge"; do
  choice="${pair%%|*}"; label="${pair#*|}"
  setup; set_mode "answer:$choice:0.9"
  arm_with "$REQUEST_TEXT"
  check "$choice → $label" "$(state_field goal)" "$label"
done

echo
echo "リクエストの形（公式 API リファレンス準拠）"
setup; set_mode "answer:up_to_pr:0.93"
arm_with "$REQUEST_TEXT"
check "Authorization: Bearer <キー> が付く" "$(last_request auth_matches)" "True"
check "Content-Type は application/json" "$(last_request content_type)" "application/json"
check "model は jev-latest" "$(last_request_body_field model)" "jev-latest"
check "state は args そのもの" "$(last_request_body_field state)" "$REQUEST_TEXT"
check "questions.goal.type は choice" "$(last_request_body_field questions.goal.type)" "choice"
CRITERIA="$(python3 -c 'import json,sys
lines=[l for l in open(sys.argv[1]) if l.strip()]
body=json.loads(json.loads(lines[-1])["body"])
print(",".join(sorted(body["questions"]["goal"]["criteria"].keys())))' "$CTRL/requests.log")"
check "criteria は 4 ゴール + unspecified" "$CRITERIA" "implementation,issue_only,unspecified,up_to_merge,up_to_pr"
check "instructions は README に書いた文そのもの" "$(last_request_body_field questions.goal.instructions)" "How far does the user explicitly ask this task to be taken? Pick unspecified when the message does not state how far to go."
check "criteria の説明も README と同じ（unspecified）" "$(last_request_body_field questions.goal.criteria.unspecified)" "The message does not say how far to go"
check "criteria の説明も README と同じ（up_to_pr）" "$(last_request_body_field questions.goal.criteria.up_to_pr)" "Implement and open a (draft) pull request; do not merge"
JA_TEXT="設定にダークモードの切替を足して。PR まで。"
setup; set_mode "answer:up_to_pr:0.93"
arm_with "$JA_TEXT"
check "日本語の依頼文も state にそのまま入る（UTF-8 / Content-Length）" "$(last_request_body_field state)" "$JA_TEXT"
check "日本語の依頼文でも active" "$(state_field phase)" "active"
setup
arm_with "   "
check "空白だけの args は no_args" "$(state_field jev.reason)" "no_args"
check "空白だけの args ではリクエストを出さない" "$(request_count)" "0"

echo
echo "確信が足りない / 到達点が書かれていないときは pending に倒れる"
setup; set_mode "answer:up_to_pr:0.60"
arm_with "$REQUEST_TEXT"
check "hook は 0 で返る" "$?" "0"
check "低 confidence は pending" "$(state_field phase)" "pending"
check "状態に low_confidence の理由が残る" "$(state_field jev.reason)" "low_confidence"
run_pre "Bash" '{"command":"ls"}'; check "pending なので Bash はブロック" "$?" "2"
grep -q 'Jev did not decide the goal for this request (run `"'"$GOAL"'" status` to see why)' "$SANDBOX/err" && ok "ブロック文が status で理由を見るよう案内する" || ng "ブロック文が status で理由を見るよう案内する"
grep -q "The goal is not decided yet" "$SANDBOX/err" && ok "ブロック文が到達点未決定を告げる" || ng "ブロック文が到達点未決定を告げる"
run_goal status
grep -q "^goal: not decided yet" "$SANDBOX/out" && ok "status は未決定" || ng "status は未決定"
grep -q "jev: could not decide (low_confidence, up_to_pr, confidence 0.60)" "$SANDBOX/out" && ok "status が Jev の理由を出す" || ng "status が Jev の理由を出す ($(cat "$SANDBOX/out"))"
grep -q "result=fallback reason=low_confidence choice=up_to_pr confidence=0.60" "$(LOG_FILE)" && ok "ログに fallback の理由が残る" || ng "ログに fallback の理由が残る"
setup; set_mode "answer:up_to_pr:0.85"
arm_with "$REQUEST_TEXT"
check "しきい値ちょうど（0.85）は通る" "$(state_field phase)" "active"
setup; set_mode "answer:unspecified:0.97"
arm_with "$REQUEST_TEXT"
check "unspecified が最有力なら確信が高くても pending" "$(state_field phase)" "pending"
check "状態に unspecified の理由が残る" "$(state_field jev.reason)" "unspecified"
setup; set_mode "answer:up_to_pr:0.60"
arm_with "$REQUEST_TEXT" SHIP_JEV_THRESHOLD=0.5
check "SHIP_JEV_THRESHOLD=0.5 なら 0.60 で active" "$(state_field phase)" "active"
setup
arm_with "$REQUEST_TEXT" SHIP_JEV_THRESHOLD=abc
check "解釈できないしきい値は既定（0.85）に戻る" "$(state_field phase)" "pending"
setup
arm_with "$REQUEST_TEXT" SHIP_JEV_THRESHOLD=1.5
check "0〜1 の外のしきい値は既定に戻る" "$(state_field phase)" "pending"

echo
echo "pending に倒れた後は従来の経路で開く"
setup; set_mode "answer:up_to_pr:0.60"
arm_with "$REQUEST_TEXT"
Q='{"questions":[{"question":"How far should I take this?","header":"Goal","options":[],"multiSelect":false}]}'
printf '{"hook_event_name":"PostToolUse","session_id":"%s","tool_name":"AskUserQuestion","tool_input":%s,"tool_response":%s}' \
  "$SID" "$Q" '{"answers":{"How far should I take this?":"Up to merge"}}' \
  | env HOME="$SANDBOX" CLAUDE_CODE_MESSAGING_SOCKET="$SOCK" "$GATE" > "$SANDBOX/out" 2> "$SANDBOX/err"
check "AskUserQuestion の回答で active になる" "$(state_field phase)" "active"
check "回答が goal になる" "$(state_field goal)" "Up to merge"
check "Jev の判定要約は残る" "$(state_field jev.reason)" "low_confidence"
# Jev が開けたゲートの上で到達点の質問がされたら、その回答が Jev の判定を上書きする
setup; set_mode "answer:up_to_pr:0.93"
arm_with "$REQUEST_TEXT"
check "Jev で active" "$(state_field goal)" "Up to PR"
printf '{"hook_event_name":"PostToolUse","session_id":"%s","tool_name":"AskUserQuestion","tool_input":%s,"tool_response":%s}' \
  "$SID" "$Q" '{"answers":{"How far should I take this?":"Issue only"}}' \
  | env HOME="$SANDBOX" CLAUDE_CODE_MESSAGING_SOCKET="$SOCK" "$GATE" > "$SANDBOX/out" 2> "$SANDBOX/err"
check "active 中でも Goal の回答は goal を上書きする" "$(state_field goal)" "Issue only"
run_goal status
grep -q "jev: decided Up to PR but the goal was changed afterwards" "$SANDBOX/out" && ok "status が Jev の判定が上書きされた旨を出す" || ng "status が Jev の判定が上書きされた旨を出す"
QC='{"questions":[{"question":"Color?","header":"配色","options":[],"multiSelect":false}]}'
printf '{"hook_event_name":"PostToolUse","session_id":"%s","tool_name":"AskUserQuestion","tool_input":%s,"tool_response":%s}' \
  "$SID" "$QC" '{"answers":{"Color?":"blue"}}' \
  | env HOME="$SANDBOX" CLAUDE_CODE_MESSAGING_SOCKET="$SOCK" "$GATE" > "$SANDBOX/out" 2> "$SANDBOX/err"
check "active 中の無関係な質問の回答では goal を変えない" "$(state_field goal)" "Issue only"
QA='{"questions":[{"question":"Which theming approach?","header":"Approach","options":[],"multiSelect":false}]}'
printf '{"hook_event_name":"PostToolUse","session_id":"%s","tool_name":"AskUserQuestion","tool_input":%s,"tool_response":%s}' \
  "$SID" "$QA" '{"answers":{"Which theming approach?":"CSS variables"}}' \
  | env HOME="$SANDBOX" CLAUDE_CODE_MESSAGING_SOCKET="$SOCK" "$GATE" > "$SANDBOX/out" 2> "$SANDBOX/err"
check "active 中は Approach（設計の質問にも使う見出し）の回答で goal を変えない" "$(state_field goal)" "Issue only"
QJ='{"questions":[{"question":"どこまで？","header":"到達点","options":[],"multiSelect":false}]}'
printf '{"hook_event_name":"PostToolUse","session_id":"%s","tool_name":"AskUserQuestion","tool_input":%s,"tool_response":%s}' \
  "$SID" "$QJ" '{"answers":{"どこまで？":"マージまで"}}' \
  | env HOME="$SANDBOX" CLAUDE_CODE_MESSAGING_SOCKET="$SOCK" "$GATE" > "$SANDBOX/out" 2> "$SANDBOX/err"
check "active 中でも 到達点 の回答は goal を上書きする" "$(state_field goal)" "マージまで"
setup; set_mode "answer:up_to_pr:0.60"
arm_with "$REQUEST_TEXT"
printf '{"hook_event_name":"PostToolUse","session_id":"%s","tool_name":"AskUserQuestion","tool_input":%s,"tool_response":%s}' \
  "$SID" "$QA" '{"answers":{"Which theming approach?":"Investigate and answer only"}}' \
  | env HOME="$SANDBOX" CLAUDE_CODE_MESSAGING_SOCKET="$SOCK" "$GATE" > "$SANDBOX/out" 2> "$SANDBOX/err"
check "pending 中は Approach の回答で開く（元のゲートと同じ）" "$(state_field goal)" "Investigate and answer only"
run_goal record $'​'
check "ゼロ幅スペースだけの record は拒否" "$?" "1"
printf '{"hook_event_name":"PostToolUse","session_id":"%s","tool_name":"AskUserQuestion","tool_input":%s,"tool_response":%s}' \
  "s-someone-else" "$Q" '{"answers":{"How far should I take this?":"Up to merge"}}' \
  | env HOME="$SANDBOX" CLAUDE_CODE_MESSAGING_SOCKET="$SOCK" "$GATE" > "$SANDBOX/out" 2> "$SANDBOX/err"
check "別セッションの回答では goal を変えない" "$(state_field goal)" "Investigate and answer only"
run_goal record "   "
check "空白だけの record は拒否（exit 1）" "$?" "1"
check "空白だけの record では goal が変わらない" "$(state_field goal)" "Investigate and answer only"
setup; set_mode "answer:up_to_pr:0.60"
arm_with "$REQUEST_TEXT"
run_goal record "PR まで"
check "record でも active になる" "$(state_field phase)" "active"
check "record の値が goal になる" "$(state_field goal)" "PR まで"

echo
echo "API の失敗はすべて pending（hook は 0 で返る）"
for code in 401 422 429 500 529; do
  setup; set_mode "status:$code"
  arm_with "$REQUEST_TEXT"
  check "HTTP $code で hook は 0" "$?" "0"
  check "HTTP $code は pending" "$(state_field phase)" "pending"
  check "HTTP $code の理由が残る" "$(state_field jev.reason)" "http_$code"
done
grep -q "reason=http_529" "$(LOG_FILE)" && ok "ログに http_<code> が残る" || ng "ログに http_<code> が残る"
run_goal status
grep -q "^jev: could not decide (http_529)$" "$SANDBOX/out" && ok "status: choice の無い fallback は理由だけ出す" || ng "status: choice の無い fallback は理由だけ出す ($(cat "$SANDBOX/out"))"
setup; set_mode 'json:{"answers":{"goal":{"type":"choice","choice":null,"confidence":0.99,"probabilities":{}}}}'
arm_with "$REQUEST_TEXT"
check "choice が null なら pending" "$(state_field jev.reason)" "bad_response:choice_not_string"
setup; set_mode 'json:{"answers":{"goal":{"type":"choice","choice":"up_to_pr","confidence":null,"probabilities":{}}}}'
arm_with "$REQUEST_TEXT"
check "confidence が null なら pending" "$(state_field jev.reason)" "bad_response:confidence_not_number"
setup; set_mode 'json:{"answers":"nope"}'
arm_with "$REQUEST_TEXT"
check "answers が dict でなければ pending" "$(state_field jev.reason)" "bad_response:no_answer"
setup; set_mode 'json:{"answers":{"goal":"up_to_pr"}}'
arm_with "$REQUEST_TEXT"
check "answers.goal が dict でなければ pending" "$(state_field jev.reason)" "bad_response:no_answer"
# Jev 内部で想定外の例外が起きても、ゲートは pending で張られる（張られないのが最悪）
INTERNAL="$(python3 -c 'import sys; sys.path.insert(0, sys.argv[1]); import jev
def boom(*a, **k): raise RuntimeError("boom")
jev.settings = boom
o = jev.classify("x", pid="t")
print(o.get("result"), o.get("reason"))' "$ROOT/hooks")"
check "classify は内部例外を fallback/error に変える" "$INTERNAL" "fallback error"
ALLOWED="$(python3 -c 'import sys; sys.path.insert(0, sys.argv[1]); import jev
urls = ["https://api.typesafe.ai/v1/systemone", "http://127.0.0.1:8/x", "http://localhost:8/x", "http://[::1]:8/x", "http://example.com/x", "https:///x", "ftp://127.0.0.1/x", "", "not a url", None]
print(",".join("1" if jev.endpoint_allowed(u) else "0" for u in urls))' "$ROOT/hooks")"
check "endpoint_allowed: https / ループバックの http だけ通す" "$ALLOWED" "1,1,1,1,0,0,0,0,0,0"
setup; set_mode "raw:this is not json"
arm_with "$REQUEST_TEXT"
check "JSON でない本文は pending" "$(state_field phase)" "pending"
check "理由は bad_response:not_json" "$(state_field jev.reason)" "bad_response:not_json"
setup; set_mode 'json:{"model":"jev","answers":{}}'
arm_with "$REQUEST_TEXT"
check "answers.goal が無ければ pending" "$(state_field phase)" "pending"
check "理由は bad_response:no_answer" "$(state_field jev.reason)" "bad_response:no_answer"
setup; set_mode 'json:{"answers":{"goal":{"type":"choice","choice":"ship_it","confidence":0.99,"probabilities":{}}}}'
arm_with "$REQUEST_TEXT"
check "criteria に無い choice は pending" "$(state_field phase)" "pending"
check "理由は bad_response:unknown_choice" "$(state_field jev.reason)" "bad_response:unknown_choice"
setup; set_mode 'json:{"answers":{"goal":{"type":"choice","choice":"up_to_pr","confidence":"high","probabilities":{}}}}'
arm_with "$REQUEST_TEXT"
check "confidence が数値でなければ pending" "$(state_field phase)" "pending"
check "理由は bad_response:confidence_not_number" "$(state_field jev.reason)" "bad_response:confidence_not_number"
setup; set_mode 'json:{"answers":{"goal":{"type":"choice","choice":"up_to_pr","confidence":true,"probabilities":{}}}}'
arm_with "$REQUEST_TEXT"
check "confidence が真偽値でも pending" "$(state_field phase)" "pending"
for bad in NaN Infinity -Infinity 93 -0.1 1.0001; do
  setup; set_mode "json:{\"answers\":{\"goal\":{\"type\":\"choice\",\"choice\":\"up_to_merge\",\"confidence\":$bad,\"probabilities\":{}}}}"
  arm_with "$REQUEST_TEXT"
  check "confidence=$bad は pending（NaN は比較をすり抜けるので明示的に弾く）" "$(state_field phase)" "pending"
  check "confidence=$bad の理由は confidence_out_of_range" "$(state_field jev.reason)" "bad_response:confidence_out_of_range"
done
setup; set_mode 'json:{"answers":{"goal":{"type":"choice","choice":"up_to_pr","confidence":1,"probabilities":{}}}}'
arm_with "$REQUEST_TEXT"
check "confidence が整数 1 なら active（境界）" "$(state_field phase)" "active"
setup; set_mode 'json:{"answers":{"goal":{"type":"choice","choice":"up_to_pr","confidence":0,"probabilities":{}}}}'
arm_with "$REQUEST_TEXT"
check "confidence が 0 なら pending（境界）" "$(state_field jev.reason)" "low_confidence"
setup; set_mode 'json:{"answers":{"goal":{"type":"choice","choice":["up_to_pr"],"confidence":0.99,"probabilities":{}}}}'
arm_with "$REQUEST_TEXT"
check "choice が文字列でなければ pending" "$(state_field phase)" "pending"
setup; set_mode 'json:[1,2,3]'
arm_with "$REQUEST_TEXT"
check "本文が配列でも pending" "$(state_field phase)" "pending"
setup; set_mode "answer:up_to_pr:0.99"
arm_with "$REQUEST_TEXT" SHIP_JEV_ENDPOINT="http://127.0.0.1:1/v1/systemone"
check "接続先が閉じていても hook は 0" "$?" "0"
check "接続失敗は pending" "$(state_field phase)" "pending"
check "理由は connection_error" "$(state_field jev.reason)" "connection_error"
setup
arm_with "$REQUEST_TEXT" SHIP_JEV_ENDPOINT="not a url"
check "壊れたエンドポイントでも hook は 0" "$?" "0"
check "壊れたエンドポイントは pending" "$(state_field phase)" "pending"
check "壊れたエンドポイントには送らない" "$(state_field jev.reason)" "insecure_endpoint"

echo
echo "キーを送ってよい先を絞る"
setup; set_mode "answer:up_to_pr:0.99"
arm_with "$REQUEST_TEXT" SHIP_JEV_ENDPOINT="http://example.invalid/v1/systemone"
check "http:// の非ループバック先には送らない（キーを平文で流さない）" "$(state_field jev.reason)" "insecure_endpoint"
check "http:// の非ループバック先でも pending" "$(state_field phase)" "pending"
check "http:// の非ループバック先へのリクエストは 0" "$(request_count)" "0"
setup
arm_with "$REQUEST_TEXT" SHIP_JEV_ENDPOINT="ftp://127.0.0.1/v1/systemone"
check "https / http 以外のスキームには送らない" "$(state_field jev.reason)" "insecure_endpoint"
setup; set_mode "redirect:http://127.0.0.1:$(cat "$CTRL/port")/elsewhere"
arm_with "$REQUEST_TEXT"
check "302 は追わず pending" "$(state_field phase)" "pending"
check "302 の理由は http_302" "$(state_field jev.reason)" "http_302"
check "リダイレクト先には送らない（リクエストは 1 回だけ）" "$(request_count)" "1"
# http（ループバック）はプロキシに通さない。通すと Authorization が平文でプロキシへ行く
setup; set_mode "answer:up_to_pr:0.93"
arm_with "$REQUEST_TEXT" http_proxy="http://127.0.0.1:1" HTTP_PROXY="http://127.0.0.1:1"
check "http_proxy があってもループバックの http は直接届く" "$(request_count)" "1"
check "http_proxy があっても active になる" "$(state_field phase)" "active"
PROXIES="$(env https_proxy="http://proxy.invalid:3128" http_proxy="http://proxy.invalid:3128" python3 -c 'import sys, urllib.request; sys.path.insert(0, sys.argv[1]); import jev
def proxies(url):
    return sorted(k for h in jev.build_opener(url).handlers if isinstance(h, urllib.request.ProxyHandler) for k in h.proxies)
print(",".join(proxies("https://api.typesafe.ai/v1/systemone")) + "|" + ",".join(proxies("http://127.0.0.1:1/v1/systemone")))' "$ROOT/hooks")"
check "https は環境変数のプロキシを使い、http（ループバック）は使わない" "$PROXIES" "http,https|"

echo
echo "タイムアウトは壁時計で効く"
setup; set_mode "sleep:3"
ELAPSED_MS="$(printf '{"hook_event_name":"PreToolUse","session_id":"%s","tool_name":"Skill","tool_input":{"skill":"ship-session-jev:ship-session-jev","args":"%s"}}' "$SID" "$REQUEST_TEXT" \
  | env HOME="$SANDBOX" CLAUDE_CODE_MESSAGING_SOCKET="$SOCK" TYPESAFE_API_KEY="$DUMMY_KEY" SHIP_JEV_ENDPOINT="$ENDPOINT" \
    python3 -c 'import subprocess,sys,time
t=time.monotonic()
r=subprocess.run([sys.argv[1]], stdin=sys.stdin, capture_output=True)
print(int((time.monotonic()-t)*1000))
sys.exit(r.returncode)' "$GATE")"
check "タイムアウトでも hook は 0" "$?" "0"
[ "$ELAPSED_MS" -lt 2000 ] && ok "サーバーが 3 秒黙っても 2 秒以内に返る（${ELAPSED_MS}ms）" || ng "サーバーが 3 秒黙っても 2 秒以内に返る（${ELAPSED_MS}ms）"
check "タイムアウトは pending" "$(state_field phase)" "pending"
check "理由は timeout" "$(state_field jev.reason)" "timeout"
setup; set_mode "sleep:0.5"
arm_with "$REQUEST_TEXT" SHIP_JEV_TIMEOUT_MS=100
check "SHIP_JEV_TIMEOUT_MS=100 なら 0.5 秒の応答を待たない" "$(state_field jev.reason)" "timeout"
# ソケットの timeout（壁時計の 2 倍）では切れない応答 —— 0.3 秒おきに 1 バイト届く ——
# を、壁時計の join だけが打ち切れることを見る。同期実装に退化すると 3 秒待ってしまう
setup; set_mode "drip:3"
ELAPSED_MS="$(printf '{"hook_event_name":"PreToolUse","session_id":"%s","tool_name":"Skill","tool_input":{"skill":"ship-session-jev:ship-session-jev","args":"%s"}}' "$SID" "$REQUEST_TEXT" \
  | env HOME="$SANDBOX" CLAUDE_CODE_MESSAGING_SOCKET="$SOCK" TYPESAFE_API_KEY="$DUMMY_KEY" SHIP_JEV_ENDPOINT="$ENDPOINT" SHIP_JEV_TIMEOUT_MS=300 \
    python3 -c 'import subprocess,sys,time
t=time.monotonic()
r=subprocess.run([sys.argv[1]], stdin=sys.stdin, capture_output=True)
print(int((time.monotonic()-t)*1000))
sys.exit(r.returncode)' "$GATE")"
check "少しずつ届く応答でも hook は 0" "$?" "0"
[ "$ELAPSED_MS" -lt 2000 ] && ok "0.3 秒おきに届く 3 秒の応答を、壁時計 300ms で打ち切る（${ELAPSED_MS}ms）" || ng "0.3 秒おきに届く 3 秒の応答を、壁時計 300ms で打ち切る（${ELAPSED_MS}ms）"
check "打ち切りの理由は timeout" "$(state_field jev.reason)" "timeout"
# 既定値への戻りと上限は時間に依存させず、関数で見る
PARSED="$(python3 -c 'import sys; sys.path.insert(0, sys.argv[1]); import jev
print(",".join(str(jev.parse_timeout_ms(v)) for v in ("abc", "0", "-5", "", None, "250", "60000")))' "$ROOT/hooks")"
check "解釈できない / 0 以下は既定 800、上限 5000 で頭打ち（250 はそのまま）" "$PARSED" "800,800,800,800,800,250,5000"
PARSED="$(python3 -c 'import sys; sys.path.insert(0, sys.argv[1]); import jev
print(",".join(str(jev.parse_threshold(v)) for v in ("abc", "1.5", "-0.1", "nan", "inf", "", "0.5", "1", "0")))' "$ROOT/hooks")"
check "解釈できない / 0〜1 の外 / NaN のしきい値は既定 0.85 に戻る" "$PARSED" "0.85,0.85,0.85,0.85,0.85,0.85,0.5,1.0,0.0"

echo
echo "秘密と依頼文を漏らさない"
setup; set_mode "answer:up_to_pr:0.93"
arm_with "$REQUEST_TEXT"
# hook の stdout / stderr は **その直後に** 見る（後で別のコマンドが out/err を上書きする）
check "PreToolUse（張る）の stdout は空（Claude Code が JSON として読むので何も出さない）" "$(wc -c < "$SANDBOX/out" | tr -d ' ')" "0"
check "PreToolUse（張る）の stderr にキーの値が無い" "$(grep -c "$DUMMY_KEY" "$SANDBOX/err")" "0"
check "PreToolUse（張る）の stderr に依頼文が無い" "$(grep -c "ZZZREQUESTTEXT" "$SANDBOX/err")" "0"
check "ログにキーの値が無い" "$(grep -c "$DUMMY_KEY" "$(LOG_FILE)")" "0"
check "ログに依頼文が無い" "$(grep -c "ZZZREQUESTTEXT" "$(LOG_FILE)")" "0"
check "状態ファイルにキーの値が無い" "$(grep -c "$DUMMY_KEY" "$(STATE_FILE)")" "0"
check "状態ファイルに依頼文が無い" "$(grep -c "ZZZREQUESTTEXT" "$(STATE_FILE)")" "0"
check "モックの記録にキーの値が無い（一致フラグだけ）" "$(grep -c "$DUMMY_KEY" "$CTRL/requests.log")" "0"
run_goal status
check "status の出力にキーの値が無い" "$(cat "$SANDBOX/out" "$SANDBOX/err" | grep -c "$DUMMY_KEY")" "0"
check "status の出力に依頼文が無い" "$(cat "$SANDBOX/out" "$SANDBOX/err" | grep -c "ZZZREQUESTTEXT")" "0"
setup; set_mode "answer:up_to_pr:0.60"
arm_with "$REQUEST_TEXT"
run_pre "Bash" '{"command":"ls"}'
check "ブロック文（stderr）にキーの値が無い" "$(grep -c "$DUMMY_KEY" "$SANDBOX/err")" "0"
check "ブロック文（stderr）に依頼文が無い" "$(grep -c "ZZZREQUESTTEXT" "$SANDBOX/err")" "0"
check "ブロック時も stdout は空" "$(wc -c < "$SANDBOX/out" | tr -d ' ')" "0"
setup; set_mode "answer:up_to_pr:0.93"
run_prompt "/ship-session-jev:ship-session-jev $REQUEST_TEXT"
check "UserPromptSubmit の stdout にキーの値が無い" "$(grep -c "$DUMMY_KEY" "$SANDBOX/out")" "0"
check "UserPromptSubmit の stdout に依頼文が無い" "$(grep -c "ZZZREQUESTTEXT" "$SANDBOX/out")" "0"
check "UserPromptSubmit の stderr は空" "$(wc -c < "$SANDBOX/err" | tr -d ' ')" "0"

echo
echo "jev.py は標準ライブラリだけを使う"
IMPORTS="$(grep -E '^(import|from) ' "$ROOT/hooks/jev.py" | awk '{print $2}' | cut -d. -f1 | sort -u | tr '\n' ',')"
check "import 一覧" "$IMPORTS" "json,math,os,socket,threading,time,urllib,"

echo
echo "フェイルオープン（Jev が壊れていてもゲートは素通し）"
setup
printf 'not json' | env HOME="$SANDBOX" CLAUDE_CODE_MESSAGING_SOCKET="$SOCK" TYPESAFE_API_KEY="$DUMMY_KEY" "$GATE" >/dev/null 2>&1
check "壊れた入力では素通し" "$?" "0"
setup
mkdir -p "$SANDBOX/.claude/cache/ship-gate-jev"
printf 'not json' > "$(STATE_FILE)"
run_pre "Bash" '{"command":"ls"}'; check "壊れた状態ファイルでは素通し" "$?" "0"
# jev.py が壊れていても（読み込めなくても）ゲートは従来どおり pending で張る
BROKEN="$(mktemp -d)"
cp "$GATE" "$ROOT/hooks/ship-goal.sh" "$ROOT/hooks/rename-session.sh" "$BROKEN/"
printf 'raise SyntaxError("broken on purpose"\n' > "$BROKEN/jev.py"
setup; set_mode "answer:up_to_pr:0.93"
printf '{"hook_event_name":"PreToolUse","session_id":"%s","tool_name":"Skill","tool_input":{"skill":"ship-session-jev:ship-session-jev","args":"%s"}}' "$SID" "$REQUEST_TEXT" \
  | env HOME="$SANDBOX" CLAUDE_CODE_MESSAGING_SOCKET="$SOCK" TYPESAFE_API_KEY="$DUMMY_KEY" SHIP_JEV_ENDPOINT="$ENDPOINT" \
    python3 "$BROKEN/ship-gate.py" > "$SANDBOX/out" 2> "$SANDBOX/err"
check "jev.py が壊れていても hook は 0" "$?" "0"
check "jev.py が壊れていても pending で張る" "$(state_field phase)" "pending"
check "理由は error" "$(state_field jev.reason)" "error"
check "jev.py が壊れていればリクエストは出ない" "$(request_count)" "0"
check "壊れていても stdout は空" "$(wc -c < "$SANDBOX/out" | tr -d ' ')" "0"
# 状態ディレクトリに書けなくても止めない（張れないだけ）
setup; set_mode "answer:up_to_pr:0.93"
mkdir -p "$SANDBOX/.claude/cache"
chmod 000 "$SANDBOX/.claude/cache"
arm_with "$REQUEST_TEXT"
check "cache に書けなくても hook は 0" "$?" "0"
run_pre "Bash" '{"command":"ls"}'; check "cache に書けなければ張れないので何もブロックしない" "$?" "0"
chmod 755 "$SANDBOX/.claude/cache"

echo
printf 'jev_test: pass=%d fail=%d\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
