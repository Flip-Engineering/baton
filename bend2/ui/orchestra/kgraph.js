/* Knowledge graph. Read-only. All text via textContent.
   Draws recorded findings as nodes between the actors that authored
   and received them, so the reader sees what the stored data actually
   connects: author anchors on top, findings sized by promotion count,
   ochre edges for recorded shares. Layout is deterministic; newly
   arrived nodes pulse once. Renders from a knowledge overview shaped
   like the `orchestra/knowledge/overview` route; starts no request.
   options: {query, includeUnshared, selectedId, notice, onSelect}.
   onSelect receives the finding id and its recorded author, so the host
   can open the author dossier alongside the finding record. */

const KG_ACTOR_SLOT = 150;
const KG_GRID_SLOT_X = 150;
const KG_GRID_SLOT_Y = 64;
const KG_TOP = 44;
const KG_PAD = 16;

const kgSeenByMount = new WeakMap();

function kgMatches(query, id, claim, author) {
  if (!query) return true;
  const q = String(query).trim().toLowerCase();
  if (!q) return true;
  return String(id || "").toLowerCase().includes(q)
    || String(claim || "").toLowerCase().includes(q)
    || String(author || "").toLowerCase().includes(q);
}

function kgEl(ns, name, attrs, parent) {
  const node = ns
    ? document.createElementNS("http://www.w3.org/2000/svg", name)
    : document.createElement(name);
  for (const key of Object.keys(attrs || {})) node.setAttribute(key, attrs[key]);
  if (parent) parent.appendChild(node);
  return node;
}

function kgText(parent, value, attrs, anchor) {
  const node = kgEl("svg", "text", attrs, parent);
  node.textContent = value == null ? "" : String(value);
  if (anchor) node.setAttribute("text-anchor", anchor);
  return node;
}

function renderKnowledgeGraph(container, overview, options) {
  const opts = options || {};
  container.textContent = "";
  const summary = { actors: 0, findings: 0, edges: 0 };
  if (!overview || opts.notice) {
    const p = kgEl(null, "p", { class: "muted" }, container);
    p.textContent = opts.notice || "No knowledge read yet.";
    return summary;
  }
  const findings = new Map((overview.findings || []).map((f) => [f.id, f]));
  const promotions = overview.promotions || [];
  const sharedIds = new Set(promotions.map((p) => p.finding).filter(Boolean));
  const promoCount = new Map();
  for (const p of promotions) {
    if (!p.finding) continue;
    promoCount.set(p.finding, (promoCount.get(p.finding) || 0) + 1);
  }
  const shared = [];
  const unshared = [];
  for (const f of overview.findings || []) {
    if (!kgMatches(opts.query, f.id, f.claim, f.author)) continue;
    if (sharedIds.has(f.id)) shared.push(f);
    else if (opts.includeUnshared) unshared.push(f);
  }
  shared.sort((a, b) => (promoCount.get(b.id) || 0) - (promoCount.get(a.id) || 0)
    || String(a.id).localeCompare(String(b.id)));
  unshared.sort((a, b) => String(a.id).localeCompare(String(b.id)));

  const authored = new Map();
  for (const f of shared.concat(unshared)) {
    const author = String(f.author || "unknown");
    authored.set(author, (authored.get(author) || 0) + 1);
  }
  const actors = Array.from(authored.keys());
  for (const p of promotions) {
    if (!kgMatches(opts.query, p.finding, (findings.get(p.finding) || {}).claim, p.author)) continue;
    for (const id of [p.source, p.destination]) {
      if (id && !authored.has(String(id)) && actors.indexOf(String(id)) === -1) actors.push(String(id));
    }
  }
  actors.sort((a, b) => ((authored.get(b) || 0) - (authored.get(a) || 0))
    || (a < b ? -1 : 1));
  summary.actors = actors.length;
  summary.findings = shared.length + unshared.length;

  if (!actors.length && !shared.length && !unshared.length) {
    const p = kgEl(null, "p", { class: "muted" }, container);
    p.textContent = opts.query ? "No findings match." : "No recorded findings.";
    return summary;
  }

  const seen = kgSeenByMount.get(container) || new Set();
  const now = new Set();
  const actorY = KG_TOP;
  const gridY = KG_TOP + 56;
  const cols = Math.max(1, Math.ceil(Math.sqrt(Math.max(1, shared.length))));
  const sharedWidth = cols * KG_GRID_SLOT_X;
  const dividerX = KG_PAD + sharedWidth + 24;
  const unsharedX = dividerX + 24;
  const gridRows = Math.max(1, Math.ceil(shared.length / cols));
  const width = Math.max(
    KG_PAD * 2 + actors.length * KG_ACTOR_SLOT,
    KG_PAD + sharedWidth + (unshared.length ? 48 + KG_GRID_SLOT_X : 0) + KG_PAD,
  );
  const height = gridY + Math.max(gridRows, unshared.length) * KG_GRID_SLOT_Y + 40;

  const wrap = kgEl(null, "div", { class: "kg-scroll" }, container);
  const svg = kgEl("svg", "svg", {
    viewBox: "0 0 " + width + " " + height,
    width: String(width),
    height: String(height),
    role: "img",
    "aria-label": "Knowledge graph",
  }, wrap);
  svg.setAttribute("class", "kg");
  const edgeLayer = kgEl("svg", "g", { class: "kg-edges" }, svg);

  const actorPos = new Map();
  actors.forEach((id, i) => {
    const x = KG_PAD + i * KG_ACTOR_SLOT + KG_ACTOR_SLOT / 2;
    actorPos.set(id, { x, y: actorY });
    const n = String(id).length > 20 ? String(id).slice(0, 19) + "…" : String(id);
    kgEl("svg", "rect", {
      x: String(x - 4), y: String(actorY - 4), width: "8", height: "8", class: "kg-actor",
    }, svg);
    kgText(svg, n, { x: String(x), y: String(actorY + 22), class: "kg-label mono" }, "middle");
  });

  const findingPos = new Map();
  const placeFinding = (f, x, y) => {
    findingPos.set(f.id, { x, y });
    now.add(f.id);
    const count = promoCount.get(f.id) || 0;
    const r = 5 + 2 * Math.min(count, 3);
    const g = kgEl("svg", "g", {
      class: "knode"
        + (sharedIds.has(f.id) ? "" : " unshared")
        + (opts.selectedId && opts.selectedId === f.id ? " selected" : "")
        + (seen.has(f.id) ? "" : " kg-new"),
      tabindex: "0",
      role: "button",
      "aria-label": String(f.id),
    }, svg);
    const heading = kgEl("svg", "title", {}, g);
    heading.textContent = String(f.claim || f.id);
    kgEl("svg", "circle", {
      cx: String(x), cy: String(y), r: String(r),
      class: "kg-finding" + (sharedIds.has(f.id) ? "" : " unshared"),
    }, g);
    const words = String(f.claim || f.id);
    const label = words.length > 26 ? words.slice(0, 25) + "…" : words;
    kgText(g, label, { x: String(x), y: String(y + r + 14), class: "kg-label" }, "middle");
    const activate = () => { if (typeof opts.onSelect === "function") opts.onSelect(f.id, f.author); };
    g.addEventListener("click", activate);
    g.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        if (ev.preventDefault) ev.preventDefault();
        activate();
      }
    });
  };
  shared.forEach((f, i) => {
    placeFinding(f, KG_PAD + (i % cols) * KG_GRID_SLOT_X + KG_GRID_SLOT_X / 2,
      gridY + Math.floor(i / cols) * KG_GRID_SLOT_Y + 20);
  });
  if (unshared.length) {
    kgEl("svg", "line", {
      x1: String(dividerX), y1: String(gridY - 10),
      x2: String(dividerX), y2: String(gridY + unshared.length * KG_GRID_SLOT_Y),
      class: "kg-divider",
    }, svg);
    kgText(svg, "not yet shared", { x: String(unsharedX), y: String(gridY - 16), class: "kg-note" });
    unshared.forEach((f, i) => {
      placeFinding(f, unsharedX + KG_GRID_SLOT_X / 2, gridY + i * KG_GRID_SLOT_Y + 20);
    });
  }

  for (const p of promotions) {
    const finding = findings.get(p.finding);
    if (!finding || !findingPos.has(p.finding)) continue;
    if (!kgMatches(opts.query, p.finding, finding.claim, p.author)) continue;
    const to = findingPos.get(p.finding);
    if (p.source && actorPos.has(String(p.source))) {
      const from = actorPos.get(String(p.source));
      kgEl("svg", "line", {
        x1: String(from.x), y1: String(from.y + 6),
        x2: String(to.x), y2: String(to.y - 6),
        class: "kg-edge-share",
        "aria-label": "promotion from " + String(p.source) + " to " + String(p.destination),
      }, edgeLayer);
      summary.edges += 1;
    }
    if (p.destination && actorPos.has(String(p.destination))) {
      const dest = actorPos.get(String(p.destination));
      kgEl("svg", "line", {
        x1: String(to.x), y1: String(to.y + 6),
        x2: String(dest.x), y2: String(dest.y - 6),
        class: "kg-edge-authored",
      }, edgeLayer);
      summary.edges += 1;
    }
  }
  kgSeenByMount.set(container, now);

  const legend = kgEl(null, "p", { class: "kg-legend muted" }, container);
  legend.textContent = "Lines run from the sharing source through the finding to its destination. "
    + "Ring size follows promotion count. Select a finding to open its record.";
  return summary;
}
