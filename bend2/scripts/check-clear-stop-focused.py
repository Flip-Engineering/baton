#!/usr/bin/env python3
"""Check installed clear-stop routing against an isolated copy of a fixture DB."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess


def connect_read(path, sql, params=()):
    connection = sqlite3.connect(path)
    try:
        return connection.execute(sql, params).fetchall()
    finally:
        connection.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", required=True, type=Path)
    parser.add_argument("--full-binary", required=True, type=Path)
    parser.add_argument("--schema-db", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    db = args.output / "fixture.db"
    source = sqlite3.connect("file:" + str(args.schema_db) + "?mode=ro", uri=True)
    destination = sqlite3.connect(db)
    try:
        source.backup(destination)
        for index in range(16):
            session = "focused-clear-" + str(index)
            destination.execute("INSERT INTO sessions(id,harness,model,effort,native,workspace,branch,base) VALUES(?,?,?,?,?,?,?,?)", (session,"omp","retained-model","high","native-" + session,"/retained/" + session,"retained-branch","retained-base"))
            phase = "running" if index == 12 else "exited"
            destination.execute("INSERT INTO executions(session,id,mode,directory,phase,status) VALUES(?,?,?,?,?,?)", (session,"attempt-" + session,"managed","/retained/" + session,phase,"exit 0"))
            destination.execute("INSERT INTO session_stops(session,id,reason,attempt,directory,outcome,native_status,report_id) VALUES(?,?,?,?,?,?,?,?)", (session,"stop-" + session,"retained cause","attempt-" + session,"/retained/" + session,"requested" if index == 12 else "stopped","exit 0","report-" + session))
            destination.execute("INSERT INTO messages(id,sender,recipient,kind,body) VALUES(?,?,?,?,?)", ("task-" + session,session,session,"task","Retain complete body and receipt."))
        destination.commit()
    finally:
        source.close()
        destination.close()
    env = dict(os.environ, BATON_DATABASE=str(db), BATON_SESSION="focused-clear-0")
    env.pop("CODEX_THREAD_ID", None)
    records = []
    checks = []

    def check(label, condition):
        checks.append({"label": label, "passed": bool(condition)})
        if not condition:
            raise AssertionError(label)

    def snapshot(table):
        return connect_read(db, 'SELECT * FROM "' + table + '" ORDER BY rowid')

    preserved = {table: snapshot(table) for table in ("sessions","executions","messages","usage_windows")}

    def run(label, command, selected_env=None, input_text=None):
        result = subprocess.run([str(value) for value in command], env=env if selected_env is None else selected_env, capture_output=True, text=True, input=input_text)
        records.append({"label": label, "argv": [str(value) for value in command], "exit": result.returncode, "stdout": result.stdout, "stderr": result.stderr})
        return result

    def cleared(label, command, session):
        result = run(label, command)
        check(label + "-exit", result.returncode == 0)
        check(label + "-deleted", connect_read(db,"SELECT count(*) FROM session_stops WHERE session=?",(session,)) == [(0,)])
        payload = json.loads(result.stdout)
        if isinstance(payload, list):
            check(label + "-native-result", payload[0]["status"] == "completed" and payload[0]["waitStatus"] == "exit 0")
            payload = json.loads(payload[0]["stdout"])
        check(label + "-result", payload["cleared"] is True and payload["session"] == session and payload["executionCreated"] is False and payload["providerRequest"] is False)

    binary, full = args.binary, args.full_binary
    try:
        cleared("positional-clear",[binary,db,"clear-stop","focused-clear-0"],"focused-clear-0")
        cleared("positional-resume",[binary,db,"resume","focused-clear-1","--clear-stop"],"focused-clear-1")
        cleared("positional-stop",[binary,db,"stop","focused-clear-2","--clear"],"focused-clear-2")
        cleared("explicit-actor",[binary,db,"as","focused-clear-0","clear-stop","--session","focused-clear-3"],"focused-clear-3")
        cleared("named-resume",[binary,db,"as","focused-clear-0","resume","--session","focused-clear-4","--clear-stop"],"focused-clear-4")
        cleared("named-stop",[binary,db,"as","focused-clear-0","stop","--session","focused-clear-5","--clear"],"focused-clear-5")
        cleared("implicit-context",[binary,"clear-stop","--session","focused-clear-6"],"focused-clear-6")
        cleared("current-actor",[binary,"as","focused-clear-0","resume","--session","focused-clear-7","--clear-stop"],"focused-clear-7")
        cleared("full-router",[full,db,"as","focused-clear-0","clear-stop","--session","focused-clear-8"],"focused-clear-8")
        env["BATON_SESSION"] = "focused-clear-13"
        cleared("implicit-target",[binary,"clear-stop"],"focused-clear-13")
        env["BATON_SESSION"] = "focused-clear-0"
        result = run("batch-native-results",[binary,db,"as","focused-clear-0","clear-stop","--session","focused-clear-9","and","session","--id","focused-clear-0","and","stop","--session","focused-clear-10","--clear"])
        payload = json.loads(result.stdout)
        check("batch-three-child-results", result.returncode == 0 and len(payload) == 3 and all(item["status"] == "completed" and item["waitStatus"] == "exit 0" for item in payload))
        check("batch-inspection-result","focused-clear-0" in payload[1]["stdout"])
        check("batch-two-stops-cleared",connect_read(db,"SELECT count(*) FROM session_stops WHERE session IN ('focused-clear-9','focused-clear-10')") == [(0,)])
        alias = args.output / "database-link.db"
        alias.symlink_to(db.name)
        cleared("canonical-database-alias",[binary,alias,"clear-stop","focused-clear-14"],"focused-clear-14")
        result = run("native-input-bootstrap",[binary,db,"agent-native-input"],input_text=json.dumps(["clear-stop","focused-clear-15"]))
        check("native-input-bootstrap-result",result.returncode == 0 and json.loads(result.stdout)["cleared"] is True)
        check("native-input-bootstrap-deleted",connect_read(db,"SELECT count(*) FROM session_stops WHERE session='focused-clear-15'") == [(0,)])
        result = run("unrelated-full-command",[binary,db,"session","focused-clear-0"])
        check("unrelated-full-command",result.returncode == 0 and "focused-clear-0" in result.stdout)
        before_invalid = snapshot("session_stops")
        for label, command in [
            ("conflicting-flags",[binary,db,"as","focused-clear-0","resume","--session","focused-clear-11","--clear-stop","--lift-stop"]),
            ("clear-with-reason",[binary,db,"as","focused-clear-0","stop","--session","focused-clear-11","--clear","--reason","different cause"]),
            ("positional-surplus",[binary,db,"clear-stop","focused-clear-11","extra"]),
            ("unknown-session",[binary,db,"clear-stop","unregistered-focused-session"]),
            ("live-attempt",[binary,db,"clear-stop","focused-clear-12"]),
        ]:
            result = run(label,command)
            check(label + "-refused",result.returncode != 0)
            check(label + "-preserved",snapshot("session_stops") == before_invalid)
        missing = dict(env)
        missing.pop("BATON_SESSION", None)
        result = run("missing-agent-context",[binary,"clear-stop","--session","focused-clear-11"],missing)
        check("missing-agent-context-refused",result.returncode != 0 and "context" in result.stderr.lower())
        check("missing-agent-context-preserved",snapshot("session_stops") == before_invalid)
        ordinary_help = run("ordinary-help",[binary,"help","stop"])
        check("ordinary-help-delegated",ordinary_help.returncode == 0 and "Retain an explicit stop" in ordinary_help.stdout)
        help_result = run("clear-stop-help",[full,db,"clear-stop","--help"])
        check("public-help",help_result.returncode == 0 and "clear-stop" in help_result.stdout)
        for table, before in preserved.items():
            check(table + "-preserved",snapshot(table) == before)
        connection = sqlite3.connect(db)
        try:
            connection.execute("INSERT INTO usage_windows(recorded_at,harness,model,provider,account,window,resets_at,reset_source,used_fraction,receipt,message) VALUES(1,'omp','retained-model','','','5-hour',NULL,'provider-message',1.0,'retained provider receipt','provider quota exhausted')")
            connection.commit()
        finally:
            connection.close()
        windows = snapshot("usage_windows")
        result = run("invalid-usage-reset",[full,db,"usage-window-reset","focused-clear-0","next monday","operator observed reset"])
        check("invalid-usage-reset-refused",result.returncode != 0 and snapshot("usage_windows") == windows)
        result = run("usage-reset",[full,db,"usage-window-reset","focused-clear-0","2020-01-01T00:00:00Z","operator console observation"])
        check("usage-reset-result",result.returncode == 0 and json.loads(result.stdout)["schema"] == "baton2-usage-window-reset-v1")
        after_reset = snapshot("usage_windows")
        check("usage-reset-recorded-once",len(after_reset) == len(windows) + 1 and after_reset[:-1] == windows)
        check("usage-reset-provenance",connect_read(db,"SELECT reset_source,used_fraction,receipt FROM usage_windows ORDER BY id DESC LIMIT 1") == [("operator-observation",None,"operator-observation: operator console observation")])
        for table in ("sessions","executions","messages"):
            check("usage-reset-" + table + "-preserved",snapshot(table) == preserved[table])
    finally:
        result = run("normal-shutdown",[binary,"--instance-shutdown",db])
        (args.output / "results.json").write_text(json.dumps({"binary_sha256": hashlib.sha256(binary.read_bytes()).hexdigest(),"full_binary_sha256": hashlib.sha256(full.read_bytes()).hexdigest(),"checks":checks,"commands":records,"shutdown_exit":result.returncode},indent=2) + "\n")
    check("normal-shutdown", result.returncode == 0)
    print(json.dumps({"passed":len(checks),"output":str(args.output)}))


if __name__ == "__main__":
    main()
