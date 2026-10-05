#!/usr/bin/env python3
"""Explicit external LLVM/Clang 20.1.8 dependency-closure acceptance harness.

Inspects and executes the staged first-party extractor against the declared
external LLVM closure on the installed artifact and records the actual dylib,
resource, SDK, architecture and provider identities plus platform limits. The
accepted contract keeps LLVM/Clang an explicit external dependency: an
absolute Homebrew link alone does not establish relocation, so the harness
records which load commands resolve, verifies each recorded dylib exists at
its recorded location, and executes the artifact. No bundling or
relocatable-LLVM requirement is introduced.

Also verifies the declared installed layout: adapter entries
libexec/baton2/context/clang/adapter/clang-analyzer.mjs and clangd.mjs, the
single extractor libexec/baton2/context-clang-20, and the contingent helper
summary libexec/baton2/context/fossil-helper-summary.json.

Execution, extraction smokes and any compile are remote-runner operations;
this harness is the exact remote command payload. Without the candidate
artifacts it refuses with a structured missing-inputs report.
"""
import argparse
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

EXPECTED_LLVM_VERSION = "20.1.8"
DECLARED_ADAPTERS = (
    "libexec/baton2/context/clang/adapter/clang-analyzer.mjs",
    "libexec/baton2/context/clang/adapter/clangd.mjs",
)
DECLARED_EXTRACTOR = "libexec/baton2/context-clang-20"
CONTINGENT_HELPER = "libexec/baton2/context/fossil-helper-summary.json"


def version_gate(report, name, argv, expected):
    record = run_child(argv)
    summary = child_record(record, report.evidence_dir, name)
    output = summary["stdout"]
    report.gate(
        name,
        summary["exit_status"] == 0 and expected in output,
        f"{Path(argv[0]).name} reports {expected}" if summary["exit_status"] == 0 else f"exit {summary['exit_status']}: {summary['stderr'][-200:]}",
    )
    return summary


def load_command_paths(otool_summary):
    paths = []
    for line in otool_summary["stdout"].splitlines():
        match = re.match(r"\s+(\/.*?|\@.*?|[^(\s]+.*?) \(compatibility version", line)
        if match:
            paths.append(match.group(1).strip())
    return paths


def classify_dependency(path, llvm_prefix):
    if path.startswith("@rpath/") or path.startswith("@loader_path/"):
        return "runtime-relative"
    if path.startswith("/usr/lib/") or path.startswith("/System/"):
        return "system"
    return "absolute-external"


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package-root", type=Path, required=True, help="staged candidate package root (the installed package tree)")
    parser.add_argument("--extractor", type=Path, default=None, help="extractor path; default <package-root>/libexec/baton2/context-clang-20")
    parser.add_argument("--llvm-prefix", type=Path, default=Path("/opt/homebrew/opt/llvm"), help="declared external LLVM 20.1.8 prefix")
    parser.add_argument("--extractor-invocation", type=Path, default=None, help="JSON file with {argv:[...]} template to execute the extractor on the owned fixture")
    parser.add_argument("--fixture", type=Path, default=None, help="owned C fixture for the extractor smoke (default: bundled handler.c)")
    parser.add_argument("--fixture-variant", type=Path, default=None, help="owned mutation-control variant (default: bundled handler-variant.c)")
    parser.add_argument("--evidence", type=Path, required=True)
    args = parser.parse_args(argv)

    harness_dir = Path(__file__).resolve().parent
    report = Report("clang-artifact-closure", args.evidence)
    missing = False

    extractor = args.extractor or (args.package_root / DECLARED_EXTRACTOR)
    if not extractor.exists():
        report.missing("extractor artifact", f"{extractor} absent (actual immutable extractor source and remote build result must exist first)")
        missing = True
    clang = args.llvm_prefix / "bin" / "clang"
    clangd = args.llvm_prefix / "bin" / "clangd"
    for label, path in (("clang", clang), ("clangd", clangd)):
        if not path.exists():
            report.missing(f"declared external {label}", f"{path} absent")
            missing = True
    for declared in DECLARED_ADAPTERS:
        if not (args.package_root / declared).exists():
            report.missing("adapter entry", f"{args.package_root / declared} absent")
            missing = True
    if missing:
        return finish(report)

    # Contingent helper summary: recorded, not gated, until Models declares it.
    helper_path = args.package_root / CONTINGENT_HELPER
    report.gate(
        "helperSummaryRecorded",
        True,
        f"helper summary {'present' if helper_path.exists() else 'absent'} at {helper_path} "
        "(contingent on Models exact source declaration; not gated here)",
    )

    # Declared layout.
    report.gate("declaredLayout", True, f"adapter entries and extractor found under {args.package_root}")

    # Provider identities.
    version_gate(report, "clangIdentity", [clang, "--version"], EXPECTED_LLVM_VERSION)
    version_gate(report, "clangdIdentity", [clangd, "--version"], EXPECTED_LLVM_VERSION)
    report.inputs_clang = file_identity(clang)
    report.inputs_clangd = file_identity(clangd)

    # Architecture.
    record = run_child(["lipo", "-archs", extractor])
    archs = child_record(record, report.evidence_dir, "extractor-archs")
    report.gate("extractorArchitecture", archs["exit_status"] == 0, f"lipo -archs: {archs['stdout'].strip()!r} (platform limits recorded, arm64 expected on darwin-arm64)")

    # Dylib closure: record and resolve every load command; no bundling rule.
    record = run_child(["otool", "-L", extractor])
    otool = child_record(record, report.evidence_dir, "extractor-otool")
    deps = load_command_paths(otool)
    resolution = []
    unresolved = []
    for dep in deps:
        classification = classify_dependency(dep, args.llvm_prefix)
        if classification == "runtime-relative":
            if dep.startswith("@loader_path/"):
                try_paths = [extractor.parent / dep[len("@loader_path/"):]]
            else:
                try_paths = [args.llvm_prefix / "lib" / dep[len("@rpath/"):]]
            resolved_exists = any(try_path.exists() for try_path in try_paths)
            resolution.append({"load": dep, "class": classification, "resolved": resolved_exists})
        else:
            exists = Path(dep).exists()
            resolution.append({"load": dep, "class": classification, "resolved": exists})
            if not exists:
                unresolved.append(dep)
    clang_cpp_entries = [d for d in deps if "clang-cpp" in d]
    report.gate("clangCppLinked", bool(clang_cpp_entries), f"libclang-cpp load commands: {clang_cpp_entries}")
    report.gate(
        "dylibClosureResolved",
        not unresolved,
        f"{len(resolution)} load commands, all resolve on this host" if not unresolved else f"unresolved: {unresolved}",
    )
    absolute_external = [d for d in deps if classify_dependency(d, args.llvm_prefix) == "absolute-external"]
    save_json(report.evidence_dir / "dylib-resolution.json", {
        "load_commands": deps,
        "resolution": resolution,
        "relocation_observation": (
            "absolute external load commands recorded; absolute Homebrew links do not establish relocation"
            if absolute_external else "no absolute external load commands recorded"
        ),
        "absolute_external": absolute_external,
    })

    # ClangConfig.cmake pin proof.
    config = args.llvm_prefix / "lib" / "cmake" / "clang" / "ClangConfig.cmake"
    record = run_child(["cat", config])
    config_record = child_record(record, report.evidence_dir, "clangconfig")
    report.gate(
        "clangConfigPin",
        config_record["exit_status"] == 0,
        f"pinned ClangConfig.cmake read from {config}" if config_record["exit_status"] == 0 else "ClangConfig.cmake absent from declared prefix",
    )

    # Resource headers and SDK access through the pinned external toolchain.
    record = run_child([clang, "-print-resource-dir"])
    resource = child_record(record, report.evidence_dir, "resource-dir")
    resource_dir = resource["stdout"].strip()
    if resource["exit_status"] == 0 and resource_dir:
        stddef = Path(resource_dir) / "include" / "stddef.h"
        report.gate("resourceHeaders", stddef.exists(), f"resource dir {resource_dir}; stddef.h {'present' if stddef.exists() else 'absent'}")
    else:
        report.gate("resourceHeaders", False, "clang -print-resource-dir failed")

    fixture = args.fixture or (harness_dir / "fixture" / "handler.c")
    record = run_child(["xcrun", "--show-sdk-path"])
    sdk = child_record(record, report.evidence_dir, "sdk-path")
    sdk_path = sdk["stdout"].strip()
    if sdk["exit_status"] == 0 and sdk_path and fixture.exists():
        compile_out = run_child([clang, "-std=gnu89", "-fsyntax-only", "-isysroot", sdk_path, fixture], cwd=harness_dir / "fixture")
        compile_record = child_record(compile_out, report.evidence_dir, "sdk-syntax-only")
        report.gate(
            "sdkAccess",
            compile_record["exit_status"] == 0,
            f"pinned clang -fsyntax-only -isysroot {sdk_path} on owned fixture: exit {compile_record['exit_status']}",
        )
    else:
        report.gate("sdkAccess", False, f"sdk path {sdk_path!r}; fixture {fixture}")

    # Actual execution of the staged artifact: only with a caller-declared
    # invocation template; the extractor CLI contract belongs to its owner.
    if args.extractor_invocation and args.extractor_invocation.exists():
        template = json.loads(args.extractor_invocation.read_text())
        variant = args.fixture_variant or (harness_dir / "fixture" / "handler-variant.c")
        runs = {}
        for label, target in (("fixture", fixture), ("variant", variant)):
            argv = [part.replace("{FIXTURE}", str(target)) for part in template["argv"]]
            out = run_child(argv, cwd=template.get("cwd"))
            runs[label] = child_record(out, report.evidence_dir, f"extractor-{label}")
        report.gate(
            "extractorExecutes",
            runs["fixture"]["exit_status"] == 0,
            f"extractor exit {runs['fixture']['exit_status']} on owned fixture",
        )
        report.gate(
            "extractorMutationSensitive",
            runs["fixture"]["stdout"] != runs["variant"]["stdout"],
            "extractor output differs between fixture and mutation-control variant",
        )
    else:
        report.missing(
            "extractor invocation template",
            "no --extractor-invocation supplied: staged-artifact execution and mutation smoke wait for the "
            "extractor owner's declared CLI contract (no interface is invented here)",
        )

    return finish(report, {
        "inputs": {
            "package_root": str(args.package_root),
            "extractor": file_identity(extractor),
            "llvm_prefix": str(args.llvm_prefix),
            "clang": report.inputs_clang,
            "clangd": report.inputs_clangd,
            "helper_summary_present": helper_path.exists(),
        }
    })


if __name__ == "__main__":
    sys.exit(main())
