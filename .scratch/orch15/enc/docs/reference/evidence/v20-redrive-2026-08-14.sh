#!/bin/bash
# v19 RE-DRIVE flood — the 14 GLM-casualty packs, bumped + reseated to deepseek (the measured
# survivor of the v19 storm: 0 deepseek deaths vs 14 glm deaths; glm probed alive-after but the
# re-seat follows the measurement, not the probe). Patient admissions: 150s curls, 4-min greps.
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
  CID="v20-$1"
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

fire honesty-g     impl-honesty-2026-08-14-wave-g          "docs/reference/evidence/honesty-package-2026-08-14/complete5/impl-honesty-c.wavefile"
fire lc-rd5        lifecycle-contracts-2026-08-14-wave-a-rd5 "docs/reference/evidence/lifecycle-contracts-2026-08-14/redrive5/lifecycle-contracts.wavefile"
fire collab-rd4    collab-contracts-2026-08-14-wave-b-rd4  "docs/reference/evidence/collab-contracts-2026-08-14/redrive4/collab-contracts.wavefile"
fire telemetry-d   impl-telemetry-2026-08-14-wave-d        "docs/reference/evidence/impl-telemetry-2026-08-14/redrive3/impl-telemetry.wavefile"
fire eval-c        eval-r0-2026-08-14-wave-c               "docs/reference/evidence/eval-r0-2026-08-14/redrive2/eval-r0.wavefile"
fire plan-object-c impl-plan-object-2026-08-14-wave-c      "docs/reference/evidence/impl-plan-object-2026-08-14/redrive2/impl-plan-object.wavefile"
fire accessor-c    impl-result-accessor-2026-08-14-wave-c  "docs/reference/evidence/impl-result-accessor-2026-08-14/redrive2/impl-result-accessor.wavefile"
fire readme-c      readme-split-2026-08-14-wave-c          "docs/reference/evidence/readme-split-2026-08-14/redrive2/readme-split.wavefile"
fire lch-rd3       lch-contracts-2026-08-14-wave-b-rd3     "docs/reference/evidence/lch-contracts-2026-08-14/redrive3/lch-contracts.wavefile"
fire kg-c          impl-kg-activation-2026-08-14-wave-c    "docs/reference/evidence/impl-kg-activation-2026-08-14/redrive2/impl-kg-activation.wavefile"
fire audit-147-b   audit-147-rerun-2026-08-14-wave-b       "docs/reference/evidence/audit-147-rerun-2026-08-14/redrive1/audit-147-rerun.wavefile"
fire seeds-b       contract-seeds-2026-08-14-wave-b        "docs/reference/evidence/contract-seeds-2026-08-14/redrive1/contract-seeds.wavefile"
fire pg-rd5        phase-grammar-2026-08-14-wave-a-rd5     "docs/reference/evidence/phase-grammar-2026-08-14/redrive5/phase-grammar.wavefile"
fire gate-digest-c impl-gate-digest-2026-08-14-wave-c      "docs/reference/evidence/impl-gate-digest-2026-08-14/redrive2/impl-gate-digest.wavefile"
echo "=== v20 re-drive complete ==="
