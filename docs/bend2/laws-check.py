"""Check the bounded law models, the transition witness and their negative controls
at the pinned compiler."""

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
    "examples/laws-refusal-model.bend",
    "examples/laws-decision-model.bend",
    "examples/laws-proof.bend",
    "examples/laws-transition.bend",
    "examples/laws-transition.js",
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
results[-1]["passed"] = results[-1]["passed"] and "10 TODOs found" in results[-1]["output"]
run("model proofs", [BEND, "docs/bend2/examples/laws-proof.bend", "--check-only"], ROOT, 0)
run("model run", [BEND, "docs/bend2/examples/laws-proof.bend"], ROOT, 0)
transition = run("transition witness", [BEND, "docs/bend2/examples/laws-transition.bend"], ROOT, 0)
results[-1]["passed"] = results[-1]["passed"] and "DISAGREE" not in transition.stdout
results[-1]["passed"] = results[-1]["passed"] and "8 cases compared" in transition.stdout

history = "examples/laws-history-model.bend"
worker = "examples/laws-worker-model.bend"
refusal = "examples/laws-refusal-model.bend"
decision = "examples/laws-decision-model.bend"
old_append = """  match history:
    case Nil{}: [row]
    case h <> t: h <> append_review(t, row)"""
mutations = [
    # M-5: the review append.
    ("erase prior history", history, old_append, "  [row]", "m5_prior_reviews"),
    ("drop new row", history, old_append, "  history", "m5_appended_review"),
    ("empty result", history, old_append, "  []", "m5_"),
    ("reorder rows", history, "case h <> t: h <> append_review(t, row)",
     "case h <> t: row <> append_review(t, h)", "m5_prior_reviews"),
    ("alter identity", history, "case Nil{}: [row]",
     "case Nil{}: [Row{0n, 0n, 0n, 0n, Accept{}}]", "m5_appended_review"),
    # M-10: the worker admission branch.
    ("deny workers", worker, "case Worker{}: True{}",
     "case Worker{}: False{}", "m10_worker_admitted"),
    # M-14: the refusal vocabulary.
    ("refusal field drifts", refusal,
     "def render_field(k: Check) -> Field:
  match k:
    case ClosedSet{}: Payload{}",
     "def render_field(k: Check) -> Field:
  match k:
    case ClosedSet{}: Args{}",
     "m14_field_matches_row"),
    ("refusal rule drifts", refusal,
     "def render_rule(k: Check) -> Rule:
  match k:
    case ClosedSet{}: ClosedSetRule{}",
     "def render_rule(k: Check) -> Rule:
  match k:
    case ClosedSet{}: UnknownFieldRule{}",
     "m14_rule_matches_row"),
    ("refusal remedy drifts", refusal,
     "def render_rem(k: Check) -> Remedy:
  match k:
    case ClosedSet{}: Admitted{2n}",
     "def render_rem(k: Check) -> Remedy:
  match k:
    case ClosedSet{}: Admitted{3n}",
     "m14_remedy_from_row"),
    ("refusal table drifts", refusal,
     "def table_rule(k: Check) -> Rule:
  match k:
    case ClosedSet{}: ClosedSetRule{}",
     "def table_rule(k: Check) -> Rule:
  match k:
    case ClosedSet{}: UnknownFieldRule{}",
     "m14_rule_matches_row"),
    ("refusal unredacted secret", refusal, "    case WithSecret{_}: 0n",
     "    case WithSecret{+s}: s", "m14_context_redacted"),
    # M-18: the landing decision.
    ("decision infers a remote", decision, "    case Declared{+remote}: Publish{remote}",
     "    case Declared{+remote}: Publish{0n}", "m18_dispatch_targets_declared_remote"),
    ("decision codes a publishing outcome", decision,
     "    case Publish{_}: 0n", "    case Publish{_}: 1n", "m18_declared_does_not_refuse"),
    ("decision publishes undeclared", decision,
     "    case Undeclared{}: Refuse{undeclared_code()}",
     "    case Undeclared{}: Publish{0n}", "m18_undeclared_refuses"),
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

    # The witness control: the same corpus with the host half dropping the last
    # retained row must report a disagreement, so the comparison is not vacuous.
    witness_case = scratch / "witness"
    for source in FILES:
        destination = witness_case / source
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(DOCS / source, destination)
    host = witness_case / "examples/laws-transition.js"
    host_source = host.read_text()
    anchor = "for (const review of reviews) {"
    if host_source.count(anchor) != 1:
        raise SystemExit("Witness anchor changed: dropping the last row")
    host.write_text(host_source.replace(anchor, "for (const review of reviews.slice(0, -1)) {"))
    dropped = run("witness control drops a row",
                  [BEND, str(witness_case / "examples/laws-transition.bend")], ROOT, 0)
    results[-1]["passed"] = results[-1]["passed"] and "DISAGREE" in dropped.stdout

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
    "scope": "Pure models, the transition witness and two existing JavaScript regression rows; application laws remain open.",
    "compiler": str(BEND),
    "sha256": {name: hashlib.sha256((DOCS / name).read_bytes()).hexdigest() for name in FILES},
    "results": results,
}
print(json.dumps(report, indent=2))
raise SystemExit(0 if all(row["passed"] for row in results) else 1)
