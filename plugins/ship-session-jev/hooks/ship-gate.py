#!/usr/bin/env python3
"""PreToolUse / PostToolUse hook: ship-session-jev の Phase 0（到達点の合意）を機械的に強制する。

`ship-session` プラグインの `hooks/ship-gate.py` の複製に、**ゲートを張るときの
Jev 分類**を足したもの。ゲートの仕組み自体（pending 中のブロック・許可・
自動記録・フェイルオープン）は元と同じで、違いは次の 3 点だけ。

- ゲートを張る対象は `ship-session-jev` スキルだけ（`ship-session` には反応しない）
- 張るときに `Skill` の `args` を Jev（jev.py）に送り、到達点が高い confidence で
  分類できたら **pending を飛ばして active にする**（質問しない）
- 状態ファイルは `~/.claude/cache/ship-gate-jev/` に置く（元と混ぜない）

動き:

- ゲートを張る入口は 2 つ。どちらも張るときに Jev を 1 回だけ呼ぶ
  - UserPromptSubmit でユーザーの入力が `/ship-session-jev:ship-session-jev <依頼>`
    （または `/ship-session-jev <依頼>`）なら張る。スラッシュコマンドは Claude Code が
    プロンプトに展開するだけで `Skill` ツールを通らないので、ここで拾わないと
    案内している入口で Jev が動かない。結果は additionalContext でエージェントに伝える
  - PreToolUse で `Skill(ship-session-jev)` を見たら張る（散文で頼まれてエージェントが
    Skill ツールを呼ぶ経路）
- pending の間は、到達点の確定に使うツール以外を **exit 2 でブロック** し、
  何をすべきかを stderr でエージェントに返す
- 到達点は次のどれかで記録され、ゲートが開く（active）
  - Jev の分類（confidence がしきい値以上のとき）
  - エージェントが `ship-goal.sh record "<到達点>"` を実行する
  - `AskUserQuestion`（header: Goal / Approach / 到達点 / 進め方）の回答を
    PostToolUse が自動記録する

ゲートに関係しないセッション・判定できない状況では **必ず素通しする**
（フェイルオープン。ユーザーの作業を絶対に止めない）。Jev が使えない・失敗
したときも同じで、従来どおり pending に倒すだけ。
"""

import json
import os
import sys

HOME = os.path.expanduser("~/.claude")
HOOKS_DIR = os.path.dirname(os.path.abspath(__file__))
STATE_DIR = os.path.join(HOME, "cache", "ship-gate-jev")

#: ゲートを張る対象のスキル名（`plugin:skill` の skill 側）。
#: `ship-session` には反応しない（そちらは元のプラグインのゲートが受け持つ）
SHIP_SKILL = "ship-session-jev"

#: ユーザーが直接打つスラッシュコマンド。長い方から照合する
SLASH_COMMANDS = ("/ship-session-jev:ship-session-jev", "/ship-session-jev")

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
    """Skill ツールの対象が ship-session-jev 本体か。

    `ship-session-jev:ship-session-jev`（プラグイン経由）と `ship-session-jev`
    （素の名前）の両方が来る。委譲先（`ship-session:issue-loop` 等）と元の
    `ship-session` はゲートの対象にしない。
    """
    skill = str((tool_input or {}).get("skill") or "")
    return skill.split(":")[-1] == SHIP_SKILL


def classify_with_jev(args, pid):
    """ゲートを張るときに Jev で到達点を分類する。

    戻り値は jev.classify() の dict。**何があっても例外を出さない**（jev.py の
    読み込み自体に失敗しても素通し）。呼ぶのは arm_gate() だけで、それ以外の
    ツール呼び出しで HTTP は出さない。
    """
    try:
        if HOOKS_DIR not in sys.path:
            sys.path.insert(0, HOOKS_DIR)
        import jev

        return jev.classify(args if isinstance(args, str) else "", pid=pid)
    except Exception:
        return {"result": "fallback", "reason": "error"}


def slash_command_args(prompt):
    """ユーザーの入力がこのスキルのスラッシュコマンドなら、その引数を返す（無ければ ""）。

    スラッシュコマンドでなければ None。生の入力（`/ship-session-jev:… <依頼>`）と、
    展開済みの形（`<command-name>/ship-session-jev:…</command-name>` +
    `<command-args>…</command-args>`）の両方を見る。どちらが hook に渡るかは
    Claude Code の版に依るので、両方に備える
    """
    import re

    text = str(prompt or "").lstrip()
    for cmd in SLASH_COMMANDS:
        if text == cmd:
            return ""
        if text.startswith(cmd) and text[len(cmd)].isspace():
            return text[len(cmd):].strip()
    name = re.search(r"<command-name>\s*(/ship-session-jev(?::ship-session-jev)?)\s*</command-name>", text)
    if name:
        args = re.search(r"<command-args>(.*?)</command-args>", text, re.S)
        return args.group(1).strip() if args else ""
    return None


def arm_gate(pid, session_id, args):
    """ゲートを張る。Jev が決めたら active、決めなければ pending を書く。

    戻り値は Jev の判定要約（dict）。既に同じセッションで active、または pending で
    Jev を試みた後なら **何もせず None**（合意を消さない。HTTP も張るときの 1 回だけ）。
    """
    state = read_state(pid)
    if state and state.get("session_id") == session_id:
        if state.get("phase") == "active":
            # 到達点が決まった後の再 invoke。張り直すと合意が消えるので触らない
            return None
        if state.get("phase") == "pending" and isinstance(state.get("jev"), dict):
            # スラッシュコマンドで張った後に Skill ツールでも invoke された等。
            # 分類は済んでいるので呼び直さない
            return None
    outcome = classify_with_jev(args, pid)
    # 状態に残すのは判定の要約だけ（依頼文・本文は残さない）。
    # `ship-goal.sh status` がこれを読んで、Jev が決めたのか・なぜ決めなかったのかを出す
    jev_state = {
        k: outcome[k]
        for k in ("result", "reason", "choice", "confidence", "goal")
        if k in outcome
    }
    if outcome.get("result") == "recorded" and outcome.get("goal"):
        write_state(
            pid,
            {
                "phase": "active",
                "goal": outcome["goal"],
                "session_id": session_id,
                "jev": jev_state,
            },
        )
    else:
        write_state(pid, {"phase": "pending", "session_id": session_id, "jev": jev_state})
    return jev_state


def prompt_context(jev_state):
    """UserPromptSubmit で張ったとき、エージェントに渡す additionalContext。

    読むのはエージェントなので英語。到達点はユーザーの言語に訳して告げさせる
    """
    goal_script = os.path.join(HOOKS_DIR, "ship-goal.sh")
    if jev_state.get("result") == "recorded":
        return (
            "[ship-gate] Jev classified this request as goal: %s (choice %s, confidence %.2f). "
            "The Phase 0 gate is already open; do not ask about the goal. Tell the user in one "
            "line, in their language, that Jev chose this goal and that they can change it, then "
            "continue with Phase 1. If the user changes it, run `\"%s\" record \"<goal>\"`."
            % (jev_state.get("goal"), jev_state.get("choice"), float(jev_state.get("confidence") or 0), goal_script)
        )
    reason = jev_state.get("reason") or jev_state.get("result") or "unknown"
    return (
        "[ship-gate] Jev did not decide the goal (%s). The Phase 0 gate is armed: before any other "
        "tool, fix the goal — run `\"%s\" record \"<goal>\"` if the message states it, otherwise ask "
        "with `AskUserQuestion` (header: Goal) in the user's language." % (reason, goal_script)
    )


def handle_user_prompt_submit(payload):
    """ユーザーがスラッシュコマンドで invoke したときにゲートを張る。それ以外は何も出さない。"""
    args = slash_command_args(payload.get("prompt"))
    if args is None:
        return
    session_id = str(payload.get("session_id") or "")
    pid = resolve_pid(session_id)
    if not pid:
        return
    jev_state = arm_gate(pid, session_id, args)
    if jev_state is None:
        return
    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "UserPromptSubmit",
                    "additionalContext": prompt_context(jev_state),
                }
            },
            ensure_ascii=False,
        )
    )


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
        "[ship-gate] The goal is not decided yet. ship-session-jev cannot use other tools "
        "until Phase 0 fixes the goal (Up to PR / Up to merge / Implementation only / "
        "Issue only). Reading files, investigating, and delegating all come after the gate.\n"
        '- Jev did not decide the goal for this request (run `"%s" status` to see why). '
        "Fix it yourself:\n"
        "- If the user's message already states the goal, run "
        '`"%s" record "<goal>"` before starting work.\n'
        "- Otherwise ask with `AskUserQuestion` (header: Goal), written in the user's "
        "language. Answers under the headers %s are recorded automatically.\n"
        "- If you already asked under a header in another language, run "
        '`"%s" record "<answer>"` with the user\'s answer now.\n'
        "- If the request is not shippable (a plain question, investigation only, fixing "
        "an existing PR), ask with header: Approach instead."
        % (goal_script, goal_script, " / ".join(GOAL_HEADERS), goal_script)
    )


def handle_pre_tool_use(payload):
    tool_name = str(payload.get("tool_name") or "")
    tool_input = payload.get("tool_input") or {}
    session_id = str(payload.get("session_id") or "")

    # ゲートを張る: ship-session-jev の invoke を見たら、Jev に到達点を聞いてから
    # pending / active を決める
    if tool_name == "Skill" and is_ship_skill(tool_input):
        pid = resolve_pid(session_id)
        if not pid:
            return
        args = (tool_input or {}).get("args")
        arm_gate(pid, session_id, args if isinstance(args, str) else "")
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
    # Jev の判定要約（張ったときに書いたもの）は残す。status で経緯が追える
    state.update({"phase": "active", "goal": goal, "session_id": session_id})
    write_state(pid, state)


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
    elif event == "UserPromptSubmit":
        handle_user_prompt_submit(payload)


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception:
        # **ユーザーの作業を止めない。** ゲートは付加価値であって、
        # 判定に失敗したら素通しが正しい
        pass
