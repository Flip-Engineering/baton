"""Check the emitted operator-observation JSON from the focused usage-window store fixture."""
import json
import subprocess
import sys

binary, database, harness = sys.argv[1:]
result = subprocess.run([binary, database, harness], capture_output=True, text=True)
if result.returncode:
    raise SystemExit(result.stderr or result.stdout)
observations = []
for line in result.stdout.splitlines():
    if line.startswith('{"schema":"baton2-usage-window-observation-v1"'):
        observations.append(json.loads(line))
assert any(item == {
    "schema": "baton2-usage-window-observation-v1",
    "session": "leaf",
    "window": "5-hour",
    "resetsAt": None,
} for item in observations), result.stdout
print("usage-window-observation-json-null: ok")
