#!/bin/bash
# droste_prep.sh KEY: the pixel-free plan and the oscillator events of a chain (droste c2).
#   plan frames (visible tiles per frame) -> entrain (Kuramoto strikes) -> plan frames again (the strikes are written into frames.jsonl for the song)
cd /home/user/acp-agitprop/videos || exit 1
K=$1
rm -f out/$K/events.json
nice -n 10 python3 -m engine.droste.plan frames $K && nice -n 10 python3 -m engine.entrain $K && nice -n 10 python3 -m engine.droste.plan frames $K
echo "prep $K done"
