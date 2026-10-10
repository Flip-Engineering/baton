/* Recorded activity order and row marks. Failed executions and explicitly
   stopped actors with owed input precede running, starting and queued work. */

function needRank(p) {
  if (!p) return 99;
  if (p.status === "failed") return 0;
  if (p.status === "stopped" && Math.max(p.pendingCount || 0, p.unacknowledgedCount || 0) > 0) return 1;
  if (p.status === "running") return 2;
  if (p.status === "waiting") return 3;
  if (Math.max(p.pendingCount || 0, p.unacknowledgedCount || 0) > 0 || p.status === "pending") return 4;
  return 5;
}

// Queued input stays visible when the last successful execution has ended.
function stateMark(p) {
  const status = (p && p.status) || "unknown";
  const owed = p && Math.max(p.pendingCount || 0, p.unacknowledgedCount || 0) > 0;
  let tone = "unknown";
  if (status === "failed" || (status === "stopped" && owed)) {
    tone = "need";
  } else if (status === "running") {
    tone = "run";
  } else if (status === "waiting") {
    tone = "idle";
  } else if (owed || status === "pending") {
    tone = "queued";
  } else if (status === "stopped") {
    // A stopped actor owing nothing is at rest with its own tone: the
    // default hall seats active work, and the quiet tests rest this seat
    // while the all-rows toggle keeps it reachable.
    tone = "stopped";
  } else if (status === "completed" || status === "ended") {
    tone = "ended";
  }
  return { word: tone === "queued" ? "queued" : String(status), tone };
}

// A new array, need-first, then highest pending count, then id. The
// input is never mutated; ties the comparator cannot separate keep
// their recorded relative order.
function orderPlayers(players) {
  const list = Array.isArray(players) ? players.slice() : Array.from(players || []);
  list.sort((a, b) => (needRank(a) - needRank(b))
    || (Math.max((b && b.pendingCount) || 0, (b && b.unacknowledgedCount) || 0) - Math.max((a && a.pendingCount) || 0, (a && a.unacknowledgedCount) || 0))
    || (String((a && a.id) || "") < String((b && b.id) || "") ? -1 : 1));
  return list;
}
