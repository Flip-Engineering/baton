/* Attention lane. Read-only. All text via textContent.
   Renders chips for actors that need operator attention: running actors
   first, then awaiting input, failed, and pending. The status word is
   named once per group header; each chip keeps its dot, a shortened id
   and the pending badge, with the full id in the title and aria-label.
   Keyboard focus survives re-renders through a data key holding the
   player id. The page gathers recorded state and forwards it here; this
   module starts no request. Selecting a chip goes back through
   options.onSelect. */

const ATTENTION_GROUP_WORDS = ["running", "awaiting input", "failed", "pending"];
const ATTENTION_ID_SHOWN = 24;

function attentionShortId(id) {
  const full = String(id);
  return full.length > ATTENTION_ID_SHOWN
    ? full.slice(0, ATTENTION_ID_SHOWN - 1) + "…"
    : full;
}

function renderAttention(container, players, options) {
  const opts = options || {};
  const focused = container.contains(document.activeElement)
    && document.activeElement.dataset
    ? document.activeElement.dataset.focus || ""
    : "";
  container.textContent = "";
  const groups = [[], [], [], []];
  for (const p of players || []) {
    if (!p || !p.id) continue;
    let group = -1;
    if (p.status === "running") group = 0;
    else if (p.awaitingInput) group = 1;
    else if (p.status === "failed") group = 2;
    else if (p.status === "pending") group = 3;
    if (group < 0) continue;
    groups[group].push(p);
  }
  let shown = 0;
  groups.forEach((members, group) => {
    if (!members.length) return;
    members.sort((a, b) => ((b.pendingCount || 0) - (a.pendingCount || 0))
      || (String(a.id) < String(b.id) ? -1 : 1));
    const head = document.createElement("p");
    head.className = "lane-grouphead";
    const dot = document.createElement("span");
    dot.className = "dot " + (group === 0 ? "running" : group === 2 ? "failed" : "pending");
    head.appendChild(dot);
    const word = document.createElement("span");
    word.className = "status-word";
    word.textContent = ATTENTION_GROUP_WORDS[group];
    head.appendChild(word);
    const count = document.createElement("span");
    count.className = "muted";
    count.textContent = " · " + members.length;
    head.appendChild(count);
    container.appendChild(head);
    for (const p of members) {
      const fullId = String(p.id);
      const pending = p.pendingCount || 0;
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "lane-chip" + (opts.selectedId === p.id ? " selected" : "");
      chip.dataset.focus = fullId;
      if (opts.selectedId === p.id) chip.setAttribute("aria-current", "true");
      chip.title = fullId;
      chip.setAttribute("aria-label", ATTENTION_GROUP_WORDS[group] + ", " + fullId
        + (pending > 0 ? ", " + pending + " pending" : ""));
      const cdot = document.createElement("span");
      cdot.className = "dot " + (group === 0 ? "running" : group === 2 ? "failed" : "pending");
      chip.appendChild(cdot);
      const id = document.createElement("span");
      id.className = "lane-id mono";
      id.textContent = attentionShortId(fullId);
      chip.appendChild(id);
      if (pending > 0) {
        const badge = document.createElement("span");
        badge.className = "lane-badge";
        badge.textContent = String(pending);
        chip.appendChild(badge);
      }
      chip.addEventListener("click", () => {
        if (typeof opts.onSelect === "function") opts.onSelect(p.id);
      });
      container.appendChild(chip);
      shown += 1;
    }
  });
  if (!shown) {
    const none = document.createElement("p");
    none.className = "muted";
    none.textContent = "No running actors.";
    container.appendChild(none);
  }
  if (focused) {
    const next = container.querySelector("[data-focus=\"" + CSS.escape(focused) + "\"]");
    if (next && typeof next.focus === "function") next.focus();
  }
  return { shown };
}
