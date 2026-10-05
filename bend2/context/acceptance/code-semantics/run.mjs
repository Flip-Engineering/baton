#!/usr/bin/env node
/**
 * Oracle runner for the independent code-semantics acceptance corpus.
 *
 * Usage:
 *   node run.mjs ts [--typescript <path>] [--evidence-dir <dir>] [--suite <name>]
 *   node run.mjs c   [--clangd <path>] [--clang <path>] [--evidence-dir <dir>] [--suite <name>]
 *
 * Exit code 0 when every selected oracle case holds; 1 otherwise. Raw provider
 * outputs are written into the evidence dir when one is supplied; nothing is
 * written into the fixture tree.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      if (key === "suite") {
        args.suite = argv[(i += 1)];
      } else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          args[key] = argv[(i += 1)];
        } else {
          args[key] = true;
        }
      }
    } else {
      args._.push(token);
    }
  }
  return args;
}

async function runTs(args) {
  const { createTsProbe } = await import("./ts/probe-ts.mjs");
  const probe = await createTsProbe({
    typescriptPath: args.typescript,
    fixtureRoot: path.join(here, "ts", "fixtures"),
  });
  const oracleModules = [
    "./ts/oracles/symbols.oracle.mjs",
    "./ts/oracles/diagnostics.oracle.mjs",
    "./ts/oracles/flow.oracle.mjs",
    "./ts/oracles/exceptions.oracle.mjs",
    "./ts/oracles/sql-join.oracle.mjs",
    "./ts/oracles/invalidation.oracle.mjs",
  ];
  return runOracles(oracleModules, probe, args);
}

async function runC(args) {
  const { createCProbe } = await import("./c/probe-c.mjs");
  const probe = await createCProbe({
    clangdPath: args.clangd,
    clangPath: args.clang,
    fixtureRoot: path.join(here, "c", "fixtures"),
  });
  const oracleModules = [
    "./c/oracles/signature.oracle.mjs",
    "./c/oracles/calls.oracle.mjs",
    "./c/oracles/guard.oracle.mjs",
    "./c/oracles/cfg.oracle.mjs",
  ];
  return runOracles(oracleModules, probe, args);
}

async function runOracles(oracleModules, probe, args) {
  const evidenceDir = args["evidence-dir"] ? path.resolve(args["evidence-dir"]) : null;
  if (evidenceDir !== null) {
    fs.mkdirSync(evidenceDir, { recursive: true });
  }
  const suites = [];
  let totalChecks = 0;
  let totalFailures = 0;
  for (const moduleName of oracleModules) {
    const module = await import(moduleName);
    if (args.suite !== undefined && module.suite !== args.suite) {
      continue;
    }
    const suiteResult = { suite: module.suite, cases: [] };
    for (const oracleCase of module.cases) {
      const checker = new (await import("./lib/util.mjs")).Checker(oracleCase.id);
      let ok = true;
      let output = null;
      let thrown = null;
      try {
        output = await oracleCase.run(probe, checker);
      } catch (error) {
        ok = false;
        thrown = String(error && error.stack ? error.stack : error);
      }
      if (checker.ok && thrown === null) {
        ok = true;
      } else {
        ok = false;
      }
      totalChecks += checker.checks;
      totalFailures += checker.failures.length + (thrown !== null ? 1 : 0);
      const caseResult = {
        id: oracleCase.id,
        classification: oracleCase.classification,
        ok,
        checks: checker.checks,
        failures: checker.failures,
      };
      if (thrown !== null) {
        caseResult.thrown = thrown;
      }
      suiteResult.cases.push(caseResult);
      if (evidenceDir !== null) {
        const safeName = `${module.suite}--${oracleCase.id}.json`;
        fs.writeFileSync(
          path.join(evidenceDir, safeName),
          JSON.stringify({ case: oracleCase.id, output, failures: checker.failures }, null, 2),
        );
      }
    }
    suites.push(suiteResult);
  }
  if (suites.length === 0 || totalChecks === 0) {
    throw new Error("the selection produced no oracle checks");
  }
  const report = {
    runtime: { node: process.version },
    provider: probe.providerIdentity ?? null,
    suites,
    summary: { checks: totalChecks, failures: totalFailures, ok: totalFailures === 0 },
  };
  return report;
}

const args = parseArgs(process.argv.slice(2));
const target = args._[0];
if (target !== "ts" && target !== "c") {
  console.error("usage: node run.mjs ts|c [options]");
  process.exit(2);
}
const report = target === "ts" ? await runTs(args) : await runC(args);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exit(report.summary.ok ? 0 : 1);
