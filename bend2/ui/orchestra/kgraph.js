/* Knowledge graph. Read-only. All text via textContent.
   Draws actors in rows by recorded parent depth, with each actor's
   findings placed in the same row. Squares are actors; circles are
   findings. Circle size follows promotion count; filled circles are
   shared findings and open circles are unshared. Every edge carries an
   arrowhead along its recorded direction: author to finding, sharing
   source to finding, finding to destination, and promoter to finding
   when the recorded promoter differs from source and destination.
   Layout is deterministic; newly arrived nodes pulse once. Renders
   from a knowledge overview shaped like the
   `orchestra/knowledge/overview` route; starts no request.
   options: {query, includeUnshared, selectedId, notice, roles,
   actorMeta, onSelect}. actorMeta is the overview actors map with
   recorded role and parent per actor; roles maps actor id to recorded
   role as a fallback. onSelect receives the finding id.
   A control row isolates one recorded relation kind. Activating an
   actor or a finding focuses it with only its recorded neighbours at
   full strength; activating it again or pressing Escape clears the
   focus. Both persist across re-renders per mount. */

const KG_WIDTH = 1640;
const KG_GUTTER = 170;
const KG_ACTOR_SLOT = 150;
const KG_FIND_SLOT = 32;
const KG_ANCHOR_PITCH_Y = 30;
const KG_FIND_PITCH_Y = 30;
const KG_TOP = 16;
const KG_PAD = 16;
const KG_ROLE_WORDS = {
  "principal-conductor": "principal conductor",
  "associate-conductor": "associate conductors",
  "operator": "operator",
  "player": "players",
};

const kgSeenByMount = new WeakMap();
const kgViewByMount = new WeakMap();
const kgArgsByMount = new WeakMap();

function kgRerender(container) {
  const saved = kgArgsByMount.get(container);
  if (saved) renderKnowledgeGraph(container, saved.overview, saved.opts);
}

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
  const activeControl = container.contains(document.activeElement)
    && document.activeElement.getAttribute
    ? document.activeElement.getAttribute("data-kg-control") || ""
    : "";
  container.textContent = "";
  kgArgsByMount.set(container, { overview, opts });
  const view = kgViewByMount.get(container) || { kind: null, focus: null };
  kgViewByMount.set(container, view);
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

  // Recorded hierarchy places actors: role and parent come from the
  // overview actors map, with the snapshot roles map as fallback.
  // Depth counts parent links up to a root; a broken chain, a cycle,
  // or a missing role leaves the actor unplaced. Nothing is inferred
  // from claim text.
  const meta = (opts && opts.actorMeta) || overview.actors || {};
  const roles = (opts && opts.roles) || {};
  const roleOf = (id) => (meta[id] && meta[id].role) || roles[id] || "";
  const depthOf = (id) => {
    if (!roleOf(id)) return -1;
    const chain = new Set();
    let cur = id;
    let d = 0;
    for (;;) {
      if (chain.has(cur)) return -1;
      chain.add(cur);
      const entry = meta[cur];
      const p = entry ? (entry.parent || "") : null;
      if (p === null || p === undefined) return -1;
      if (p === "") return d;
      cur = p;
      d += 1;
    }
  };

  const authored = new Map();
  for (const f of shared.concat(unshared)) {
    const author = String(f.author || "unknown");
    authored.set(author, (authored.get(author) || 0) + 1);
  }
  const actors = Array.from(authored.keys());
  for (const p of promotions) {
    if (!kgMatches(opts.query, p.finding, (findings.get(p.finding) || {}).claim, p.author)) continue;
    for (const id of [p.source, p.destination, p.promotedBy]) {
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
  // Findings sit in their author's tier row, shared first by promotion
  // count then unshared by id. Rows wrap to the container width; the
  // surface grows vertically at orchestra scale.
  const tierOf = new Map();
  for (const id of actors) {
    const d = depthOf(id);
    if (!tierOf.has(d)) tierOf.set(d, []);
    tierOf.get(d).push(id);
  }
  const depths = [...tierOf.keys()]
    .sort((a, b) => (a === -1 ? 1 : b === -1 ? -1 : a - b));
  const tierName = (d) => {
    if (d === -1) return "unplaced actors";
    const words = [];
    for (const r of Object.keys(KG_ROLE_WORDS)) {
      if (tierOf.get(d).some((id) => roleOf(id) === r)) words.push(KG_ROLE_WORDS[r]);
    }
    for (const id of tierOf.get(d)) {
      const r = roleOf(id);
      if (r && !KG_ROLE_WORDS[r] && words.indexOf(r) === -1) words.push(r);
    }
    return words.join(" · ") || "tier " + d;
  };
  const byAuthor = new Map();
  const fileFinding = (f) => {
    const author = String((f && f.author) || "unknown");
    if (!byAuthor.has(author)) byAuthor.set(author, []);
    byAuthor.get(author).push(f);
  };
  for (const f of shared) fileFinding(f);
  for (const f of unshared) fileFinding(f);
  // The surface fits its container instead of scrolling sideways at a fixed
  // width; a hidden container reports no width and keeps the fixed fallback.
  const width = Math.max(480, container.clientWidth || KG_WIDTH);
  const actorPerRow = Math.max(1,
    Math.floor((width - KG_GUTTER - KG_PAD) / KG_ACTOR_SLOT));
  const findPerRow = Math.max(1,
    Math.floor((width - KG_GUTTER - KG_PAD - 8) / KG_FIND_SLOT));
  const tierPlan = depths.map((d) => {
    const members = tierOf.get(d);
    const items = [];
    for (const id of members) {
      const group = byAuthor.get(id);
      if (group) items.push(...group);
    }
    const actorRows = Math.max(1, Math.ceil(members.length / actorPerRow));
    const findRows = Math.ceil(items.length / findPerRow);
    return {
      d, members, items, actorRows, findRows,
      height: 44 + actorRows * KG_ANCHOR_PITCH_Y
        + (items.length ? 12 + findRows * KG_FIND_PITCH_Y : 0) + 18,
    };
  });
  let height = KG_TOP;
  for (const t of tierPlan) {
    t.y = height;
    height += t.height;
  }
  height += KG_PAD;

  const controls = kgEl(null, "div", {
    class: "kg-controls", role: "group", "aria-label": "Relation isolation",
  }, container);
  const controlKinds = [
    [null, "All relations"],
    ["authorship", "Authorship"],
    ["share", "Share"],
    ["deliver", "Deliver"],
    ["promote", "Promoter"],
  ];
  for (const [kind, label] of controlKinds) {
    const b = kgEl(null, "button", {
      type: "button",
      "data-kg-control": kind || "all",
      "aria-pressed": view.kind === kind ? "true" : "false",
    }, controls);
    b.textContent = label;
    b.addEventListener("click", () => {
      view.kind = kind;
      kgRerender(container);
    });
  }

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
  marker("kg-arrow-author", "var(--muted)");
  marker("kg-arrow-promote", "var(--ink)");
  const edgeLayer = kgEl("svg", "g", { class: "kg-edges" }, svg);

  const roleFrag = (id) => String(roleOf(id)).toLowerCase().replace(/[^a-z-]/g, "") || "unknown";
  const actorPos = new Map();
  for (const t of tierPlan) {
    kgText(svg, tierName(t.d), {
      x: String(KG_PAD), y: String(t.y + 4), class: "kg-label kg-tier-label",
    }, "start");
    t.members.forEach((id, i) => {
      const x = KG_GUTTER + (i % actorPerRow) * KG_ACTOR_SLOT + KG_ACTOR_SLOT / 2;
      const y = t.y + 34 + Math.floor(i / actorPerRow) * KG_ANCHOR_PITCH_Y;
      actorPos.set(id, { x, y });
      const n = String(id).length > 18 ? String(id).slice(0, 17) + "…" : String(id);
      const role = roleFrag(id);
      const anchor = kgEl("svg", "g", {
        class: "kg-anchor",
        tabindex: "0",
        role: "button",
        "aria-label": String(id),
        "data-kg-id": String(id),
      }, svg);
      const toggleActor = () => {
        const cur = view.focus;
        view.focus = (cur && cur.type === "actor" && cur.id === id)
          ? null
          : { type: "actor", id };
        kgRerender(container);
        const again = container.querySelector(
          '.kg-anchor[data-kg-id="' + CSS.escape(String(id)) + '"]');
        if (again && typeof again.focus === "function") again.focus();
      };
      const clearActor = () => {
        if (!view.focus) return;
        view.focus = null;
        kgRerender(container);
        const again = container.querySelector(
          '.kg-anchor[data-kg-id="' + CSS.escape(String(id)) + '"]');
        if (again && typeof again.focus === "function") again.focus();
      };
      anchor.addEventListener("click", toggleActor);
      anchor.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          if (ev.preventDefault) ev.preventDefault();
          toggleActor();
        } else if (ev.key === "Escape") {
          clearActor();
        }
      });
      // Conductors carry a larger square; every other anchor stays small.
      const s = (role === "principal-conductor" || role === "associate-conductor") ? 10 : 8;
      // The last label of each row runs left so it stays inside the surface.
      const lastCol = (i % actorPerRow) === actorPerRow - 1 || i === t.members.length - 1;
      kgEl("svg", "rect", {
        x: String(x - s / 2), y: String(y - s / 2),
        width: String(s), height: String(s),
        class: "kg-actor role-" + role,
      }, anchor);
      const heading = kgEl("svg", "title", {}, anchor);
      heading.textContent = String(id) + (roleOf(id) ? ", " + String(roleOf(id)) : "");
      kgText(anchor, n, {
        x: String(x + (lastCol ? -s / 2 - 6 : s / 2 + 6)),
        y: String(y + 4),
        class: "kg-label mono",
      }, lastCol ? "end" : "start");
    });
  }

  const findingPos = new Map();
  // One label per node would overlap its neighbors at orchestra scale, so
  // only the selected node carries a claim label. Every other node shows
  // its claim words while focused or hovered.
  const nodeLabel = (g, f, x, y, hover) => {
    const words = String(f.claim || f.id);
    const label = words.length > 26 ? words.slice(0, 25) + "…" : words;
    kgText(g, label, {
      x: String(x),
      y: String(y + 21),
      class: "kg-label" + (hover ? " kg-hover" : ""),
    }, "middle");
  };
  const placeFinding = (f, x, y) => {
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
    heading.textContent = String(f.claim || f.id)
      + (f.evidence ? " — " + String(f.evidence) : "");
    // Circle size follows promotion count within a small range.
    const r = 5 + Math.min(3, promoCount.get(f.id) || 0);
    kgEl("svg", "circle", {
      cx: String(x), cy: String(y), r: String(r),
      class: "kg-finding" + (sharedIds.has(f.id) ? "" : " unshared"),
    }, g);
    if (selected) nodeLabel(g, f, x, y, false);
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
    // Neighbour focus follows the app selection: the same activation that
    // opens the record focuses the finding, and toggling the record off
    // clears the focus.
    const activate = () => {
      const cur = view.focus;
      view.focus = (cur && cur.type === "finding" && cur.id === f.id)
        ? null
        : { type: "finding", id: f.id };
      if (typeof opts.onSelect === "function") opts.onSelect(f.id);
      else kgRerender(container);
    };
    g.addEventListener("click", activate);
    g.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        if (ev.preventDefault) ev.preventDefault();
        activate();
      } else if (ev.key === "Escape" && view.focus) {
        view.focus = null;
        kgRerender(container);
        const again = container.querySelector(
          '.knode[aria-label="' + CSS.escape(String(f.id)) + '"]');
        if (again && typeof again.focus === "function") again.focus();
      }
    });
  };
  for (const t of tierPlan) {
    const findTop = t.y + 34 + t.actorRows * KG_ANCHOR_PITCH_Y + 12;
    t.items.forEach((f, j) => {
      placeFinding(f,
        KG_GUTTER + (j % findPerRow) * KG_FIND_SLOT + KG_FIND_SLOT / 2,
        findTop + Math.floor(j / findPerRow) * KG_FIND_PITCH_Y);
    });
  }
  // Neighbour focus tracks the selected record: when selection moves to a
  // different finding through the list or dossier, dimming follows it, and
  // toggling the record off clears the focus. Manual focus stands while
  // the selection is unchanged.
  if (view.lastSelected !== opts.selectedId) {
    view.lastSelected = opts.selectedId || null;
    view.focus = (opts.selectedId && findingPos.has(opts.selectedId))
      ? { type: "finding", id: opts.selectedId }
      : null;
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
        "data-kind": "share",
        "data-from": String(p.source),
        "data-to": String(p.finding),
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
        "data-kind": "deliver",
        "data-from": String(p.finding),
        "data-to": String(p.destination),
      }, edgeLayer);
      summary.edges += 1;
    }
    // The promoter edge appears only when the recorded promoter is a
    // different actor than the sharing source and the destination.
    const promoter = p.promotedBy ? String(p.promotedBy) : "";
    if (promoter && promoter !== String(p.source || "")
      && promoter !== String(p.destination || "") && actorPos.has(promoter)) {
      const from = actorPos.get(promoter);
      kgEl("svg", "line", {
        x1: String(from.x), y1: String(from.y + 6),
        x2: String(to.x), y2: String(to.y - 6),
        class: "kg-edge-promote",
        "marker-end": "url(#kg-arrow-promote)",
        "aria-label": "promoted by " + promoter,
        "data-kind": "promote",
        "data-from": promoter,
        "data-to": String(p.finding),
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
      "marker-end": "url(#kg-arrow-author)",
      "aria-label": "authored by " + author,
      "data-kind": "authorship",
      "data-from": author,
      "data-to": String(fid),
    }, edgeLayer);
    summary.edges += 1;
  }
  // Isolation dims every edge of another kind. Focus dims everything
  // outside the focused node and its recorded neighbours: for an actor,
  // its findings and the edges incident to the actor; for a finding,
  // its author, sharing source, destination, promoter, and its edges.
  // A focus pointing at filtered-out data clears instead of dimming
  // the whole surface.
  let focus = view.focus;
  if (focus && focus.type === "actor" && !actorPos.has(focus.id)) focus = null;
  if (focus && focus.type === "finding" && !findingPos.has(focus.id)) focus = null;
  view.focus = focus;
  const near = new Set();
  if (focus && focus.type === "actor") {
    near.add("a:" + focus.id);
    for (const [fid, finding] of findings) {
      if (!findingPos.has(fid)) continue;
      const author = finding.author ? String(finding.author) : "";
      const touched = author === focus.id || promotions.some((p) => p.finding === fid
        && (String(p.source || "") === focus.id
          || String(p.destination || "") === focus.id
          || String(p.promotedBy || "") === focus.id));
      if (touched) near.add("f:" + fid);
    }
  }
  if (focus && focus.type === "finding") {
    near.add("f:" + focus.id);
    const finding = findings.get(focus.id);
    if (finding) {
      const ids = [finding.author ? String(finding.author) : ""];
      for (const p of promotions) {
        if (p.finding !== focus.id) continue;
        for (const id of [p.source, p.destination, p.promotedBy]) {
          if (id) ids.push(String(id));
        }
      }
      for (const id of ids) {
        if (actorPos.has(id)) near.add("a:" + id);
      }
    }
  }
  for (const anchor of svg.querySelectorAll(".kg-anchor")) {
    const id = anchor.getAttribute("data-kg-id") || "";
    if (focus && !near.has("a:" + id)) anchor.classList.add("kg-dim");
  }
  for (const node of svg.querySelectorAll(".knode")) {
    const fid = node.getAttribute("aria-label") || "";
    if (focus && !near.has("f:" + fid)) node.classList.add("kg-dim");
  }
  for (const edge of edgeLayer.querySelectorAll("line")) {
    const kind = edge.getAttribute("data-kind") || "";
    const from = edge.getAttribute("data-from") || "";
    const to = edge.getAttribute("data-to") || "";
    let dim = view.kind != null && kind !== view.kind;
    if (!dim && focus) dim = from !== focus.id && to !== focus.id;
    if (dim) edge.classList.add("kg-dim");
  }
  kgSeenByMount.set(container, now);

  const legend = kgEl(null, "p", { class: "kg-legend muted" }, container);
  legend.textContent = "Actors sit in rows by recorded parent depth: dark squares "
    + "are conductors, blue is the operator, gray are players. "
    + "Circles are findings in their author row: filled are shared, open "
    + "are unshared, size follows promotion count. "
    + "Arrowheads mark direction: thin gray author to finding, ochre "
    + "sharing source to finding, gray finding to destination, dashed dark "
    + "promoter to finding when it differs from both. "
    + "Buttons isolate one kind; activating a node focuses its recorded "
    + "neighbours, again or Escape clears."
  if (activeControl) {
    const back = container.querySelector(
      '[data-kg-control="' + CSS.escape(activeControl) + '"]');
    if (back && typeof back.focus === "function") back.focus();
  }
  return summary;
}
