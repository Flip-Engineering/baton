#!/usr/bin/env python3
# Tests for the TypeScript semantic provider (bend2/context/typescript).
#
# The provider is exercised through its real entry point: a staged copy of the adapter is spawned
# as <node> <provider.mjs> with a sanitized environment and the admitted canonical request bytes on
# stdin, exactly as core launches it. No test imports the adapter's internals except the capture
# regression, which needs a function-level probe of a fixed defect.
#
# Environment:
#   BATON2_CONTEXT_NODE      node binary to run the provider (default: `node` on PATH; the exact
#                            22.15.0 floor binary is the qualified runner value)
#   BATON2_CONTEXT_TYPESCRIPT  typescript install to stage as the package-relative dependency
#                              (default: the research install path)
#   BEND                     Bend 2.0.25 compiler; the law entrypoint checks require it
#
# Every subprocess is captured completely: argv, stdin, stdout, stderr, exit status.

import json
import hashlib
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TS_DIR = ROOT / "bend2" / "context" / "typescript"
FIXTURES = TS_DIR / "fixtures"
LIB = TS_DIR / "lib"
BEND_MODULE = ROOT / "bend2" / "src" / "context" / "typescript.bend"
BEND_LAWS = ROOT / "bend2" / "src" / "context" / "typescript-laws.bend"

NODE = Path(os.environ.get("BATON2_CONTEXT_NODE") or shutil.which("node") or "/usr/bin/false")
TYPESCRIPT = Path(
    os.environ.get("BATON2_CONTEXT_TYPESCRIPT", "/Users/wahargis/node_modules/typescript")
)
BEND = os.environ.get("BEND", "")

PROVIDER_ENTRY = "libexec/baton2/context/typescript/provider.mjs"


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


class StagedProvider:
    """A staging tree whose package-relative dependency is the pinned typescript install."""

    def __init__(self, root):
        self.root = Path(root)
        self.context = self.root / "libexec" / "baton2" / "context"
        (self.context / "typescript" / "lib").mkdir(parents=True)
        shutil.copyfile(TS_DIR / "provider.mjs", self.context / "typescript" / "provider.mjs")
        for module in sorted(LIB.glob("*.mjs")):
            shutil.copyfile(module, self.context / "typescript" / "lib" / module.name)
        node_modules = self.context / "node_modules"
        node_modules.mkdir(parents=True)
        (node_modules / "typescript").symlink_to(TYPESCRIPT, target_is_directory=True)
        (self.root / "home").mkdir()
        (self.root / "tmp").mkdir()

    @property
    def entry(self):
        return self.root / PROVIDER_ENTRY

    def spawn(self, frame_bytes, argv=(), cwd=None, node=None):
        environment = {
            "PATH": "/usr/bin:/bin",
            "HOME": str(self.root / "home"),
            "TMPDIR": str(self.root / "tmp"),
            "LC_ALL": "C",
        }
        return subprocess.run(
            [str(node or NODE), str(self.entry), *argv],
            input=frame_bytes,
            capture_output=True,
            env=environment,
            cwd=str(cwd or self.root),
            timeout=300,
        )

    def query(self, request, argv=(), cwd=None, node=None):
        result = self.spawn(json.dumps(request).encode("utf-8") + b"\n", argv=argv, cwd=cwd, node=node)
        frames = [line for line in result.stdout.split(b"\n") if line.strip()]
        if result.returncode == 0:
            self.assert_single_frame(frames, result)
            return json.loads(frames[0]), result
        self.assert_single_frame(frames, result)
        return json.loads(frames[0]), result

    @staticmethod
    def assert_single_frame(frames, result):
        if len(frames) != 1:
            raise AssertionError(
                f"expected one stdout frame, got {len(frames)}; status={result.returncode} "
                f"stderr={result.stderr[:2000]!r}"
            )


def position_request(path, line, column, select, options=None, cwd=None, engine="typescript"):
    request = {
        "version": 1,
        "engine": engine,
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


def facts_of(result, kind=None, projection=None):
    for fact in result.get("facts", []):
        if kind is not None and fact["kind"] != kind:
            continue
        if projection is not None and fact["id"] and f'"{projection}"' not in fact["id"]:
            continue
        yield fact


class ProviderTest(unittest.TestCase):
    maxDiff = None

    @classmethod
    def setUpClass(cls):
        cls._staging = tempfile.TemporaryDirectory(prefix="ts-provider-")
        cls.provider = StagedProvider(cls._staging.name)
        cls.ts_project = FIXTURES / "ts-project"
        cls.js_project = FIXTURES / "js-project"
        cls.manifest = json.loads((FIXTURES / "manifest.json").read_text())

    @classmethod
    def tearDownClass(cls):
        cls._staging.cleanup()

    def test_01_engines_probe_names_the_executable_and_the_library(self):
        result = self.provider.spawn(b"", argv=["--engines"])
        self.assertEqual(result.returncode, 0, result.stderr)
        frame = json.loads(result.stdout.split(b"\n")[0])
        self.assertEqual(frame["availability"], "available")
        self.assertEqual(frame["provider"]["version"], "5.9.3")
        self.assertTrue(frame["provider"]["path"].endswith("typescript.js"))
        self.assertEqual(len(frame["provider"]["sha256"]), 64)
        self.assertEqual(frame["executable"], str(NODE))
        self.assertIn("databaseAccesses", frame["projections"])

    def test_02_definition_type_references_calls_for_a_real_project(self):
        cwd = str(self.ts_project)
        definition, process = self.provider.query(
            symbol_request("src/consumer.ts", "run", ["definition", "type", "references", "calls", "callers"], cwd=cwd),
        )
        self.assertEqual(process.returncode, 0, process.stderr)
        definitions = list(facts_of(definition, "definition"))
        self.assertTrue(definitions, "no definition fact")
        declarations = definitions[0]["value"]["definitions"]
        self.assertTrue(declarations, "definition fact carries no declaration")
        self.assertTrue(declarations[0]["declaration"]["path"].endswith("consumer.ts"))
        types = list(facts_of(definition, "type"))
        self.assertTrue(types, "no type fact")
        self.assertEqual(types[0]["classification"], "checked")
        self.assertTrue(types[0]["value"]["typeText"])
        self.assertTrue(types[0]["evidence"], "checked fact without evidence")
        references = list(facts_of(definition, "references"))
        self.assertTrue(references)
        self.assertTrue(all(ref["classification"] == "static-possible" for ref in references))
        calls = list(facts_of(definition, "calls"))
        self.assertTrue(calls, "no calls fact")
        callees = [edge["callee"]["name"] for edge in calls[0]["value"]["outgoing"]]
        self.assertIn("makeMessage", callees)
        callers = list(facts_of(definition, "callers"))
        self.assertTrue(callers)
        self.assertTrue(all(ref["snapshotId"] == definition["snapshot"]["snapshotId"] for ref in definition["refs"]))

    def test_03_dependencies_and_module_use_edges_resolve_declarations(self):
        cwd = str(self.ts_project)
        result, process = self.provider.query(symbol_request("src/consumer.ts", "run", ["dependencies"], cwd=cwd))
        self.assertEqual(process.returncode, 0, process.stderr)
        uses = list(facts_of(result, "moduleUse"))
        self.assertTrue(uses, "no module use fact")
        resolved = [use for use in uses if use["value"]["record"] is not None]
        self.assertTrue(resolved, "no resolved module use record")
        record = resolved[0]["value"]["record"]
        self.assertEqual(record["schema"], "baton2.context.resolver-record.v1")
        self.assertEqual(record["snapshotId"], result["snapshot"]["snapshotId"])
        self.assertEqual(len(record["module"]["sha256"]), 64)
        self.assertEqual(record["resolution"]["status"], "resolved")
        declaration = record["resolution"]["declaration"]
        self.assertTrue(declaration["path"].endswith(".ts"))
        self.assertEqual(len(declaration["sha256"]), 64)
        self.assertGreaterEqual(declaration["range"]["start"]["line"], 0)
        self.assertTrue(resolved[0]["value"]["useSites"] or resolved[0]["value"]["aliasChain"])
        # String ref ids stay ids; the structured site lives in the record.
        self.assertIsInstance(resolved[0]["value"]["useSiteRef"], str)
        self.assertIsInstance(record["useSite"]["path"], str)

    def test_04_unresolved_module_keeps_a_limit_and_no_record(self):
        with tempfile.TemporaryDirectory(prefix="ts-unresolved-") as workspace:
            shutil.copytree(self.ts_project, Path(workspace) / "project")
            project = Path(workspace) / "project"
            (project / "src" / "util.ts").unlink()
            shutil.copyfile(FIXTURES / "states" / "a" / "src" / "dep.ts", project / "src" / "dep2.ts")
            result, process = self.provider.query(
                symbol_request("src/consumer.ts", "run", ["dependencies"], cwd=str(project)),
            )
            self.assertEqual(process.returncode, 0, process.stderr)
            unresolved = [
                use for use in facts_of(result, "moduleUse") if use["value"]["record"] is None
            ]
            self.assertTrue(unresolved, "an unresolved import produced a record instead of a limit")
            self.assertTrue(unresolved[0]["limits"])

    def test_05_diagnostics_report_both_families_with_option_state(self):
        cwd = str(self.ts_project)
        request = position_request("src/flow.ts", 0, 0, ["diagnostics"], options={"project": "tsconfig.json"}, cwd=cwd)
        result, process = self.provider.query(request)
        self.assertEqual(process.returncode, 0, process.stderr)
        diagnostics = list(facts_of(result, "diagnostic"))
        families = {fact["value"]["family"] for fact in diagnostics}
        self.assertIn("suggestion", families)
        self.assertIn("semantic", families)
        self.assertTrue(any(fact["value"]["code"] == 7027 for fact in diagnostics))
        self.assertTrue(any(fact["value"]["code"] == 2454 for fact in diagnostics))
        self.assertTrue(all(fact["classification"] == "checked" for fact in diagnostics))
        examined = {fact["value"]["family"] for fact in facts_of(result, "diagnosticFamily")}
        self.assertEqual(examined, {"semantic", "suggestion"})

        strict_request = position_request(
            "src/flow.ts", 0, 0, ["diagnostics"], options={"project": "tsconfig.unreachable.json"}, cwd=cwd
        )
        strict, strict_process = self.provider.query(strict_request)
        self.assertEqual(strict_process.returncode, 0, strict_process.stderr)
        unreachable = [
            fact for fact in facts_of(strict, "diagnostic") if fact["value"]["code"] == 7027
        ]
        self.assertTrue(unreachable)
        self.assertTrue(all(fact["value"]["family"] == "semantic" for fact in unreachable))
        self.assertTrue(all(fact["value"]["optionState"]["allowUnreachableCode"] is False for fact in unreachable))

    def test_06_flow_and_exception_structure(self):
        cwd = str(self.ts_project)
        flow, flow_process = self.provider.query(
            position_request("src/flow.ts", 0, 0, ["flow"], options={"project": "tsconfig.json"}, cwd=cwd),
        )
        self.assertEqual(flow_process.returncode, 0, flow_process.stderr)
        narrowed = list(facts_of(flow, "narrowedType"))
        self.assertTrue(narrowed)
        self.assertEqual(narrowed[0]["classification"], "checked")
        self.assertIn("never", narrowed[0]["value"])
        self.assertTrue(list(facts_of(flow, "unreachableCode")))
        self.assertTrue(list(facts_of(flow, "definiteAssignment")))
        codes = {limit["code"] for limit in flow["limits"]}
        self.assertIn("noPublicCfg", codes)

        exceptions, exceptions_process = self.provider.query(
            position_request("src/exceptions.ts", 0, 0, ["exceptions"], options={"project": "tsconfig.json"}, cwd=cwd),
        )
        self.assertEqual(exceptions_process.returncode, 0, exceptions_process.stderr)
        throws = list(facts_of(exceptions, "throwSites"))
        self.assertTrue(throws)
        self.assertTrue(throws[0]["value"]["throws"])
        self.assertTrue(any(entry["enclosing"] for entry in throws[0]["value"]["throws"]))
        declared = list(facts_of(exceptions, "declaredThrows"))
        if declared:
            self.assertEqual(declared[0]["classification"], "declared")

    def test_07_database_accesses_use_checker_identity(self):
        cwd = str(self.ts_project)
        options = {
            "project": "tsconfig.json",
            "database": {"engine": "sqlite-schema", "path": "owned.fossil"},
            "client": {"path": "src/sql-client.d.ts", "line": 0, "column": 0},
        }
        result, process = self.provider.query(position_request("src/db.ts", 0, 0, ["databaseAccesses"], options=options, cwd=cwd))
        self.assertEqual(process.returncode, 0, process.stderr)
        calls = list(facts_of(result, "sqlCall"))
        self.assertTrue(calls, "no sqlCall fact")
        records = [fact["value"]["record"] for fact in calls]
        matched = [record for record in records if record["callee"]["status"] == "resolved"]
        self.assertTrue(matched, "no call matched the admitted client declaration")
        literal = [record for record in matched if record["sql"]["status"] == "constant"]
        self.assertTrue(literal, "no constant statement was admitted")
        self.assertIn("FROM users", literal[0]["sql"]["text"])
        self.assertIn("FROM accounts", literal[0]["sql"]["text"])
        self.assertEqual(literal[0]["statementKind"], "unknown")
        self.assertEqual(literal[0]["snapshotId"], result["snapshot"]["snapshotId"])
        self.assertEqual(len(literal[0]["callee"]["declaration"]["sha256"]), 64)
        shadowed = [record for record in records if record["callee"].get("reason") == "clientDeclarationMismatch"]
        self.assertTrue(shadowed, "a same-name shadowed function was not refused")
        dynamic = [record for record in records if record["sql"]["status"] == "dynamic"]
        self.assertTrue(dynamic, "a substituted template was not recorded as dynamic")
        self.assertGreaterEqual(dynamic[0]["sql"].get("reason") is not None, True or dynamic[0]["sql"]["status"] == "dynamic")

    def test_08_record_identity_distinguishes_consumer_negatives(self):
        cwd = str(self.ts_project)
        options = {
            "project": "tsconfig.json",
            "database": {"engine": "sqlite-schema", "path": "owned.fossil"},
            "client": {"path": "src/sql-client.d.ts", "line": 0, "column": 0},
        }
        first, process = self.provider.query(position_request("src/db.ts", 0, 0, ["databaseAccesses"], options=options, cwd=cwd))
        self.assertEqual(process.returncode, 0, process.stderr)
        record = next(fact for fact in facts_of(first, "sqlCall"))["value"]["record"]
        # The consumer keys on these; every one of them is present and nonempty.
        self.assertTrue(record["callSite"]["path"])
        self.assertEqual(len(record["callSite"]["sha256"]), 64)
        self.assertIsInstance(record["callSite"]["range"]["start"]["line"], int)
        self.assertTrue(record["snapshotId"])
        self.assertTrue(record["sql"]["text"])

        # A record builder refuses an empty identity rather than hashing null fields.
        sys.path.insert(0, str(LIB))
        try:
            import records  # noqa: PLC0415
        finally:
            sys.path.pop(0)
        with self.assertRaises(TypeError):
            records.modelUseRecord(
                resolved={"version": "5.9.3", "libraryPath": "/p/typescript.js", "librarySha": "aa"},
                snapshotId="snap",
                useSite={"path": "/m.ts", "sha256": "aa", "range": {"start": {"line": 0, "column": 0}, "end": {"line": 0, "column": 1}}, "role": "importSpecifier"},
                module={"path": "/m.ts", "sha256": ""},
                exportName="create",
                resolution=records.unresolvedResolution("moduleUnresolved"),
                limits=[],
            )

    def test_09_service17_baseline_roots_and_config_selection(self):
        cwd = str(self.ts_project)
        baseline, process = self.provider.query(position_request("src/consumer.ts", 0, 0, ["definition"], cwd=cwd))
        self.assertEqual(process.returncode, 0, process.stderr)
        self.assertTrue(baseline["facts"], "baseline (no project) query returned no fact")
        self.assertTrue(any(limit["code"] == "baselineOptions" for limit in baseline["limits"]))

        with tempfile.TemporaryDirectory(prefix="ts-config-") as workspace:
            project = Path(workspace) / "project"
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
            included, included_process = self.provider.query(
                symbol_request("src/a.ts", "value", ["definition"], options={"project": "tsconfig.json"}, cwd=str(project)),
            )
            self.assertEqual(included_process.returncode, 0, included_process.stderr)
            self.assertTrue(included["facts"])
            excluded, excluded_process = self.provider.query(
                symbol_request("excluded/b.ts", "other", ["definition"], options={"project": "tsconfig.json"}, cwd=str(project)),
            )
            self.assertEqual(excluded_process.returncode, 2, excluded_process.stderr)
            self.assertEqual(excluded["error"]["condition"], "context-subject-not-in-program")

    def test_10_missing_directory_lookup_is_revalidated(self):
        driver = (
            "import { createCapture } from '" + str(LIB / "capture.mjs") + "';\n"
            "import { mkdirSync, writeFileSync, rmSync } from 'node:fs';\n"
            "const root = process.argv[2];\n"
            "const missing = root + '/later';\n"
            "const capture = createCapture({ cwd: root, readRoots: [root] });\n"
            "const before = capture.directoryExists(missing);\n"
            "mkdirSync(missing, { recursive: true });\n"
            "const after = capture.revalidate();\n"
            "writeFileSync(root + '/result.json', JSON.stringify({ before, after }));\n"
        )
        with tempfile.TemporaryDirectory(prefix="ts-capture-") as workspace:
            result_path = Path(workspace) / "result.json"
            process = subprocess.run(
                [str(NODE), "--input-type=module", "-e", driver, workspace],
                capture_output=True,
                text=True,
                timeout=120,
            )
        self.assertEqual(process.returncode, 0, process.stderr)
        payload = json.loads(result_path.read_text())
        self.assertFalse(payload["before"])
        reasons = [entry["reason"] for entry in payload["after"]["changed"]]
        self.assertIn("directoryAppeared", reasons)

    def test_11_consumer_fixture_uses_record_identity(self):
        cwd = str(self.ts_project)
        options = {
            "project": "tsconfig.json",
            "database": {"engine": "sqlite-schema", "path": "owned.fossil"},
            "client": {"path": "src/sql-client.d.ts", "line": 0, "column": 0},
        }
        result, process = self.provider.query(position_request("src/db.ts", 0, 0, ["databaseAccesses"], options=options, cwd=cwd))
        self.assertEqual(process.returncode, 0, process.stderr)
        records = [fact["value"]["record"] for fact in facts_of(result, "sqlCall")]
        consumer = FIXTURES / "consumer" / "constant-sql-join.mjs"
        process = subprocess.run(
            [str(NODE), str(consumer)],
            input=json.dumps({"snapshotId": result["snapshot"]["snapshotId"], "records": records}).encode(),
            capture_output=True,
            timeout=120,
        )
        self.assertEqual(process.returncode, 0, process.stderr)
        verdict = json.loads(process.stdout.split(b"\n")[0])
        self.assertTrue(verdict["accepted"], verdict)
        self.assertTrue(verdict["rejected"], "the consumer accepted a record without its required identity")

    def test_12_native_ts_module_laws_and_mutations(self):
        if not BEND or not Path(BEND).exists():
            self.fail("BEND must name the pinned bend 2.0.25 compiler for the law entrypoint check")
        environment = {**os.environ, "BEND_NO_TELEMETRY": "1"}
        compile_ok = subprocess.run(
            [BEND, str(BEND_LAWS), "--check-only"], capture_output=True, text=True, env=environment, timeout=900
        )
        self.assertEqual(compile_ok.returncode, 0, compile_ok.stderr + compile_ok.stdout)

        module_source = BEND_MODULE.read_text()
        laws_source = BEND_LAWS.read_text()
        with tempfile.TemporaryDirectory(prefix="ts-laws-") as scratch:
            base = Path(scratch) / "bend2" / "src"
            (base / "context").mkdir(parents=True)
            (base / "json").mkdir(parents=True)
            (base / "git").mkdir(parents=True)
            shutil.copyfile(BEND_MODULE, base / "context" / "typescript.bend")
            shutil.copyfile(BEND_LAWS, base / "context" / "typescript-laws.bend")
            shutil.copyfile(ROOT / "bend2" / "src" / "json" / "canonical.bend", base / "json" / "canonical.bend")
            shutil.copyfile(ROOT / "bend2" / "src" / "git" / "text.bend", base / "git" / "text.bend")
            shutil.copyfile(ROOT / "bend2" / "src" / "git" / "types.bend", base / "git" / "types.bend")
            laws = base / "context" / "typescript-laws.bend"

            # A removed proof must stop the entrypoint from checking.
            broken_laws = laws.read_text().replace(
                "def ts_projection_bit_for_database_accesses():\n  {==}",
                "def ts_projection_bit_for_database_accesses():\n  ?TODO",
                1,
            )
            self.assertNotEqual(broken_laws, laws.read_text())
            laws.write_text(broken_laws)
            removed_proof = subprocess.run(
                [BEND, str(laws), "--check-only"], capture_output=True, text=True, env=environment, timeout=900
            )
            self.assertNotEqual(removed_proof.returncode, 0, "a removed proof still checked")

            # An implementation mutation must fail the law that covers it.
            laws.write_text(laws_source)
            mutated_module = module_source.replace(
                "def bitval_database_accesses(+name: String, hit: Bool) -> U32:\n  match hit:\n    case True{}: 512",
                "def bitval_database_accesses(+name: String, hit: Bool) -> U32:\n  match hit:\n    case True{}: 511",
                1,
            )
            self.assertNotEqual(mutated_module, module_source)
            (base / "context" / "typescript.bend").write_text(mutated_module)
            mutated = subprocess.run(
                [BEND, str(laws), "--check-only"], capture_output=True, text=True, env=environment, timeout=900
            )
            self.assertNotEqual(mutated.returncode, 0, "an implementation mutation still checked")


if __name__ == "__main__":
    if not NODE.exists():
        sys.exit("BATON2_CONTEXT_NODE must name a node binary")
    unittest.main(verbosity=2)
