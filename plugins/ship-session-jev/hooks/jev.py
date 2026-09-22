#!/usr/bin/env python3
"""Jev（TypeSafe AI の System One モデル）で、依頼文から到達点を分類する。

ship-gate.py がゲートを張るときに一度だけ呼ぶ。依頼文（`Skill` の `args`）を
Choice 質問として送り、4 つの到達点 + `unspecified` のどれかと confidence を
受け取る。confidence がしきい値以上なら、ゲートは質問せずに到達点を記録する。

**完全オプトイン + フェイルオープン。** `TYPESAFE_API_KEY` が無ければ何も
しない。ネットワーク失敗・タイムアウト・4xx/5xx・本文不正のどれでも例外を
外に出さず、「分類できなかった」を返す（呼び元は従来どおり質問に倒す）。

依存は標準ライブラリだけ。TypeSafe の SDK は入れない。

API の形は公式リファレンス（https://docs.typesafe.ai/api）に合わせる:

    POST /v1/systemone
    {"model": "jev-latest", "state": "<依頼文>",
     "questions": {"goal": {"type": "choice", "instructions": "...",
                            "criteria": {"issue_only": "...", ...}}}}
    → {"answers": {"goal": {"type": "choice", "choice": "up_to_pr",
                            "probabilities": {...}, "confidence": 0.93}}}
"""

import json
import math
import os
import socket
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

HOME = os.path.expanduser("~/.claude")
LOG_DIR = os.path.join(HOME, "cache", "ship-gate-jev")
LOG_PATH = os.path.join(LOG_DIR, "jev.log")

#: 既定値。環境変数で上書きできる（下の ENV_*）
DEFAULT_ENDPOINT = "https://api.typesafe.ai/v1/systemone"
DEFAULT_MODEL = "jev-latest"
#: これ以上の confidence のときだけ自動記録する。公式ドキュメントの
#: confidence は校正済み（高いほど実際に当たる）なので、0.85 は
#: 「ほぼ明示されている」水準
DEFAULT_THRESHOLD = 0.85
#: 壁時計での上限。ゲート判定を遅くしないために短くする
DEFAULT_TIMEOUT_MS = 800
#: 環境変数で伸ばせる上限。hooks.json の hook timeout（10 秒）より十分短くする ——
#: それを超えると Claude Code が hook ごと殺し、状態を書く前に終わってゲートが
#: 張られない
MAX_TIMEOUT_MS = 5000

ENV_API_KEY = "TYPESAFE_API_KEY"
ENV_ENABLED = "SHIP_JEV_ENABLED"
ENV_THRESHOLD = "SHIP_JEV_THRESHOLD"
ENV_TIMEOUT_MS = "SHIP_JEV_TIMEOUT_MS"
ENV_ENDPOINT = "SHIP_JEV_ENDPOINT"

#: `SHIP_JEV_ENABLED` をこの値にすると、キーを残したまま止められる
DISABLED_VALUES = ("0", "false", "no", "off")

QUESTION_ID = "goal"
#: 到達点が書かれていないときの受け皿。公式ドキュメントが「入力が選択肢に
#: 収まらないことがあるなら other を足す」と推奨している
UNSPECIFIED = "unspecified"

#: Jev の choice → ship-session の正準ラベル（SKILL.md の表と 1:1）。
#: 記録するのは英語の正準ラベルで、エージェントがユーザーの言語に訳して告げる
GOAL_LABELS = {
    "issue_only": "Issue only",
    "implementation": "Implementation only (no PR)",
    "up_to_pr": "Up to PR",
    "up_to_merge": "Up to merge",
}

CRITERIA = {
    "issue_only": "Only write a GitHub Issue; no implementation",
    "implementation": "Implement and commit, but do not open a pull request",
    "up_to_pr": "Implement and open a (draft) pull request; do not merge",
    "up_to_merge": "Implement, open a pull request, and merge it",
    UNSPECIFIED: "The message does not say how far to go",
}

INSTRUCTIONS = (
    "How far does the user explicitly ask this task to be taken? "
    "Pick unspecified when the message does not state how far to go."
)


def parse_threshold(value):
    """しきい値の環境変数を読む。解釈できない / 0〜1 の外なら既定に戻す。"""
    try:
        threshold = float(str(value).strip())
    except (TypeError, ValueError):
        return DEFAULT_THRESHOLD
    if not (0.0 <= threshold <= 1.0):
        return DEFAULT_THRESHOLD
    return threshold


def parse_timeout_ms(value):
    """タイムアウトの環境変数を読む。解釈できない / 0 以下なら既定、上限を超えたら上限。"""
    try:
        timeout_ms = int(str(value).strip())
    except (TypeError, ValueError):
        return DEFAULT_TIMEOUT_MS
    if timeout_ms <= 0:
        return DEFAULT_TIMEOUT_MS
    return min(timeout_ms, MAX_TIMEOUT_MS)


def settings(env=None):
    """環境変数から設定を組み立てる。値は返すが、api_key はログに出さない。"""
    env = os.environ if env is None else env
    enabled = str(env.get(ENV_ENABLED, "1")).strip().lower() not in DISABLED_VALUES
    return {
        "api_key": str(env.get(ENV_API_KEY) or "").strip(),
        "enabled": enabled,
        "threshold": parse_threshold(env.get(ENV_THRESHOLD, DEFAULT_THRESHOLD)),
        "timeout_ms": parse_timeout_ms(env.get(ENV_TIMEOUT_MS, DEFAULT_TIMEOUT_MS)),
        "endpoint": str(env.get(ENV_ENDPOINT) or "").strip() or DEFAULT_ENDPOINT,
    }


def build_request(text):
    """Jev に送る本文。state は依頼文そのまま。"""
    return {
        "model": DEFAULT_MODEL,
        "state": text,
        "questions": {
            QUESTION_ID: {
                "type": "choice",
                "instructions": INSTRUCTIONS,
                "criteria": dict(CRITERIA),
            }
        },
    }


#: http:// を許すホスト。それ以外は https:// だけ（キーを平文で流さない）
LOOPBACK_HOSTS = ("127.0.0.1", "localhost", "::1")


def endpoint_allowed(endpoint):
    """キーを送ってよいエンドポイントか。https か、http ならループバックだけ。"""
    try:
        parts = urllib.parse.urlsplit(endpoint)
    except (TypeError, ValueError):
        return False
    if parts.scheme == "https":
        return bool(parts.hostname)
    if parts.scheme == "http":
        return (parts.hostname or "").lower() in LOOPBACK_HOSTS
    return False


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """3xx を追わない。追うと Authorization ヘッダーごと別ホストへ飛ぶ。"""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def build_opener(endpoint):
    """エンドポイントに応じた opener。

    プロキシは **https のときだけ、環境変数のものだけ** 使う（CONNECT の中は TLS
    なのでキーは見えない）。http（ループバック）は決してプロキシに通さない ——
    urllib の既定はここでも `http_proxy` や macOS のシステム設定を拾い、平文の
    Authorization をプロキシへ送ってしまう。macOS のシステム設定は読まない
    （遅い上に、ユーザーが hook の挙動を env から推測できなくなる）。
    """
    scheme = urllib.parse.urlsplit(endpoint).scheme
    proxies = urllib.request.getproxies_environment() if scheme == "https" else {}
    return urllib.request.build_opener(_NoRedirect, urllib.request.ProxyHandler(proxies))


def post(endpoint, api_key, payload, timeout_s):
    """HTTP POST して (status, body_text) を返す。失敗は例外のまま上げる。"""
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        endpoint,
        data=data,
        method="POST",
        headers={
            "Authorization": "Bearer %s" % api_key,
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    with build_opener(endpoint).open(req, timeout=timeout_s) as resp:
        return resp.status, resp.read().decode("utf-8", "replace")


def post_with_deadline(endpoint, api_key, payload, timeout_ms):
    """壁時計で timeout_ms を超えたら諦める POST。

    `urllib` の timeout はソケット操作ごと（接続・送信・受信それぞれ）なので、
    それだけでは合計の上限にならない。デーモンスレッドで走らせて `join` で
    打ち切る。hook プロセスの終了と一緒にスレッドも消える。
    戻り値は ("ok", status, body) / ("timeout",) / ("http", code) /
    ("connection", ) / ("error", ) のいずれか。
    """
    box = []
    deadline_s = timeout_ms / 1000.0
    # ソケット側の timeout は壁時計より長めに取る。同じ値だと join とソケットの
    # どちらが先に切れるかで結果が揺れる（判定はどちらも "timeout" にするが、
    # 壁時計の方を主にしたい）。スレッドはデーモンなので長めでも害はない
    socket_timeout_s = deadline_s * 2

    def run():
        try:
            box.append(("ok",) + post(endpoint, api_key, payload, socket_timeout_s))
        except urllib.error.HTTPError as e:
            box.append(("http", int(e.code)))
        except urllib.error.URLError as e:
            # 接続段階の失敗。reason がソケットの timeout ならタイムアウト扱い
            if isinstance(getattr(e, "reason", None), (socket.timeout, TimeoutError)):
                box.append(("timeout",))
            else:
                box.append(("connection",))
        except (socket.timeout, TimeoutError):
            # 応答待ちの timeout は URLError に包まれず素で上がる
            box.append(("timeout",))
        except Exception:
            box.append(("error",))

    worker = threading.Thread(target=run, daemon=True)
    worker.start()
    worker.join(deadline_s)
    if not box:
        return ("timeout",)
    return box[0]


def interpret(body, threshold):
    """レスポンス本文を判定に直す。

    戻り値は dict: result は "recorded" / "fallback"。fallback には reason が付く。
    本文の形が違うものは全部 "bad_response"（何が違ったかは reason の後ろに付ける）。
    """
    try:
        data = json.loads(body)
    except (TypeError, ValueError):
        return {"result": "fallback", "reason": "bad_response:not_json"}
    answers = data.get("answers") if isinstance(data, dict) else None
    answer = answers.get(QUESTION_ID) if isinstance(answers, dict) else None
    if not isinstance(answer, dict):
        return {"result": "fallback", "reason": "bad_response:no_answer"}
    choice = answer.get("choice")
    confidence = answer.get("confidence")
    if not isinstance(choice, str):
        return {"result": "fallback", "reason": "bad_response:choice_not_string"}
    # bool は int のサブクラスなので弾く
    if isinstance(confidence, bool) or not isinstance(confidence, (int, float)):
        return {"result": "fallback", "reason": "bad_response:confidence_not_number"}
    confidence = float(confidence)
    # json.loads は NaN / Infinity を通す。NaN はどんな比較も False なので
    # `confidence < threshold` をすり抜けて記録側に落ちる。0〜1 の外も同じ扱い
    if not math.isfinite(confidence) or not (0.0 <= confidence <= 1.0):
        return {"result": "fallback", "reason": "bad_response:confidence_out_of_range"}
    if choice not in CRITERIA:
        return {"result": "fallback", "reason": "bad_response:unknown_choice"}
    outcome = {"choice": choice, "confidence": confidence}
    if choice == UNSPECIFIED:
        outcome.update({"result": "fallback", "reason": "unspecified"})
    elif confidence < threshold:
        outcome.update({"result": "fallback", "reason": "low_confidence"})
    else:
        outcome.update({"result": "recorded", "goal": GOAL_LABELS[choice]})
    return outcome


def classify(text, pid=None, env=None):
    """依頼文を分類する。**例外を外に出さない。** 必ず dict を返し、必ずログを書く。

    result:
      - "recorded" — goal（正準ラベル）付き。呼び元はこれで active にする
      - "fallback" — Jev は呼んだが自動記録しない（reason 付き）
      - "skipped"  — Jev を呼んでいない（キー無し・無効・依頼文が空）
    """
    started = time.monotonic()
    try:
        outcome = _classify(text, env)
    except Exception:
        outcome = {"result": "fallback", "reason": "error"}
    outcome["elapsed_ms"] = int((time.monotonic() - started) * 1000)
    log(outcome, pid)
    return outcome


def _classify(text, env):
    conf = settings(env)
    if not conf["api_key"]:
        return {"result": "skipped", "reason": "no_api_key"}
    if not conf["enabled"]:
        return {"result": "skipped", "reason": "disabled"}
    text = text if isinstance(text, str) else ""
    if not text.strip():
        return {"result": "skipped", "reason": "no_args"}
    if not endpoint_allowed(conf["endpoint"]):
        return {"result": "skipped", "reason": "insecure_endpoint"}

    reply = post_with_deadline(
        conf["endpoint"], conf["api_key"], build_request(text), conf["timeout_ms"]
    )
    kind = reply[0]
    if kind == "timeout":
        return {"result": "fallback", "reason": "timeout"}
    if kind == "http":
        return {"result": "fallback", "reason": "http_%d" % reply[1]}
    if kind == "connection":
        return {"result": "fallback", "reason": "connection_error"}
    if kind != "ok":
        return {"result": "fallback", "reason": "error"}
    status, body = reply[1], reply[2]
    if not (200 <= int(status) < 300):
        return {"result": "fallback", "reason": "http_%d" % int(status)}
    return interpret(body, conf["threshold"])


def log(outcome, pid=None):
    """1 試行 1 行を追記する。**キー・本文・依頼文は書かない。** 書けなくても止めない。"""
    fields = [
        time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "pid=%s" % (pid or "-"),
        "result=%s" % outcome.get("result", "-"),
    ]
    if outcome.get("reason"):
        fields.append("reason=%s" % outcome["reason"])
    if outcome.get("choice"):
        fields.append("choice=%s" % outcome["choice"])
    if isinstance(outcome.get("confidence"), float):
        fields.append("confidence=%.2f" % outcome["confidence"])
    if "elapsed_ms" in outcome:
        fields.append("elapsed_ms=%d" % outcome["elapsed_ms"])
    try:
        os.makedirs(LOG_DIR, exist_ok=True)
        with open(LOG_PATH, "a") as f:
            f.write(" ".join(fields) + "\n")
    except Exception:
        pass
