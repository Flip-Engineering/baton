"""Shared machinery for the code-package acceptance harnesses.

Each harness is an independent executable acceptance gate for the staged
semantic-context package. The harnesses refuse with a structured
missing-inputs report until the named candidate artifacts exist; a refusal
never counts as a pass. Every run captures real child stdout, stderr and exit
status plus sha256 identities of inputs and outputs into a private evidence
directory. No harness runs an internal work deadline, retry ceiling or
deliberate wait; a child that hangs stays visible to the operator.

Exit codes:
  0  all gates passed on real evidence
  1  a gate failed on real evidence
  2  usage error
  3  refused: named candidate inputs are absent
"""
import argparse
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

EXIT_PASS = 0
EXIT_FAIL = 1
EXIT_USAGE = 2
EXIT_MISSING_INPUTS = 3


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def file_identity(path):
    path = Path(path)
    return {"path": str(path), "bytes": path.stat().st_size, "sha256": sha256(path)}


def save_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + f".{os.getpid()}.tmp")
    temporary.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")
    temporary.replace(path)


def run_child(argv, cwd=None, env=None):
    """Run a child process, capturing the complete stdout/stderr and exit status."""
    result = subprocess.run(
        [str(a) for a in argv],
        cwd=None if cwd is None else str(cwd),
        env=env,
        capture_output=True,
    )
    return {
        "argv": [str(a) for a in argv],
        "cwd": None if cwd is None else str(cwd),
        "exit_status": result.returncode,
        "stdout_bytes": result.stdout,
        "stderr_bytes": result.stderr,
    }


def child_record(record, evidence_dir, name):
    """Persist raw child output and return the summarized record for evidence."""
    stdout_path = Path(evidence_dir) / f"{name}.stdout"
    stderr_path = Path(evidence_dir) / f"{name}.stderr"
    stdout_path.write_bytes(record["stdout_bytes"])
    stderr_path.write_bytes(record["stderr_bytes"])
    return {
        "argv": record["argv"],
        "cwd": record["cwd"],
        "exit_status": record["exit_status"],
        "stdout": record["stdout_bytes"].decode("utf-8", errors="replace"),
        "stderr": record["stderr_bytes"].decode("utf-8", errors="replace"),
        "stdout_sha256": sha256(stdout_path),
        "stderr_sha256": sha256(stderr_path),
        "stdout_file": str(stdout_path),
        "stderr_file": str(stderr_path),
    }


class Report:
    """Collects gate outcomes and missing inputs for one harness run."""

    def __init__(self, harness, evidence_dir):
        self.harness = harness
        self.evidence_dir = Path(evidence_dir)
        self.evidence_dir.mkdir(parents=True, exist_ok=True)
        self.gates = []
        self.missing_inputs = []
        self.started = os.times()

    def gate(self, name, passed, detail):
        entry = {"gate": name, "passed": bool(passed), "detail": detail}
        self.gates.append(entry)
        status = "pass" if passed else "FAIL"
        print(f"[{status}] {self.harness}/{name}: {detail}", file=sys.stderr)
        return bool(passed)

    def missing(self, name, detail):
        entry = {"input": name, "detail": detail}
        self.missing_inputs.append(entry)
        print(f"[missing-input] {name}: {detail}", file=sys.stderr)

    def write(self, extra=None):
        document = {
            "harness": self.harness,
            "gates": self.gates,
            "missing_inputs": self.missing_inputs,
            "outcome": self.outcome(),
            "evidence_dir": str(self.evidence_dir),
        }
        if extra:
            document.update(extra)
        save_json(self.evidence_dir / "evidence.json", document)
        return document

    def outcome(self):
        if self.missing_inputs and not any(g["passed"] is False for g in self.gates):
            return "refused-missing-inputs"
        if any(g["passed"] is False for g in self.gates):
            return "fail"
        if self.missing_inputs:
            return "incomplete-missing-inputs"
        return "pass"

    def exit_code(self):
        outcome = self.outcome()
        if outcome == "pass":
            return EXIT_PASS
        if outcome == "refused-missing-inputs":
            return EXIT_MISSING_INPUTS
        return EXIT_FAIL


def finish(report, extra=None):
    document = report.write(extra)
    print(json.dumps({"outcome": document["outcome"], "evidence": document["evidence_dir"]}))
    return report.exit_code()


def no_node_modules_above(directory):
    """Walk from directory toward the filesystem root and report ancestor node_modules."""
    offenders = []
    current = Path(directory).resolve()
    while True:
        candidate = current / "node_modules"
        if candidate.exists():
            offenders.append(str(candidate))
        parent = current.parent
        if parent == current:
            break
        current = parent
    return offenders


def scrubbed_env():
    """Environment for isolated child runs: no Node resolution or development leakage."""
    env = {
        "PATH": "/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin",
        "HOME": os.environ.get("HOME", "/tmp"),
        "TMPDIR": os.environ.get("TMPDIR", "/tmp"),
        "USER": os.environ.get("USER", ""),
    }
    return env
