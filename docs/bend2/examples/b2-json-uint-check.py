#!/usr/bin/env python3
"""Check the incremental U32 decoder against fixed grammar and range fixtures."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile


def bend_string(value):
    result = "SNil{}"
    for char in reversed(value):
        result = f"SCon{{Char.from_u32({ord(char)}), {result}}}"
    return result


def fixtures():
    accepted = ["0", "1", "9", "10", "4096", "429496729", "4294967290",
                "4294967294", "4294967295", " \t\r\n42\n\r\t ", "0 "]
    rejected = [
        ("", "expected_digit"), (" \t\r\n", "expected_digit"),
        ("00", "leading_zero"), ("01", "leading_zero"),
        ("0 1", "trailing_data"), ("1 2", "trailing_data"),
        ("4294967296", "u32_overflow"), ("4294967300", "u32_overflow"),
        ("9999999999", "u32_overflow"), ("42949672950", "u32_overflow"),
        ("-1", "expected_digit"), ("+1", "expected_digit"),
        ("1.0", "invalid_character"), ("1e2", "invalid_character"),
        ("0x10", "invalid_character"), ("1,", "invalid_character"),
        ("1\x00", "invalid_character"), ("\v1", "expected_digit"),
        ("1\f", "invalid_character"), ("\u00a01", "expected_digit"),
        ("\u0661", "expected_digit"), ("1\uff11", "invalid_character"),
        ("1 true", "trailing_data"), ("4294967296x", "u32_overflow"),
    ]
    rows = []
    for text in accepted:
        assert re.fullmatch(r"[ \t\r\n]*(0|[1-9][0-9]*)[ \t\r\n]*", text)
        value = int(text)
        assert 0 <= value <= 2**32 - 1
        rows.append((text, f"accepted:{value}"))
    rows.extend((text, "refused:" + reason) for text, reason in rejected)
    return rows


def harness(rows):
    cases, expected = [], []
    for text, result in rows:
        # Every two-part split includes empty initial and final chunks.
        partitions = [[text[:i], text[i:]] for i in range(len(text) + 1)]
        partitions.append([""] + list(text) + [""])
        for chunks in partitions:
            cases.append("[" + ", ".join(map(bend_string, chunks)) + "]")
            expected.append(result)
    source = """import Base
import ./decoder.bend as D

def chunks(parts: List<String>, state: D.UintState) -> D.UintState:
  match parts:
    case Nil{}: state
    case h <> t: chunks(t, D.feed(h, state))

def run(rows: List<List<String>>) -> IO(Unit):
  match rows:
    case Nil{}: IO.pure(Unit, Unit{})
    case h <> t:
      do IO<Unit>:
        u : Unit <- IO.print(D.result_text(D.finish(chunks(h, D.UintStart{}))))
        run(t)

def main() -> IO(Unit):
  do IO<Unit>:
    a : Unit <- IO.print(D.state_text(D.feed("", D.UintStart{})))
    b : Unit <- IO.print(D.state_text(D.feed("0", D.UintStart{})))
    c : Unit <- IO.print(D.state_text(D.feed("429", D.UintStart{})))
    d : Unit <- IO.print(D.state_text(D.feed("42 ", D.UintStart{})))
    run([CASES])
""".replace("CASES", ",\n      ".join(cases))
    expected = ["pending:start", "pending:zero", "pending:digits:429",
                "pending:trailing:42"] + expected
    return source, expected


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bend", required=True, type=Path)
    parser.add_argument("--backend", choices=["native", "interpreted"], default="native")
    parser.add_argument("--mutation", choices=["overflow", "leading-zero"],
                        help="run a negative control; a detected difference exits 1")
    parser.add_argument("--source", type=Path,
                        default=Path(__file__).with_name("b2-json-uint-decoder.bend"))
    args = parser.parse_args()
    bend = args.bend.resolve()
    root = Path(__file__).resolve().parents[3]
    scratch = root / ".scratch"
    scratch.mkdir(exist_ok=True)
    rows = fixtures()
    program, expected = harness(rows)
    source = args.source.read_text()
    if args.mutation:
        replacements = {
            "overflow": ("U32.is_lt(digit, 6)", "U32.is_lt(digit, 7)"),
            "leading-zero": ('case UintDigit{+value}: UintRejected{"leading_zero"}',
                             'case UintDigit{+value}: UintDigits{value}'),
        }
        before, after = replacements[args.mutation]
        if source.count(before) != 1:
            raise SystemExit("negative control requires exactly one source match")
        source = source.replace(before, after)
    with tempfile.TemporaryDirectory(prefix="uint-check-", dir=scratch) as directory:
        work = Path(directory)
        (work / "decoder.bend").write_text(source)
        runner = work / "runner.bend"
        runner.write_text(program)
        env = dict(os.environ, BEND_NO_TELEMETRY="1", TMPDIR=str(work))

        def execute(argv):
            result = subprocess.run(argv, env=env, cwd=work, text=True, capture_output=True)
            if result.returncode:
                raise SystemExit(f"exit={result.returncode}\n{result.stdout}{result.stderr}")
            return result.stdout

        if args.backend == "native":
            binary = work / "uint-check"
            execute([str(bend), str(runner), "-o", str(binary)])
            output = execute([str(binary)])
        else:
            output = execute([str(bend), str(runner)])
        actual = output.splitlines()
        if actual != expected:
            mismatches = [{"row": i, "expected": want, "actual": got}
                          for i, (want, got) in enumerate(zip(expected, actual)) if want != got]
            raise SystemExit(json.dumps({"expectedRows": len(expected),
                                         "actualRows": len(actual),
                                         "mismatchCount": len(mismatches),
                                         "firstMismatch": next(iter(mismatches), None)}))
        print(json.dumps({"backend": args.backend, "fixtures": len(rows),
                          "checks": len(expected), "passed": len(actual),
                          "outputSha256": hashlib.sha256(output.encode()).hexdigest()}, sort_keys=True))


if __name__ == "__main__":
    main()
