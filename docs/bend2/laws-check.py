"""Check the bounded law models and their negative controls at the pinned compiler."""

import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile


ROOT = Path(__file__).resolve().parents[2]
DOCS = ROOT / "docs/bend2"
BEND = Path(sys.argv[1]).resolve() if len(sys.argv) == 2 else Path("bend")
FILES = [
    "laws.bend",
    "examples/laws-history-model.bend",
    "examples/laws-worker-model.bend",
    "examples/laws-proof.bend",
]
ENV = {**os.environ, "BEND_NO_TELEMETRY": "1"}
results = []


def run(label, argv, cwd, expected, location=None):
    result = subprocess.run(argv, cwd=cwd, env=ENV, text=True, capture_output=True)
    output = result.stdout + result.stderr
    passed = result.returncode == expected
    if location:
        passed = passed and "- expected :" in output and "- observed :" in output
        passed = passed and location in output
    results.append({"label": label, "argv": [str(x) for x in argv],
                    "cwd": str(cwd),
                    "exit": result.returncode, "expectedExit": expected,
                    "output": output, "passed": passed})
    return result


version = run("toolchain", [BEND, "version"], ROOT, 0)
if version.stdout.strip() != "bend 2.0.25":
    raise SystemExit("Expected bend 2.0.25")

run("open obligations", [BEND, "docs/bend2/laws.bend", "--check-only"], ROOT, 1)
results[-1]["passed"] = results[-1]["passed"] and "3 TODOs found" in results[-1]["output"]
run("model proofs", [BEND, "docs/bend2/examples/laws-proof.bend", "--check-only"], ROOT, 0)
run("model run", [BEND, "docs/bend2/examples/laws-proof.bend"], ROOT, 0)

history = "examples/laws-history-model.bend"
worker = "examples/laws-worker-model.bend"
old_append = """  match history:
    case Nil{}: [row]
    case h <> t: h <> append_review(t, row)"""
mutations = [
    ("erase prior history", history, old_append, "  [row]", "m5_prior_reviews"),
    ("drop new row", history, old_append, "  history", "m5_appended_review"),
    ("empty result", history, old_append, "  []", "m5_"),
    ("reorder rows", history, "case h <> t: h <> append_review(t, row)",
     "case h <> t: row <> append_review(t, h)", "m5_prior_reviews"),
    ("alter identity", history, "case Nil{}: [row]",
     "case Nil{}: [Row{0n, 0n, 0n, 0n, Accept{}}]", "m5_appended_review"),
    ("deny workers", worker, "case Worker{}: True{}",
     "case Worker{}: False{}", "m10_worker_admitted"),
]

# All generated source, binaries and test fixtures stay under the owned laws-* path.
with tempfile.TemporaryDirectory(prefix="laws-check-", dir=DOCS / "examples") as temp:
    scratch = Path(temp)
    ENV["TMPDIR"] = str(scratch)
    for index, (label, file, before, after, location) in enumerate(mutations):
        case = scratch / str(index)
        for source in FILES:
            destination = case / source
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(DOCS / source, destination)
        path = case / file
        source = path.read_text()
        if source.count(before) != 1:
            raise SystemExit(f"Mutation anchor changed: {label}")
        path.write_text(source.replace(before, after))
        run(label, [BEND, "examples/laws-proof.bend", "--check-only"], case, 1, location)

    binary = scratch / "laws-proof"
    build = run("native build", [BEND, "docs/bend2/examples/laws-proof.bend", "-o", binary], ROOT, 0)
    if build.returncode == 0:
        run("native run", [binary], ROOT, 0)

    run("JavaScript review retention", ["node", "--test", "--test-reporter=spec",
        "--test-name-pattern=opposing reviews are both retained",
        "impl/test/swarm-state.test.mjs"], ROOT, 0)
    run("JavaScript worker admission", ["node", "--test", "--test-reporter=spec",
        "--test-name-pattern=^HC-2:",
        "impl/test/issue297-issue307-host-capacity.test.mjs"], ROOT, 0)

report = {
    "scope": "Pure models and two existing JavaScript regression rows; application laws remain open.",
    "compiler": str(BEND),
    "sha256": {name: hashlib.sha256((DOCS / name).read_bytes()).hexdigest() for name in FILES},
    "results": results,
}
print(json.dumps(report, indent=2))
raise SystemExit(0 if all(row["passed"] for row in results) else 1)
