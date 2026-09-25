#!/bin/bash
# v19 flood — the full-map re-fire on the no-clock resident (carries #210 eventsView + #221
# uncapped dispatch + #173 detached waves.run + WLS-1 + fix#4 async base-commit + #163 hardCap
# rip-out). 15 packs: 11 bumped (v18/v17-era keys burned) + 4 free. Acceptance is instant
# (#173), so the stagger is a courtesy, not a starvation defense.
cd /Users/wahargis/Development/Experiments/baton
LEDGER=.git/baton/application-v3/state/coordination/events.jsonl

resolve() { # freshest resident connection file (v19 boots a new incarnation)
  CONN=$(ls -t ~/.config/baton/connections/resident-*.json | head -1)
  SOCK=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$CONN','utf8')).socketPath)")
  TOK=$(cat "${CONN%.json}.token")
}

launch() { # $1=label $2=waveKey $3=specPath
  for i in 1 2 3; do
    CID="v19-$1-$i"
    curl -s --max-time 45 --unix-socket "$SOCK" -X POST http://baton.local/v1/commands \
      -H "Authorization: Bearer $TOK" -H "Origin: https://baton.local" -H "Content-Type: application/json" \
      -d "{\"schemaVersion\":1,\"commandId\":\"$CID\",\"idempotencyKey\":\"$CID\",\"command\":\"waves_run\",\"args\":{\"specPath\":\"$3\"},\"repoId\":\"repo-76d484205f22eed0163d8f21b8287740\",\"origin\":\"https://baton.local\"}" >/dev/null 2>&1
    for j in 1 2 3 4 5 6; do
      sleep 5
      if grep 'web.command_admitted' "$LEDGER" | grep -q "$CID"; then echo "$1 ADMITTED ($CID)"; return 0; fi
    done
  done
  echo "$1 NOT-ADMITTED after 3 attempts — investigate before continuing"; return 1
}

resolve
launch honesty-f      x "docs/reference/evidence/honesty-package-2026-08-14/complete4/impl-honesty-c.wavefile"
sleep 20
launch lc-rd4         x "docs/reference/evidence/lifecycle-contracts-2026-08-14/redrive4/lifecycle-contracts.wavefile"
sleep 20
launch collab-rd3     x "docs/reference/evidence/collab-contracts-2026-08-14/redrive3/collab-contracts.wavefile"
sleep 20
launch telemetry-c    x "docs/reference/evidence/impl-telemetry-2026-08-14/redrive2/impl-telemetry.wavefile"
sleep 20
launch lsp-d          x "docs/reference/evidence/impl-lsp-pool-2026-08-14/redrive3/impl-lsp-pool.wavefile"
sleep 20
launch eval-b         x "docs/reference/evidence/eval-r0-2026-08-14/redrive1/eval-r0.wavefile"
sleep 20
launch gate-digest-b  x "docs/reference/evidence/impl-gate-digest-2026-08-14/redrive1/impl-gate-digest.wavefile"
sleep 20
launch plan-object-b  x "docs/reference/evidence/impl-plan-object-2026-08-14/redrive1/impl-plan-object.wavefile"
sleep 20
launch accessor-b     x "docs/reference/evidence/impl-result-accessor-2026-08-14/redrive1/impl-result-accessor.wavefile"
sleep 20
launch readme-b       x "docs/reference/evidence/readme-split-2026-08-14/redrive1/readme-split.wavefile"
sleep 20
launch lch-rd2        x "docs/reference/evidence/lch-contracts-2026-08-14/redrive2/lch-contracts.wavefile"
sleep 20
launch kg-activation  x "docs/reference/evidence/impl-kg-activation-2026-08-14/redrive1/impl-kg-activation.wavefile"
sleep 20
launch audit-147      x "docs/reference/evidence/audit-147-rerun-2026-08-14/audit-147-rerun.wavefile"
sleep 20
launch contract-seeds x "docs/reference/evidence/contract-seeds-2026-08-14/contract-seeds.wavefile"
sleep 20
launch pg-rd4         x "docs/reference/evidence/phase-grammar-2026-08-14/redrive4/phase-grammar.wavefile"
echo "=== v19 flood complete; today's wave.started ==="
grep 'wave.started' "$LEDGER" | grep '2026-08-14T1[4-9]' | grep -oE 'wave:[0-9a-f]{32}' | wc -l
