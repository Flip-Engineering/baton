#!/usr/bin/env python3
"""Split a Bend-emitted C translation unit into deterministic compile shards.

The emitted file is a single translation unit with a regular structure:

    runtime prefix (types, macros, tables, runtime functions, globals)
    // Spins      static string image and suspension helpers
    // Work       wl_tab[] and the segment prototypes
    // Segments   one preserve_none function per emitted segment
    // Requests   foreign IO implementations and effect constructors
    cli/main

This tool preserves that ordering and split only at the structured segment
boundary.  It produces:

    baton_prefix.h      declaration view of the runtime prefix + spin prototypes
    baton_segments.h    baton_prefix.h + Work section declarations + segment protos
    baton_core.c        runtime prefix definitions + Work + Requests + cli/main
    baton_spins.c       STAT_IMG + spin definitions (original WL_SPIN macros)
    shard_NN.c          baton_segments.h + a deterministic subset of segments

Every definition is emitted exactly once.  File-scope static definitions are
made external so the declaration header is sufficient; constructors stay in
the single core translation unit, so effect registration order is unchanged.
Global variable definitions keep their original relative order in the core
translation unit.

The tool is intentionally conservative: it understands the emitted dialect's
structured boundaries and does not attempt to parse arbitrary C.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path


# ---------------------------------------------------------------------------
# Source layout


@dataclass(frozen=True)
class Layout:
    spins_start: int          # 0-based line of the "// Spins" marker
    work_start: int           # 0-based line of the "// Work" marker
    segments_start: int       # 0-based line of the "// Segments" marker
    requests_start: int       # 0-based line of the "// Requests" marker


MARKERS = {
    "Spins": re.compile(r"^// Spins$"),
    "Work": re.compile(r"^// Work$"),
    "Segments": re.compile(r"^// Segments$"),
    "Requests": re.compile(r"^// Requests$"),
}


def _find_marker(lines: list[str], name: str) -> int:
    pat = MARKERS[name]
    hits = [i for i, line in enumerate(lines) if pat.match(line)]
    if len(hits) != 1:
        raise SystemExit(f"expected exactly one {name} marker, found {hits}")
    i = hits[0]
    underline = "// " + "=" * len(name)
    if i + 1 >= len(lines) or lines[i + 1].rstrip("\n") != underline:
        raise SystemExit(f"{name} marker at line {i + 1} is not underlined as expected")
    return i


def find_layout(lines: list[str]) -> Layout:
    return Layout(
        spins_start=_find_marker(lines, "Spins"),
        work_start=_find_marker(lines, "Work"),
        segments_start=_find_marker(lines, "Segments"),
        requests_start=_find_marker(lines, "Requests"),
    )


# ---------------------------------------------------------------------------
# Text transforms


MACRO_RULES = (
    # INLINE must become an external, non-inline definition in every TU that
    # defines a runtime helper.  Leaving `inline` alone would permit C99
    # inline semantics where no external definition is emitted.
    (re.compile(r"^#define INLINE  static inline$"),
     "#define INLINE"),
    # OUTLINE/FAR/WL_FN keep their attributes but lose internal linkage.
    (re.compile(r"^(#define\s+(?:OUTLINE|FAR|WL_FN)\b[^\n]*?)\bstatic\s+"),
     r"\1"),
    # CONSTV becomes external const data; the definitions live in core/spins.
    (re.compile(r"^(#define CONSTV\s+)static const$"),
     r"\1const"),
)


def transform_macros(text: str) -> str:
    out = []
    for line in text.splitlines(keepends=True):
        stripped = line.rstrip("\n")
        for pat, repl in MACRO_RULES:
            if pat.match(stripped):
                stripped = pat.sub(repl, stripped)
                break
        out.append(stripped + ("\n" if line.endswith("\n") else ""))
    return "".join(out)


TOP_STATIC = re.compile(r"^static ", re.MULTILINE)


def externalize(text: str) -> str:
    """give file-scope definitions external linkage"""
    return TOP_STATIC.sub("", transform_macros(text))


# ---------------------------------------------------------------------------
# Top-level item scanner (declaration view only)
#
# The runtime prefix and the Spins region contain balanced C.  The Work
# section is handled separately because its device branch is deliberately
# unbalanced (the device switch body is supplied by the Segments section).


@dataclass
class Item:
    kind: str                 # "directive" | "code" | "a32_loop" | "wl_table_decl"
    text: str
    a32_name: str | None = None


A32_LOOP_RE = re.compile(r"^A32_LOOP\((\w+),\s*.*\)\s*$")
WL_TABLE_DECL_RE = re.compile(r"^WL_TABLE\s+WL_X\([^)]*\)\s*$")


DIALECT_BRACE_DEFAULTS = {"WL_SPIN": 1, "WL_SPUN": -1, "WL_OPEN": 1}


def macro_net_braces(text: str, name: str) -> int | None:
    """net literal braces in the first definition of a function-like macro"""
    lines = text.splitlines()
    for i, line in enumerate(lines):
        match = re.match(r"^\s*#\s*define\s+" + re.escape(name) + r"\b(.*)$", line)
        if match is None:
            continue
        replacement = match.group(1)
        while lines[i].rstrip("\r").endswith("\\") and i + 1 < len(lines):
            i += 1
            replacement += "\n" + lines[i]
        return replacement.count("{") - replacement.count("}")
    return None


def scan_items(
    text: str,
    brace_deltas: dict[str, int] | None = None,
) -> list[Item]:
    """Return top-level directives and balanced C items.

    Directives inside a braced body remain part of that body.  The dialect
    macros WL_SPIN, WL_SPUN and WL_OPEN expand to code with a net brace
    effect even though the emitted source contains no literal brace for it;
    account for that effect so a spin body is not closed early.
    """
    if brace_deltas is None:
        brace_deltas = DIALECT_BRACE_DEFAULTS
    items: list[Item] = []
    n = len(text)
    i = 0
    chunk_start: int | None = None
    brace = paren = brack = 0
    state = "normal"

    def flush(end: int) -> None:
        nonlocal chunk_start
        if chunk_start is not None:
            items.append(Item("code", text[chunk_start:end]))
            chunk_start = None

    while i < n:
        if state == "line_comment":
            if text[i] == "\n":
                state = "normal"
            i += 1
            continue
        if state == "block_comment":
            if text.startswith("*/", i):
                state = "normal"
                i += 2
            else:
                i += 1
            continue
        if state in ("string", "char"):
            quote = '"' if state == "string" else "'"
            if text[i] == "\\":
                i += 2
                continue
            if text[i] == quote:
                state = "normal"
            i += 1
            continue

        c = text[i]

        # Dialect macros with a net brace effect but no literal brace.
        matched_dialect = False
        for token, delta in brace_deltas.items():
            if not text.startswith(token, i):
                continue
            before = text[i - 1] if i else ""
            after = text[i + len(token)] if i + len(token) < n else ""
            if before.isalnum() or before == "_" or after.isalnum() or after == "_":
                continue
            if chunk_start is None:
                chunk_start = i
            brace += delta
            i += len(token)
            matched_dialect = True
            break
        if matched_dialect:
            continue

        # A preprocessor directive only starts a new item at top level.
        if chunk_start is None and brace == 0 and paren == 0 and brack == 0:
            if c == "#" and (i == 0 or text[i - 1] == "\n"):
                j = i
                while True:
                    e = text.find("\n", j)
                    if e < 0:
                        e = n
                    segment = text[j:e]
                    if segment.rstrip("\r").endswith("\\") and e < n:
                        j = e + 1
                        continue
                    j = e
                    break
                if j < n and text[j] == "\n":
                    j += 1
                items.append(Item("directive", text[i:j]))
                i = j
                continue

            # Macro calls without a trailing semicolon.
            if c not in " \t\r\n" and (i == 0 or text[i - 1] == "\n"):
                line_end = text.find("\n", i)
                if line_end < 0:
                    line_end = n
                line = text[i:line_end].rstrip("\r")
                m = A32_LOOP_RE.match(line)
                if m:
                    items.append(Item("a32_loop", line, m.group(1)))
                    i = line_end + (1 if line_end < n else 0)
                    continue
                if WL_TABLE_DECL_RE.match(line):
                    items.append(Item("wl_table_decl", line))
                    i = line_end + (1 if line_end < n else 0)
                    continue

        if text.startswith("//", i):
            state = "line_comment"
            i += 2
            continue
        if text.startswith("/*", i):
            state = "block_comment"
            i += 2
            continue
        if c == '"':
            if chunk_start is None:
                chunk_start = i
            state = "string"
            i += 1
            continue
        if c == "'":
            if chunk_start is None:
                chunk_start = i
            state = "char"
            i += 1
            continue

        if chunk_start is None:
            if c in " \t\r\n":
                i += 1
                continue
            chunk_start = i

        if c == "{":
            brace += 1
        elif c == "}":
            if brace > 0:
                brace -= 1
            if brace == 0 and paren == 0 and brack == 0:
                prefix = text[chunk_start:i]
                head = prefix.lstrip()
                brace_at = prefix.find("{")
                signature = prefix[:brace_at] if brace_at >= 0 else prefix
                is_type = head.startswith("typedef") or (
                    re.match(r"^(struct|union|enum)\b", head) is not None
                    and "(" not in signature
                )
                # A type definition or a braced initializer continues to its
                # terminating semicolon.  A function body ends at the brace.
                if not (is_type or "=" in signature):
                    k = i + 1
                    while k < n and text[k] in " \t\r\n":
                        k += 1
                    if k < n and text[k] == ";":
                        k += 1
                    flush(k)
                    i = k
                    continue
        elif c == "(":
            paren += 1
        elif c == ")":
            paren -= 1
        elif c == "[":
            brack += 1
        elif c == "]":
            brack -= 1
        elif c == ";" and brace == 0 and paren == 0 and brack == 0:
            if chunk_start is not None:
                flush(i + 1)
            i += 1
            continue
        i += 1

    flush(n)
    return items


# ---------------------------------------------------------------------------
# Declaration generation


ATTR_PAREN = re.compile(
    r"(__attribute__|__declspec|PRESERVE|alignas|__asm__|__typeof__)\s*\($"
)


def _first_top_level(chunk: str, chars: str) -> tuple[int, str] | None:
    """first occurrence of any char in `chars` outside strings/comments"""
    i = 0
    n = len(chunk)
    state = "normal"
    depth = 0
    while i < n:
        if state == "line_comment":
            if chunk[i] == "\n":
                state = "normal"
            i += 1
            continue
        if state == "block_comment":
            if chunk.startswith("*/", i):
                state = "normal"
                i += 2
            else:
                i += 1
            continue
        if state in ("string", "char"):
            q = '"' if state == "string" else "'"
            if chunk[i] == "\\":
                i += 2
                continue
            if chunk[i] == q:
                state = "normal"
            i += 1
            continue
        if chunk.startswith("//", i):
            state = "line_comment"
            i += 2
            continue
        if chunk.startswith("/*", i):
            state = "block_comment"
            i += 2
            continue
        c = chunk[i]
        if c == '"':
            state = "string"
            i += 1
            continue
        if c == "'":
            state = "char"
            i += 1
            continue
        if c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
        elif depth == 0 and c in chars:
            return i, c
        i += 1
    return None


def _strip_leading_static(chunk: str) -> str:
    return re.sub(r"^\s*static\s+", "", chunk)


def _prototype(chunk: str) -> str:
    cut = _first_top_level(chunk, "{")
    if cut is None:
        raise ValueError("function definition has no opening brace")
    sig = chunk[: cut[0]].rstrip()
    sig = _strip_leading_static(sig)
    return sig + ";\n"


def _extern_decl(chunk: str) -> str:
    eq = _first_top_level(chunk, "=")
    semi = chunk.rstrip().rfind(";")
    if semi < 0:
        raise ValueError("variable definition has no semicolon")
    if eq is not None and eq[0] < semi:
        decl = chunk[: eq[0]].rstrip()
    else:
        decl = chunk[: semi].rstrip()
    decl = _strip_leading_static(decl)
    if re.match(r"^extern\b", decl):
        return decl + ";\n"
    return "extern " + decl + ";\n"


ATTRIBUTE_CALL_RE = re.compile(
    r"(?:__attribute__|PRESERVE|alignas|__declspec|__asm__|__typeof__)\s*\("
)


def _strip_attributes(text: str) -> str:
    """blank attribute/asm calls so their parentheses are not declarators"""
    out: list[str] = []
    i = 0
    while i < len(text):
        match = ATTRIBUTE_CALL_RE.match(text, i)
        if match is None:
            out.append(text[i])
            i += 1
            continue
        j = match.end() - 1
        depth = 0
        while j < len(text):
            if text[j] == "(":
                depth += 1
            elif text[j] == ")":
                depth -= 1
                if depth == 0:
                    j += 1
                    break
            j += 1
        out.append(" " * (j - i))
        i = j
    return "".join(out)


def _looks_like_function_decl(chunk: str) -> bool:
    """A prototype has an identifier immediately before a top-level '('."""
    chunk = _strip_attributes(chunk)
    i = 0
    n = len(chunk)
    state = "normal"
    while i < n:
        if state == "line_comment":
            if chunk[i] == "\n":
                state = "normal"
            i += 1
            continue
        if state == "block_comment":
            if chunk.startswith("*/", i):
                state = "normal"
                i += 2
            else:
                i += 1
            continue
        if state in ("string", "char"):
            q = '"' if state == "string" else "'"
            if chunk[i] == "\\":
                i += 2
                continue
            if chunk[i] == q:
                state = "normal"
            i += 1
            continue
        if chunk.startswith("//", i):
            state = "line_comment"
            i += 2
            continue
        if chunk.startswith("/*", i):
            state = "block_comment"
            i += 2
            continue
        if chunk[i] == '"':
            state = "string"
            i += 1
            continue
        if chunk[i] == "'":
            state = "char"
            i += 1
            continue
        if chunk[i] == "(":
            j = i - 1
            while j >= 0 and chunk[j] in " \t\r\n":
                j -= 1
            k = j
            while k >= 0 and (chunk[k].isalnum() or chunk[k] == "_"):
                k -= 1
            ident = chunk[k + 1: j + 1]
            if ident and not ATTR_PAREN.search(chunk[max(0, k + 1): i + 1]):
                return True
            i += 1
            continue
        i += 1
    return False




COND_DIRECTIVE_RE = re.compile(r"^\s*#\s*(if|ifdef|ifndef|else|elif|endif)\b")


def conditional_directives(chunk: str) -> tuple[list[str], bool]:
    """Return line-start conditional directives and whether they are balanced.

    A chunk whose conditional directives do not balance is a declaration
    split across preprocessor branches (the device kernel declaration is the
    emitted example).  Such a chunk must not produce a prototype: the
    conditional directives are preserved so the surrounding header stays
    balanced, and the code is dropped.
    """
    directives = [
        line.strip()
        for line in chunk.splitlines()
        if COND_DIRECTIVE_RE.match(line)
    ]
    depth = 0
    unbalanced = False
    for directive in directives:
        word = COND_DIRECTIVE_RE.match(directive).group(1)
        if word in ("if", "ifdef", "ifndef"):
            depth += 1
        elif word == "endif":
            depth -= 1
            if depth < 0:
                unbalanced = True
    return directives, unbalanced or depth != 0


def declaration_view(
    text: str,
    dropped: list[str] | None = None,
    brace_deltas: dict[str, int] | None = None,
) -> str:
    """Return declarations for every definition in `text`."""
    out: list[str] = []
    a32_names: list[str] = []
    for item in scan_items(text, brace_deltas):
        if item.kind == "directive":
            out.append(transform_macros(item.text))
        elif item.kind == "a32_loop":
            a32_names.append(item.a32_name or "")
        elif item.kind == "wl_table_decl":
            out.append(item.text + "\n")
        else:
            chunk = item.text.strip()
            if not chunk:
                continue
            if chunk.startswith("//") or chunk.startswith("/*"):
                continue
            directives, split = conditional_directives(chunk)
            if split:
                if dropped is not None:
                    dropped.append(chunk.splitlines()[0][:160])
                out.extend(directive + "\n" for directive in directives)
                continue
            # type definitions are declarations and are copied unchanged
            if re.match(r"^(typedef|struct|union|enum)\b", chunk):
                out.append(_strip_leading_static(chunk) + "\n")
                continue
            brace = _first_top_level(chunk, "{")
            eq = _first_top_level(chunk, "=")
            if brace is not None:
                if eq is not None and eq[0] < brace[0]:
                    out.append(_extern_decl(chunk))
                else:
                    out.append(_prototype(chunk))
            else:
                if chunk.rstrip().endswith(";"):
                    if _looks_like_function_decl(chunk):
                        out.append(_strip_leading_static(chunk).rstrip() + "\n")
                    else:
                        out.append(_extern_decl(chunk))
                else:
                    # macro invocation, declaration-only
                    out.append(transform_macros(chunk) + "\n")
    for name in a32_names:
        if name:
            out.append(f"u32 a32_{name}(DEV u32* p, u32 v);\n")
    return "".join(out)


# ---------------------------------------------------------------------------
# Structured extraction


def extract_work_header(work_text: str) -> str:
    """Declaration view of the Work section.

    The device branch of work_loop is deliberately unbalanced, so it is not
    parsed.  Shards never call work_loop; the core translation unit keeps it.
    """
    lines = work_text.splitlines()
    out: list[str] = []
    for i, line in enumerate(lines):
        if line.startswith("static const WlFn wl_tab[]"):
            out.append("extern const WlFn wl_tab[];\n")
            continue
        if line.startswith("static Reply work_loop("):
            # drop the whole (unbalanced) definition; a prototype is not
            # needed by segment shards.
            break
        out.append(line + "\n")
    return "".join(out)


SEGMENT_START_RE = re.compile(r"^\s*WL_CASE\(([A-Za-z0-9_]+)\)\s*$")


@dataclass(frozen=True)
class Segment:
    fid: str
    text: str


def extract_segments(region_text: str) -> tuple[list[Segment], str]:
    """Split the region at the structured WL_CASE boundary.

    The region between the two markers contains the segment fill followed by
    runtime template code (Monk/Dev/Row/Pool/Gpu/Io).  Only the WL_CASE
    blocks are sharded; everything after the last block is returned as the
    tail template kept in the core translation unit.
    """
    lines = region_text.splitlines(keepends=True)
    starts = [i for i, line in enumerate(lines) if SEGMENT_START_RE.match(line)]
    if not starts:
        raise SystemExit("no WL_CASE segment blocks found")
    segments: list[Segment] = []
    ranges: list[tuple[int, int]] = []
    cursor = 0
    for start in starts:
        # include a preceding "#if !DEVICE" wrapper
        block_start = start
        if start > 0 and lines[start - 1].strip() == "#if !DEVICE":
            block_start = start - 1
        # find the function terminator "  }}"
        end = None
        for j in range(start + 1, len(lines)):
            if lines[j].rstrip("\r\n") == "  }}":
                end = j
                break
        if end is None:
            raise SystemExit(f"unterminated segment at line {start + 1}")
        if end + 1 < len(lines) and lines[end + 1].strip() == "#endif":
            end += 1
        if block_start < cursor:
            raise SystemExit("overlapping segment blocks")
        fid = SEGMENT_START_RE.match(lines[start]).group(1)
        segments.append(Segment(fid, "".join(lines[block_start:end + 1])))
        ranges.append((block_start, end))
        cursor = end + 1
    # Fail closed on every inter-segment byte.  Comments and whitespace are
    # allowed; any directive or code item in a gap is unclassified input.
    previous_end = -1
    for index, (block_start, block_end) in enumerate(ranges):
        gap_start = previous_end + 1
        gap = "".join(lines[gap_start:block_start])
        unexpected = scan_items(gap)
        if unexpected:
            first = unexpected[0]
            line_no = gap_start + gap[: gap.find(first.text)].count("\n") + 1
            raise SystemExit(
                "unclassified inter-segment bytes at region line "
                f"{line_no}: {first.text.strip()[:120]!r}"
            )
        previous_end = block_end
    tail = "".join(lines[ranges[-1][1] + 1:])
    return segments, tail


def partition(segments: list[Segment], count: int) -> list[list[Segment]]:
    """Deterministic greedy balance by source bytes, source order preserved."""
    if count < 1:
        raise SystemExit("shard count must be >= 1")
    loads = [0] * count
    shards: list[list[Segment]] = [[] for _ in range(count)]
    for seg in segments:
        target = min(range(count), key=lambda k: (loads[k], k))
        shards[target].append(seg)
        loads[target] += len(seg.text.encode("utf-8"))
    return shards


# ---------------------------------------------------------------------------
# Output


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def template_declaration_text(tail: str) -> str:
    """Declaration source for the post-segment runtime template.

    The tail starts with the device-only closing block of work_loop, whose
    braces are deliberately unbalanced.  Start at the first runtime section
    marker instead.  A host-only ``#if !DEVICE`` wrapper can remain open at
    the end of the tail because its ``#endif`` is after the Requests marker;
    drop that opening line so the declaration header is conditionally
    balanced.  Any other unbalanced preprocessor block is an error.
    """
    lines = tail.splitlines(keepends=True)
    start = 0
    for i, line in enumerate(lines):
        if re.match(r"^// (Monk|Dev|Window|Row|Pool|Gpu|Io|Chan|Show)$", line):
            start = i
            break
    view_lines = lines[start:]
    stack: list[tuple[int, str]] = []
    for i, line in enumerate(view_lines):
        stripped = line.strip()
        if stripped.startswith("#if"):
            stack.append((i, stripped))
        elif stripped.startswith("#endif"):
            if not stack:
                raise SystemExit(
                    f"unbalanced preprocessor block in runtime template: #endif at line {i + 1}"
                )
            stack.pop()
    drop: set[int] = set()
    for i, directive in stack:
        if re.match(r"#if\s+!DEVICE\b", directive):
            drop.add(i)
        else:
            raise SystemExit(
                f"unbalanced preprocessor block in runtime template: {directive}"
            )
    return "".join(line for i, line in enumerate(view_lines) if i not in drop)


def check_conditional_balance(text: str, name: str) -> None:
    depth = 0
    for i, line in enumerate(text.splitlines(), 1):
        stripped = line.lstrip()
        if stripped.startswith("#if"):
            depth += 1
        elif stripped.startswith("#endif"):
            depth -= 1
            if depth < 0:
                raise SystemExit(f"{name}: #endif without #if at line {i}")
    if depth != 0:
        raise SystemExit(f"{name}: {depth} unterminated preprocessor block(s)")


def build(input_path: Path, outdir: Path, shards: int) -> dict:
    raw = input_path.read_text(encoding="utf-8", errors="surrogateescape")
    lines = raw.splitlines(keepends=True)
    layout = find_layout(lines)


    prefix_text = "".join(lines[: layout.spins_start])
    spins_text = "".join(lines[layout.spins_start: layout.work_start])
    work_text = "".join(lines[layout.work_start: layout.segments_start])
    segments_region = "".join(lines[layout.segments_start + 2: layout.requests_start])
    requests_text = "".join(lines[layout.requests_start:])

    segments, tail_template = extract_segments(segments_region)

    # Every emitted segment must survive byte-for-byte, and every fid must
    # be unique.  extract_segments builds each block from the exact region
    # slice, so this is an O(n) identity check rather than a whole-input
    # substring search per segment.
    fids = [seg.fid for seg in segments]
    if len(set(fids)) != len(fids):
        raise SystemExit("duplicate segment fid in emitted C")
    segment_fill = "".join(seg.text for seg in segments)

    # The header is a declaration view of everything the shards may call:
    # the runtime prefix, the post-segment runtime template, and the spin
    # helpers.  The Requests fill is deliberately excluded: it is the only
    # place where macro invocations (BP_EFFECT) expand to definitions, and
    # segment bodies never call those functions.
    expected_braces = {"WL_SPIN": 1, "WL_SPUN": -1, "WL_OPEN": 1}
    dialect_braces: dict[str, int] = {}
    for name, expected in expected_braces.items():
        actual = macro_net_braces(prefix_text, name)
        if actual is None:
            raise SystemExit(f"missing dialect macro {name}")
        if actual != expected:
            raise SystemExit(
                f"dialect macro {name} has net braces {actual}, expected {expected}"
            )
        dialect_braces[name] = actual

    dropped_declarations: list[str] = []
    prefix_view = declaration_view(
        prefix_text + template_declaration_text(tail_template),
        dropped_declarations,
        dialect_braces,
    )
    spins_view = declaration_view(spins_text, dropped_declarations, dialect_braces)
    work_view = extract_work_header(work_text)

    prefix_h = (
        "#ifndef BATON_SHARD_PREFIX_H\n"
        "#define BATON_SHARD_PREFIX_H\n"
        "/* generated declaration view of the emitted runtime and template */\n"
        + prefix_view
        + "\n/* spin helpers defined in baton_spins.c */\n"
        + spins_view
        + "\n#endif\n"
    )
    segments_h = (
        "#ifndef BATON_SHARD_SEGMENTS_H\n"
        "#define BATON_SHARD_SEGMENTS_H\n"
        '#include "baton_prefix.h"\n'
        "/* generated declaration view of the Work section */\n"
        + work_view
        + "\n#endif\n"
    )

    check_conditional_balance(prefix_h, "baton_prefix.h")
    check_conditional_balance(segments_h, "baton_segments.h")

    core_c = (
        "/* generated core translation unit */\n"
        + externalize(prefix_text)
        + "\nextern const u64 STAT_IMG[];\n\n"
        + externalize(work_text)
        + externalize(tail_template)
        + externalize(requests_text)
    )
    spins_c = (
        "/* generated spin translation unit */\n"
        + '#include "baton_prefix.h"\n\n'
        + externalize(spins_text)
    )

    shard_sets = partition(segments, shards)

    outdir.mkdir(parents=True, exist_ok=True)
    files: dict[str, str] = {
        "baton_prefix.h": prefix_h,
        "baton_segments.h": segments_h,
        "baton_core.c": core_c,
        "baton_spins.c": spins_c,
    }
    shard_rows = []
    for i, segs in enumerate(shard_sets):
        name = f"shard_{i:02d}.c"
        body = (
            f"/* generated shard {i}: {len(segs)} segments */\n"
            '#include "baton_segments.h"\n\n'
            + "".join(seg.text + "\n" for seg in segs)
        )
        files[name] = body
        shard_rows.append({
            "name": name,
            "segments": len(segs),
            "bytes": len(body.encode("utf-8")),
            "sha256": sha256_text(body),
            "fids": [seg.fid for seg in segs],
        })

    for name, body in files.items():
        (outdir / name).write_text(body, encoding="utf-8", errors="surrogateescape")

    region_hashes = {
        name: {
            "bytes": len(text.encode("utf-8")),
            "sha256": sha256_text(text),
        }
        for name, text in (
            ("prefix", prefix_text),
            ("spins", spins_text),
            ("work", work_text),
            ("segment_fill", segment_fill),
            ("tail_template", tail_template),
            ("requests", requests_text),
        )
    }

    manifest = {
        "schema": "baton-cgen-clang-parallel-split-v1",
        "input": str(input_path),
        "input_bytes": input_path.stat().st_size,
        "input_sha256": hashlib.sha256(input_path.read_bytes()).hexdigest(),
        "dropped_split_declarations": dropped_declarations,
        "segment_bytes": len(segment_fill.encode("utf-8")),
        "segment_text_sha256": sha256_text(segment_fill),
        "segment_text_preserved": True,
        "regions": region_hashes,
        "layout": {
            "spins_line": layout.spins_start + 1,
            "work_line": layout.work_start + 1,
            "segments_line": layout.segments_start + 1,
            "requests_line": layout.requests_start + 1,
        },
        "counts": {
            "segments": len(segments),
            "spins": spins_view.count("spin_"),
            "shards": shards,
        },
        "shards": shard_rows,
        "files": {
            name: {
                "bytes": len(body.encode("utf-8")),
                "sha256": sha256_text(body),
            }
            for name, body in files.items()
        },
    }
    (outdir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--input", required=True, type=Path)
    ap.add_argument("--outdir", required=True, type=Path)
    ap.add_argument("--shards", required=True, type=int)
    args = ap.parse_args(argv)
    manifest = build(args.input, args.outdir, args.shards)
    print(json.dumps({
        "outdir": str(args.outdir),
        "segments": manifest["counts"]["segments"],
        "shards": manifest["counts"]["shards"],
        "files": len(manifest["files"]),
        "shard_bytes": [row["bytes"] for row in manifest["shards"]],
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
