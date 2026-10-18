#!/usr/bin/env python3
"""Differential checks and size benchmark for the observer checkpoint codec."""

from __future__ import annotations

import json
import os
import statistics
import subprocess
import sys
import time
from pathlib import Path


def run(binary: Path, mode: str, text: str, timeout: int = 180) -> tuple[int, str, str, float]:
    encoded = text.encode("utf-8").hex().encode("ascii") + b"\n"
    started = time.monotonic()
    proc = subprocess.run(
        [str(binary), mode], input=encoded, capture_output=True, timeout=timeout
    )
    elapsed = time.monotonic() - started
    return proc.returncode, proc.stdout.decode("utf-8", "replace").strip(), proc.stderr.decode(
        "utf-8", "replace"
    ), elapsed


def run_hex(binary: Path, mode: str, hex_bytes: str) -> tuple[int, str, str]:
    proc = subprocess.run(
        [str(binary), mode], input=hex_bytes.encode("ascii") + b"\n", capture_output=True, timeout=30
    )
    return proc.returncode, proc.stdout.decode("utf-8", "replace").strip(), proc.stderr.decode(
        "utf-8", "replace"
    )


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(message)


def main() -> None:
    if len(sys.argv) == 1 and not os.environ.get("BATON2_CHECKPOINT_CODEC"):
        print(json.dumps({"skipped": True,
                          "reason": "set BATON2_CHECKPOINT_CODEC to the compiled probe"}))
        return
    if len(sys.argv) == 2:
        binary_arg = sys.argv[1]
    elif len(sys.argv) == 1:
        binary_arg = os.environ["BATON2_CHECKPOINT_CODEC"]
    else:
        raise SystemExit("usage: checkpoint-codec.py [BINARY]")
    binary = Path(binary_arg).resolve(strict=True)
    small = {
        "empty": "",
        "ascii": "checkpoint",
        "tabs-newlines": "a\t\n\tb\n",
        "nul": "before\0after",
        "unicode": "café 🧪 𐐷",
        "mixed": "\0\tline one\n雪\n\t",
    }
    for label, value in small.items():
        rc, output, stderr, _ = run(binary, "both", value)
        require(rc == 0, f"{label}: differential decoder refused valid input: {stderr[:300]}")
        require(output == f"equal:{len(value)}", f"{label}: unexpected decoder output {output!r}")

    # The production checkpoint's terminal has 795,495 Unicode code points and
    # 795,879 UTF-8 bytes. Keep the fixture generated at runtime rather than
    # committing a large terminal payload.
    chars = ["A"] * 795_495
    chars[0:5] = ["\0", "\t", "\n", "é", "🧪"]
    for index in range(5, 385):
        chars[index] = "é"
    large = "".join(chars)
    require(len(large) == 795_495, "large fixture code point count changed")
    require(len(large.encode("utf-8")) == 795_879, "large fixture byte count changed")
    rc, output, stderr, _ = run(binary, "both", large)
    require(rc == 0, f"large differential decoder refused valid input: {stderr[:300]}")
    require(output == f"equal:{len(large)}", f"large fixture mismatch: {output!r}")

    timings: dict[str, list[float]] = {"baseline": [], "fused": []}
    for _ in range(3):
        for mode in ("baseline", "fused"):
            rc, output, stderr, elapsed = run(binary, mode, large)
            require(rc == 0, f"{mode} decoder refused large fixture: {stderr[:300]}")
            require(output == str(len(large)), f"{mode} large count mismatch: {output!r}")
            timings[mode].append(round(elapsed, 3))
    medians = {mode: round(statistics.median(samples), 3)
               for mode, samples in timings.items()}

    # ContextText.hex_decode drops one unpaired trailing nibble; preserve that
    # current behavior in the fused scanner.
    rc, output, stderr = run_hex(binary, "raw-both", "41f")
    require(rc == 0 and output == "equal:1", f"odd nibble behavior changed: {stderr[:300]} {output!r}")

    # `ff` and a truncated four-byte sequence both encode invalid UTF-8.
    for malformed_hex in ("ff", "f09f92"):
        baseline_rc, _, baseline_err = run_hex(binary, "raw-baseline", malformed_hex)
        fused_rc, _, fused_err = run_hex(binary, "raw-fused", malformed_hex)
        require(baseline_rc != 0, "baseline accepted invalid UTF-8 checkpoint bytes")
        require(fused_rc == baseline_rc and fused_err == baseline_err,
                f"fused invalid-UTF8 refusal differs: baseline={baseline_rc}, fused={fused_rc}; "
                f"baseline={baseline_err[:160]!r}, fused={fused_err[:160]!r}")

    print(json.dumps({"binary": str(binary), "smallCases": len(small),
                      "largeChars": len(large), "largeUtf8Bytes": len(large.encode("utf-8")),
                      "largeSeconds": timings, "largeMedianSeconds": medians,
                      "medianSpeedup": round(medians["baseline"] / medians["fused"], 3)},
                     sort_keys=True))


if __name__ == "__main__":
    main()
