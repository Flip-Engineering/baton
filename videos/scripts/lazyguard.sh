#!/bin/sh
# Stop git's lazy blob downloads (promisor fetches from blobless clones) when the disk is nearly full.
# 2 Oct 18:50: an agent's `git show --stat` on a blobless archive clone pulled ~450 MB of video blobs and took the disk to 15 MB.
# farm.py's own small fetches (its cache is ~/.cache/acp-farm) are left alone.
end=$(( $(date +%s) + 7000 ))
while [ $(date +%s) -lt $end ]; do
  free=$(df -B1M --output=avail / | tail -1)
  if [ "$free" -lt 350 ]; then
    for p in $(pgrep -f 'no-write-fetch-head --recurse-submodules=no --filter=blob:none --stdin'); do
      pp=$(ps -o ppid= -p "$p" | tr -d ' '); a=$pp; skip=0
      for _ in 1 2 3 4 5 6; do   # farm.py runs git with --git-dir ~/.cache/acp-farm/...: look up the whole ancestry
        tr '\0' ' ' < "/proc/$a/cmdline" 2>/dev/null | grep -q -e acp-farm -e farm.py && { skip=1; break; }
        a=$(ps -o ppid= -p "$a" 2>/dev/null | tr -d ' '); [ -z "$a" ] || [ "$a" = 1 ] && break
      done
      [ $skip = 1 ] && continue
      echo "$(date +%H:%M:%S) free ${free}M: killed lazy fetch $p (parent: $(tr '\0' ' ' < /proc/$pp/cmdline 2>/dev/null | cut -c1-120))"; kill "$p"
    done
  fi
  sleep 5
done
