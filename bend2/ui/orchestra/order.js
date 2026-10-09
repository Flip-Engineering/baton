/* Attention order and state marks for the orchestra surface.
   Pure record logic: no DOM, no requests, no clock. The shell keeps
   snapshot reads, rendering, and selection; it calls orderPlayers once
   per render and stateMark per row. Input players use the recorded
   fields both surface concepts already pass around: id, status,
   pendingCount, awaitingInput. Unknown statuses and missing fields sort
   last without inventing new states. Only failed runs and waiting inputs
   read as needing a person: an ordinary queue of unacknowledged messages
   is routine agent work, so its count stays on the row as data and never
   promotes the row to an intervention request. */

// Need-first ranks. Failed runs and waiting inputs come before running
// work; busy running actors sort above quiet ones by pending count in the
// tiebreak below; waiting actors follow; ended and unrecognized states
// close.
function needRank(p) {
  if (!p) return 99;
  if (p.status === "failed") return 0;
  if (p.awaitingInput) return 1;
  if (p.status === "running") return 2;
  if (p.status === "waiting") return 3;
  return 4;
}

// One mark per actor for the shell to draw. word is always the recorded
// status string, never a replacement; tone is one of need, run, idle,
// ended, unknown.
function stateMark(p) {
  const status = (p && p.status) || "unknown";
  let tone = "unknown";
  if (status === "failed" || (p && p.awaitingInput)) {
    tone = "need";
  } else if (status === "running") {
    tone = "run";
  } else if (status === "waiting") {
    tone = "idle";
  } else if (status === "completed" || status === "stopped" || status === "ended") {
    tone = "ended";
  }
  return { word: String(status), tone };
}

// A new array, need-first, then highest pending count, then id. The
// input is never mutated; ties the comparator cannot separate keep
// their recorded relative order.
function orderPlayers(players) {
  const list = Array.isArray(players) ? players.slice() : Array.from(players || []);
  list.sort((a, b) => (needRank(a) - needRank(b))
    || (((b && b.pendingCount) || 0) - ((a && a.pendingCount) || 0))
    || (String((a && a.id) || "") < String((b && b.id) || "") ? -1 : 1));
  return list;
}
