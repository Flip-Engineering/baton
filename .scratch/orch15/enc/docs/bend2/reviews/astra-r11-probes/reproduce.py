"""Reproduce the revision 11 review probes with the pinned compiler.

Usage: python3 docs/bend2/reviews/astra-r11-probes/reproduce.py /path/to/bend
Every invocation prints its actual output and exit status. Several probes deliberately
fail to typecheck. This driver does not judge a product test suite.
"""

import hashlib
import os
from pathlib import Path
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[4]
HERE = Path(__file__).resolve().parent
WORK = HERE / ".work"
BEND = Path(sys.argv[1]).resolve()
PIN = "3850c7cd281a687715a181ad6a2ecdef041704f320ea2b4304cf9e802309203c"
if hashlib.sha256(BEND.read_bytes()).hexdigest() != PIN:
    raise SystemExit("Compiler SHA256 does not match the review pin")
WORK.mkdir(exist_ok=True)
ENV = {**os.environ, "BEND_NO_TELEMETRY": "1", "TMPDIR": str(WORK)}
MODEL = ROOT / "docs/bend2/examples/laws-no-ledger.bend"
source = MODEL.read_text()
gate = "def gate(record: Nat, change: Outcome, target: Outcome) -> Bool:\n  breaks(change, target)"
failed = """def failed(o: Outcome) -> Bool:
  match o:
    case Passed{}: False{}
    case Failed{}: True{}
    case Absent{}: False{}

"""
negate = """def negate(b: Bool) -> Bool:
  match b:
    case True{}: False{}
    case False{}: True{}

"""
replacements = {
    "control-a": (
        "# Control A: an expected-failure list. A record above zero lists the test as expected to fail,\n"
        "# and a listed test never blocks.\n"
        + gate.replace("  breaks(change, target)", "  match record:\n    case 0n: breaks(change, target)\n    case 1n+p: False{}")
    ),
    "control-b": (
        failed + negate
        + "# Control B: a count pin. The record is the pinned failure count; the gate blocks when the\n"
        "# observed failure count differs from the pin.\n"
        + gate.replace("  breaks(change, target)", "  match record:\n    case 0n: failed(change)\n    case 1n+p: negate(failed(change))")
    ),
    "control-c": (
        failed + "# Control C: no comparison with the target. Every failure with the change blocks.\n"
        + gate.replace("  breaks(change, target)", "  failed(change)")
    ),
    "read-record": gate.replace(
        "  breaks(change, target)",
        "  match record:\n    case 0n: breaks(change, target)\n    case 1n+p: breaks(change, target)",
    ),
}
for name, replacement in replacements.items():
    (WORK / (name + ".bend")).write_text(source.replace(gate, replacement))
(WORK / "import-control-a.bend").write_text("""import Base
import ./control-a.bend as M

def main() -> Bool:
  M.landing_blocks(1n, [M.Observed{M.Failed{}, M.Passed{}}])
""")

b = (WORK / "control-b.bend").read_text()
start = b.index("    case 0n:", b.index("def gate_reads_only_observations"))
split = b.index("    case 1n+p:", start)
end = b.index("\n# The law, per landing", split)
(WORK / "control-b1.bend").write_text(
    b[:start] + b[split:end].rstrip() + "\n" + b[start:split].rstrip() + "\n" + b[end:]
)

# Both record branches compute the specification. Splitting the landing proof on
# record makes those reductions visible to the checker; the two law types are unchanged.
path = WORK / "read-record.bend"
s = path.read_text()
start = s.index("  match runs:", s.index("def landing_blocks_iff_breaks"))
end = s.index("\ndef main()", start)
body = s[start:end].rstrip()
branches = "  match record:\n"
for pattern, value in [("0n", "0n"), ("1n+p", "1n+p")]:
    branches += "    case " + pattern + ":\n"
    branches += "\n".join("    " + line.replace("record", value) for line in body.splitlines()) + "\n"
path.write_text(s[:start] + branches + "\ndef main() -> Bool:\n  landing_blocks(1n, [Observed{Failed{}, Passed{}}])\n")


def invoke(path, check=True):
    args = [str(path.relative_to(ROOT))] + (["--check-only"] if check else [])
    result = subprocess.run([str(BEND), *args], cwd=ROOT, env=ENV, text=True, capture_output=True)
    print("$ BEND_NO_TELEMETRY=1 $BEND " + " ".join(args), flush=True)
    # Diagnostic source excerpts put a space after the margin on empty lines.
    # Remove trailing horizontal whitespace when rendering the committed transcript.
    for output in [result.stdout, result.stderr]:
        print("\n".join(line.rstrip(" \t") for line in output.split("\n")), end="", flush=True)
    print("exit=" + str(result.returncode), flush=True)


print("Compiler SHA256: " + PIN, flush=True)
invoke(MODEL)
invoke(MODEL, False)
for name in ["control-a", "control-b", "control-b1", "control-c"]:
    invoke(WORK / (name + ".bend"))
invoke(WORK / "import-control-a.bend")
invoke(WORK / "read-record.bend")
invoke(WORK / "read-record.bend", False)
for name in ["forge-outcomes", "select-tests", "census-test", "forge-import", "opaque-fill", "scoped-runner", "semantics"]:
    invoke(HERE / (name + ".bend"))
    invoke(HERE / (name + ".bend"), False)
for name in ["private-runner", "opaque-runner", "opaque-forge", "empty-runner", "empty-forge", "empty-eliminate", "scoped-forge", "no-verdict", "failure-kind"]:
    invoke(HERE / (name + ".bend"))
