#!/bin/bash
#  セッション名を付け直す。
#
#    使い方: "${CLAUDE_PLUGIN_ROOT}/hooks/rename-session.sh" "日本語の簡潔な名前"
#
#  書き換えるのは **バックグラウンドジョブの `~/.claude/jobs/<jobId>/state.json` だけ**。
#  `~/.claude/sessions/<pid>.json` は `jobId` を引くために **読むだけ** で、
#  書き換えない（他プロセスが所有するファイルを配布物から触らない）。
#
#  命名の規約は skills/session-naming/SKILL.md を参照。
set -uo pipefail

PY=""
for c in /usr/bin/python3 /opt/homebrew/bin/python3 "$(command -v python3 2>/dev/null)"; do
  [ -n "$c" ] && [ -x "$c" ] && PY="$c" && break
done
[ -z "$PY" ] && { echo "rename-session: python3 が見つからない" >&2; exit 1; }

NAME="${1:-}"
[ -z "$NAME" ] && { echo '使い方: rename-session.sh "セッション名"' >&2; exit 1; }

# 自セッションの pid を解決する（fg / bg 両対応）
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
[[ "$PID" =~ ^[0-9]+$ ]] || { echo "rename-session: セッションの pid を特定できなかった" >&2; exit 1; }

CLAUDE_JOB_DIR="${CLAUDE_JOB_DIR:-}" "$PY" - "$PID" "$NAME" <<'PYEOF'
import json, os, sys, unicodedata

pid, name = sys.argv[1], sys.argv[2]
home = os.path.expanduser("~/.claude")


def width(s):
    """全角を2幅として数える（一覧で読める長さに丸めるため）。"""
    return sum(2 if unicodedata.east_asian_width(c) in "WF" else 1 for c in s)


name = " ".join(name.split())
while width(name) > 40 and len(name) > 1:
    name = name[:-1]
if not name:
    print("rename-session: 名前が空", file=sys.stderr)
    sys.exit(1)

# ジョブディレクトリを引く。`CLAUDE_JOB_DIR` が無いときだけ
# `sessions/<pid>.json` を **読んで** `jobId` を得る（書き換えはしない）
job_dir = os.environ.get("CLAUDE_JOB_DIR") or ""
if not job_dir:
    try:
        with open(os.path.join(home, "sessions", "%s.json" % pid)) as f:
            job_id = json.load(f).get("jobId")
    except Exception:
        job_id = None
    if not job_id:
        print(
            "rename-session: このセッションに対応するジョブが無い"
            "（バックグラウンドジョブ以外は対象外）",
            file=sys.stderr,
        )
        sys.exit(1)
    job_dir = os.path.join(home, "jobs", job_id)

state = os.path.join(job_dir, "state.json")

def stamp(path):
    """更新を検知するための印（更新時刻とサイズ）。取れなければ None。"""
    try:
        st = os.stat(path)
        return (st.st_mtime_ns, st.st_size)
    except OSError:
        return None


# **書く直前に読み直し、読んでから置き換えるまでに書かれていたらやり直す。**
# state.json は Claude Code 本体が数秒おきに書くので、古い読み値で全体を
# 書き戻すと name / nameSource 以外（tokens など）が巻き戻る
error = None
for attempt in range(5):
    before = stamp(state)
    try:
        with open(state) as f:
            data = json.load(f)
    except Exception as e:
        error = "state.json を読めない (%s)" % e
        break
    if not isinstance(data, dict):
        error = "state.json の形が違う"
        break

    data["name"] = name
    data["nameSource"] = "user"

    tmp = state + ".rename.tmp"
    try:
        with open(tmp, "w") as f:
            json.dump(data, f, ensure_ascii=False)
        if stamp(state) != before:
            # 読んでいる間に本体が書いた。**この書き込みは捨ててやり直す**
            os.unlink(tmp)
            error = "state.json が同時に更新され続けている"
            continue
        # この判定と os.replace の間にはまだμ秒の窓が残る。本体は state.json を
        # 数秒おきに書き直すので、そこで負けても tokens 等は次の書き込みで戻る
        # （name / nameSource はこちらの書き込みが勝つ）
        os.replace(tmp, state)
    except Exception as e:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        error = "state.json を書けない (%s)" % e
        break
    error = None
    break

if error:
    print("rename-session: %s" % error, file=sys.stderr)
    sys.exit(1)

# 「もう名前を付けた」印（催促 hook が再度促さないため）。
# **中身は空。** 名前の在処は state.json だけにして、複製を作らない
mark_dir = os.path.join(home, "cache", "session-renamed")
try:
    os.makedirs(mark_dir, exist_ok=True)
    open(os.path.join(mark_dir, pid), "w").close()
except Exception:
    # 印が置けなくても名前は付いている。失敗にはしない
    pass

print("セッション名を「%s」にしました" % name)
PYEOF
