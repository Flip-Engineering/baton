import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import hair_engine_context as h  # noqa: E402

FIXTURE = """export async function build() {
  const hair = { melanin: { eu: 1.2, ph: 0.04 }, grey: 0.1 };
  let groom = null;
  if (yes) { try { const ho = {}; groom = groomHero(h, ho); } catch (err) { fail(err); } tm('hair', t); }
""" + h.ANCHOR + """
  return groom;
}
"""


class Patch(unittest.TestCase):
    def test_anchor_is_unique_and_patch_is_idempotent(self):
        self.assertTrue(h.eligible(FIXTURE))
        patched = h.prepare_build_source(FIXTURE)
        self.assertEqual(patched.count(h.MARKER), 1)
        self.assertIn("applyFibreEngine", patched)
        self.assertIn("castFromName(e.name)", patched)
        self.assertIn("melanin: hair.melanin", patched)
        self.assertIn("grey: hair.grey", patched)
        self.assertIn("opts.hairmatEngine !== false", patched)
        self.assertIn("!opts.cycles", patched)
        self.assertEqual(h.prepare_build_source(patched), patched)
        self.assertEqual(h.source_sha256(patched), h.source_sha256(h.prepare_build_source(FIXTURE)))

    def test_missing_or_duplicate_anchor_fails_closed(self):
        with self.assertRaises(ValueError):
            h.prepare_build_source(FIXTURE.replace(h.ANCHOR, "// moved"))
        with self.assertRaises(ValueError):
            h.prepare_build_source(FIXTURE + h.ANCHOR)
        with self.assertRaises(ValueError):
            h.prepare_build_source(None)
        self.assertFalse(h.eligible(""))

    def test_pinned_build_has_the_anchor(self):
        root = Path(__file__).resolve().parents[3]
        result = subprocess.run(
            ["git", "-C", str(root), "show", "e235ca432f1514842da8e99ec28addf77c99b2d4:videos/web/lib/fx/person/build.js"],
            capture_output=True,
            check=False,
        )
        if result.returncode != 0:
            self.skipTest("pinned build blob not available")
        source = result.stdout.decode()
        self.assertTrue(h.eligible(source), "the pinned build anchor changed")
        patched = h.prepare_build_source(source)
        self.assertEqual(patched.count(h.MARKER), 1)
        self.assertNotEqual(h.source_sha256(patched), h.source_sha256(source))


class Workspace(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.web = self.root / "web"
        (self.web / "lib/fx/person").mkdir(parents=True)
        (self.web / "lib/fx/person/build.js").write_text(FIXTURE)
        (self.web / "lib/fx/other.js").write_text("export const x = 1;\n")
        (self.web / "node_modules").mkdir()
        (self.web / "package.json").write_text("{}\n")

    def test_prepare_workspace_copies_patches_and_links(self):
        report = h.prepare_workspace(self.web, self.root / "prepared")
        prepared = Path(report["root"])
        self.assertTrue((prepared / "lib/fx/other.js").is_file())
        self.assertTrue((prepared / "node_modules").is_symlink())
        self.assertTrue((prepared / "package.json").is_file())
        patched = (prepared / h.BUILD_PATH).read_text()
        self.assertIn(h.MARKER, patched)
        self.assertEqual(report["build_sha256"], h.source_sha256(patched))
        self.assertEqual(report["version"], h.VERSION)

    def test_non_empty_destination_and_missing_lib_fail(self):
        prepared = self.root / "prepared"
        prepared.mkdir()
        (prepared / "keep").write_text("x")
        with self.assertRaises(ValueError):
            h.prepare_workspace(self.web, prepared)
        empty = self.root / "web2"
        empty.mkdir()
        with self.assertRaises(ValueError):
            h.prepare_workspace(empty, self.root / "prepared2")


class PersonGuard(unittest.TestCase):
    def test_required_child_failure_guard_is_present_and_qualified(self):
        import hashlib
        import common_person

        path = Path(common_person.__file__).with_name("person_child_failures.py")
        self.assertTrue(path.is_file(), "common_person.py needs person_child_failures.py beside it")
        self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), common_person.CHILD_GUARD_SHA256)


if __name__ == "__main__":
    unittest.main()
