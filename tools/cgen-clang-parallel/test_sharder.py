#!/usr/bin/env python3
"""Unit tests for the emitted-C shard splitter.

Run with:
    python3 -m unittest -v tools/cgen-clang-parallel/test_sharder.py
"""

from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).with_name("shard_emitted_c.py")
_spec = importlib.util.spec_from_file_location("shard_emitted_c", MODULE_PATH)
shard = importlib.util.module_from_spec(_spec)
sys.modules["shard_emitted_c"] = shard
_spec.loader.exec_module(shard)


def block(fid: str, body: str = "    int value;") -> str:
    return (
        "#if !DEVICE\n"
        f"  WL_CASE({fid})\n"
        "  {\n"
        f"{body}\n"
        "  }}\n"
        "#endif\n"
    )


class ExtractSegmentsTests(unittest.TestCase):
    def test_blank_and_comment_gap_accepted(self) -> None:
        region = (
            "\n"
            + block("FID_A")
            + "\n// an explanatory comment\n\n"
            + block("FID_B")
            + "\n// runtime template begins here\nint tail(void) { return 0; }\n"
        )
        segments, tail = shard.extract_segments(region)
        self.assertEqual([s.fid for s in segments], ["FID_A", "FID_B"])
        self.assertEqual(segments[0].text, block("FID_A"))
        self.assertEqual(segments[1].text, block("FID_B"))
        self.assertTrue(tail.startswith("\n// runtime template begins here"))

    def test_leading_blank_and_comment_accepted(self) -> None:
        region = "\n// leading comment\n\n" + block("FID_A")
        segments, tail = shard.extract_segments(region)
        self.assertEqual(len(segments), 1)
        self.assertEqual(tail, "")

    def test_code_gap_rejected(self) -> None:
        region = block("FID_A") + "int junk;\n" + block("FID_B")
        with self.assertRaises(SystemExit) as caught:
            shard.extract_segments(region)
        self.assertIn("unclassified inter-segment bytes", str(caught.exception))

    def test_directive_gap_rejected(self) -> None:
        region = block("FID_A") + "#define JUNK 1\n" + block("FID_B")
        with self.assertRaises(SystemExit) as caught:
            shard.extract_segments(region)
        self.assertIn("unclassified inter-segment bytes", str(caught.exception))

    def test_leading_code_rejected(self) -> None:
        region = block("FID_A") + "\n}" + block("FID_B")
        with self.assertRaises(SystemExit):
            shard.extract_segments(region)

    def test_unterminated_block_rejected(self) -> None:
        region = "  WL_CASE(FID_A)\n  {\n    int x;\n"
        with self.assertRaises(SystemExit):
            shard.extract_segments(region)

    def test_tail_bytes_preserved(self) -> None:
        tail_text = "\n// tail\nINLINE int tail(void) { return 7; }\n"
        segments, tail = shard.extract_segments(block("FID_A") + tail_text)
        self.assertEqual(len(segments), 1)
        self.assertEqual(tail, tail_text)

    def test_partition_is_deterministic_and_balanced(self) -> None:
        blocks = [shard.Segment(f"FID_{i}", block(f"FID_{i}", " " * i)) for i in range(9)]
        first = shard.partition(blocks, 3)
        second = shard.partition(blocks, 3)
        self.assertEqual(
            [[s.fid for s in shard_] for shard_ in first],
            [[s.fid for s in shard_] for shard_ in second],
        )
        self.assertEqual(sum(len(s) for s in first), len(blocks))
        loads = [sum(len(s.text.encode()) for s in shard_) for shard_ in first]
        self.assertLessEqual(max(loads) - min(loads), max(len(s.text.encode()) for s in blocks))


class TemplateConditionalTests(unittest.TestCase):
    def test_unclosed_host_guard_is_dropped(self) -> None:
        tail = (
            "\n#if DEVICE\ndefault:;\n}\n#endif\n\n"
            "// Monk\n#if !DEVICE\nint host_decl(void);\n"
        )
        view = shard.template_declaration_text(tail)
        self.assertNotIn("#if !DEVICE", view)
        self.assertIn("int host_decl(void);", view)

    def test_other_unclosed_guard_fails_closed(self) -> None:
        tail = "\n// Monk\n#if BEND_METAL\nint x;\n"
        with self.assertRaises(SystemExit):
            shard.template_declaration_text(tail)

    def test_conditional_balance_check(self) -> None:
        shard.check_conditional_balance("#if A\n#endif\n", "ok")
        with self.assertRaises(SystemExit):
            shard.check_conditional_balance("#if A\n", "bad")
        with self.assertRaises(SystemExit):
            shard.check_conditional_balance("#endif\n", "bad")


if __name__ == "__main__":
    unittest.main()
