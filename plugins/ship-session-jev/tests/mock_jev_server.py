#!/usr/bin/env python3
"""jev_test.sh 用のモック Jev サーバー（標準ライブラリだけ）。

    使い方: mock_jev_server.py <制御ディレクトリ>

- 127.0.0.1 の空きポートで待ち受け、実際のポート番号を `<制御ディレクトリ>/port` に書く
- 応答は `<制御ディレクトリ>/mode` の 1 行で決める（リクエストごとに読み直す）
    answer:<choice>:<confidence>   200 + 正しい形の JSON
    status:<code>                  そのステータス + 小さな JSON
    raw:<text>                     200 + そのままの本文（JSON でない本文の検査用）
    json:<json>                    200 + その JSON（形が違う本文の検査用）
    sleep:<秒>                     その秒数黙ってから answer:up_to_pr:0.99
    drip:<秒>                      ヘッダーを返した後、0.3 秒おきに 1 バイトずつ本文を流し続けて
                                   その秒数かけて answer:up_to_pr:0.99 を完成させる
                                   （ソケットの timeout は切れず、壁時計の join だけが打ち切れる）
    redirect:<URL>                 302 + Location: <URL>（リダイレクトを追わないことの検査用）
- 受け取ったリクエストは `<制御ディレクトリ>/requests.log` に 1 行 1 JSON で残す。
  **Authorization ヘッダーの値そのものは書かない。** 期待するキー
  （環境変数 MOCK_EXPECT_KEY）と一致したかだけを `auth_matches` に残す
"""

import json
import os
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

CTRL_DIR = sys.argv[1]
EXPECT_KEY = os.environ.get("MOCK_EXPECT_KEY", "")


def answer_body(choice, confidence):
    options = ("issue_only", "implementation", "up_to_pr", "up_to_merge", "unspecified")
    rest = (1.0 - confidence) / (len(options) - 1) if choice in options else 0.0
    probabilities = {o: (confidence if o == choice else rest) for o in options}
    return {
        "model": "jev-1.13.0",
        "answers": {
            "goal": {
                "type": "choice",
                "choice": choice,
                "probabilities": probabilities,
                "confidence": confidence,
            }
        },
        "usage": {"input_tokens": 10, "output_tokens": 1},
    }


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length).decode("utf-8", "replace")
        auth = self.headers.get("Authorization") or ""
        record = {
            "path": self.path,
            "auth_present": bool(auth),
            "auth_matches": bool(EXPECT_KEY) and auth == "Bearer " + EXPECT_KEY,
            "content_type": self.headers.get("Content-Type") or "",
            "body": body,
        }
        with open(os.path.join(CTRL_DIR, "requests.log"), "a") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")

        mode = "answer:unspecified:0.9"
        try:
            with open(os.path.join(CTRL_DIR, "mode")) as f:
                mode = f.read().strip() or mode
        except OSError:
            pass
        kind, _, arg = mode.partition(":")
        status, payload = 200, ""
        location = None
        if kind == "drip":
            self.drip(float(arg))
            return
        if kind == "redirect":
            status, location = 302, arg
            payload = json.dumps({"moved": arg})
        elif kind == "sleep":
            time.sleep(float(arg))
            payload = json.dumps(answer_body("up_to_pr", 0.99))
        elif kind == "answer":
            choice, _, confidence = arg.partition(":")
            payload = json.dumps(answer_body(choice, float(confidence)))
        elif kind == "status":
            status = int(arg)
            payload = json.dumps({"error": {"status": status}})
        elif kind == "raw":
            payload = arg
        elif kind == "json":
            payload = arg
        data = payload.encode("utf-8")
        try:
            self.send_response(status)
            if location:
                self.send_header("Location", location)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            # hook 側がタイムアウトで先に切った。テストとしては想定内
            pass

    def drip(self, seconds, step=0.3):
        """本文を少しずつ流す。JSON の前の空白なので、完走すれば正しい応答になる。"""
        body = json.dumps(answer_body("up_to_pr", 0.99)).encode("utf-8")
        n = max(1, int(seconds / step))
        try:
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(n + len(body)))
            self.end_headers()
            for _ in range(n):
                self.wfile.write(b" ")
                self.wfile.flush()
                time.sleep(step)
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass


def main():
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    server.daemon_threads = True
    with open(os.path.join(CTRL_DIR, "port"), "w") as f:
        f.write(str(server.server_address[1]))
    server.serve_forever()


if __name__ == "__main__":
    main()
