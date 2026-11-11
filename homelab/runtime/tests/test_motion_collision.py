import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

import motion_collision as mc


class MotionCollisionPreflight(unittest.TestCase):
    def test_seed_derivation_and_take_selection_are_deterministic(self):
        self.assertEqual(len(mc.ISSUE87_SEED), 128)
        self.assertTrue(mc._is_hex(mc.ISSUE87_SEED, 128))
        self.assertEqual(mc.derive_seed(mc.ISSUE87_SEED, "motion"),
                         mc.derive_seed(mc.ISSUE87_SEED, "motion"))
        self.assertNotEqual(mc.derive_seed(mc.ISSUE87_SEED, "motion"),
                            mc.derive_seed(mc.ISSUE87_SEED, "collision"))
        first = mc.select_takes(mc.ISSUE87_SEED, 3)
        self.assertEqual(first, mc.select_takes(mc.ISSUE87_SEED, 3))
        self.assertEqual(first, ["38_01", "26_01", "46_01"])
        self.assertNotEqual(first, mc.select_takes("0" * 128, 3))
        rows = {row["take"]: row for row in mc.load_mocap_sources()}
        for take in first:
            self.assertIn(take, rows)
            self.assertTrue(rows[take]["path"].is_file())
        with self.assertRaises(ValueError):
            mc.derive_seed("z" * 128, "motion")
        with self.assertRaises(ValueError):
            mc.derive_seed(mc.ISSUE87_SEED, "render")

    def test_rig_and_cloth_tables_come_from_the_pinned_sources(self):
        limits = mc.load_limits()
        self.assertEqual(limits["shin"]["flex"], [-135, 5])
        self.assertEqual(limits["forearm"]["flex"], [0, 150])
        self.assertEqual(limits["thigh"]["flex"], [-20, 120])
        self.assertEqual(limits["upperarm"]["flex"], [-60, 180])
        segments = mc.load_segments()
        self.assertEqual(len(segments), 14)
        self.assertAlmostEqual(sum(segment["mass"] for segment in segments), 1.0, places=9)
        self.assertEqual(segments[0]["name"], "head")
        self.assertEqual(segments[-1]["name"], "footR")
        cloth = mc.load_cloth_constants()
        self.assertAlmostEqual(cloth["contact8_floor_m"], 0.0015, places=9)
        self.assertAlmostEqual(cloth["settle9_gap_m"], 0.0025, places=9)
        self.assertAlmostEqual(cloth["settle9_layer_gap_m"], 0.0015, places=9)

    def test_take_floor_is_constant_and_no_double_support_fails_closed(self):
        raw = mc.audit({"style": "photorealistic", "takes": ["02_01"],
                        "footplant": False, "collision_guard": False,
                        "stance_m": 0.0, "footplant_cap_m": 0.0})
        clip = raw["clips"][0]
        self.assertEqual(clip["detail"]["floor"]["floor_m"], 0.0)
        self.assertEqual(clip["detail"]["floor"]["below_floor_mm"], 0.0)
        self.assertNotIn("ground_drift_mm", clip["metrics"])
        self.assertNotIn("ground_penetration_mm", clip["metrics"])
        self.assertEqual(clip["detail"]["feet"]["Left"]["planted_frames"], 5)
        self.assertEqual(clip["detail"]["feet"]["Right"]["planted_frames"], 4)
        no_support = mc.audit({"style": "photorealistic", "takes": ["20_06"]})
        no_support_clip = no_support["clips"][0]
        self.assertFalse(no_support["passed"])
        self.assertIsNone(no_support["metrics"]["com_support_margin_p05_mm"])
        self.assertFalse(no_support["checks"]["com_support_margin_p05_mm"])
        self.assertEqual(no_support_clip["detail"]["support_frames"], 0)

    def test_footplant_before_footplant_only_and_after_on_02_01(self):
        before = mc.audit({"style": "photorealistic", "takes": ["02_01"],
                           "footplant": False, "collision_guard": False,
                           "stance_m": 0.0, "footplant_cap_m": 0.0})
        before_clip = before["clips"][0]
        self.assertFalse(before["passed"])
        self.assertEqual(before_clip["metrics"]["body_self_clearance_mm"], -36.7013)
        self.assertEqual(before_clip["metrics"]["foot_slide_mm"], 23.3088)
        self.assertEqual(before_clip["metrics"]["cloth_contact_penetration_mm"], 38.2013)
        self.assertEqual(before_clip["metrics"]["cloth_layer_penetration_mm"], 39.7013)
        self.assertEqual(before_clip["metrics"]["com_support_margin_p05_mm"], -3.1837)
        self.assertEqual(before_clip["metrics"]["limb_flex_excess_deg"], 4.2057)
        self.assertEqual(before_clip["detail"]["contact_worst"],
                         {"frame": 10, "a": "thighL", "b": "thighR", "gap_mm": -36.7013})
        comparison = mc.footplant_comparison({"style": "photorealistic", "takes": ["02_01"]})
        self.assertEqual(comparison["before"]["metrics"], before["metrics"])
        footplant_clip = comparison["footplant_only"]["clips"][0]
        self.assertFalse(comparison["footplant_only"]["passed"])
        self.assertEqual(footplant_clip["metrics"]["foot_slide_mm"], 2.9292)
        self.assertEqual(footplant_clip["metrics"]["body_self_clearance_mm"], -36.7013)
        self.assertEqual(footplant_clip["metrics"]["cloth_contact_penetration_mm"], 38.2013)
        self.assertEqual(footplant_clip["metrics"]["cloth_layer_penetration_mm"], 39.7013)
        footplant = footplant_clip["detail"]["footplant"]
        self.assertTrue(footplant["enabled"])
        self.assertEqual(footplant["stance_mm"], 45.0)
        self.assertEqual(footplant["max_correction_cap_mm"], 40.0)
        self.assertEqual(footplant["stance_achieved_mean_mm"], 36.2229)
        self.assertEqual(footplant["stance_achieved_max_mm"], 40.0)
        self.assertGreater(footplant["capped_frames"], 0)
        self.assertGreater(footplant["corrected_frames"], 0)
        after = comparison["after"]
        self.assertTrue(after["passed"])
        after_clip = after["clips"][0]
        self.assertTrue(after_clip["checks_passed"])
        self.assertEqual(after_clip["metrics"]["body_self_clearance_mm"], 3.0723)
        self.assertEqual(after_clip["metrics"]["cloth_contact_penetration_mm"], 0.0)
        self.assertEqual(after_clip["metrics"]["cloth_layer_penetration_mm"], 0.0)
        self.assertEqual(after_clip["metrics"]["foot_slide_mm"], 2.9292)
        self.assertEqual(after_clip["metrics"]["com_support_margin_p05_mm"], -7.7265)
        self.assertEqual(after_clip["metrics"]["limb_flex_excess_deg"], 8.0324)
        guard = after_clip["detail"]["collision_guard"]
        self.assertTrue(guard["enabled"])
        self.assertTrue(guard["audit_only"])
        self.assertEqual(guard["guarded_frames"], 11)
        self.assertEqual(guard["max_shift_mm"], 37.7013)
        self.assertEqual(guard["max_delta_mm"], 19.2002)
        self.assertEqual(guard["max_ik_miss_mm"], 0.0)
        uncapped = mc.audit({"style": "photorealistic", "takes": ["12_01"],
                             "footplant": True, "collision_guard": True,
                             "stance_m": mc.DEFAULT_STANCE_M,
                             "footplant_cap_m": 0.15})
        uncapped_clip = uncapped["clips"][0]
        self.assertFalse(uncapped["passed"])
        self.assertEqual(uncapped_clip["detail"]["footplant"]["capped_frames"], 0)
        self.assertGreater(uncapped_clip["metrics"]["limb_flex_excess_deg"], 10.0)

    def test_clean_walk_passes_photoreal_and_records_exact_hashes(self):
        report = mc.audit({"style": "photorealistic", "takes": ["35_01"]})
        self.assertTrue(report["passed"])
        self.assertTrue(report["clips"][0]["checks_passed"])
        self.assertEqual(set(report["metrics"]), set(mc.MOTION_THRESHOLDS["photorealistic"]))
        self.assertEqual(len(report["manifest_sha256"]), 64)
        metrics = report["metrics"]
        self.assertEqual(metrics["foot_slide_mm"], 18.3741)
        self.assertEqual(metrics["body_self_clearance_mm"], 0.6503)
        self.assertEqual(metrics["cloth_contact_penetration_mm"], 0.8497)
        self.assertEqual(metrics["cloth_layer_penetration_mm"], 2.3497)
        self.assertEqual(metrics["limb_flex_excess_deg"], 4.004)
        self.assertEqual(metrics["com_support_margin_p05_mm"], -14.9354)
        self.assertEqual(metrics["rig_bone_length_drift_mm"], 0.0)
        self.assertIn("cloth_layer_penetration_mm", report["clips"][0]["checks"])
        coverage = report["clips"][0]["detail"]["joint_limit_coverage"]
        self.assertEqual(coverage["axes"], ["flex"])
        self.assertEqual(coverage["joints"], ["knee", "elbow", "hip", "shoulder"])
        pins = {pin["path"]: pin["sha256"] for pin in report["pins"]}
        self.assertIn("videos/sources/mocap/cmu/35_01.bvh", pins)
        self.assertIn("videos/web/lib/fx/rig/limits.js", pins)
        self.assertIn("videos/web/lib/fx/cloth/cloth8/contact8.js", pins)
        for digest in pins.values():
            self.assertEqual(len(digest), 64)
            self.assertTrue(mc._is_hex(digest, 64))
        self.assertEqual(pins["videos/sources/mocap/cmu/35_01.bvh"],
                         mc._sha256_file(mc.MOCAP_DIR / "cmu/35_01.bvh"))

    def test_core_walk_set_passes_both_styles_and_admission(self):
        takes = ["02_01", "35_01", "12_01"]
        photo = mc.audit({"style": "photorealistic", "takes": takes})
        stylized = mc.audit({"style": "stylized", "takes": takes})
        self.assertTrue(photo["passed"])
        self.assertTrue(stylized["passed"])
        for metric, (direction, limit) in mc.MOTION_THRESHOLDS["photorealistic"].items():
            other = mc.MOTION_THRESHOLDS["stylized"][metric][1]
            if direction == "max":
                self.assertGreaterEqual(other, limit)
            else:
                self.assertLessEqual(other, limit)
        admitted = mc.admit({"style": "photorealistic", "takes": takes})
        self.assertTrue(admitted["admitted"])
        self.assertEqual(admitted["manifest_sha256"], photo["manifest_sha256"])
        checked = mc.check({"style": "stylized", "takes": takes})
        self.assertTrue(checked["passed"])
        self.assertEqual(checked["failures"], {})

    def test_seed_selected_sample_flags_photoreal_and_stylized_accepts(self):
        takes = mc.select_takes(mc.ISSUE87_SEED, 3)
        self.assertEqual(takes, ["38_01", "26_01", "46_01"])
        photo = mc.audit({"style": "photorealistic", "takes": takes})
        stylized = mc.audit({"style": "stylized", "takes": takes})
        self.assertFalse(photo["passed"])
        self.assertFalse(photo["checks"]["com_support_margin_p05_mm"])
        self.assertFalse(photo["checks"]["body_self_clearance_mm"])
        self.assertFalse(photo["checks"]["cloth_layer_penetration_mm"])
        self.assertTrue(any(not clip["checks_passed"] for clip in photo["clips"]))
        self.assertTrue(stylized["passed"])
        checked = mc.check({"style": "photorealistic", "takes": takes})
        self.assertFalse(checked["passed"])
        self.assertIn("com_support_margin_p05_mm", checked["failures"])
        admitted = mc.admit({"style": "stylized", "takes": takes})
        self.assertTrue(admitted["admitted"])

    def test_reports_are_deterministic_and_manifest_binds_options(self):
        spec = {"style": "photorealistic", "takes": ["35_01"]}
        first = mc.audit(spec)
        second = mc.audit(dict(spec))
        self.assertEqual(first, second)
        other_seed = mc.audit(dict(spec, master_seed="1" * 128))
        self.assertEqual(first["metrics"], other_seed["metrics"])
        self.assertNotEqual(first["manifest_sha256"], other_seed["manifest_sha256"])
        other_style = mc.audit({"style": "stylized", "takes": ["35_01"]})
        self.assertNotEqual(first["manifest_sha256"], other_style["manifest_sha256"])
        raw = mc.audit(dict(spec, footplant=False))
        self.assertNotEqual(first["manifest_sha256"], raw["manifest_sha256"])
        self.assertNotEqual(first["metrics"], raw["metrics"])
        uncapped = mc.audit(dict(spec, footplant_cap_m=0.15))
        self.assertNotEqual(first["manifest_sha256"], uncapped["manifest_sha256"])
        self.assertEqual(other_style["source_commit"], mc.PINNED_SOURCE_COMMIT)
        self.assertTrue(first["footplant"])
        self.assertTrue(first["collision_guard"])
        self.assertEqual(first["stance_m"], mc.DEFAULT_STANCE_M)
        self.assertEqual(first["footplant_cap_m"], mc.MAX_FOOTPLANT_CORRECTION_M)

    def test_fail_closed_inputs(self):
        good = {"style": "photorealistic", "takes": ["35_01"]}
        bad = [
            dict(good, style="realistic"),
            dict(good, master_seed="f" * 127),
            dict(good, master_seed="F" * 128),
            dict(good, source_commit="e" * 39),
            dict(good, source_commit="E" * 40),
            dict(good, takes=[]),
            dict(good, takes=["does-not-exist"]),
            dict(good, capsule_radii_m={"thigh": 0}),
            dict(good, capsule_radii_m={"thigh": 0.6}),
            dict(good, stance_m=-0.01),
            dict(good, stance_m=0.2),
            dict(good, stance_m="wide"),
            dict(good, footplant_cap_m=-0.01),
            dict(good, footplant_cap_m=0.2),
            dict(good, collision_guard="yes"),
            dict(good, footplant="yes"),
            dict(good, assets=[{"path": "videos/sources/mocap/SOURCES.csv",
                                "sha256": "0" * 64, "source_commit": "e" * 40}]),
        ]
        for value in bad:
            with self.subTest(value=value), self.assertRaises(ValueError):
                mc.audit(value)
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "pin.txt"
            path.write_text("not the pinned bytes")
            with self.assertRaises(ValueError):
                mc.audit(dict(good, assets=[{
                    "path": str(path),
                    "sha256": mc._sha256_file(mc.MOCAP_SOURCES),
                    "source_commit": mc.PINNED_SOURCE_COMMIT,
                }]))
        with self.assertRaises(ValueError):
            mc.footplant_comparison({"style": "photorealistic", "takes": ["35_01", "12_01"]})

    def test_geometry_helpers(self):
        a, b = mc.V(0, 0, 0), mc.V(1, 0, 0)
        c, d = mc.V(0, 1, 0), mc.V(1, 1, 0)
        self.assertAlmostEqual(mc._segment_distance(a, b, c, d), 1.0, places=9)
        square = [(0, 0), (1, 0), (1, 1), (0, 1)]
        self.assertEqual(mc._convex_hull(square), square)
        self.assertLess(mc._inside_distance(square, 0.5, 0.5), 0)
        self.assertGreater(mc._inside_distance(square, 2.0, 0.5), 0)
        lateral = mc.V(1, 0, 0)
        flexed = mc._signed_angle(mc.V(0, -1, 0), mc.V(0, -1, -0.2), lateral)
        extended = mc._signed_angle(mc.V(0, -1, 0), mc.V(0, -1, 0.2), lateral)
        self.assertGreater(flexed, 0)
        self.assertLess(extended, 0)
        self.assertAlmostEqual(mc._unsigned_angle(mc.V(1, 0, 0), mc.V(0, 1, 0)), 90.0, places=9)

    def test_cli_writes_both_styles_and_comparison(self):
        with tempfile.TemporaryDirectory() as temporary:
            report_path = Path(temporary) / "report.json"
            stdout = io.StringIO()
            with contextlib.redirect_stdout(stdout):
                code = mc.main(["--style", "both", "--takes", "35_01",
                                "--footplant-take", "02_01",
                                "--report", str(report_path)])
            self.assertEqual(code, 0)
            payload = json.loads(report_path.read_text())
            self.assertEqual(payload["version"], mc.VERSION)
            self.assertEqual(payload["source_commit"], mc.PINNED_SOURCE_COMMIT)
            self.assertEqual(payload["seed_selected_takes"], ["38_01", "26_01", "46_01"])
            self.assertEqual(set(payload["reports"]), set(mc.STYLES))
            self.assertTrue(payload["reports"]["photorealistic"]["passed"])
            self.assertTrue(payload["reports"]["stylized"]["passed"])
            self.assertEqual(payload["reports"]["photorealistic"]["manifest_sha256"],
                             mc.audit({"style": "photorealistic", "takes": ["35_01"]})["manifest_sha256"])
            comparison = payload["footplant_comparison"]
            self.assertEqual(comparison["take"], "02_01")
            self.assertFalse(comparison["before"]["passed"])
            self.assertFalse(comparison["footplant_only"]["passed"])
            self.assertTrue(comparison["after"]["passed"])
            summary = json.loads(stdout.getvalue())
            self.assertEqual(set(summary["reports"]), set(mc.STYLES))

    def test_committed_report_is_reproducible_from_pinned_sources(self):
        path = mc.REPO_ROOT / "homelab/MOTION_COLLISION_ISSUE87.json"
        report = json.loads(path.read_text())
        self.assertEqual(report["source_commit"], mc.PINNED_SOURCE_COMMIT)
        core_takes = ["02_01", "35_01", "12_01"]
        self.assertEqual(report["seed_selected_takes"], ["38_01", "26_01", "46_01"])
        for style in mc.STYLES:
            self.assertEqual(
                report["reports"][style]["manifest_sha256"],
                mc.audit({"style": style, "takes": core_takes})["manifest_sha256"])
            self.assertEqual(
                report["seed_sample"]["reports"][style]["manifest_sha256"],
                mc.audit({"style": style, "takes": report["seed_sample"]["takes"]})["manifest_sha256"])
        comparison = mc.footplant_comparison({"style": "photorealistic", "takes": ["02_01"]})
        self.assertEqual(report["footplant_comparison"]["before"]["manifest_sha256"],
                         comparison["before"]["manifest_sha256"])
        self.assertEqual(report["footplant_comparison"]["footplant_only"]["manifest_sha256"],
                         comparison["footplant_only"]["manifest_sha256"])
        self.assertEqual(report["footplant_comparison"]["after"]["manifest_sha256"],
                         comparison["after"]["manifest_sha256"])


if __name__ == "__main__":
    unittest.main()
