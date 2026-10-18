#!/usr/bin/env python3
"""Run the focused Bend2 agent-input settlement fixture against a private database."""
import pathlib
import subprocess
import sys
import tempfile

def main():
    if len(sys.argv) != 2:
        raise SystemExit("usage: run_agent_input_settlement_fixture.py FIXTURE_EXECUTABLE")
    executable = pathlib.Path(sys.argv[1]).resolve(strict=True)
    with tempfile.TemporaryDirectory(prefix="baton-agent-input-settlement-") as directory:
        database = pathlib.Path(directory) / "settlement.sqlite"
        result = subprocess.run(
            [str(executable), str(database)],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
    if result.returncode != 0:
        sys.stderr.write(result.stdout)
        sys.stderr.write(result.stderr)
        raise SystemExit(f"settlement fixture exited {result.returncode}")
    if result.stdout != "fixture-agent-input-settlement-ok\n" or result.stderr:
        sys.stderr.write(result.stdout)
        sys.stderr.write(result.stderr)
        raise SystemExit("settlement fixture returned unexpected output")
    print("agent-input-settlement: PASS")

if __name__ == "__main__":
    main()
