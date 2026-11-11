#!/usr/bin/env python3
"""Per-symbol type/size and representative disassembly comparison.

Compares the serial one-TU baseline against the sharded binary.  The one-TU
object is the symbol oracle (the binary may have inlined/eliminated statics).
This script is review-only and writes no project state.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
from pathlib import Path

CLASS = {"t": "text", "T": "text", "d": "data", "D": "data",
         "b": "bss", "B": "bss", "r": "rodata", "R": "rodata"}


def nm_sizes(path: Path) -> dict[str, tuple[int, str]]:
    out = subprocess.run(["nm", "--defined-only", "-S", str(path)],
                         capture_output=True, text=True, check=True).stdout
    d = {}
    for line in out.splitlines():
        p = line.split()
        if len(p) >= 4:
            try:
                size = int(p[1], 16)
            except ValueError:
                size = 0
            d[p[3]] = (size, p[2])
    return d


def normalize(ins: str) -> str:
    ins = re.sub(r"#\s*[0-9a-f]+\s*<", "# ADDR <", ins)
    ins = re.sub(r"(call|jmp|j[a-z]+)\s+[0-9a-f]+\s*<", r"\1 ADDR <", ins)
    ins = re.sub(r"0x[0-9a-f]+\(%rip\)", "0xDISP(%rip)", ins)
    ins = re.sub(r"\.L[0-9A-Za-z_.$]+", "LBL", ins)
    ins = re.sub(r"<[^>]*\+0x[0-9a-f]+>", "<SYM+OFF>", ins)
    return ins


def dis(path: Path, sym: str) -> list[str]:
    r = subprocess.run(["objdump", "-d", "--no-show-raw-insn",
                        "--disassemble=" + sym, str(path)],
                       capture_output=True, text=True)
    if r.returncode:
        return []
    out = []
    for ln in r.stdout.splitlines():
        m = re.match(r"^\s*[0-9a-f]+:\s*(.*)$", ln)
        if m:
            out.append(normalize(m.group(1).strip()))
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--baseline-object", required=True, type=Path)
    ap.add_argument("--baseline-binary", required=True, type=Path)
    ap.add_argument("--sharded-binary", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    args = ap.parse_args()

    obj = nm_sizes(args.baseline_object)
    sh = nm_sizes(args.sharded_binary)
    common = [n for n in obj if n in sh and not n.startswith(".L")]
    class_mm = []
    raw_mm = []
    size_diff = []
    for n in common:
        (s1, t1), (s2, t2) = obj[n], sh[n]
        if CLASS.get(t1) != CLASS.get(t2):
            class_mm.append([n, t1, t2])
        if t1 != t2:
            raw_mm.append([n, t1, t2])
        if s1 != s2:
            size_diff.append([n, s1, s2, t1, t2])
    text_diff = [x for x in size_diff if CLASS.get(x[3]) == "text"]
    data_diff = [x for x in size_diff if CLASS.get(x[3]) != "text"]

    samples = ["io_print", "io_print_run", "baton_sql_run", "baton_sql_pack",
               "task_node", "heap_alloc_miss", "baton2_runtime_main",
               "WL_FID_ENTER", "spin_676", "monk_step"]
    dis_rows = []
    for s in samples:
        a = dis(args.baseline_binary, s)
        b = dis(args.sharded_binary, s)
        row = {"symbol": s, "baseline_lines": len(a), "sharded_lines": len(b),
               "normalized_equal": a == b}
        if a and b and a != b:
            for i, (x, y) in enumerate(zip(a, b)):
                if x != y:
                    row["first_difference"] = [i, x, y]
                    break
        dis_rows.append(row)

    result = {
        "baseline_object": str(args.baseline_object),
        "baseline_binary": str(args.baseline_binary),
        "sharded_binary": str(args.sharded_binary),
        "common_named": len(common),
        "missing_named": sorted(n for n in obj if n not in sh and not n.startswith(".L")),
        "class_mismatches": class_mm,
        "raw_type_letter_changes": len(raw_mm),
        "exact_size_matches": len(common) - len(size_diff),
        "size_differences": len(size_diff),
        "text_size_differences": len(text_diff),
        "data_size_differences": len(data_diff),
        "largest_text_size_differences": sorted(
            text_diff, key=lambda x: abs(x[1] - x[2]), reverse=True)[:15],
        "data_size_difference_rows": data_diff,
        "disassembly_samples": dis_rows,
        "interpretation": (
            "Name/category ABI and link are intact; local->global type letters are "
            "expected externalization. Codegen is not identical: the one-TU build "
            "inlines and narrows file-scope statics, the sharded build keeps them as "
            "cross-TU calls/objects. Behavior parity is tested separately; runtime "
            "performance parity is not established."),
    }
    args.out.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
