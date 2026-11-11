#!/bin/bash
# v19 straggler re-fire — patient: per pack, skip if the wave key already started, fire with a
# 150s curl, then poll up to 4 min for admission. The bus drops requests whose client disconnects,
# so the curl must OUTLIVE the queue (the v19 flood's 45s curls died queued — the measured loss).
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
  CID="v19r-$1"
  curl -s --max-time 150 --unix-socket "$SOCK" -X POST http://baton.local/v1/commands \
    -H "Authorization: Bearer $TOK" -H "Origin: https://baton.local" -H "Content-Type: application/json" \
    -d "{\"schemaVersion\":1,\"commandId\":\"$CID\",\"idempotencyKey\":\"$CID\",\"command\":\"waves_run\",\"args\":{\"specPath\":\"$3\"},\"repoId\":\"repo-76d484205f22eed0163d8f21b8287740\",\"origin\":\"https://baton.local\"}" >/dev/null 2>&1
  for i in $(seq 1 16); do
    sleep 15
    if grep 'web.command_admitted' "$L" | grep -q "$CID"; then echo "$1 ADMITTED ($CID)"; return 0; fi
    if node -e "
      const fs=require('fs');
      for(const l of fs.readFileSync('$L','utf8').trim().split('\n')){ try{const e=JSON.parse(l);
        if(e.payload?.kind==='wave.started'&&(e.payload?.idempotencyKey??'')==='$2') process.exit(0)}catch{} }
      process.exit(1)"; then echo "$1 STARTED (admission event missed, wave live)"; return 0; fi
  done
  echo "$1 STILL UNADMITTED after 4 patient minutes — flag for orchestrator"
  return 1
}

fire gate-digest-b  impl-gate-digest-2026-08-14-wave-b      "docs/reference/evidence/impl-gate-digest-2026-08-14/redrive1/impl-gate-digest.wavefile"
fire plan-object-b  impl-plan-object-2026-08-14-wave-b     "docs/reference/evidence/impl-plan-object-2026-08-14/redrive1/impl-plan-object.wavefile"
fire accessor-b     impl-result-accessor-2026-08-14-wave-b "docs/reference/evidence/impl-result-accessor-2026-08-14/redrive1/impl-result-accessor.wavefile"
fire readme-b       readme-split-2026-08-14-wave-b         "docs/reference/evidence/readme-split-2026-08-14/redrive1/readme-split.wavefile"
fire lch-rd2        lch-contracts-2026-08-14-wave-b-rd2    "docs/reference/evidence/lch-contracts-2026-08-14/redrive2/lch-contracts.wavefile"
fire kg-activation  impl-kg-activation-2026-08-14-wave-b   "docs/reference/evidence/impl-kg-activation-2026-08-14/redrive1/impl-kg-activation.wavefile"
fire audit-147      audit-147-rerun-2026-08-14-wave-a      "docs/reference/evidence/audit-147-rerun-2026-08-14/audit-147-rerun.wavefile"
fire contract-seeds contract-seeds-2026-08-14-wave-a       "docs/reference/evidence/contract-seeds-2026-08-14/contract-seeds.wavefile"
fire pg-rd4         phase-grammar-2026-08-14-wave-a-rd4    "docs/reference/evidence/phase-grammar-2026-08-14/redrive4/phase-grammar.wavefile"
echo "=== straggler pass complete ==="
