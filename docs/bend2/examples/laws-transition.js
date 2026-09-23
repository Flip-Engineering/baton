// The JS host half of the transition witness (laws-transition.bend).
//
// Both functions require the real implementation from the checkout the program
// runs in (process.cwd()), so the witness exercises impl/src and not a copy of it.
// The pinned runtime supplies `require` to this file, and Node 25 loads the
// ESM modules it names synchronously.
//
// The effect contract: the function name is the def name lowercased with dots as
// underscores, a Nat arrives and answers as a BigInt, and a U32 as a number.

// The real review append: fold `n` accepted review rows into one contribution's
// review list through foldSwarmEvent, and answer the fingerprint of the rows it
// retained. The fingerprint is a base-3 number over the retained decisions in
// order (accept 0, reject 1, comment 2), so a dropped or reordered row changes it.
function real_reviews_fingerprint(n) {
  const { foldSwarmEvent } = require(process.cwd() + "/impl/src/swarm-state.mjs");
  const swarms = new Map();
  const fold = (kind, payload) => foldSwarmEvent(swarms, { kind, payload });
  fold("swarm.created", { swarmId: "sw1", purpose: "transition witness" });
  fold("swarm.participant_joined", { swarmId: "sw1", participantId: "p1" });
  fold("swarm.work_updated", { swarmId: "sw1", workId: "w1", objective: "Task" });
  fold("swarm.contribution_recorded", {
    swarmId: "sw1", contributionId: "c1", participantId: "p1", body: "draft",
  });
  const decisions = ["accept", "reject", "comment"];
  const digits = { accept: 0n, reject: 1n, comment: 2n };
  for (let i = 0n; i < n; i += 1n) {
    fold("swarm.contribution_reviewed", {
      swarmId: "sw1", contributionId: "c1", reviewerId: "p1",
      decision: decisions[Number(i % 3n)],
    });
  }
  const reviews = swarms.get("sw1").reviews?.["c1"] ?? [];
  let fingerprint = 0n;
  for (const review of reviews) {
    fingerprint = fingerprint * 3n + digits[review.decision] + 1n;
  }
  return fingerprint;
}

// The real worker admission: build the case's host observation, ask the real
// capacity authority for its own room-for-worker reading, and answer 1 or 0.
function real_worker_room(tight, free_mb) {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const { HostCapacityAuthority } = require(process.cwd() + "/impl/src/host-capacity.mjs");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "laws-transition-"));
  try {
    const observation = () => ({
      cores: 4, totalBytes: 32 * 1024 ** 3,
      freeBytes: Number(free_mb) * 1024 * 1024, load1m: Number(tight),
    });
    const authority = new HostCapacityAuthority({ root, residentId: "laws-transition-witness", observation });
    return authority.observeNow().roomForWorker ? 1 : 0;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
