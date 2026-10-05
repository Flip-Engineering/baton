#!/usr/bin/env python3
"""Native fixture driver for the managed-context lifecycle modules.

Builds bend2/tests/context-lifecycle.bend with the pinned Bend 2.0.25 compiler,
creates a throwaway coordination database, its copy and a private log directory,
runs the fixture and asserts every observation it prints. With
CONTEXT_LIFECYCLE_MUTATIONS=1 it additionally removes one law's proof and applies
two implementation mutations, requiring each compile to fail and to name the law
the change breaks.

The fixture writes no production state: every path it touches lives under
.scratch/context-lifecycle/.
"""

import hashlib
import json
import os
import pathlib
import shutil
import sqlite3
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
WORK = ROOT / ".scratch" / "context-lifecycle"
ENTRY = ROOT / "bend2" / "tests" / "context-lifecycle.bend"
COMPILER = pathlib.Path(
    os.environ.get(
        "BEND",
        ROOT
        / ".scratch/native-artifact-qualification-20261002T174637Z/toolchain-home/bin/bend",
    )
)
FAILURES = []


def check(condition, label, detail=""):
    if not condition:
        FAILURES.append(f"{label}: {detail}")


def run(argv, **kwargs):
    env = dict(os.environ, BEND_NO_TELEMETRY="1")
    return subprocess.run(argv, capture_output=True, text=True, env=env, **kwargs)


def build(output):
    result = run([str(COMPILER), str(ENTRY), "-o", str(output.with_suffix(".c"))])
    if result.returncode != 0:
        print(result.stdout)
        print(result.stderr, file=sys.stderr)
        raise SystemExit(f"bend compile failed with exit {result.returncode}")
    link = run(["clang", "-O1", "-pthread", str(output.with_suffix(".c")), "-lsqlite3", "-lm", "-o", str(output)])
    if link.returncode != 0:
        print(link.stderr, file=sys.stderr)
        raise SystemExit(f"clang link failed with exit {link.returncode}")


def make_databases(db, copy):
    db.parent.mkdir(parents=True, exist_ok=True)
    for path in (db, copy):
        if path.exists():
            path.unlink()
    connection = sqlite3.connect(str(db))
    connection.execute("CREATE TABLE seed(a INTEGER)")
    connection.execute("INSERT INTO seed VALUES(1)")
    connection.commit()
    connection.close()
    shutil.copyfile(db, copy)
    with sqlite3.connect(str(copy)) as other:
        other.execute("INSERT INTO seed VALUES(2)")
        other.commit()


def observations(text):
    values = {}
    for line in text.splitlines():
        if "=" in line:
            key, value = line.split("=", 1)
            values[key] = value
    return values


def sha256_text(value):
    return hashlib.sha256(value.encode()).hexdigest()


def check_identity(values):
    identity = '["context-role","/work/coord.sqlite","query","q7","starter","0"]'
    check(values.get("identity.starter") == identity, "identity.starter", values.get("identity.starter"))
    check(values.get("identity.distinct") == "true", "identity.distinct", values.get("identity.distinct"))
    check(values.get("identity.admitted") == "true", "identity.admitted", values.get("identity.admitted"))
    check(values.get("identity.rejected") == "false", "identity.rejected", values.get("identity.rejected"))
    check(values.get("lock.name") == "g.lock-303066666135", "lock.name", values.get("lock.name"))
    check(values.get("lock.length") == "19", "lock.length", values.get("lock.length"))
    check(values.get("anchor") == "/work/log/g", "anchor", values.get("anchor"))
    check(values.get("directory") == "/work/log/abc", "directory", values.get("directory"))


def check_progress(values):
    check(
        values.get("progress.empty")
        == '{"cleanup":"notRequested","control":"unobserved","phase":"running","waitingFor":[]}',
        "progress.empty",
        values.get("progress.empty"),
    )
    check(
        values.get("progress.waiting")
        == '{"cleanup":"pending","control":"available","phase":"waiting","waitingFor":[{"kind":"providerResponse"}]}',
        "progress.waiting",
        values.get("progress.waiting"),
    )
    check(
        values.get("progress.diagnostics")
        == '[{"kind":"clangdDiagnostics","reason":"diagnosticsUnobserved","uri":"file:///a.c","version":3}]',
        "progress.diagnostics",
        values.get("progress.diagnostics"),
    )
    check(values.get("progress.noroles") == "null", "progress.noroles", values.get("progress.noroles"))
    check(values.get("cleanup.intentless") == "notRequested", "cleanup.intentless", values.get("cleanup.intentless"))
    check(values.get("cleanup.unreconciled") == "unavailable", "cleanup.unreconciled", values.get("cleanup.unreconciled"))
    check(values.get("cleanup.pending") == "pending", "cleanup.pending", values.get("cleanup.pending"))
    check(values.get("cleanup.complete") == "complete", "cleanup.complete", values.get("cleanup.complete"))
    check(values.get("settled.owed") == "false", "settled.owed", values.get("settled.owed"))
    check(values.get("settled.clean") == "true", "settled.clean", values.get("settled.clean"))
    check(values.get("state.terminal") == "true", "state.terminal", values.get("state.terminal"))
    check(values.get("state.late") == "complete", "state.late", values.get("state.late"))
    check(values.get("state.forward") == "running", "state.forward", values.get("state.forward"))


def check_admission(values):
    expected = {
        "owner.active": "true",
        "owner.stopped.ordinary": "false",
        "owner.stopped.control": "true",
        "owner.stopped.runtime": "true",
        "owner.foreign": "false",
        "lifecycle.ready.all": "true",
        "lifecycle.ready.missing": "false",
        "delivery.attempt": "attempted",
        "delivery.ack": "acknowledged",
        "delivery.unknown": "unknown",
        "signal.order": "SIGKILL",
        "bound.document": '{"birth":"3","device":"1","file":"2","path":"/x","scheme":"dev-ino-birth","version":1,"vfs":"unix"}',
        "bound.tuple": "dev-ino-birth|1|1|2|3",
    }
    for key, want in expected.items():
        check(values.get(key) == want, key, values.get(key))
    for key in ("refusal.prepare", "refusal.uncertain", "refusal.rejected", "rejection.error"):
        try:
            json.loads(values.get(key, ""))
        except ValueError as error:
            check(False, key, f"not JSON: {error}")
    rejected = json.loads(values.get("refusal.rejected", "{}"))
    check(rejected.get("error") == "admissionRejected", "refusal.rejected.error", rejected.get("error"))
    check(rejected.get("next") == ["context-result", "q9"], "refusal.rejected.next", rejected.get("next"))
    prepare = json.loads(values.get("refusal.prepare", "{}"))
    check(prepare.get("error") == "hostPreparationFailed", "refusal.prepare.error", prepare.get("error"))
    check(prepare.get("condition", {}).get("stage") == "spool", "refusal.prepare.stage", prepare.get("condition"))
    check(prepare.get("condition", {}).get("code") is None, "refusal.prepare.code", prepare.get("condition"))
    check(
        prepare.get("next") == ["context-query-file", "root", "q9", "-"],
        "refusal.prepare.next",
        prepare.get("next"),
    )
    uncertain = json.loads(values.get("refusal.uncertain", "{}"))
    check(uncertain.get("condition", {}).get("decision") == "unverified", "refusal.uncertain.decision", uncertain)
    check(uncertain.get("next") == ["context-result", "q9"], "refusal.uncertain.next", uncertain.get("next"))
    check(
        json.loads(values.get("rejection.notice.id", "null")) == ["context-admission-rejected", "q9"],
        "rejection.notice.id",
        values.get("rejection.notice.id"),
    )


def check_host(values, db, log):
    check(values.get("anchor.canonical") == str(pathlib.Path(log).resolve() / "g"), "anchor.canonical", values.get("anchor.canonical"))
    check(values.get("key.abc") == sha256_text("abc"), "key.abc", values.get("key.abc"))
    check(values.get("key.abc") is not None and len(values.get("key.abc", "")) == 64, "key.abc length", values.get("key.abc"))
    check(values.get("lock.acquired") == "true", "lock.acquired", values.get("lock.acquired"))
    want_lock = str(pathlib.Path(log).resolve() / ("g.lock-" + values.get("key.abc", "")))
    check(values.get("lock.found") == want_lock, "lock.found", f"{values.get('lock.found')} != {want_lock}")
    binding = values.get("binding.original")
    try:
        parsed = json.loads(binding)
    except (ValueError, TypeError) as error:
        check(False, "binding.original", f"not JSON: {error}")
        return
    check(parsed.get("scheme") == "dev-ino-birth", "binding.scheme", parsed.get("scheme"))
    check(parsed.get("path") == os.path.realpath(db), "binding.path", parsed.get("path"))
    check(values.get("bound.rows") == "1", "bound.rows", values.get("bound.rows"))
    check(
        values.get("cross.result.error", "").startswith("context database binding mismatch:"),
        "cross.result",
        values.get("cross.result.error"),
    )
    check(
        values.get("missing.result.error", "").startswith("context database binding unavailable:"),
        "missing.result",
        values.get("missing.result.error"),
    )
    check(values.get("binding.foreign.error", "") != "", "binding.foreign", values.get("binding.foreign"))


def check_store(values):
    check(values.get("setup", "") == "", "setup", values.get("setup"))
    accepted = json.loads(values.get("accept.q1", "{}"))
    check(accepted.get("state") == "accepted" and accepted.get("owner") == "root", "accept.q1", accepted)
    replayed = json.loads(values.get("replay.q1", "{}"))
    check(replayed.get("state") == "accepted", "replay.q1", replayed)
    check(values.get("conflict.q1.error", "") != "", "conflict.q1", values.get("conflict.q1"))
    complete = json.loads(values.get("publish.complete", "{}"))
    check(complete.get("state") == "complete", "publish.complete", complete)
    repeat = json.loads(values.get("publish.repeat", "{}"))
    check(repeat.get("state") == "complete", "publish.repeat", repeat)
    check(values.get("publish.late.error", "") != "", "publish.late", values.get("publish.late"))
    kept = json.loads(values.get("publish.kept", "{}"))
    check(kept.get("state") == "complete", "publish.kept", kept)
    check(kept.get("result", {}).get("engine") == "typescript", "publish.kept.result", kept.get("result"))
    refused = json.loads(values.get("reject.envelope", "{}"))
    check(refused.get("state") == "refused", "reject.envelope", refused)
    check(refused.get("result") is None, "reject.envelope.result", refused)
    check(refused.get("error", {}).get("kind") == "admissionRejected", "reject.envelope.error", refused.get("error"))
    check(refused.get("progress", {}).get("cleanup") == "pending", "reject.envelope.progress", refused.get("progress"))
    check(values.get("reject.notice", "").startswith("{"), "reject.notice", values.get("reject.notice"))


def check_roles(values):
    row = json.loads(values.get("role.row", "{}"))
    check(row.get("phase") == "prepared", "role.row.phase", row.get("phase"))
    check(row.get("cleanupPhase") == "notRequested", "role.row.cleanupPhase", row.get("cleanupPhase"))
    check(row.get("observerCursor") == "", "role.row.observerCursor", row.get("observerCursor"))
    first = json.loads(values.get("event.first", "{}"))
    check(first.get("observerCursor") == "1", "event.first", first.get("observerCursor"))
    check(first.get("capture", {}).get("path") == "/c/1", "event.first.capture", first.get("capture"))
    replay = json.loads(values.get("event.replay", "{}"))
    check(replay.get("observerCursor") == "1", "event.replay", replay.get("observerCursor"))
    check(values.get("event.stale.error", "") != "", "event.stale", values.get("event.stale"))
    check(values.get("event.absent.error", "") != "", "event.absent", values.get("event.absent"))
    check(values.get("event.notice", "").startswith("{"), "event.notice", values.get("event.notice"))
    check(values.get("intent.q1") == "0", "intent.q1", values.get("intent.q1"))


def check_admission_bound(values):
    check(values.get("admit.created") == "created:accepted:accepted", "admit.created", values.get("admit.created"))
    check(
        values.get("admit.retained") == "retained:accepted:accepted:attempt-3",
        "admit.retained",
        values.get("admit.retained"),
    )
    conflict = values.get("admit.conflict", "")
    check(conflict.startswith("retained:accepted:accepted:attempt-3"), "admit.conflict", conflict)
    check(values.get("admit.rows") == "1", "admit.rows", values.get("admit.rows"))


def check_duties(values):
    # The obligation, not a census: the query that still owes cleanup is present and
    # the query published complete with no intent is absent.
    check(values.get("duties.q1") == "true", "duties.q1", values.get("duties.q1"))
    check(values.get("duties.q4") == "false", "duties.q4", values.get("duties.q4"))
    check(values.get("duties.view", "").startswith(("rows:", "none")), "duties.view", values.get("duties.view"))


def check_runtime_rows(values):
    check(values.get("runtime.big.rows") == "1", "runtime.big.rows", values.get("runtime.big.rows"))
    check("12345678901234567890123456789012345" in values.get("runtime.big", ""), "runtime.big", values.get("runtime.big"))
    check("runtime-epoch-refused" in values.get("runtime.bad", ""), "runtime.bad", values.get("runtime.bad"))
    check(values.get("runtime.bad.rows") == "0", "runtime.bad.rows", values.get("runtime.bad.rows"))
    check(values.get("runtime.kept") == "q1", "runtime.kept", values.get("runtime.kept"))
    check(values.get("runtime.conflict.error", "") != "", "runtime.conflict", values.get("runtime.conflict"))


def check_control(values):
    control = json.loads(values.get("control.release", "{}"))
    check(control.get("state") == "complete", "control.release", control)
    result = control.get("result", {})
    check(result.get("kind") == "queryControl", "control.release.kind", result.get("kind"))
    check(result.get("controlledQuery") == "q1", "control.release.controlledQuery", result.get("controlledQuery"))
    check(result.get("state") == "complete", "control.release.state", result.get("state"))
    check(len(result.get("observations", [])) == 1, "control.release.observations", result.get("observations"))
    check(control.get("progress") is None, "control.release.progress", control.get("progress"))
    intent = json.loads(values.get("control.intent", "{}"))
    check(intent.get("signal") == "SIGTERM", "control.intent", intent)
    check(json.loads(values.get("control.kill", "{}")).get("state") == "complete", "control.kill", values.get("control.kill"))
    check(json.loads(values.get("control.downgrade", "{}")).get("state") == "complete", "control.downgrade", values.get("control.downgrade"))
    kept = json.loads(values.get("control.kept", "{}"))
    check(kept.get("signal") == "SIGKILL", "control.kept", kept)
    check(values.get("control.foreign.error", "") != "", "control.foreign", values.get("control.foreign"))
    recover = json.loads(values.get("control.recover", "{}"))
    check(recover.get("state") == "complete", "control.recover", recover)
    check(recover.get("result", {}).get("controlledQuery") == "q2", "control.recover.query", recover.get("result"))
    check(values.get("control.count") == "6", "control.count", values.get("control.count"))


MUTATIONS = [
    # The role identity stops naming its subject kind.
    (
        "bend2/src/context/identity.bend",
        'J.Jarr{J.Jstr{subject_kind(subject)},\n    J.Jarr{J.Jstr{subject_id(subject)},',
        'J.Jarr{J.Jstr{"query"},\n    J.Jarr{J.Jstr{subject_id(subject)},',
        "role_identity_is_the_canonical_array",
    ),
    # A committed terminal state becomes replaceable.
    (
        "bend2/src/context/progress.bend",
        "  Bool.not(terminal(recorded))",
        "  True{}",
        "a_committed_terminal_state_is_immutable",
    ),
    # An unreconciled role stops making cleanup unavailable.
    (
        "bend2/src/context/progress.bend",
        "Bool.pick(Cleanup, U32.is_lt(0, unreconciled), CleanupUnavailable{},",
        "Bool.pick(Cleanup, False{}, CleanupUnavailable{},",
        "an_unreconciled_role_makes_cleanup_unavailable",
    ),
    # The store stops comparing the canonical request on a repeated ID.
    (
        "bend2/src/context/store.bend",
        "AND semantic_queries.request_json=excluded.request_json",
        "AND semantic_queries.request_json=semantic_queries.request_json",
        "a_repeated_query_id_replays_only_an_identical_owner_and_request",
    ),
    # The exported duty boundary stops refusing an unreadable enumeration.
    (
        "bend2/src/context/duties.bend",
        "Bool.pick(DutyView, duty_all_valid(duty_split(rows)),",
        "Bool.pick(DutyView, True{},",
        "an_unknown_kind_makes_the_exported_enumeration_unreadable",
    ),
    # The admission answer stops distinguishing creation from retention.
    (
        "bend2/src/context/bound-admission.bend",
        "SELECT CASE WHEN changes()=1 THEN 'created' ELSE 'retained' END",
        "SELECT CASE WHEN changes()=1 THEN 'retained' ELSE 'created' END",
        "the_admission_answer_names_what_the_transaction_did",
    ),
    # A retained answer with a different request stops being a conflict.
    (
        "bend2/src/context/bound-admission.bend",
        "Bool.and(String.eq(owner, expected_owner), String.eq(request, expected_request))",
        "Bool.and(String.eq(owner, expected_owner), True{})",
        "a_retained_answer_with_a_different_request_is_a_conflict",
    ),
]



def proof_removal_check():
    target = ROOT / "bend2/src/context/laws.bend"
    original = target.read_text()
    mutated = original.replace("def a_committed_terminal_state_is_immutable(recorded,next):\n  {==}\n", "")
    if mutated == original:
        FAILURES.append("proof removal: pattern not found")
        return
    try:
        target.write_text(mutated)
        result = run([str(COMPILER), str(ENTRY), "--check-only"])
        if result.returncode == 0:
            FAILURES.append("proof removal: the entry still compiled without the law's proof")
        elif "a_committed_terminal_state_is_immutable" not in (result.stdout + result.stderr):
            FAILURES.append("proof removal: the compiler did not name the law")
    finally:
        target.write_text(original)


def mutation_checks():
    for index, (relpath, before, after, law) in enumerate(MUTATIONS):
        target = ROOT / relpath
        original = target.read_text()
        if before not in original:
            FAILURES.append(f"mutation {index}: pattern not found in {relpath}")
            continue
        try:
            target.write_text(original.replace(before, after, 1))
            result = run([str(COMPILER), str(ENTRY), "--check-only"])
            output = result.stdout + result.stderr
            if result.returncode == 0:
                FAILURES.append(f"mutation {index}: compilation succeeded but {law} should fail")
            elif law not in output:
                FAILURES.append(f"mutation {index}: failure did not name {law}")
        finally:
            target.write_text(original)


def main():
    if not COMPILER.exists():
        raise SystemExit(f"Bend compiler not found at {COMPILER}; set BEND")
    WORK.mkdir(parents=True, exist_ok=True)
    db = WORK / "coord.sqlite"
    copy = WORK / "copy.sqlite"
    log = WORK / "log"
    if log.exists():
        shutil.rmtree(log)
    log.mkdir(parents=True)
    make_databases(db, copy)
    binary = WORK / "fixture"
    build(binary)
    result = run([str(binary), str(db), str(copy), str(log)])
    (WORK / "fixture.stdout").write_text(result.stdout)
    (WORK / "fixture.stderr").write_text(result.stderr)
    print(result.stdout, end="")
    if result.stderr:
        print(result.stderr, end="", file=sys.stderr)
    if result.returncode != 0:
        FAILURES.append(f"fixture exit {result.returncode}")
    values = observations(result.stdout)
    check_identity(values)
    check_progress(values)
    check_admission(values)
    check_host(values, str(db), str(log))
    check_store(values)
    check_admission_bound(values)
    check_roles(values)
    check_duties(values)
    check_runtime_rows(values)
    check_control(values)
    if os.environ.get("CONTEXT_LIFECYCLE_MUTATIONS") == "1":
        proof_removal_check()
        mutation_checks()
    if FAILURES:
        print(f"context-lifecycle: {len(FAILURES)} failed checks")
        for failure in FAILURES:
            print(f"  - {failure}")
        raise SystemExit(1)
    print("context-lifecycle: all checks green")


if __name__ == "__main__":
    main()
