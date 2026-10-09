/* Knowledge graph. Read-only. All text via textContent.
   Draws shared findings in rings grouped by promotion count, with edges
   connecting their recorded sources and destinations. Unshared findings
   appear in author bands. Ring sizes follow their node counts; all finding
   nodes have the same size. Layout is deterministic; newly
   arrived nodes pulse once. Renders from a knowledge overview shaped
   like the `orchestra/knowledge/overview` route; starts no request.
   options: {query, includeUnshared, selectedId, notice, roles, onSelect}.
   onSelect receives the finding id. Author anchors wrap into rows so the
   actor labels stay inside the surface; edges run from every row.
   roles maps actor id to recorded role for anchor fill. Edge types:
   authorship (author to finding), share (promotion source to finding),
   deliver (finding to promotion destination); share and deliver carry
   arrowheads along the recorded flow. */

const KG_ACTOR_SLOT = 150;
const KG_ACTORS_PER_ROW = 10;
const KG_ANCHOR_PITCH_Y = 30;
const KG_GOLDEN_ANGLE = 2.399963;
const KG_NODE_SLOT = 26;
const KG_BAND_PITCH = 22;
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
  // Shared findings circle by recorded sharing degree; each ring radius fits
  // its own node count at one node slot per node, so neighbors never share
  // a point. Unshared findings list under their author below the field.
  const anchorRows = Math.max(1, Math.ceil(actors.length / KG_ACTORS_PER_ROW));
  const anchorBottom = KG_TOP + (anchorRows - 1) * KG_ANCHOR_PITCH_Y;
  const ringOf = (count) => (count >= 5 ? 0 : count >= 2 ? 1 : 2);
  const ringCounts = [0, 0, 0];
  for (const f of shared) ringCounts[ringOf(promoCount.get(f.id) || 0)] += 1;
  // Each ring needs circumference for its nodes; radii accumulate outward.
  const ringRadius = [];
  {
    let r = 0;
    for (let k = 0; k < 3; k += 1) {
      r += Math.max(110, Math.ceil((ringCounts[k] * KG_NODE_SLOT) / (2 * Math.PI)));
      ringRadius.push(k === 0 ? Math.max(70, r) : r);
    }
  }
  const maxR = ringRadius.length ? ringRadius[ringRadius.length - 1] : 0;
  const width = Math.max(
    KG_PAD * 2 + Math.min(actors.length, KG_ACTORS_PER_ROW) * KG_ACTOR_SLOT,
    KG_PAD * 2 + maxR * 2,
  );
  const cx = width / 2;
  const cy = anchorBottom + 70 + maxR;
  const fieldBottom = cy + maxR + 44;
  const ringTaken = [0, 0, 0];
  // Unshared findings carry no promotion edges, so they list under their
  // author in wrapping bands. Band geometry precedes surface creation.
  const bandAuthors = new Map();
  for (const f of unshared) {
    const author = String((f && f.author) || "unknown");
    if (!bandAuthors.has(author)) bandAuthors.set(author, []);
    bandAuthors.get(author).push(f);
  }
  const bandNames = [...bandAuthors.keys()].sort((a, b) => {
    const diff = bandAuthors.get(b).length - bandAuthors.get(a).length;
    return diff !== 0 ? diff : (a < b ? -1 : a > b ? 1 : 0);
  });
  const bandX0 = KG_PAD + 230;
  const bandPerRow = Math.max(1, Math.floor((width - bandX0 - KG_PAD) / KG_BAND_PITCH));
  const bandPlan = bandNames.map((author) => ({
    author,
    items: bandAuthors.get(author),
    rows: Math.max(1, Math.ceil(bandAuthors.get(author).length / bandPerRow)),
  }));
  let bandSpan = 0;
  for (const b of bandPlan) bandSpan += b.rows * KG_BAND_PITCH + 14;
  const height = fieldBottom + (bandPlan.length ? 30 + bandSpan + 6 : 0);

  const wrap = kgEl(null, "div", { class: "kg-scroll" }, container);
  const svg = kgEl("svg", "svg", {
    viewBox: "0 0 " + width + " " + height,
    width: String(width),
    height: String(height),
    role: "img",
    "aria-label": "Knowledge graph",
  }, wrap);
  svg.setAttribute("class", "kg");
  const defs = kgEl("svg", "defs", {}, svg);
  const marker = (mid, color) => {
    const m = kgEl("svg", "marker", {
      id: mid,
      viewBox: "0 0 8 8",
      refX: "7",
      refY: "4",
      markerWidth: "7",
      markerHeight: "7",
      orient: "auto-start-reverse",
    }, defs);
    kgEl("svg", "path", { d: "M0,0 L8,4 L0,8 Z", fill: color }, m);
  };
  marker("kg-arrow-share", "var(--attention)");
  marker("kg-arrow-deliver", "var(--muted)");
  const edgeLayer = kgEl("svg", "g", { class: "kg-edges" }, svg);

  const roles = (opts && opts.roles) || {};
  const roleFrag = (id) => String(roles[id] || "").toLowerCase().replace(/[^a-z-]/g, "") || "unknown";
  const actorPos = new Map();
  actors.forEach((id, i) => {
    const x = KG_PAD + (i % KG_ACTORS_PER_ROW) * KG_ACTOR_SLOT + KG_ACTOR_SLOT / 2;
    const y = KG_TOP + Math.floor(i / KG_ACTORS_PER_ROW) * KG_ANCHOR_PITCH_Y;
    actorPos.set(id, { x, y });
    const n = String(id).length > 18 ? String(id).slice(0, 17) + "…" : String(id);
    const role = roleFrag(id);
    const anchor = kgEl("svg", "g", { class: "kg-anchor" }, svg);
    // The last column labels run left so every label stays inside the surface.
    const lastCol = (i % KG_ACTORS_PER_ROW) === KG_ACTORS_PER_ROW - 1 || i === actors.length - 1;
    kgEl("svg", "rect", {
      x: String(x - 4), y: String(y - 4), width: "8", height: "8",
      class: "kg-actor role-" + role,
    }, anchor);
    const heading = kgEl("svg", "title", {}, anchor);
    heading.textContent = String(id) + (roles[id] ? ", " + String(roles[id]) : "");
    kgText(anchor, n, {
      x: String(x + (lastCol ? -10 : 10)),
      y: String(y + 4),
      class: "kg-label mono",
    }, lastCol ? "end" : "start");
  });

  const findingPos = new Map();
  // Labels render for the two inner rings and the selected node only; at
  // orchestra scale a label per node overlaps its neighbors. Every other
  // node shows its claim words while focused or hovered.
  const nodeLabel = (g, f, x, y, hover) => {
    const words = String(f.claim || f.id);
    const label = words.length > 26 ? words.slice(0, 25) + "…" : words;
    kgText(g, label, {
      x: String(x),
      y: String(y + 21),
      class: "kg-label" + (hover ? " kg-hover" : ""),
    }, "middle");
  };
  const placeFinding = (f, x, y, staticLabel) => {
    findingPos.set(f.id, { x, y });
    now.add(f.id);
    const selected = opts.selectedId && opts.selectedId === f.id;
    const g = kgEl("svg", "g", {
      class: "knode"
        + (sharedIds.has(f.id) ? "" : " unshared")
        + (selected ? " selected" : "")
        + (seen.has(f.id) ? "" : " kg-new"),
      tabindex: "0",
      role: "button",
      "aria-label": String(f.id),
    }, svg);
    const heading = kgEl("svg", "title", {}, g);
    heading.textContent = String(f.claim || f.id);
    kgEl("svg", "circle", {
      cx: String(x), cy: String(y), r: "5",
      class: "kg-finding" + (sharedIds.has(f.id) ? "" : " unshared"),
    }, g);
    if (staticLabel || selected) nodeLabel(g, f, x, y, false);
    const showHoverLabel = () => {
      if (g.querySelector(".kg-label")) return;
      nodeLabel(g, f, x, y, true);
    };
    const hideHoverLabel = () => {
      if (selected) return;
      const hover = g.querySelector(".kg-hover");
      if (hover) hover.remove();
    };
    g.addEventListener("focus", showHoverLabel);
    g.addEventListener("blur", hideHoverLabel);
    g.addEventListener("mouseenter", showHoverLabel);
    g.addEventListener("mouseleave", hideHoverLabel);
    const activate = () => { if (typeof opts.onSelect === "function") opts.onSelect(f.id); };
    g.addEventListener("click", activate);
    g.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        if (ev.preventDefault) ev.preventDefault();
        activate();
      }
    });
  };
  for (const f of shared) {
    const ring = ringOf(promoCount.get(f.id) || 0);
    const angle = ringTaken[ring] * KG_GOLDEN_ANGLE + ring * 0.7;
    ringTaken[ring] += 1;
    const radius = ringRadius[ring];
    placeFinding(f, cx + radius * Math.cos(angle), cy + radius * Math.sin(angle), ring <= 1);
  }
  let bandY = fieldBottom + 30;
  for (const plan of bandPlan) {
    const short = plan.author.length > 18 ? plan.author.slice(0, 17) + "…" : plan.author;
    kgEl("svg", "rect", {
      x: String(KG_PAD + 4), y: String(bandY - 4), width: "8", height: "8", class: "kg-actor",
    }, svg);
    kgText(svg, short, {
      x: String(KG_PAD + 18), y: String(bandY + 4), class: "kg-label mono",
    }, "start");
    plan.items.forEach((f, i) => {
      placeFinding(f,
        bandX0 + (i % bandPerRow) * KG_BAND_PITCH + KG_BAND_PITCH / 2,
        bandY + Math.floor(i / bandPerRow) * KG_BAND_PITCH, false);
    });
    bandY += plan.rows * KG_BAND_PITCH + 14;
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
        "marker-end": "url(#kg-arrow-share)",
        "aria-label": "promotion from " + String(p.source) + " to " + String(p.destination),
      }, edgeLayer);
      summary.edges += 1;
    }
    if (p.destination && actorPos.has(String(p.destination))) {
      const dest = actorPos.get(String(p.destination));
      kgEl("svg", "line", {
        x1: String(to.x), y1: String(to.y + 6),
        x2: String(dest.x), y2: String(dest.y - 6),
        class: "kg-edge-deliver",
        "marker-end": "url(#kg-arrow-deliver)",
        "aria-label": "delivery of " + String(p.finding) + " to " + String(p.destination),
      }, edgeLayer);
      summary.edges += 1;
    }
  }
  for (const [fid, finding] of findings) {
    if (!findingPos.has(fid)) continue;
    const author = finding.author ? String(finding.author) : "";
    if (!author || !actorPos.has(author)) continue;
    if (!kgMatches(opts.query, fid, finding.claim, author)) continue;
    const from = actorPos.get(author);
    const to = findingPos.get(fid);
    kgEl("svg", "line", {
      x1: String(from.x), y1: String(from.y + 6),
      x2: String(to.x), y2: String(to.y - 6),
      class: "kg-edge-authorship",
      "aria-label": "authored by " + author,
    }, edgeLayer);
    summary.edges += 1;
  }
  kgSeenByMount.set(container, now);

  const legend = kgEl(null, "p", { class: "kg-legend muted" }, container);
  legend.textContent = "Shared findings are grouped by sharing activity; "
    + "unshared findings appear below them by author. "
    + "Thin lines run author to finding. Ochre arrows run sharing source to "
    + "finding; hairlines with arrowheads run finding to destination. "
    + "Dark anchors are conductors, blue is the operator, gray are players and other roles. "
    + "Select a finding to open its record.";
  return summary;
}
