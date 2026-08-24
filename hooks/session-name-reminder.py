#!/usr/bin/env python3
"""UserPromptSubmit hook: セッション名が自動生成のままなら、表示言語で付け直すよう促す。

`/ship-session` を呼んでいないセッションでも、プラグインが入っていれば毎回走る。
促す条件を1つでも満たさなければ **何も出さずに終了コード0** で抜ける
（ユーザーの入力を絶対に止めない）。

名前を実際に書き換えるのは同じディレクトリの `rename-session.sh`。
規約は skills/session-naming/SKILL.md。
"""

import json
import os
import re
import subprocess
import sys

HOME = os.path.expanduser("~/.claude")
HOOKS_DIR = os.path.dirname(os.path.abspath(__file__))

#: 促す回数の上限。際限なく促すと邪魔になる
ASK_LIMIT = 3

#: `AppleLocale` の言語コードを、促し文にそのまま埋められる呼び名に直す。
#: **網羅は狙わない。** 表に無いコードはそのまま埋めれば意味は通る
LANGUAGE_NAMES = {
    "ja": "日本語",
    "en": "English",
    "ko": "Korean",
    "zh": "Chinese",
    "fr": "French",
    "de": "German",
    "es": "Spanish",
    "pt": "Portuguese",
    "it": "Italian",
    "ru": "Russian",
}

#: 言語コードらしさ（`ja` / `en-US` / `fr_CA`）。呼び名と見分けるためだけに使う
CODE_RE = re.compile(r"^[A-Za-z]{2,3}([-_][A-Za-z]{2,4})?$")

#: 自動生成の名前の形（`fix-login-bug`）。人が付けた名前と見分けるのに使う
KEBAB_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")


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
    # 最後は親プロセスを辿って `claude` を探す（rename-session.sh と同じ手順）
    return _pid_from_ancestors()


def _pid_from_ancestors(limit=6):
    """親を辿って `claude` のプロセスを探す。見つからなければ None。"""
    pid = os.getppid()
    for _ in range(limit):
        try:
            out = subprocess.run(
                ["ps", "-o", "ppid=,comm=", "-p", str(pid)],
                capture_output=True,
                text=True,
                timeout=3,
            )
        except Exception:
            return None
        parts = out.stdout.split(None, 1)
        if out.returncode != 0 or len(parts) < 2:
            return None
        parent, comm = parts[0], parts[1].strip()
        if "claude" in comm:
            return str(pid)
        if not parent.isdigit():
            return None
        pid = int(parent)
    return None


def job_dir_for(pid):
    """このセッションに対応するジョブディレクトリ（無ければ None）。"""
    job_dir = os.environ.get("CLAUDE_JOB_DIR")
    if job_dir:
        return job_dir
    try:
        with open(os.path.join(HOME, "sessions", "%s.json" % pid)) as f:
            job_id = json.load(f).get("jobId")
        return os.path.join(HOME, "jobs", job_id) if job_id else None
    except Exception:
        return None


def state_of(job_dir):
    """`state.json` の中身。読めない/壊れているなら None。"""
    try:
        with open(os.path.join(job_dir, "state.json")) as f:
            data = json.load(f)
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def display_language():
    """表示言語の呼び名を返す。**判定できなければ英語**（黙らない）。

    優先順位は Claude Code の設定に合わせる:
    `settings.local.json` → `settings.json` の `language` → `AppleLocale`。
    """
    for name in ("settings.local.json", "settings.json"):
        try:
            with open(os.path.join(HOME, name)) as f:
                lang = json.load(f).get("language")
        except Exception:
            continue
        if lang:
            return language_name(str(lang))
    try:
        locale = subprocess.run(
            ["defaults", "read", "-g", "AppleLocale"],
            capture_output=True,
            text=True,
            timeout=3,
        )
        if locale.returncode == 0:
            return language_name(locale.stdout)
    except Exception:
        pass
    return "English"


def language_name(value):
    """設定の値を、促し文にそのまま埋められる呼び名に直す。

    **言語コードのときだけ直す。** `language` は自由記述で、
    `ja` のようなコードも `日本語` / `Français` のような呼び名も来る。
    後者をコード表に通すと元の綴りを壊すので、形で見分ける。
    """
    value = value.strip()
    if not value:
        return "English"
    if CODE_RE.match(value):
        code = re.split(r"[-_]", value)[0].lower()
        return LANGUAGE_NAMES.get(code, code)
    return value


def is_japanese(language):
    """その呼び名が日本語を指すか。

    **前方一致では見ない。** `language` は自由記述で、`Javanese` のように
    `ja` で始まる別の言語名が来る。
    """
    lang = language.strip().lower()
    if lang in ("ja", "jpn", "japanese", "日本語"):
        return True
    return lang.startswith("ja-") or lang.startswith("ja_")


def bump_ask_count(pid, limit=ASK_LIMIT):
    """促した回数を数える。上限に達していたら False。"""
    path = os.path.join(HOME, "cache", "session-renamed", pid + ".asked")
    count = 0
    try:
        with open(path) as f:
            count = int(f.read().strip() or 0)
    except Exception:
        pass
    if count >= limit:
        return False
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            f.write(str(count + 1))
    except Exception:
        # 数えられなくても促す。上限が効かないだけで害はない
        pass
    return True


def should_ask(pid, language):
    """促してよいか。**判定できない要素が1つでもあれば促さない**。

    ただし表示言語だけは例外で、判定できなければ英語に倒して促す
    （黙ると「英語圏のユーザーには何も起きない」に逆戻りする）。
    """
    if os.path.exists(os.path.join(HOME, "cache", "session-renamed", pid)):
        return False
    job_dir = job_dir_for(pid)
    if not job_dir:
        # バックグラウンドジョブ以外は書き込み先が無いので促さない
        return False
    state = state_of(job_dir)
    if state is None:
        # 壊れている / まだ書かれていない → 「未命名」と決めつけない
        return False
    if state.get("nameSource") == "user":
        return False
    if looks_named(state.get("name") or ""):
        return False
    return bump_ask_count(pid)


def looks_named(name):
    """もう人が読める名前が付いているか。

    `nameSource` を書かない経路で名前が変わっていても拾うための保険。
    非 ASCII が混じっていれば表示言語の名前、ASCII だけでも
    **kebab-case でなければ**（空白や大文字がある）人が付けた名前と見なす。
    """
    name = name.strip()
    if not name:
        return False
    if any(ord(c) > 127 for c in name):
        return True
    return not KEBAB_RE.match(name)


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        payload = {}

    pid = resolve_pid(payload.get("session_id") or "")
    language = display_language()
    if not pid or not should_ask(pid, language):
        return

    script = os.path.join(HOOKS_DIR, "rename-session.sh")
    if is_japanese(language):
        message = (
            "[セッション名] このセッションの名前はまだ自動生成の英語のままです。"
            '今の依頼の主題が掴めた時点で `"%s" "<名前>"` を一度だけ実行し、'
            "日本語の簡潔な名前に付け直してください。"
            "名前は体言止め・全角10〜20文字が目安で、リポジトリ名やブランチ名は入れず、"
            "記号や引用符も使いません（例:「セッション名の自動リネームを仕込む」）。"
            "実行したことをユーザーに報告する必要はありません。" % script
        )
    else:
        message = (
            "[Session name] This session still has its auto-generated kebab-case name. "
            'Once you know what the request is about, run `"%s" "<name>"` exactly once '
            "and rename it to a short phrase in %s. "
            "Keep it under 40 characters, name what the work is, and leave out repository "
            "and branch names, quotes, and emoji "
            '(for example: "Fix the login redirect"). '
            "You do not need to tell the user that you renamed the session." % (script, language)
        )
    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "UserPromptSubmit",
                    "additionalContext": message,
                }
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # **入力を止めない。** 促しは付加価値であって、失敗しても素通りさせる
        pass
