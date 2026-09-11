#!/bin/bash
#  ship-session の到達点を記録する（Phase 0 ゲートの鍵）。
#
#    使い方: "${CLAUDE_PLUGIN_ROOT}/hooks/ship-goal.sh" record "Up to PR"
#            "${CLAUDE_PLUGIN_ROOT}/hooks/ship-goal.sh" status
#            "${CLAUDE_PLUGIN_ROOT}/hooks/ship-goal.sh" clear
#
#  `record` すると `~/.claude/cache/ship-gate/<pid>.json` が active になり、
#  ship-gate.py（PreToolUse hook）のブロックが解ける。
#  ユーザーが後から到達点を変えたら、もう一度 `record` すればよい。
#  到達点の値はユーザーの言語のまま記録してよい（自由記述）。
#
#  出力を読むのはエージェントなので、メッセージは英語で書く。
set -uo pipefail

PY=""
for c in /usr/bin/python3 /opt/homebrew/bin/python3 "$(command -v python3 2>/dev/null)"; do
  [ -n "$c" ] && [ -x "$c" ] && PY="$c" && break
done
[ -z "$PY" ] && { echo "ship-goal: python3 not found" >&2; exit 1; }

CMD="${1:-}"
case "$CMD" in
  record|status|clear) ;;
  *) echo 'usage: ship-goal.sh record "<goal>" | status | clear' >&2; exit 1 ;;
esac

GOAL="${2:-}"
if [ "$CMD" = "record" ] && [ -z "$GOAL" ]; then
  echo 'usage: ship-goal.sh record "<goal>"' >&2
  exit 1
fi

# 自セッションの pid を解決する（rename-session.sh と同じ手順）
PID=""
if [ -n "${CLAUDE_CODE_MESSAGING_SOCKET:-}" ]; then
  PID="$(basename "$CLAUDE_CODE_MESSAGING_SOCKET" .sock)"
fi
if ! [[ "$PID" =~ ^[0-9]+$ ]]; then
  p=$PPID
  for _ in 1 2 3 4 5 6; do
    read -r ppid comm < <(ps -o ppid=,comm= -p "$p" 2>/dev/null)
    [ -z "${ppid:-}" ] && break
    case "$comm" in *claude*) PID="$p"; break;; esac
    p="$ppid"
  done
fi
[[ "$PID" =~ ^[0-9]+$ ]] || { echo "ship-goal: could not determine the session pid" >&2; exit 1; }

"$PY" - "$CMD" "$PID" "$GOAL" <<'PYEOF'
import json, os, sys

cmd, pid, goal = sys.argv[1], sys.argv[2], sys.argv[3]
state_dir = os.path.join(os.path.expanduser("~/.claude"), "cache", "ship-gate")
path = os.path.join(state_dir, "%s.json" % pid)


def read():
    try:
        with open(path) as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


if cmd == "status":
    state = read()
    if not state:
        print("goal: not set (no gate is armed)")
    elif state.get("phase") == "active":
        print("goal: %s" % (state.get("goal") or "(nothing recorded)"))
    else:
        print("goal: not decided yet (the gate is armed)")
    sys.exit(0)

if cmd == "clear":
    try:
        os.unlink(path)
    except OSError:
        pass
    print("Cleared the gate state")
    sys.exit(0)

# record: 既存の session_id は保持する（ゲートの張り主と突き合わせるため）
goal = " ".join(goal.split())
state = read()
state.update({"phase": "active", "goal": goal})
try:
    os.makedirs(state_dir, exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(state, f, ensure_ascii=False)
    os.replace(tmp, path)
except Exception as e:
    print("ship-goal: failed to record (%s)" % e, file=sys.stderr)
    sys.exit(1)
print("Recorded the goal: %s" % goal)
PYEOF
