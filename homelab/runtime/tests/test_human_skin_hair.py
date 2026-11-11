import json
import math
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import human_skin_hair as h  # noqa: E402
import skin_hair_compare as compare_cli  # noqa: E402


class Seeds(unittest.TestCase):
    def test_seed_contract_and_subsystem_offsets(self):
        self.assertEqual(len(h.ISSUE87_SEED), 128)
        self.assertEqual(len(h.ASSIGNMENT_SEED), 128)
        self.assertTrue(h._is_hex(h.ISSUE87_SEED, 128))
        self.assertTrue(h._is_hex(h.ASSIGNMENT_SEED, 128))
        self.assertNotEqual(h.derive_seed(h.ISSUE87_SEED, "skin"), h.derive_seed(h.ISSUE87_SEED, "hair"))
        for bad in ("", "zz", h.ISSUE87_SEED[:-1], h.ISSUE87_SEED.upper()):
            with self.assertRaises(ValueError):
                h.derive_seed(bad, "skin")
        with self.assertRaises(ValueError):
            h.derive_seed(h.ISSUE87_SEED, "cloth")

    def test_same_spec_is_byte_identical(self):
        a = h.evaluate({"style": "photorealistic"})
        b = h.evaluate({"style": "photorealistic"})
        self.assertEqual(a, b)
        self.assertEqual(a["manifest_sha256"], b["manifest_sha256"])

    def test_seed_and_style_change_the_manifest(self):
        base = h.evaluate({"style": "photorealistic"})
        self.assertNotEqual(base["manifest_sha256"], h.evaluate({"style": "photorealistic", "master_seed": h.ASSIGNMENT_SEED})["manifest_sha256"])
        self.assertNotEqual(base["manifest_sha256"], h.evaluate({"style": "stylized"})["manifest_sha256"])
        self.assertNotEqual(base["manifest_sha256"], h.evaluate({"style": "photorealistic", "groom": False})["manifest_sha256"])
        self.assertNotEqual(base["manifest_sha256"], h.evaluate({"style": "photorealistic", "baseline": True})["manifest_sha256"])

    def test_bad_specs_fail_closed(self):
        with self.assertRaises(ValueError):
            h.evaluate({"style": "realistic"})
        with self.assertRaises(ValueError):
            h.evaluate({"style": "stylized", "master_seed": "zz"})
        with self.assertRaises(ValueError):
            h.evaluate({"style": "stylized", "groom": "yes"})
        with self.assertRaises(ValueError):
            h.evaluate({"style": "stylized", "cast": []})
        with self.assertRaises(ValueError):
            h.evaluate({"style": "stylized", "cast": [{"name": "x", "age": 12, "group": "white"}]})
        with self.assertRaises(ValueError):
            h.evaluate({"style": "stylized", "source_commit": "abc"})


class Skin(unittest.TestCase):
    def test_measured_register_matches_the_pinned_source(self):
        material = h.skin_material("photorealistic", baseline=False)
        self.assertEqual(material["specular_error"], 0.0)
        self.assertEqual(material["transport_error_mm"], 0.0)
        self.assertEqual(material["face_blood"], 2.0)
        for name, (m, rho_s) in h.WEYRICH06["ts"].items():
            region = material["regions"][name]
            self.assertAlmostEqual(region["alpha_ggx"], math.sqrt(2.0) * m, places=6)
            self.assertEqual(region["source"], "measured")
        self.assertAlmostEqual(material["transport"]["cheek"]["ld_mm"][0], 1 / 0.5572, places=6)
        self.assertAlmostEqual(material["transport"]["neck"]["ld_mm"][2], 1 / 1.9159, places=6)

    def test_stylized_register_is_a_deliberate_simplification(self):
        photo = h.skin_material("photorealistic")
        stylized = h.skin_material("stylized")
        baseline = h.skin_material("photorealistic", baseline=True)
        self.assertEqual(photo["specular_error"], 0.0)
        self.assertGreater(stylized["specular_error"], 0.0)
        self.assertLess(stylized["specular_error"], baseline["specular_error"])
        self.assertEqual(baseline["register"], "baseline")
        self.assertGreater(stylized["specular_contrast"], 1.0)
        self.assertLess(stylized["specular_contrast"], photo["specular_contrast"])
        self.assertEqual(stylized["transport_error_mm"], 0.0)
        self.assertGreater(baseline["transport_error_mm"], stylized["transport_error_mm"])

    def test_collagen_recruitment_lowers_stretch_and_passes(self):
        for style, limit in (("photorealistic", 1.06), ("stylized", 1.12)):
            baseline = h.evaluate({"style": style, "baseline": True})
            candidate = h.evaluate({"style": style, "baseline": False})
            self.assertGreater(baseline["skin_stretch"], limit)
            self.assertLess(candidate["skin_stretch"], limit)
            self.assertLess(candidate["skin_stretch"], baseline["skin_stretch"])
            self.assertLess(candidate["skin_transport_error_mm"], baseline["skin_transport_error_mm"])
            self.assertLessEqual(candidate["skin_specular_error"], baseline["skin_specular_error"])

    def test_age_reduces_collagen_and_never_breaks_the_limit(self):
        young = [{"name": "young", "age": 24, "group": "white"}]
        old = [{"name": "old", "age": 90, "group": "white"}]
        y = h.skin_response("photorealistic", h.ISSUE87_SEED, young, baseline=False)
        o = h.skin_response("photorealistic", h.ISSUE87_SEED, old, baseline=False)
        self.assertGreater(o["worst"]["p95"], y["worst"]["p95"])
        self.assertLess(o["worst"]["p95"], 1.06)
        self.assertLess(o["worst"]["age_factor"], y["worst"]["age_factor"])

    def test_skin_stretch_is_the_worst_site(self):
        candidate = h.evaluate({"style": "photorealistic", "baseline": False})
        sites = [site["p95"] for person in candidate["skin"]["per_cast"] for site in person["sites"]]
        self.assertAlmostEqual(candidate["skin_stretch"], max(sites), places=6)


class Hair(unittest.TestCase):
    def test_per_person_geometry_matches_fibre_constants(self):
        material = h.hair_material("photorealistic")
        for row in material["per_cast"]:
            expected = h.HAIR_ANCESTRY[row["ancestry"]]
            self.assertEqual(row["d_um"], expected["d_um"])
            self.assertEqual(row["ellipticity"], expected["ell"])
            self.assertEqual(row["density_cm2"], expected["density_cm2"])
        self.assertEqual(len(material["per_cast"]), 12)
        self.assertEqual(material["section"], "elliptical-major")

    def test_elliptical_section_reduces_deviation_and_passes(self):
        for style, limit in (("photorealistic", 3.0), ("stylized", 6.0)):
            baseline = h.evaluate({"style": style, "baseline": True})
            candidate = h.evaluate({"style": style, "baseline": False})
            off = h.evaluate({"style": style, "baseline": False, "groom": False})
            self.assertEqual(
                baseline["hair"]["material"]["groom_hold"], h.HAIR_REGISTERS[style]["groom_hold"]
            )
            self.assertLess(candidate["hair_deviation_mm"], limit)
            self.assertLess(candidate["hair_deviation_mm"], baseline["hair_deviation_mm"])
            self.assertGreater(off["hair_deviation_mm"], candidate["hair_deviation_mm"])
            if style == "photorealistic":
                self.assertGreater(off["hair_deviation_mm"], limit)
            for base_row, cand_row in zip(baseline["hair"]["per_cast"], candidate["hair"]["per_cast"]):
                self.assertEqual(base_row["name"], cand_row["name"])
                self.assertLessEqual(cand_row["mean_mm"], base_row["mean_mm"])

    def test_groom_hold_matters_and_is_reported(self):
        on = h.evaluate({"style": "photorealistic", "baseline": False, "groom": True})
        off = h.evaluate({"style": "photorealistic", "baseline": False, "groom": False})
        self.assertGreater(off["hair_deviation_mm"], on["hair_deviation_mm"])
        self.assertEqual(on["hair"]["material"]["groom_hold"], 0.25)
        self.assertEqual(off["hair"]["material"]["groom_hold"], 0.0)
        self.assertEqual(h.HAIR_REGISTERS["stylized"]["groom_hold"], 0.15)

    def test_ancestry_geometry_orders_the_stiffness(self):
        rows = h.hair_response("photorealistic", h.ISSUE87_SEED, baseline=False)["per_cast"]
        by_name = {row["name"]: row for row in rows}
        # 88 um, low ellipticity (East Asian) is the stiffest; 70 um (European)
        # is the softest even after the ellipticity gain.
        self.assertLess(by_name["L20_f29_asian"]["mean_mm"], by_name["L06_f53_white"]["mean_mm"])

    def test_shading_register_energy_and_translucency(self):
        photo = h.hair_shading("photorealistic")
        stylized = h.hair_shading("stylized")
        self.assertGreater(photo["cast_mean"]["backlit_share"], stylized["cast_mean"]["backlit_share"])
        self.assertEqual(stylized["card_mix"], 0.35)
        for style in (photo, stylized):
            for row in style["per_cast"]:
                self.assertLessEqual(row["energy_max"], 1.0)
                self.assertGreaterEqual(row["backlit_share"], 0.0)
                self.assertGreater(row["white_backlit_share"], row["backlit_share"])
                self.assertGreaterEqual(row["mass_albedo_white"][0], row["mass_albedo"][0])
        # A grey fibre is brighter than the pigmented fibre at every channel.
        for c in range(3):
            self.assertGreater(photo["per_cast"][0]["mass_albedo_white"][c], photo["per_cast"][0]["mass_albedo"][c])
        self.assertGreater(photo["cast_mean"]["mass_albedo"][0], photo["cast_mean"]["mass_albedo"][2])

    def test_grey_fraction_rises_with_age(self):
        self.assertLess(h._grey_fraction(24, "european"), h._grey_fraction(59, "european"))
        self.assertEqual(h._grey_fraction(20, "african"), 0.0)
        self.assertLessEqual(h._grey_fraction(120, "european"), 0.60)


class CompareAndGates(unittest.TestCase):
    def test_compare_contract_and_style_guard(self):
        base = h.evaluate({"style": "photorealistic", "baseline": True})
        cand = h.evaluate({"style": "photorealistic", "baseline": False})
        report = h.compare(base, cand)
        self.assertTrue(report["passed"])
        self.assertEqual(report["style"], "photorealistic")
        self.assertEqual(set(report["metrics"]), {"skin_stretch", "hair_deviation_mm"})
        self.assertLess(report["deltas"]["skin_stretch"], 0.0)
        self.assertLess(report["deltas"]["hair_deviation_mm"], 0.0)
        with self.assertRaises(ValueError):
            h.compare(base, h.evaluate({"style": "stylized", "baseline": False}))
        with self.assertRaises(ValueError):
            h.compare({}, {})
        with self.assertRaises(ValueError):
            h.compare({"style": "photorealistic"}, {"style": "photorealistic"})

    def test_compare_handles_min_direction(self):
        base = {"style": "photorealistic", "volume_preservation": 0.99}
        cand = {"style": "photorealistic", "volume_preservation": 0.96}
        report = h.compare(base, cand)
        self.assertFalse(report["checks"]["volume_preservation"])
        self.assertFalse(report["passed"])

    def test_no_render_gate(self):
        self.assertFalse(h.RENDER_LAUNCHED)
        self.assertFalse(h.check_no_render({"render": False})["render_launched"])
        for bad in ({"render": True}, {"gpu_slots": 1}, {"memory_bytes": 8 * 2**30}, {"job_id": "x"}):
            with self.assertRaises(ValueError):
                h.check_no_render(bad)

    def test_material_registers_are_complete(self):
        registers = h.material_registers("photorealistic")
        self.assertEqual(registers["version"], h.VERSION)
        self.assertEqual(len(registers["skin"]["regions"]), len(h.WEYRICH06["ts"]))
        self.assertEqual(len(registers["hair"]["per_cast"]), 12)
        self.assertEqual(registers["baseline"]["skin"]["register"], "baseline")
        self.assertEqual(registers["baseline"]["hair"]["register"], "baseline")
        json.dumps(registers)  # must be serialisable for the comparison record


class Pins(unittest.TestCase):
    def test_all_pinned_sources_verify(self):
        try:
            pins = h.pins()
        except ValueError as error:
            if "pinned source not readable" in str(error):
                self.skipTest(str(error))
            raise
        self.assertEqual(len(pins), len(h.SOURCE_PINS))
        for pin in pins:
            self.assertEqual(len(pin["sha256"]), 64)
            self.assertEqual(pin["source_commit"], h.SOURCE_COMMIT)
        self.assertEqual(h.validate_pins(pins), pins)

    def test_pin_validation_fails_closed(self):
        good = [{"path": "x", "sha256": "a" * 64, "source_commit": "b" * 40}]
        self.assertEqual(h.validate_pins(good), good)
        with self.assertRaises(ValueError):
            h.validate_pins([])
        with self.assertRaises(ValueError):
            h.validate_pins([good[0], good[0]])
        with self.assertRaises(ValueError):
            h.validate_pins([{"path": "x", "sha256": "bad", "source_commit": "b" * 40}])
        with self.assertRaises(ValueError):
            h.validate_pins([{"path": "x", "sha256": "a" * 64, "source_commit": "bad"}])

    def test_wrong_commit_or_hash_fails(self):
        with self.assertRaises(ValueError):
            h.pins(commit="0" * 40)
        with self.assertRaises(ValueError):
            h.pins(commit="abc")

    def test_a_tampered_expected_hash_is_detected(self):
        original = h.SOURCE_PINS
        try:
            h.SOURCE_PINS = ((original[0][0], "0" * 64),) + original[1:]
            with self.assertRaises(ValueError):
                h.pins()
        finally:
            h.SOURCE_PINS = original


class CliRecord(unittest.TestCase):
    def test_record_is_deterministic_and_pins_are_present(self):
        args = SimpleNamespace(repo=None, commit=h.SOURCE_COMMIT, seed=h.ISSUE87_SEED, style=None)
        try:
            first, _ = compare_cli.build_record(args)
            second, _ = compare_cli.build_record(args)
        except ValueError as error:
            if "pinned source not readable" in str(error):
                self.skipTest(str(error))
            raise
        self.assertEqual(first, second)
        self.assertFalse(first["render_launched"])
        self.assertEqual(first["source_commit"], h.SOURCE_COMMIT)
        self.assertEqual(len(first["pins"]), len(h.SOURCE_PINS))
        self.assertEqual(set(first["styles"]), set(h.STYLES))
        for style, rows in first["styles"].items():
            self.assertTrue(rows["comparison"]["passed"], style)
        unsigned = {key: value for key, value in first.items() if key != "record_sha256"}
        self.assertEqual(first["record_sha256"], h.digest(unsigned))


if __name__ == "__main__":
    unittest.main()
