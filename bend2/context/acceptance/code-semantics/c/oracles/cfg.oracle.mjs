/**
 * CFG-mapping oracles. Graph IDs are local to an extraction, so every assertion
 * is a structural relation over parsed blocks — entry/exit roles, decision
 * operands, successor sets, denial-return placement, accepted reachability and
 * the cut property — never a block number. Structural facts were cross-checked
 * against actual clang 20.1.8 debug.DumpCFG output recorded in this session's
 * private evidence before the remote-only execution boundary.
 */
import { Checker } from "../../lib/util.mjs";

function blockWithText(blocks, needle) {
  return (blocks ?? []).find(
    (block) => block.statements.some((statement) => statement.includes(needle)),
  );
}

function decisionBlocks(blocks) {
  return (blocks ?? []).filter((block) => block.terminator !== null);
}

function reachableFrom(blocks, startId, blockedEdges) {
  const seen = new Set();
  const stack = [startId];
  while (stack.length > 0) {
    const current = stack.pop();
    if (seen.has(current)) {
      continue;
    }
    seen.add(current);
    const block = (blocks ?? []).find((candidate) => candidate.id === current);
    if (block === undefined) {
      continue;
    }
    for (const successor of block.succs) {
      if (blockedEdges !== undefined && blockedEdges.has(`${current}->${successor}`)) {
        continue;
      }
      stack.push(successor);
    }
  }
  return seen;
}

function hasCycle(blocks) {
  const ids = new Set((blocks ?? []).map((block) => block.id));
  const state = new Map();
  const visit = (id) => {
    if (state.get(id) === 1) {
      return true;
    }
    if (state.get(id) === 2) {
      return false;
    }
    state.set(id, 1);
    const block = (blocks ?? []).find((candidate) => candidate.id === id);
    for (const successor of block?.succs ?? []) {
      if (ids.has(successor) && visit(successor)) {
        return true;
      }
    }
    state.set(id, 2);
    return false;
  };
  for (const id of ids) {
    if (visit(id)) {
      return true;
    }
  }
  return false;
}

export const suite = "c-cfg";

export const cases = [
  {
    id: "conjunction-decision-chain-and-denial-return-placement",
    spec: "The conjunction maps to two decision blocks evaluating one leaf each; the denial-return block is the true-successor of the last decision; the accepted side reaches the effect call only through accepted edges",
    classification: "static-possible",
    async run(probe, checker) {
      const result = probe.extractors.cfg({ file: "src/handler-guard.c", functionName: "view_summary" });
      checker.checkTruthy("CFG extracted", (result.blocks ?? []).length > 0, result.raw?.slice(0, 400));
      const blocks = result.blocks;
      const entry = blocks.find((block) => block.role === "ENTRY");
      const exit = blocks.find((block) => block.role === "EXIT");
      checker.checkTruthy("entry block present", entry !== undefined, blocks.map((b) => b.id));
      checker.checkTruthy("exit block present", exit !== undefined, blocks.map((b) => b.id));

      const decisions = decisionBlocks(blocks);
      checker.check("two decision blocks for the conjunction", decisions.length, 2);
      const firstLeaf = decisions.find((block) => block.statements.some((s) => s.includes("ok_read")));
      const secondLeaf = decisions.find((block) => block.statements.some((s) => s.includes("ok_edit")));
      checker.checkTruthy("first leaf evaluates ok_read", firstLeaf !== undefined, decisions);
      checker.checkTruthy("second leaf evaluates ok_edit", secondLeaf !== undefined, decisions);
      checker.check(
        "terminators carry the logical && shape",
        decisions.every((block) => (block.terminator ?? "").includes("&&")),
        true,
      );

      const denial = blockWithText(blocks, "return;");
      checker.checkTruthy("denial return block present", denial !== undefined, blocks);
      checker.check(
        "denial return is a successor of the last-evaluated leaf block",
        secondLeaf?.succs.includes(denial.id),
        true,
      );
      checker.check(
        "denial return flows to exit",
        denial?.succs.length === 1 && denial.succs[0] === exit.id,
        denial?.succs,
      );

      const effect = blockWithText(blocks, "record_view");
      checker.checkTruthy("effect call block present", effect !== undefined, blocks);
      const acceptedCut = new Set();
      for (const block of decisions) {
        for (const successor of block.succs) {
          const target = blocks.find((candidate) => candidate.id === successor);
          if (target !== undefined && target.statements.some((s) => s.includes("ok_"))) {
            continue;
          }
          acceptedCut.add(`${block.id}->${successor}`);
        }
      }
      const withoutAccepted = reachableFrom(blocks, entry.id, acceptedCut);
      checker.check(
        "removing whole-condition accepted exits disconnects entry from the effect call",
        !withoutAccepted.has(effect.id),
        [...withoutAccepted].sort(),
      );
      checker.check(
        "entry reaches the effect call in the full graph",
        reachableFrom(blocks, entry.id).has(effect.id),
        true,
      );
      return { blocks: blocks.map((b) => ({ id: b.id, role: b.role, succs: b.succs })) };
    },
  },
  {
    id: "short-circuit-operand-order",
    spec: "Each short-circuit decision evaluates exactly its own leaf; the last evaluated operand is the whole-condition exit decision",
    classification: "static-possible",
    async run(probe, checker) {
      const result = probe.extractors.cfg({ file: "src/cfg-shapes.c", functionName: "cfg_shortcircuit" });
      const blocks = result.blocks;
      checker.checkTruthy("CFG extracted", (blocks ?? []).length > 0, result.raw?.slice(0, 400));
      const aBlock = blocks.find((block) => block.statements.some((s) => s.includes("a > 0")));
      const bBlock = blocks.find((block) => block.statements.some((s) => s.includes("b > 0")));
      checker.checkTruthy("first operand block present", aBlock !== undefined, blocks);
      checker.checkTruthy("second operand block present", bBlock !== undefined, blocks);
      checker.check(
        "first leaf's continuation edge enters the second leaf's block",
        aBlock?.succs.includes(bBlock.id),
        true,
      );
      checker.check(
        "both decisions have two successors",
        decisionBlocks(blocks).length === 2 &&
          decisionBlocks(blocks).every((block) => block.succs.length === 2),
        decisionBlocks(blocks).map((block) => block.succs),
      );
      return { a: aBlock?.succs, b: bBlock?.succs };
    },
  },
  {
    id: "if-else-branch-join",
    spec: "An if/else decision has two successors and both branches join at a common successor",
    classification: "static-possible",
    async run(probe, checker) {
      const result = probe.extractors.cfg({ file: "src/cfg-shapes.c", functionName: "cfg_ifelse" });
      const blocks = result.blocks;
      const decision = decisionBlocks(blocks)[0];
      checker.checkTruthy("decision present", decision !== undefined, blocks);
      checker.check("decision has two successors", decision?.succs.length, 2);
      const join = blocks.find(
        (block) => block.role === null && block.preds.length >= 2,
      );
      checker.checkTruthy("branch join present", join !== undefined, blocks.map((b) => b.preds));
      checker.check(
        "both branch targets reach the join",
        decision.succs.every((successor) => reachableFrom(blocks, successor).has(join.id)),
        true,
      );
      return { decision: decision?.succs, join: join?.id };
    },
  },
  {
    id: "loop-back-edge",
    spec: "A loop produces a reachable cycle; acyclic early-return control flow produces none",
    classification: "static-possible",
    async run(probe, checker) {
      const loop = probe.extractors.cfg({ file: "src/cfg-shapes.c", functionName: "cfg_loop" });
      checker.check("loop CFG contains a cycle", hasCycle(loop.blocks), true);
      const straight = probe.extractors.cfg({ file: "src/cfg-shapes.c", functionName: "cfg_earlyreturn" });
      checker.check("early-return CFG is acyclic", hasCycle(straight.blocks), false);
      const exit = (straight.blocks ?? []).find((block) => block.role === "EXIT");
      checker.checkTruthy("exit block present", exit !== undefined, straight.blocks);
      checker.check(
        "early return flows to exit",
        (straight.blocks ?? [])
          .filter((block) => block.statements.some((s) => s.includes("return")))
          .every((block) => block.succs.length === 1 && block.succs[0] === exit.id),
        straight.blocks?.filter((b) => b.statements.some((s) => s.includes("return"))),
      );
      return { loopBlocks: (loop.blocks ?? []).length, straightBlocks: (straight.blocks ?? []).length };
    },
  },
  {
    id: "denial-side-cycle-unavailable",
    spec: "A denial continuation entering a reachable cycle without a mapped return must make the guarded relation unavailable (no block numbers hardcoded)",
    classification: "static-possible",
    async run(probe, checker) {
      const result = probe.extractors.cfg({ file: "src/handler-cycle.c", functionName: "view_cycle" });
      const blocks = result.blocks;
      checker.checkTruthy("CFG extracted", (blocks ?? []).length > 0, result.raw?.slice(0, 400));
      checker.check("denial side contains the loop cycle", hasCycle(blocks), true);
      const denial = blockWithText(blocks, "return;");
      checker.check(
        "no explicit denial return exists on the cycle path",
        denial === undefined,
        blocks.map((b) => b.statements),
      );
      const entry = blocks.find((block) => block.role === "ENTRY");
      const effect = blockWithText(blocks, "record_view");
      checker.check(
        "entry still reaches the effect call through the accepted edge",
        entry !== undefined && effect !== undefined && reachableFrom(blocks, entry.id).has(effect.id),
        true,
      );
      return { blocks: (blocks ?? []).map((b) => ({ id: b.id, succs: b.succs })) };
    },
  },
];
