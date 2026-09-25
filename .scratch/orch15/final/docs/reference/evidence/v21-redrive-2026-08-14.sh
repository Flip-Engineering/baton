#!/bin/bash
# v21 re-drive — the 12 v20-INCOMPLETE packs, keys+paths bumped (OPS law), all members
# re-seated to deepseek (glm died 14× under load; flash rows / pro coordinators per the
# documented v20 intent). Fired on the hub-managed resident carrying 3794b583 + 852700a5
# (tri-state authority + phantom surfacing) so start failures now arrive NAMED.
# Patient admissions per #222: 240s curls, 4-min greps.
cd /Users/wahargis/Development/Experiments/baton
CONN=$(ls -t ~/.config/baton/connections/resident-*.json | head -1)
SOCK=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$CONN','utf8')).socketPath)")
TOK=$(cat "${CONN%.json}.token")
L=.git/baton/application-v3/state/coordination/events.jsonl

fire() { # $1=label $2=waveKey $3=specPath
  if node -e "
    const fs=require('fs');
    for(const l of fs.readFileSync('$L','utf8').trim().split('\n')){ try{const e=JSON.parse(l);
      if(e.payload?.kind==='wave.started'&&(e.payload?.idempotencyKey??'')==='$2') process.exit(0)}catch{} }
    process.exit(1)"; then echo "$1 ALREADY STARTED — skip"; return 0; fi
  CID="v21-$1"
  curl -s --max-time 240 --unix-socket "$SOCK" -X POST http://baton.local/v1/commands \
    -H "Authorization: Bearer $TOK" -H "Origin: https://baton.local" -H "Content-Type: application/json" \
    -d "{\"schemaVersion\":1,\"commandId\":\"$CID\",\"idempotencyKey\":\"$CID\",\"command\":\"waves_run\",\"args\":{\"specPath\":\"$3\"},\"repoId\":\"repo-76d484205f22eed0163d8f21b8287740\",\"origin\":\"https://baton.local\"}" >/dev/null 2>&1
  for i in $(seq 1 16); do
    sleep 15
    if grep 'web.command_admitted' "$L" | grep -q "$CID"; then echo "$1 ADMITTED ($CID)"; return 0; fi
    if node -e "
      const fs=require('fs');
      for(const l of fs.readFileSync('$L','utf8').trim().split('\n')){ try{const e=JSON.parse(l);
        if(e.payload?.kind==='wave.started'&&(e.payload?.idempotencyKey??'')==='$2') process.exit(0)}catch{} }
      process.exit(1)"; then echo "$1 STARTED (wave live)"; return 0; fi
  done
  echo "$1 STILL UNADMITTED — flag for orchestrator"; return 1
}

fire honesty-g     impl-honesty-2026-08-14-wave-h          "docs/reference/evidence/honesty-package-2026-08-14/complete6/impl-honesty-c.wavefile"
fire lc-rd6        lifecycle-contracts-2026-08-14-wave-a-rd6 "docs/reference/evidence/lifecycle-contracts-2026-08-14/redrive6/lifecycle-contracts.wavefile"
fire telemetry-e   impl-telemetry-2026-08-14-wave-e        "docs/reference/evidence/impl-telemetry-2026-08-14/redrive4/impl-telemetry.wavefile"
fire eval-d        eval-r0-2026-08-14-wave-d               "docs/reference/evidence/eval-r0-2026-08-14/redrive3/eval-r0.wavefile"
fire plan-object-d impl-plan-object-2026-08-14-wave-d      "docs/reference/evidence/impl-plan-object-2026-08-14/redrive3/impl-plan-object.wavefile"
fire accessor-d    impl-result-accessor-2026-08-14-wave-d  "docs/reference/evidence/impl-result-accessor-2026-08-14/redrive3/impl-result-accessor.wavefile"
fire readme-d      readme-split-2026-08-14-wave-d          "docs/reference/evidence/readme-split-2026-08-14/redrive3/readme-split.wavefile"
fire lch-rd4       lch-contracts-2026-08-14-wave-b-rd4     "docs/reference/evidence/lch-contracts-2026-08-14/redrive4/lch-contracts.wavefile"
fire gate-digest-d impl-gate-digest-2026-08-14-wave-d      "docs/reference/evidence/impl-gate-digest-2026-08-14/redrive3/impl-gate-digest.wavefile"
fire audit-147-c   audit-147-rerun-2026-08-14-wave-c       "docs/reference/evidence/audit-147-rerun-2026-08-14/redrive2/audit-147-rerun.wavefile"
fire seeds-c       contract-seeds-2026-08-14-wave-c        "docs/reference/evidence/contract-seeds-2026-08-14/redrive2/contract-seeds.wavefile"
fire pg-rd6        phase-grammar-2026-08-14-wave-a-rd6     "docs/reference/evidence/phase-grammar-2026-08-14/redrive6/phase-grammar.wavefile"
echo "=== v21 re-drive complete ==="
