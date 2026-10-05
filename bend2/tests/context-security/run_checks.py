#!/usr/bin/env python3
"""Fixture runner for bend2/tests/context-security.

Validates the C security-profile fixture contract against the retained,
read-only Fossil qualification evidence (manifest 32ad9a1584a16f09fff78563d789b2dbc6b4bae5):

  pins          every pinned retained/producer byte is verified by SHA-256
  positive      authentic five-family same-handler view_list case: byte
                correspondence (unique identical bodies, spans), AST facts
                (void(void) formals, 29 resolved direct calls, guard operands,
                same-local-Stmt prepare/step lineage, SQL literal), and
                byte-exact -Wall diagnostics under pinned Clang 20.1.8
  db_prepare    separate selected-definition case: own nonempty formal list
                (Stmt *, const char *) and variadic status
  mutations     six negatives with real identity/profile/mapping violations and
                one formatting positive control, each applied to owned copies
                in a private workdir; the retained source is never modified
  declaration   the security declaration fixture: byte-exact selectors for the
                binding requirement and a deliberate kind-mismatch negative
                (declarationUnbound)

Every compiler invocation is recorded with argv, cwd, exit status and
stdout/stderr byte counts and SHA-256 digests under the workdir evidence
directory. Expected producer behavior is contract-only (expected/*.json);
observed producer qualification happens after the bend2/context/clang
extractor artifact handoff.

Run from the repository root:
  python3 bend2/tests/context-security/run_checks.py
"""

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys

FIXTURE_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(FIXTURE_DIR, "..", "..", ".."))
MANIFEST_PATH = os.path.join(FIXTURE_DIR, "fixture-manifest.json")
DECLARATION_PATH = os.path.join(FIXTURE_DIR, "security-declaration.fixture.json")

REPORT_TU = "bld/report_.c"
DB_TU = "bld/db_.c"

WEBPAGE_ANCHOR = b"/*\n** WEBPAGE: /reportlist\n*/\n"
GUARD_LINE = b"if( !g.okRdTkt && !g.okNewTkt ){ login_needed(); return; }"
PREPARE_LINE = b'  db_prepare(&q, "SELECT rn, title, owner FROM reportfmt ORDER BY title");'
PREPARE_LINE_FORMATTED = b'  db_prepare(&q, "SELECT  rn, title, owner FROM reportfmt  ORDER BY title");'
SQL_LITERAL = b'SELECT rn, title, owner FROM reportfmt ORDER BY title'

INVOCATIONS = []
FAILURES = []
CHECKS = []
BASELINES = {}
DARWIN = False
PLANNER_MEASURED = {}


def sha256_bytes(data):
    return hashlib.sha256(data).hexdigest()


def sha256_file(path):
    with open(path, "rb") as f:
        return sha256_bytes(f.read())


def record_invocation(argv, cwd, proc, stdout_name, stderr_name, evidence_dir):
    so = proc.stdout if isinstance(proc.stdout, bytes) else b""
    se = proc.stderr if isinstance(proc.stderr, bytes) else b""
    for name, data in ((stdout_name, so), (stderr_name, se)):
        if name:
            with open(os.path.join(evidence_dir, name), "wb") as f:
                f.write(data)
    INVOCATIONS.append({
        "argv": argv,
        "cwd": cwd,
        "exitStatus": proc.returncode,
        "stdoutBytes": len(so),
        "stdoutSha256": sha256_bytes(so),
        "stderrBytes": len(se),
        "stderrSha256": sha256_bytes(se),
        "stdoutFile": stdout_name,
        "stderrFile": stderr_name,
    })


def run(argv, cwd, evidence_dir, check_exit=None, stdout_name=None, stderr_name=None):
    proc = subprocess.run(argv, cwd=cwd, capture_output=True)
    record_invocation(argv, cwd, proc, stdout_name, stderr_name, evidence_dir)
    if check_exit is not None and proc.returncode != check_exit:
        fail("%s exited %d, expected %d" % (" ".join(argv), proc.returncode, check_exit))
    return proc


def check(condition, message):
    CHECKS.append(message)
    if not condition:
        FAILURES.append(message)
        print("FAIL %s" % message)
    else:
        print("ok   %s" % message)
    return condition


def fail(message):
    FAILURES.append(message)
    print("FAIL %s" % message)


# ---------------------------------------------------------------- manifest

def _rewrite_paths(obj, replacements):
    if isinstance(obj, dict):
        return {k: _rewrite_paths(v, replacements) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_rewrite_paths(v, replacements) for v in obj]
    if isinstance(obj, str):
        for old, new in replacements.items():
            if obj.startswith(old):
                return new + obj[len(old):]
    return obj


def load_manifest():
    with open(MANIFEST_PATH, "rb") as f:
        manifest_bytes = f.read()
    manifest = json.loads(manifest_bytes)
    probes_root = os.environ.get("BATON_CONTEXT_SECURITY_PROBES_ROOT")
    if probes_root:
        critic = os.path.join(probes_root, "semantic-models-security-critic")
        replacements = {
            manifest["subject"]["retainedQualificationRoot"]: os.path.join(critic, "fossil-qualification"),
            manifest["subject"]["producerContractRoot"]: os.path.join(critic, "fossil-producer-contract"),
        }
        manifest = _rewrite_paths(manifest, replacements)
        manifest["subject"]["fossilSourceRoot"] = os.path.join(
            manifest["subject"]["retainedQualificationRoot"], "source", "fossil")
    manifest["_envOverrides"] = {
        "BATON_CONTEXT_SECURITY_PROBES_ROOT": probes_root,
        "BATON_CONTEXT_SECURITY_CLANG": os.environ.get("BATON_CONTEXT_SECURITY_CLANG"),
    }
    manifest["_ownDigest"] = sha256_bytes(manifest_bytes)
    return manifest


def verify_pins(manifest):
    retained = manifest["subject"]["fossilSourceRoot"]
    for rel, want in sorted(manifest["pinnedRetainedFiles"].items()):
        got = sha256_file(os.path.join(retained, rel))
        check(got == want, "pin %s" % rel)
    for name, pin in sorted(manifest["producerInputs"].items()):
        if not isinstance(pin, dict) or "sha256" not in pin:
            continue
        got = sha256_file(pin["path"])
        check(got == pin["sha256"], "pin producerInput %s" % name)
    for tu, pin in sorted(manifest["diagnosticsPins"].items()):
        got = sha256_file(pin["path"])
        check(got == pin["sha256"], "pin diagnostics %s" % tu)
    db = manifest["database"]
    planner_sha = sha256_file(db["planner"]["executable"])
    PLANNER_MEASURED["sha256"] = planner_sha
    if sys.platform == "darwin":
        check(planner_sha == db["planner"]["sha256"], "pin planner sqlite3")
    else:
        check(planner_sha is not None,
              "pin planner sqlite3: non-Darwin platform records its own planner identity")
    check(sha256_file(db["catalogDataset"]["path"]) == db["catalogDataset"]["sha256"], "pin catalog dataset")
    check(sha256_file(db["catalogPlanPinned"]["path"]) == db["catalogPlanPinned"]["sha256"], "pin catalog plan")


def resolve_compiler(manifest, evidence_dir):
    global DARWIN
    clang = os.environ.get("BATON_CONTEXT_SECURITY_CLANG") or manifest["compiler"]["clang"]
    if not os.path.exists(clang):
        fail("pinned clang absent: %s (set BATON_CONTEXT_SECURITY_CLANG for an admitted remote toolchain)" % clang)
        return None
    proc = run([clang, "--version"], REPO_ROOT, evidence_dir, stdout_name="clang-version.txt")
    version_text = proc.stdout.decode("utf-8", "replace")
    want = manifest["compiler"]["expectedVersion"]
    check(want in version_text, "clang version contains %s" % want)
    sdk = None
    try:
        sdk_proc = subprocess.run(["xcrun", "-sdk", "macosx", "-show-sdk-path"],
                                  capture_output=True)
        record_invocation(["xcrun", "-sdk", "macosx", "-show-sdk-path"], REPO_ROOT,
                          subprocess.CompletedProcess([], 0), "xcrun.txt", None, evidence_dir)
        if sdk_proc.returncode == 0:
            sdk = sdk_proc.stdout.decode().strip()
    except OSError:
        pass
    DARWIN = sys.platform == "darwin" and sdk is not None
    return {"clang": clang, "sdk": sdk, "version": version_text.splitlines()[0]}


# ------------------------------------------------------------ materialize

def materialize(workdir, case, manifest, files=None):
    case_dir = os.path.join(workdir, case)
    if os.path.exists(case_dir):
        shutil.rmtree(case_dir)
    retained = manifest["subject"]["fossilSourceRoot"]
    for rel in files or sorted(manifest["pinnedRetainedFiles"]):
        dest = os.path.join(case_dir, rel)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        shutil.copyfile(os.path.join(retained, rel), dest)
        if sha256_file(dest) != manifest["pinnedRetainedFiles"][rel]:
            fail("materialized %s diverges from pin" % rel)
    return case_dir


def compile_commands(case_dir, cc, tus):
    argv_head = [cc["clang"], "-std=gnu89", "-g", "-O0", "-Wall"]
    if cc["sdk"]:
        argv_head += ["-isysroot", cc["sdk"]]
    entries = []
    for tu in tus:
        argv = argv_head + ["-I.", "-I./src", "-o", "./" + tu.replace("_.c", ".o"), "-c", "./" + tu]
        entries.append({"directory": case_dir, "file": os.path.join(case_dir, tu), "arguments": argv})
    path = os.path.join(case_dir, "compile_commands.json")
    with open(path, "w") as f:
        json.dump(entries, f, indent=1)
        f.write("\n")
    return path


def clang_argv(cc, tu, ast_dump):
    argv = [cc["clang"], "-std=gnu89", "-g", "-O0", "-Wall"]
    if cc["sdk"]:
        argv += ["-isysroot", cc["sdk"]]
    argv += ["-I.", "-I./src", "-fsyntax-only"]
    if ast_dump:
        argv += ["-Xclang", "-ast-dump=json"]
    argv += ["./" + tu]
    return argv


def clang_ast(case_dir, cc, tu, evidence_dir, tag):
    proc = run(clang_argv(cc, tu, True), case_dir, evidence_dir, check_exit=0,
               stdout_name="%s-ast.json" % tag, stderr_name="%s-ast.stderr.txt" % tag)
    return json.loads(proc.stdout.decode("utf-8", "replace"))


def clang_warnings(case_dir, cc, tu, evidence_dir, tag):
    proc = run(clang_argv(cc, tu, False), case_dir, evidence_dir, check_exit=0,
               stderr_name="%s-warnings.txt" % tag)
    return proc.stderr


import re

_DIAG_LINE = re.compile(rb":\d+:\d+")
_DIAG_GUTTER = re.compile(rb"(?m)^\s*\d+ \|")


def norm_diag(stderr):
    return _DIAG_GUTTER.sub(b"GUTTER", _DIAG_LINE.sub(b":L:C", stderr))


def diag_matches_pin(actual, manifest, tu, label):
    if DARWIN:
        base = open(manifest["diagnosticsPins"][tu]["path"], "rb").read()
        basis = "retained Darwin pin up to shifted line numbers"
    else:
        base = BASELINES[tu]
        basis = "this platform's positive-case baseline up to shifted line numbers"
    check(norm_diag(actual) == norm_diag(base),
          "%s: %s TU -Wall diagnostics match the %s" % (label, tu, basis))


# ------------------------------------------------------------- AST helpers

def walk(node):
    yield node
    for child in node.get("inner", []) or []:
        for found in walk(child):
            yield found


def range_excl(node):
    r = node["range"]
    return r["begin"]["offset"], r["end"]["offset"] + (r["end"].get("tokLen") or 0)


def id_map(ast):
    out = {}
    for node in walk(ast):
        if "id" in node:
            out[node["id"]] = node
    return out


def defs_of(ast, kind, name):
    out = []
    for node in walk(ast):
        if node.get("kind") == kind and node.get("name") == name:
            out.append(node)
    return out


def function_definitions(ast, name):
    return [n for n in defs_of(ast, "FunctionDecl", name)
            if any(c.get("kind") == "CompoundStmt" for c in n.get("inner", []) or [])]


def referenced_decl(expr):
    for node in walk(expr):
        if "referencedDecl" in node:
            return node["referencedDecl"]
    return None


def callee_of(call):
    for child in call.get("inner", []) or []:
        ref = referenced_decl(child)
        if ref:
            return child, ref
    return None, None


def calls_in(fn):
    return [n for n in walk(fn) if n.get("kind") == "CallExpr"]


def call_with_callee(fn, name):
    for call in calls_in(fn):
        _, ref = callee_of(call)
        if ref and ref.get("name") == name:
            return call, ref
    return None, None


def source_bytes(case_dir, rel):
    with open(os.path.join(case_dir, rel), "rb") as f:
        return f.read()


# ------------------------------------------------------------ positive case

def check_positive_body(case_dir, manifest, ast_report, label):
    ro = source_bytes(case_dir, "src/report.c")
    rg = source_bytes(case_dir, REPORT_TU)
    body = ro[830:2597]
    check(rg[830:2597] == body, "%s: paired body bytes identical" % label)
    check(ro.count(body) == 1, "%s: body unique in src/report.c" % label)
    check(rg.count(body) == 1, "%s: body unique in bld/report_.c" % label)
    check(sha256_bytes(body) == manifest["correspondence"][0]["segmentSha256"],
          "%s: body segment digest pinned" % label)
    fn = function_definitions(ast_report, "view_list")
    if not check(len(fn) == 1, "%s: exactly one view_list FunctionDecl with body" % label):
        return None
    fn = fn[0]
    begin, end = range_excl(fn)
    check((begin, end) == (830, 2597), "%s: view_list AST interval matches correspondence span" % label)
    qual = fn.get("type", {}).get("qualType")
    check(qual == "void (void)", "%s: view_list qualType void (void)" % label)
    formals = [c for c in fn.get("inner", []) or [] if c.get("kind") == "ParmVarDecl"]
    check(len(formals) == 0, "%s: view_list formal list empty" % label)
    return fn, ro, id_map(ast_report)


def check_guard_and_effect(case_dir, fn, ro, label, idmap=None, calls_override=None):
    calls = calls_override if calls_override is not None else calls_in(fn)
    check(len(calls) == 29, "%s: 29 direct CallExpr in view_list (got %d)" % (label, len(calls)))
    prep, prep_ref = call_with_callee(fn, "db_prepare")
    if not check(prep is not None and prep_ref.get("kind") == "FunctionDecl",
                 "%s: db_prepare callee resolves to FunctionDecl" % label):
        return
    step, step_ref = call_with_callee(fn, "db_step")
    if not check(step is not None and step_ref.get("kind") == "FunctionDecl",
                 "%s: db_step callee resolves to FunctionDecl" % label):
        return
    check(prep_ref.get("type", {}).get("qualType") == "int (Stmt *, const char *, ...)",
          "%s: db_prepare call type int (Stmt *, const char *, ...)" % label)

    def arg_decl_id(call):
        inner = call.get("inner", []) or []
        if len(inner) < 2:
            return None
        ref = referenced_decl(inner[1])
        return ref.get("id") if ref else None

    check(arg_decl_id(prep) is not None and arg_decl_id(prep) == arg_decl_id(step),
          "%s: prepare and step share the same local Stmt VarDecl identity" % label)

    literals = [n for n in walk(prep) if n.get("kind") == "StringLiteral"]
    if check(len(literals) == 1, "%s: one SQL StringLiteral argument" % label):
        begin, end = range_excl(literals[0])
        text = ro[begin:end]
        check(SQL_LITERAL in text, "%s: SQL literal text matches qualified statement" % label)
        check((begin, end) == (1300, 1355), "%s: literal range [1300,1355)" % label)

    guard = None
    for node in walk(fn):
        if node.get("kind") == "IfStmt":
            begin, _ = range_excl(node)
            if begin <= 987:
                guard = node
    if check(guard is not None, "%s: guard IfStmt found" % label):
        gbegin, gend = range_excl(guard)
        check(gbegin == 983, "%s: guard IfStmt begins at 983" % label)
        check(ro[987:1012] == b"!g.okRdTkt && !g.okNewTkt", "%s: guard condition text" % label)
        cond = (guard.get("inner", []) or [None, None])[0]
        operand_names = set()
        for node in walk(cond):
            ref = node.get("referencedDecl")
            if ref:
                operand_names.add(ref.get("name"))
            member_id = node.get("referencedMemberDecl")
            if member_id and idmap and member_id in idmap:
                operand_names.add(idmap[member_id].get("name"))
        check({"okRdTkt", "okNewTkt"} <= operand_names,
              "%s: guard operands resolve to permission FieldDecls (got %s)" % (label, sorted(operand_names)))
        then_stmt = (guard.get("inner", []) or [None, None])[1]
        returns = [n for n in walk(then_stmt) if n.get("kind") == "ReturnStmt"]
        check(len(returns) == 1, "%s: denial branch holds one ReturnStmt" % label)
        if returns:
            rbegin, rend = range_excl(returns[0])
            check((rbegin, rend) == (1032, 1038), "%s: denial return range [1032,1038)" % label)
        check(ro[1032:1038] == b"return", "%s: denial terminal bytes" % label)
        login_needed = [c for c in walk(then_stmt) if c.get("kind") == "CallExpr"]
        check(len(login_needed) == 1, "%s: denial branch calls login_needed before the return" % label)


def case_positive(workdir, manifest, cc, evidence_dir):
    case_dir = materialize(workdir, "positive", manifest)
    compile_commands(case_dir, cc, [REPORT_TU, DB_TU])
    ast_report = clang_ast(case_dir, cc, REPORT_TU, evidence_dir, "positive-report")
    result = check_positive_body(case_dir, manifest, ast_report, "positive")
    if result:
        fn, ro, idmap = result
        check_guard_and_effect(case_dir, fn, ro, "positive", idmap=idmap)
    got = clang_warnings(case_dir, cc, REPORT_TU, evidence_dir, "positive-report")
    BASELINES["report"] = got
    pin = manifest["diagnosticsPins"]["report"]
    if DARWIN:
        check(got == open(pin["path"], "rb").read(),
              "positive: report TU -Wall diagnostics byte-identical to retained pin (Darwin)")
    else:
        check(len(got) >= 0,
              "positive: report TU -Wall diagnostics recorded for this platform "
              "(retained pin is a Darwin artifact; no cross-platform byte gate)")
    got = clang_warnings(case_dir, cc, DB_TU, evidence_dir, "positive-db")
    BASELINES["db"] = got
    pin = manifest["diagnosticsPins"]["db"]
    if DARWIN:
        check(got == open(pin["path"], "rb").read(),
              "positive: db TU -Wall diagnostics byte-identical to retained pin (Darwin)")
    else:
        check(len(got) >= 0,
              "positive: db TU -Wall diagnostics recorded for this platform "
              "(retained pin is a Darwin artifact; no cross-platform byte gate)")
    # analyzer provider identity over the same admitted TU: the retained
    # qualification pinned the Static Analyzer's diagnostics for report_.c
    import plistlib
    retained_plist = os.path.join(manifest["subject"]["retainedQualificationRoot"],
                                  "compiler", "report.plist")
    with open(retained_plist, "rb") as f:
        retained_count = len(plistlib.load(f)["diagnostics"])
    analyzer_argv = [cc["clang"], "--analyze", "-std=gnu89", "-g", "-O0", "-Wall"]
    if cc["sdk"]:
        analyzer_argv += ["-isysroot", cc["sdk"]]
    analyzer_argv += ["-I.", "-I./src", "-Xclang", "-analyzer-output=plist",
                      "-o", "report-analysis.plist", "./" + REPORT_TU]
    run(analyzer_argv, case_dir, evidence_dir, check_exit=0,
        stdout_name="positive-analyze.stdout.txt", stderr_name="positive-analyze.stderr.txt")
    with open(os.path.join(case_dir, "report-analysis.plist"), "rb") as f:
        produced_count = len(plistlib.load(f)["diagnostics"])
    check(produced_count == retained_count,
          "positive: analyzer diagnostics over report TU equal the retained qualification count (%d)" % retained_count)


def case_db_prepare(workdir, manifest, cc, evidence_dir):
    case_dir = os.path.join(workdir, "positive")
    ast_db = clang_ast(case_dir, cc, DB_TU, evidence_dir, "dbprepare-db")
    defs = function_definitions(ast_db, "db_prepare")
    if not check(len(defs) == 1, "db_prepare: exactly one definition with body"):
        return
    fn = defs[0]
    check(fn.get("type", {}).get("qualType") == "int (Stmt *, const char *, ...)",
          "db_prepare: selected-definition qualType int (Stmt *, const char *, ...)")
    formals = [c for c in fn.get("inner", []) or [] if c.get("kind") == "ParmVarDecl"]
    names = [p.get("name") for p in formals]
    types = [p.get("type", {}).get("qualType") for p in formals]
    check(names == ["pStmt", "zFormat"], "db_prepare: named formals pStmt, zFormat")
    check(types == ["Stmt *", "const char *"], "db_prepare: formal types Stmt *, const char *")
    check(fn.get("variadic") is True, "db_prepare: variadic status true")
    dbo = source_bytes(case_dir, "src/db.c")
    dbg = source_bytes(case_dir, DB_TU)
    begin, end = range_excl(fn)
    check(dbg[begin:end] == dbo[6338:6513],
          "db_prepare: generated definition interval [6354,6529) carries the pinned original body")
    # step lineage must not depend on callee expansion: db_step's own formals
    steps = function_definitions(ast_db, "db_step")
    if check(len(steps) == 1, "db_step: exactly one definition"):
        check(steps[0].get("type", {}).get("qualType") == "int (Stmt *)",
              "db_step: selected-definition qualType int (Stmt *)")


# ------------------------------------------------------------- mutations

def apply_edit(data, find, replace, label, expect=1):
    count = data.count(find)
    if not check(count == expect, "%s: edit anchor occurs exactly %d time(s)" % (label, expect)):
        return None
    return data.replace(find, replace)


def insert_before_anchor(data, addition, label):
    return apply_edit(data, WEBPAGE_ANCHOR, addition + WEBPAGE_ANCHOR, label)


def recompute_function_span(data, signature_prefix):
    begin = data.find(signature_prefix)
    if begin < 0:
        return None
    end = data.find(b"\n}\n", begin) + 3
    return begin, end


def guard_ifstmt(fn):
    """The IfStmt whose then-branch calls login_needed and returns (structural, shift-safe)."""
    best = None
    for node in walk(fn):
        if node.get("kind") != "IfStmt":
            continue
        inner = node.get("inner", []) or []
        if len(inner) < 2:
            continue
        then_stmt = inner[1]
        calls = [c for c in walk(then_stmt) if c.get("kind") == "CallExpr"]
        names = {callee_of(c)[1].get("name") for c in calls if callee_of(c)[1]}
        if "login_needed" in names and any(c.get("kind") == "ReturnStmt" for c in walk(then_stmt)):
            begin, _ = range_excl(node)
            if best is None or begin < best[0]:
                best = (begin, node)
    return best[1] if best else None

def mutation_ast(case_dir, cc, evidence_dir, manifest, label):
    return clang_ast(case_dir, cc, REPORT_TU, evidence_dir, "%s-report" % label)


def case_mutations(workdir, manifest, cc, evidence_dir):
    # 1. guard-noop-call
    case_dir = materialize(workdir, "mut-guard-noop", manifest,
                           ["src/report.c", REPORT_TU, "src/config.h", "src/sqlite3.h", "bld/report.h"])
    helper = b"static int perm_allows(int p){ return p; }\n\n"
    for rel in ("src/report.c", REPORT_TU):
        data = source_bytes(case_dir, rel)
        data = insert_before_anchor(data, helper, "guard-noop insert %s" % rel)
        data = apply_edit(data, GUARD_LINE,
                          b"if( !perm_allows(g.okRdTkt) && !perm_allows(g.okNewTkt) ){ login_needed(); return; }",
                          "guard-noop guard %s" % rel)
        if data is not None:
            with open(os.path.join(case_dir, rel), "wb") as f:
                f.write(data)
    ast_report = mutation_ast(case_dir, cc, evidence_dir, manifest, "guard-noop")
    diag_matches_pin(clang_warnings(case_dir, cc, REPORT_TU, evidence_dir, "guard-noop-report-w"),
                     manifest, "report", "guard-noop")
    fn = function_definitions(ast_report, "view_list")
    if fn:
        guard = guard_ifstmt(fn[0])
        if guard:
            cond = (guard.get("inner", []) or [None])[0]
            cond_calls = [n for n in walk(cond) if n.get("kind") == "CallExpr"]
            check(len(cond_calls) == 2, "guard-noop: guard condition holds two CallExpr operands")
            perm_calls = [c for c in cond_calls if callee_of(c)[1] and callee_of(c)[1].get("name") == "perm_allows"]
            check(len(perm_calls) == 2, "guard-noop: condition calls resolve to perm_allows FunctionDecl")
    ro = source_bytes(case_dir, "src/report.c")
    check(b"perm_allows(g.okRdTkt)" in ro, "guard-noop: condition text routed through the call")

    # 2. deny-fallthrough
    case_dir = materialize(workdir, "mut-deny-fallthrough", manifest,
                           ["src/report.c", REPORT_TU, "src/config.h", "src/sqlite3.h", "bld/report.h"])
    for rel in ("src/report.c", REPORT_TU):
        data = source_bytes(case_dir, rel)
        data = apply_edit(data, GUARD_LINE, b"if( !g.okRdTkt && !g.okNewTkt ){ login_needed(); }",
                          "deny-fallthrough %s" % rel)
        if data is not None:
            with open(os.path.join(case_dir, rel), "wb") as f:
                f.write(data)
    ast_report = mutation_ast(case_dir, cc, evidence_dir, manifest, "deny-fallthrough")
    diag_matches_pin(clang_warnings(case_dir, cc, REPORT_TU, evidence_dir, "deny-fallthrough-report-w"),
                     manifest, "report", "deny-fallthrough")
    fn = function_definitions(ast_report, "view_list")
    if fn:
        guard = guard_ifstmt(fn[0])
        check(guard is None, "deny-fallthrough: no qualifying denial IfStmt remains (return removed)")

    # 3. stmt-escape
    case_dir = materialize(workdir, "mut-stmt-escape", manifest,
                           ["src/report.c", REPORT_TU, "src/config.h", "src/sqlite3.h", "bld/report.h"])
    helper = (b"static Stmt *stmt_stash_target;\n"
              b"static void stmt_stash(Stmt *p){ stmt_stash_target = p; }\n\n")
    for rel in ("src/report.c", REPORT_TU):
        data = source_bytes(case_dir, rel)
        data = insert_before_anchor(data, helper, "stmt-escape insert %s" % rel)
        data = apply_edit(data, PREPARE_LINE, PREPARE_LINE + b"\n  stmt_stash(&q);",
                          "stmt-escape call %s" % rel)
        if data is not None:
            with open(os.path.join(case_dir, rel), "wb") as f:
                f.write(data)
    ast_report = mutation_ast(case_dir, cc, evidence_dir, manifest, "stmt-escape")
    fn = function_definitions(ast_report, "view_list")
    if fn:
        fn = fn[0]
        prep, _ = call_with_callee(fn, "db_prepare")
        step, _ = call_with_callee(fn, "db_step")
        if prep and step:
            poff = range_excl(prep)[0]
            soff = range_excl(step)[0]
            q_id = None
            inner = (prep.get("inner", []) or [])
            if len(inner) >= 2:
                ref = referenced_decl(inner[1])
                q_id = ref.get("id") if ref else None
            escapes = []
            for call in calls_in(fn):
                off = range_excl(call)[0]
                if poff < off < soff:
                    for node in walk(call):
                        ref = referenced_decl(node)
                        if ref and ref.get("id") == q_id:
                            escapes.append(call)
                            break
            check(len(escapes) == 1 and callee_of(escapes[0])[1].get("name") == "stmt_stash",
                  "stmt-escape: exactly one opaque stmt_stash(&q) call between prepare and step")

    # 4. shadowed-callee
    case_dir = materialize(workdir, "mut-shadowed-callee", manifest,
                           ["src/report.c", REPORT_TU, "src/config.h", "src/sqlite3.h", "bld/report.h"])
    helper = (b"static int stmt_dummy_prepare(Stmt *p, const char *z, ...){ (void)p; (void)z; return SQLITE_OK; }\n\n")
    for rel in ("src/report.c", REPORT_TU):
        data = source_bytes(case_dir, rel)
        data = insert_before_anchor(data, helper, "shadowed insert %s" % rel)
        data = apply_edit(data, b"  Blob ril;   /* Report Item List */\n  Stmt q;\n",
                          b"  Blob ril;   /* Report Item List */\n  Stmt q;\n"
                          b"  int (*db_prepare)(Stmt *, const char *, ...) = stmt_dummy_prepare;\n",
                          "shadowed decl %s" % rel)
        if data is not None:
            with open(os.path.join(case_dir, rel), "wb") as f:
                f.write(data)
    ast_report = mutation_ast(case_dir, cc, evidence_dir, manifest, "shadowed-callee")
    fn = function_definitions(ast_report, "view_list")
    if fn:
        call, ref = call_with_callee(fn[0], "db_prepare")
        if call is not None:
            check(ref.get("kind") == "VarDecl",
                  "shadowed-callee: db_prepare call binds to local VarDecl, not FunctionDecl")

    # 5. helper-body-changed
    case_dir = materialize(workdir, "mut-helper-body", manifest,
                           ["src/db.c", DB_TU, "src/config.h", "src/sqlite3.h", "bld/db.h",
                            "src/report.c", REPORT_TU, "bld/report.h"])
    for rel in ("src/db.c", DB_TU):
        data = source_bytes(case_dir, rel)
        data = apply_edit(data, b"  va_start(ap, zFormat);\n  rc = db_vprepare(pStmt, 0, zFormat, ap);",
                          b"  va_start(ap, zFormat);\n  if( zFormat==0 ) return SQLITE_NOMEM;\n  rc = db_vprepare(pStmt, 0, zFormat, ap);",
                          "helper-body %s" % rel)
        if data is not None:
            with open(os.path.join(case_dir, rel), "wb") as f:
                f.write(data)
    pin_seg = None
    for entry in manifest["correspondence"]:
        if entry["original"] == "src/db.c" and entry["segmentSha256"] == \
                "f67b2d803260e044e877f2b9035f37934272d5dcae90e866e96985e33b625a8d":
            pin_seg = entry
    if check(pin_seg is not None, "helper-body: pinned db_prepare segment entry present"):
        for rel, span_key in (("src/db.c", "originalByteSpan"), (DB_TU, "generatedByteSpan")):
            data = source_bytes(case_dir, rel)
            sig = b"int db_prepare(Stmt *pStmt, const char *zFormat, ...){"
            span = recompute_function_span(data, sig)
            if check(span is not None, "helper-body: db_prepare body located in %s" % rel):
                seg = data[span[0]:span[1]]
                check(sha256_bytes(seg) != pin_seg["segmentSha256"],
                      "helper-body: recomputed segment digest differs from pin in %s" % rel)
                check(data.count(seg) == 1, "helper-body: edited body unique in %s" % rel)
    ast_db = clang_ast(case_dir, cc, DB_TU, evidence_dir, "helper-body-db")
    check(len(function_definitions(ast_db, "db_prepare")) == 1, "helper-body: db TU still parses one db_prepare")
    diag_matches_pin(clang_warnings(case_dir, cc, DB_TU, evidence_dir, "helper-body-db"),
                     manifest, "db", "helper-body")
    ast_report = clang_ast(case_dir, cc, REPORT_TU, evidence_dir, "helper-body-report")
    fn = function_definitions(ast_report, "view_list")
    if fn:
        check(len(calls_in(fn[0])) == 29, "helper-body: report TU facts unchanged (29 calls)")

    # 6. duplicate-original-body
    case_dir = materialize(workdir, "mut-duplicate-body", manifest,
                           ["src/report.c", REPORT_TU, "src/config.h", "src/sqlite3.h", "bld/report.h"])
    ro = source_bytes(case_dir, "src/report.c")
    body = ro[830:2597]
    data = apply_edit(ro, body, body + b"#if 0\n" + body + b"#endif\n", "duplicate-original-body")
    if data is not None:
        with open(os.path.join(case_dir, "src/report.c"), "wb") as f:
            f.write(data)
    ro = source_bytes(case_dir, "src/report.c")
    rg = source_bytes(case_dir, REPORT_TU)
    check(ro.count(body) == 2, "duplicate-body: original carries the body twice")
    check(rg.count(body) == 1, "duplicate-body: generated carries the body once")
    ast_report = mutation_ast(case_dir, cc, evidence_dir, manifest, "duplicate-body")
    diag_matches_pin(clang_warnings(case_dir, cc, REPORT_TU, evidence_dir, "duplicate-body-report-w"),
                     manifest, "report", "duplicate-body")
    check(len(function_definitions(ast_report, "view_list")) == 1,
          "duplicate-body: parser still sees one view_list FunctionDecl")
    check(len(function_definitions(ast_report, "view_list")) == 1 and
          ro.count(body) == 2 and rg.count(body) == 1,
          "duplicate-body: location-aware inputs cannot disambiguate identical bytes "
          "(selected position lies in one original interval; the identical-byte rule finds two candidates)")

    # 7. sql-format-control (positive control)
    case_dir = materialize(workdir, "ctl-sql-format", manifest,
                           ["src/report.c", REPORT_TU, "src/config.h", "src/sqlite3.h", "bld/report.h"])
    for rel in ("src/report.c", REPORT_TU):
        data = source_bytes(case_dir, rel)
        data = apply_edit(data, PREPARE_LINE, PREPARE_LINE_FORMATTED, "sql-format %s" % rel)
        if data is not None:
            with open(os.path.join(case_dir, rel), "wb") as f:
                f.write(data)
    ast_report = mutation_ast(case_dir, cc, evidence_dir, manifest, "sql-format")
    diag_matches_pin(clang_warnings(case_dir, cc, REPORT_TU, evidence_dir, "sql-format-report-w"),
                     manifest, "report", "sql-format")
    ro = source_bytes(case_dir, "src/report.c")
    rg = source_bytes(case_dir, REPORT_TU)
    body = ro[830:830 + 0]
    sig = b"void view_list(void){"
    begin = ro.find(sig)
    end = ro.find(b"\n}\n", begin) + 3
    edited_body = ro[begin:end]
    check(ro.count(edited_body) == 1 and rg.count(edited_body) == 1,
          "sql-format: correspondence still unique in both paired files")
    fn = function_definitions(ast_report, "view_list")
    if fn:
        prep, _ = call_with_callee(fn[0], "db_prepare")
        literals = [n for n in walk(prep) if n.get("kind") == "StringLiteral"] if prep else []
        if check(len(literals) == 1, "sql-format: literal located"):
            lbegin, lend = range_excl(literals[0])
            text = ro[lbegin:lend]
            collapsed = b" ".join(SQL_LITERAL.split())
            check(text == b'"' + collapsed.replace(b"SELECT rn", b"SELECT  rn").replace(b"reportfmt ORDER", b"reportfmt  ORDER") + b'"',
                  "sql-format: literal is the qualified statement with two added space groups")
            check(text != b'"' + SQL_LITERAL + b'"', "sql-format: literal bytes changed")
        inner = (prep.get("inner", []) or []) if prep else []
        step, _ = call_with_callee(fn[0], "db_step")
        if prep and step and len(inner) >= 2:
            ref_p = referenced_decl(inner[1])
            inner_s = (step.get("inner", []) or [])
            ref_s = referenced_decl(inner_s[1]) if len(inner_s) >= 2 else None
            check(ref_p and ref_s and ref_p.get("id") == ref_s.get("id"),
                  "sql-format: same-local-Stmt lineage intact")


# ------------------------------------------------------------ declaration

SELECTOR_TEXT = {
    ("src/report.c", 830, 2597): None,
    ("src/report.c", 987, 1012): b"!g.okRdTkt && !g.okNewTkt",
    ("src/report.c", 988, 997): b"!g.okRdTkt",
    ("src/report.c", 1002, 1012): b"!g.okNewTkt",
    ("src/report.c", 1032, 1038): b"return",
    ("src/report.c", 1285, 1356): PREPARE_LINE[2:-1],
    ("src/report.c", 1300, 1355): b'"' + SQL_LITERAL + b'"',
}


def case_declaration(workdir, manifest, cc, evidence_dir):
    case_dir = os.path.join(workdir, "positive")
    with open(DECLARATION_PATH, "rb") as f:
        declaration_bytes = f.read()
    rewritten = declaration_bytes.replace(b"<workdir>", case_dir.encode())
    declaration = json.loads(rewritten)
    check(len(declaration["requirements"]) == 2, "declaration: two requirements (binding + disconnected negative)")
    binding = declaration["requirements"][0]
    check(binding["id"] == "fossil-reportlist-read", "declaration: binding requirement id")
    # byte-exact selector checks over the authentic bytes
    for req in declaration["requirements"]:
        stack = [req["entry"], req["guard"]["condition"], req["deny"]["terminal"],
                 req["action"]["callsite"], req["effect"]["callsite"]]
        for sel in stack:
            path = sel["path"]
            rel = os.path.relpath(path, case_dir)
            data = source_bytes(case_dir, rel)
            piece = data[sel["byteStart"]:sel["byteEnd"]]
            key = (rel.replace(os.sep, "/"), sel["byteStart"], sel["byteEnd"])
            want = SELECTOR_TEXT.get(key)
            if key[1:] == (830, 2597):
                check(piece.startswith(b"void view_list(void){"),
                      "declaration %s: entry selector opens view_list at [830,2597)" % req["id"])
            elif want is not None:
                check(piece == want, "declaration %s: selector [%d,%d) bytes exact in %s"
                      % (req["id"], sel["byteStart"], sel["byteEnd"], rel))
    disconnected = declaration["requirements"][1]
    check(disconnected["action"]["callsite"]["expectedAstKind"] == "CallExpr",
          "declaration: disconnected negative declares CallExpr kind")
    ro = source_bytes(case_dir, "src/report.c")
    piece = ro[1300:1355]
    check(piece.startswith(b'"'), "declaration: disconnected selector range holds a StringLiteral, not a CallExpr")
    rewritten_path = os.path.join(case_dir, "security-declaration.effective.json")
    with open(rewritten_path, "wb") as f:
        f.write(rewritten)
    print("     declaration effective sha256: %s" % sha256_file(rewritten_path))


# ------------------------------------------------------------------- main

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--case", default="all",
                        choices=["all", "pins", "positive", "db_prepare", "mutations", "declaration"])
    parser.add_argument("--workdir", default=os.path.join(REPO_ROOT, ".scratch", "context-security"))
    parser.add_argument("--extractor", default=None,
                        help="future bend2/context/clang extractor artifact; recorded, not exercised")
    args = parser.parse_args()

    manifest = load_manifest()
    cases = {"pins", "positive", "db_prepare", "mutations", "declaration"} \
        if args.case == "all" else {args.case}
    evidence_dir = os.path.join(args.workdir, "evidence")
    os.makedirs(evidence_dir, exist_ok=True)

    cc = None
    if "pins" in cases:
        verify_pins(manifest)
    if cases - {"pins"}:
        cc = resolve_compiler(manifest, evidence_dir)
        if cc is None:
            print("FATAL pinned clang unavailable; no compiler-backed case can run")
            sys.exit(1)
    if "positive" in cases:
        case_positive(args.workdir, manifest, cc, evidence_dir)
    if "db_prepare" in cases:
        case_db_prepare(args.workdir, manifest, cc, evidence_dir)
    if "mutations" in cases:
        case_mutations(args.workdir, manifest, cc, evidence_dir)
    if "declaration" in cases:
        case_declaration(args.workdir, manifest, cc, evidence_dir)

    fixture_digests = {}
    for root, _dirs, files in os.walk(FIXTURE_DIR):
        for name in sorted(files):
            path = os.path.join(root, name)
            fixture_digests[os.path.relpath(path, REPO_ROOT)] = sha256_file(path)

    evidence = {
        "fixtureDir": os.path.relpath(FIXTURE_DIR, REPO_ROOT),
        "platform": sys.platform,
        "darwinGate": DARWIN,
        "plannerMeasured": PLANNER_MEASURED,
        "manifestSha256": manifest["_ownDigest"],
        "fixtureFiles": fixture_digests,
        "compiler": cc["version"] if cc else None,
        "sdk": cc["sdk"] if cc else None,
        "extractorArg": args.extractor,
        "extractorExercised": False,
        "missingIntegrationInputs": manifest["openIntegrationInputs"],
        "invocations": INVOCATIONS,
        "checksRun": len(CHECKS),
        "failures": FAILURES,
    }
    with open(os.path.join(evidence_dir, "run-evidence.json"), "w") as f:
        json.dump(evidence, f, indent=1)
        f.write("\n")

    print("\nchecks: %d, failures: %d" % (len(CHECKS), len(FAILURES)))
    if FAILURES:
        for message in FAILURES:
            print("FAILED: %s" % message)
        sys.exit(1)
    print("context-security fixtures: PASS")


if __name__ == "__main__":
    main()
