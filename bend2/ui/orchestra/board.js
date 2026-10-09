/* Ensemble board. Read-only. All text via textContent.
   Groups recorded actors by ensemble so the reader sees who works
   together. Renders
   from snapshot players and ensembles the page forwards; this module
   starts no request. options: {selectedId, onSelect}. */

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
    const members = (e.members || []).map((id) => byId.get(id)).filter(Boolean);
    const live = members.filter((m) => isLive(m.status)).length;
    if (!live) continue;
    members.sort(byActivity);
    groups.push({ id: e.id, owner: e.owner || "", coupling: e.coupling || "", members, live });
  }
  groups.sort((a, b) => (b.live - a.live) || (a.id < b.id ? -1 : 1));
  const grouped = new Set();
  for (const g of groups) {
    for (const m of g.members) grouped.add(m.id);
  }
  const others = actors.filter((a) => a && a.id && !grouped.has(a.id) && isLive(a.status));
  others.sort(byActivity);
  const row = (parent, a) => {
    const pending = a.pendingCount || 0;
    const size = pending >= 4 ? "2" : pending >= 1 ? "1" : "0";
    const state = a.status === "running" ? "running"
      : a.status === "failed" ? "failed"
      : isLive(a.status) ? "pending" : "ended";
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "board-row st-" + state + " pq" + size
      + (opts.selectedId === a.id ? " selected" : "");
    chip.dataset.focus = String(a.id);
    if (opts.selectedId === a.id) chip.setAttribute("aria-current", "true");
    // The row leads with the actual current action. A newer pending task
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
    const action = document.createElement("span");
    action.className = "board-action";
    action.textContent = doing;
    chip.appendChild(action);
    const id = document.createElement("span");
    id.className = "board-id";
    id.textContent = short;
    chip.appendChild(id);
    if (showTask) {
      const fallback = document.createElement("span");
      fallback.className = "board-task";
      fallback.textContent = "latest task: " + task;
      chip.appendChild(fallback);
    }
    if (pending > 0) {
      const badge = document.createElement("span");
      badge.className = "lane-badge";
      badge.textContent = String(pending);
      chip.appendChild(badge);
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
  for (const g of groups) {
    const head = document.createElement("p");
    head.className = "board-grouphead";
    const name = document.createElement("span");
    name.className = "mono";
    name.textContent = String(g.id);
    name.title = String(g.id);
    head.appendChild(name);
    const meta = document.createElement("span");
    meta.className = "muted";
    meta.textContent = " · " + g.live + " of " + g.members.length + " live"
      + (g.owner ? " · owner " + g.owner : "")
      + (g.coupling ? " · " + g.coupling : "");
    head.appendChild(meta);
    const bar = document.createElement("span");
    bar.className = "board-bar";
    bar.setAttribute("role", "img");
    bar.setAttribute("aria-label", g.live + " of " + g.members.length + " live");
    const fill = document.createElement("span");
    fill.className = "board-bar-fill";
    fill.style.width = Math.round((100 * g.live) / Math.max(1, g.members.length)) + "%";
    bar.appendChild(fill);
    head.appendChild(bar);
    container.appendChild(head);
    summary.groups += 1;
    for (const m of g.members) row(container, m);
  }
  if (others.length) {
    const head = document.createElement("p");
    head.className = "board-grouphead";
    const name = document.createElement("span");
    name.className = "mono";
    name.textContent = "Outside ensembles";
    head.appendChild(name);
    const meta = document.createElement("span");
    meta.className = "muted";
    meta.textContent = " · " + others.length + " live";
    head.appendChild(meta);
    container.appendChild(head);
    summary.groups += 1;
    for (const a of others) row(container, a);
  }
  if (focused) {
    const next = container.querySelector("[data-focus=\"" + CSS.escape(focused) + "\"]");
    if (next && typeof next.focus === "function") next.focus();
  }
  return summary;
}
