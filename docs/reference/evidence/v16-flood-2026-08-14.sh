#!/bin/bash
# v16 flood — staggered wave launches after the P0 loop-starvation fix + resident restart.
# Each launch: fire (response may be swallowed — #202), verify wave.started in the ledger, stagger.
cd /Users/wahargis/Development/Experiments/baton
SOCK=$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.env.HOME+'/.config/baton/connections/resident-4421cf292504-672ef8abad50.json','utf8')).socketPath)")
TOK=$(cat ~/.config/baton/connections/resident-4421cf292504-672ef8abad50.token)
LEDGER=.git/baton/application-v3/state/coordination/events.jsonl

launch() { # $1=key $2=specPath
  curl -s --max-time 45 --unix-socket "$SOCK" -X POST http://baton.local/v1/commands \
    -H "Authorization: Bearer $TOK" -H "Origin: https://baton.local" -H "Content-Type: application/json" \
    -d "{\"schemaVersion\":1,\"commandId\":\"$1\",\"idempotencyKey\":\"$1\",\"command\":\"waves_run\",\"args\":{\"specPath\":\"$2\"},\"repoId\":\"repo-76d484205f22eed0163d8f21b8287740\",\"origin\":\"https://baton.local\"}" >/dev/null 2>&1
  for i in 1 2 3 4 5 6; do
    sleep 10
    if grep -q "web.admit.*$1\|web.complete.*$1" "$LEDGER"; then echo "$1 ADMITTED"; return 0; fi
  done
  echo "$1 NOT-ADMITTED (investigate before next launch)"; return 1
}

launch flood-honesty-c "docs/reference/evidence/honesty-package-2026-08-14/complete/impl-honesty-c.wavefile"
sleep 45
launch flood-lc-rd2 "docs/reference/evidence/lifecycle-contracts-2026-08-14/redrive2/lifecycle-contracts.wavefile"
sleep 45
launch flood-pg-rd2 "docs/reference/evidence/phase-grammar-2026-08-14/redrive2/phase-grammar.wavefile"
sleep 45
launch flood-lch-rd1 "docs/reference/evidence/lch-contracts-2026-08-14/redrive/lch-contracts.wavefile"
sleep 45
launch flood-collab-rd1 "docs/reference/evidence/collab-contracts-2026-08-14/redrive/collab-contracts.wavefile"
sleep 45
launch flood-wls-rd1 "docs/reference/evidence/wls-remediation-2026-08-14/redrive/wls-remediation.wavefile"
echo "=== flood complete; recent wave.started ==="
grep 'wave.started' "$LEDGER" | tail -8 | grep -oE '"ts":"[^"]+"|wave:[0-9a-f]{32}' | paste - - 2>/dev/null | tail -8
