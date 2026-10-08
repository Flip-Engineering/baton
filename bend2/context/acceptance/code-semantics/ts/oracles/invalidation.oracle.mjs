/**
 * Invalidation oracles. Snapshot identity covers imported-file bytes, failed
 * resolution lookups and directory membership; an edit to an imported module,
 * an appearing module, or a config exclusion change must change the snapshot
 * identity and the reported facts. The old snapshot's retained result stays a
 * fact about its own snapshot.
 */
import { Checker, sha256 } from "../../lib/util.mjs";

export const suite = "ts-invalidation";

function overlayWithLib(probe, libContent) {
  const overlay = probe.initialOverlay();
  // app.ts is outside the tsconfig include set, so it joins the program as
  // an overlay root beside the lib variant under test.
  overlay.set("invalidation/lib.ts", libContent);
  overlay.set("invalidation/app.ts", probe.readFixtureText("invalidation/app.ts"));
  return overlay;
}

export const cases = [
  {
    id: "imported-module-edit-changes-snapshot-and-type",
    spec: "Input identity: a changed imported module changes the snapshot identity and the reported type; single-file hashing cannot establish this",
    classification: "checked",
    async run(probe, checker) {
      const overlayA = overlayWithLib(probe, probe.readFixtureText("invalidation/lib-a.ts"));
      const overlayB = overlayWithLib(probe, probe.readFixtureText("invalidation/lib-b.ts"));

      const identityA = probe.extractors.captureIdentity({ probeImports: [] }, overlayA);
      const identityB = probe.extractors.captureIdentity({ probeImports: [] }, overlayB);
      checker.checkTruthy(
        "snapshot identity differs across imported-file edit",
        identityA.snapshotId !== identityB.snapshotId,
        { a: identityA.snapshotId, b: identityB.snapshotId },
      );
      checker.check(
        "lib-a digest participates in snapshot A",
        identityA.identityFiles["invalidation/lib.ts"],
        sha256(Buffer.from(probe.readFixtureText("invalidation/lib-a.ts"), "utf8")),
      );

      const typeA = probe.extractors.flowType(
        { file: "invalidation/app.ts", locate: "level" },
        overlayA,
      );
      const typeB = probe.extractors.flowType(
        { file: "invalidation/app.ts", locate: "level" },
        overlayB,
      );
      checker.check("snapshot A type at use", typeA.narrowedType, "string");
      checker.check("snapshot B type at same position", typeB.narrowedType, "number");
      return { a: identityA.snapshotId, b: identityB.snapshotId, typeA: typeA.narrowedType, typeB: typeB.narrowedType };
    },
  },
  {
    id: "added-module-changes-resolution",
    spec: "Input identity: an added formerly absent module changes resolution and must invalidate the result",
    classification: "checked",
    async run(probe, checker) {
      const overlayA = probe.initialOverlay();
      const identityA = probe.extractors.captureIdentity(
        { probeImports: ["src/unresolved-import.ts"] },
        overlayA,
      );
      checker.check(
        "snapshot A records the failed lookup",
        identityA.unresolvedImports,
        [{ importingFile: "src/unresolved-import.ts", specifier: "./late-module" }],
      );

      const overlayB = probe.initialOverlay();
      overlayB.set(
        "src/late-module.ts",
        "export const missingValue = \"now-present\";\n",
      );
      const identityB = probe.extractors.captureIdentity(
        { probeImports: ["src/unresolved-import.ts"] },
        overlayB,
      );
      checker.check("added module clears the unresolved set", identityB.unresolvedImports, []);
      checker.checkTruthy(
        "snapshot identity changes when module appears",
        identityA.snapshotId !== identityB.snapshotId,
        { a: identityA.snapshotId, b: identityB.snapshotId },
      );

      const useB = probe.extractors.symbolAt(
        { file: "src/unresolved-import.ts", locate: "return missingValue" },
        overlayB,
      );
      checker.check("use site resolves after module appears", useB.canonical?.name, "missingValue");
      checker.check(
        "resolved declaration is the added module",
        useB.canonical?.declarations?.map((d) => d.file),
        ["src/late-module.ts"],
      );
      return identityB;
    },
  },
  {
    id: "config-exclusion-honored",
    spec: "Effective TS configuration: excluded directory files are not program roots; config selection is honored through captured enumeration",
    classification: "checked",
    async run(probe, checker) {
      const result = probe.extractors.programFiles({});
      checker.checkAbsent(
        "excluded/excluded-helper.ts is not a root file",
        result.rootFiles ?? [],
        (name) => name.includes("excluded"),
        result.rootFiles,
      );
      checker.checkContains(
        "included consumer file is a root",
        result.rootFiles ?? [],
        (name) => name === "src/consumer.ts",
        result.rootFiles,
      );
      return { roots: result.rootFiles };
    },
  },
];
