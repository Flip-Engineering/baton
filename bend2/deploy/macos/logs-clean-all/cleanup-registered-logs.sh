#!/bin/sh
set -eu
umask 077
release_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
helper=$release_dir/libexec/baton2/logs-clean-all
if [ "$#" -ne 2 ]; then
  echo "usage: cleanup-registered-logs DATABASE JOB_ID" >&2
  exit 64
fi
database=$1
job_id=$2
case "$job_id" in
  ''|*[!A-Za-z0-9._-]*) echo "invalid job id" >&2; exit 64 ;;
esac
if [ -L "$database" ] || [ ! -f "$database" ]; then
  echo "database must be an existing regular file: $database" >&2
  exit 66
fi
if [ ! -x "$helper" ]; then
  echo "cleanup helper is unavailable: $helper" >&2
  exit 69
fi
log_root=${HOME:?}/Library/Logs/Baton2/logs-clean-all
log_dir=$log_root/$job_id
mkdir -p "$log_dir"
chmod 700 "$log_root" "$log_dir"
find "$log_dir" -type f -name 'run-*.json' -mtime +30 -delete
find "$log_dir" -type f -name 'run-*.failed' -mtime +30 -delete
find "$log_dir" -type f -name '.run.*' -mtime +1 -delete
day=$(/bin/date -u '+%Y-%m-%d')
tmp=$log_dir/.run.$$.tmp
if "$helper" "$database" >"$tmp" 2>&1; then
  mv -f "$tmp" "$log_dir/run-$day.json"
else
  status=$?
  mv -f "$tmp" "$log_dir/run-$day.failed"
  exit "$status"
fi
