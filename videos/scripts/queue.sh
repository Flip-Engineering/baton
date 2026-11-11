#!/bin/sh
# render queue: at most $MAX concurrent renders; anchored pgrep so shell wrappers never count
MAX=${MAX:-4}
cd "$(dirname "$0")/.." && export NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt
for v in "$@"; do
  while [ "$(pgrep -c -f '^node web/render.mjs')" -ge "$MAX" ]; do sleep 15; done
  node web/render.mjs "$v" > "logs/r_${v}.log" 2>&1 &
  sleep 20
done
wait
for v in "$@"; do tail -n1 "logs/r_${v}.log"; done
