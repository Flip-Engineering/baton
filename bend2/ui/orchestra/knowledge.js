// Knowledge layer for the oversight document.
//
// One global entry, called by the document shell with a container,
// recorded data and options. The module never reads another module's
// DOM and never starts a request.
//
// renderKnowledge(container, data, opts):
//   data   { overview, ensembles } with overview.findings [{id,
//          author, claim, evidence, limits, kind, evidenceMessage}],
//          overview.promotions [{finding, source, destination,
//          promotedBy}], overview.relations [{id, author, source,
//          relation, target}] with authored relation names and
//          finding:/message:/external endpoints: node ends meet
//          their node, reference ends meet a tag at the edge's end,
//          dashed when the overview holds no record for it.
//          overview.actors {id: {role, parent}}, and ensembles
//          [{id, owner, coupling, members}] for the whole canvas.
//   opts   { mode, authorIds, selectedId, selectedActorId, query,
//          notice, onSelectFinding, onSelectActor }.
//          selectedId is the shell's finding selection; selectedActorId
//          is the shell's actor selection. The shell clears the finding
//          when an actor is chosen, so the map reads the finding first
//          and the actor as the fallback.
//          mode "band" attaches compact finding rows to the given
//          authors inside their band; mode "whole" draws the
//          whole-orchestra canvas for the collapsed on-demand band.
//          The query dims non-matches in place without re-laying out.
(function () {
  "use strict";

  var KW_SVG_NS = "http://www.w3.org/2000/svg";

  function kwEl(parent, tag, attrs, text) {
    var el = document.createElement(tag);
    if (attrs) {
      for (const key of Object.keys(attrs)) el.setAttribute(key, attrs[key]);
    }
    if (text !== undefined && text !== null) el.textContent = text;
    if (parent) parent.appendChild(el);
    return el;
  }

  function kwSvg(parent, tag, attrs) {
    var el = document.createElementNS(KW_SVG_NS, tag);
    if (attrs) {
      for (const key of Object.keys(attrs)) el.setAttribute(key, attrs[key]);
    }
    if (parent) parent.appendChild(el);
    return el;
  }

  function kwMatches(query, id, claim, author) {
    if (!query) return true;
    const q = String(query).toLowerCase();
    return String(id || "").toLowerCase().includes(q)
      || String(claim || "").toLowerCase().includes(q)
      || String(author || "").toLowerCase().includes(q);
  }

  function kwDepthOf(meta, roles, id) {
    const roleOf = (v) => (meta[v] && meta[v].role) || roles[v] || "";
    if (!roleOf(id)) return -1;
    const chain = new Set();
    let cur = id, d = 0;
    for (;;) {
      if (chain.has(cur)) return -1;
      chain.add(cur);
      const entry = meta[cur];
      const p = entry ? entry.parent : undefined;
      if (p === null || p === undefined) return -1;
      if (p === "") return d;
      cur = p;
      d += 1;
    }
  }

  // First sight marks a node new so arrivals surface visually; the
  // mark is presentation only and never filters. The roster rebuilds
  // row containers on every render, so sight is tracked by finding id
  // rather than by container.
  var kwSeenIds = new Set();

  // Row arrival state, keyed by actor id: the last recorded read and how
  // many renders the arrival dot has left. The shell renders twice per
  // commit on the update path, so a single-render dot would vanish
  // before any reader sees it; two renders survive the pair.
  var kwRowSeen = new Map();

  function kwMarkNew(g, id) {
    if (kwSeenIds.has(id)) return;
    kwSeenIds.add(id);
    g.classList.add("kw-new");
  }

  // Band mode: one compact line per author inside the row. The holding
  // halo and the slur in the row gutter carry the graphic; this line
  // carries at most a compact count with the top shared claim elided on
  // the same line. Full claim, evidence and limits live in the record.
  function kwRenderBand(container, overview, promotions, opts) {
    kwRefMarks = new Map();
    kwRefsDrawn = 0;
    const authors = (opts && opts.authorIds) || [];
    const wrap = kwEl(container, "div", { class: "kw-band" });
    for (const author of authors) {
      const own = (overview.findings || []).filter(
        (f) => String(f.author || "") === String(author));
      let received = 0;
      const seenReceived = new Set();
      for (const p of promotions) {
        if (String(p.destination || "") !== String(author)) continue;
        const f = (overview.findings || []).find(
          (cand) => cand.id === p.finding);
        if (f && String(f.author || "") !== String(author)
          && !seenReceived.has(f.id)) {
          seenReceived.add(f.id);
          received += 1;
        }
      }
      if (!own.length && !received) continue;
      let shared = 0;
      let top = null;
      let topDegree = 0;
      for (const f of own) {
        const degree = promotions.filter((p) => p.finding === f.id).length;
        if (degree > 0) shared += 1;
        if (degree > topDegree || (top === null && degree === topDegree)) {
          topDegree = degree;
          top = f;
        }
      }
      const line = kwEl(wrap, "p", {
        class: "kw-compact muted",
        "data-kw-author": String(author),
      });
      let text = own.length + (own.length === 1 ? " finding" : " findings")
        + " · " + shared + " shared";
      if (received) text += " · " + received + " received";
      if (top && topDegree > 0) {
        const claim = String(top.claim || top.id);
        text += " — " + (claim.length > 60 ? claim.slice(0, 59) + "…" : claim);
      }
      line.textContent = text;
    }
  }

  // Whole mode: the whole-orchestra canvas for the collapsed on-demand
  // band. Actors sit in rows by recorded parent depth; findings sit in
  // their author's row, shared first by promotion count. All four
  // recorded relation kinds draw directed with arrowheads. The canvas
  // fits its container width and grows vertically.
  var KW_GUTTER = 170;
  var KW_ACTOR_SLOT = 150;
  var KW_FIND_SLOT = 32;
  var KW_TOP = 44;
  var KW_PAD = 20;
  // Authors with more findings than this collapse to one count badge
  // that expands on focus, so one prolific author cannot fan over the
  // tiers below. Expansion survives shell re-renders.
  var KW_CLUSTER_AT = 12;
  var kwExpandedAuthors = new Set();
  var kwCollapsedEnsembles = new Set();
  var kwLastRender = null;
  // The map view: hand-rolled pan and zoom held in the layer so they
  // survive shell re-renders. One whole canvas renders at a time.
  var kwView = { x: 0, y: 0, k: 1 };
  var kwNodePos = new Map();
  // The shell's live read per actor id ({status, notProgressing, owesWork,
  // owedTotal}), refreshed from the data payload on every whole render.
  var kwActorReads = {};
  // How many recorded semantic relations the current canvas draws.
  // The legend keys the relation kind only when this is not zero.
  var kwRelationsDrawn = 0;
  // Reference marks drawn this render, by endpoint string: relations
  // whose ends are messages or external evidence draw a tag there
  // instead of pretending the endpoint is an actor or a finding.
  var kwRefMarks = new Map();
  var kwRefsDrawn = 0;
  // Drawn text boxes this render: settling tags keep clear of them.
  var kwLabelBoxes = [];
  // Drawn node centres, drawing width, and hull boxes this render,
  // for card placement.
  var kwNodeXY = new Map();
  var kwLastWidth = 0;
  var kwHullBoxes = [];
  function kwFindingRef(ref) {
    const m = /^finding:(.+)$/.exec(String(ref || ""));
    return m ? m[1] : null;
  }
  // A relation endpoint resolves to a drawn finding, a drawn actor
  // anchor, or a reference tag. A finding the overview holds but the
  // canvas hides (a collapsed ensemble) resolves to nothing, like a
  // promotion end, rather than a false not-held mark.
  var KW_REF_FAMILIES = /^(message|task|report|turn|issue|pr|external):/;
  function kwResolveEnd(ref, findings, findingPos, actorPos) {
    const s = String(ref || "");
    if (!s) return null;
    const fid = kwFindingRef(s) || (findings.has(s) ? s : "");
    if (fid && findingPos.has(fid)) return { kind: "node", id: fid, ref: s };
    if (fid && findings.has(fid)) return { kind: "hidden", id: fid, ref: s };
    if (actorPos.has(s)) return { kind: "node", id: s, ref: s };
    const family = KW_REF_FAMILIES.exec(s);
    if (family) return { kind: "ref", id: s, ref: s, family: family[1] };
    if (kwFindingRef(s)) return { kind: "ref", id: s, ref: s, family: "finding" };
    return { kind: "ref", id: s, ref: s, family: "reference" };
  }
  // Tag family glyphs: diamond message, square external, ring finding, dot other.
  function kwRefGlyph(g, family, gx, gy) {
    if (family === "message") {
      kwSvg(g, "polygon", {
        points: gx + "," + (gy - 4) + " " + (gx + 4) + "," + gy
          + " " + gx + "," + (gy + 4) + " " + (gx - 4) + "," + gy,
        class: "kw-ref-glyph",
      });
    } else if (family === "external") {
      kwSvg(g, "rect", {
        x: String(gx - 3), y: String(gy - 3), width: "6", height: "6",
        class: "kw-ref-glyph",
      });
    } else if (family === "finding") {
      kwSvg(g, "circle", {
        cx: String(gx), cy: String(gy), r: "3.5",
        class: "kw-ref-glyph kw-ref-glyph-ring",
      });
    } else {
      kwSvg(g, "circle", {
        cx: String(gx), cy: String(gy), r: "2.5",
        class: "kw-ref-glyph",
      });
    }
  }
  // The retained message a finding cites as evidence, as the reference
  // string the graph draws. The route serves the joined record as an
  // object and older reads as a bare string; both spell the same id.
  function kwEvidenceRef(f) {
    const raw = f ? f.evidenceMessage : null;
    if (typeof raw === "string") {
      if (!raw) return "";
      return raw.indexOf("message:") === 0 ? raw : "message:" + raw;
    }
    if (raw && typeof raw === "object") {
      const id = raw.id || raw.reference || raw.messageId || raw.message || "";
      if (!id) return "";
      const s = String(id);
      return s.indexOf("message:") === 0 ? s : "message:" + s;
    }
    return "";
  }
  // The drawn extent of the current canvas: every placed node extends
  // it, and Fit frames it rather than the canvas. Tier rules and depth
  // labels are furniture at full width, so they stay out of it.
  var kwContentBBox = null;
  function kwTrackBox(x0, y0, x1, y1) {
    if (!kwContentBBox) kwContentBBox = { x0, y0, x1, y1 };
    else {
      if (x0 < kwContentBBox.x0) kwContentBBox.x0 = x0;
      if (y0 < kwContentBBox.y0) kwContentBBox.y0 = y0;
      if (x1 > kwContentBBox.x1) kwContentBBox.x1 = x1;
      if (y1 > kwContentBBox.y1) kwContentBBox.y1 = y1;
    }
  }
  var kwViewMoved = false;
  var kwSearchText = "";
  var kwSearchStatus = "";
  var kwZoomReadout = null;
  // Dismissal is presentation only: the shell keeps its selection while
  // the map returns to the overview. Any new selection clears it.
  var kwDismissed = null;
  var kwLastSelected = null;
  // A drag that pans the map must not also activate the node it
  // started on. Clicks consume the gesture; keydowns never pan.
  function kwConsumePan() {
    const moved = kwViewMoved;
    kwViewMoved = false;
    return moved;
  }

  // The node the shell has selected: its finding selection first, its
  // actor selection when no finding is selected. Band callers pass no
  // actor id, so bands keep reading the finding alone.
  function kwEffectiveSelected(opts) {
    if (!opts) return "";
    return opts.selectedId || opts.selectedActorId || "";
  }

  // CSS pixels per drawing unit along each axis: the canvas caps at
  // full element width with automatic height, so on narrow screens the
  // drawing renders smaller than its authored units. Every gesture and
  // every frame measurement converts through this ratio before touching
  // the view, which always speaks drawing units.
  function kwUnitScale(svg, rect) {
    const box = rect || svg.getBoundingClientRect();
    const w = Number(svg.getAttribute("width")) || 0;
    const h = Number(svg.getAttribute("height")) || 0;
    return {
      x: w && box.width ? box.width / w : 1,
      y: h && box.height ? box.height / h : 1,
    };
  }

  // The mount element persists across redraws while its graph is rebuilt,
  // so each render replaces that mount's key handler instead of adding
  // another; one current handler per mount, never a retained detached one.
  var kwKeyHandlers = new WeakMap();
  function kwWireKeyHandler(container, handler) {
    const old = kwKeyHandlers.get(container);
    if (old) container.removeEventListener("keydown", old);
    kwKeyHandlers.set(container, handler);
    container.addEventListener("keydown", handler);
  }

  function kwNodeId(g) {
    return g.getAttribute("data-kw-node")
      || g.getAttribute("data-kw-id") || g.getAttribute("data-kw-cluster") || "";
  }

  // Depth 1 lights the node and its direct relations; depth 2 adds
  // the neighbours of neighbours, which is the selection read.
  function kwIsolateSvg(svg, id, depth) {
    const layer = svg.querySelector("g.kw-edges");
    if (!layer) return;
    const near = new Set([id]);
    for (const edge of layer.children) {
      const from = edge.getAttribute("data-from") || "";
      const to = edge.getAttribute("data-to") || "";
      if (from === id || to === id) {
        near.add(from);
        near.add(to);
      }
    }
    const keep = new Set(near);
    if (depth === 2) {
      for (const edge of layer.children) {
        const from = edge.getAttribute("data-from") || "";
        const to = edge.getAttribute("data-to") || "";
        if (near.has(from) || near.has(to)) {
          keep.add(from);
          keep.add(to);
        }
      }
    }
    for (const g of svg.querySelectorAll("g.kw-anchor, g.knode, g.kw-cluster, g.kw-ref")) {
      g.classList.toggle("kw-hover-dim", !keep.has(kwNodeId(g)));
    }
    for (const edge of layer.children) {
      const from = edge.getAttribute("data-from") || "";
      const to = edge.getAttribute("data-to") || "";
      const lit = from === id || to === id
        || (depth === 2 && (near.has(from) || near.has(to)));
      edge.classList.toggle("kw-hover-dim", !lit);
    }
  }

  function kwRenderWhole(container, overview, promotions, opts, collapsed) {
    const meta = (opts && opts.actorMeta) || overview.actors || {};
    const roles = (opts && opts.roles) || {};
    const findings = new Map(
      (overview.findings || []).map((f) => [f.id, f]));
    const width = Math.max(480, container.clientWidth || 1640);
    const actorPerRow = Math.max(1, Math.floor(
      (width - KW_GUTTER - KW_PAD) / KW_ACTOR_SLOT));

    const authored = new Map();
    for (const f of overview.findings || []) {
      const author = String(f.author || "unknown");
      authored.set(author, (authored.get(author) || 0) + 1);
    }
    const actors = Array.from(authored.keys());
    for (const p of promotions) {
      for (const id of [p.source, p.destination, p.promotedBy]) {
        if (id && actors.indexOf(String(id)) === -1) {
          actors.push(String(id));
        }
      }
    }
    for (const r of overview.relations || []) {
      if (r.author && actors.indexOf(String(r.author)) === -1) actors.push(String(r.author));
    }
    const tierOf = new Map();
    for (const id of actors) tierOf.set(id, kwDepthOf(meta, roles, id));
    const depths = Array.from(new Set(tierOf.values()))
      .filter((d) => d >= 0).sort((a, b) => a - b);
    // Actors with missing role or parent metadata appear in the unknown tier.
    if ([...tierOf.values()].some((d) => d < 0)) depths.push(-1);
    const byAuthor = new Map();
    for (const f of overview.findings || []) {
      const author = String(f.author || "unknown");
      if (!byAuthor.has(author)) byAuthor.set(author, []);
      byAuthor.get(author).push(f);
    }
    const promoCount = new Map();
    for (const p of promotions) {
      promoCount.set(p.finding, (promoCount.get(p.finding) || 0) + 1);
    }
    const sharedIds = new Set(promoCount.keys());

    const tiers = depths.map((d) => {
      const members = actors.filter((id) => tierOf.get(id) === d
        && !(collapsed && collapsed.has(id)))
        .sort((a, b) => ((authored.get(b) || 0) - (authored.get(a) || 0))
          || (a < b ? -1 : 1));
      const selectedFinding = kwEffectiveSelected(opts);
      // Each member owns a column centred on its anchor: findings pack
      // with their author so the group reads as a group and authorship
      // edges stay short and near-vertical. Members spread evenly when
      // they fit one row; the slot pitch stays the minimum spacing and
      // large runs keep packing row by row.
      const spreadT = members.length <= actorPerRow;
      const colW = spreadT && members.length
        ? (width - KW_GUTTER - KW_PAD) / members.length : KW_ACTOR_SLOT;
      const findCap = Math.max(1, Math.floor(colW / KW_FIND_SLOT));
      const memberX = new Map();
      members.forEach((id, i) => {
        memberX.set(id, spreadT
          ? KW_GUTTER + (i + 0.5) * colW
          : KW_GUTTER + (i % actorPerRow) * KW_ACTOR_SLOT + 75);
      });
      const slots = [];
      let findRows = 0;
      for (const id of members) {
        const group = (byAuthor.get(id) || []).slice().sort((a, b) =>
          ((promoCount.get(b.id) || 0) - (promoCount.get(a.id) || 0))
          || String(a.id).localeCompare(String(b.id)));
        const holdsSelected = group.some((f) => f.id === selectedFinding);
        if (group.length > KW_CLUSTER_AT && !kwExpandedAuthors.has(id)
          && !holdsSelected) {
          slots.push({ cluster: id, items: group, author: id, k: 0, n: 1 });
          findRows = Math.max(findRows, 1);
        } else {
          group.forEach((f, k) => slots.push({ finding: f, author: id, k, n: group.length }));
          findRows = Math.max(findRows, Math.ceil(group.length / findCap));
        }
      }
      const actorRows = Math.max(1, Math.ceil(members.length / actorPerRow));
      return {
        d, members, slots, actorRows, findRows, memberX, findCap, spread: spreadT,
        height: 26 + actorRows * 30 + (slots.length ? 10 + findRows * 30 : 0) + 12,
      };
    });
    let height = KW_TOP;
    for (const t of tiers) {
      t.y = height;
      height += t.height;
    }
    height += KW_PAD;
    // An empty scope keeps room for its staff instead of collapsing.
    if (!tiers.length) height = 200;

    const svg = kwSvg(container, "svg", {
      viewBox: "0 0 " + width + " " + height,
      width: String(width),
      height: String(height),
      class: "kw-canvas",
      role: "img",
      // The scope is the shell's statement beside the map; the image
      // label names the surface without restating it, so it holds for
      // a retained actor's holdings as well as the whole orchestra.
      "aria-label": "Knowledge map",
    });
    const defs = kwSvg(svg, "defs", null);
    const markers = [
      ["kw-arrow-author", "thin gray author to finding",
        "var(--muted, #5b6478)", "line", ""],
      ["kw-arrow-share", "ochre sharing source to finding",
        "var(--attention, #a2611f)", "arc", ""],
      ["kw-arrow-deliver", "gray finding to destination",
        "var(--muted, #5b6478)", "arc", ""],
      ["kw-arrow-promote", "dashed dark promoter to finding",
        "var(--selection, #2a3e6b)", "arc", "3 2"],
    ];
    for (const [mid, label, fill] of markers) {
      const marker = kwSvg(defs, "marker", {
        id: mid, viewBox: "0 0 8 8", refX: "7", refY: "4",
        markerWidth: "7", markerHeight: "7", orient: "auto-start-reverse",
      });
      // Titles in defs concatenate in text reads of the mount, so each
      // entry carries its own separator.
      kwSvg(marker, "title", null).textContent = label + ". ";
      kwSvg(marker, "path", { d: "M0,0 L8,4 L0,8 Z", fill });
    }
    // The semantic-relation head lives outside the marker table: it keys
    // only when relations are actually drawn, never by default.
    const relate = kwSvg(defs, "marker", {
      id: "kw-arrow-relate", viewBox: "0 0 8 8", refX: "7", refY: "4",
      markerWidth: "6", markerHeight: "6", orient: "auto-start-reverse",
    });
    kwSvg(relate, "title", null).textContent = "recorded relation. ";
    kwSvg(relate, "path", { d: "M0,0 L8,4 L0,8 Z", fill: "var(--ink, #141a26)" });
    const edgeLayer = kwSvg(svg, "g", { class: "kw-edges" });
    const roleOf = (id) => (meta[id] && meta[id].role) || roles[id] || "";
    return { svg, edgeLayer, tiers, findings, actorPerRow, width, roleOf, markers, tierOf };
  }

  // One count badge where an author holds more findings than the
  // cluster threshold. Activating it expands the author's full fan in
  // place; activating again collapses. Focus moves into the result so
  // keyboard readers never lose their place.
  function kwClusterBadge(svg, slot, x, y, promotions, opts, query) {
    const author = slot.cluster;
    const items = slot.items;
    let shared = 0;
    for (const f of items) {
      shared += promotions.filter((p) => p.finding === f.id).length;
    }
    const g = kwSvg(svg, "g", {
      class: "kw-cluster",
      tabindex: "0", role: "button",
      "aria-label": items.length + " findings by " + author + ", activate to expand",
      "data-kw-cluster": String(author),
    });
    kwSvg(g, "rect", {
      x: String(x - 15), y: String(y - 10),
      width: "30", height: "20", rx: "10",
      class: "kw-cluster-box",
    });
    kwTrackBox(x - 15, y - 10, x + 15, y + 10);
    kwLabelBoxes.push({ x0: x - 15, y0: y - 10, x1: x + 15, y1: y + 10 });
    const count = kwSvg(g, "text", {
      x: String(x), y: String(y + 4),
      class: "kw-cluster-count", "text-anchor": "middle",
    });
    count.textContent = String(items.length);
    const tip = kwSvg(g, "title", null);
    tip.textContent = items.length + " findings, " + shared + " promotions — activate to expand. ";
    if (!items.some((f) => kwMatches(query, f.id, f.claim, f.author))) {
      g.classList.add("kw-dim");
    }
    const toggle = () => {
      if (kwConsumePan()) return;
      kwViewMoved = false;
      if (kwExpandedAuthors.has(author)) kwExpandedAuthors.delete(author);
      else kwExpandedAuthors.add(author);
      if (kwLastRender) {
        renderKnowledge(kwLastRender.container, kwLastRender.data, kwLastRender.opts);
        const mount = kwLastRender.container;
        const target = kwExpandedAuthors.has(author) && items.length
          ? mount.querySelector('[data-kw-node="' + CSS.escape(items[0].id) + '"]')
          : mount.querySelector('[data-kw-cluster="' + CSS.escape(String(author)) + '"]');
        if (target && typeof target.focus === "function") target.focus();
      }
      if (opts && typeof opts.onSelectActor === "function") opts.onSelectActor(author);
    };
    g.addEventListener("click", toggle);
    g.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        if (ev.preventDefault) ev.preventDefault();
        toggle();
      }
    });
  }

  // Convex hull (Andrew monotone chain) over padded points.
  function kwHullPath(points) {
    const pts = points.slice().sort((a, b) => (a.x - b.x) || (a.y - b.y));
    const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lower = [];
    for (const p of pts) {
      while (lower.length >= 2
        && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
      lower.push(p);
    }
    const upper = [];
    for (let i = pts.length - 1; i >= 0; i -= 1) {
      const p = pts[i];
      while (upper.length >= 2
        && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
      upper.push(p);
    }
    lower.pop();
    upper.pop();
    return lower.concat(upper);
  }

  // Ensemble hulls group the drawn seats of each recorded ensemble.
  // Activating a hull collapses its members out of the tiers into one
  // count lozenge; activating again restores them. The layer sits under
  // the drawing and never joins hover isolation.
  function kwEnsembleHulls(svg, edgeLayer, layout, ensembles) {
    const list = Array.isArray(ensembles) ? ensembles : [];
    if (!list.length) return;
    const actorPos = layout.actorPos;
    const tiers = layout.tiers || [];
    const tierOf = layout.tierOf || new Map();
    const layer = kwSvg(svg, "g", { class: "kw-hulls" });
    svg.insertBefore(layer, edgeLayer);
    const lozenges = new Map();
    for (const e of list) {
      const id = e && e.id ? String(e.id) : "";
      const members = e && Array.isArray(e.members)
        ? e.members.map((m) => String(m)) : [];
      if (!id || !members.length) continue;
      const toggle = () => {
        if (kwCollapsedEnsembles.has(id)) kwCollapsedEnsembles.delete(id);
        else kwCollapsedEnsembles.add(id);
        if (kwLastRender) {
          renderKnowledge(kwLastRender.container, kwLastRender.data, kwLastRender.opts);
          const next = kwLastRender.container.querySelector(
            '[data-kw-hull="' + CSS.escape(id) + '"]');
          if (next && typeof next.focus === "function") next.focus();
        }
      };
      const wire = (g) => {
        g.addEventListener("click", () => { if (kwConsumePan()) return; toggle(); });
        g.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter" || ev.key === " ") {
            if (ev.preventDefault) ev.preventDefault();
            kwViewMoved = false;
            toggle();
          }
        });
      };
      if (kwCollapsedEnsembles.has(id)) {
        const tier = tiers.find((t) => t.d === tierOf.get(members[0])) || tiers[0];
        if (!tier) continue;
        const n = lozenges.get(tier.d) || 0;
        lozenges.set(tier.d, n + 1);
        const x = KW_GUTTER + 75 + n * 112;
        const y = tier.y + 26;
        const g = kwSvg(layer, "g", {
          class: "kw-lozenge",
          tabindex: "0", role: "button",
          "aria-label": "ensemble " + id + ", " + members.length + " seats, activate to expand",
          "data-kw-hull": id,
        });
        const boxW = Math.max(80, String(id).length * 6.4 + 36);
        kwSvg(g, "rect", {
          x: String(x - boxW / 2), y: String(y - 11),
          width: String(boxW), height: "22", rx: "11",
          class: "kw-lozenge-box",
        });
        kwTrackBox(x - boxW / 2, y - 11, x + boxW / 2, y + 11);
        kwLabelBoxes.push({ x0: x - boxW / 2, y0: y - 11, x1: x + boxW / 2, y1: y + 11 });
        kwHullBoxes.push({ x0: x - boxW / 2, y0: y - 11, x1: x + boxW / 2, y1: y + 11 });
        const label = kwSvg(g, "text", {
          x: String(x), y: String(y + 4),
          class: "kw-lozenge-label", "text-anchor": "middle",
        });
        const lname = kwSvg(label, "tspan", { class: "kw-lozenge-name" });
        lname.textContent = String(id) + " ";
        const lcount = kwSvg(label, "tspan", { class: "kw-lozenge-count" });
        lcount.textContent = String(members.length);
        wire(g);
        continue;
      }
      const pts = [];
      for (const m of members) {
        if (actorPos.has(m)) pts.push(actorPos.get(m));
      }
      if (pts.length < 2) continue;
      const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
      const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
      const padded = pts.map((p) => {
        const dx = p.x - cx;
        const dy = p.y - cy;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        return { x: p.x + dx / len * 24, y: p.y + dy / len * 24 };
      });
      const hull = kwHullPath(padded);
      const d = "M" + hull.map((p) => p.x + "," + p.y).join(" L") + " Z";
      const top = hull.reduce((a, b) => (a.y < b.y ? a : b));
      const g = kwSvg(layer, "g", {
        class: "kw-hull",
        tabindex: "0", role: "button",
        "aria-label": "ensemble " + id + ", " + members.length + " seats, activate to collapse",
        "data-kw-hull": id,
      });
      kwSvg(g, "path", { d, class: "kw-hull-line" });
      const label = kwSvg(g, "text", {
        x: String(top.x), y: String(top.y - 6),
        class: "kw-hull-label", "text-anchor": "middle",
      });
      label.textContent = id + " (" + members.length + ")";
      const hlw = (String(id).length + 5) * 9 + 8;
      kwTrackBox(top.x - hlw / 2, top.y - 20, top.x + hlw / 2, top.y);
      kwLabelBoxes.push({ x0: top.x - hlw / 2, y0: top.y - 20, x1: top.x + hlw / 2, y1: top.y });
      // Each hull records its box: member span plus the label above it.
      const hb = {
        x0: top.x - hlw / 2, y0: top.y - 20,
        x1: top.x + hlw / 2, y1: top.y,
      };
      for (const p of padded) {
        if (p.x - 6 < hb.x0) hb.x0 = p.x - 6;
        if (p.x + 6 > hb.x1) hb.x1 = p.x + 6;
        if (p.y + 6 > hb.y1) hb.y1 = p.y + 6;
      }
      kwHullBoxes.push(hb);
      wire(g);
    }
  }

  // A slot's centre within its author's column: centred in its own
  // row of the column, so a lone finding sits exactly under its author
  // and a full fan wraps to further rows inside the same column.
  function kwSlotXY(t, slot) {
    const cx = t.memberX.get(slot.author);
    const cap = t.findCap;
    const r = Math.floor(slot.k / cap);
    const inRow = Math.min(cap, slot.n - r * cap);
    return {
      x: cx + ((slot.k % cap) - (inRow - 1) / 2) * KW_FIND_SLOT,
      row: r,
    };
  }

  function kwPlaceWhole(layout, container, overview, promotions, opts, ensembles) {
    const { svg, edgeLayer, tiers } = layout;
    kwContentBBox = null;
    kwRelationsDrawn = 0;
    kwRefMarks = new Map();
    kwRefsDrawn = 0;
    kwLabelBoxes = [];
    kwNodeXY = new Map();
    kwHullBoxes = [];
    kwLastWidth = layout.width || 0;
    const actorPos = new Map();
    const findingPos = new Map();
    const query = opts && opts.query;
    // An empty scope draws one ruled staff with its state, so the
    // frame reads deliberate rather than broken.
    if (!tiers.length) {
      for (let line = 0; line < 5; line += 1) {
        kwSvg(svg, "line", {
          x1: String(KW_PAD), y1: String(82 + line * 9),
          x2: String(layout.width - KW_PAD), y2: String(82 + line * 9),
          class: "kw-staff",
        });
      }
      const rest = kwSvg(svg, "text", {
        x: String(layout.width / 2), y: "150",
        class: "kw-empty", "text-anchor": "middle",
      });
      rest.textContent = "No records in this scope.";
      kwTrackBox(KW_PAD, 82, layout.width - KW_PAD, 150);
    }
    for (const t of tiers) {
      const depthWord = t.d < 0 ? "depth unknown" : "depth " + t.d;
      const label = kwSvg(svg, "text", {
        x: String(KW_PAD), y: String(t.y + 4), class: "kw-tier",
        "aria-label": depthWord,
      });
      if (t.d < 0) {
        label.textContent = depthWord;
      } else {
        const word = kwSvg(label, "tspan", { class: "kw-tier-word" });
        word.textContent = "depth ";
        const num = kwSvg(label, "tspan", { class: "kw-tier-num" });
        num.textContent = String(t.d);
      }
      kwSvg(svg, "line", {
        x1: String(KW_GUTTER), y1: String(t.y + 8),
        x2: String(layout.width - KW_PAD), y2: String(t.y + 8),
        class: "kw-tier-rule",
      });
      kwLabelBoxes.push({ x0: KW_PAD, y0: t.y - 8, x1: KW_PAD + 140, y1: t.y + 12 });
      const perRow = layout.actorPerRow;
      const nameRows = new Map();
      t.members.forEach((id, i) => {
        const row = t.spread ? 0 : Math.floor(i / perRow);
        const x = t.memberX.get(id);
        const y = t.y + 26 + row * 30;
        actorPos.set(String(id), { x, y });
        kwTrackBox(x - 12, y - 12, x + 20 + String(id).length * 8, y + 12);
        const role = layout.roleOf ? layout.roleOf(id) : "";
        const conductor = role === "principal-conductor" || role === "associate-conductor";
        const s = conductor ? 11 : 8;
        const g = kwSvg(svg, "g", {
          class: "kw-anchor",
          tabindex: "0", role: "button",
          "aria-label": String(id),
          "data-kw-id": String(id),
        });
        const read = kwActorReads[String(id)] || {};
        kwSvg(g, "rect", {
          x: String(x - s / 2), y: String(y - s / 2),
          width: String(s), height: String(s),
          class: "kw-actor" + (conductor ? " role-conductor"
            : role === "operator" ? " role-operator" : "")
            + (read.notProgressing === true ? " kw-not-progressing" : ""),
        });
        // Actor names thin like finding labels: members arrive ranked
        // by authored count, and a name that would overlap one already
        // placed on its row is skipped while the anchor still draws.
        const nw = String(id).length * 8 + 10;
        const nbox = [x + 10, x + 10 + nw];
        const nboxes = nameRows.get(row) || [];
        if (nbox[1] <= layout.width
          && !nboxes.some((b) => nbox[0] < b[1] && b[0] < nbox[1])) {
          nboxes.push(nbox);
          nameRows.set(row, nboxes);
          const name = kwSvg(g, "text", {
            x: String(x + 10), y: String(y + 4), class: "kw-name mono",
          });
          name.textContent = String(id);
          kwLabelBoxes.push({ x0: x + 10, y0: y - 8, x1: x + 10 + nw, y1: y + 8 });
        }
        if (!kwMatches(query, id, "", id)) g.classList.add("kw-dim");
        g.addEventListener("click", () => {
          if (kwConsumePan()) return;
          kwDismissed = null;
          kwPinCard(container, overview, promotions, opts, id);
          g.focus();
          kwIsolate(id, 2);
          if (opts && typeof opts.onSelectActor === "function") {
            opts.onSelectActor(id);
          }
        });
        g.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter" || ev.key === " ") {
            if (ev.preventDefault) ev.preventDefault();
            kwViewMoved = false;
            kwDismissed = null;
            kwPinCard(container, overview, promotions, opts, id);
            kwIsolate(id, 2);
            if (opts && typeof opts.onSelectActor === "function") {
              opts.onSelectActor(id);
            }
          }
        });
      });
      const findTop = t.y + 26 + t.actorRows * 30 + 10;
      // Each tier labels its most promoted findings so the canvas reads
      // words at a glance; every other node keeps its claim one gesture
      // away through hover, keyboard, or selection.
      const visibleFindings = [];
      for (const s of t.slots) {
        if (s.finding) visibleFindings.push(s.finding);
      }
      const labeled = new Set(visibleFindings
        .filter((f) => promotions.some((p) => p.finding === f.id))
        .map((f) => [promotions.filter((p) => p.finding === f.id).length, f.id])
        .sort((a, b) => (b[0] - a[0]) || String(a[1]).localeCompare(String(b[1])))
        .slice(0, 8)
        .map((entry) => entry[1]));
      // Crowding rule: labels place in rank order and a label that would
      // overlap one already placed on its row is skipped, so dense tiers
      // thin themselves instead of knotting. Rank order is deterministic,
      // so the same labels survive every render.
      const slotByFinding = new Map();
      for (const s of t.slots) {
        if (s.finding) slotByFinding.set(s.finding.id, s);
      }
      const labelShown = new Set();
      const placedRows = new Map();
      for (const fid of labeled) {
        const s = slotByFinding.get(fid);
        if (!s) continue;
        const at = kwSlotXY(t, s);
        const row = at.row;
        const x = at.x;
        const rec = layout.findings.get(fid);
        const words = String((rec && (rec.claim || rec.id)) || fid);
        const w = Math.min(27, words.length) * 7.5 + 10;
        const box = [x - w / 2, x + w / 2];
        const boxes = placedRows.get(row) || [];
        if (boxes.some((b) => box[0] < b[1] && b[0] < box[1])) continue;
        boxes.push(box);
        placedRows.set(row, boxes);
        labelShown.add(fid);
      }
      t.slots.forEach((slot) => {
        const at = kwSlotXY(t, slot);
        const x = at.x;
        const y = findTop + at.row * 30;
        if (slot.cluster) {
          kwClusterBadge(svg, slot, x, y, promotions, opts, query);
          return;
        }
        const f = slot.finding;
        findingPos.set(f.id, { x, y });
        // Mass reads the recorded share count: 4 unshared, 6 to 10 shared.
        const degree = promotions.filter((p) => p.finding === f.id).length;
        const mass = degree ? 6 + Math.min(4, Math.round(2 * Math.sqrt(degree - 1))) : 4;
        kwTrackBox(x - 15, y - 15, x + 15, y + 15);
        const selected = kwEffectiveSelected(opts) === f.id;
        const g = kwSvg(svg, "g", {
          class: "knode" + (degree ? "" : " unshared") + (selected ? " selected" : "")
            + " kw-kind-" + String(f.kind || "finding").toLowerCase().replace(/[^a-z0-9]+/g, "-"),
          tabindex: "0", role: "button",
          "aria-label": String(f.id),
          "data-kw-node": String(f.id),
        });
        kwMarkNew(g, f.id);
        kwSvg(g, "circle", {
          cx: String(x), cy: String(y), r: String(mass),
          class: "kw-finding" + (degree ? "" : " unshared"),
        });
        if (degree) {
          kwSvg(g, "circle", {
            cx: String(x), cy: String(y),
            r: String(mass + 4),
            class: "kw-halo",
          });
        }
        const heading = kwSvg(g, "title", null);
        heading.textContent = String(f.claim || f.id)
          + (f.evidence ? " — " + String(f.evidence) : "")
          + (f.limits ? " — " + String(f.limits) : "");
        if (selected || labelShown.has(f.id)) {
          kwNodeLabel(g, f, x, y);
          const lw = Math.min(27, String(f.claim || f.id).length) * 7.5 + 10;
          kwTrackBox(x - lw / 2, y + 10, x + lw / 2, y + 30);
          kwLabelBoxes.push({ x0: x - lw / 2, y0: y + 10, x1: x + lw / 2, y1: y + 30 });
        }
        if (!kwMatches(query, f.id, f.claim, f.author)) {
          g.classList.add("kw-dim");
        }
        g.addEventListener("click", () => {
          if (kwConsumePan()) return;
          kwDismissed = null;
          kwPinCard(container, overview, promotions, opts, f.id);
          g.focus();
          kwIsolate(f.id, 2);
          if (opts && typeof opts.onSelectFinding === "function") {
            opts.onSelectFinding(f.id);
          }
        });
        g.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter" || ev.key === " ") {
            if (ev.preventDefault) ev.preventDefault();
            kwViewMoved = false;
            kwDismissed = null;
            kwPinCard(container, overview, promotions, opts, f.id);
            kwIsolate(f.id, 2);
            if (opts && typeof opts.onSelectFinding === "function") {
              opts.onSelectFinding(f.id);
            }
          }
        });
      });
    }
    // Promotion relations draw as arcs bowed off the straight line so
    // movement reads apart from structure; authorship stays straight.
    const edge = (x1, y1, x2, y2, cls, marker, label, kind, from, to, arc) => {
      const attrs = {
        class: cls, "marker-end": "url(#" + marker + ")",
        "aria-label": label, "data-kind": kind,
        "data-from": String(from), "data-to": String(to),
      };
      if (arc) {
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2;
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const bow = Math.min(40, len * 0.12);
        attrs.d = "M" + x1 + "," + y1 + " Q" + (mx - dy / len * bow) + ","
          + (my + dx / len * bow) + " " + x2 + "," + y2;
        return kwSvg(edgeLayer, "path", attrs);
      }
      attrs.x1 = String(x1);
      attrs.y1 = String(y1);
      attrs.x2 = String(x2);
      attrs.y2 = String(y2);
      return kwSvg(edgeLayer, "line", attrs);
    };
    for (const p of promotions) {
      const to = findingPos.get(p.finding);
      if (!to) continue;
      if (p.source && actorPos.has(String(p.source))) {
        const from = actorPos.get(String(p.source));
        edge(from.x, from.y + 6, to.x, to.y - 6, "kw-edge-share",
          "kw-arrow-share", "promotion from " + p.source, "share",
          p.source, p.finding, true);
      }
      if (p.destination && actorPos.has(String(p.destination))) {
        const dest = actorPos.get(String(p.destination));
        edge(to.x, to.y + 6, dest.x, dest.y - 6, "kw-edge-deliver",
          "kw-arrow-deliver", "delivery to " + p.destination, "deliver",
          p.finding, p.destination, true);
      }
      const promoter = p.promotedBy ? String(p.promotedBy) : "";
      if (promoter && promoter !== String(p.source || "")
        && promoter !== String(p.destination || "") && actorPos.has(promoter)) {
        const from = actorPos.get(promoter);
        edge(from.x, from.y + 6, to.x, to.y - 6, "kw-edge-promote",
          "kw-arrow-promote", "promoted by " + promoter, "promote",
          promoter, p.finding, true);
      }
    }
    for (const [fid, finding] of layout.findings) {
      if (!findingPos.has(fid)) continue;
      const author = finding.author ? String(finding.author) : "";
      if (!author || !actorPos.has(author)) continue;
      const from = actorPos.get(author);
      const to = findingPos.get(fid);
      edge(from.x, from.y + 6, to.x, to.y - 6, "kw-edge-authorship",
        "kw-arrow-author", "authored by " + author, "authorship",
        author, fid);
    }
    // Hulls draw before relations so settling tags keep clear of their
    // labels; paint order is unchanged, the hull layer sits beneath the edges.
    layout.actorPos = actorPos;
    kwNodeXY = new Map([...actorPos, ...findingPos]);
    kwEnsembleHulls(svg, edgeLayer, layout, ensembles || []);
    // Draw recorded relations between nodes or labeled reference tags.
    // Relations between references are placed beside their author.
    const heldRefs = new Set();
    const refFollow = new Map();
    for (const f of layout.findings.values()) {
      // The joined evidenceMessage identifies a retained message. A bare
      // evidence reference can also name a message whose record is absent.
      const cited = kwEvidenceRef(f);
      if (cited) {
        heldRefs.add(cited);
        if (!refFollow.has(cited)) refFollow.set(cited, f.id);
      }
    }
    const nodePos = (end) => end.kind !== "node" ? null
      : (findingPos.get(end.id) || actorPos.get(end.id) || null);
    // Marks hug their node on a short stub, fanning round it so several
    // references on one record do not stack on one spot. Each node starts
    // the fan at its own angle so neighbouring fans do not pile one way.
    const fanAt = new Map();
    const fanAngles = [-90, -45, -135, 0, 180, -22, -158, 45, 135];
    const fanStart = (nodeId) => {
      let h = 0;
      for (const c of String(nodeId)) h = (h + c.charCodeAt(0)) % fanAngles.length;
      return h;
    };
    const kwRefSlot = (nodeId, at, end) => {
      let mark = kwRefMarks.get(end.ref);
      if (!mark) {
        const k = fanAt.get(nodeId) || 0;
        fanAt.set(nodeId, k + 1);
        // First four tags alternate near/far stubs (80/104); past four
        // the fan spirals to a 150 cap. Slots follow relation order.
        const rr = k < 4 ? 80 + (k % 2) * 24 : Math.min(150, 104 + (k - 3) * 14);
        const rad = fanAngles[(fanStart(nodeId) + k) % fanAngles.length] * Math.PI / 180;
        // A finding the overview holds draws as a node, so a finding
        // reference tag is never held. A message tag is held when some
        // finding cites it as evidence. Anything else is a pointer
        // outward, with no holding claim either way.
        const held = end.family === "finding" ? false
          : end.family === "message" ? heldRefs.has(end.ref)
          : true;
        const unheld = (end.family === "finding" || end.family === "message") && !held;
        const label = end.ref.length > 22 ? end.ref.slice(0, 21) + "…" : end.ref;
        const shown = unheld ? label + " · not held" : label;
        const w = shown.length * 7.5 + 14;
        // Slots start inside the canvas; the settle below only moves down,
        // and the canvas grows for what settles past its computed height.
        const x = Math.min(Math.max(at.x + rr * Math.cos(rad), w / 2 + 4),
          layout.width - w / 2 - 4);
        const y = Math.max(at.y + rr * Math.sin(rad), 14);
        mark = {
          x, y, w, shown, ref: end.ref, family: end.family, held, unheld,
          relations: [], follow: refFollow.get(end.ref) || "",
          anchorX: at.x, anchorY: at.y,
        };
        kwRefMarks.set(end.ref, mark);
      }
      return mark;
    };
    // Edges resolve first with no drawing, so the tags can settle before
    // anything paints. A reference end meets the tag the relation earns
    // it; the tag is shared when several relations cite one endpoint.
    const relateSpecs = [];
    for (const r of overview.relations || []) {
      const fromRef = r.source !== undefined && r.source !== null ? r.source : r.from;
      const toRef = r.target !== undefined && r.target !== null ? r.target : r.to;
      const a = kwResolveEnd(fromRef, layout.findings, findingPos, actorPos);
      const b = kwResolveEnd(toRef, layout.findings, findingPos, actorPos);
      if (!a || !b) continue;
      if (a.kind === "hidden" || b.kind === "hidden") continue;
      if (a.kind === "node" && b.kind === "node" && a.id === b.id) continue;
      const name = String(r.relation || r.name || r.id || "related");
      const needA = a.kind === "ref";
      const needB = b.kind === "ref";
      if (needA && needB) {
        const author = actorPos.get(r.author);
        if (!author) continue;
        const first = kwRefSlot(r.author, author, a);
        const second = kwRefSlot(r.author, author, b);
        first.relations.push({ name, other: b.ref });
        second.relations.push({ name, other: a.ref });
      } else {
        if (needA && !nodePos(b)) continue;
        if (needB && !nodePos(a)) continue;
        if (needA) kwRefSlot(b.id, nodePos(b), a).relations.push({ name, other: b.id });
        if (needB) kwRefSlot(a.id, nodePos(a), b).relations.push({ name, other: a.id });
      }
      // Node-to-node names draw at the edge midpoint; their box joins
      // the obstacles so settling tags keep clear of edge names too.
      const shown = a.kind === "node" && b.kind === "node"
        ? (name.length > 24 ? name.slice(0, 23) + "…" : name) : "";
      if (shown) {
        const pa = nodePos(a);
        const pb = nodePos(b);
        const mx = (pa.x + pb.x) / 2;
        const my = (pa.y + pb.y) / 2;
        kwLabelBoxes.push({ x0: mx - shown.length * 3.5 - 4, y0: my - 12,
          x1: mx + shown.length * 3.5 + 4, y1: my + 2 });
      }
      relateSpecs.push({ a, b, name, shown });
    }
    // Tags settle top-down past nodes, text and the tags above; a tag
    // keeps stepping until it clears, so settling never places overlap.
    const settled = [];
    for (const pos of actorPos.values()) {
      settled.push({ x0: pos.x - 18, y0: pos.y - 18, x1: pos.x + 18, y1: pos.y + 18 });
    }
    for (const pos of findingPos.values()) {
      settled.push({ x0: pos.x - 18, y0: pos.y - 18, x1: pos.x + 18, y1: pos.y + 18 });
    }
    for (const box of kwLabelBoxes) settled.push(box);
    const slotOrder = [...kwRefMarks.values()]
      .sort((p, q) => (p.y - q.y) || (p.x - q.x));
    for (const mark of slotOrder) {
      const hw = mark.w / 2 + 3;
      const hh = 9 + 3;
      while (settled.some((box) =>
          mark.x - hw < box.x1 && box.x0 < mark.x + hw
          && mark.y - hh < box.y1 && box.y0 < mark.y + hh)) {
        mark.y += 10;
      }
      settled.push({ x0: mark.x - hw, y0: mark.y - hh, x1: mark.x + hw, y1: mark.y + hh });
    }
    for (const mark of kwRefMarks.values()) {
      const g = kwSvg(svg, "g", {
        class: "kw-ref" + (mark.unheld ? " unheld" : ""),
        tabindex: "0", role: "button",
        "aria-label": "reference " + mark.ref
          + (mark.unheld ? ", not held" : mark.family === "finding" || mark.family === "message" ? ", held" : ""),
        "data-kw-node": mark.ref,
        "data-kw-ref": mark.ref,
      });
      kwSvg(g, "rect", {
        x: String(mark.x - mark.w / 2), y: String(mark.y - 9),
        width: String(mark.w), height: "18", rx: "4",
        class: "kw-ref-tag",
      });
      kwRefGlyph(g, mark.family, (mark.anchorX + mark.x) / 2, (mark.anchorY + mark.y) / 2);
      const word = kwSvg(g, "text", {
        x: String(mark.x), y: String(mark.y + 4), class: "kw-ref-word mono",
        "text-anchor": "middle",
      });
      word.textContent = mark.shown;
      const heading = kwSvg(g, "title", null);
      heading.textContent = mark.ref + (mark.unheld ? " — not held" : "");
      kwTrackBox(mark.x - mark.w / 2, mark.y - 9, mark.x + mark.w / 2, mark.y + 9);
      g.addEventListener("click", () => {
        if (kwConsumePan()) return;
        kwDismissed = null;
        kwPinCard(container, overview, promotions, opts, mark.ref);
        g.focus();
        kwIsolate(mark.ref, 2);
      });
      g.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          if (ev.preventDefault) ev.preventDefault();
          kwViewMoved = false;
          kwDismissed = null;
          kwPinCard(container, overview, promotions, opts, mark.ref);
          kwIsolate(mark.ref, 2);
        }
      });
      kwRefsDrawn += 1;
    }
    // Settled tags can hang below the tier-computed height; the canvas
    // grows to hold them instead of clipping.
    if (kwContentBBox) {
      const need = Math.ceil(kwContentBBox.y1 + 12);
      const have = Number(svg.getAttribute("height")) || 0;
      if (need > have) {
        svg.setAttribute("height", String(need));
        svg.setAttribute("viewBox", "0 0 " + svg.getAttribute("width") + " " + need);
      }
    }
    // Visible spans of a relate stub: stretches crossing a text box
    // drop out, so the stub keeps its direction with gaps at the text.
    const kwStubSpans = (x1, y1, x2, y2) => {
      const dx = x2 - x1;
      const dy = y2 - y1;
      const blocks = [];
      for (const box of kwLabelBoxes) {
        const pad = 3;
        const bx0 = box.x0 - pad;
        const bx1 = box.x1 + pad;
        const by0 = box.y0 - pad;
        const by1 = box.y1 + pad;
        // Endpoints inside a box are kept, so the stub stays attached.
        if ((x1 > bx0 && x1 < bx1 && y1 > by0 && y1 < by1)
          || (x2 > bx0 && x2 < bx1 && y2 > by0 && y2 < by1)) continue;
        let t0 = 0;
        let t1 = 1;
        let miss = false;
        if (Math.abs(dx) < 1e-9) {
          if (x1 <= bx0 || x1 >= bx1) miss = true;
        } else {
          let ta = (bx0 - x1) / dx;
          let tb = (bx1 - x1) / dx;
          if (ta > tb) { const tt = ta; ta = tb; tb = tt; }
          if (ta > t0) t0 = ta;
          if (tb < t1) t1 = tb;
        }
        if (Math.abs(dy) < 1e-9) {
          if (y1 <= by0 || y1 >= by1) miss = true;
        } else {
          let ta = (by0 - y1) / dy;
          let tb = (by1 - y1) / dy;
          if (ta > tb) { const tt = ta; ta = tb; tb = tt; }
          if (ta > t0) t0 = ta;
          if (tb < t1) t1 = tb;
        }
        const c0 = Math.max(0, Math.min(1, t0));
        const c1 = Math.max(0, Math.min(1, t1));
        if (!miss && c0 < c1) blocks.push([c0, c1]);
      }
      blocks.sort((a, b) => a[0] - b[0]);
      const spans = [];
      let cur = 0;
      for (let bi = 0; bi < blocks.length; bi += 1) {
        const b0 = blocks[bi][0];
        const b1 = blocks[bi][1];
        if (b0 > cur) spans.push([cur, b0]);
        if (b1 > cur) cur = b1;
        if (cur >= 1) break;
      }
      if (cur < 1) spans.push([cur, 1]);
      return spans;
    };
    const relateEnd = (end) => {
      if (end.kind === "node") return nodePos(end);
      const mark = kwRefMarks.get(end.ref);
      return mark ? { x: mark.x, y: mark.y } : null;
    };
    for (const spec of relateSpecs) {
      const a = spec.a;
      const b = spec.b;
      const name = spec.name;
      const shown = spec.shown;
      const from = relateEnd(a);
      const to = relateEnd(b);
      if (!from || !to) continue;
      const g = kwSvg(edgeLayer, "g", {
        class: "kw-edge-relate",
        "data-kind": "relation",
        "data-from": a.kind === "node" ? a.id : a.ref,
        "data-to": b.kind === "node" ? b.id : b.ref,
        "aria-label": "recorded relation '" + name + "' from "
          + (a.kind === "node" ? a.id : a.ref) + " to "
          + (b.kind === "node" ? b.id : b.ref),
      });
      // One drawn stroke per relation, in spans: blocked stretches drop
      // out where the stub would cross a text box. The arrowhead stays
      // on the final span.
      const spans = kwStubSpans(from.x, from.y, to.x, to.y);
      for (let si = 0; si < spans.length; si += 1) {
        const s0 = spans[si][0];
        const s1 = spans[si][1];
        const attrs = {
          x1: String(from.x + (to.x - from.x) * s0),
          y1: String(from.y + (to.y - from.y) * s0),
          x2: String(from.x + (to.x - from.x) * s1),
          y2: String(from.y + (to.y - from.y) * s1),
          stroke: "var(--ink, #141a26)", "stroke-width": "2",
          "stroke-linecap": "round", "stroke-dasharray": "0.5 3",
          opacity: "0.65",
        };
        if (si === spans.length - 1) attrs["marker-end"] = "url(#kw-arrow-relate)";
        kwSvg(g, "line", attrs);
      }
      const tip = kwSvg(g, "title", null);
      tip.textContent = "recorded relation '" + name + "'";
      // Node-to-node edges carry the authored name at the midpoint; a
      // stub to a tag is too short for a name, so the name lives in
      // the edge title and in the tag's card instead.
      if (shown) {
        const mx = (from.x + to.x) / 2;
        const my = (from.y + to.y) / 2;
        const tag = kwSvg(g, "text", {
          x: String(mx), y: String(my - 4), class: "kw-rel-name",
          "text-anchor": "middle",
        });
        tag.textContent = shown;
        if (shown !== name) {
          const nameTip = kwSvg(tag, "title", null);
          nameTip.textContent = name;
        }
        kwTrackBox(mx - shown.length * 3.5 - 4, my - 12,
          mx + shown.length * 3.5 + 4, my + 2);
      }
      kwTrackBox(Math.min(from.x, to.x), Math.min(from.y, to.y),
        Math.max(from.x, to.x), Math.max(from.y, to.y));
      kwRelationsDrawn += 1;
    }
    if (query) {
      for (const [ref, mark] of kwRefMarks) {
        const names = mark.relations.map((rel) => rel.name).join(" ");
        const g = svg.querySelector('g.kw-ref[data-kw-ref="' + CSS.escape(ref) + '"]');
        if (g && !kwMatches(query, ref, names, "")) g.classList.add("kw-dim");
      }
    }
    // Hover or keyboard focus isolates the anchor's recorded neighborhood:
    // the anchor, its connected anchors and findings, and their edges stay
    // lit while the rest of the canvas dims. A separate mark from the query
    // dimming so the two never fight; leaving restores the canvas.
    // Search reaches the same pass by canvas.
    const kwIsolate = (id, depth) => kwIsolateSvg(svg, id, depth);
    const kwClearIsolation = () => {
      for (const n of svg.querySelectorAll(".kw-hover-dim")) {
        n.classList.remove("kw-hover-dim");
      }
    };
    for (const g of svg.querySelectorAll("g.kw-anchor, g.knode, g.kw-cluster, g.kw-ref")) {
      g.addEventListener("mouseover", () => kwIsolate(kwNodeId(g)));
      g.addEventListener("mouseleave", kwClearIsolation);
      // The selected anchor keeps its two-hop read across re-renders;
      // every other focus reads one hop.
      g.addEventListener("focus", () => kwIsolate(kwNodeId(g),
        kwEffectiveSelected(opts) === kwNodeId(g) ? 2 : 1));
      g.addEventListener("blur", kwClearIsolation);
    }
    // A background click or Escape returns to the overview: the card
    // for this selection stays hidden until the selection changes, and
    // any isolation clears. Node clicks re-pin, so they clear first.
    const kwDismiss = () => {
      const current = kwEffectiveSelected(opts);
      if (current) kwDismissed = current;
      const card = container.querySelector(".kw-card");
      if (card) card.remove();
      kwClearIsolation();
    };
    svg.addEventListener("click", (ev) => {
      if (ev.target && typeof ev.target.closest === "function"
        && ev.target.closest("g")) return;
      if (kwConsumePan()) return;
      kwDismiss();
    });
    kwWireKeyHandler(container, (ev) => {
      if (ev.key === "Escape") {
        kwDismiss();
        ev.preventDefault();
        ev.stopPropagation();
      }
    });
    // The edge key is one row of edge samples from the same marker
    // table that draws the arrowheads, so it cannot drift from the
    // drawing. Each sample mirrors its edge's shape, ink, dash and head,
    // and the kind and relation names stand beside it: a legend is a
    // decoder, and the words are the vocabulary a reader has no other
    // way to learn.
    const keys = kwEl(container, "ul", { class: "kw-legend-keys muted" });
    const keyEntries = (layout.markers || []).slice();
    if (kwRelationsDrawn > 0) {
      keyEntries.push(["kw-arrow-relate", "dotted recorded relation",
        "var(--ink, #141a26)", "dots", ""]);
    }
    if (kwRefsDrawn > 0) {
      keyEntries.push(["", "tagged recorded reference, dashed when the record is not held",
        "var(--ink, #141a26)", "tag", ""]);
      keyEntries.push(["", "diamond message, square external, ring finding, dot other",
        "var(--ink, #141a26)", "glyphs", ""]);
    }
    for (const entry of keyEntries) {
      const item = kwEl(keys, "li", null);
      const sw = kwSvg(item, "svg", {
        class: "kw-legend-swatch", width: "26", height: "12", "aria-hidden": "true",
      });
      const paint = String(entry[2] || "currentcolor");
      const shape = String(entry[3] || "line");
      const dash = String(entry[4] || "");
      if (shape === "dots") {
        kwSvg(sw, "line", {
          x1: "4", y1: "9", x2: "22", y2: "3", stroke: paint, "stroke-width": "2",
          "stroke-linecap": "round", "stroke-dasharray": "0.5 3", opacity: "0.65",
          "marker-end": "url(#" + String(entry[0]) + ")",
        });
      } else if (shape === "tag") {
        kwSvg(sw, "rect", {
          x: "4", y: "2", width: "18", height: "8", rx: "2",
          fill: "none", stroke: paint, "stroke-width": "1.5",
          "stroke-dasharray": "2 2",
        });
      } else if (shape === "glyphs") {
        kwSvg(sw, "polygon", { points: "5,3 8,6 5,9 2,6", fill: paint });
        kwSvg(sw, "rect", { x: "10", y: "4", width: "4", height: "4", fill: paint });
        kwSvg(sw, "circle", {
          cx: "16", cy: "6", r: "2.5", fill: "none", stroke: paint, "stroke-width": "1",
        });
        kwSvg(sw, "circle", { cx: "22", cy: "6", r: "1.8", fill: paint });
      } else if (shape === "arc") {
        const arc = kwSvg(sw, "path", {
          d: "M3,10 Q13,-1 23,8", fill: "none", stroke: paint, "stroke-width": "1.5",
          "marker-end": "url(#" + String(entry[0]) + ")",
        });
        if (dash) arc.setAttribute("stroke-dasharray", dash);
      } else {
        kwSvg(sw, "line", {
          x1: "3", y1: "9", x2: "23", y2: "3", stroke: paint, "stroke-width": "1.5",
          "marker-end": "url(#" + String(entry[0]) + ")",
        });
      }
      const words = kwEl(item, "span", { class: "kw-legend-words" });
      words.textContent = String(entry[1]) + ". ";
    }
    // Pan and zoom wrap the whole drawing: every child but the marker
    // defs moves into one transform group, so placement code above draws
    // in canvas coordinates and the view reads from kwView.
    const view = kwSvg(svg, "g", { class: "kw-view" });
    for (const child of Array.from(svg.childNodes)) {
      if (child !== view && child.tagName !== "defs") view.appendChild(child);
    }
    kwApplyView(view);
    kwNodePos.clear();
    for (const [id, pos] of actorPos) kwNodePos.set(id, { x: pos.x, y: pos.y, kind: "actor" });
    for (const [id, pos] of findingPos) kwNodePos.set(id, { x: pos.x, y: pos.y, kind: "finding" });
    kwMapChrome(container, svg, view, overview, promotions, opts, ensembles || []);
    kwPinCard(container, overview, promotions, opts);
    // The selected neighborhood lights on every render, not only when
    // focus happens to be restored onto the map: choosing an actor moves
    // shell focus to its roster row, which would otherwise leave the map
    // dark. A dismissed selection stays an overview until it changes.
    const shown = kwEffectiveSelected(opts);
    if (shown && kwDismissed !== shown) kwIsolate(shown, 2);
  }

  function kwApplyView(view) {
    view.setAttribute("transform", "translate(" + kwView.x + "," + kwView.y + ") scale(" + kwView.k + ")");
    if (kwZoomReadout) kwZoomReadout.textContent = Math.round(kwView.k * 100) + "%";
  }

  // Convert the visible canvas/frame intersection to drawing units.
  function kwVisibleBox(container, svg) {
    const frame = container.parentElement;
    const drawing = svg.getBoundingClientRect();
    const clip = frame.getBoundingClientRect();
    const s = kwUnitScale(svg, drawing);
    const left = Math.max(drawing.left, clip.left + frame.clientLeft);
    const top = Math.max(drawing.top, clip.top + frame.clientTop);
    const right = Math.min(drawing.right, clip.left + frame.clientLeft + frame.clientWidth);
    const bottom = Math.min(drawing.bottom, clip.top + frame.clientTop + frame.clientHeight);
    return {
      w: (right - left) / s.x,
      h: (bottom - top) / s.y,
    };
  }

  // Centre the drawn content and scale it to fit the visible frame.
  function kwFitView(container, svg, view) {
    const box = kwVisibleBox(container, svg);
    const w = Number(svg.getAttribute("width")) || box.w;
    const h = Number(svg.getAttribute("height")) || box.h;
    const bb = kwContentBBox;
    const drawn = bb && bb.x1 > bb.x0 && bb.y1 > bb.y0;
    const bw = drawn ? (bb.x1 - bb.x0 + 32) : w;
    const bh = drawn ? (bb.y1 - bb.y0 + 32) : h;
    const cx = drawn ? (bb.x0 + bb.x1) / 2 : w / 2;
    const cy = drawn ? (bb.y0 + bb.y1) / 2 : h / 2;
    kwView.k = Math.min(4, box.w / bw, box.h / bh);
    kwView.x = box.w / 2 - cx * kwView.k;
    kwView.y = box.h / 2 - cy * kwView.k;
    kwApplyView(view);
  }

  function kwZoomAt(view, px, py, factor) {
    const k2 = Math.min(4, kwView.k * factor);
    if (k2 === kwView.k) return;
    kwView.x = px - (px - kwView.x) * (k2 / kwView.k);
    kwView.y = py - (py - kwView.y) * (k2 / kwView.k);
    kwView.k = k2;
    kwApplyView(view);
  }

  // Map furniture: zoom buttons with a level readout, a search box
  // that centres its hit, and drag-pan plus wheel-zoom on the canvas.
  // All state lives in kwView.
  function kwMapChrome(container, svg, view, overview, promotions, opts, ensembles) {
    const tools = kwEl(container, "div", { class: "kw-maptools" });
    const search = kwEl(tools, "input", {
      class: "kw-search mono",
      type: "search",
      placeholder: "Search the map…",
      "aria-label": "Search actors and findings on the map",
    });
    // The box is rebuilt every render; its text survives in the layer so
    // a commit under the reader's fingers does not eat the query. Only
    // Enter moves the view.
    search.value = kwSearchText;
    search.addEventListener("input", () => { kwSearchText = search.value; });
    search.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        kwSearchCentre(container, view, overview, search.value, opts, ensembles || []);
      }
    });
    const status = kwEl(tools, "p", {
      class: "kw-search-status muted",
      role: "status",
    });
    if (typeof kwSearchStatus === "number") kwRenderCount(status, kwSearchStatus);
    else status.textContent = kwSearchStatus;
    const mkBtn = (label, name, fn) => {
      const b = kwEl(tools, "button", { class: "kw-zoom mono", type: "button", "aria-label": name });
      b.textContent = label;
      b.addEventListener("click", fn);
      return b;
    };
    mkBtn("+", "Zoom the map in", () => {
      const box = kwVisibleBox(container, svg);
      kwZoomAt(view, box.w / 2, box.h / 2, 1.25);
    });
    mkBtn("−", "Zoom the map out", () => {
      const box = kwVisibleBox(container, svg);
      kwZoomAt(view, box.w / 2, box.h / 2, 1 / 1.25);
    });
    mkBtn("Fit", "Fit the map to the frame", () => kwFitView(container, svg, view));
    kwZoomReadout = kwEl(tools, "span", { class: "kw-zoom-level mono muted" });
    kwZoomReadout.textContent = Math.round(kwView.k * 100) + "%";
    svg.addEventListener("wheel", (ev) => {
      if (ev.preventDefault) ev.preventDefault();
      const rect = svg.getBoundingClientRect();
      const s = kwUnitScale(svg, rect);
      kwZoomAt(view, (ev.clientX - rect.left) / s.x, (ev.clientY - rect.top) / s.y,
        ev.deltaY < 0 ? 1.15 : 1 / 1.15);
    }, { passive: false });
    // Drag pans; the move and up listeners live on the document for the
    // life of the drag so a redraw under the pointer cannot strand them.
    // The click-versus-drag threshold reads raw screen pixels while the
    // pan itself converts to drawing units.
    svg.addEventListener("pointerdown", (ev) => {
      if (ev.button !== undefined && ev.button !== 0) return;
      kwViewMoved = false;
      const sx = ev.clientX;
      const sy = ev.clientY;
      const ox = kwView.x;
      const oy = kwView.y;
      const s = kwUnitScale(svg);
      const move = (mv) => {
        const dx = mv.clientX - sx;
        const dy = mv.clientY - sy;
        if (Math.abs(dx) + Math.abs(dy) > 4) kwViewMoved = true;
        kwView.x = ox + dx / s.x;
        kwView.y = oy + dy / s.y;
        kwApplyView(view);
      };
      const up = () => {
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", up);
        document.removeEventListener("pointercancel", up);
      };
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", up);
      document.addEventListener("pointercancel", up);
    });
  }

  // Search states how many records match, centres the first match and
  // pins its card before selecting it. A hit inside a collapsed cluster
  // or ensemble expands it first, whether the hit is a finding or an
  // actor; a hit with no drawn position says so instead of pretending.
  // An expansion re-renders the canvas, so the view node is re-acquired
  // after it rather than reused.
  // Separate the result count and label with a readable text separator.
  function kwRenderCount(status, total) {
    status.classList.add("has-count");
    status.textContent = "";
    const n = kwEl(status, "span", { class: "kw-search-count" });
    n.textContent = String(total);
    status.appendChild(document.createTextNode(" "));
    const w = kwEl(status, "span", { class: "kw-search-word" });
    w.textContent = total === 1 ? "match" : "matches";
  }

  function kwSearchCentre(container, view, overview, query, opts, ensembles) {
    const say = (text) => {
      kwSearchStatus = text;
      const status = container.querySelector(".kw-search-status");
      if (status) {
        status.classList.remove("has-count");
        status.textContent = text;
      }
    };
    const sayCount = (total) => {
      kwSearchStatus = total;
      const status = container.querySelector(".kw-search-status");
      if (status) kwRenderCount(status, total);
    };
    const q = String(query || "").trim().toLowerCase();
    if (!q) {
      say("");
      return;
    }
    const matches = (f) => String(f.id).toLowerCase().includes(q)
      || String(f.claim || "").toLowerCase().includes(q)
      || String(f.author || "").toLowerCase().includes(q);
    const findings = overview.findings || [];
    const hits = findings.filter(matches);
    const actors = Object.keys(overview.actors || {});
    const actorHits = actors.filter((id) => id.toLowerCase().includes(q));
    const total = hits.length + actorHits.length;
    if (!total) {
      say("No match for '" + String(query || "").trim() + "'");
      return;
    }
    sayCount(total);
    const hit = hits[0] || null;
    const actorHit = !hit ? actorHits[0] : null;
    const id = hit ? hit.id : actorHit;
    let live = view;
    const rerendered = () => {
      if (kwLastRender) {
        renderKnowledge(kwLastRender.container, kwLastRender.data, kwLastRender.opts);
        live = container.querySelector("g.kw-view") || view;
      }
    };
    if (hit) {
      const author = String(hit.author || "");
      const authored = findings.filter((f) => String(f.author || "") === author);
      if (authored.length > KW_CLUSTER_AT && !kwExpandedAuthors.has(author)
        && !kwNodePos.has(hit.id)) {
        kwExpandedAuthors.add(author);
        rerendered();
      }
      for (const e of (ensembles || [])) {
        const members = e && Array.isArray(e.members) ? e.members.map((m) => String(m)) : [];
        if (e && e.id && kwCollapsedEnsembles.has(String(e.id)) && members.indexOf(author) !== -1) {
          kwCollapsedEnsembles.delete(String(e.id));
          rerendered();
        }
      }
    }
    if (actorHit) {
      for (const e of (ensembles || [])) {
        const members = e && Array.isArray(e.members) ? e.members.map((m) => String(m)) : [];
        if (e && e.id && kwCollapsedEnsembles.has(String(e.id)) && members.indexOf(actorHit) !== -1) {
          kwCollapsedEnsembles.delete(String(e.id));
          rerendered();
        }
      }
    }
    const pos = kwNodePos.get(hit ? hit.id : id);
    if (!pos || !live) {
      say("'" + String(id) + "' is outside the drawn tiers");
      return;
    }
    const canvas = container.querySelector("svg.kw-canvas");
    const box = kwVisibleBox(container, canvas);
    kwView.k = Math.min(4, Math.max(kwView.k, 1.25));
    kwView.x = box.w / 2 - pos.x * kwView.k;
    kwView.y = box.h / 2 - pos.y * kwView.k;
    kwApplyView(live);
    // The card, isolation and focus land before the shell is told, so a
    // repeated hit whose selection the shell already holds still re-pins.
    kwDismissed = null;
    kwPinCard(container, overview, overview.promotions || [], opts, id);
    const node = container.querySelector('[data-kw-node="' + CSS.escape(id) + '"]')
      || container.querySelector('[data-kw-id="' + CSS.escape(id) + '"]');
    if (node && typeof node.focus === "function") node.focus();
    if (canvas) kwIsolateSvg(canvas, id, 2);
    if (hit && opts && typeof opts.onSelectFinding === "function") {
      opts.onSelectFinding(hit.id);
    } else if (actorHit && opts && typeof opts.onSelectActor === "function") {
      opts.onSelectActor(actorHit);
    }
  }

  // The pinned detail card: the current selection rendered on the map
  // itself, derived from the same opts every render so it follows the
  // shell instead of fighting it. Node gestures and search pin through
  // the same function with an explicit id before notifying the shell,
  // so the card stands even when the shell skips its re-render because
  // the selection did not change; a re-render rebuilds it either way.
  function kwPinCard(container, overview, promotions, opts, id) {
    const sel = id !== undefined ? id : kwEffectiveSelected(opts);
    if (!sel || kwDismissed === sel) return;
    const findings = overview.findings || [];
    const found = findings.find((f) => f.id === sel);
    const actors = overview.actors || {};
    const ref = kwRefMarks.get(sel);
    if (!found && !actors[sel] && !ref) return;
    const old = container.querySelector(".kw-card");
    if (old) old.remove();
    if (typeof getComputedStyle === "function"
      && getComputedStyle(container).position === "static") {
      container.style.position = "relative";
    }
    const card = kwEl(container, "div", { class: "kw-card" });
    if (found) {
      const degree = promotions.filter((p) => p.finding === found.id).length;
      kwEl(card, "p", { class: "kw-card-title" }, String(found.claim || found.id));
      kwEl(card, "p", { class: "kw-card-state" }, degree ? "shared" : "unshared");
      kwEl(card, "p", { class: "kw-card-fact" },
        degree + (degree === 1 ? " promotion" : " promotions")
        + " · by " + String(found.author || "unknown"));
      const refs = kwEl(card, "div", { class: "kw-card-refs" });
      const kind = String(found.kind || "");
      if (kind && kind !== "finding") {
        kwEl(refs, "p", { class: "kw-card-ref" }, "kind: " + kind);
      }
      const evidenceMessage = kwEvidenceRef(found);
      if (evidenceMessage) {
        kwEl(refs, "p", { class: "kw-card-ref mono" }, "evidence message: " + evidenceMessage);
      }
      // The card is an identity-and-state glance: live claims run to
      // thousands of characters, so bodies stay in the rail record and
      // the card states only that they are recorded.
      const bodies = [];
      if (found.evidence) bodies.push("evidence");
      if (found.limits) bodies.push("limits");
      if (bodies.length) kwEl(refs, "p", { class: "kw-card-ref" }, bodies.join(" + ") + " recorded");
      const step = promotions.find((p) => p.finding === found.id);
      if (step) {
        kwEl(refs, "p", { class: "kw-card-ref mono" },
          String(step.source || "?") + " → " + String(step.destination || "?")
          + (step.promotedBy ? " via " + String(step.promotedBy) : ""));
      }
      // The selection already rendered the complete claim, evidence and
      // limits in the rail; the button takes the reader there.
      const full = kwEl(card, "button", { class: "kw-card-full", type: "button" },
        "Read the full record");
      full.addEventListener("click", () => {
        const rail = document.getElementById("record");
        if (!rail) return;
        if (typeof rail.scrollIntoView === "function") rail.scrollIntoView({ block: "nearest" });
        if (typeof rail.focus === "function") rail.focus({ preventScroll: true });
      });
    } else if (actors[sel]) {
      const held = actors[sel] || {};
      const read = kwActorReads[sel] || {};
      const role = String(held.role || "");
      const kind = /conductor$/.test(role) ? "conductor"
        : (role === "player" ? "player" : "");
      const status = String(read.status || "");
      const lead = kwEl(card, "p", { class: "kw-card-lead" });
      kwEl(lead, "span", { class: "kw-card-title mono" }, String(sel));
      if (kind) {
        lead.appendChild(document.createTextNode(" "));
        kwEl(lead, "span", { class: "kw-card-state" }, kind);
      }
      if (status) {
        lead.appendChild(document.createTextNode(" "));
        kwEl(lead, "span", { class: "kw-card-status" }, status);
      }
      if (held.authored !== undefined || held.received !== undefined) {
        const owed = Number(read.owedTotal) > 0 ? String(read.owedTotal) + " owed"
          : (read.owesWork === true ? "owes work" : "");
        kwEl(card, "p", { class: "kw-card-fact" },
          (held.authored || 0) + " authored · " + (held.received || 0) + " received"
          + (owed ? " · " + owed : ""));
      }
      const refs = kwEl(card, "div", { class: "kw-card-refs" });
      // The lead line already states the kind, so the reference row keeps
      // the full role only when it says more, with the parent beside it.
      const bits = [];
      if (role && role !== kind) bits.push(role);
      if (held.parent) bits.push("parent " + held.parent);
      kwEl(refs, "p", { class: "kw-card-ref" }, bits.join(" · ") || "recorded actor");
    } else if (ref) {
      // A reference tag's card: the reference, whether the overview
      // holds its record, and the relations that cite it. A held
      // message follows to the finding that cites it as evidence.
      const state = ref.unheld ? "not held"
        : (ref.family === "finding" || ref.family === "message") ? "held"
        : "reference";
      const lead = kwEl(card, "p", { class: "kw-card-lead" });
      kwEl(lead, "span", { class: "kw-card-title mono" }, String(sel));
      lead.appendChild(document.createTextNode(" "));
      kwEl(lead, "span", { class: "kw-card-state" }, state);
      kwEl(card, "p", { class: "kw-card-fact" },
        String(ref.family) + " reference · " + ref.relations.length
        + (ref.relations.length === 1 ? " relation" : " relations"));
      const refs = kwEl(card, "div", { class: "kw-card-refs" });
      for (const rel of ref.relations) {
        const other = String(rel.other);
        const shown = other.length > 32 ? other.slice(0, 31) + "…" : other;
        kwEl(refs, "p", { class: "kw-card-ref mono" },
          String(rel.name) + " — " + shown);
      }
      if (ref.follow && opts && typeof opts.onSelectFinding === "function") {
        const show = kwEl(card, "button", { class: "kw-card-full", type: "button" },
          "Show the finding");
        show.addEventListener("click", () => { opts.onSelectFinding(ref.follow); });
      }
    }
    // The card opens on the side away from its node, and below any
    // hull it would cover. Hull boxes map through the view transform
    // into container pixels, the same mapping the nodes render through.
    const npos = kwNodeXY.get(sel) || kwRefMarks.get(sel) || null;
    const wide = kwLastWidth || container.clientWidth || 1;
    const nodeRight = !!npos && npos.x > wide / 2;
    card.classList.toggle("kw-card-left", nodeRight);
    const svg = container.querySelector("svg");
    if (svg) {
      const rect = svg.getBoundingClientRect();
      const base = container.getBoundingClientRect();
      const s = kwUnitScale(svg, rect);
      const toCardX = (x) => rect.left - base.left + (kwView.x + x * kwView.k) * s.x;
      const toCardY = (y) => rect.top - base.top + (kwView.y + y * kwView.k) * s.y;
      let cardTop = 8;
      for (let round = 0; round < 4; round += 1) {
        const cw = card.offsetWidth;
        const ch = card.offsetHeight;
        const cx0 = nodeRight ? 8 : Math.max(8, (container.clientWidth || wide) - cw - 8);
        let hit = -1;
        for (const hb of kwHullBoxes) {
          const hx0 = toCardX(hb.x0);
          const hx1 = toCardX(hb.x1);
          const hy0 = toCardY(hb.y0);
          const hy1 = toCardY(hb.y1);
          if (cx0 < hx1 && hx0 < cx0 + cw && cardTop < hy1 && hy0 < cardTop + ch) {
            if (hy1 + 8 > hit) hit = hy1 + 8;
          }
        }
        if (hit < 0 || hit <= cardTop) break;
        cardTop = hit;
      }
      card.style.top = String(cardTop) + "px";
    }
  }

  function kwNodeLabel(g, f, x, y) {
    const kind = String(f.kind || "");
    const evidenceMessage = kwEvidenceRef(f);
    const words = String(f.claim || f.id)
      + (kind && kind !== "finding" ? " · " + kind : "")
      + (evidenceMessage ? " · " + evidenceMessage : "");
    const label = words.length > 26 ? words.slice(0, 25) + "…" : words;
    const text = kwSvg(g, "text", {
      x: String(x), y: String(y + 21), class: "kw-word",
      "text-anchor": "middle",
    });
    text.textContent = label;
    if (label !== words) {
      const tip = kwSvg(text, "title", null);
      tip.textContent = words;
    }
  }

  function kwRestoreFocus(container, focused) {
    if (!focused) return;
    const node = container.querySelector(focused);
    if (node && typeof node.focus === "function") node.focus();
  }

  function renderKnowledge(container, data, opts) {
    if (!container) return null;
    const active = document.activeElement;
    let focused = null;
    if (active && container.contains(active)) {
      for (const name of ["data-kw-id", "data-kw-node"]) {
        if (active.hasAttribute(name)) focused = '[' + name + '="' + CSS.escape(active.getAttribute(name)) + '"]';
      }
    }
    container.textContent = "";
    const overview = (data && data.overview) || {};
    const promotions = overview.promotions || [];
    if (opts && opts.notice) {
      const p = kwEl(container, "p", { class: "muted" });
      p.textContent = opts.notice;
      return { findings: 0, promotions: 0 };
    }
    const mode = (opts && opts.mode) || "whole";
    if (!(overview.findings || []).length && !(overview.relations || []).length) {
      const p = kwEl(container, "p", { class: "muted" });
      p.textContent = (opts && opts.query)
        ? "No findings match." : "No recorded findings.";
      return { findings: 0, promotions: promotions.length };
    }
    if (mode === "band") {
      kwRenderBand(container, overview, promotions, opts);
      kwRestoreFocus(container, focused);
      return {
        findings: (overview.findings || []).length,
        promotions: promotions.length,
      };
    }
    kwLastRender = { container, data, opts };
    const current = kwEffectiveSelected(opts);
    if (current !== kwLastSelected) {
      kwLastSelected = current;
      kwDismissed = null;
    }
    const ensembles = (data && data.ensembles) || [];
    kwActorReads = (data && data.actorReads) || {};
    const collapsed = new Set();
    for (const e of ensembles) {
      if (e && e.id && kwCollapsedEnsembles.has(String(e.id))) {
        for (const m of (e.members || [])) collapsed.add(String(m));
      }
    }
    const layout = kwRenderWhole(container, overview, promotions, opts, collapsed);
    kwPlaceWhole(layout, container, overview, promotions, opts, ensembles);
    // The drawing's natural height, so the shell can size the frame to
    // the content instead of holding a tall empty box.
    container.setAttribute("data-kw-natural-height",
      String((layout.svg && layout.svg.getAttribute("height")) || ""));
    kwRestoreFocus(container, focused);
    return {
      findings: (overview.findings || []).length,
      promotions: promotions.length,
    };
  }

  // Roster overlay: one arc per recorded promotion joins the source
  // row to the destination row in the margin gutter, so sharing reads
  // at a glance in the default view. Rows that are not rendered take
  // no arc. The selection lights its own arcs.
  function renderArcs(mount, data) {
    if (!mount || typeof document === "undefined") return;
    const old = mount.querySelector(":scope > svg.kw-arcs");
    if (old) old.remove();
    const promotions = (data && data.promotions) || [];
    if (!promotions.length) return;
    if (typeof getComputedStyle === "function"
      && getComputedStyle(mount).position === "static") {
      mount.style.position = "relative";
    }
    const rows = mount.querySelectorAll(".doc-row[data-doc-id]");
    if (rows.length < 2) return;
    const mid = new Map();
    for (const row of rows) {
      mid.set(row.getAttribute("data-doc-id"),
        row.offsetTop + row.offsetHeight / 2);
    }
    const width = mount.scrollWidth || mount.clientWidth || 0;
    const height = mount.scrollHeight || mount.clientHeight || 0;
    if (!width || !height) return;
    const svg = kwSvg(mount, "svg", {
      class: "kw-arcs",
      width: String(width),
      height: String(height),
      viewBox: "0 0 " + width + " " + height,
      "aria-hidden": "true",
    });
    const selectedFinding = data.selectedFindingId || "";
    const selectedId = data.selectedId || "";
    const x = Math.max(0, width - 14);
    for (const p of promotions) {
      const from = p.source ? String(p.source) : "";
      const to = p.destination ? String(p.destination) : "";
      if (!from || !to || from === to) continue;
      if (!mid.has(from) || !mid.has(to)) continue;
      const y1 = mid.get(from);
      const y2 = mid.get(to);
      const hot = (selectedFinding && p.finding === selectedFinding)
        || (selectedId && (from === selectedId || to === selectedId));
      kwSvg(svg, "path", {
        d: "M" + x + "," + y1 + " Q" + (x + 16) + "," + ((y1 + y2) / 2)
          + " " + x + "," + y2,
        class: "kw-arc" + (hot ? " kw-arc-hot" : ""),
        "data-from": from,
        "data-to": to,
        "data-finding": p.finding ? String(p.finding) : "",
      });
    }
    // Row marks in the same overlay gutter: a holding halo where the seat
    // carries shared knowledge, sized by what it holds, and an arrival
    // dot where its recorded state or owed count changed. Only ids with
    // rows in the mount draw.
    const heldBy = (data && data.actors) || {};
    const seats = (data && data.players) || [];
    const sharing = new Set();
    for (const p of promotions) {
      if (p.source) sharing.add(String(p.source));
    }
    for (const seat of seats) {
      const id = seat && seat.id ? String(seat.id) : "";
      if (!id || !mid.has(id)) continue;
      const y = mid.get(id);
      const held = heldBy[id] || {};
      const total = (held.authored || 0) + (held.received || 0);
      if ((held.received || 0) > 0 || sharing.has(id)) {
        kwSvg(svg, "circle", {
          cx: String(x - 20), cy: String(y),
          r: String(4 + Math.min(3, total)),
          class: "kw-row-halo",
          "data-row": id,
        });
      }
      const owed = Math.max(seat.pendingCount || 0, seat.unacknowledgedCount || 0);
      const key = (seat.status || "") + "|" + owed + "|" + (seat.at || "");
      let seen = kwRowSeen.get(id);
      if (!seen) {
        seen = { key, left: 0 };
        kwRowSeen.set(id, seen);
      } else if (seen.key !== key) {
        seen.key = key;
        seen.left = 2;
      }
      if (seen.left > 0) {
        kwSvg(svg, "circle", {
          cx: String(x - 20), cy: String(y), r: "2.5",
          class: "kw-row-arrival kw-new",
          "data-row": id,
        });
        seen.left -= 1;
      }
    }
  }

  window.KnowledgeLayer = { renderKnowledge, renderArcs };
})();


