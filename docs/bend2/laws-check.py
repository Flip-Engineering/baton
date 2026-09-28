"""Check model laws, receive application laws, and their negative controls."""

import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile


ROOT = Path(__file__).resolve().parents[2]
DOCS = ROOT / "docs/bend2"
BEND = Path(sys.argv[1]).resolve() if len(sys.argv) == 2 else Path("bend")
# The corpus a mutation case carries. It holds laws.bend, the modules it imports and the
# proof file, so a mutated model is compiled exactly as the law gate compiles it.
FILES = [
    "laws.bend",
    "receive-laws.bend",
    "examples/laws-history-model.bend",
    "examples/laws-worker-model.bend",
    "examples/laws-refusal-model.bend",
    "examples/laws-decision-model.bend",
    "examples/laws-no-ledger.bend",
    "examples/laws-no-ceiling.bend",
    "examples/laws-derived-catalog.bend",
    "examples/laws-orchestrator-authority.bend",
    "examples/laws-annotation-independence.bend",
    "examples/laws-prerequisite-enabling.bend",
    "examples/laws-proof.bend",
    "examples/laws-transition.bend",
    "examples/laws-transition.js",
]
ENV = {**os.environ, "BEND_NO_TELEMETRY": "1"}
results = []


def copy_corpus(case):
    """Preserve the application laws' imports into the real runtime source."""
    docs = case / "docs/bend2"
    for source in FILES:
        destination = docs / source
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(DOCS / source, destination)
    shutil.copytree(ROOT / "bend2/src", case / "bend2/src")
    return docs


def run(label, argv, cwd, expected, location=None):
    result = subprocess.run(argv, cwd=cwd, env=ENV, text=True, capture_output=True)
    output = result.stdout + result.stderr
    passed = result.returncode == expected
    if location:
        name = re.compile(r"(?:^|\.)" + re.escape(location) + (r"\w*" if location.endswith("_") else "") + r"$")
        named_failure = False
        for diagnostic in output.split("Error:")[1:]:
            found = re.search(r"^Location:\s*(\S+)", diagnostic, re.MULTILINE)
            if found and name.search(found.group(1)):
                named_failure = "- expected :" in diagnostic and "- observed :" in diagnostic
                if named_failure:
                    break
        passed = passed and named_failure
    results.append({"label": label, "argv": [str(x) for x in argv],
                    "cwd": str(cwd),
                    "exit": result.returncode, "expectedExit": expected,
                    "output": output, "passed": passed})
    return result


version = run("toolchain", [BEND, "version"], ROOT, 0)
if version.stdout.strip() != "bend 2.0.25":
    raise SystemExit("Expected bend 2.0.25")

run("open obligations", [BEND, "docs/bend2/laws.bend", "--check-only"], ROOT, 1)
run("model proofs", [BEND, "docs/bend2/examples/laws-proof.bend", "--check-only"], ROOT, 0)
run("receive application proofs", [BEND, "docs/bend2/receive-laws.bend", "--check-only"], ROOT, 0)
run("model run", [BEND, "docs/bend2/examples/laws-proof.bend"], ROOT, 0)
transition = run("transition witness", [BEND, "docs/bend2/examples/laws-transition.bend"], ROOT, 0)
results[-1]["passed"] = results[-1]["passed"] and "DISAGREE" not in transition.stdout

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
     "def render_field(k: Check) -> Field:\n  match k:\n    case UnknownField{}: Args{}\n    case ClosedSet{}: Payload{}",
     "def render_field(k: Check) -> Field:\n  match k:\n    case UnknownField{}: Args{}\n    case ClosedSet{}: Args{}",
     "m14_field_matches_row"),
    ("refusal rule drifts", refusal,
     "def render_rule(k: Check) -> Rule:\n  match k:\n    case UnknownField{}: UnknownFieldRule{}\n    case ClosedSet{}: ClosedSetRule{}",
     "def render_rule(k: Check) -> Rule:\n  match k:\n    case UnknownField{}: UnknownFieldRule{}\n    case ClosedSet{}: UnknownFieldRule{}",
     "m14_rule_matches_row"),
    ("refusal remedy drifts", refusal,
     "def render_rem(k: Check) -> Remedy:\n  match k:\n    case UnknownField{}: Unknown{}\n    case ClosedSet{}: Admitted{2n}",
     "def render_rem(k: Check) -> Remedy:\n  match k:\n    case UnknownField{}: Unknown{}\n    case ClosedSet{}: Admitted{3n}",
     "m14_remedy_from_row"),
    ("refusal table drifts", refusal,
     "def table_rule(k: Check) -> Rule:\n  match k:\n    case UnknownField{}: UnknownFieldRule{}\n    case ClosedSet{}: ClosedSetRule{}",
     "def table_rule(k: Check) -> Rule:\n  match k:\n    case UnknownField{}: UnknownFieldRule{}\n    case ClosedSet{}: UnknownFieldRule{}",
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
        docs = copy_corpus(case)
        path = docs / file
        source = path.read_text()
        if source.count(before) != 1:
            raise SystemExit(f"Mutation anchor changed: {label}")
        path.write_text(source.replace(before, after))
        run(label, [BEND, "docs/bend2/examples/laws-proof.bend", "--check-only"], case, 1, location)

    # Mutate the production dispatch that the receive laws import.
    receive_mutations = [
        ("busy receive runs its continuation",
         'case None{}: receive_status(db,session,"queued")',
         'case None{}: again(Unit{})',
         "busy_receive_only_reports_queued"),
        ("receive recovery starts another process",
         "P.ProcessChild.attach(directory)",
         'P.ProcessChild.spawn(directory,".","")',
         "recovery_attaches_recorded_attempt"),
    ]
    for index, (label, before, after, location) in enumerate(receive_mutations):
        case = scratch / ("receive-" + str(index))
        copy_corpus(case)
        path = case / "bend2/src/coordinator/receive.bend"
        source = path.read_text()
        if source.count(before) != 1:
            raise SystemExit(f"Mutation anchor changed: {label}")
        path.write_text(source.replace(before, after))
        run(label, [BEND, "docs/bend2/receive-laws.bend", "--check-only"], case, 1, location)

    # The witness control: the same corpus with the host half dropping the last
    # retained row must report a disagreement, so the comparison is not vacuous.
    witness_case = scratch / "witness"
    witness_docs = copy_corpus(witness_case)
    host = witness_docs / "examples/laws-transition.js"
    host_source = host.read_text()
    anchor = "for (const review of reviews) {"
    if host_source.count(anchor) != 1:
        raise SystemExit("Witness anchor changed: dropping the last row")
    host.write_text(host_source.replace(anchor, "for (const review of reviews.slice(0, -1)) {"))
    dropped = run("witness control drops a row",
                  [BEND, str(witness_docs / "examples/laws-transition.bend")], ROOT, 0)
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
    "scope": "Pure models, receive admission and recovery IO laws over runtime code, their negative controls, the transition witness and two JavaScript regressions. Native lock and keeper semantics require host process tests.",
    "compiler": str(BEND),
    "sha256": {name: hashlib.sha256((DOCS / name).read_bytes()).hexdigest() for name in FILES},
    "applicationSha256": {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest()
                          for path in sorted((ROOT / "bend2/src").rglob("*")) if path.is_file()},
    "results": results,
}
print(json.dumps(report, indent=2))
raise SystemExit(0 if all(row["passed"] for row in results) else 1)
