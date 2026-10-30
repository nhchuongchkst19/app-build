#!/usr/bin/env bash
set -euo pipefail
node builder/tools/runner-control/src/supervisor.mjs
[[ -f "$SESSION_STATE_DIR/exit-code" ]] || { echo 'Session ended without a final result'; exit 1; }
exit "$(cat "$SESSION_STATE_DIR/exit-code")"
