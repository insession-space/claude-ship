#!/bin/bash
#  このリポジトリの全テストを順に回し、終了コードを 1 行ずつ出す。
#
#    使い方: plugins/ship-session-jev/tests/run_all.sh
#
#  緑の判定は終了コードだけで行う（出力の grep はしない）。
#  ship-session-jev は ship-session を変更しない前提なので、両方のテストを一緒に見る。
set -uo pipefail

REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
STATUS=0
for t in \
  plugins/ship-session-jev/tests/jev_test.sh \
  plugins/ship-session-jev/tests/gate_test.sh \
  plugins/ship-session-jev/tests/skills_test.sh \
  plugins/ship-session/tests/gate_test.sh \
  plugins/ship-session/tests/hooks_test.sh \
  plugins/ship-session/tests/skills_test.sh \
  plugins/graph-workflow/tests/skill_test.sh; do
  out="$(bash "$REPO/$t" 2>&1)"
  code=$?
  summary="$(printf '%s\n' "$out" | grep -E 'pass=|passed' | tail -n 1)"
  printf '%s exit=%d  %s\n' "$t" "$code" "$summary"
  if [ "$code" -ne 0 ]; then
    STATUS=1
    printf '%s\n' "$out" | grep -E 'FAIL' | sed 's/^/    /'
  fi
done
exit "$STATUS"
