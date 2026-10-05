#!/usr/bin/env python3
"""TS/Node package-isolation acceptance harness.

Proves, on a staged package tree (or an explicitly supplied reference bundle
for harness self-qualification), that under the exact Node 22.15.0 floor and
the qualification host's Node:

- the bundled TypeScript is exactly 5.9.3,
- the bundled public declarations declare every API the probe uses and strip
  the measured runtime-only surface,
- the probe source type-checks against the bundled declarations with ambient
  types disabled (mechanical public-API-only gate),
- package-relative resolution works with no ancestor node_modules and a
  scrubbed environment,
- the fixture program acquires no ambient @types from any ancestor,
- the language service returns useful results on real fixtures, including the
  measured quoted-access presence and any-receiver blind spots, and the
  mutation-control variant reports its definite-assignment diagnostic.

A run without a candidate package or reference bundle refuses with a
structured missing-inputs report and never passes vacuously.
"""
import argparse
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import (  # noqa: E402
    EXIT_USAGE,
    Report,
    child_record,
    file_identity,
    finish,
    no_node_modules_above,
    require,
    run_child,
    save_json,
    scrubbed_env,
    sha256,
)

DEFAULT_NODE = (
    "/Users/wahargis/Development/Experiments/baton-bend2-root-delivery-20260928"
    "/.scratch/semantic-context-20261005/probes/native-package-critic/toolchain/"
    "node-v22.15.0-darwin-arm64/bin/node"
)
EXPECTED_NODE_VERSION = "v22.15.0"
EXPECTED_TYPESCRIPT_VERSION = "5.9.3"
SPECIFIER_PLACEHOLDER = "__TYPESCRIPT_ENTRY__"


def node_identity(node_binary, report):
    record = run_child([node_binary, "--version"])
    summary = child_record(record, report.evidence_dir, "node-version")
    version = summary["stdout"].strip()
    return version, summary


def stage_isolated(source_dir, work_root, label):
    """Copy source_dir into a clean location with no ancestor node_modules."""
    staged_root = work_root / label
    staged_root.mkdir(parents=True, exist_ok=True)
    destination = staged_root / source_dir.name
    shutil.copytree(source_dir, destination, symlinks=True)
    return destination


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package-root", type=Path, default=None, help="staged semantic package root (libexec/baton2 tree)")
    parser.add_argument("--typescript-dir", type=Path, default=None, help="bundled typescript package directory; required unless inside package-root")
    parser.add_argument("--node", type=Path, default=Path(DEFAULT_NODE), help="floor Node binary")
    parser.add_argument("--host-node", type=Path, default=None, help="qualification host Node for the second gate run")
    parser.add_argument("--evidence", type=Path, required=True, help="private evidence output directory")
    args = parser.parse_args(argv)

    harness_dir = Path(__file__).resolve().parent
    report = Report("ts-package-isolation", args.evidence)
    missing = False

    typescript_dir = args.typescript_dir
    if typescript_dir is None and args.package_root is not None:
        found = sorted(args.package_root.glob("**/typescript/lib/typescript.js"))
        if found:
            typescript_dir = found[0].parents[1]
        else:
            report.missing("bundled typescript", f"no typescript/lib/typescript.js found under {args.package_root}")
            missing = True
    if typescript_dir is None:
        report.missing("candidate package", "no --package-root staged tree and no --typescript-dir reference bundle supplied")
        missing = True
    else:
        entry = typescript_dir / "lib" / "typescript.js"
        declarations = typescript_dir / "lib" / "typescript.d.ts"
        package_manifest = typescript_dir / "package.json"
        for label, path in (("typescript.js", entry), ("typescript.d.ts", declarations), ("package.json", package_manifest)):
            if not path.exists():
                report.missing(f"bundled {label}", f"{path} absent")
                missing = True

    if not args.node.exists():
        report.missing("floor node binary", f"{args.node} absent")
        missing = True
    if missing:
        return finish(report)

    package_manifest = json.loads((typescript_dir / "package.json").read_text())
    report.gate(
        "typescriptPin",
        package_manifest.get("version") == EXPECTED_TYPESCRIPT_VERSION,
        f"staged typescript package.json version {package_manifest.get('version')}",
    )
    report.gate(
        "typescriptInsideCandidate",
        args.package_root is None or str(typescript_dir.resolve()).startswith(str(args.package_root.resolve())),
        "bundled typescript located inside the candidate package root"
        if args.package_root
        else "reference bundle mode: no candidate package root supplied (self-qualification only, not installed acceptance)",
    )

    floor_version, floor_record = node_identity(args.node, report)
    report.gate("nodeFloorPin", floor_version == EXPECTED_NODE_VERSION, f"floor node --version is {floor_record['stdout'].strip()!r}")

    work_root = Path(tempfile.mkdtemp(prefix="baton2-pkg-critic-"))
    try:
        offenders = no_node_modules_above(work_root)
        report.gate(
            "cleanAncestors",
            not offenders,
            f"isolation work root {work_root} has no ancestor node_modules" if not offenders else f"ancestor node_modules found: {offenders}",
        )

        staged_ts = stage_isolated(typescript_dir, work_root, "staged-package")
        staged_probe_dir = work_root / "probe-critic"
        staged_probe_dir.mkdir()
        fixture_source = harness_dir / "fixture" / "src"
        staged_fixture_dir = staged_probe_dir / "fixture" / "src"
        shutil.copytree(fixture_source, staged_fixture_dir)

        probe_template = (harness_dir / "probe" / "language-service-probe.ts").read_text()
        specifier = os.path.relpath(staged_ts / "lib" / "typescript.js", staged_probe_dir)
        probe_text = probe_template.replace(SPECIFIER_PLACEHOLDER, specifier)
        require(probe_text != probe_template, "specifier placeholder missing from probe template")
        staged_probe = staged_probe_dir / "language-service-probe.ts"
        staged_probe.write_text(probe_text)

        wrapper = staged_probe_dir / "wrapper.mjs"
        wrapper.write_text(
            "\n".join(
                [
                    "import { readFileSync } from 'node:fs';",
                    "import { createRequire } from 'node:module';",
                    "const require = createRequire(import.meta.url);",
                    f"const ts = require({json.dumps(str(staged_ts / 'lib' / 'typescript.js'))});",
                    f"const fixtureDir = {json.dumps(str(staged_fixture_dir))};",
                    "const fixtureTexts = {};",
                    "for (const name of ['consumer.ts', 'models.ts', 'util.ts', 'index.ts', 'broken.ts']) {",
                    "  const path = `${fixtureDir}/${name}`;",
                    "  fixtureTexts[path] = readFileSync(path, 'utf8');",
                    "}",
                    f"const dtsPath = {json.dumps(str(staged_ts / 'lib' / 'typescript.d.ts'))};",
                    f"const libDirPath = {json.dumps(str(staged_ts / 'lib'))};",
                    "const { readdirSync } = await import('node:fs');",
                    "const libTexts = {};",
                    "for (const entry of readdirSync(libDirPath)) {",
                    "  if (/^lib\\..+\\.d\\.ts$/.test(entry)) {",
                    "    libTexts[`${libDirPath}/${entry}`] = readFileSync(`${libDirPath}/${entry}`, 'utf8');",
                    "  }",
                    "}",
                    f"const probePath = {json.dumps(str(staged_probe))};",
                    "const probeSource = readFileSync(probePath, 'utf8');",
                    "globalThis.probeInputs = { dtsText: readFileSync(dtsPath, 'utf8'), probeSource, probeFilePath: probePath, dtsFilePath: dtsPath, fixtureTexts, libTexts, libDirPath };",
                    "const emitted = ts.transpileModule(probeSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });",
                    "const compiled = new URL('./language-service-probe.compiled.mjs', import.meta.url);",
                    "const { writeFileSync } = await import('node:fs');",
                    "writeFileSync(compiled, emitted.outputText);",
                    "await import(compiled.href);",
                    "",
                ]
            )
        )

        for label, node_binary in (("floor", args.node), ("host", args.host_node)) if args.host_node else (("floor", args.node),):
            node_version, _ = node_identity(node_binary, report)
            run_root = work_root / f"run-{label}"
            run_root.mkdir()
            record = run_child([node_binary, wrapper], cwd=run_root, env=scrubbed_env())
            summary = child_record(record, report.evidence_dir, f"probe-{label}")
            probe_ok = False
            probe_state = None
            if summary["exit_status"] == 0 and summary["stdout"].strip():
                try:
                    probe_state = json.loads(summary["stdout"].strip().splitlines()[-1])
                    probe_ok = all(probe_state.get("gates", {}).values())
                except json.JSONDecodeError as error:
                    summary["stdout_parse_error"] = str(error)
            report.gate(
                f"probeRun_{label}",
                probe_ok,
                f"node {node_version}: exit {summary['exit_status']}, gates "
                f"{json.dumps(probe_state.get('gates', {})) if probe_state else 'unparsed'}"
                + ("" if probe_ok else f"; stderr tail: {summary['stderr'][-400:]}"),
            )
            if probe_state is not None:
                report.gate(
                    f"usefulResults_{label}",
                    all(
                        probe_state.get("gates", {}).get(name, False)
                        for name in (
                            "pinnedVersion",
                            "publicDtsApi",
                            "runtimeOnlyAbsent",
                            "publicApiTypeCheck",
                            "ambientIsolation",
                            "cleanFixtureDiagnostics",
                            "definitionThroughBarrel",
                            "quotedAccessPresent",
                            "anyReceiverBlindSpots",
                            "callHierarchyIncoming",
                            "brokenVariantDiagnostic",
                            "transpileEmit",
                        )
                    ),
                    "all useful-result and publicity gates true in probe state",
                )
            save_json(
                report.evidence_dir / f"probe-state-{label}.json",
                probe_state if probe_state is not None else {"unparsed": True},
            )

        report.gate(
            "isolatedResolution",
            not no_node_modules_above(staged_probe_dir),
            "probe ran from a tree with no ancestor node_modules",
        )
    finally:
        shutil.rmtree(work_root, ignore_errors=True)

    if args.package_root is None:
        report.missing(
            "installed acceptance boundary",
            "reference-bundle self-qualification only: installed acceptance additionally requires the staged "
            "candidate package root, the staged adapter entry, and the installed CLI query path",
        )
    return finish(report, {
        "inputs": {
            "typescript_source": file_identity(typescript_dir / "lib" / "typescript.js"),
            "declarations_source": file_identity(typescript_dir / "lib" / "typescript.d.ts"),
            "typescript_package_json_version": package_manifest.get("version"),
            "floor_node": file_identity(args.node),
            "package_root": str(args.package_root) if args.package_root else None,
        }
    })


if __name__ == "__main__":
    sys.exit(main())
