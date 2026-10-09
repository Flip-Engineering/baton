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
const ATTENTION_GROUP_FILL = ["var(--running)", "var(--attention)", "var(--failed)", "var(--attention)"];
const ATTENTION_ID_SHOWN = 24;
const ATTENTION_OV_NODES = 12;
const ATTENTION_OV_COL_W = 110;
const ATTENTION_OV_SLOT = 34;
const ATTENTION_OV_TOP = 30;
const ATTENTION_OV_PAD = 20;

function attentionShortId(id) {
  const full = String(id);
  return full.length > ATTENTION_ID_SHOWN
    ? full.slice(0, ATTENTION_ID_SHOWN - 1) + "…"
    : full;
}

// Graphical overview: one column per non-empty group, one node per actor,
// node size following pending messages, largest first, capped and counted.
// Each column is only as tall as the nodes it draws, so small groups leave
// no empty column space. Nodes select through options.onSelect like chips.
// Page tokens arrive through inline var() styles so no stylesheet change
// is needed.
function renderAttentionOverview(container, grouped, opts) {
  const cols = grouped.filter((g) => g.members.length);
  if (!cols.length) return;
  const width = cols.length * ATTENTION_OV_COL_W + ATTENTION_OV_PAD * 2;
  const drawnRows = (members) => Math.min(members.length, ATTENTION_OV_NODES)
    + (members.length > ATTENTION_OV_NODES ? 1 : 0);
  const height = ATTENTION_OV_TOP
    + Math.max(1, ...cols.map((c) => drawnRows(c.members))) * ATTENTION_OV_SLOT + 24;
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", "0 0 " + width + " " + height);
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Orchestra overview");
  cols.forEach((col, c) => {
    const cx = ATTENTION_OV_PAD + c * ATTENTION_OV_COL_W + ATTENTION_OV_COL_W / 2;
    const label = document.createElementNS(svgNS, "text");
    label.setAttribute("x", String(cx));
    label.setAttribute("y", "16");
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("font-size", "12");
    label.textContent = ATTENTION_GROUP_WORDS[col.group] + " · " + col.members.length;
    svg.appendChild(label);
    const shown = col.members.slice(0, ATTENTION_OV_NODES);
    shown.forEach((p, i) => {
      const pending = p.pendingCount || 0;
      const r = 5 + Math.min(pending, 9);
      const cy = ATTENTION_OV_TOP + i * ATTENTION_OV_SLOT + ATTENTION_OV_SLOT / 2;
      const node = document.createElementNS(svgNS, "g");
      node.setAttribute("tabindex", "0");
      node.setAttribute("role", "button");
      node.setAttribute("aria-label", ATTENTION_GROUP_WORDS[col.group] + ", " + String(p.id)
        + (pending > 0 ? ", " + pending + " pending" : ""));
      const dot = document.createElementNS(svgNS, "circle");
      dot.setAttribute("cx", String(cx));
      dot.setAttribute("cy", String(cy));
      dot.setAttribute("r", String(r));
      dot.setAttribute("style", "fill:" + ATTENTION_GROUP_FILL[col.group]
        + (opts.selectedId === p.id ? ";stroke:var(--selection);stroke-width:2.5" : ""));
      node.appendChild(dot);
      const activate = () => {
        if (typeof opts.onSelect === "function") opts.onSelect(p.id);
      };
      node.addEventListener("click", activate);
      node.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          if (ev.preventDefault) ev.preventDefault();
          activate();
        }
      });
      node.dataset.focus = String(p.id);
      svg.appendChild(node);
    });
    if (col.members.length > shown.length) {
      const more = document.createElementNS(svgNS, "text");
      more.setAttribute("x", String(cx));
      more.setAttribute("y", String(ATTENTION_OV_TOP + shown.length * ATTENTION_OV_SLOT + 16));
      more.setAttribute("text-anchor", "middle");
      more.setAttribute("font-size", "12");
      more.textContent = "+" + (col.members.length - shown.length) + " more";
      svg.appendChild(more);
    }
  });
  container.appendChild(svg);
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
  const grouped = groups.map((members, group) => {
    members.sort((a, b) => ((b.pendingCount || 0) - (a.pendingCount || 0))
      || (String(a.id) < String(b.id) ? -1 : 1));
    return { group, members };
  });
  renderAttentionOverview(container, grouped, opts);
  let shown = 0;
  groups.forEach((members, group) => {
    if (!members.length) return;
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
      if (p.action) {
        const action = document.createElement("span");
        action.className = "lane-action";
        action.textContent = p.action;
        chip.appendChild(action);
      }
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
