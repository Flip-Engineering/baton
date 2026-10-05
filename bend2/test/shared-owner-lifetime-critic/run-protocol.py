#!/usr/bin/env python3
"""Compile and execute the pure lifetime module and its negative controls.

Controls use an isolated copy. The production native entry is not modified.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess


MUTATIONS = [
    ("ignore-generation", "binding_equal", "String.eq(ag,bg)", "True{}",
     "stale_generation_cannot_acquire_reference"),
    ("accept-closing", "acquire_open",
     "Refused{Closed{},Cap{binding,other,operations,acknowledged}}",
     "Changed{Cap{binding,other,Con{operation,operations},acknowledged}}",
     "closing_rejects_new_reference"),
    ("free-with-references", "reclaim_references",
     "Refused{ReferencesPending{},Cap{binding,Closing{},other,True{}}}",
     "Changed{Cap{binding,Retired{},Nil{},True{}}}",
     "outstanding_operation_prevents_reclamation"),
    ("failed-invocation-unsettled", "invocation_settled", "case other: True{}",
     "case other: False{}", "failed_invocation_is_settled"),
    ("failed-delivery-discharged", "observe_fields",
     "Notification{expected_recipient,expected_report,state,Some{failure}}",
     "Notification{expected_recipient,expected_report,Delivered{\"false-witness\"},Some{failure}}",
     "failed_delivery_keeps_wake_owed"),
    ("acceptance-discharges-notice", "observe_fields",
     "case EndpointAccepted{request}: Notification{expected_recipient,expected_report,state,error}",
     "case EndpointAccepted{request}: Notification{expected_recipient,expected_report,Delivered{request},error}",
     "endpoint_acceptance_preserves_notice"),
    ("ack-drops-references", "ack_result",
     "case Done{unit}: Cap{binding,access,operations,True{}}",
     "case Done{unit}: Cap{binding,access,Nil{},True{}}",
     "ack_keeps_outstanding_operations"),
]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--bend", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[3]
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ, BEND=str(Path(args.bend).resolve()), BEND_NO_TELEMETRY="1")
    module = Path("bend2/test/shared-owner-lifetime-critic/proposal/lifetime-protocol.bend")
    entry = Path("bend2/test/shared-owner-lifetime-critic/protocol.bend")
    original = (root / module).read_text()
    copied_root = output / "isolated"
    copied_module = copied_root / module
    copied_entry = copied_root / entry
    copied_module.parent.mkdir(parents=True, exist_ok=True)
    copied_entry.parent.mkdir(parents=True, exist_ok=True)
    copied_entry.write_bytes((root / entry).read_bytes())
    copied_module.write_text(original)

    def run(name, argv, cwd=root):
        result = subprocess.run(argv, cwd=cwd, env=env, capture_output=True)
        record = {"name": name, "argv": list(map(str, argv)), "cwd": str(cwd),
                  "exit": result.returncode, "stdout": result.stdout.decode(errors="replace"),
                  "stderr": result.stderr.decode(errors="replace")}
        if "--check-only" in argv:
            checked = (cwd / module).read_bytes()
            record["checked_module_sha256"] = hashlib.sha256(checked).hexdigest()
            (output / (name + ".source.bend")).write_bytes(checked)
        (output / (name + ".stdout")).write_bytes(result.stdout)
        (output / (name + ".stderr")).write_bytes(result.stderr)
        (output / (name + ".json")).write_text(json.dumps(record, indent=2) + "\n")
        print(json.dumps(record), flush=True)
        return result

    assert run("source", ["git", "rev-parse", "HEAD"]).returncode == 0
    compiler = run("compiler", [args.bend, "version"])
    assert compiler.returncode == 0 and compiler.stdout.strip() == b"bend 2.0.25"
    (output / "source-sha256.json").write_text(json.dumps({
        str(p): hashlib.sha256((root / p).read_bytes()).hexdigest()
        for p in [module, entry, Path(__file__).resolve().relative_to(root)]
    }, indent=2) + "\n")
    baseline = run("baseline", [args.bend, str(entry), "--check-only"], copied_root)
    assert baseline.returncode == 0
    binary = str(output / "protocol")
    built = run("build", ["sh", "bend2/scripts/build-native.sh", str(entry), binary])
    assert built.returncode == 0
    executed = run("native", [binary])
    assert executed.returncode == 0
    assert executed.stdout.decode().splitlines() == [
        "acquire=changed:open:read;", "stale=refused:stale:open:",
        "retire=changed:closing:read;", "closed=refused:closed:closing:read;",
        "busy=refused:references-pending:closing:read;", "complete=changed:closing:",
        "reclaim=changed:retired:", "failure-settled=true", "accepted-owed=true",
        "failed-owed=true", "delivered-owed=false"]

    laws = re.findall(r"^law ([A-Za-z0-9_]+):", original, re.M)
    assert laws, "No laws discovered"
    for law in laws:
        pattern = r"^def " + re.escape(law) + r"\([^\n]*\):\n(?:[ \t]+[^\n]*\n|\n)*"
        changed, removed = re.subn(pattern, "", original, flags=re.M)
        assert removed == 1, "Proof must resolve uniquely: " + law
        copied_module.write_text(changed)
        result = run("proof-" + law, [args.bend, str(entry), "--check-only"], copied_root)
        assert result.returncode != 0 and b"TODO" in result.stdout + result.stderr

    for name, function, before, after, law in MUTATIONS:
        start = original.index("def " + function + "(")
        end = original.find("\ndef ", start + 1)
        if end == -1:
            end = len(original)
        body = original[start:end]
        assert body.count(before) == 1, "Mutation must resolve uniquely: " + name
        changed = original[:start] + body.replace(before, after) + original[end:]
        copied_module.write_text(changed)
        result = run("mutation-" + name, [args.bend, str(entry), "--check-only"], copied_root)
        assert result.returncode != 0 and law.encode() in result.stdout + result.stderr
    copied_module.write_text(original)


if __name__ == "__main__":
    main()
