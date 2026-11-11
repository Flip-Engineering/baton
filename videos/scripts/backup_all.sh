#!/bin/sh
# Back up everything that would otherwise exist only on this machine (the client, 1 Oct: "we can't afford to lose
# completed work or pipeline progress"). Safe to run any time, including while jobs are mid-edit.
#   1. Pipeline: sync_repo.sh pushes the project's committed changes to flip-engineer/automated-content-pipeline main
#      (a delta sync since 8 Oct; uncommitted work is not pushed, so commit it). Skipped when nothing changed.
#   2. Review material: every videos/review folder with files newer than the last run is committed onto the archive's
#      main (flip-engineer/automated-content-pipeline-video-studies-archive) under videos/review/, without downloading the archive's
#      contents. Gate caches skipped; files over 95 MB are split into .part files.
#   sh videos/scripts/backup_all.sh            # once
#   LOOP=1800 sh videos/scripts/backup_all.sh  # every 30 min until killed (log: videos/logs/backup.log)
#   ONLY="dir1 dir2" sh videos/scripts/backup_all.sh  # push exactly these review folders
#   EXTRA="videos/out/x videos/out/y/a.jpg" sh videos/scripts/backup_all.sh  # also push these paths (files or dirs,
#      relative to the project) to the same paths on archive main, e.g. working data or unpublished drafts
P=/home/user/acp-agitprop; ARCH=https://github.com/flip-engineer/automated-content-pipeline-video-studies-archive
MARK=$P/videos/logs/.backup_mark; mkdir -p "$P/videos/logs"
run() {
  T=$(date -u +%Y%m%d-%H%M)
  echo "== backup $T"
  # 1. pipeline snapshot
  if [ -n "$(cd "$P" && git status --porcelain --untracked-files=normal -- . ':!videos/out' ':!videos/review' ':!videos/logs' | head -1)" ] \
     || [ "$(cd "$P" && git rev-parse HEAD)" != "$(cat "$P/videos/logs/.backup_head" 2>/dev/null)" ] \
     || [ ! -f "$MARK" ]; then
    (cd "$P" && sh videos/scripts/sync_repo.sh "Auto backup $T" 2>&1 | tail -2) \
      && (cd "$P" && git rev-parse HEAD > videos/logs/.backup_head)
  else echo "pipeline: no changes"; fi
  # 2. review folders changed since the last run
  NEW=""; for d in "$P"/videos/review/*/; do d=$(basename "$d"); [ "$d" = gate ] && continue
    if [ ! -f "$MARK" ] || [ -n "$(find "$P/videos/review/$d" -type f -newer "$MARK" | head -1)" ]; then NEW="$NEW $d"; fi; done
  [ -n "$ONLY" ] && NEW=" $ONLY"   # ONLY="dir1 dir2" pushes exactly these review folders (e.g. to fill a gap found by an audit)
  if [ -n "$NEW$EXTRA" ]; then
    # don't race a publish: the archive's publish-videos Action applies incoming/* to main and fails if main moves under it
    for w in $(seq 1 20); do
      # only recent incoming branches count (named incoming/MMDD-HHMMSS-...); a failed publish's stale branch doesn't block backups
      now=$(date -u +%m%d%H%M); [ -z "$(git ls-remote "$ARCH" 'refs/heads/incoming/1*' 2>/dev/null | sed 's#.*incoming/##' | awk -v n=$now '{split($0,a,"-"); t=a[1] substr(a[2],1,4); if (n - t < 40 && n >= t) print}')" ] && break
      [ $w = 1 ] && echo "review: waiting for a pending publish to land"; sleep 30
    done
    # Straight onto the archive's main (the client, 1 Oct: "In main not as separate branch"). Only main's listings are
    # fetched (--filter=blob:none --depth=1, about 1 MB); the new files are hashed in from hard links, committed on top
    # of main and pushed. Retried if a publish lands on main in between.
    B=/home/user/farm/_review/auto-$T; rm -rf "${B:?}"; mkdir -p "$B/w/videos/review"
    for d in $NEW; do cp -al "$P/videos/review/$d" "$B/w/videos/review/$d"; done
    for e in $EXTRA; do mkdir -p "$B/w/$(dirname "$e")"; cp -al "$P/$e" "$B/w/$e"; done
    find "$B/w" -type f -size +95M | while read -r f; do split -b 95m -d "$f" "$f.part" && rm "$f"; done
    (cd "$B" && git init -q --bare g && export GIT_DIR=$B/g GIT_INDEX_FILE=$B/idx GIT_NO_LAZY_FETCH=1 \
      && git remote add origin "$ARCH" && git config extensions.partialClone origin && ok=1 \
      && for i in 1 2 3; do
        git fetch -q --filter=blob:none --depth=1 origin main 2>&1 | grep -v 'negotiation\|acknowledgments'
        M=$(git rev-parse FETCH_HEAD); rm -f "$GIT_INDEX_FILE"; git read-tree "$M"
        # Only write objects for files whose content isn't already on main: a touched-but-unchanged folder (an agent's
        # checkout or copy resets mtimes) would otherwise rewrite gigabytes of identical blobs and fill the disk (1 Oct).
        git ls-tree -r "$M" -- videos | awk -F'\t' '{split($1,a," "); print a[3] "\t" $2}' > "$B/main.tsv"
        (cd "$B/w" && find videos -type f | sort > "$B/files.txt" && git hash-object --stdin-paths < "$B/files.txt" | paste - "$B/files.txt") > "$B/local.tsv"
        awk -F'\t' 'NR==FNR {m[$2]=$1; next} m[$2] != $1 {print $2}' "$B/main.tsv" "$B/local.tsv" > "$B/new.txt"
        need=$(cd "$B/w" && tr '\n' '\0' < "$B/new.txt" | xargs -0 -r du -cb 2>/dev/null | tail -1 | cut -f1); need=${need:-0}
        free=$(df -B1 --output=avail "$B" | tail -1)
        [ "$free" -gt $((need * 2 + 209715200)) ] || { echo "review: $((need/1048576)) MB to write but only $((free/1048576)) MB free; skipped"; exit 1; }
        echo "review: $(wc -l < "$B/new.txt") new or changed files ($((need/1048576)) MB) of $(wc -l < "$B/files.txt")"
        (cd "$B/w" && git hash-object -w --stdin-paths < "$B/new.txt" | paste - "$B/new.txt" | sed 's/^/100644 /') | git update-index --index-info
        C=$(echo "Auto backup $T: review folders:$NEW${EXTRA:+; extra: $EXTRA}" | git -c user.name=Claude -c user.email=noreply@anthropic.com commit-tree "$(git write-tree --missing-ok)" -p "$M")
        git -c pack.window=0 -c core.bigFileThreshold=1 push -q --no-thin origin "$C:refs/heads/main" 2>&1 | grep -v '^remote:\|negotiation\|acknowledgments'
        [ "$(git ls-remote origin refs/heads/main | cut -f1)" = "$C" ] && { echo "review: pushed to archive main ($C):$NEW"; ok=0; break; }
        sleep 20; done; exit $ok)
    ok=$?; rm -rf "${B:?}"; [ $ok = 0 ] || { echo "review: PUSH TO MAIN FAILED"; return 1; }
  else echo "review: no changes"; fi
  touch "$MARK"
}
if [ -n "$LOOP" ]; then while true; do run >> "$P/videos/logs/backup.log" 2>&1; sleep "$LOOP"; done; else run; fi
