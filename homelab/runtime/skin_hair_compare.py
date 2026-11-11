"""Reproducible CPU comparison for the issue #87 skin/hair register.

Reads the pinned pipeline blobs from git, verifies their SHA-256s, evaluates
the baseline and candidate skin/hair material registers for both the
photorealistic and stylized thresholds, and writes one deterministic JSON
record.  It launches no render.

    python3 homelab/runtime/skin_hair_compare.py
    python3 homelab/runtime/skin_hair_compare.py --out skin_hair_comparison.json
    python3 homelab/runtime/skin_hair_compare.py --seed <128 hex> --style photorealistic

Exit status is 0 only when every requested candidate comparison passes.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import platform
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import human_skin_hair as material  # noqa: E402


def repo_root(explicit=None) -> Path:
    if explicit:
        return Path(explicit).resolve()
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            cwd=str(HERE),
            capture_output=True,
            check=False,
            text=True,
        )
    except OSError as error:
        raise SystemExit("cannot locate the repository: " + str(error))
    if result.returncode == 0 and result.stdout.strip():
        return Path(result.stdout.strip()).resolve()
    return HERE.parents[1]


def evaluate_style(style, seed, cast, source_commit):
    base = material.evaluate(
        {"style": style, "master_seed": seed, "cast": cast, "baseline": True, "source_commit": source_commit}
    )
    candidate = material.evaluate(
        {"style": style, "master_seed": seed, "cast": cast, "baseline": False, "source_commit": source_commit}
    )
    groom_off = material.evaluate(
        {
            "style": style,
            "master_seed": seed,
            "cast": cast,
            "baseline": False,
            "groom": False,
            "source_commit": source_commit,
        }
    )
    comparison = material.compare(base, candidate)
    groom_comparison = material.compare(candidate, groom_off)
    return {
        "style": style,
        "baseline": base,
        "candidate": candidate,
        "groom_off": groom_off,
        "comparison": comparison,
        "groom_comparison": groom_comparison,
        "material": material.material_registers(style, cast),
    }


def build_record(args):
    root = repo_root(args.repo)
    cache = getattr(build_record, "_pins", None)
    if cache is None or cache[0] != (root, args.commit):
        verified = material.pins(root, args.commit)
        cache = ((root, args.commit), verified)
        build_record._pins = cache
    pins = cache[1]
    cast = material.cast_specs()
    styles = args.style or list(material.STYLES)
    styles = list(dict.fromkeys(styles))
    results = {}
    for style in styles:
        results[style] = evaluate_style(style, args.seed, cast, args.commit)
    record = {
        "version": material.VERSION,
        "issue": "ACP human-material simulation issue #87 (S3 skin & hair)",
        "source_commit": args.commit,
        "master_seed": args.seed,
        "assignment_seed": material.ASSIGNMENT_SEED,
        "derived_seeds": {
            "skin": material.derive_seed(args.seed, "skin"),
            "hair": material.derive_seed(args.seed, "hair"),
        },
        "pins": pins,
        "cast": cast,
        "styles": results,
        "python": platform.python_version(),
        "render_launched": material.RENDER_LAUNCHED,
        "render_plan": material.check_no_render({"render": False}),
    }
    unsigned = {key: value for key, value in record.items() if key != "record_sha256"}
    record["record_sha256"] = material.digest(unsigned)
    return record, root


def print_table(record):
    print(
        f"issue87 skin/hair  seed={record['master_seed'][:12]}...  "
        f"source={record['source_commit'][:12]}  render_launched={record['render_launched']}"
    )
    print(f"{'style':14} {'metric':22} {'baseline':>10} {'candidate':>10} {'limit':>8} {'pass':>5}")
    for style, rows in record["styles"].items():
        comparison = rows["comparison"]
        for metric in comparison["metrics"]:
            base = rows["baseline"][metric]
            cand = rows["candidate"][metric]
            limit = comparison["thresholds"][metric]
            kind = material.THRESHOLDS[style][metric][0]
            passed = comparison["checks"][metric]
            print(
                f"{style:14} {metric:22} {base:10.4f} {cand:10.4f} "
                f"{('>=' if kind == 'min' else '<=') + format(limit, '.4g'):>8} "
                f"{'yes' if passed else 'NO':>5}"
            )
        print(
            f"{'':14} {'skin specular err':22} "
            f"{rows['baseline']['skin_specular_error']:10.4f} {rows['candidate']['skin_specular_error']:10.4f}"
        )
        print(
            f"{'':14} {'skin transport err mm':22} "
            f"{rows['baseline']['skin_transport_error_mm']:10.4f} {rows['candidate']['skin_transport_error_mm']:10.4f}"
        )
        print(
            f"{'':14} {'hair backlit share':22} "
            f"{rows['baseline']['hair_shading']['baseline']['backlit_share']:10.4f} "
            f"{rows['candidate']['hair_backlit_share']:10.4f}"
        )
        print(
            f"{'':14} {'hair mass albedo R':22} "
            f"{rows['baseline']['hair_mass_albedo'][0]:10.4f} {rows['candidate']['hair_mass_albedo'][0]:10.4f}"
        )
        print(
            f"{'':14} {'groom on/off hair mm':22} "
            f"{rows['candidate']['hair_deviation_mm']:10.4f} {rows['groom_off']['hair_deviation_mm']:10.4f}"
        )
    print(f"record_sha256 {record['record_sha256']}")


def parse_args(argv):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--repo", help="repository root (default: git rev-parse --show-toplevel)")
    parser.add_argument(
        "--commit",
        default=material.SOURCE_COMMIT,
        help="pinned commit whose source blobs are verified (default: %(default)s)",
    )
    parser.add_argument(
        "--seed",
        default=material.DEFAULT_MASTER_SEED,
        help="128 lowercase hex master seed (default: the issue's shared seed)",
    )
    parser.add_argument(
        "--style",
        action="append",
        choices=material.STYLES,
        help="style to compare (repeatable; default: both)",
    )
    parser.add_argument("--out", help="write the JSON record here")
    parser.add_argument("--json", action="store_true", help="print the record instead of the table")
    return parser.parse_args(argv)


def main(argv=None):
    args = parse_args(sys.argv[1:] if argv is None else argv)
    if not material._is_hex(args.seed, 128):
        raise SystemExit("--seed must be 128 lowercase hex characters")
    if not material._is_hex(args.commit, 40):
        raise SystemExit("--commit must be 40 lowercase hex characters")
    record, root = build_record(args)
    if args.out:
        out = Path(args.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(record, indent=2, sort_keys=True) + "\n")
        file_sha = hashlib.sha256(out.read_bytes()).hexdigest()
        print(f"wrote {out} ({out.stat().st_size} bytes, sha256 {file_sha})", file=sys.stderr)
    if args.json:
        print(json.dumps(record, indent=2, sort_keys=True))
    else:
        print_table(record)
    passed = all(row["comparison"]["passed"] for row in record["styles"].values())
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
