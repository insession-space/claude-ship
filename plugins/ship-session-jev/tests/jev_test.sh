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
# $1=tool_name $2=tool_input(JSON)、以降は env の上書き（KEY=VALUE）
run_pre() {
  local tool="$1" input="$2"; shift 2
  printf '{"hook_event_name":"PreToolUse","session_id":"%s","tool_name":"%s","tool_input":%s}' \
    "$SID" "$tool" "$input" \
    | env HOME="$SANDBOX" CLAUDE_CODE_MESSAGING_SOCKET="$SOCK" \
      TYPESAFE_API_KEY="$DUMMY_KEY" SHIP_JEV_ENDPOINT="$ENDPOINT" "$@" \
      "$GATE" > "$SANDBOX/out" 2> "$SANDBOX/err"
}

# ship-session-jev を invoke する（$1=args、以降は env の上書き）
arm_with() {
  local args="$1"; shift
  local input
  input="$(python3 -c 'import json,sys;print(json.dumps({"skill":"ship-session-jev:ship-session-jev","args":sys.argv[1]}, ensure_ascii=False))' "$args")"
  run_pre "Skill" "$input" "$@"
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
setup
arm_with "$REQUEST_TEXT" SHIP_JEV_ENABLED=false
check "SHIP_JEV_ENABLED=false でも止まる" "$(request_count)" "0"
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
[ -n "$(last_request_body_field questions.goal.instructions)" ] && ok "instructions がある" || ng "instructions がある"

echo
echo "確信が足りない / 到達点が書かれていないときは pending に倒れる"
setup; set_mode "answer:up_to_pr:0.60"
arm_with "$REQUEST_TEXT"
check "hook は 0 で返る" "$?" "0"
check "低 confidence は pending" "$(state_field phase)" "pending"
check "状態に low_confidence の理由が残る" "$(state_field jev.reason)" "low_confidence"
run_pre "Bash" '{"command":"ls"}'; check "pending なので Bash はブロック" "$?" "2"
grep -q "status" "$SANDBOX/err" && ok "ブロック文が status で理由を見るよう案内する" || ng "ブロック文が status で理由を見るよう案内する"
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
setup; set_mode "sleep:0.2"
arm_with "$REQUEST_TEXT" SHIP_JEV_TIMEOUT_MS=abc
check "解釈できないタイムアウトは既定（800ms）に戻り 0.2 秒の応答は間に合う" "$(state_field phase)" "active"
setup; set_mode "sleep:0.2"
arm_with "$REQUEST_TEXT" SHIP_JEV_TIMEOUT_MS=0
check "0 以下のタイムアウトは既定に戻る" "$(state_field phase)" "active"

echo
echo "秘密と依頼文を漏らさない"
setup; set_mode "answer:up_to_pr:0.93"
arm_with "$REQUEST_TEXT"
run_goal status
check "ログにキーの値が無い" "$(grep -c "$DUMMY_KEY" "$(LOG_FILE)")" "0"
check "ログに依頼文が無い" "$(grep -c "ZZZREQUESTTEXT" "$(LOG_FILE)")" "0"
check "状態ファイルにキーの値が無い" "$(grep -c "$DUMMY_KEY" "$(STATE_FILE)")" "0"
check "状態ファイルに依頼文が無い" "$(grep -c "ZZZREQUESTTEXT" "$(STATE_FILE)")" "0"
check "hook の stdout/stderr にキーの値が無い" "$(cat "$SANDBOX/out" "$SANDBOX/err" | grep -c "$DUMMY_KEY")" "0"
check "モックの記録にキーの値が無い（一致フラグだけ）" "$(grep -c "$DUMMY_KEY" "$CTRL/requests.log")" "0"

echo
echo "jev.py は標準ライブラリだけを使う"
IMPORTS="$(grep -E '^(import|from) ' "$ROOT/hooks/jev.py" | awk '{print $2}' | cut -d. -f1 | sort -u | tr '\n' ',')"
check "import 一覧" "$IMPORTS" "json,os,socket,threading,time,urllib,"

echo
echo "フェイルオープン（Jev が壊れていてもゲートは素通し）"
setup
printf 'not json' | env HOME="$SANDBOX" CLAUDE_CODE_MESSAGING_SOCKET="$SOCK" TYPESAFE_API_KEY="$DUMMY_KEY" "$GATE" >/dev/null 2>&1
check "壊れた入力では素通し" "$?" "0"
setup
mkdir -p "$SANDBOX/.claude/cache/ship-gate-jev"
printf 'not json' > "$(STATE_FILE)"
run_pre "Bash" '{"command":"ls"}'; check "壊れた状態ファイルでは素通し" "$?" "0"

echo
printf 'jev_test: pass=%d fail=%d\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
