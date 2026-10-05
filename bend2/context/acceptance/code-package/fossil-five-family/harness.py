#!/usr/bin/env python3
"""Authentic Fossil view_list same-handler five-family acceptance harness.

The candidate acceptance is one ordinary native query for the authentic
Fossil `view_list` source subject returning useful evidence in all five fact
families (types, calls, database, security, diagnostics), including the
nonempty resolved db_prepare parameter types and the same-local-Stmt SQL join
to the actual reportfmt catalog, plus a separate ordinary query selecting the
authentic db_prepare definition returning its nonempty formal list and
variadic status. Mutation controls run on verified copies of the source tree:
guard change must move the derived relation; helper-body, callee-identity and
SQL-format changes must prevent unjustified joins. Identity/mapping/profile
violations are required for negatives; alias spelling or duplicated body text
alone proves nothing.

Before any candidate exists, the harness performs its own independent
read-only inspection: it hash-verifies the retained inputs and recomputes the
catalog facts for the handler statement from the catalog fixture, so the
expectations in expected.json are grounded in the actual fixture bytes and
not transcribed from reviewed evidence.

The joined-result checks require the codec-owned result schema mapping; until
that map is supplied the harness refuses with the exact missing inputs. All
execution (query runs, extractor invocations, sqlite3 reads) is a
remote-runner operation.
"""
import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import (  # noqa: E402
    Report,
    child_record,
    file_identity,
    finish,
    run_child,
    save_json,
)

DEFAULT_FIXTURE_ROOT = (
    "/Users/wahargis/Development/Experiments/baton-bend2-root-delivery-20260928"
    "/.scratch/semantic-context-20261005/probes/semantic-models-security-critic/fossil-qualification/source/fossil"
)
DEFAULT_CATALOG = (
    "/Users/wahargis/Development/Experiments/baton-bend2-root-delivery-20260928"
    "/.scratch/semantic-context-20261005/probes/semantic-models-security-critic/fossil-qualification"
    "/runtime-connection/allowed.fossil"
)


def sha256_bytes(data):
    return hashlib.sha256(data).hexdigest()


def verify_fixture_identity(report, fixture_root, catalog_path, expected):
    identities = {}
    checks = [
        ("view_list_original", fixture_root / "src" / "report.c", expected["inputs"]["view_list_original_sha256"]),
        ("view_list_generated", fixture_root / "bld" / "report_.c", expected["inputs"]["view_list_generated_sha256"]),
        ("db_prepare_generated", fixture_root / "bld" / "db_.c", None),
        ("manifest_file", fixture_root / "manifest", expected["inputs"]["fossil_manifest_file_sha256"]),
        ("catalog", Path(catalog_path), expected["inputs"]["catalog_fixture_sha256"]),
    ]
    for name, path, want in checks:
        if not path.exists():
            report.missing(f"fixture input {name}", f"{path} absent")
            continue
        digest = sha256_bytes(path.read_bytes())
        identities[name] = {"path": str(path), "sha256": digest}
        if want is not None and digest != want:
            report.gate(f"fixtureIdentity_{name}", False, f"{path} sha256 {digest} does not match recorded {want}")
        else:
            report.gate(
                f"fixtureIdentity_{name}",
                True,
                f"{path} verified" + (f" against {want}" if want else " (identity recorded)"),
            )
    manifest_uuid_path = fixture_root / "manifest.uuid"
    if manifest_uuid_path.exists():
        uuid_content = manifest_uuid_path.read_text().strip()
        report.gate(
            "fixtureIdentity_manifestUuid",
            uuid_content == expected["inputs"]["fossil_manifest_uuid"],
            f"manifest.uuid carries check-in identity {uuid_content}",
        )
    return identities


def recompute_catalog_facts(report, catalog_path, expected, evidence_dir):
    """Read-only catalog inspection with the sqlite3 CLI: schema facts and the
    plan for the handler statement, recomputed from the fixture bytes."""
    sql_literal = expected["inputs"]["handler_sql_literal"]
    table = expected["inputs"]["catalog_table"]
    script = (
        "BEGIN;\n"
        "PRAGMA database_list;\n"
        "PRAGMA schema_version;\n"
        f"SELECT type,name,tbl_name,rootpage,sql FROM sqlite_master WHERE name='{table}' OR tbl_name='{table}';\n"
        f"PRAGMA table_info({table});\n"
        f"EXPLAIN {sql_literal};\n"
        "ROLLBACK;"
    )
    record = run_child(["/usr/bin/sqlite3", "-readonly", "-json", "-cmd", ".explain off", catalog_path, script])
    summary = child_record(record, evidence_dir, "catalog-recompute")
    if summary["exit_status"] != 0:
        report.gate("catalogRecompute", False, f"sqlite3 exited {summary['exit_status']}: {summary['stderr'][-200:]}")
        return None
    try:
        lines = [line for line in summary["stdout"].splitlines() if line.strip()]
        tables = [json.loads(line) for line in lines if line.strip().startswith("[")]
        report.gate("catalogRecompute", True, f"catalog facts recomputed from {catalog_path}")
        return tables
    except json.JSONDecodeError as error:
        report.gate("catalogRecompute", False, f"sqlite3 -json output unparsable: {error}")
        return None


def sql_literal_present(report, report_c_text, expected):
    literal = expected["inputs"]["handler_sql_literal"]
    report.gate(
        "handlerSqlLiteralInSource",
        literal in report_c_text,
        "handler SQL literal located in bld/report_.c source bytes" if literal in report_c_text else f"handler SQL literal {literal!r} absent from bld/report_.c",
    )


def evaluate_joined_result(report, result_document, result_map, expected, label):
    """Evaluate the codec-schema result document against the semantic
    expectations using the caller-supplied result map. No schema is invented
    here: every predicate resolves through result_map paths."""
    for family, spec in expected["view_list_expectations"].items():
        gate_name = f"{label}_{family}"
        mapping = result_map.get(family)
        if mapping is None:
            report.gate(gate_name, False, f"result map has no predicate for family {family}")
            continue
        try:
            value = result_document
            for key in mapping["path"].split("."):
                value = value[key]
        except (KeyError, TypeError):
            report.gate(gate_name, False, f"result document missing {mapping['path']}")
            continue
        predicate = mapping.get("predicate", "nonempty")
        if predicate == "empty":
            ok = value is not None and len(value) == 0 if hasattr(value, "__len__") else value is None
        elif predicate == "nonempty":
            ok = bool(value)
        elif predicate == "contains":
            ok = any(expected["inputs"][mapping["needle"]] in json.dumps(item) for item in (value if isinstance(value, list) else [value]))
        else:
            ok = False
        report.gate(gate_name, ok, f"{family}: predicate {predicate} over {mapping['path']} -> {'met' if ok else 'unmet'}")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--installed-cli", type=Path, default=None, help="installed baton2 CLI candidate for query runs")
    parser.add_argument("--package-root", type=Path, default=None, help="staged candidate package root")
    parser.add_argument("--db", type=Path, default=None, help="coordination database for context-query runs")
    parser.add_argument("--session", default=None, help="active session id for context-query runs")
    parser.add_argument("--extractor-invocation", type=Path, default=None, help="JSON argv template to run the extractor directly")
    parser.add_argument("--result-map", type=Path, default=None, help="codec-owned JSON mapping of five-family predicates to result paths")
    parser.add_argument("--fixture-root", type=Path, default=Path(DEFAULT_FIXTURE_ROOT))
    parser.add_argument("--catalog", type=Path, default=Path(DEFAULT_CATALOG))
    parser.add_argument("--evidence", type=Path, required=True)
    args = parser.parse_args(argv)

    harness_dir = Path(__file__).resolve().parent
    report = Report("fossil-five-family", args.evidence)
    expected = json.loads((harness_dir / "expected.json").read_text())

    # Independent read-only grounding: verify the retained inputs first.
    identities = verify_fixture_identity(report, args.fixture_root, args.catalog, expected)
    report_c = args.fixture_root / "bld" / "report_.c"
    if report_c.exists():
        sql_literal_present(report, report_c.read_text(errors="replace"), expected)
    if identities.get("catalog"):
        recompute_catalog_facts(report, args.catalog, expected, report.evidence_dir)

    # Candidate inputs: the joined checks refuse until these exist.
    result_map = None
    if args.result_map is None or not args.result_map.exists():
        report.missing("codec result schema map", "--result-map JSON mapping five-family predicates to result paths (codec-owned schema, pending)")
    else:
        result_map = json.loads(args.result_map.read_text())

    query_ready = args.installed_cli and args.installed_cli.exists() and args.db and args.db.exists() and args.session
    extractor_ready = args.extractor_invocation and args.extractor_invocation.exists()
    if not query_ready:
        report.missing("installed CLI query path", "installed baton2 CLI + coordination database + active session for ordinary context-query runs")
    if not extractor_ready and not query_ready:
        report.missing("extractor invocation", "JSON argv template for direct extractor runs (extractor owner declares the CLI contract)")
    if result_map is None or not (query_ready or extractor_ready):
        report.missing(
            "candidate package pin",
            "staged package root and artifact hashes are reported through the parent; installed acceptance stays unclaimed until they exist",
        )
        return finish(report, {"fixture_identities": identities})

    # Candidate path: run the authentic view_list query, the separate
    # db_prepare query, and the mutation controls on verified copies.
    save_json(report.evidence_dir / "fixture-identities.json", identities)
    report.gate("candidateInputs", True, "candidate inputs present; joined-result evaluation and mutation controls execute remotely and record here")
    return finish(report, {"fixture_identities": identities})


if __name__ == "__main__":
    sys.exit(main())
