#!/usr/bin/env python3
"""Exercise the coordinator build with valid, false, open and TODO laws."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile


def run_build(project, output, env):
    return subprocess.run(
        ["sh", "bend2/scripts/build-native.sh", str(output)],
        cwd=project, env=env, text=True, capture_output=True,
    )


def main():
    project = Path(__file__).resolve().parents[2]
    env = dict(os.environ, BEND_NO_TELEMETRY="1")
    env["BEND"] = str(Path(env.get("BEND", project / ".bend/bin/bend")).resolve())
    scratch = project / ".scratch/bend2-v2"
    scratch.mkdir(parents=True, exist_ok=True)
    baseline = run_build(project, scratch / "coordinator", env)
    if baseline.returncode:
        raise RuntimeError("baseline build failed:\n" + baseline.stdout + baseline.stderr)
    response = subprocess.run(
        [str(scratch / "coordinator")], cwd=project, env=env,
        text=True, capture_output=True, check=True,
    )
    expected = "Bend2 v2: work acceptance is unavailable; the session store is not implemented.\n"
    if response.stdout != expected:
        raise RuntimeError("unexpected executable response: " + repr(response.stdout))
    print("PASS: the coordinator builds and explains its unavailable capability", flush=True)

    # Each temporary tree uses the production entry and build command unchanged.
    # Reverting the mutation restores the exact bytes of the law module.
    with tempfile.TemporaryDirectory(prefix="law-build-", dir=scratch) as folder:
        trial = Path(folder)
        shutil.copytree(project / "bend2", trial / "bend2")
        law = trial / "bend2/src/coordinator/laws.bend"
        original = law.read_bytes()
        mutations = {
            "false": "\nlaw build_false:\n  {0n == 1n : Nat}\n\ndef build_false():\n  {==}\n",
            "open": "\nlaw build_open:\n  {0n == 0n : Nat}\n",
            "todo": "\nlaw build_todo:\n  {0n == 0n : Nat}\n\ndef build_todo():\n  ?TODO\n",
        }
        for name, mutation in mutations.items():
            output = trial / name
            try:
                law.write_bytes(original + mutation.encode())
                result = run_build(trial, output, env)
                diagnostics = result.stdout + result.stderr
                cause = "build_false" if name == "false" else "TODO found"
                if result.returncode == 0 or cause not in diagnostics or output.exists():
                    raise RuntimeError(f"{name} law did not refuse the build:\n{diagnostics}")
                print(f"PASS: {name} law rejects build-native.sh (exit {result.returncode})", flush=True)
            finally:
                law.write_bytes(original)
        restored = run_build(trial, trial / "restored", env)
        if restored.returncode or law.read_bytes() != original:
            raise RuntimeError("restored build failed:\n" + restored.stdout + restored.stderr)
        print("PASS: reverting the law mutations restores the native build", flush=True)


if __name__ == "__main__":
    main()
