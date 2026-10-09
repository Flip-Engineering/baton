/* Ensemble board. Read-only. All text via textContent.
   Renders each ensemble as one card so the reader grasps a working unit
   at a glance: the header names the shared current work with its count,
   and every live member is a tile carrying status, purpose and identity.
   Renders from snapshot players and ensembles the page forwards; this
   module starts no request. options: {selectedId, onSelect}. */

function renderEnsembleBoard(container, data, options) {
  const opts = options || {};
  const focused = container.contains(document.activeElement)
    && document.activeElement.dataset
    ? document.activeElement.dataset.focus || ""
    : "";
  container.textContent = "";
  const summary = { groups: 0, shown: 0 };
  const actors = Array.isArray((data || {}).actors) ? data.actors : [];
  const ensembles = Array.isArray((data || {}).ensembles) ? data.ensembles : [];
  const isLive = (status) => status === "running" || status === "waiting" || status === "pending";
  const byId = new Map();
  for (const a of actors) {
    if (a && a.id) byId.set(a.id, a);
  }
  const byActivity = (a, b) => ((isLive(b.status) ? 1 : 0) - (isLive(a.status) ? 1 : 0))
    || ((b.pendingCount || 0) - (a.pendingCount || 0))
    || (String(a.id) < String(b.id) ? -1 : 1);
  const groups = [];
  for (const e of ensembles) {
    if (!e || !e.id) continue;
    const allMembers = (e.members || []).map((id) => byId.get(id)).filter(Boolean);
    const members = allMembers.filter((m) => isLive(m.status));
    const live = members.length;
    if (!live) continue;
    members.sort(byActivity);
    groups.push({ id: e.id, owner: e.owner || "", coupling: e.coupling || "", members, live, total: allMembers.length });
  }
  groups.sort((a, b) => (b.live - a.live) || (a.id < b.id ? -1 : 1));
  const grouped = new Set();
  for (const g of groups) {
    for (const m of g.members) grouped.add(m.id);
  }
  const others = actors.filter((a) => a && a.id && !grouped.has(a.id) && isLive(a.status));
  others.sort(byActivity);
  const dotWord = (a) => (a.status === "running" ? "running"
    : a.status === "failed" ? "failed"
    : a.status === "waiting" ? "waiting"
    : a.status === "pending" ? "pending" : "unknown");
  const tile = (parent, a) => {
    const pending = a.pendingCount || 0;
    const size = pending >= 4 ? "2" : pending >= 1 ? "1" : "0";
    const state = a.status === "running" ? "running"
      : a.status === "failed" ? "failed"
      : isLive(a.status) ? "pending" : "ended";
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "board-tile st-" + state + " pq" + size
      + (opts.selectedId === a.id ? " selected" : "");
    chip.dataset.focus = String(a.id);
    if (opts.selectedId === a.id) chip.setAttribute("aria-current", "true");
    // The tile leads with the actual current action. A newer pending task
    // has not begun, so it follows as identified fallback detail, never
    // replacing the running work label.
    const doing = String((a.action && a.stale ? a.action + " (last transition)" : a.action) || a.id);
    const task = String(a.task || "");
    const showTask = task !== "" && task !== doing;
    chip.setAttribute("aria-label", String(a.status || "unknown") + ", " + String(a.id)
      + (doing !== String(a.id) ? ", " + doing : "")
      + (showTask ? ", latest task: " + task : "")
      + (pending > 0 ? ", " + pending + " pending" : ""));
    chip.title = String(a.id);
    const short = String(a.id).length > 24 ? String(a.id).slice(0, 23) + "…" : String(a.id);
    const top = document.createElement("span");
    top.className = "tile-top";
    const dot = document.createElement("span");
    dot.className = "dot " + dotWord(a);
    dot.setAttribute("aria-hidden", "true");
    top.appendChild(dot);
    const id = document.createElement("span");
    id.className = "tile-id";
    id.textContent = short;
    top.appendChild(id);
    if (pending > 0) {
      const badge = document.createElement("span");
      badge.className = "lane-badge";
      badge.textContent = String(pending);
      top.appendChild(badge);
    }
    chip.appendChild(top);
    const action = document.createElement("span");
    action.className = "tile-action";
    action.textContent = doing;
    chip.appendChild(action);
    if (showTask) {
      const fallback = document.createElement("span");
      fallback.className = "tile-task";
      fallback.textContent = "latest task: " + task;
      chip.appendChild(fallback);
    }
    chip.addEventListener("click", () => {
      if (typeof opts.onSelect === "function") opts.onSelect(a.id);
    });
    parent.appendChild(chip);
    summary.shown += 1;
  };
  if (!groups.length && !others.length) {
    const none = document.createElement("p");
    none.className = "muted";
    none.textContent = "No running actors.";
    container.appendChild(none);
    return summary;
  }
  // One dot per member shows who works together at a glance; when live
  // members share the same current work, the header names it with its count.
  const headerExtras = (head, members) => {
    const dots = document.createElement("span");
    dots.className = "board-dots";
    dots.setAttribute("role", "img");
    dots.setAttribute("aria-label", members.map((m) => String(m.id)).join(", "));
    const tally = new Map();
    for (const m of members) {
      const dot = document.createElement("span");
      dot.className = "dot " + dotWord(m);
      dot.title = String(m.id);
      dots.appendChild(dot);
      if (!isLive(m.status)) continue;
      const doing = String((m.action && m.stale ? m.action + " (last transition)" : m.action) || m.id);
      tally.set(doing, (tally.get(doing) || 0) + 1);
    }
    head.appendChild(dots);
    let focus = "", focusCount = 0;
    for (const [doing, n] of tally) {
      if (n > focusCount) { focus = doing; focusCount = n; }
    }
    if (focusCount >= 2) {
      const line = document.createElement("span");
      line.className = "board-focus";
      line.textContent = focusCount + " on " + focus;
      head.appendChild(line);
    }
  };
  const card = (title, metaText, members, barText) => {
    const section = document.createElement("section");
    section.className = "board-card";
    section.setAttribute("aria-label", title);
    const head = document.createElement("p");
    head.className = "board-grouphead";
    const name = document.createElement("span");
    name.className = "mono";
    name.textContent = title;
    name.title = title;
    head.appendChild(name);
    const meta = document.createElement("span");
    meta.className = "muted";
    meta.textContent = metaText;
    head.appendChild(meta);
    headerExtras(head, members);
    if (barText) {
      const bar = document.createElement("span");
      bar.className = "board-bar";
      bar.setAttribute("role", "img");
      bar.setAttribute("aria-label", barText.label);
      const fill = document.createElement("span");
      fill.className = "board-bar-fill";
      fill.style.width = barText.width;
      bar.appendChild(fill);
      head.appendChild(bar);
    }
    section.appendChild(head);
    const tiles = document.createElement("div");
    tiles.className = "board-tiles";
    for (const m of members) tile(tiles, m);
    section.appendChild(tiles);
    container.appendChild(section);
    summary.groups += 1;
  };
  for (const g of groups) {
    card(String(g.id), " · " + g.live + " of " + g.total + " live"
      + (g.owner ? " · owner " + g.owner : "")
      + (g.coupling ? " · " + g.coupling : ""), g.members, {
      label: g.live + " of " + g.total + " live",
      width: Math.round((100 * g.live) / Math.max(1, g.total)) + "%",
    });
  }
  if (others.length) {
    card("Outside ensembles", " · " + others.length + " live", others, null);
  }
  if (focused) {
    const next = container.querySelector("[data-focus=\"" + CSS.escape(focused) + "\"]");
    if (next && typeof next.focus === "function") next.focus();
  }
  return summary;
}
