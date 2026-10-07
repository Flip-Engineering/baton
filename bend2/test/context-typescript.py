#!/usr/bin/env python3
# Tests for the TypeScript semantic provider (bend2/context/typescript).
#
# Every provider run goes through the real entry point: a staged copy of the adapter is spawned as
# <node> <provider.mjs> with a sanitized environment and the admitted canonical request bytes on
# stdin. The staging tree contains the dependency closure itself (no symlink to an external
# install, which production containment correctly refuses) plus an ambient bait package outside
# the context tree, so containment is exercised rather than assumed.
#
# Evidence custody: every spawn writes its complete argv, stdin, stdout, stderr and exit/signal
# status into the evidence directory and nothing is truncated or deleted. No subprocess deadline is
# imposed; a gate that hangs must be reported as a hang, not silently killed.
#
# Environment:
#   BATON2_CONTEXT_NODE        node binary to run the provider (the qualified floor value is the
#                              exact 22.15.0 binary; the host Node is a separate comparison)
#   BATON2_CONTEXT_TYPESCRIPT  typescript install whose closure is staged into the package
#   BATON2_CONTEXT_EVIDENCE    evidence directory (default: <worktree>/.scratch/context-typescript-evidence)
#   BEND                       Bend 2.0.25 compiler; the law entrypoint checks require it

import json
import os
import shutil
import subprocess
import sys
import unittest
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TS_DIR = ROOT / "bend2" / "context" / "typescript"
FIXTURES = TS_DIR / "fixtures"
LIB = TS_DIR / "lib"
CONSUMER = FIXTURES / "consumer"
BEND_MODULE = ROOT / "bend2" / "src" / "context" / "typescript.bend"
BEND_LAWS = ROOT / "bend2" / "src" / "context" / "typescript-laws.bend"

NODE = Path(os.environ.get("BATON2_CONTEXT_NODE") or shutil.which("node") or "/usr/bin/false")
TYPESCRIPT = Path(os.environ.get("BATON2_CONTEXT_TYPESCRIPT", "/Users/wahargis/node_modules/typescript"))
BEND = os.environ.get("BEND", "")
EVIDENCE = Path(
    os.environ.get("BATON2_CONTEXT_EVIDENCE", ROOT / ".scratch" / "context-typescript-evidence")
)


class Run:
    def __init__(self, name, argv, stdin, result, spawn_error):
        self.name = name
        self.argv = argv
        self.stdin = stdin
        self.returncode = result.returncode if result else None
        self.signal = result and result.returncode < 0 and -result.returncode or None
        self.stdout = result.stdout if result else b""
        self.stderr = result.stderr if result else b""
        self.spawn_error = spawn_error

    @property
    def frames(self):
        return [line for line in self.stdout.split(b"\n") if line.strip()]

    @property
    def frame(self):
        if len(self.frames) != 1:
            raise AssertionError(
                f"{self.name}: expected one stdout frame, got {len(self.frames)}; "
                f"status={self.returncode} signal={self.signal} spawn={self.spawn_error} "
                f"stdout={self.stdout!r} stderr={self.stderr!r}"
            )
        return json.loads(self.frames[0])


class StagedProvider:
    """A staging tree with the dependency closure inside the package tree."""

    def __init__(self, evidence_root):
        self.root = evidence_root / f"stage-{uuid.uuid4().hex[:12]} (with space)"
        self.context = self.root / "libexec" / "baton2" / "context"
        (self.context / "typescript" / "lib").mkdir(parents=True)
        shutil.copyfile(TS_DIR / "provider.mjs", self.context / "typescript" / "provider.mjs")
        for module in sorted(LIB.glob("*.mjs")):
            shutil.copyfile(module, self.context / "typescript" / "lib" / module.name)
        # The dependency closure is copied into the package; a symlink to an external install is
        # what production containment refuses.
        package = self.context / "node_modules" / "typescript"
        package.mkdir(parents=True)
        shutil.copyfile(TYPESCRIPT / "package.json", package / "package.json")
        shutil.copytree(TYPESCRIPT / "lib", package / "lib")
        # Ambient bait: an ancestor node_modules that must never be selected.
        bait = self.root / "node_modules" / "typescript"
        bait.mkdir(parents=True)
        (bait / "package.json").write_text(
            json.dumps({"name": "typescript", "version": "0.0.0-ambient-bait", "main": "lib/typescript.js"})
        )
        (bait / "lib").mkdir()
        (bait / "lib" / "typescript.js").write_text("throw new Error('ambient bait was loaded');\n")
        self.home = self.root / "home"
        self.tmp = self.root / "tmp"
        self.home.mkdir()
        self.tmp.mkdir()
        self.counter = 0

    @property
    def entry(self):
        return self.root / "libexec" / "baton2" / "context" / "typescript" / "provider.mjs"

    def spawn(self, name, frame_bytes=b"", argv=(), cwd=None, node=None):
        self.counter += 1
        label = f"{self.counter:03d}-{name}"
        environment = {
            "PATH": "/usr/bin:/bin",
            "HOME": str(self.home),
            "TMPDIR": str(self.tmp),
            "LC_ALL": "C",
        }
        full_argv = [str(node or NODE), str(self.entry), *argv]
        (EVIDENCE / f"{label}.argv.json").write_text(json.dumps(full_argv, indent=2) + "\n")
        (EVIDENCE / f"{label}.stdin").write_bytes(frame_bytes)
        result = None
        error = None
        try:
            result = subprocess.run(
                full_argv,
                input=frame_bytes,
                capture_output=True,
                env=environment,
                cwd=str(cwd or self.root),
            )
        except OSError as failure:
            error = repr(failure)
        run = Run(label, full_argv, frame_bytes, result, error)
        (EVIDENCE / f"{label}.stdout").write_bytes(run.stdout)
        (EVIDENCE / f"{label}.stderr").write_bytes(run.stderr)
        (EVIDENCE / f"{label}.status.json").write_text(
            json.dumps(
                {
                    "returncode": run.returncode,
                    "signal": run.signal,
                    "spawnError": run.spawn_error,
                    "cwd": str(cwd or self.root),
                },
                indent=2,
            )
            + "\n"
        )
        return run

    def query(self, name, request, argv=(), cwd=None):
        run = self.spawn(name, json.dumps(request).encode("utf-8") + b"\n", argv=argv, cwd=cwd)
        if run.returncode in (0, 2):
            self.assert_single_frame(run)
            return run.frame, run
        if run.returncode == 1:
            self.assertFalse(run.frames, f"{run.name}: a failure must publish no result frame")
            self.assertTrue(run.stderr, f"{run.name}: a failure must retain stderr evidence")
            return None, run
        raise AssertionError(f"{run.name}: unexpected status {run.returncode} signal {run.signal}")

    @staticmethod
    def assert_single_frame(run):
        if len(run.frames) != 1:
            raise AssertionError(
                f"{run.name}: expected one stdout frame, got {len(run.frames)}; "
                f"status={run.returncode} stdout={run.stdout!r} stderr={run.stderr!r}"
            )


def position_request(path, line, column, select, options=None, cwd=None):
    request = {
        "version": 1,
        "engine": "typescript",
        "subject": {"kind": "position", "path": path, "line": line, "column": column},
        "select": list(select),
        "cwd": str(cwd),
    }
    if options:
        request["options"] = options
    return request


def symbol_request(path, name, select, options=None, cwd=None, container=""):
    request = {
        "version": 1,
        "engine": "typescript",
        "subject": {"kind": "symbol", "path": path, "name": name, "container": container},
        "select": list(select),
        "cwd": str(cwd),
    }
    if options:
        request["options"] = options
    return request


def facts_of(result, kind):
    return [fact for fact in result.get("facts", []) if fact["kind"] == kind]


class ProviderTest(unittest.TestCase):
    maxDiff = None

    @classmethod
    def setUpClass(cls):
        EVIDENCE.mkdir(parents=True, exist_ok=True)
        cls.provider = StagedProvider(EVIDENCE)
        cls.ts_project = FIXTURES / "ts-project"

    def test_01_engines_probe_reports_the_in_package_dependency(self):
        run = self.provider.spawn("engines", argv=["--engines"])
        self.assertEqual(run.returncode, 0, run.stderr)
        frame = run.frame
        self.assertEqual(frame["availability"], "available")
        self.assertEqual(frame["provider"]["version"], "5.9.3")
        self.assertTrue(
            frame["provider"]["path"].startswith(str(self.provider.context)),
            f"identity named a dependency outside the package: {frame['provider']['path']}",
        )
        self.assertNotIn("ambient-bait", json.dumps(frame))
        self.assertEqual(len(frame["provider"]["sha256"]), 64)
        self.assertEqual(frame["executable"], str(NODE))

    def test_02_bindings_over_a_real_typescript_project(self):
        result, run = self.provider.query(
            "bindings",
            symbol_request("src/consumer.ts", "run", ["definition", "type", "references", "calls", "callers"], cwd=self.ts_project),
        )
        self.assertEqual(run.returncode, 0, run.stderr)
        definitions = facts_of(result, "definition")
        self.assertTrue(definitions)
        self.assertTrue(definitions[0]["value"]["definitions"])
        self.assertTrue(definitions[0]["value"]["definitions"][0]["declaration"]["path"].endswith("consumer.ts"))
        types = facts_of(result, "type")
        self.assertTrue(types)
        self.assertEqual(types[0]["classification"], "checked")
        self.assertEqual(types[0]["value"]["provider"]["librarySha"], result["provider"]["librarySha"])
        self.assertEqual(types[0]["value"]["provider"]["libraryPath"], result["provider"]["libraryPath"])
        self.assertTrue(all(fact["evidence"] for fact in result["facts"]))
        calls = facts_of(result, "calls")
        self.assertTrue(calls)
        callees = [edge["callee"]["name"] for edge in calls[0]["value"]["outgoing"]]
        self.assertIn("makeMessage", callees)
        for ref in result["refs"]:
            self.assertEqual(ref["snapshotId"], result["snapshot"]["snapshotId"])

    def test_03_module_use_edges_resolve_declarations(self):
        result, run = self.provider.query(
            "module-use", symbol_request("src/consumer.ts", "run", ["dependencies"], cwd=self.ts_project)
        )
        self.assertEqual(run.returncode, 0, run.stderr)
        uses = facts_of(result, "moduleUse")
        self.assertTrue(uses)
        resolved = [use for use in uses if use["value"]["record"] is not None]
        self.assertTrue(resolved)
        record = resolved[0]["value"]["record"]
        self.assertEqual(record["schema"], "baton2.context.resolver-record.v1")
        self.assertEqual(record["snapshotId"], result["snapshot"]["snapshotId"])
        self.assertEqual(record["resolution"]["status"], "resolved")
        declaration = record["resolution"]["declaration"]
        self.assertTrue(declaration["path"].endswith(".ts"))
        self.assertEqual(len(declaration["sha256"]), 64)
        self.assertTrue(resolved[0]["value"]["aliasChain"] or resolved[0]["value"]["useSites"])
        self.assertIsInstance(resolved[0]["value"]["useSiteRef"], str)

    def test_04_unresolved_import_keeps_a_limit_and_no_record(self):
        workspace = EVIDENCE / f"unresolved-{uuid.uuid4().hex[:8]}"
        shutil.copytree(self.ts_project, workspace / "project")
        project = workspace / "project"
        (project / "src" / "util.ts").unlink()
        result, run = self.provider.query(
            "unresolved", symbol_request("src/consumer.ts", "run", ["dependencies"], cwd=project)
        )
        self.assertEqual(run.returncode, 0, run.stderr)
        unresolved = [use for use in facts_of(result, "moduleUse") if use["value"]["record"] is None]
        self.assertTrue(unresolved, "an unresolved import produced a record instead of a limit")
        self.assertTrue(unresolved[0]["limits"])

    def test_05_diagnostics_report_both_families_with_option_state(self):
        options = {"project": "tsconfig.json"}
        result, run = self.provider.query(
            "diagnostics-default",
            position_request("src/flow.ts", 0, 0, ["diagnostics"], options=options, cwd=self.ts_project),
        )
        self.assertEqual(run.returncode, 0, run.stderr)
        diagnostics = facts_of(result, "diagnostic")
        families = {fact["value"]["family"] for fact in diagnostics}
        self.assertIn("suggestion", families)
        self.assertIn("semantic", families)
        self.assertTrue(any(fact["value"]["code"] == 7027 for fact in diagnostics))
        self.assertTrue(any(fact["value"]["code"] == 2454 for fact in diagnostics))
        self.assertEqual(
            {fact["value"]["family"] for fact in facts_of(result, "diagnosticFamily")},
            {"semantic", "suggestion"},
        )
        strict, strict_run = self.provider.query(
            "diagnostics-unreachable",
            position_request("src/flow.ts", 0, 0, ["diagnostics"], options={"project": "tsconfig.unreachable.json"}, cwd=self.ts_project),
        )
        self.assertEqual(strict_run.returncode, 0, strict_run.stderr)
        unreachable = [fact for fact in facts_of(strict, "diagnostic") if fact["value"]["code"] == 7027]
        self.assertTrue(unreachable)
        self.assertTrue(all(fact["value"]["family"] == "semantic" for fact in unreachable))

    def test_06_flow_and_exception_structure(self):
        flow, run = self.provider.query(
            "flow",
            position_request("src/flow.ts", 0, 0, ["flow"], options={"project": "tsconfig.json"}, cwd=self.ts_project),
        )
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertTrue(facts_of(flow, "narrowedType"))
        self.assertTrue(facts_of(flow, "unreachableCode"))
        self.assertTrue(facts_of(flow, "definiteAssignment"))
        self.assertIn("noPublicCfg", {limit["code"] for limit in flow["limits"]})

        exceptions, run = self.provider.query(
            "exceptions",
            position_request("src/exceptions.ts", 0, 0, ["exceptions"], options={"project": "tsconfig.json"}, cwd=self.ts_project),
        )
        self.assertEqual(run.returncode, 0, run.stderr)
        throws = facts_of(exceptions, "throwSites")
        self.assertTrue(throws and throws[0]["value"]["throws"])
        self.assertTrue(any(entry["enclosing"] for entry in throws[0]["value"]["throws"]))

    def test_07_database_accesses_use_checker_identity(self):
        options = {
            "project": "tsconfig.json",
            "database": {"engine": "sqlite-schema", "path": "owned.fossil"},
            "client": {"path": "src/sql-client.d.ts", "line": 0, "column": 0},
        }
        result, run = self.provider.query(
            "sql", position_request("src/db.ts", 0, 0, ["databaseAccesses"], options=options, cwd=self.ts_project)
        )
        self.assertEqual(run.returncode, 0, run.stderr)
        records = [fact["value"]["record"] for fact in facts_of(result, "sqlCall")]
        self.assertTrue(records)
        matched = [record for record in records if record["callee"]["status"] == "resolved"]
        self.assertTrue(matched, "no call matched the admitted client declaration")
        literal = [record for record in matched if record["sql"]["status"] == "constant"]
        self.assertTrue(literal)
        self.assertIn("FROM users", literal[0]["sql"]["text"])
        self.assertIn("FROM accounts", literal[0]["sql"]["text"])
        self.assertEqual(literal[0]["statementKind"], "unknown")
        self.assertEqual(literal[0]["snapshotId"], result["snapshot"]["snapshotId"])
        self.assertEqual(len(literal[0]["callee"]["declaration"]["sha256"]), 64)
        self.assertTrue(
            any(record["callee"].get("reason") == "clientDeclarationMismatch" for record in records),
            "a same-name shadowed function was not refused",
        )
        self.assertTrue(any(record["sql"]["status"] == "dynamic" for record in records))

    def test_08_record_builder_contract_through_node(self):
        result = subprocess.run(
            [str(NODE), str(CONSUMER / "record-contract.mjs")],
            capture_output=True,
            cwd=str(CONSUMER),
        )
        (EVIDENCE / "record-contract.stdout").write_bytes(result.stdout)
        (EVIDENCE / "record-contract.stderr").write_bytes(result.stderr)
        (EVIDENCE / "record-contract.status.json").write_text(
            json.dumps({"returncode": result.returncode, "argv": [str(NODE), str(CONSUMER / "record-contract.mjs")]}, indent=2) + "\n"
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout.split(b"\n")[0])
        cases = {case["name"]: case for case in payload["cases"]}
        for name in (
            "modelUse_missing_module_digest",
            "modelUse_missing_snapshot",
            "modelUse_missing_use_site_range",
            "constantSql_empty_declaration_digest",
        ):
            self.assertTrue(cases[name]["threw"], f"{name} was accepted")
            self.assertEqual(cases[name]["error"], "TypeError")
        self.assertFalse(cases["modelUse_complete_record"]["threw"])
        self.assertFalse(cases["constantSql_dynamic_sql_keeps_its_reason"]["threw"])

    def test_09_service17_baseline_and_config_selection(self):
        baseline, run = self.provider.query(
            "baseline", position_request("src/consumer.ts", 0, 0, ["definition"], cwd=self.ts_project)
        )
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertTrue(baseline["facts"], "the baseline (no project) query returned no fact")
        self.assertIn("baselineOptions", {limit["code"] for limit in baseline["limits"]})

        workspace = EVIDENCE / f"config-{uuid.uuid4().hex[:8]}"
        project = workspace / "project"
        (project / "src").mkdir(parents=True)
        (project / "excluded").mkdir(parents=True)
        (project / "tsconfig.json").write_text(
            json.dumps(
                {
                    "compilerOptions": {"strict": True, "noEmit": True, "types": [], "typeRoots": []},
                    "include": ["src/**/*.ts"],
                    "exclude": ["excluded"],
                }
            )
        )
        (project / "src" / "a.ts").write_text("export const value: number = 1;\n")
        (project / "excluded" / "b.ts").write_text("export const other: number = 2;\n")
        included, included_run = self.provider.query(
            "config-included",
            symbol_request("src/a.ts", "value", ["definition"], options={"project": "tsconfig.json"}, cwd=project),
        )
        self.assertEqual(included_run.returncode, 0, included_run.stderr)
        self.assertTrue(included["facts"])
        excluded, excluded_run = self.provider.query(
            "config-excluded",
            symbol_request("excluded/b.ts", "other", ["definition"], options={"project": "tsconfig.json"}, cwd=project),
        )
        self.assertEqual(excluded_run.returncode, 2, excluded_run.stderr)
        self.assertEqual(excluded["error"]["condition"], "context-subject-not-in-program")

    def test_10_missing_directory_lookup_is_revalidated(self):
        driver = (
            "import { createCapture } from "
            + json.dumps(str(LIB / "capture.mjs"))
            + ";\n"
            "import { mkdirSync, writeFileSync } from 'node:fs';\n"
            "const root = process.env.BATON2_CAPTURE_ROOT;\n"
            "const missing = root + '/later';\n"
            "const capture = createCapture({ cwd: root, readRoots: [root] });\n"
            "const before = capture.directoryExists(missing);\n"
            "mkdirSync(missing, { recursive: true });\n"
            "const after = capture.revalidate();\n"
            "writeFileSync(process.env.BATON2_CAPTURE_RESULT, JSON.stringify({ before, after }));\n"
        )
        workspace = EVIDENCE / f"capture-{uuid.uuid4().hex[:8]}"
        workspace.mkdir(parents=True)
        result_path = workspace / "result.json"
        result = subprocess.run(
            [str(NODE), "--input-type=module", "-e", driver],
            capture_output=True,
            env={
                **os.environ,
                "BATON2_CAPTURE_ROOT": str(workspace),
                "BATON2_CAPTURE_RESULT": str(result_path),
            },
        )
        (EVIDENCE / "capture-driver.stdout").write_bytes(result.stdout)
        (EVIDENCE / "capture-driver.stderr").write_bytes(result.stderr)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(result_path.exists(), "the driver wrote no result")
        payload = json.loads(result_path.read_text())
        self.assertFalse(payload["before"])
        self.assertIn("directoryAppeared", [entry["reason"] for entry in payload["after"]["changed"]])

    def test_11_consumer_fixture_uses_record_identity(self):
        options = {
            "project": "tsconfig.json",
            "database": {"engine": "sqlite-schema", "path": "owned.fossil"},
            "client": {"path": "src/sql-client.d.ts", "line": 0, "column": 0},
        }
        result, run = self.provider.query(
            "sql-for-consumer",
            position_request("src/db.ts", 0, 0, ["databaseAccesses"], options=options, cwd=self.ts_project),
        )
        self.assertEqual(run.returncode, 0, run.stderr)
        records = [fact["value"]["record"] for fact in facts_of(result, "sqlCall")]
        consumer = subprocess.run(
            [str(NODE), str(CONSUMER / "constant-sql-join.mjs")],
            input=json.dumps({"snapshotId": result["snapshot"]["snapshotId"], "records": records}).encode(),
            capture_output=True,
        )
        (EVIDENCE / "consumer.stdout").write_bytes(consumer.stdout)
        (EVIDENCE / "consumer.stderr").write_bytes(consumer.stderr)
        self.assertEqual(consumer.returncode, 0, consumer.stderr)
        verdict = json.loads(consumer.stdout.split(b"\n")[0])
        self.assertTrue(verdict["accepted"], verdict)
        self.assertTrue(verdict["rejected"], "the consumer accepted a record without required identity")

    def test_12_projection_time_reads_enter_the_published_snapshot(self):
        workspace = EVIDENCE / f"projection-capture-{uuid.uuid4().hex[:8]}"
        project = workspace / "project"
        shutil.copytree(self.ts_project, project)
        result, run = self.provider.query(
            "projection-capture",
            symbol_request("src/consumer.ts", "makeMessage", ["definition"], cwd=project),
        )
        self.assertEqual(run.returncode, 0, run.stderr)
        inputs = {entry["path"] for entry in result["snapshot"]["inputs"]}
        declared = facts_of(result, "definition")[0]["value"]["definitions"][0]["declaration"]
        self.assertIn(declared["path"], inputs, "an input first read during projection is not in the snapshot")
        for ref in result["refs"]:
            self.assertEqual(ref["snapshotId"], result["snapshot"]["snapshotId"])
        for fact in result["facts"]:
            record = fact["value"].get("record") if isinstance(fact["value"], dict) else None
            if record:
                self.assertEqual(record["snapshotId"], result["snapshot"]["snapshotId"])

        (project / "src" / "util.ts").write_text(
            (project / "src" / "util.ts").read_text().replace("world", "planet", 1)
        )
        second, second_run = self.provider.query(
            "projection-capture-changed",
            symbol_request("src/consumer.ts", "makeMessage", ["definition"], cwd=project),
        )
        self.assertEqual(second_run.returncode, 0, second_run.stderr)
        self.assertNotEqual(
            second["snapshot"]["snapshotId"],
            result["snapshot"]["snapshotId"],
            "a changed imported declaration did not change the snapshot identity",
        )

    def test_13_native_ts_module_laws_and_mutations(self):
        if not BEND or not Path(BEND).exists():
            self.fail("BEND must name the pinned bend 2.0.25 compiler for the law entrypoint check")
        environment = {**os.environ, "BEND_NO_TELEMETRY": "1"}
        compile_ok = subprocess.run([BEND, str(BEND_LAWS), "--check-only"], capture_output=True, text=True, env=environment)
        (EVIDENCE / "laws.stdout").write_text(compile_ok.stdout)
        (EVIDENCE / "laws.stderr").write_text(compile_ok.stderr)
        self.assertEqual(compile_ok.returncode, 0, compile_ok.stderr + compile_ok.stdout)

        module_source = BEND_MODULE.read_text()
        laws_source = BEND_LAWS.read_text()
        scratch = EVIDENCE / f"laws-{uuid.uuid4().hex[:8]}" / "bend2" / "src"
        (scratch / "context").mkdir(parents=True)
        (scratch / "json").mkdir(parents=True)
        (scratch / "git").mkdir(parents=True)
        shutil.copyfile(BEND_MODULE, scratch / "context" / "typescript.bend")
        shutil.copyfile(BEND_LAWS, scratch / "context" / "typescript-laws.bend")
        shutil.copyfile(ROOT / "bend2" / "src" / "json" / "canonical.bend", scratch / "json" / "canonical.bend")
        shutil.copyfile(ROOT / "bend2" / "src" / "git" / "text.bend", scratch / "git" / "text.bend")
        shutil.copyfile(ROOT / "bend2" / "src" / "git" / "types.bend", scratch / "git" / "types.bend")
        laws = scratch / "context" / "typescript-laws.bend"

        broken_laws = laws_source.replace(
            "def ts_projection_bit_for_database_accesses():\n  {==}",
            "def ts_projection_bit_for_database_accesses():\n  ?TODO",
            1,
        )
        self.assertNotEqual(broken_laws, laws_source)
        laws.write_text(broken_laws)
        removed = subprocess.run([BEND, str(laws), "--check-only"], capture_output=True, text=True, env=environment)
        self.assertNotEqual(removed.returncode, 0, "a removed proof still checked")

        laws.write_text(laws_source)
        mutated_module = module_source.replace(
            "def bitval_database_accesses(+name: String, hit: Bool) -> U32:\n  match hit:\n    case True{}: 512",
            "def bitval_database_accesses(+name: String, hit: Bool) -> U32:\n  match hit:\n    case True{}: 511",
            1,
        )
        self.assertNotEqual(mutated_module, module_source)
        (scratch / "context" / "typescript.bend").write_text(mutated_module)
        mutated = subprocess.run([BEND, str(laws), "--check-only"], capture_output=True, text=True, env=environment)
        self.assertNotEqual(mutated.returncode, 0, "an implementation mutation still checked")


if __name__ == "__main__":
    if not NODE.exists():
        sys.exit("BATON2_CONTEXT_NODE must name a node binary")
    unittest.main(verbosity=2)
