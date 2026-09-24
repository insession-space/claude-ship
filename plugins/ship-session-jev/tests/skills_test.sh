#!/bin/bash
#  スキル文書と配布物の構造検証（ship-session-jev）。
#
#    使い方: tests/skills_test.sh
#
#  見るのは 3 つ:
#    1. SKILL.md が「Jev の判定を先に見る → 無ければ ship-session と同じ Phase 0」の形を
#       保っていて、Phase 1/2 を ship-session: 付きの名前で委譲していること
#    2. ship-session から受け継いだゲートの要素（Phase 0 先行・result: の扱い・
#       出荷型でない依頼の分岐・選択肢の順序）が消えていないこと
#    3. README / plugin.json / hooks.json に、任意機能であることと設定の在り処が書かれていること
#
#  **文言の完全一致では検査しない。** 節や要素の存在だけを見る。
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"; }
ng() { FAIL=$((FAIL + 1)); printf '  FAIL %s\n' "$1"; }

# $1=説明 $2=ファイル $3=grep -E のパターン
has() {
  if [ ! -f "$2" ]; then ng "$1 (ファイルが無い: $2)"; return; fi
  if grep -qE "$3" "$2"; then ok "$1"; else ng "$1 (見つからない: $3)"; fi
}
lacks() {
  if [ ! -f "$2" ]; then ng "$1 (ファイルが無い: $2)"; return; fi
  if grep -qE "$3" "$2"; then ng "$1 (残っている: $3)"; else ok "$1"; fi
}

SHIP="$ROOT/SKILL.md"

echo "SKILL.md: Jev を先に見る Phase 0"
has "frontmatter の name が ship-session-jev" "$SHIP" "^name: ship-session-jev$"
has "Step 0（Jev の判定を先に見る）の節がある" "$SHIP" "^### Step 0: check whether Jev already decided"
has "最初に ship-goal.sh status を実行する旨がある" "$SHIP" 'ship-goal\.sh" status'
has "Jev が決めていたら質問しない旨がある" "$SHIP" "the goal is fixed\. \*\*Do not ask\.\*\*"
has "hook が出す 3 つ目のコンテキスト行（already recorded）の扱いがある" "$SHIP" "The goal for this session is already recorded"
has "Jev 以外が決めた到達点を Jev の判定と言わない旨がある" "$SHIP" "do not attribute it to Jev"
has "Jev が決めた到達点を 1 行で告げる旨がある" "$SHIP" "Tell the user in one line"
has "決めていなければ ship-session と同じに進む旨がある" "$SHIP" "Fix the goal yourself exactly as .ship-session. does"
has "Jev は分類以外に触れない旨がある" "$SHIP" "not verification, not acceptance criteria, not review"
has "5 つの選択肢（unspecified 込み）が書かれている" "$SHIP" "issue_only. / .implementation. / .up_to_pr. / .up_to_merge. / .unspecified."
has "既定のしきい値が書かれている" "$SHIP" "default 0\.85"
has "Jev の判定を record で上書きできる旨がある" "$SHIP" "This is also how a Jev decision gets corrected"

echo
echo "SKILL.md: 委譲先は ship-session プラグインのスキル"
has "ship-session プラグインが前提である旨がある" "$SHIP" "must be installed"
has "Phase 1 は ship-session:create-issue に委譲" "$SHIP" "Invoke .ship-session:create-issue."
has "Phase 2 は ship-session:issue-loop に委譲" "$SHIP" "Invoke .ship-session:issue-loop."
has "レビューは ship-session:code-review" "$SHIP" "ship-session:code-review"
has "委譲プロンプトに ship-session 経由である旨を書く" "$SHIP" "Called from ship-session \(via ship-session-jev\)"
[ ! -d "$ROOT/skills/create-issue" ] && [ ! -d "$ROOT/skills/issue-loop" ] && [ ! -d "$ROOT/skills/code-review" ] \
  && ok "サブスキルを複製していない" || ng "サブスキルを複製していない"

echo
echo "SKILL.md: ship-session から受け継いだゲートが残っている"
for n in 0 1 2 3; do
  has "Phase $n の節がある" "$SHIP" "^## Phase $n:"
done
has "到達点を他のツール呼び出しより先に確定させる旨がある" "$SHIP" "other than .ship-goal.sh status. and renaming the session"
has "調査が先に要る依頼でも例外にしない旨がある" "$SHIP" "is not a reason to skip the gate"
has "到達点の質問は header: \"Goal\" で聞く" "$SHIP" 'header: "Goal"'
has "出荷型でない依頼の節がある" "$SHIP" "^### When the request is not shippable"
has "委譲先の result: を中間報告として扱う節がある" "$SHIP" "^### Treat a delegate's .result:. as an interim report"
has "予告したまま終わらない節がある" "$SHIP" "^### Do not stop after announcing the next Phase"
has "ターンを終えてしまう書き方を名指しで禁じている" "$SHIP" "do not end a turn in any of them"
has "走行中の作業を完了扱いしない旨がある" "$SHIP" "not finished while it is still running"
ORDER="$(grep -E '^\| [1-4] \|' "$SHIP" | head -n 4 \
  | awk -F'|' '{gsub(/^ +| +$/, "", $3); gsub(/\*\*/, "", $3); print $3}' | tr '\n' ',')"
if [ "$ORDER" = "Up to PR (Recommended),Up to merge,Implementation only (no PR),Issue only," ]; then
  ok "選択肢の順序が変わっていない"
else
  ng "選択肢の順序が変わっていない (実際: $ORDER)"
fi
has "共通ファイル user-language.md を参照している" "$SHIP" 'skills/_shared/user-language\.md'
[ -f "$ROOT/skills/_shared/user-language.md" ] && ok "user-language.md が同梱されている" || ng "user-language.md が同梱されている"
has "共通ファイル artifact-images.md を参照している" "$SHIP" 'skills/_shared/artifact-images\.md'
[ -f "$ROOT/skills/_shared/artifact-images.md" ] && ok "artifact-images.md が同梱されている" || ng "artifact-images.md が同梱されている"

echo
echo "SKILL.md: description は英語で、英語と日本語のトリガー例を持つ"
desc="$(head -n 5 "$SHIP" | grep -E '^description: ' | head -n 1)"
printf '%s' "$desc" | grep -qE '^description: [A-Za-z]' && ok "description が英語で始まる" || ng "description が英語で始まる"
printf '%s' "$desc" | grep -qE '"[A-Za-z][^"]*"' && ok "英語のトリガー例がある" || ng "英語のトリガー例がある"
printf '%s' "$desc" | grep -q '「' && ok "日本語のトリガー例がある" || ng "日本語のトリガー例がある"
len="$(printf '%s' "${desc#description: }" | wc -m | tr -d ' ')"
[ "$len" -le 1024 ] && ok "description が 1024 文字以内 ($len)" || ng "description が 1024 文字以内 ($len)"

echo
echo "hooks: 配布物が揃っている"
HOOKS="$ROOT/hooks/hooks.json"
# 各イベントの command が ship-gate.py であることまで見る（キーの存在だけでは、
# 別のスクリプトに差し替わっても通ってしまう）
HOOK_CMDS="$(python3 -c 'import json,sys,os
h=json.load(open(sys.argv[1]))["hooks"]
out=[]
for ev in ("UserPromptSubmit","PreToolUse","PostToolUse"):
    cmds=[x["command"] for g in h.get(ev,[]) for x in g.get("hooks",[])]
    out.append(ev+"="+",".join(os.path.basename(c) for c in cmds))
    if ev=="PostToolUse":
        out.append("matcher="+",".join(g.get("matcher","") for g in h.get(ev,[])))
print(";".join(out))' "$HOOKS")"
[ "$HOOK_CMDS" = "UserPromptSubmit=ship-gate.py;PreToolUse=ship-gate.py;PostToolUse=ship-gate.py;matcher=AskUserQuestion" ] \
  && ok "UserPromptSubmit / PreToolUse / PostToolUse(AskUserQuestion) のいずれも ship-gate.py を呼ぶ" \
  || ng "UserPromptSubmit / PreToolUse / PostToolUse(AskUserQuestion) のいずれも ship-gate.py を呼ぶ (実際: $HOOK_CMDS)"
lacks "セッション名の促しは複製しない（ship-session の担当）" "$HOOKS" 'session-name-reminder'
[ ! -f "$ROOT/hooks/session-name-reminder.py" ] && ok "session-name-reminder.py を同梱していない" || ng "session-name-reminder.py を同梱していない"
has "ship-gate.py が UserPromptSubmit を処理する" "$ROOT/hooks/ship-gate.py" 'def handle_user_prompt_submit'
has "スラッシュコマンドの形が定数にある" "$ROOT/hooks/ship-gate.py" '^SLASH_COMMANDS = \("/ship-session-jev:ship-session-jev", "/ship-session-jev"\)$'
for f in ship-gate.py jev.py ship-goal.sh rename-session.sh; do
  [ -x "$ROOT/hooks/$f" ] && ok "hooks/$f が実行可能" || ng "hooks/$f が実行可能"
done
has "ゲートを張る対象は ship-session-jev" "$ROOT/hooks/ship-gate.py" '^SHIP_SKILL = "ship-session-jev"$'
has "状態ディレクトリは ship-gate-jev" "$ROOT/hooks/ship-gate.py" '"cache", "ship-gate-jev"'
has "ship-goal.sh も同じ状態ディレクトリを見る" "$ROOT/hooks/ship-goal.sh" '"cache", "ship-gate-jev"'
has "jev.py に既定のしきい値の定数がある" "$ROOT/hooks/jev.py" '^DEFAULT_THRESHOLD = 0\.85$'
has "jev.py に既定のタイムアウトの定数がある" "$ROOT/hooks/jev.py" '^DEFAULT_TIMEOUT_MS = 800$'
has "jev.py の既定エンドポイントが公式" "$ROOT/hooks/jev.py" 'https://api\.typesafe\.ai/v1/systemone'
for v in TYPESAFE_API_KEY SHIP_JEV_ENABLED SHIP_JEV_THRESHOLD SHIP_JEV_TIMEOUT_MS SHIP_JEV_ENDPOINT; do
  has "jev.py が環境変数 $v を読む" "$ROOT/hooks/jev.py" "\"$v\""
done

echo
echo "README: 任意機能であることと設定の在り処"
for f in README.md README.ja.md; do
  R="$ROOT/$f"
  # 「ship-session」はこのプラグインの名前にも含まれるので、前提として書いた文そのものを見る
  has "$f: ship-session が前提である旨（両方入れる）" "$R" "install both|両方入れます"
  for v in TYPESAFE_API_KEY SHIP_JEV_ENABLED SHIP_JEV_THRESHOLD SHIP_JEV_TIMEOUT_MS SHIP_JEV_ENDPOINT; do
    # 設定表の行（| `変数` | 既定 | 意味 |）として書かれていること
    has "$f: $v が設定表にある" "$R" "^\| \`$v\` \|"
  done
  has "$f: 設定表のしきい値の既定が 0.85" "$R" "^\| \`SHIP_JEV_THRESHOLD\` \| \`0\.85\` \|"
  has "$f: 設定表のタイムアウトの既定が 800、上限 5000" "$R" "^\| \`SHIP_JEV_TIMEOUT_MS\` \| \`800\` \|.*5000"
  has "$f: ログの場所" "$R" "ship-gate-jev/jev\.log"
  has "$f: unspecified の説明（どれにも当てはまらない受け皿）" "$R" "none of the above|どれにも当てはまらない"
  has "$f: 質問に倒れる条件の表がある" "$R" "^\| .*(unspecified).*\| (Ask|質問する) \|"
done
has "README.md: 任意機能の節がある" "$ROOT/README.md" "^## .*optional"
has "README.ja.md: 任意機能の節がある" "$ROOT/README.ja.md" "^## .*任意"
has "plugin.json の name" "$ROOT/.claude-plugin/plugin.json" '"name": "ship-session-jev"'
has "plugin.json が ship-session を前提と書いている" "$ROOT/.claude-plugin/plugin.json" "Requires the ship-session plugin"

echo
printf 'skills_test (jev): %d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
