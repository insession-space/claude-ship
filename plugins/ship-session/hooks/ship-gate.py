#!/usr/bin/env python3
"""PreToolUse / PostToolUse hook: ship-session の Phase 0（到達点の合意）を機械的に強制する。

ship-session の最大の故障モードは「Phase 0 を飛ばして作業に入り、途中で無言で
止まる」こと（計測では Phase 0 を出した 18 件は全て実装ループへ到達し、
出さなかった 3 件は全て途中で止まった）。SKILL.md の指示は確率的にしか
守られないので、この hook が決定的に守る。

動き:

- PreToolUse で `Skill(ship-session)` を見たらゲートを張る（pending）
- pending の間は、到達点の確定に使うツール以外を **exit 2 でブロック** し、
  何をすべきかを stderr でエージェントに返す
- 到達点は次のどちらかで記録され、ゲートが開く（active）
  - エージェントが `ship-goal.sh record "<到達点>"` を実行する
  - `AskUserQuestion`（header: Goal / Approach / 到達点 / 進め方）の回答を
    PostToolUse が自動記録する

ゲートに関係しないセッション・判定できない状況では **必ず素通しする**
（フェイルオープン。ユーザーの作業を絶対に止めない）。
"""

import json
import os
import sys

HOME = os.path.expanduser("~/.claude")
HOOKS_DIR = os.path.dirname(os.path.abspath(__file__))
STATE_DIR = os.path.join(HOME, "cache", "ship-gate")

#: ゲートを張る対象のスキル名（`plugin:skill` の skill 側）
SHIP_SKILL = "ship-session"

#: 到達点を聞く質問の header（SKILL.md / skills/_shared/user-language.md と揃える）。
#: 質問はユーザーの言語で出すので、英語と日本語の両方を持つ。
#: **どの header でも記録する形にはしない**（到達点と無関係な質問の回答でゲートが開く）。
#: ほかの言語で聞いた場合は、エージェントが ship-goal.sh record で記録する
GOAL_HEADERS = ("Goal", "Approach", "到達点", "進め方")

#: pending 中でも許可するツール。到達点の確定と、その前でも許される
#: セッション名のリネームだけを通す
ALLOWED_WHILE_PENDING = ("AskUserQuestion",)

#: pending 中の Bash で許可するスクリプト（argv[0] の basename）と、その第1引数。
#: 部分一致ではなく argv を解析して判定する（`echo x # ship-goal.sh` のような
#: 抜け道を塞ぐ）。None は第1引数を制限しない。
#: `clear` は状態ファイルを消してゲートをフェイルオープンさせるので pending 中は
#: 通さない（出荷型でない依頼は AskUserQuestion「進め方」で解除する）
ALLOWED_BASH_SCRIPTS = {
    "ship-goal.sh": ("record", "status"),
    "rename-session.sh": None,
}

#: 単語の中に現れたら拒否する文字。シェルが展開・実行に使うもの
#: （コマンド置換・変数展開・エスケープ・改行）
UNSAFE_WORD_CHARS = ("$", "`", "\\", "\n", "\r")


def bash_allowed_while_pending(command):
    """pending 中の Bash コマンドが、許可スクリプトの単純な1回呼び出しか。

    通すのは「`<path>/ship-goal.sh record "<到達点>"` のように、許可スクリプトを
    argv[0] とする単一コマンド」だけ。パイプ・連結・リダイレクト・サブシェル・
    コマンド置換・変数展開・改行・env 代入プレフィックスを含むものは拒否する。
    解析できないもの（閉じていない引用符など）も拒否する。
    """
    import shlex

    if any(ch in command for ch in ("\n", "\r")):
        return False
    try:
        lexer = shlex.shlex(command, posix=True, punctuation_chars=True)
        lexer.whitespace_split = True
        # shlex 既定の `#` コメント処理を切る。切らないと `record Issue#12; curl ...`
        # の `#` 以降が捨てられ、bash が実行する `; curl ...` を検査できない
        lexer.commenters = ""
        words = list(lexer)
    except ValueError:
        return False
    if not words:
        return False
    # argv[0] だけは SKILL.md が案内する `"${CLAUDE_PLUGIN_ROOT}/hooks/…"` 形式を
    # 許す。この変数はプラグインのルートを指すだけで、値を攻撃者が選べない
    argv0 = words[0]
    plugin_root = os.path.dirname(HOOKS_DIR)
    for prefix in ("${CLAUDE_PLUGIN_ROOT}/", "$CLAUDE_PLUGIN_ROOT/"):
        if argv0.startswith(prefix):
            argv0 = os.path.join(plugin_root, argv0[len(prefix):])
            words[0] = argv0
            break
    for word in words:
        # punctuation_chars=True では `;` `|` `&` `<` `>` `(` `)` だけの
        # トークンが演算子として切り出される
        if word and all(ch in lexer.punctuation_chars for ch in word):
            return False
        if any(ch in word for ch in UNSAFE_WORD_CHARS):
            return False
    if "=" in argv0:
        # `FOO=bar script` の env 代入プレフィックス
        return False
    name = os.path.basename(argv0)
    if name not in ALLOWED_BASH_SCRIPTS:
        return False
    # 同名の別スクリプト（`./ship-goal.sh` やチェックアウト内の偽物）を通さない。
    # このプラグインの hooks/ にある実体そのものだけを許す
    try:
        if os.path.realpath(argv0) != os.path.realpath(os.path.join(HOOKS_DIR, name)):
            return False
    except (OSError, ValueError):
        return False
    allowed_args = ALLOWED_BASH_SCRIPTS[name]
    if allowed_args is not None:
        if len(words) < 2 or words[1] not in allowed_args:
            return False
    return True


def resolve_pid(session_id):
    """自セッションの pid を返す（見つからなければ None）。"""
    sock = os.environ.get("CLAUDE_CODE_MESSAGING_SOCKET") or ""
    if sock.endswith(".sock"):
        pid = os.path.basename(sock)[:-5]
        if pid.isdigit():
            return pid
    if session_id:
        import glob

        for path in glob.glob(os.path.join(HOME, "sessions", "*.json")):
            try:
                with open(path) as f:
                    if json.load(f).get("sessionId") == session_id:
                        return os.path.basename(path)[:-5]
            except Exception:
                pass
    return None


def state_path(pid):
    return os.path.join(STATE_DIR, "%s.json" % pid)


def read_state(pid):
    """ゲートの状態。無い / 読めないなら None。"""
    try:
        with open(state_path(pid)) as f:
            data = json.load(f)
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def write_state(pid, data):
    try:
        os.makedirs(STATE_DIR, exist_ok=True)
        tmp = state_path(pid) + ".tmp"
        with open(tmp, "w") as f:
            json.dump(data, f, ensure_ascii=False)
        os.replace(tmp, state_path(pid))
        return True
    except Exception:
        return False


def clear_state(pid):
    try:
        os.unlink(state_path(pid))
    except OSError:
        pass


def is_ship_skill(tool_input):
    """Skill ツールの対象が ship-session 本体か。

    `ship-session:ship-session`（プラグイン経由）と `ship-session`（素の名前）の
    両方が来る。サブスキル（issue-loop 等）はゲートの対象にしない。
    """
    skill = str((tool_input or {}).get("skill") or "")
    return skill.split(":")[-1] == SHIP_SKILL


def allowed_while_pending(tool_name, tool_input):
    """pending 中でも通すツールか。"""
    if tool_name in ALLOWED_WHILE_PENDING:
        return True
    if tool_name == "Skill" and is_ship_skill(tool_input):
        # ship-session の再 invoke は無害（ゲートは張り直さない）
        return True
    if tool_name == "Bash":
        command = str((tool_input or {}).get("command") or "")
        return bash_allowed_while_pending(command)
    return False


def block_message():
    """ブロック時にエージェントへ返す文。

    読むのはエージェントなので英語で書く（ユーザーに見せる前提ではない）。
    ユーザーへの質問は、ここに書いた header をユーザーの言語に訳して出す。
    """
    goal_script = os.path.join(HOOKS_DIR, "ship-goal.sh")
    return (
        "[ship-gate] The goal is not decided yet. ship-session cannot use other tools "
        "until Phase 0 fixes the goal (Up to PR / Up to merge / Implementation only / "
        "Issue only). Reading files, investigating, and delegating all come after the gate.\n"
        "- If the user's message already states the goal, run "
        '`"%s" record "<goal>"` before starting work.\n'
        "- Otherwise ask with `AskUserQuestion` (header: Goal), written in the user's "
        "language. Answers under the headers %s are recorded automatically.\n"
        "- If you already asked under a header in another language, run "
        '`"%s" record "<answer>"` with the user\'s answer now.\n'
        "- If the request is not shippable (a plain question, investigation only, fixing "
        "an existing PR), ask with header: Approach instead."
        % (goal_script, " / ".join(GOAL_HEADERS), goal_script)
    )


def handle_pre_tool_use(payload):
    tool_name = str(payload.get("tool_name") or "")
    tool_input = payload.get("tool_input") or {}
    session_id = str(payload.get("session_id") or "")

    # ゲートを張る: ship-session の invoke を見たら pending にする
    if tool_name == "Skill" and is_ship_skill(tool_input):
        pid = resolve_pid(session_id)
        if not pid:
            return
        state = read_state(pid)
        if state and state.get("session_id") == session_id and state.get("phase") == "active":
            # 到達点が決まった後の再 invoke。張り直すと合意が消えるので触らない
            return
        write_state(pid, {"phase": "pending", "session_id": session_id})
        return

    pid = resolve_pid(session_id)
    if not pid:
        return
    state = read_state(pid)
    if not state:
        return
    if session_id and state.get("session_id") not in ("", None, session_id):
        # pid が再利用された別セッションの残骸。ブロックの根拠にしない
        clear_state(pid)
        return
    if state.get("phase") != "pending":
        return
    if allowed_while_pending(tool_name, tool_input):
        return

    print(block_message(), file=sys.stderr)
    sys.exit(2)


def extract_goal(tool_input, tool_response):
    """AskUserQuestion の入出力から、到達点の回答を取り出す。

    取り出せなければ None（記録しないだけ。次のツールが再びブロックされ、
    エージェントは ship-goal.sh で記録し直せるので、ここで無理をしない）。
    """
    questions = (tool_input or {}).get("questions") or []
    target = None
    for q in questions:
        if isinstance(q, dict) and str(q.get("header") or "") in GOAL_HEADERS:
            target = q
            break
    if target is None:
        return None

    answers = None
    if isinstance(tool_response, dict):
        answers = tool_response.get("answers")
        if not isinstance(answers, dict):
            # {"到達点": "PR作成まで"} 形式で直接返る形にも備える
            answers = tool_response if all(
                isinstance(v, str) for v in tool_response.values()
            ) else None
    if not isinstance(answers, dict) or not answers:
        return None

    question_text = str(target.get("question") or "")
    for key in (question_text, str(target.get("header") or "")):
        value = answers.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    # キーで引けない回答形式への保険。**質問が1問だけのときに限る。**
    # 複数の質問をまとめて聞いたときに1件だけ返った回答は、到達点の質問への
    # 回答とは限らない（無関係な質問の回答でゲートが開いてしまう）
    if len(answers) == 1 and len(questions) == 1:
        value = next(iter(answers.values()))
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def handle_post_tool_use(payload):
    if str(payload.get("tool_name") or "") != "AskUserQuestion":
        return
    session_id = str(payload.get("session_id") or "")
    pid = resolve_pid(session_id)
    if not pid:
        return
    state = read_state(pid)
    if not state or state.get("phase") != "pending":
        return
    if session_id and state.get("session_id") not in ("", None, session_id):
        return
    goal = extract_goal(payload.get("tool_input"), payload.get("tool_response"))
    if not goal:
        return
    write_state(pid, {"phase": "active", "goal": goal, "session_id": session_id})


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return
    if not isinstance(payload, dict):
        return
    event = str(payload.get("hook_event_name") or "")
    if event == "PreToolUse":
        handle_pre_tool_use(payload)
    elif event == "PostToolUse":
        handle_post_tool_use(payload)


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception:
        # **ユーザーの作業を止めない。** ゲートは付加価値であって、
        # 判定に失敗したら素通しが正しい
        pass
