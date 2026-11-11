#!/bin/bash
# persistent launcher — retries a wave launch until wave.started lands (or the attempts cap).
# usage: persistent-launch.sh <wave-key-fragment> <specPath> [maxMinutes]
cd /Users/wahargis/Development/Experiments/baton
SOCK=$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.env.HOME+'/.config/baton/connections/resident-4421cf292504-672ef8abad50.json','utf8')).socketPath)")
TOK=$(cat ~/.config/baton/connections/resident-4421cf292504-672ef8abad50.token)
L=.git/baton/application-v3/state/coordination/events.jsonl
KEY="$1"; SPEC="$2"; MAXMIN="${3:-45}"
END=$((SECONDS + MAXMIN * 60)); N=0
# already started? (same-key re-fire safety)
if node -e "
const fs=require('fs');
for(const l of fs.readFileSync('$L','utf8').trim().split('\n')){ try{const e=JSON.parse(l);
if(e.kind==='driver.recorded'&&e.payload?.kind==='wave.started'&&JSON.stringify(e.payload).includes('$KEY')) process.exit(0)}catch{} }
process.exit(1)"; then echo "$KEY ALREADY STARTED — no-op"; exit 0; fi
while [ $SECONDS -lt $END ]; do
  N=$((N+1))
  CID="plaunch-$(echo "$KEY" | md5 | cut -c1-8)-$N"
  curl -s --max-time 40 --unix-socket "$SOCK" -X POST http://baton.local/v1/commands \
    -H "Authorization: Bearer $TOK" -H "Origin: https://baton.local" -H "Content-Type: application/json" \
    -d "{\"schemaVersion\":1,\"commandId\":\"$CID\",\"idempotencyKey\":\"$CID\",\"command\":\"waves_run\",\"args\":{\"specPath\":\"$SPEC\"},\"repoId\":\"repo-76d484205f22eed0163d8f21b8287740\",\"origin\":\"https://baton.local\"}" >/dev/null 2>&1 &
  CPID=$!
  for i in $(seq 1 5); do
    sleep 12
    if grep 'web.command_admitted' "$L" | grep -q "$CID"; then echo "$KEY ADMITTED (attempt $N, $CID)"; exit 0; fi
  done
  wait $CPID 2>/dev/null
  sleep 20
done
echo "$KEY FAILED to admit after $N attempts / ${MAXMIN}min"; exit 1
