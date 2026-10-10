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
//          promotedBy}] with sourceKind/destinationKind (session or
//          group; absent means session), overview.relations [{id,
//          author, source, relation, target}] with authored relation
//          names and finding:/message:/external endpoints: node ends
//          meet their node, reference ends meet a tag at the edge's
//          end, dashed when the overview holds no record for it.
//          overview.actors {id: {role, parent}}, overview.groups
//          {id: {owner, coupling, received}}, overview.scope
//          {kind, id}, and ensembles [{id, owner, coupling,
//          members}] for the whole canvas. The typed contract adds
//          overview.nodes [{reference, kind, referenceOnly}] and
//          overview.edges [{id, source, target, sourceKind,
//          targetKind, relation, provenance}]: an authored edge is a
//          solid stroke with a filled head, a recorded-evidence edge
//          a dotted stroke with an open ring at the evidence, and the
//          recorded relation name lives in the edge's label and card.
//          A reference-only endpoint draws as a hollow ring, never a
//          node. A typed edge with two reference ends seats at its
//          recorded author's drawn position. Each semantic edge draws once: a typed edge wins
//          over the compatibility relation or evidence stub naming
//          the same ends, and a payload without typed edges draws
//          exactly today's map. Identity pairs kind and id:
//          sessions keep their bare id for the shell and the fixture,
//          while mixed maps, members, edges and lookups carry the kind
//          in its own slot, so a session sharing a group's literal id
//          still seats, edges, clusters, cards and focuses its own node.
//          opts.focusRelation (a recorded relation name, or "") lights
//          that relation's drawn edges and keeps its card.
//   opts   { mode, authorIds, selectedId, selectedActorId, query,
//          notice, onSelectFinding, onSelectActor, focusRelation }.
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

  // True when the shell's reads are present and report this actor
  // neither running nor pending. Absent reads dim nothing.
  function kwLiveDim(id) {
    const reads = kwActorReads || {};
    if (!Object.keys(reads).length) return false;
    const st = reads[id] ? reads[id].status : "";
    return st !== "running" && st !== "pending";
  }

  // The scope's group id, or "" outside a group scope. A group scope
  // lays its findings out without actor columns and seats the group
  // as its own node; other scopes seat only referenced groups.
  function kwScopeGroup(overview) {
    const scope = overview && overview.scope;
    return scope && scope.kind === "group" && scope.id ? String(scope.id) : "";
  }

  // Identity keys: kind and id travel as a pair the id cannot forge.
  // Sessions keep their bare id everywhere the shell or the fixture
  // addresses them; inside the layer's mixed maps the kind rides along
  // in its own slot, split on the first colon so ids containing colons
  // survive. Branches read the kind slot, never the id's text.
  function kwKey(kind, id) { return String(kind) + ":" + String(id); }
  function kwKeyKind(key) {
    const i = String(key).indexOf(":");
    return i < 0 ? "" : String(key).slice(0, i);
  }
  function kwKeyId(key) {
    const i = String(key).indexOf(":");
    return i < 0 ? String(key) : String(key).slice(i + 1);
  }

  // A typed edge's attribute id back to the bare id the nodes
  // carry: finding ends keep their finding: prefix in the
  // attributes, and every other kind passes through unchanged.
  function kwTypedLookupId(kind, id) {
    if (kind === "finding") return kwFindingRef(id) || id;
    return id;
  }

  // A shell selection resolves to its kind by recorded membership:
  // findings first, then sessions, then reference tags. Canvas picks
  // pass their kind outright and never resolve.
  function kwSelKind(overview, sel) {
    if (!sel) return "";
    if ((overview.findings || []).some((f) => f.id === sel)) return "finding";
    if ((overview.actors || {})[sel]) return "session";
    if (kwRefMarks.get(sel)) return "ref";
    return "";
  }

  // A group's naming line from its recorded metadata: id first, then
  // what the groups map holds. Absent metadata still names the id.
  function kwGroupWords(overview, gid) {
    const meta = ((overview && overview.groups) || {})[gid] || {};
    const bits = ["group " + gid];
    if (meta.owner) bits.push("owner " + meta.owner);
    if (meta.coupling) bits.push(String(meta.coupling));
    if (typeof meta.received === "number") bits.push(meta.received + " received");
    else if (Array.isArray(meta.received)) bits.push(meta.received.length + " received");
    return bits.join(", ");
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
        if (String(p.destinationKind || "session") === "group") continue;
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
  // Reference marks drawn this render, by endpoint string: relations
  // whose ends are messages or external evidence draw a tag there
  // instead of pretending the endpoint is an actor or a finding.
  var kwRefMarks = new Map();
  var kwRefsDrawn = 0;
  var kwEvidenceDrawn = 0;
  var kwTypedAuthored = 0;
  var kwTypedCited = 0;
  var kwTypedRings = 0;
  var kwTypedOutside = 0;
  // The walk: the last edges visited, latest last, each re-lightable
  // from its stored endpoints. The lit edge and the walk bar survive
  // shell re-renders; background click and Escape clear them with the
  // card. Direction thins the lit neighborhood to out or in around
  // the lit edge; all is the resting state.
  var kwWalk = [];
  var kwLitEdge = null;
  var kwDirection = "all";
  var kwDirectionDimmed = [];
  var KW_WALK_SHOWN = 8;
  var kwWalkExpanded = false;
  // Provenance dim: with "citations only" set, every edge but the
  // cited ones dims, with the nodes no cited edge touches.
  var kwProvCitedOnly = false;
  // Fan folding: past KW_FAN_FOLD_AT marks on one anchor, the fan
  // folds into one counted mark; expanded fans draw every member.
  // Aside marks wait out the render they are folded for.
  var KW_FAN_FOLD_AT = 6;
  var kwExpandedFans = new Set();
  var kwFoldedAside = new Map();
  var kwFanCounts = new Map();
  // Drawn text boxes this render: settling tags keep clear of them.
  var kwLabelBoxes = [];
  // Drawn node centres, drawing width, and hull boxes this render,
  // for card placement.
  var kwNodeXY = new Map();
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
  // Node shapes by recorded kind. The default finding keeps its circle;
  // the table covers the kinds the store records, and any other recorded
  // kind draws a star. Shapes run triangle to hexagon down the alphabet.
  var KW_KIND_SHAPES = {
    finding: "circle", answer: "triangle", correction: "square",
    decision: "diamond", observation: "pentagon", question: "hexagon",
  };
  // Kind families by recorded kind. The ring treatment carries the family
  // at a glance: records draw plain, resolutions a solid seal ring, open
  // questions a dashed ring, and anything the table does not list draws
  // plain with a star. Shape still tells kinds apart inside a family, and
  // fill still tells shared from unshared; the three never conflict.
  var KW_KIND_FAMILY = {
    finding: "records", observation: "records", correction: "records",
    answer: "resolutions", decision: "resolutions",
    question: "open",
  };
  function kwFamilyFor(kind) {
    return KW_KIND_FAMILY[String(kind || "finding").toLowerCase()] || "other";
  }
  var kwKindsDrawn = new Map();
  function kwShapeFor(kind) {
    return KW_KIND_SHAPES[String(kind || "finding").toLowerCase()] || "star";
  }
  // A regular-corner path centred at (x, y) with vertices on radius r.
  // The square sits flat so it reads apart from the diamond; the star
  // alternates outer and inner corners over eight points.
  function kwShapePath(shape, x, y, r) {
    const corners = { triangle: 3, square: 4, diamond: 4, pentagon: 5, hexagon: 6 }[shape] || 0;
    const pts = [];
    const total = shape === "star" ? 16 : corners * 2;
    for (let i = 0; i < total; i += 2) {
      const turn = i / total;
      const rr = shape === "star" && (i / 2) % 2 === 1 ? r * 0.55 : r;
      const a = (turn * 2 - 0.5) * Math.PI + (shape === "square" ? Math.PI / 4 : 0);
      pts.push((x + rr * Math.cos(a)).toFixed(1) + "," + (y + rr * Math.sin(a)).toFixed(1));
    }
    return "M" + pts.join(" L") + " Z";
  }
  // Relation style tuples by authored name: dash, width and ink from
  // the page tokens, twenty tuples in dash-major order. A name hashes
  // to a base tuple, stable across renders and scopes; names drawn
  // together that land on one tuple move to the next free tuple in
  // table order. So a name owns its tuple for a given drawn set, and
  // two drawn names never share one while free tuples remain. A drawn
  // set larger than twenty shares from the top of the order.
  var KW_REL_TUPLES = [];
  ["0.5 3", "6 3", "7 2.5 1.5 2.5", "10 3 2 3", ""].forEach((dash) => {
    ["2", "1"].forEach((width) => {
      ["var(--ink, #141a26)", "var(--muted, #5b6478)"].forEach((ink) => {
        KW_REL_TUPLES.push({ dash, width, ink });
      });
    });
  });
  // Drawn relation names to tuple indexes this render, claimed in drawn
  // order. The edges claim; the key and the cards read.
  var kwRelStyleDrawn = new Map();
  var kwMidpointsDrawn = 0;
  // Relation rows past this wait behind the key's disclosure instead of
  // eating the canvas; the rest of the key is bounded by construction.
  var KW_KEY_RELATIONS = 6;
  var kwRelationsExpanded = false;
  var kwKeyOpen = false;
  function kwRelBaseIndex(name) {
    const s = String(name || "");
    let h = 0;
    for (let i = 0; i < s.length; i += 1) h = (h * 33 + s.charCodeAt(i)) >>> 0;
    return h % KW_REL_TUPLES.length;
  }
  function kwClaimRelTuple(name) {
    const key = String(name || "");
    if (kwRelStyleDrawn.has(key)) return KW_REL_TUPLES[kwRelStyleDrawn.get(key)];
    const taken = new Set(kwRelStyleDrawn.values());
    let idx = kwRelBaseIndex(key);
    for (let step = 0; step < KW_REL_TUPLES.length; step += 1) {
      if (!taken.has(idx)) break;
      idx = (idx + 1) % KW_REL_TUPLES.length;
    }
    kwRelStyleDrawn.set(key, idx);
    return KW_REL_TUPLES[idx];
  }
  function kwRelTuple(name) {
    const key = String(name || "");
    if (kwRelStyleDrawn.has(key)) return KW_REL_TUPLES[kwRelStyleDrawn.get(key)];
    return KW_REL_TUPLES[kwRelBaseIndex(key)];
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
  // The committed search query behind the match list, and the match id
  // currently centred. Both survive re-renders so expansion keeps them.
  var kwSearchQuery = "";
  var kwSearchCurrent = null;
  var kwZoomReadout = null;
  // Dismissal is presentation only: the shell keeps its selection while
  // the map returns to the overview. Any new selection clears it.
  var kwDismissed = null;
  // A node pick dismisses the shell's relation focus until the shell
  // names another one; the canvas never re-adopts a dismissed name.
  var kwDismissedRelation = "";
  var kwSeenFocusRelation = "";
  var kwSeenFocusSeq = 0;
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

  // A node's kind rides in its own attribute beside its literal id,
  // so a lookup matches the pair and never the other kind.
  function kwNodeKind(g) {
    return g.getAttribute("data-kw-kind") || "";
  }
  function kwNodeKey(g) {
    const id = g.getAttribute("data-kw-node") || g.getAttribute("data-kw-id")
      || g.getAttribute("data-kw-cluster") || g.getAttribute("data-kw-ref") || "";
    return kwKey(kwNodeKind(g), id);
  }

  // Depth 1 lights the node and its direct relations; depth 2 adds
  // the neighbours of neighbours, which is the selection read.
  // Isolation compares kind-and-id pairs from the attributes' own
  // slots: a session sharing a group's literal id lights only itself.
  // The kept set is a rule the code guarantees: a node keeps every
  // drawn edge that names it, share and deliver edges carry their
  // recorded end kinds so a group end keeps its relations, and a tag
  // hung at a kept node stays lit with it even when its edge touches
  // no node. Promote and authorship ends are sessions by the
  // actor-position gate that draws them, and a collapsed badge carries
  // its author's own key, so it stays lit with its author. Tiers,
  // hulls and the staff are landmarks and never dim. One subtlety, not
  // an approximation: a tag several relations share hangs at its first
  // citer, so hovering a later citer keeps it by the edge instead.
  function kwIsolateSvg(svg, key, depth) {
    const layer = svg.querySelector("g.kw-edges");
    if (!layer) return;
    const endKey = (edge, side) => {
      const kind = edge.getAttribute(side === "from" ? "data-from-kind" : "data-to-kind") || "";
      const raw = edge.getAttribute(side === "from" ? "data-from" : "data-to") || "";
      return kwKey(kind, kwTypedLookupId(kind, raw));
    };
    const near = new Set([key]);
    for (const edge of layer.children) {
      const from = endKey(edge, "from");
      const to = endKey(edge, "to");
      if (from === key || to === key) {
        near.add(from);
        near.add(to);
      }
    }
    const keep = new Set(near);
    if (depth === 2) {
      for (const edge of layer.children) {
        const from = endKey(edge, "from");
        const to = endKey(edge, "to");
        if (near.has(from) || near.has(to)) {
          keep.add(from);
          keep.add(to);
        }
      }
    }
    // Tags hung at a kept node stay lit with it. Ref-to-ref tags
    // anchor at their author while their edge touches no node, so
    // without this a hovered or selected node reads beside faint tags.
    for (const mark of kwRefMarks.values()) {
      if (mark.anchor && keep.has(mark.anchor)) keep.add(kwKey("ref", mark.ref));
    }
    for (const g of svg.querySelectorAll("g.kw-anchor, g.knode, g.kw-cluster, g.kw-ref, g.kw-group")) {
      g.classList.toggle("kw-hover-dim", !keep.has(kwNodeKey(g)));
    }
    for (const edge of layer.children) {
      const from = endKey(edge, "from");
      const to = endKey(edge, "to");
      const lit = from === key || to === key
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

    // Member keys carry kind and id as a pair: a session literally
    // named like a group key still seats its own column.
    const authored = new Map();
    for (const f of overview.findings || []) {
      const author = kwKey("session", String(f.author || "unknown"));
      authored.set(author, (authored.get(author) || 0) + 1);
    }
    const scopeGroup = kwScopeGroup(overview);
    const groupScope = !!scopeGroup;
    const groupIds = [];
    const groupSeen = new Set();
    const kwAddGroup = (id) => {
      const g = String(id || "");
      if (g && !groupSeen.has(g)) { groupSeen.add(g); groupIds.push(g); }
    };
    if (scopeGroup) kwAddGroup(scopeGroup);
    // Promotion endpoints seat by kind: a group endpoint never becomes
    // an actor column. Absent kinds are legacy session endpoints.
    const sessionActors = Array.from(authored.keys());
    const kwAddSession = (id) => {
      const key = kwKey("session", String(id || ""));
      if (id && sessionActors.indexOf(key) === -1) sessionActors.push(key);
    };
    for (const p of promotions) {
      if (p.source) {
        if (String(p.sourceKind || "session") === "group") kwAddGroup(p.source);
        else kwAddSession(p.source);
      }
      if (p.destination) {
        if (String(p.destinationKind || "session") === "group") kwAddGroup(p.destination);
        else kwAddSession(p.destination);
      }
      kwAddSession(p.promotedBy);
    }
    for (const r of overview.relations || []) {
      kwAddSession(r.author);
    }
    // Active actors seat by default from the shell's reads: running
    // or pending seats a column even with no findings yet. This only
    // adds seats beside holdings; a scope with no holdings keeps its
    // empty drawing, so activity never invents a map where the store
    // holds nothing. Historical findings, holdings and the universal
    // default all stay where they were.
    const hasHoldings = (overview.findings || []).length > 0
      || promotions.length > 0 || (overview.relations || []).length > 0;
    if (hasHoldings) {
      const reads = kwActorReads || {};
      for (const id of Object.keys(reads)) {
        const st = reads[id] ? reads[id].status : "";
        if (st === "running" || st === "pending") kwAddSession(id);
      }
    }
    // A group scope places its findings without an actor column, under
    // the scope group; other scopes keep their session columns and seat
    // each referenced group beside them as its own node.
    const actors = (groupScope ? [] : sessionActors)
      .concat(groupIds.map((g) => kwKey("group", g)));
    const tierOf = new Map();
    // Groups always tier unknown: the depth walk reads session metadata
    // only, so a group sharing a session's literal id never borrows it.
    for (const id of actors) {
      tierOf.set(id, kwKeyKind(id) === "group" ? -1 : kwDepthOf(meta, roles, kwKeyId(id)));
    }
    const depths = Array.from(new Set(tierOf.values()))
      .filter((d) => d >= 0).sort((a, b) => a - b);
    // Actors with missing role or parent metadata appear in the unknown tier.
    if ([...tierOf.values()].some((d) => d < 0)) depths.push(-1);
    const byAuthor = new Map();
    if (groupScope) {
      // Every held finding packs under the scope group, which sorts
      // first by its count; referenced groups seat bare beside it.
      byAuthor.set(kwKey("group", scopeGroup), (overview.findings || []).slice());
      authored.set(kwKey("group", scopeGroup), (overview.findings || []).length);
    } else {
      for (const f of overview.findings || []) {
        const author = kwKey("session", String(f.author || "unknown"));
        if (!byAuthor.has(author)) byAuthor.set(author, []);
        byAuthor.get(author).push(f);
      }
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
    // An empty scope draws one rule and its notice, so the region
    // collapses to them instead of holding an empty frame open.
    if (!tiers.length) height = 120;

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
    // Typed heads exist only when typed edges do, so a payload
    // without them leaves the defs exactly as they were. The
    // authored head is a filled wedge; the cited head is an open
    // ring at the evidence, which nothing else on the canvas uses.
    if ((overview.edges || []).length) {
      const authored = kwSvg(defs, "marker", {
        id: "kw-arrow-authored", viewBox: "0 0 8 8", refX: "7", refY: "4",
        markerWidth: "7", markerHeight: "7", orient: "auto-start-reverse",
      });
      kwSvg(authored, "title", null).textContent = "authored claim. ";
      kwSvg(authored, "path", { d: "M0,0 L8,4 L0,8 Z", fill: "var(--ink, #141a26)" });
      const cited = kwSvg(defs, "marker", {
        id: "kw-arrow-cited", viewBox: "0 0 8 8", refX: "6.5", refY: "4",
        markerWidth: "7", markerHeight: "7", orient: "auto-start-reverse",
      });
      kwSvg(cited, "title", null).textContent = "recorded evidence. ";
      kwSvg(cited, "circle", {
        cx: "4", cy: "4", r: "2.6", fill: "var(--paper, #fbfcfe)",
        stroke: "var(--ink, #141a26)", "stroke-width": "1.4",
      });
    }
    const edgeLayer = kwSvg(svg, "g", { class: "kw-edges" });
    const roleOf = (id) => (meta[id] && meta[id].role) || roles[id] || "";
    return { svg, edgeLayer, tiers, findings, actorPerRow, width, roleOf, markers, tierOf, groupScope };
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
    const clusterKind = kwKeyKind(author);
    const clusterLit = kwKeyId(author);
    const clusterWho = clusterKind === "group"
      ? " findings held by group " + clusterLit
      : " findings by " + clusterLit;
    const g = kwSvg(svg, "g", {
      class: "kw-cluster",
      tabindex: "0", role: "button",
      "aria-label": items.length + clusterWho + ", activate to expand",
      "data-kw-cluster": clusterLit,
      "data-kw-kind": clusterKind,
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
          ? mount.querySelector('[data-kw-node="' + CSS.escape(items[0].id) + '"][data-kw-kind="finding"]')
          : mount.querySelector('[data-kw-cluster="' + CSS.escape(clusterLit) + '"][data-kw-kind="' + CSS.escape(clusterKind) + '"]');
        if (target && typeof target.focus === "function") target.focus();
      }
      if (opts && typeof opts.onSelectActor === "function" && clusterKind !== "group") opts.onSelectActor(clusterLit);
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
      // The recorded coupling names the membership's kind; hull and
      // lozenge carry it when the ensemble states it.
      const coupling = e && e.coupling ? String(e.coupling) : "";
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
        // A scope that seats none of the members seats no lozenge: in a
        // group scope the members are absent, not collapsed.
        // Ensemble members are sessions; the tier map pairs kind and id.
        if (!members.some((m) => tierOf.has(kwKey("session", m)))) continue;
        const tier = tiers.find((t) => t.d === tierOf.get(kwKey("session", members[0]))) || tiers[0];
        if (!tier) continue;
        const n = lozenges.get(tier.d) || 0;
        lozenges.set(tier.d, n + 1);
        const x = KW_GUTTER + 75 + n * 112;
        const y = tier.y + 26;
        const g = kwSvg(layer, "g", {
          class: "kw-lozenge",
          tabindex: "0", role: "button",
          "aria-label": "ensemble " + id + ", " + members.length + " seats"
          + (coupling ? ", " + coupling : "") + ", activate to expand",
          "data-kw-hull": id,
        });
        const boxW = Math.max(80,
          (String(id).length + (coupling ? coupling.length + 3 : 0)) * 6.4 + 36);
        kwSvg(g, "rect", {
          x: String(x - boxW / 2), y: String(y - 11),
          width: String(boxW), height: "22", rx: "11",
          class: "kw-lozenge-box",
        });
        kwTrackBox(x - boxW / 2, y - 11, x + boxW / 2, y + 11);
        kwLabelBoxes.push({ x0: x - boxW / 2, y0: y - 11, x1: x + boxW / 2, y1: y + 11 });
        const label = kwSvg(g, "text", {
          x: String(x), y: String(y + 4),
          class: "kw-lozenge-label", "text-anchor": "middle",
        });
        const lname = kwSvg(label, "tspan", { class: "kw-lozenge-name" });
        lname.textContent = String(id) + " ";
        const lcount = kwSvg(label, "tspan", { class: "kw-lozenge-count" });
        lcount.textContent = String(members.length);
        if (coupling) {
          const lcoupling = kwSvg(label, "tspan", { class: "kw-lozenge-name" });
          lcoupling.textContent = " · " + coupling;
        }
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
        "aria-label": "ensemble " + id + ", " + members.length + " seats"
        + (coupling ? ", " + coupling : "") + ", activate to collapse",
        "data-kw-hull": id,
      });
      kwSvg(g, "path", { d, class: "kw-hull-line" });
      const label = kwSvg(g, "text", {
        x: String(top.x), y: String(top.y - 6),
        class: "kw-hull-label", "text-anchor": "middle",
      });
      label.textContent = id + " (" + members.length
        + (coupling ? ", " + coupling : "") + ")";
      const hlw = (label.textContent.length + 1) * 9 + 8;
      kwTrackBox(top.x - hlw / 2, top.y - 20, top.x + hlw / 2, top.y);
      kwLabelBoxes.push({ x0: top.x - hlw / 2, y0: top.y - 20, x1: top.x + hlw / 2, y1: top.y });
      wire(g);
    }
  }

  // Section hulls reuse the ensemble hull machinery: a section groups
  // the seats its recorded members occupy, labeled with its capability.
  // No collapse: sections are not shell state, so the hull is static.
  // Draws nothing when the prop is empty.
  function kwSectionHulls(svg, edgeLayer, layout, sections) {
    const list = Array.isArray(sections) ? sections : [];
    if (!list.length) return;
    const actorPos = layout.actorPos;
    const layer = kwSvg(svg, "g", { class: "kw-hulls kw-hulls-sections" });
    svg.insertBefore(layer, edgeLayer);
    for (const s of list) {
      const id = s && s.id ? String(s.id) : "";
      const members = s && Array.isArray(s.members)
        ? s.members.map((m) => String(m)) : [];
      if (!id || !members.length) continue;
      const capability = s && s.capability ? String(s.capability) : "";
      const pts = [];
      for (const m of members) {
        if (actorPos.has(m)) pts.push(actorPos.get(m));
      }
      if (pts.length < 2) continue;
      const cx = pts.reduce((sum, p) => sum + p.x, 0) / pts.length;
      const cy = pts.reduce((sum, p) => sum + p.y, 0) / pts.length;
      const padded = pts.map((p) => {
        const dx = p.x - cx;
        const dy = p.y - cy;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        return { x: p.x + dx / len * 18, y: p.y + dy / len * 18 };
      });
      const hull = kwHullPath(padded);
      const d = "M" + hull.map((p) => p.x + "," + p.y).join(" L") + " Z";
      const top = hull.reduce((a, b) => (a.y < b.y ? a : b));
      const g = kwSvg(layer, "g", {
        class: "kw-hull kw-hull-section",
        "aria-label": "section " + id + ", " + members.length + " seats"
        + (capability ? ", " + capability : ""),
      });
      kwSvg(g, "path", { d, class: "kw-hull-line" });
      const label = kwSvg(g, "text", {
        x: String(top.x), y: String(top.y - 6),
        class: "kw-hull-label kw-hull-section-label", "text-anchor": "middle",
      });
      label.textContent = id + " (" + members.length
        + (capability ? ", " + capability : "") + ")";
      const hlw = (label.textContent.length + 1) * 9 + 8;
      kwTrackBox(top.x - hlw / 2, top.y - 20, top.x + hlw / 2, top.y);
      kwLabelBoxes.push({ x0: top.x - hlw / 2, y0: top.y - 20, x1: top.x + hlw / 2, y1: top.y });
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

  function kwPlaceWhole(layout, container, overview, promotions, opts, ensembles, sections) {
    const { svg, edgeLayer, tiers } = layout;
    kwContentBBox = null;
    kwRefMarks = new Map();
    kwRefsDrawn = 0;
    kwEvidenceDrawn = 0;
    kwTypedAuthored = 0;
    kwTypedCited = 0;
    kwTypedRings = 0;
    kwTypedOutside = 0;
    kwKindsDrawn = new Map();
    kwRelStyleDrawn = new Map();
    kwMidpointsDrawn = 0;
    kwLabelBoxes = [];
    kwNodeXY = new Map();
    const actorPos = new Map();
    const findingPos = new Map();
    const groupPos = new Map();
    const groupsDrawn = [];
    const query = opts && opts.query;
    // An empty scope draws one ruled line with its state, so the
    // frame reads deliberate rather than broken.
    if (!tiers.length) {
      kwSvg(svg, "line", {
        x1: String(KW_PAD), y1: "82",
        x2: String(layout.width - KW_PAD), y2: "82",
        class: "kw-staff",
      });
      const rest = kwSvg(svg, "text", {
        x: String(layout.width / 2), y: "104",
        class: "kw-empty", "text-anchor": "middle",
      });
      rest.textContent = "No records in this scope.";
      kwTrackBox(KW_PAD, 82, layout.width - KW_PAD, 104);
    }
    for (const t of tiers) {
      // A group scope holds no depth tiers: its one tier reads held.
      const depthWord = layout.groupScope ? "held"
        : t.d < 0 ? "depth unknown" : "depth " + t.d;
      const label = kwSvg(svg, "text", {
        x: String(KW_PAD), y: String(t.y + 4), class: "kw-tier",
        "aria-label": layout.groupScope ? "held findings" : depthWord,
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
        // A group seats as its own hollow node, never as an actor
        // anchor: its metadata names it in the title and the card.
        // The shell selects actors and findings only, so the group
        // keeps its card and isolation to the canvas. The branch reads
        // the member key's kind slot, never the id's text.
        if (kwKeyKind(id) === "group") {
          const gid = kwKeyId(id);
          groupPos.set(gid, { x, y });
          groupsDrawn.push(gid);
          kwTrackBox(x - 12, y - 12, x + 20 + gid.length * 8, y + 12);
          const g = kwSvg(svg, "g", {
            class: "kw-group",
            tabindex: "0", role: "button",
            "aria-label": "group " + gid,
            "data-kw-id": gid,
            "data-kw-kind": "group",
          });
          kwSvg(g, "rect", {
            x: String(x - 7), y: String(y - 7),
            width: "14", height: "14",
            class: "kw-group-box",
          });
          const tip = kwSvg(g, "title", null);
          tip.textContent = kwGroupWords(overview, gid);
          const nw = gid.length * 8 + 10;
          const nbox = [x + 10, x + 10 + nw];
          const nboxes = nameRows.get(row) || [];
          if (nbox[1] <= layout.width
            && !nboxes.some((b) => nbox[0] < b[1] && b[0] < nbox[1])) {
            nboxes.push(nbox);
            nameRows.set(row, nboxes);
            const name = kwSvg(g, "text", {
              x: String(x + 10), y: String(y + 4), class: "kw-name mono",
            });
            name.textContent = gid;
            kwLabelBoxes.push({ x0: x + 10, y0: y - 8, x1: x + 10 + nw, y1: y + 8 });
          }
          if (!kwMatches(query, gid, "", gid)) g.classList.add("kw-dim");
          const pick = () => {
            kwDismissed = null;
            kwDismissedRelation = (opts && opts.focusRelation) || "";
            kwPinCard(container, overview, promotions, opts, gid, "group");
            kwIsolate(kwKey("group", gid), 2);
          };
          g.addEventListener("click", () => {
            if (kwConsumePan()) return;
            pick();
            g.focus();
          });
          g.addEventListener("keydown", (ev) => {
            if (ev.key === "Enter" || ev.key === " ") {
              if (ev.preventDefault) ev.preventDefault();
              kwViewMoved = false;
              pick();
            }
          });
          return;
        }
        // Member keys pair kind and id; the anchor draws the literal
        // id and carries its kind beside it for lookups.
        const lid = kwKeyId(id);
        actorPos.set(lid, { x, y });
        kwTrackBox(x - 12, y - 12, x + 20 + lid.length * 8, y + 12);
        const role = layout.roleOf ? layout.roleOf(lid) : "";
        const conductor = role === "principal-conductor" || role === "associate-conductor";
        const s = conductor ? 11 : 8;
        const g = kwSvg(svg, "g", {
          class: "kw-anchor",
          tabindex: "0", role: "button",
          "aria-label": lid,
          "data-kw-id": lid,
          "data-kw-kind": "session",
        });
        const read = kwActorReads[lid] || {};
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
        const nw = lid.length * 8 + 10;
        const nbox = [x + 10, x + 10 + nw];
        const nboxes = nameRows.get(row) || [];
        if (nbox[1] <= layout.width
          && !nboxes.some((b) => nbox[0] < b[1] && b[0] < nbox[1])) {
          nboxes.push(nbox);
          nameRows.set(row, nboxes);
          const name = kwSvg(g, "text", {
            x: String(x + 10), y: String(y + 4), class: "kw-name mono",
          });
          name.textContent = lid;
          kwLabelBoxes.push({ x0: x + 10, y0: y - 8, x1: x + 10 + nw, y1: y + 8 });
        }
        if (!kwMatches(query, lid, "", lid)) g.classList.add("kw-dim");
        // Actors the shell reports live read full strength; the rest
        // dim with the lane's dim token. Dim only: findings, holdings
        // and relations stay in scope, and this pass only adds the
        // same class the query pass uses. Where reads are absent,
        // nothing dims and the drawing holds as before.
        if (kwLiveDim(lid)) g.classList.add("kw-dim");
        g.addEventListener("click", () => {
          if (kwConsumePan()) return;
          kwDismissed = null;
          kwDismissedRelation = (opts && opts.focusRelation) || "";
          kwPinCard(container, overview, promotions, opts, lid, "session");
          g.focus();
          kwIsolate(kwKey("session", lid), 2);
          if (opts && typeof opts.onSelectActor === "function") {
            opts.onSelectActor(lid);
          }
        });
        g.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter" || ev.key === " ") {
            if (ev.preventDefault) ev.preventDefault();
            kwViewMoved = false;
            kwDismissed = null;
            kwDismissedRelation = (opts && opts.focusRelation) || "";
            kwPinCard(container, overview, promotions, opts, lid, "session");
            kwIsolate(kwKey("session", lid), 2);
            if (opts && typeof opts.onSelectActor === "function") {
              opts.onSelectActor(lid);
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
      // The selected caption places first, so the rank order thins
      // around it instead of over it: selection is identity, it stays.
      const kwThinSel = kwEffectiveSelected(opts);
      if (kwThinSel && kwSelKind(overview, kwThinSel) === "finding") {
        const s = slotByFinding.get(kwThinSel);
        if (s) {
          const at = kwSlotXY(t, s);
          const rec = layout.findings.get(kwThinSel);
          const words = rec ? kwCaptionWords(rec) : kwThinSel;
          const w = Math.min(26, words.length) * 8 + 10;
          const boxes = placedRows.get(at.row) || [];
          boxes.push([at.x - w / 2, at.x + w / 2]);
          placedRows.set(at.row, boxes);
          labelShown.add(kwThinSel);
        }
      }
      for (const fid of labeled) {
        const s = slotByFinding.get(fid);
        if (!s) continue;
        const at = kwSlotXY(t, s);
        const row = at.row;
        const x = at.x;
        const rec = layout.findings.get(fid);
        // The thinning box measures the drawn caption, suffixes and
        // cap included: a claim-length box lets neighbours' suffixes
        // overlap each other.
        const words = rec ? kwCaptionWords(rec) : fid;
        const w = Math.min(26, words.length) * 8 + 10;
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
          "data-kw-kind": "finding",
        });
        kwMarkNew(g, f.id);
        // The ring carries the kind family, the shape the kind inside
        // it, size the share count: the three channels never conflict.
        // The key reads families with their drawn counts.
        const shape = kwShapeFor(f.kind);
        kwKindsDrawn.set(String(f.kind || "finding"), shape);
        if (shape === "circle") {
          kwSvg(g, "circle", {
            cx: String(x), cy: String(y), r: String(mass),
            class: "kw-finding" + (degree ? "" : " unshared"),
          });
        } else {
          kwSvg(g, "path", {
            d: kwShapePath(shape, x, y, mass),
            class: "kw-finding" + (degree ? "" : " unshared"),
          });
        }
        const kindFamily = kwFamilyFor(f.kind);
        if (kindFamily === "resolutions" || kindFamily === "open") {
          kwSvg(g, "circle", {
            cx: String(x), cy: String(y), r: String(mass + 2),
            class: kindFamily === "resolutions" ? "kw-seal" : "kw-open",
          });
        }
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
          // The obstacle measures the drawn caption, suffixes capped
          // where the label caps. A claim-length box lets tags settle
          // onto the suffixes.
          const lw = Math.min(26, kwCaptionWords(f).length) * 8 + 10;
          kwTrackBox(x - lw / 2, y + 10, x + lw / 2, y + 30);
          kwLabelBoxes.push({ x0: x - lw / 2, y0: y + 10, x1: x + lw / 2, y1: y + 30 });
        }
        if (!kwMatches(query, f.id, f.claim, f.author)) {
          g.classList.add("kw-dim");
        }
        g.addEventListener("click", () => {
          if (kwConsumePan()) return;
          kwDismissed = null;
          kwDismissedRelation = (opts && opts.focusRelation) || "";
          kwPinCard(container, overview, promotions, opts, f.id, "finding");
          g.focus();
          kwIsolate(kwKey("finding", f.id), 2);
          if (opts && typeof opts.onSelectFinding === "function") {
            opts.onSelectFinding(f.id);
          }
        });
        g.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter" || ev.key === " ") {
            if (ev.preventDefault) ev.preventDefault();
            kwViewMoved = false;
            kwDismissed = null;
            kwDismissedRelation = (opts && opts.focusRelation) || "";
            kwPinCard(container, overview, promotions, opts, f.id, "finding");
            kwIsolate(kwKey("finding", f.id), 2);
            if (opts && typeof opts.onSelectFinding === "function") {
              opts.onSelectFinding(f.id);
            }
          }
        });
      });
    }
    // Promotion relations draw as arcs bowed off the straight line so
    // movement reads apart from structure; authorship stays straight.
    const edge = (x1, y1, x2, y2, cls, marker, label, kind, fromKind, from, toKind, to, arc) => {
      const attrs = {
        class: cls, "marker-end": "url(#" + marker + ")",
        "aria-label": label, "data-kind": kind,
        "data-from": String(from), "data-to": String(to),
        "data-from-kind": String(fromKind), "data-to-kind": String(toKind),
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
      // Each end anchors by its recorded kind: groups meet their own
      // nodes, never an actor that happens to share the literal id.
      const sk = String(p.sourceKind || "session") === "group" ? "group" : "session";
      const dk = String(p.destinationKind || "session") === "group" ? "group" : "session";
      const sfrom = p.source ? String(p.source) : "";
      const ddest = p.destination ? String(p.destination) : "";
      const from = sfrom
        ? (sk === "group" ? groupPos.get(sfrom) : actorPos.get(sfrom))
        : null;
      if (from) {
        edge(from.x, from.y + 6, to.x, to.y - 6, "kw-edge-share",
          "kw-arrow-share", "promotion from " + sfrom, "share",
          sk, sfrom, "finding", p.finding, true);
      }
      const dest = ddest
        ? (dk === "group" ? groupPos.get(ddest) : actorPos.get(ddest))
        : null;
      if (dest) {
        edge(to.x, to.y + 6, dest.x, dest.y - 6, "kw-edge-deliver",
          "kw-arrow-deliver", "delivery to " + ddest, "deliver",
          "finding", p.finding, dk, ddest, true);
      }
      const promoter = p.promotedBy ? String(p.promotedBy) : "";
      const sameSrc = sk !== "group" && promoter === sfrom;
      const sameDst = dk !== "group" && promoter === ddest;
      if (promoter && !sameSrc && !sameDst && actorPos.has(promoter)) {
        const pfrom = actorPos.get(promoter);
        edge(pfrom.x, pfrom.y + 6, to.x, to.y - 6, "kw-edge-promote",
          "kw-arrow-promote", "promoted by " + promoter, "promote",
          "session", promoter, "finding", p.finding, true);
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
        "session", author, "finding", fid);
    }
    // Hulls draw before relations so settling tags keep clear of their
    // labels; paint order is unchanged, the hull layer sits beneath the edges.
    layout.actorPos = actorPos;
    // The mixed maps key kind and id together; the per-kind maps they
    // spread stay literal.
    kwNodeXY = new Map();
    for (const [id, pos] of actorPos) kwNodeXY.set(kwKey("session", id), pos);
    for (const [id, pos] of findingPos) kwNodeXY.set(kwKey("finding", id), pos);
    for (const [id, pos] of groupPos) kwNodeXY.set(kwKey("group", id), pos);
    kwEnsembleHulls(svg, edgeLayer, layout, ensembles || []);
    kwSectionHulls(svg, edgeLayer, layout, sections || []);
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
    // A drawn node's entity kind by recorded placement, for the relate
    // ends the resolver leaves as plain nodes.
    // A drawn end anchors by kind, group nodes included, so edges
    // and tag anchors touching a group isolate with it.
    const kwDrawnKind = (id) => findingPos.has(id) ? "finding"
      : actorPos.has(id) ? "session" : groupPos.has(id) ? "group" : "";
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
          relations: [], evidenceOf: [],
          follow: refFollow.get(end.ref) || "",
          anchorX: at.x, anchorY: at.y, anchor: nodeId,
        };
        kwRefMarks.set(end.ref, mark);
      }
      return mark;
    };
    // Typed edges resolve first, before the compatibility passes, so
    // a relation or evidence stub naming the same semantic edge can
    // defer to the typed drawing. A held finding, session or group
    // end meets its node, any other end floats a ring on the stub
    // fan. The typed node record overrides the family inference:
    // referenceOnly means not held whatever the reference looks
    // like, and an end with no node record at all never pretends to
    // a record. An edge with no drawn end draws nothing and counts
    // as outside instead of inventing a seat.
    const typedNodes = new Map();
    for (const n of overview.nodes || []) {
      if (n && n.reference !== undefined && n.reference !== null) {
        typedNodes.set(String(n.reference), n);
      }
    }
    const typedSpecs = [];
    const kwTypedSideKind = (e, side) => {
      const k = String((e && e[side]) || "").toLowerCase();
      return k === "finding" || k === "session" || k === "group" ? k : "";
    };
    const kwTypedNodeEnd = (s, kind) => {
      if (!s) return null;
      const fid = kwFindingRef(s) || s;
      const want = (k) => !kind || kind === k;
      if (want("finding") && findingPos.has(fid)) {
        return { kind: "node", id: fid, ref: s, drawn: "finding" };
      }
      if (want("finding") && layout.findings.has(fid)) {
        return { kind: "hidden", id: fid, ref: s };
      }
      if (want("session") && actorPos.has(s)) {
        return { kind: "node", id: s, ref: s, drawn: "session" };
      }
      if (want("group") && groupPos.has(s)) {
        return { kind: "node", id: s, ref: s, drawn: "group" };
      }
      return null;
    };
    const KW_TYPED_FAMILIES = /^(message|task|report|turn|issue|pr|external)$/;
    for (const e of overview.edges || []) {
      const prov = String((e && e.provenance) || "");
      if (prov !== "authored" && prov !== "recorded-evidence") continue;
      const sref = e.source !== undefined && e.source !== null ? String(e.source) : "";
      const tref = e.target !== undefined && e.target !== null ? String(e.target) : "";
      if (!sref || !tref || sref === tref) continue;
      const a = kwTypedNodeEnd(sref, kwTypedSideKind(e, "sourceKind"))
        || { kind: "ring", ref: sref };
      const b = kwTypedNodeEnd(tref, kwTypedSideKind(e, "targetKind"))
        || { kind: "ring", ref: tref };
      if (a.kind === "hidden" || b.kind === "hidden") continue;
      // The anchor is a drawn node end when there is one; otherwise
      // the recorded author's drawn seat, exactly as the legacy
      // relation pass seats reference pairs at r.author. The author
      // is where the rings sit, never an endpoint of the edge: both
      // endpoints keep their canonical references. An edge with no
      // drawn end and no drawn author stays outside.
      const anchor = a.kind === "node" ? a : (b.kind === "node" ? b : null);
      const author = e && e.author !== undefined && e.author !== null
        ? String(e.author) : "";
      const authorAt = !anchor && author && actorPos.has(author)
        ? actorPos.get(author) : null;
      if (!anchor && !authorAt) { kwTypedOutside += 1; continue; }
      const at = anchor
        ? (anchor.drawn === "finding" ? findingPos.get(anchor.id)
          : anchor.drawn === "session" ? actorPos.get(anchor.id)
          : groupPos.get(anchor.id))
        : authorAt;
      const anchorKey = anchor ? kwKey(anchor.drawn, anchor.id) : kwKey("session", author);
      const slotRing = (end) => {
        const rec = typedNodes.get(end.ref) || null;
        const rkind = String((rec && rec.kind) || "");
        const fam = KW_TYPED_FAMILIES.test(rkind) ? rkind
          : rkind === "finding" ? "finding"
          : ((KW_REF_FAMILIES.exec(end.ref) || [])[1]
            || (kwFindingRef(end.ref) ? "finding" : "reference"));
        const mark = kwRefSlot(anchorKey, at,
          { ref: end.ref, family: fam });
        const refOnly = rec ? rec.referenceOnly === true : true;
        mark.typed = { kind: rkind, referenceOnly: refOnly };
        mark.unheld = refOnly;
        const label = end.ref.length > 22 ? end.ref.slice(0, 21) + "…" : end.ref;
        mark.shown = refOnly ? label + " · not held" : label;
        mark.w = mark.shown.length * 7.5 + 14;
      };
      if (a.kind === "ring") slotRing(a);
      if (b.kind === "ring") slotRing(b);
      typedSpecs.push({
        a, b, provenance: prov,
        relation: String((e && e.relation) || ""),
        edgeId: e && e.id !== undefined && e.id !== null ? String(e.id) : "",
      });
    }
    // Drawn typed edges by canonical ends. Authored keys carry the
    // relation name and the direction; cited keys both directions of
    // one citation. A compatibility end naming a drawn group reads as
    // the group, the way the typed resolver sees it.
    const kwTypedMatchKey = (end) => end.kind === "node"
      ? end.drawn + ":" + end.id : "ref:" + end.ref;
    const kwRelMatchKey = (end) => {
      if (end.kind === "node") return kwDrawnKind(end.id) + ":" + end.id;
      if (groupPos.has(end.ref)) return "group:" + end.ref;
      return "ref:" + end.ref;
    };
    const kwTypedAuthoredKeys = new Set();
    const kwTypedCitedKeys = new Set();
    for (const spec of typedSpecs) {
      const ka = kwTypedMatchKey(spec.a);
      const kb = kwTypedMatchKey(spec.b);
      if (spec.provenance === "authored") {
        if (spec.relation) kwTypedAuthoredKeys.add(ka + "|" + kb + "|" + spec.relation);
      } else {
        kwTypedCitedKeys.add(ka + "|" + kb);
        kwTypedCitedKeys.add(kb + "|" + ka);
      }
    }
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
      // A drawn typed edge wins over the compatibility row naming the
      // same directed ends with the same relation name, so one fact
      // draws once. An unnamed typed edge proves no sameness and
      // suppresses nothing; without typed edges the set is empty and
      // every relation draws as before.
      if (kwTypedAuthoredKeys.has(
        kwRelMatchKey(a) + "|" + kwRelMatchKey(b) + "|" + name)) continue;
      const needA = a.kind === "ref";
      const needB = b.kind === "ref";
      if (needA && needB) {
        const author = actorPos.get(r.author);
        if (!author) continue;
        const first = kwRefSlot(kwKey("session", r.author), author, a);
        const second = kwRefSlot(kwKey("session", r.author), author, b);
        first.relations.push({ name, other: b.ref });
        second.relations.push({ name, other: a.ref });
      } else {
        if (needA && !nodePos(b)) continue;
        if (needB && !nodePos(a)) continue;
        if (needA) kwRefSlot(kwKey(kwDrawnKind(b.id), b.id), nodePos(b), a).relations.push({ name, other: b.id });
        if (needB) kwRefSlot(kwKey(kwDrawnKind(a.id), a.id), nodePos(a), b).relations.push({ name, other: a.id });
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
        // Midpoint names stay out of the stroke gaps: settling tags
        // still avoid their boxes, but hidden text carves no gaps.
        kwLabelBoxes.push({ x0: mx - shown.length * 3.5 - 4, y0: my - 12,
          x1: mx + shown.length * 3.5 + 4, y1: my + 2, gap: false });
      }
      relateSpecs.push({ a, b, name, shown });
    }
    // Evidence the store actually holds draws too: a drawn finding whose
    // evidence parses as a structured reference earns a tag and a quiet
    // stub, the only links a scope without relations can honestly show.
    // Prose evidence stays caption and card text; it names no record.
    const evidenceSpecs = [];
    for (const f of layout.findings.values()) {
      if (!findingPos.has(f.id)) continue;
      const raw = String((f && f.evidence) || "");
      if (!raw || (!KW_REF_FAMILIES.test(raw) && !kwFindingRef(raw)
        && !actorPos.has(raw) && !findingPos.has(raw))) continue;
      const end = kwResolveEnd(raw, layout.findings, findingPos, actorPos);
      if (!end || end.kind === "hidden") continue;
      if (end.kind === "node" && end.id === f.id) continue;
      // A drawn citation wins over the stub parsing the same finding
      // and evidence, so one citation draws once. Without typed edges
      // the set is empty and every stub draws as before.
      if (kwTypedCitedKeys.has(
        "finding:" + f.id + "|" + kwRelMatchKey(end))) continue;
      if (end.kind === "ref") {
        const mark = kwRefSlot(kwKey("finding", f.id), findingPos.get(f.id), end);
        if (mark.evidenceOf.indexOf(f.id) < 0) mark.evidenceOf.push(f.id);
      }
      evidenceSpecs.push({ a: { kind: "node", id: f.id }, b: end });
    }
    // Fans past a readable degree fold into one counted mark: the
    // carrier keeps the first slot and the rest wait aside for the
    // render. An expanded fan draws every member; any member's card
    // offers the fold back. Marks keep their slots either way, so
    // folding never moves the canvas under the reader.
    kwFoldedAside = new Map();
    kwFanCounts = new Map();
    const kwFans = new Map();
    for (const mark of kwRefMarks.values()) {
      const list = kwFans.get(mark.anchor) || [];
      list.push(mark);
      kwFans.set(mark.anchor, list);
    }
    for (const [anchorKey, marks] of kwFans) {
      if (marks.length < KW_FAN_FOLD_AT) continue;
      kwFanCounts.set(anchorKey, marks.length);
      if (kwExpandedFans.has(anchorKey)) continue;
      const carrier = marks[0];
      carrier.folded = {
        count: marks.length, anchorKey, refs: marks.map((m) => m.ref),
      };
      carrier.shown = marks.length + " references";
      carrier.w = carrier.shown.length * 7.5 + 14;
      for (let i = 1; i < marks.length; i += 1) {
        marks[i].carrierRef = carrier.ref;
        kwFoldedAside.set(marks[i].ref, marks[i]);
        kwRefMarks.delete(marks[i].ref);
      }
    }
    // Tags settle top-down past nodes, text and the tags above; a tag
    // keeps stepping until it clears, so settling never places overlap
    // within the boxes it is given. The boxes are exact for mono words
    // and drawn rects, and estimated at 8 pixels a character for the
    // 14-pixel captions: caps-heavy text past that mean can overflow,
    // and a tag then clears the box while nicking the overflow. The
    // pinned card sits in flow below the canvas, not a settled
    // label; it clears on background click or Escape.
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
      // A typed ring hangs its label below the ring, so its box is
      // taller than a tag's; the settle moves the centre the same way.
      const hh = mark.typed ? 19 : 9 + 3;
      while (settled.some((box) =>
          mark.x - hw < box.x1 && box.x0 < mark.x + hw
          && mark.y - hh < box.y1 && box.y0 < mark.y + hh)) {
        mark.y += 10;
      }
      settled.push({ x0: mark.x - hw, y0: mark.y - hh, x1: mark.x + hw, y1: mark.y + hh });
      // Settled tags join the stub gaps, so a stub carves around tags
      // it crosses; its own tag holds it by the endpoint rule.
      kwLabelBoxes.push({ x0: mark.x - hw, y0: mark.y - hh, x1: mark.x + hw, y1: mark.y + hh });
    }
    for (const mark of kwRefMarks.values()) {
      // A folded fan draws one counted mark that expands on
      // activation, reusing the disclosure shape: count first, the
      // members behind one gesture.
      if (mark.folded && !kwExpandedFans.has(mark.folded.anchorKey)) {
        const g = kwSvg(svg, "g", {
          class: "kw-ref kw-folded",
          tabindex: "0", role: "button",
          "aria-label": mark.folded.count + " references, activate to expand",
          "data-kw-node": mark.ref,
          "data-kw-ref": mark.ref,
          "data-kw-kind": "ref",
          "data-kw-folded": mark.folded.anchorKey,
        });
        kwSvg(g, "rect", {
          x: String(mark.x - mark.w / 2), y: String(mark.y - 9),
          width: String(mark.w), height: "18", rx: "9",
          class: "kw-folded-tag",
        });
        const word = kwSvg(g, "text", {
          x: String(mark.x), y: String(mark.y + 4), class: "kw-ref-word mono",
          "text-anchor": "middle",
        });
        word.textContent = mark.shown;
        const heading = kwSvg(g, "title", null);
        heading.textContent = mark.folded.count + " references — activate to expand";
        kwTrackBox(mark.x - mark.w / 2, mark.y - 9, mark.x + mark.w / 2, mark.y + 9);
        const expand = () => {
          kwExpandedFans.add(mark.folded.anchorKey);
          if (kwLastRender) {
            renderKnowledge(kwLastRender.container, kwLastRender.data, kwLastRender.opts);
            const next = kwLastRender.container.querySelector(
              'g.kw-ref[data-kw-ref="' + CSS.escape(mark.folded.refs[0]) + '"]');
            if (next && typeof next.focus === "function") next.focus();
          }
        };
        g.addEventListener("click", () => {
          if (kwConsumePan()) return;
          expand();
        });
        g.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter" || ev.key === " ") {
            if (ev.preventDefault) ev.preventDefault();
            kwViewMoved = false;
            expand();
          }
        });
        kwRefsDrawn += 1;
        continue;
      }
      // A typed endpoint draws as a ring, never a tag or a node: open
      // when the store holds no record for it, a filled dot when the
      // record exists but the endpoint has no tier seat. The label
      // hangs below the ring inside the settled box.
      if (mark.typed) {
        const open = mark.typed.referenceOnly !== false;
        const g = kwSvg(svg, "g", {
          class: "kw-ref kw-typeref",
          tabindex: "0", role: "button",
          "aria-label": "reference " + mark.ref
            + (open ? ", not held"
              : ", held " + (mark.typed.kind || "record")),
          "data-kw-node": mark.ref,
          "data-kw-ref": mark.ref,
          "data-kw-kind": "ref",
          "data-reference-only": open ? "true" : "false",
        });
        kwSvg(g, "circle", {
          cx: String(mark.x), cy: String(mark.y - 4), r: "7",
          class: open ? "kw-typeref-ring" : "kw-typeref-dot",
        });
        const word = kwSvg(g, "text", {
          x: String(mark.x), y: String(mark.y + 12), class: "kw-ref-word mono",
          "text-anchor": "middle",
        });
        word.textContent = mark.shown;
        const heading = kwSvg(g, "title", null);
        heading.textContent = mark.ref + (open ? " — not held" : "");
        kwTrackBox(mark.x - mark.w / 2, mark.y - 16, mark.x + mark.w / 2, mark.y + 16);
        g.addEventListener("click", () => {
          if (kwConsumePan()) return;
          kwDismissed = null;
          kwDismissedRelation = (opts && opts.focusRelation) || "";
          kwPinCard(container, overview, promotions, opts, mark.ref, "ref");
          g.focus();
          kwIsolate(kwKey("ref", mark.ref), 2);
        });
        g.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter" || ev.key === " ") {
            if (ev.preventDefault) ev.preventDefault();
            kwViewMoved = false;
            kwDismissed = null;
            kwDismissedRelation = (opts && opts.focusRelation) || "";
            kwPinCard(container, overview, promotions, opts, mark.ref, "ref");
            kwIsolate(kwKey("ref", mark.ref), 2);
          }
        });
        kwRefsDrawn += 1;
        kwTypedRings += 1;
        continue;
      }
      const g = kwSvg(svg, "g", {
        class: "kw-ref" + (mark.unheld ? " unheld" : ""),
        tabindex: "0", role: "button",
        "aria-label": "reference " + mark.ref
          + (mark.unheld ? ", not held" : mark.family === "finding" || mark.family === "message" ? ", held" : ""),
        "data-kw-node": mark.ref,
        "data-kw-ref": mark.ref,
        "data-kw-kind": "ref",
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
        kwDismissedRelation = (opts && opts.focusRelation) || "";
        kwPinCard(container, overview, promotions, opts, mark.ref, "ref");
        g.focus();
        kwIsolate(kwKey("ref", mark.ref), 2);
      });
      g.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          if (ev.preventDefault) ev.preventDefault();
          kwViewMoved = false;
          kwDismissed = null;
          kwDismissedRelation = (opts && opts.focusRelation) || "";
          kwPinCard(container, overview, promotions, opts, mark.ref, "ref");
          kwIsolate(kwKey("ref", mark.ref), 2);
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
        if (box.gap === false) continue;
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
    // A folded-aside endpoint meets its carrier's settled mark,
    // so folding hides members without dropping their edges.
    const asideCarrier = (ref) => {
      const aside = kwFoldedAside.get(ref);
      if (!aside || !aside.carrierRef) return null;
      return kwRefMarks.get(aside.carrierRef) || null;
    };
    const relateEnd = (end) => {
      if (end.kind === "node") return nodePos(end);
      const mark = kwRefMarks.get(end.ref) || asideCarrier(end.ref);
      return mark ? { x: mark.x, y: mark.y } : null;
    };
    // Evidence stubs draw first, under the relation strokes: where a
    // relation cites the same pair its stroke covers this one, and the
    // tag's card states both facts. The tag beside the stub is the
    // keyboard path; the stub itself carries only a title.
    for (const spec of evidenceSpecs) {
      const from = relateEnd(spec.a);
      const to = relateEnd(spec.b);
      if (!from || !to) continue;
      const bRef = spec.b.kind === "node" ? spec.b.id : spec.b.ref;
      const bKind = spec.b.kind === "node" ? kwDrawnKind(spec.b.id) : "ref";
      const g = kwSvg(edgeLayer, "g", {
        class: "kw-edge-evidence",
        "data-kind": "evidence",
        "data-from": spec.a.id,
        "data-to": bRef,
        "data-from-kind": "finding",
        "data-to-kind": bKind,
      });
      const spans = kwStubSpans(from.x, from.y, to.x, to.y);
      for (const span of spans) {
        kwSvg(g, "line", {
          x1: String(from.x + (to.x - from.x) * span[0]),
          y1: String(from.y + (to.y - from.y) * span[0]),
          x2: String(from.x + (to.x - from.x) * span[1]),
          y2: String(from.y + (to.y - from.y) * span[1]),
          stroke: "var(--muted, #5b6478)", "stroke-width": "1",
          "stroke-linecap": "round",
        });
      }
      const tip = kwSvg(g, "title", null);
      tip.textContent = "evidence for '" + spec.a.id + "'";
      kwTrackBox(Math.min(from.x, to.x), Math.min(from.y, to.y),
        Math.max(from.x, to.x), Math.max(from.y, to.y));
      kwEvidenceDrawn += 1;
    }
    for (const spec of relateSpecs) {
      const a = spec.a;
      const b = spec.b;
      const name = spec.name;
      const shown = spec.shown;
      const from = relateEnd(a);
      const to = relateEnd(b);
      if (!from || !to) continue;
      const aKind = a.kind === "node" ? kwDrawnKind(a.id) : "ref";
      const bKind = b.kind === "node" ? kwDrawnKind(b.id) : "ref";
      const aRef = a.kind === "node" ? a.id : a.ref;
      const bRef = b.kind === "node" ? b.id : b.ref;
      const g = kwSvg(edgeLayer, "g", {
        class: "kw-edge-relate",
        "data-kind": "relation",
        "data-rel-name": name,
        "data-from": aRef,
        "data-to": bRef,
        "data-from-kind": aKind,
        "data-to-kind": bKind,
        tabindex: "0",
        role: "button",
        "aria-label": "recorded relation '" + name + "' from "
          + aRef + " to " + bRef,
      });
      // Activating a relation lights its two ends and pins a card naming
      // the relation; a node pick or Escape clears it back to the canvas.
      const activate = () => {
        kwActivateEdgeEl(svg, g, opts, container, true);
      };
      g.addEventListener("click", () => {
        if (kwConsumePan()) return;
        activate();
        g.focus();
      });
      g.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          if (ev.preventDefault) ev.preventDefault();
          kwViewMoved = false;
          activate();
        }
      });
      // One drawn stroke per relation, in spans: blocked stretches drop
      // out where the stub would cross a text box. The arrowhead stays
      // on the final span. The style tuple carries the authored name.
      const tuple = kwClaimRelTuple(name);
      const spans = kwStubSpans(from.x, from.y, to.x, to.y);
      for (let si = 0; si < spans.length; si += 1) {
        const s0 = spans[si][0];
        const s1 = spans[si][1];
        const attrs = {
          x1: String(from.x + (to.x - from.x) * s0),
          y1: String(from.y + (to.y - from.y) * s0),
          x2: String(from.x + (to.x - from.x) * s1),
          y2: String(from.y + (to.y - from.y) * s1),
          stroke: tuple.ink, "stroke-width": tuple.width,
          "stroke-linecap": "round",
          opacity: "0.65",
        };
        if (tuple.dash) attrs["stroke-dasharray"] = tuple.dash;
        if (si === spans.length - 1) attrs["marker-end"] = "url(#kw-arrow-relate)";
        kwSvg(g, "line", attrs);
      }
      const tip = kwSvg(g, "title", null);
      tip.textContent = "recorded relation '" + name + "'";
      // Node-to-node edges carry the authored name at the midpoint,
      // kept back until the edge has hover or keyboard focus; a stub to
      // a tag is too short for a name, so the name lives in the edge
      // title and in the tag's card instead.
      if (shown) {
        kwMidpointsDrawn += 1;
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
    }
    // Typed edges draw last, above the relation strokes: an authored
    // claim is a solid stroke with a filled head, a recorded citation
    // a dotted stroke with an open ring at the evidence. Texture and
    // terminus differ together, so neither needs the key. Ring ends
    // meet the ring, not the label hanging below it.
    const typedEnd = (end) => {
      if (end.kind === "node") {
        if (end.drawn === "finding") return findingPos.get(end.id) || null;
        if (end.drawn === "session") return actorPos.get(end.id) || null;
        return groupPos.get(end.id) || null;
      }
      const mark = kwRefMarks.get(end.ref) || asideCarrier(end.ref);
      if (!mark) return null;
      return mark.folded ? { x: mark.x, y: mark.y } : { x: mark.x, y: mark.y - 4 };
    };
    for (const spec of typedSpecs) {
      const from = typedEnd(spec.a);
      const to = typedEnd(spec.b);
      if (!from || !to) continue;
      const authored = spec.provenance === "authored";
      // The edge carries its payload strings, so a finding end keeps
      // its finding: prefix in the attributes; lookups strip it back.
      const aRef = spec.a.ref;
      const bRef = spec.b.ref;
      const aKind = spec.a.kind === "node" ? spec.a.drawn : "ref";
      const bKind = spec.b.kind === "node" ? spec.b.drawn : "ref";
      const words = authored ? "authored claim" : "recorded evidence";
      const gAttrs = {
        class: "kw-edge-typed " + (authored ? "kw-edge-authored" : "kw-edge-cited"),
        "data-kind": "typed",
        "data-provenance": spec.provenance,
        "data-from": aRef,
        "data-to": bRef,
        "data-from-kind": aKind,
        "data-to-kind": bKind,
        tabindex: "0",
        role: "button",
        "aria-label": words + (spec.relation ? " '" + spec.relation + "'" : "")
          + " from " + aRef + " to " + bRef,
      };
      if (spec.edgeId) gAttrs["data-edge"] = spec.edgeId;
      // The relation name rides along for shell focus: a focused
      // relation lights its drawing whichever source drew it.
      if (spec.relation) gAttrs["data-rel-name"] = spec.relation;
      const g = kwSvg(edgeLayer, "g", gAttrs);
      const activate = () => {
        kwActivateEdgeEl(svg, g, opts, container, true);
      };
      g.addEventListener("click", () => {
        if (kwConsumePan()) return;
        activate();
        g.focus();
      });
      g.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          if (ev.preventDefault) ev.preventDefault();
          kwViewMoved = false;
          activate();
        }
      });
      const spans = kwStubSpans(from.x, from.y, to.x, to.y);
      for (let si = 0; si < spans.length; si += 1) {
        const s0 = spans[si][0];
        const s1 = spans[si][1];
        const attrs = {
          x1: String(from.x + (to.x - from.x) * s0),
          y1: String(from.y + (to.y - from.y) * s0),
          x2: String(from.x + (to.x - from.x) * s1),
          y2: String(from.y + (to.y - from.y) * s1),
          stroke: "var(--ink, #141a26)", "stroke-width": "1.5",
          "stroke-linecap": "round",
        };
        if (!authored) attrs["stroke-dasharray"] = "2 2.5";
        if (si === spans.length - 1) {
          attrs["marker-end"] = "url(#" + (authored ? "kw-arrow-authored" : "kw-arrow-cited") + ")";
        }
        kwSvg(g, "line", attrs);
      }
      const tip = kwSvg(g, "title", null);
      tip.textContent = words + (spec.relation ? " '" + spec.relation + "'" : "");
      kwTrackBox(Math.min(from.x, to.x), Math.min(from.y, to.y),
        Math.max(from.x, to.x), Math.max(from.y, to.y));
      if (authored) kwTypedAuthored += 1;
      else kwTypedCited += 1;
    }
    if (query) {
      for (const [ref, mark] of kwRefMarks) {
        const names = mark.relations.map((rel) => rel.name).join(" ");
        const g = svg.querySelector('g.kw-ref[data-kw-ref="' + CSS.escape(ref) + '"][data-kw-kind="ref"]');
        if (!g) continue;
        // A folded carrier matches when any waiting member matches,
        // so a query can find a reference inside a folded fan.
        const foldedHit = mark.folded && (mark.folded.refs || [])
          .some((r) => kwMatches(query, r, "", ""));
        if (!kwMatches(query, ref, names, "") && !foldedHit) g.classList.add("kw-dim");
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
    for (const g of svg.querySelectorAll("g.kw-anchor, g.knode, g.kw-cluster, g.kw-ref, g.kw-group")) {
      g.addEventListener("mouseover", () => kwIsolate(kwNodeKey(g)));
      g.addEventListener("mouseleave", kwClearIsolation);
      // The selected anchor keeps its two-hop read across re-renders;
      // every other focus reads one hop.
      g.addEventListener("focus", () => {
        const sel = kwEffectiveSelected(opts);
        kwIsolate(kwNodeKey(g), kwKey(kwSelKind(overview, sel), sel) === kwNodeKey(g) ? 2 : 1);
      });
      g.addEventListener("blur", kwClearIsolation);
    }
    // A background click or Escape returns to the overview: the card
    // for this selection stays hidden until the selection changes, and
    // any isolation clears. Node clicks re-pin, so they clear first.
    const kwDismiss = () => {
      const current = kwEffectiveSelected(opts);
      if (current) kwDismissed = current;
      // A shell-named relation is dismissed like a selection: the next render
      // keeps it hidden until the shell names another one.
      kwDismissedRelation = (opts && opts.focusRelation) || "";
      const card = container.querySelector(".kw-card");
      if (card) card.remove();
      kwClearIsolation();
      // The walk clears with the card: steps, lit edge and direction
      // all belong to the dismissed reading.
      kwWalk = [];
      kwWalkExpanded = false;
      kwLitEdge = null;
      kwDirection = "all";
      kwClearDirection();
      kwRefreshWalkChrome(container);
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
    // The edge key is one disclosure of edge samples from the same
    // marker table that draws the arrowheads, so it cannot drift from
    // the drawing. Each sample mirrors its edge's shape, ink, dash and
    // head, and the relation's name stands beside it: a legend is a
    // decoder, and the name is the vocabulary a reader has no other way
    // to learn. The swatch carries the stroke, so rows carry names only.
    // Relation rows key only what the canvas draws, one row per drawn
    // name; kind rows key drawn families with their counts.
    const keyEntries = (layout.markers || []).slice();
    const kwRelNames = Array.from(kwRelStyleDrawn.keys());
    const kwRelShown = kwRelationsExpanded ? kwRelNames : kwRelNames.slice(0, KW_KEY_RELATIONS);
    for (const relName of kwRelShown) {
      const t = KW_REL_TUPLES[kwRelStyleDrawn.get(relName)];
      keyEntries.push(["kw-arrow-relate", relName, t.ink, "relate", t.dash, t.width]);
    }
    if (kwRelNames.length > KW_KEY_RELATIONS) {
      keyEntries.push({ toggle: true });
    }
    // An empty relation collection reads as empty, not as a drawing
    // that failed: the row states the absence the canvas cannot show.
    if ((overview.relations || []).length === 0) {
      keyEntries.push(["", "no recorded relations",
        "var(--ink, #141a26)", "empty", ""]);
    }
    if (kwEvidenceDrawn > 0) {
      keyEntries.push(["", "evidence",
        "var(--muted, #5b6478)", "evline", ""]);
    }
    // Typed rows key only drawn provenance: a payload without typed
    // edges adds no row, so the key reads exactly as before. Edges
    // with no drawn end count as outside rather than vanishing.
    if (kwTypedAuthored > 0) {
      keyEntries.push(["kw-arrow-authored", "authored claim",
        "var(--ink, #141a26)", "authored", ""]);
    }
    if (kwTypedCited > 0) {
      keyEntries.push(["kw-arrow-cited", "recorded evidence",
        "var(--ink, #141a26)", "cited", "2 2.5"]);
    }
    if (kwTypedRings > 0) {
      keyEntries.push(["", "typed endpoint, open when the record is not held",
        "var(--ink, #141a26)", "typering", ""]);
    }
    if (kwTypedOutside > 0) {
      keyEntries.push(["", kwTypedOutside + " typed edge"
        + (kwTypedOutside === 1 ? "" : "s") + " outside the drawn tiers",
        "var(--ink, #141a26)", "empty", ""]);
    }
    // One row per drawn kind family, with its count; the drawn kinds
    // stand named in the row's title, and the card names the kind of the
    // finding it pins. The swatch mirrors the family's first-drawn shape
    // with its ring treatment, so the row keys only what draws.
    const kwFamilyRows = new Map();
    for (const [kindName, kindShape] of kwKindsDrawn) {
      const fam = kwFamilyFor(kindName);
      if (!kwFamilyRows.has(fam)) kwFamilyRows.set(fam, { shape: kindShape, names: [] });
      kwFamilyRows.get(fam).names.push(kindName);
    }
    for (const fam of ["records", "resolutions", "open", "other"]) {
      const row = kwFamilyRows.get(fam);
      if (!row) continue;
      keyEntries.push(["", fam + " · " + row.names.length
        + (row.names.length === 1 ? " kind" : " kinds"),
        "var(--ink, #141a26)", "family:" + row.shape + ":" + fam, "",
        row.names.join(", ")]);
    }
    // One row for every drawn group node, named in the title; without a
    // drawn group there is no row.
    if (groupsDrawn.length) {
      keyEntries.push(["", "groups · " + groupsDrawn.length
        + (groupsDrawn.length === 1 ? " group" : " groups"),
        "var(--ink, #141a26)", "groupnode", "", groupsDrawn.join(", ")]);
    }
    if (kwRefsDrawn > 0) {
      keyEntries.push(["", "tagged recorded reference, dashed when the record is not held",
        "var(--ink, #141a26)", "tag", ""]);
      keyEntries.push(["", "diamond message, square external, ring finding, dot other",
        "var(--ink, #141a26)", "glyphs", ""]);
    }
    // The key folds behind one disclosure: the button names which
    // vocabularies wait inside, and the rows stay in the document
    // whether open or shut, so counts read the same either way. The
    // edge-name note sits beside the button, visible at rest, since a
    // folded key cannot carry the affordance.
    const kwKeyParts = [];
    {
      let edges = false, families = false, groups = false, marks = false;
      for (const entry of keyEntries) {
        if (!entry || entry.toggle) continue;
        const shape = String(entry[3] || "");
        if (shape === "line" || shape === "arc" || shape === "relate" || shape === "evline" || shape === "authored" || shape === "cited") edges = true;
        else if (shape.indexOf("family:") === 0) families = true;
        else if (shape === "groupnode") groups = true;
        else if (shape === "tag" || shape === "glyphs" || shape === "typering") marks = true;
      }
      if (edges) kwKeyParts.push("edges");
      if (families) kwKeyParts.push("families");
      if (groups) kwKeyParts.push("groups");
      if (marks) kwKeyParts.push("marks");
    }
    const kwKeyBtn = kwEl(container, "button", {
      class: "kw-key-toggle kw-key-fold mono", type: "button",
      "data-kw-key-toggle": "key",
      "aria-expanded": kwKeyOpen ? "true" : "false",
    });
    kwKeyBtn.textContent = "Key · " + kwKeyParts.join(", ");
    kwKeyBtn.addEventListener("click", () => {
      kwKeyOpen = !kwKeyOpen;
      if (kwLastRender) {
        renderKnowledge(kwLastRender.container, kwLastRender.data, kwLastRender.opts);
        const next = kwLastRender.container.querySelector('[data-kw-key-toggle="key"]');
        if (next && typeof next.focus === "function") next.focus();
      }
    });
    if (kwMidpointsDrawn > 0) {
      const kwKeyNote = kwEl(container, "p", { class: "kw-legend-note muted" });
      kwKeyNote.textContent = "Edge names appear on hover or focus.";
    }
    // The exemplar teaches the transfer nouns on one real chain: the
    // first promotion whose three ends all draw, with the canvas's own
    // glyphs and arrowheads. Nothing drawable, nothing shown.
    let kwExemplar = null;
    for (const p of promotions || []) {
      const fid = p ? String(p.finding || "") : "";
      const src = p ? String(p.source || "") : "";
      const dst = p ? String(p.destination || "") : "";
      const held = (id) => actorPos.has(id) || groupPos.has(id);
      if (fid && src && dst && findingPos.has(fid) && held(src) && held(dst)) {
        kwExemplar = { fid, src, dst };
        break;
      }
    }
    if (kwExemplar) {
      const ex = kwEl(container, "div", { class: "kw-exemplar", role: "img",
        "aria-label": "How to read a transfer: " + kwExemplar.src
          + " shares finding " + kwExemplar.fid + " to " + kwExemplar.dst + "." });
      const em = kwSvg(ex, "svg", { class: "kw-exemplar-map",
        width: "264", height: "88", "aria-hidden": "true" });
      const glyph = (x, id) => {
        if (groupPos.has(id)) {
          kwSvg(em, "rect", { x: String(x - 6), y: "28",
            width: "12", height: "12", class: "kw-group-box" });
        } else if (findingPos.has(id)) {
          kwSvg(em, "circle", { cx: String(x), cy: "34", r: "5", class: "kw-finding" });
        } else {
          kwSvg(em, "rect", { x: String(x - 5), y: "29",
            width: "10", height: "10", class: "kw-actor" });
        }
      };
      glyph(34, kwExemplar.src);
      glyph(132, kwExemplar.fid);
      glyph(230, kwExemplar.dst);
      kwSvg(em, "path", { d: "M36,32 Q83,6 130,32", fill: "none",
        stroke: "var(--attention, #a2611f)", "stroke-width": "1.5",
        "marker-end": "url(#kw-arrow-share)" });
      kwSvg(em, "path", { d: "M134,32 Q181,6 228,32", fill: "none",
        stroke: "var(--muted, #5b6478)", "stroke-width": "1.5",
        "marker-end": "url(#kw-arrow-deliver)" });
      const word = (x, y, text, muted) => {
        const t = kwSvg(em, "text", { x: String(x), y: String(y),
          class: muted ? "kw-exemplar-word muted" : "kw-exemplar-word mono",
          "text-anchor": "middle" });
        t.textContent = text;
      };
      const short = (id) => id.length > 12 ? id.slice(0, 11) + "…" : id;
      word(83, 16, "share", true);
      word(181, 16, "deliver", true);
      word(34, 58, short(kwExemplar.src), false);
      word(132, 58, short(kwExemplar.fid), false);
      word(230, 58, short(kwExemplar.dst), false);
      word(132, 80, "how to read a transfer", true);
    }
    const keys = kwEl(container, "ul", { class: "kw-legend-keys muted" });
    if (!kwKeyOpen) keys.setAttribute("hidden", "");
    // Base rows shorten to their relation's name; the swatch carries
    // the stroke. The marker table itself stays verbose for its titles.
    const kwMarkerShort = {
      "kw-arrow-author": "authorship", "kw-arrow-share": "sharing",
      "kw-arrow-deliver": "delivery", "kw-arrow-promote": "promotion",
    };
    for (const entry of keyEntries) {
      // The relation disclosure sits among the relation rows: it states
      // how many wait behind it, re-renders like a cluster badge, and
      // keeps focus on itself across the render.
      if (entry && entry.toggle) {
        const rest = kwRelStyleDrawn.size - KW_KEY_RELATIONS;
        const row = kwEl(keys, "li", null);
        const btn = kwEl(row, "button", {
          class: "kw-key-toggle mono", type: "button", "data-kw-key-toggle": "relations",
        });
        btn.textContent = kwRelationsExpanded ? "fewer relations"
          : rest + " more relation" + (rest === 1 ? "" : "s");
        btn.addEventListener("click", () => {
          kwRelationsExpanded = !kwRelationsExpanded;
          if (kwLastRender) {
            renderKnowledge(kwLastRender.container, kwLastRender.data, kwLastRender.opts);
            const next = kwLastRender.container.querySelector('[data-kw-key-toggle="relations"]');
            if (next && typeof next.focus === "function") next.focus();
          }
        });
        continue;
      }
      const item = kwEl(keys, "li", null);
      const sw = kwSvg(item, "svg", {
        class: "kw-legend-swatch", width: "26", height: "12", "aria-hidden": "true",
      });
      const paint = String(entry[2] || "currentcolor");
      const shape = String(entry[3] || "line");
      const dash = String(entry[4] || "");
      if (shape === "relate") {
        const ln = kwSvg(sw, "line", {
          x1: "4", y1: "9", x2: "22", y2: "3", stroke: paint,
          "stroke-width": String(entry[5] || "2"),
          "stroke-linecap": "round", opacity: "0.65",
          "marker-end": "url(#" + String(entry[0]) + ")",
        });
        if (dash) ln.setAttribute("stroke-dasharray", dash);
      } else if (shape.indexOf("family:") === 0) {
        const bits = shape.split(":");
        const ks = bits[1] || "circle";
        const fam = bits[2] || "records";
        if (ks === "circle") {
          kwSvg(sw, "circle", { cx: "13", cy: "6", r: "4.5", fill: paint });
        } else {
          kwSvg(sw, "path", { d: kwShapePath(ks, 13, 6, 4.5), fill: paint });
        }
        if (fam === "resolutions" || fam === "open") {
          const ring = kwSvg(sw, "circle", {
            cx: "13", cy: "6", r: "6", fill: "none", stroke: paint, "stroke-width": "1",
          });
          if (fam === "open") ring.setAttribute("stroke-dasharray", "2 2");
        }
      } else if (shape === "groupnode") {
        kwSvg(sw, "rect", {
          x: "6", y: "1", width: "14", height: "10",
          fill: "var(--paper, #fbfcfe)", stroke: paint, "stroke-width": "1.5",
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
      } else if (shape === "evline") {
        kwSvg(sw, "line", {
          x1: "3", y1: "9", x2: "23", y2: "3", stroke: paint, "stroke-width": "1",
        });
      } else if (shape === "authored" || shape === "cited") {
        const ln = kwSvg(sw, "line", {
          x1: "3", y1: "9", x2: "20", y2: "4", stroke: paint, "stroke-width": "1.5",
          "stroke-linecap": "round",
          "marker-end": "url(#" + String(entry[0]) + ")",
        });
        if (dash) ln.setAttribute("stroke-dasharray", dash);
      } else if (shape === "typering") {
        kwSvg(sw, "circle", {
          cx: "13", cy: "6", r: "4", fill: "none", stroke: paint, "stroke-width": "1.5",
        });
      } else if (shape === "empty") {
        // An absence keys no mark, so it carries no swatch.
        sw.remove();
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
      // A family row carries its drawn kind names in its title, so a
      // reader who asks learns exactly which kinds the count covers.
      if (typeof entry[6] === "string" && entry[6]) item.setAttribute("title", entry[6]);
      const words = kwEl(item, "span", { class: "kw-legend-words" });
      const short = (shape === "line" || shape === "arc") ? kwMarkerShort[String(entry[0])] : "";
      words.textContent = (short || String(entry[1])) + ". ";
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
    for (const [id, pos] of actorPos) kwNodePos.set(kwKey("session", id), { x: pos.x, y: pos.y, kind: "session" });
    for (const [id, pos] of findingPos) kwNodePos.set(kwKey("finding", id), { x: pos.x, y: pos.y, kind: "finding" });
    for (const [id, pos] of groupPos) kwNodePos.set(kwKey("group", id), { x: pos.x, y: pos.y, kind: "group" });
    kwMapChrome(container, svg, view, overview, promotions, opts, ensembles || []);
    kwPinCard(container, overview, promotions, opts);
    // The selected neighborhood lights on every render, not only when
    // focus happens to be restored onto the map: choosing an actor moves
    // shell focus to its roster row, which would otherwise leave the map
    // dark. A dismissed selection stays an overview until it changes.
    const shown = kwEffectiveSelected(opts);
    if (shown && kwDismissed !== shown) kwIsolate(kwKey(kwSelKind(overview, shown), shown), 2);
    // The lit edge re-lights ahead of the shell's relation focus, so
    // a shell focus still wins the canvas when both name an edge.
    kwRelightLit(container, svg);
    // A shell-focused relation lights its drawn edges and keeps its card
    // naming it. The name plus the shell's activation count is the
    // identity, and an absent count reads as zero: an activation reopens
    // the card even for the relation already named, a dismissal survives
    // a render naming the same relation with the same count, and a new
    // name or a new count clears the dismissal. Node picks, Escape and
    // background clicks dismiss through the paths below, untouched.
    const fr = (opts && opts.focusRelation) || "";
    const frSeq = (opts && opts.focusRelationSeq) || 0;
    if (fr !== kwSeenFocusRelation || frSeq !== kwSeenFocusSeq) {
      kwSeenFocusRelation = fr;
      kwSeenFocusSeq = frSeq;
      kwDismissedRelation = "";
    }
    if (fr && fr !== kwDismissedRelation) {
      // Focus follows the relation onto whichever source drew it:
      // the compatibility stroke or the typed edge.
      const edges = Array.from(svg.querySelectorAll("g.kw-edge-relate, g.kw-edge-typed"))
        .filter((e) => e.getAttribute("data-rel-name") === fr);
      const first = edges[0];
      const ends = first ? [
        { kind: first.getAttribute("data-from-kind") || "", id: first.getAttribute("data-from") || "" },
        { kind: first.getAttribute("data-to-kind") || "", id: first.getAttribute("data-to") || "" },
      ] : [];
      if (edges.length) kwLightRelation(svg, { name: fr, ends });
      kwPinRelCard(container, fr, ends, opts);
    }
    // Provenance dim runs last and only adds dim, so it composes
    // with isolation and focus: with "citations only" pressed,
    // every edge but the cited ones dims, with the nodes no cited
    // edge touches. Direction re-applies around the still-lit edge,
    // or clears when its edge no longer draws.
    if (kwProvCitedOnly) {
      const keep = new Set();
      for (const e of edgeLayer.children) {
        // A citation is either typed shape: the cited edge, or the
        // evidence stub where the compat payload names the same fact
        // with no typed edge beside it.
        const cited = e.classList
          && (e.classList.contains("kw-edge-cited")
            || e.getAttribute("data-kind") === "evidence");
        if (!cited) {
          if (e.classList) e.classList.add("kw-dim");
          continue;
        }
        for (const side of ["from", "to"]) {
          const k = e.getAttribute("data-" + side + "-kind") || "";
          const raw = e.getAttribute("data-" + side) || "";
          if (raw) keep.add(kwKey(k, kwTypedLookupId(k, raw)));
        }
      }
      for (const g of svg.querySelectorAll("g.kw-anchor, g.knode, g.kw-cluster, g.kw-ref, g.kw-group")) {
        if (!keep.has(kwNodeKey(g))) g.classList.add("kw-dim");
      }
    }
    kwApplyDirection(container);
    // The macro band goes first in the document: census, then field,
    // then the canvas micro reading, tools and key after.
    kwMacroBand(container, svg, tiers, promotions, layout.width || 0);
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
    // A frame smaller than its own chrome leaves no visible drawing;
    // the box bottoms out at zero rather than going negative.
    return {
      w: Math.max(0, (right - left) / s.x),
      h: Math.max(0, (bottom - top) / s.y),
    };
  }

  // Centre the drawn content and scale it to fit the visible frame.
  function kwFitView(container, svg, view) {
    const box = kwVisibleBox(container, svg);
    // Fitting into nothing would collapse the view, so when the chrome
    // leaves no visible drawing Fit holds the current view unchanged.
    if (box.w <= 0 || box.h <= 0) return;
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
    // Typing rebuilds the status and the match list in place; only Enter
    // or a row activation moves the view.
    search.addEventListener("input", () => {
      kwSearchText = search.value;
      kwSearchQuery = search.value;
      kwSearchLive(container, overview);
    });
    search.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        kwSearchCentre(container, view, overview, search.value, opts, ensembles || []);
      }
    });
    // Walk bar and direction control sit under the search box, ahead
    // of the status; both build from layer state, so re-renders keep
    // them without further wiring.
    kwBuildWalkBar(tools, container, svg, opts, null);
    kwBuildDirection(tools, container, null);
    const status = kwEl(tools, "p", {
      class: "kw-search-status muted",
      role: "status",
    });
    if (typeof kwSearchStatus === "number") kwRenderCount(status, kwSearchStatus);
    else status.textContent = kwSearchStatus;
    // The match list sits between the status and the buttons, so the tab
    // order reads search box, rows, buttons, canvas nodes.
    kwRenderMatchList(tools, { container, view, overview, opts, ensembles: ensembles || [] });
    // Provenance dim joins search as a dim pass: with "citations
    // only" pressed, every edge but the cited ones dims at render,
    // with the nodes no cited edge touches.
    const provBtn = kwEl(tools, "button", {
      class: "kw-prov mono", type: "button",
      "aria-pressed": kwProvCitedOnly ? "true" : "false",
      "aria-label": "Show only citations",
      "data-kw-prov": "cited",
    });
    provBtn.textContent = "citations only";
    provBtn.addEventListener("click", () => {
      kwProvCitedOnly = !kwProvCitedOnly;
      if (kwLastRender) {
        renderKnowledge(kwLastRender.container, kwLastRender.data, kwLastRender.opts);
        const next = kwLastRender.container.querySelector('[data-kw-prov="cited"]');
        if (next && typeof next.focus === "function") next.focus();
      }
    });
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
    // The frame clips the tall drawing, so the chrome leads the mount:
    // tools, key, then canvas, all reachable in document order.
    const keys = container.querySelector(".kw-legend-keys");
    if (keys) container.insertBefore(keys, svg);
    container.insertBefore(tools, svg);
  }

  // Search states how many records match, lists every match under the
  // box, centres the first match and pins its card before selecting it.
  // A hit inside a collapsed cluster or ensemble expands it first,
  // whether the hit is a finding or an actor; a hit with no drawn
  // position says so instead of pretending. An expansion re-renders the
  // canvas, so the view node is re-acquired after it rather than reused.
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

  // The shared matcher: findings by id, claim or author, then actors
  // by id. The status, the list and the first-match path all read it.
  function kwSearchMatches(overview, q) {
    const matches = (f) => String(f.id).toLowerCase().includes(q)
      || String(f.claim || "").toLowerCase().includes(q)
      || String(f.author || "").toLowerCase().includes(q);
    const findings = overview.findings || [];
    const actors = Object.keys(overview.actors || {});
    return {
      hits: findings.filter(matches),
      actorHits: actors.filter((id) => id.toLowerCase().includes(q)),
    };
  }

  function kwSayStatus(container, text) {
    kwSearchStatus = text;
    const status = container.querySelector(".kw-search-status");
    if (status) {
      status.classList.remove("has-count");
      status.textContent = text;
    }
  }

  function kwSayCount(container, total) {
    kwSearchStatus = total;
    const status = container.querySelector(".kw-search-status");
    if (status) kwRenderCount(status, total);
  }

  // Typing updates the status and the list without moving the view.
  function kwSearchLive(container, overview) {
    const q = String(kwSearchQuery || "").trim().toLowerCase();
    if (!q) {
      kwSayStatus(container, "");
      kwClearMatchList(container);
      return;
    }
    const found = kwSearchMatches(overview, q);
    const total = found.hits.length + found.actorHits.length;
    if (!total) {
      kwSayStatus(container, "No match for '" + String(kwSearchQuery || "").trim() + "'");
      kwClearMatchList(container);
      return;
    }
    kwSayCount(container, total);
    const tools = container.querySelector(".kw-maptools");
    if (!tools) return;
    const lr = kwLastRender || {};
    kwRenderMatchList(tools, {
      container,
      view: container.querySelector("g.kw-view"),
      overview,
      opts: lr.opts,
      ensembles: (lr.data && lr.data.ensembles) || [],
    });
  }

  function kwClearMatchList(container) {
    const old = container.querySelector(".kw-match-list");
    if (old) old.remove();
  }

  function kwMarkMatchCurrent(container) {
    const rows = container.querySelectorAll(".kw-match");
    for (const b of rows) {
      const current = b.getAttribute("data-kw-match-id") === kwSearchCurrent;
      b.classList.toggle("kw-match-current", current);
      if (current) b.setAttribute("aria-current", "true");
      else b.removeAttribute("aria-current");
    }
  }

  // One row per match under the search box: kind, actor or scope, and a
  // short claim snippet, every character through textContent. A match
  // with no drawn position says so in its row. The centred row carries
  // aria-current. Rebuilt from the committed query on every render, so
  // expansion and scope changes keep it honest.
  function kwRenderMatchList(tools, ctx) {
    const old = tools.querySelector(".kw-match-list");
    if (old) old.remove();
    const q = String(kwSearchQuery || "").trim().toLowerCase();
    if (!q) return;
    const overview = ctx.overview || {};
    const found = kwSearchMatches(overview, q);
    if (!found.hits.length && !found.actorHits.length) return;
    const list = kwEl(tools, "ul", { class: "kw-match-list", "aria-label": "Search matches" });
    const actors = overview.actors || {};
    const row = (kind, id, typeWords, textWords, titleWords) => {
      const li = kwEl(list, "li", null);
      const b = kwEl(li, "button", {
        class: "kw-match" + (kwSearchCurrent === id ? " kw-match-current" : ""),
        type: "button",
        "data-kw-match-kind": kind,
        "data-kw-match-id": id,
      });
      if (kwSearchCurrent === id) b.setAttribute("aria-current", "true");
      const type = kwEl(b, "span", { class: "kw-match-type" });
      type.textContent = typeWords;
      const text = kwEl(b, "span", { class: "kw-match-text" });
      text.textContent = textWords;
      text.setAttribute("title", titleWords || textWords);
      // Match rows name their kind outright; actor rows read the
      // session side of the position map.
      if (!kwNodePos.has(kwKey(kind === "actor" ? "session" : kind, id))) {
        const note = kwEl(b, "span", { class: "kw-match-note" });
        note.textContent = "outside the drawn tiers";
      }
      b.addEventListener("click", () => { kwGoToMatch(ctx, { kind, id }); });
    };
    for (const f of found.hits) {
      const claim = String(f.claim || f.id);
      row("finding", String(f.id), "finding · " + String(f.author || "unknown"),
        claim.length > 90 ? claim.slice(0, 89) + "…" : claim, claim);
    }
    for (const id of found.actorHits) {
      const held = actors[id] || {};
      const bits = [String(id)];
      if (held.authored) bits.push(held.authored + " authored");
      if (held.received) bits.push(held.received + " received");
      row("actor", String(id), "actor", bits.join(" · "));
    }
    // The list reads between the status and the buttons in tab order.
    const firstBtn = tools.querySelector(".kw-zoom");
    if (firstBtn) tools.insertBefore(list, firstBtn);
  }

  // Centre one match and pin its card: expansion of a collapsed cluster
  // or ensemble, the card, focus, isolation and shell selection, exactly
  // as the first-match path. A match with no drawn position says so and
  // leaves the current mark where it was.
  function kwGoToMatch(ctx, match) {
    const container = ctx.container;
    const overview = ctx.overview || {};
    const opts = ctx.opts;
    const ensembles = ctx.ensembles || [];
    const findings = overview.findings || [];
    const hit = match.kind === "finding"
      ? findings.find((f) => String(f.id) === String(match.id)) || null : null;
    const actorHit = match.kind === "actor" ? match.id : null;
    const id = hit ? hit.id : match.id;
    let live = ctx.view;
    const rerendered = () => {
      if (kwLastRender) {
        renderKnowledge(kwLastRender.container, kwLastRender.data, kwLastRender.opts);
        live = container.querySelector("g.kw-view") || ctx.view;
      }
    };
    if (hit) {
      const author = String(hit.author || "");
      // A group scope clusters every held finding under its group, so
      // the cluster owner is the group key, not the session author.
      const scopeOwner = kwScopeGroup(overview);
      const clusterOwner = scopeOwner ? kwKey("group", scopeOwner) : kwKey("session", author);
      const authored = scopeOwner ? findings
        : findings.filter((f) => String(f.author || "") === author);
      if (authored.length > KW_CLUSTER_AT && !kwExpandedAuthors.has(clusterOwner)
        && !kwNodePos.has(kwKey("finding", hit.id))) {
        kwExpandedAuthors.add(clusterOwner);
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
    const gotoKind = hit ? "finding" : "session";
    const pos = kwNodePos.get(kwKey(gotoKind, id));
    if (!pos || !live) {
      kwSayStatus(container, "'" + String(id) + "' is outside the drawn tiers");
      return null;
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
    kwDismissedRelation = (opts && opts.focusRelation) || "";
    kwPinCard(container, overview, overview.promotions || [], opts, id, gotoKind);
    const node = hit
      ? container.querySelector('[data-kw-node="' + CSS.escape(id) + '"][data-kw-kind="finding"]')
      : container.querySelector('[data-kw-id="' + CSS.escape(id) + '"][data-kw-kind="session"]');
    if (node && typeof node.focus === "function") node.focus();
    if (canvas) kwIsolateSvg(canvas, kwKey(gotoKind, id), 2);
    if (hit && opts && typeof opts.onSelectFinding === "function") {
      opts.onSelectFinding(hit.id);
    } else if (actorHit && opts && typeof opts.onSelectActor === "function") {
      opts.onSelectActor(actorHit);
    }
    kwSearchCurrent = String(id);
    kwMarkMatchCurrent(container);
    return id;
  }

  function kwSearchCentre(container, view, overview, query, opts, ensembles) {
    const text = String(query || "").trim();
    kwSearchText = text;
    kwSearchQuery = text;
    const q = text.toLowerCase();
    if (!q) {
      kwSayStatus(container, "");
      kwClearMatchList(container);
      return;
    }
    const found = kwSearchMatches(overview, q);
    const total = found.hits.length + found.actorHits.length;
    if (!total) {
      kwSayStatus(container, "No match for '" + text + "'");
      kwClearMatchList(container);
      return;
    }
    kwSayCount(container, total);
    const ctx = { container, view, overview, opts, ensembles: ensembles || [] };
    const tools = container.querySelector(".kw-maptools");
    if (tools) kwRenderMatchList(tools, ctx);
    const first = found.hits[0]
      ? { kind: "finding", id: found.hits[0].id }
      : { kind: "actor", id: found.actorHits[0] };
    kwGoToMatch(ctx, first);
  }

  // The pinned detail card: the current selection rendered on the map
  // itself, derived from the same opts every render so it follows the
  // shell instead of fighting it. Node gestures and search pin through
  // the same function with an explicit id before notifying the shell,
  // so the card stands even when the shell skips its re-render because
  // the selection did not change; a re-render rebuilds it either way.
  // A fresh card shell: the old card goes, and the mount holds still
  // for absolute placement. Node and relation cards share it.
  function kwOpenCard(container) {
    const old = container.querySelector(".kw-card");
    if (old) old.remove();
    // In flow directly below the canvas: the drawing above never
    // shifts when the card opens, and the column grows below it.
    const card = kwEl(container, "div", { class: "kw-card" });
    const svg = container.querySelector("svg.kw-canvas");
    if (svg) container.insertBefore(card, svg.nextSibling);
    return card;
  }

  function kwPinCard(container, overview, promotions, opts, id, kind) {
    const sel = id !== undefined ? id : kwEffectiveSelected(opts);
    if (!sel || kwDismissed === sel) return;
    // Canvas picks name their kind outright; a shell selection resolves
    // by recorded membership. Either way the id's text never decides.
    const selKind = kind !== undefined ? kind : kwSelKind(overview, sel);
    const findings = overview.findings || [];
    const found = findings.find((f) => f.id === sel);
    const actors = overview.actors || {};
    const ref = kwRefMarks.get(sel);
    const known = selKind === "finding" ? !!found
      : selKind === "session" ? !!actors[sel]
      : selKind === "ref" ? !!ref : selKind === "group";
    if (!known) return;
    // An explicit node pick ends the edge reading: the direction
    // control belongs to a lit edge, so it goes with it. The walk
    // itself stands: junction rows extend it from here. A render-end
    // re-pin names no pick, so the lit edge, direction and walk all
    // survive the round trip.
    if (id !== undefined) {
      kwLitEdge = null;
      kwDirection = "all";
      kwClearDirection();
      kwRefreshWalkChrome(container);
    }
    const card = kwOpenCard(container);
    if (selKind === "finding") {
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
        // Group ends read with their kind word from the recorded kinds,
        // so a group never hides behind a session's literal id.
        const send = String(step.sourceKind || "session") === "group"
          ? "group " + step.source : String(step.source || "?");
        const dend = String(step.destinationKind || "session") === "group"
          ? "group " + step.destination : String(step.destination || "?");
        kwEl(refs, "p", { class: "kw-card-ref mono" },
          send + " → " + dend
          + (step.promotedBy ? " via " + String(step.promotedBy) : ""));
      }
      // The card is a glance; the button opens the record at this
      // finding through the shell hook. Without the hook there is no
      // button: no control on the card may do nothing.
      if (opts && typeof opts.onOpenRecord === "function") {
        const open = kwEl(card, "button", { class: "kw-card-open", type: "button" },
          "Read the full record");
        open.addEventListener("click", () => { opts.onOpenRecord(found.id); });
      }
    } else if (selKind === "session") {
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
    } else if (selKind === "ref") {
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
      // A typed endpoint states its recorded kind. The delivery
      // pointer in the node record states no read state, so the card
      // states none either. Absent fields state nothing.
      if (ref.typed && ref.typed.kind) {
        kwEl(card, "p", { class: "kw-card-fact" }, "kind: " + String(ref.typed.kind));
      }
      const refs = kwEl(card, "div", { class: "kw-card-refs" });
      for (const rel of ref.relations) {
        const other = String(rel.other);
        const shown = other.length > 32 ? other.slice(0, 31) + "…" : other;
        const item = kwEl(refs, "p", { class: "kw-card-ref mono" });
        const t = kwRelTuple(rel.name);
        const sw = kwSvg(item, "svg", {
          class: "kw-rel-swatch", width: "26", height: "12", "aria-hidden": "true",
        });
        const ln = kwSvg(sw, "line", {
          x1: "1", y1: "9", x2: "25", y2: "3", stroke: t.ink, "stroke-width": t.width,
          "stroke-linecap": "round", opacity: "0.65", "marker-end": "url(#kw-arrow-relate)",
        });
        if (t.dash) ln.setAttribute("stroke-dasharray", t.dash);
        const words = kwEl(item, "span", null);
        words.textContent = String(rel.name) + " — " + shown;
      }
      for (const ev of ref.evidenceOf || []) {
        const item = kwEl(refs, "p", { class: "kw-card-ref mono" });
        const sw = kwSvg(item, "svg", {
          class: "kw-rel-swatch", width: "26", height: "12", "aria-hidden": "true",
        });
        kwSvg(sw, "line", {
          x1: "1", y1: "9", x2: "25", y2: "3",
          stroke: "var(--muted, #5b6478)", "stroke-width": "1",
          "stroke-linecap": "round",
        });
        const words = kwEl(item, "span", null);
        words.textContent = "evidence for " + String(ev);
      }
      // Junction rows: every drawn edge touching this reference, in
      // and out, computed from the drawing. Each row is a keyboard
      // stop that lights its edge and extends the walk; the incoming
      // half is the "cited by" list. The rows live in the card's
      // page flow, which keeps no scroller.
      const canvas = container.querySelector("svg.kw-canvas");
      if (canvas) {
        const touching = canvas.querySelectorAll(
          'g.kw-edges > g[data-from="' + CSS.escape(sel) + '"],'
          + 'g.kw-edges > g[data-to="' + CSS.escape(sel) + '"]');
        for (const e of touching) {
          const out = (e.getAttribute("data-from") || "") === sel;
          const otherRaw = out ? (e.getAttribute("data-to") || "")
            : (e.getAttribute("data-from") || "");
          const otherKind = out ? (e.getAttribute("data-to-kind") || "")
            : (e.getAttribute("data-from-kind") || "");
          const rel = e.getAttribute("data-rel-name") || "";
          const prov = e.getAttribute("data-provenance") || "";
          const what = rel || (prov === "recorded-evidence" ? "recorded evidence"
            : prov === "authored" ? "authored claim"
            : (e.getAttribute("data-kind") || "edge"));
          const other = otherKind === "ref" ? otherRaw
            : otherKind + " " + kwTypedLookupId(otherKind, otherRaw);
          const row = kwEl(refs, "button", {
            class: "kw-junction mono", type: "button",
            "data-dir": out ? "out" : "in",
          });
          row.textContent = (out ? "out · " : "in · ") + what + " · "
            + kwWalkShort(other);
          row.setAttribute("aria-label", (out ? "Outgoing " : "Incoming ")
            + what + (out ? " to " : " from ") + other);
          row.addEventListener("click", () => {
            kwViewMoved = false;
            kwActivateEdgeEl(canvas, e, opts, container, true);
          });
        }
      }
      if (ref.follow && opts && typeof opts.onSelectFinding === "function") {
        const show = kwEl(card, "button", { class: "kw-card-full", type: "button" },
          "Show the finding");
        show.addEventListener("click", () => { opts.onSelectFinding(ref.follow); });
      }
      // Any member card of an expanded fan offers the fold back,
      // returning the fan to its counted mark.
      if (kwExpandedFans.has(ref.anchor)) {
        const count = kwFanCounts.get(ref.anchor) || 0;
        const fold = kwEl(card, "button", { class: "kw-card-full", type: "button" },
          "Fold " + count + " references");
        fold.addEventListener("click", () => {
          kwExpandedFans.delete(ref.anchor);
          if (kwLastRender) {
            renderKnowledge(kwLastRender.container, kwLastRender.data, kwLastRender.opts);
            const next = kwLastRender.container.querySelector(
              '[data-kw-folded="' + CSS.escape(ref.anchor) + '"]');
            if (next && typeof next.focus === "function") next.focus();
          }
        });
      }
    } else if (selKind === "group") {
      // A group's card names it from its recorded metadata, the same
      // line the node's title carries.
      const gid = sel;
      const gmeta = ((overview.groups) || {})[gid] || {};
      const lead = kwEl(card, "p", { class: "kw-card-lead" });
      kwEl(lead, "span", { class: "kw-card-title mono" }, gid);
      lead.appendChild(document.createTextNode(" "));
      kwEl(lead, "span", { class: "kw-card-state" }, "group");
      const bits = [];
      if (gmeta.owner) bits.push("owner " + gmeta.owner);
      if (gmeta.coupling) bits.push(String(gmeta.coupling));
      if (typeof gmeta.received === "number") bits.push(gmeta.received + " received");
      else if (Array.isArray(gmeta.received)) bits.push(gmeta.received.length + " received");
      kwEl(card, "p", { class: "kw-card-fact" }, bits.join(" · ") || "recorded group");
    }
  }

  // Relation light: the named relation's drawn edges and its two ends
  // stay lit, everything else dims. Escape and background clicks clear
  // it through the existing dismiss path, untouched.
  function kwLightRelation(svg, rel) {
    const names = new Set(rel.ends.map((e) => kwKey(e.kind, kwTypedLookupId(e.kind, e.id))));
    for (const g of svg.querySelectorAll("g.kw-anchor, g.knode, g.kw-cluster, g.kw-ref, g.kw-group")) {
      g.classList.toggle("kw-hover-dim", !names.has(kwNodeKey(g)));
    }
    const layer = svg.querySelector("g.kw-edges");
    if (!layer) return;
    for (const edge of layer.children) {
      edge.classList.toggle("kw-hover-dim", edge.getAttribute("data-rel-name") !== rel.name);
    }
  }

  // A relation's card names the relation and its two ends. Ends read as
  // kind and id from the edge's own attributes; a name with no drawn
  // edge says its ends sit outside the drawn tiers.
  function kwPinRelCard(container, name, ends, opts) {
    if (!container) return;
    const card = kwOpenCard(container);
    const lead = kwEl(card, "p", { class: "kw-card-lead" });
    kwEl(lead, "span", { class: "kw-card-title" }, name);
    lead.appendChild(document.createTextNode(" "));
    kwEl(lead, "span", { class: "kw-card-state" }, "relation");
    const label = (e) => e.kind === "ref" ? e.id : e.kind + " " + kwTypedLookupId(e.kind, e.id);
    kwEl(card, "p", { class: "kw-card-fact mono" },
      ends.length === 2 ? label(ends[0]) + " → " + label(ends[1])
      : "ends outside the drawn tiers");
    const finding = (ends || []).find((e) => e.kind === "finding");
    if (finding && opts && typeof opts.onOpenRecord === "function") {
      const open = kwEl(card, "button", { class: "kw-card-open", type: "button" },
        "Read the full record");
      open.addEventListener("click", () => {
        opts.onOpenRecord(kwTypedLookupId("finding", finding.id));
      });
    }
  }

  // The walk bar and the direction control share one activation
  // path with canvas edges, junction rows and walk entries: light
  // the edge, pin its card, record the lit edge and the walk step.
  function kwWalkShort(s) {
    const t = String(s || "");
    return t.length > 16 ? t.slice(0, 15) + "…" : t;
  }
  function kwWalkPush(entry) {
    const last = kwWalk[kwWalk.length - 1];
    if (last && last.from === entry.from && last.to === entry.to
      && last.cls === entry.cls && last.name === entry.name) return;
    // The state retains the full walk: only the bar's display
    // collapses, and every earlier step stays one click back.
    kwWalk.push(entry);
  }
  function kwFindEdgeEl(svg, entry) {
    if (!svg || !entry) return null;
    const cands = Array.from(svg.querySelectorAll(
      "g.kw-edges > g." + entry.cls
      + '[data-from="' + CSS.escape(entry.from) + '"]'
      + '[data-to="' + CSS.escape(entry.to) + '"]'));
    if (entry.name) {
      return cands.find((e) => e.getAttribute("data-rel-name") === entry.name)
        || cands[0] || null;
    }
    return cands[0] || null;
  }
  function kwClearDirection() {
    for (const el of kwDirectionDimmed) el.classList.remove("kw-dim");
    kwDirectionDimmed = [];
  }
  // Direction thins the lit neighborhood around the lit edge: out
  // keeps the lit edge plus edges leaving its target, in keeps the
  // lit edge plus edges entering its source. Only adds dim, so it
  // composes with isolation; an edge that no longer draws clears
  // the lit edge instead of dimming around a ghost.
  function kwApplyDirection(container) {
    kwClearDirection();
    if (!container || kwDirection === "all" || !kwLitEdge) return;
    const svg = container.querySelector("svg.kw-canvas");
    if (!svg) return;
    const lit = kwFindEdgeEl(svg, {
      from: kwLitEdge.from, to: kwLitEdge.to, cls: kwLitEdge.cls, name: kwLitEdge.name,
    });
    if (!lit) {
      kwLitEdge = null;
      kwDirection = "all";
      kwRefreshWalkChrome(container);
      return;
    }
    const hubKind = kwDirection === "out" ? kwLitEdge.toKind : kwLitEdge.fromKind;
    const hubRaw = kwDirection === "out" ? kwLitEdge.to : kwLitEdge.from;
    const hub = kwKey(hubKind, kwTypedLookupId(hubKind, hubRaw));
    const side = kwDirection === "out" ? "data-from" : "data-to";
    const kindSide = kwDirection === "out" ? "data-from-kind" : "data-to-kind";
    for (const e of svg.querySelectorAll("g.kw-edges > g")) {
      if (e === lit) continue;
      const k = e.getAttribute(kindSide) || "";
      const raw = e.getAttribute(side) || "";
      if (!raw) continue;
      if (kwKey(k, kwTypedLookupId(k, raw)) === hub) continue;
      // This pass clears only the dim it introduced: an edge already
      // dimmed by citations-only or search keeps its dim untracked,
      // so returning to all cannot reveal what those passes hid.
      if (e.classList.contains("kw-dim")) continue;
      e.classList.add("kw-dim");
      kwDirectionDimmed.push(e);
    }
  }
  // A re-render rebuilds the canvas, so the lit edge's dims are
  // gone with the old nodes. The reading itself stands in the walk
  // state: re-light it against the new drawing, without pushing a
  // step or re-pinning a card. A missing edge ends the reading the
  // way the direction pass would.
  function kwRelightLit(container, svg) {
    if (!kwLitEdge || !svg) return;
    const g = kwFindEdgeEl(svg, {
      from: kwLitEdge.from, to: kwLitEdge.to, cls: kwLitEdge.cls, name: kwLitEdge.name,
    });
    if (!g) {
      kwLitEdge = null;
      kwDirection = "all";
      kwClearDirection();
      kwRefreshWalkChrome(container);
      return;
    }
    const ends = [
      { kind: kwLitEdge.fromKind, id: kwLitEdge.from },
      { kind: kwLitEdge.toKind, id: kwLitEdge.to },
    ];
    if (kwLitEdge.cls === "kw-edge-relate") kwLightRelation(svg, { name: kwLitEdge.name, ends });
    else kwLightTyped(svg, g, ends);
  }
  function kwActivateEdgeEl(svg, g, opts, container, pushWalk) {
    if (!svg || !g) return;
    const fromKind = g.getAttribute("data-from-kind") || "";
    const from = g.getAttribute("data-from") || "";
    const toKind = g.getAttribute("data-to-kind") || "";
    const to = g.getAttribute("data-to") || "";
    if (!from || !to) return;
    kwDismissed = null;
    kwClearDirection();
    const ends = [{ kind: fromKind, id: from }, { kind: toKind, id: to }];
    const name = g.getAttribute("data-rel-name") || "";
    const typed = g.classList.contains("kw-edge-typed");
    // An evidence stub reaches here only through a junction row: it
    // lights alone like a typed edge, and its card states recorded
    // evidence rather than borrowing the relation card's name slot.
    const stub = !typed && g.classList.contains("kw-edge-evidence");
    const cls = typed ? "kw-edge-typed" : stub ? "kw-edge-evidence" : "kw-edge-relate";
    if (typed || stub) {
      kwLightTyped(svg, g, ends);
      kwPinTypedCard(container, g.getAttribute("data-provenance") || "recorded-evidence",
        ends, name, g.getAttribute("data-edge") || "", opts, stub ? "edge" : "");
    } else {
      kwLightRelation(svg, { name, ends });
      kwPinRelCard(container, name, ends, opts);
    }
    const prov = g.getAttribute("data-provenance") || "";
    kwLitEdge = { fromKind, from, toKind, to, cls, name };
    if (pushWalk !== false) {
      kwWalkPush({
        name: name || (prov === "recorded-evidence" || stub ? "recorded evidence" : "authored claim"),
        from, to, cls,
      });
    }
    kwApplyDirection(container);
    kwRefreshWalkChrome(container);
    if (typeof g.focus === "function") g.focus();
  }
  // The walk bar and direction control rebuild in place, under the
  // search box: the walk shows every step, the direction control
  // shows while an edge is lit. Full renders build both from the
  // same state through the same functions.
  function kwWalkStepButton(bar, svg, opts, container, entry) {
    const b = kwEl(bar, "button", { class: "kw-walk-step mono", type: "button" });
    b.textContent = entry.name + " · " + kwWalkShort(entry.from)
      + " → " + kwWalkShort(entry.to);
    b.setAttribute("aria-label", "Re-light " + entry.name + " from "
      + entry.from + " to " + entry.to);
    b.addEventListener("click", () => {
      const g = kwFindEdgeEl(svg, entry);
      if (g) kwActivateEdgeEl(svg, g, opts, container, false);
    });
  }
  function kwBuildWalkBar(tools, container, svg, opts, at) {
    if (!kwWalk.length) return;
    const bar = kwEl(tools, "div", { class: "kw-walk", role: "navigation" });
    if (at) tools.insertBefore(bar, at);
    bar.setAttribute("aria-label", "Edge walk");
    const sep = () => {
      const s = kwEl(bar, "span", { class: "kw-walk-sep", "aria-hidden": "true" });
      s.textContent = "→";
    };
    // Past eight steps the bar collapses to its tail with an
    // "N earlier" affordance; opening it shows every retained step
    // in page flow, each one click back to its edge.
    const tail = kwWalkExpanded ? kwWalk : kwWalk.slice(-KW_WALK_SHOWN);
    const hidden = kwWalk.length - tail.length;
    if (hidden > 0) {
      const more = kwEl(bar, "button", { class: "kw-walk-earlier mono", type: "button" });
      more.textContent = hidden + " earlier";
      more.setAttribute("aria-label", "Show " + hidden + " earlier walk steps");
      more.addEventListener("click", () => {
        kwWalkExpanded = true;
        kwRefreshWalkChrome(container);
        const next = container.querySelector(".kw-walk-fewer");
        if (next && typeof next.focus === "function") next.focus();
      });
      sep();
    }
    tail.forEach((entry, i) => {
      if (i > 0) sep();
      kwWalkStepButton(bar, svg, opts, container, entry);
    });
    if (kwWalkExpanded && hidden === 0 && kwWalk.length > KW_WALK_SHOWN) {
      sep();
      const fewer = kwEl(bar, "button", { class: "kw-walk-fewer mono", type: "button" });
      fewer.textContent = "fewer";
      fewer.setAttribute("aria-label", "Collapse the walk to its tail");
      fewer.addEventListener("click", () => {
        kwWalkExpanded = false;
        kwRefreshWalkChrome(container);
        const next = container.querySelector(".kw-walk-earlier");
        if (next && typeof next.focus === "function") next.focus();
      });
    }
  }
  function kwBuildDirection(tools, container, at) {
    if (!kwLitEdge) return;
    const dir = kwEl(tools, "div", { class: "kw-direction" });
    if (at) tools.insertBefore(dir, at);
    dir.setAttribute("aria-label", "Direction of the lit neighborhood");
    // Three explicit choices, all first: choosing sets the direction,
    // so all is always one press away rather than a toggle state.
    for (const d of [["all", "all"], ["out", "outgoing"], ["in", "incoming"]]) {
      const b = kwEl(dir, "button", {
        class: "kw-direction-btn mono", type: "button",
        "aria-pressed": kwDirection === d[0] ? "true" : "false",
        "data-kw-dir": d[0],
      });
      b.textContent = d[1];
      b.addEventListener("click", () => {
        kwDirection = d[0];
        kwApplyDirection(container);
        kwRefreshWalkChrome(container);
        const next = container.querySelector('[data-kw-dir="' + d[0] + '"]');
        if (next && typeof next.focus === "function") next.focus();
      });
    }
  }
  function kwRefreshWalkChrome(container) {
    const tools = container ? container.querySelector(".kw-maptools") : null;
    if (!tools) return;
    const oldWalk = tools.querySelector(".kw-walk");
    if (oldWalk) oldWalk.remove();
    const oldDir = tools.querySelector(".kw-direction");
    if (oldDir) oldDir.remove();
    const svg = container.querySelector("svg.kw-canvas");
    const opts = kwLastRender ? kwLastRender.opts : null;
    const at = tools.querySelector(".kw-search-status");
    // Both land before the status, walk first, so the order reads
    // search box, walk, direction, status.
    kwBuildWalkBar(tools, container, svg, opts, at);
    kwBuildDirection(tools, container, at);
  }

  // Activating a typed edge lights only it and its two ends; every
  // other edge dims, related or not.
  function kwLightTyped(svg, edge, ends) {
    const names = new Set(ends.map((e) => kwKey(e.kind, kwTypedLookupId(e.kind, e.id))));
    for (const g of svg.querySelectorAll("g.kw-anchor, g.knode, g.kw-cluster, g.kw-ref, g.kw-group")) {
      g.classList.toggle("kw-hover-dim", !names.has(kwNodeKey(g)));
    }
    const layer = svg.querySelector("g.kw-edges");
    if (!layer) return;
    for (const e of layer.children) {
      e.classList.toggle("kw-hover-dim", e !== edge);
    }
  }

  // A typed edge's card names the recorded relation and its two
  // ends, with the edge's own id when the payload carries one. The
  // relation name lives here and in the edge's label, never on the
  // canvas. The record button opens the full record at the finding
  // end through the shell hook, like every other card.
  function kwPinTypedCard(container, provenance, ends, relation, edgeId, opts, stateWord) {
    if (!container) return;
    const card = kwOpenCard(container);
    const lead = kwEl(card, "p", { class: "kw-card-lead" });
    kwEl(lead, "span", { class: "kw-card-title" }, relation
      || (provenance === "authored" ? "authored claim" : "recorded evidence"));
    lead.appendChild(document.createTextNode(" "));
    kwEl(lead, "span", { class: "kw-card-state" }, stateWord || "typed edge");
    const label = (e) => e.kind === "ref" ? e.id : e.kind + " " + kwTypedLookupId(e.kind, e.id);
    kwEl(card, "p", { class: "kw-card-fact mono" },
      ends.length === 2 ? label(ends[0]) + " → " + label(ends[1])
      : "ends outside the drawn tiers");
    if (edgeId) {
      kwEl(card, "p", { class: "kw-card-ref mono" }, "edge " + edgeId);
    }
    const finding = (ends || []).find((e) => e.kind === "finding");
    if (finding && opts && typeof opts.onOpenRecord === "function") {
      const open = kwEl(card, "button", { class: "kw-card-open", type: "button" },
        "Read the full record");
      open.addEventListener("click", () => {
        opts.onOpenRecord(kwTypedLookupId("finding", finding.id));
      });
    }
  }

  // The caption a finding draws: claim plus kind and evidence
  // suffixes, before the 26-character cap. The label, its obstacle
  // and the thinning pass all measure this string, so the three
  // cannot drift apart.
  function kwCaptionWords(f) {
    if (!f) return "";
    const kind = String(f.kind || "");
    const evidenceMessage = kwEvidenceRef(f);
    return String(f.claim || f.id)
      + (kind && kind !== "finding" ? " · " + kind : "")
      + (evidenceMessage ? " · " + evidenceMessage : "");
  }

  function kwNodeLabel(g, f, x, y) {
    const words = kwCaptionWords(f);
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

  // The macro band: a tier census and a promotion flow field above
  // the canvas. Counts read by bar length (position beats area for
  // magnitude judgments) and density reads as a shaded field ordered
  // by marginal totals; the canvas below keeps the micro reading.
  // The band draws nothing the store does not hold: tiers with no
  // companions, scopes with no promotions, and transfers whose ends
  // fall outside the drawing each omit their own part.
  var KW_FLOW_MAX = 12;
  function kwMacroBand(container, svg, tiers, promotions, width) {
    const band = document.createElement("div");
    band.setAttribute("class", "kw-macro");
    let parts = 0;
    if (tiers.length >= 2) {
      const counts = tiers.map((t) => ({
        d: t.d, y: t.y + t.height / 2,
        actors: t.members.length,
        findings: t.slots.reduce((n, s) => n
          + (s.finding ? 1 : (s.items ? s.items.length : 0)), 0),
      }));
      const max = Math.max.apply(null, counts.map((c) => c.findings).concat([1]));
      const census = kwEl(band, "div", { class: "kw-census", role: "group",
        "aria-label": "Findings by tier" });
      for (const c of counts) {
        const word = c.d < 0 ? "depth unknown" : "depth " + c.d;
        const btn = kwEl(census, "button", { class: "kw-tier-row", type: "button",
          "data-kw-tier": String(c.d),
          "aria-label": word + ": " + c.findings + " findings, "
            + c.actors + " actors. Activate to center this tier." });
        const lab = kwEl(btn, "span", { class: "kw-tier-lab mono" });
        lab.textContent = word;
        const bar = kwEl(btn, "span", { class: "kw-tier-bar", "aria-hidden": "true" });
        bar.setAttribute("style", "width:" + Math.round(c.findings / max * 100) + "%");
        const num = kwEl(btn, "span", { class: "kw-tier-num mono" });
        num.textContent = c.findings + " · " + c.actors;
        btn.addEventListener("click", () => {
          const live = container.querySelector("g.kw-view");
          const canvas = container.querySelector("svg.kw-canvas");
          if (!live || !canvas) return;
          const box = kwVisibleBox(container, canvas);
          kwView.k = Math.min(4, Math.max(kwView.k, 1.25));
          kwView.x = box.w / 2 - (width / 2) * kwView.k;
          kwView.y = box.h / 2 - c.y * kwView.k;
          kwApplyView(live);
        });
      }
      parts += 1;
    }
    const pairs = [];
    for (const p of promotions || []) {
      const src = p && p.source ? String(p.source) : "";
      const dst = p && p.destination ? String(p.destination) : "";
      if (src && dst) pairs.push([src, dst]);
    }
    if (pairs.length) {
      const out = new Map();
      const inn = new Map();
      const cell = new Map();
      for (const pair of pairs) {
        out.set(pair[0], (out.get(pair[0]) || 0) + 1);
        inn.set(pair[1], (inn.get(pair[1]) || 0) + 1);
        const key = pair[0] + "\n" + pair[1];
        cell.set(key, (cell.get(key) || 0) + 1);
      }
      const byMarginal = (a, b, m) => (m.get(b) - m.get(a))
        || (a < b ? -1 : 1);
      const rows = Array.from(out.keys()).sort((a, b) => byMarginal(a, b, out));
      const cols = Array.from(inn.keys()).sort((a, b) => byMarginal(a, b, inn));
      // The tail aggregates into one row and column: every transfer
      // stays visible, grouped rather than dropped.
      const otherR = rows.length > KW_FLOW_MAX;
      const otherC = cols.length > KW_FLOW_MAX;
      const rowIds = otherR ? rows.slice(0, KW_FLOW_MAX) : rows.slice();
      const colIds = otherC ? cols.slice(0, KW_FLOW_MAX) : cols.slice();
      const val = (r, c) => {
        let n = 0;
        const rs = r === null ? rows.slice(KW_FLOW_MAX) : [r];
        const cs = c === null ? cols.slice(KW_FLOW_MAX) : [c];
        for (const a of rs) for (const b of cs) n += cell.get(a + "\n" + b) || 0;
        return n;
      };
      const wrap = kwEl(band, "div", { class: "kw-flow" });
      const cap = kwEl(wrap, "p", { class: "kw-flow-cap muted" });
      cap.textContent = pairs.length + " promotion" + (pairs.length === 1 ? "" : "s")
        + " · " + rows.length + " source" + (rows.length === 1 ? "" : "s")
        + " · " + cols.length + " destination" + (cols.length === 1 ? "" : "s")
        + ((otherR || otherC) ? " · tail grouped" : "");
      const table = kwEl(wrap, "table", { class: "kw-flow-grid" });
      const head = kwEl(table, "tr", null);
      kwEl(head, "th", { scope: "col" });
      const shortId = (id, n) => id.length > n ? id.slice(0, n - 1) + "…" : id;
      for (const c of colIds.concat(otherC ? [null] : [])) {
        const th = kwEl(head, "th", { scope: "col", class: "kw-flow-h kw-flow-v mono" });
        th.textContent = c === null ? "other holders" : shortId(c, 8);
        if (c !== null && c !== shortId(c, 8)) th.setAttribute("title", c);
      }
      for (const r of rowIds.concat(otherR ? [null] : [])) {
        const tr = kwEl(table, "tr", null);
        const rh = kwEl(tr, "th", { scope: "row", class: "kw-flow-h mono" });
        rh.textContent = r === null ? "other holders" : shortId(r, 12);
        if (r !== null && r !== shortId(r, 12)) rh.setAttribute("title", r);
        for (const c of colIds.concat(otherC ? [null] : [])) {
          const n = val(r, c);
          const td = kwEl(tr, "td", {
            class: "kw-mx-" + (n === 0 ? "0" : n === 1 ? "1" : n < 5 ? "2" : "3"),
            title: n + " promotion" + (n === 1 ? "" : "s") + " from "
              + (r === null ? "other holders" : r) + " to "
              + (c === null ? "other holders" : c),
          });
          td.textContent = n === 0 ? "" : String(n);
        }
      }
      parts += 1;
    }
    if (!parts) return null;
    container.insertBefore(band, svg);
    return band;
  }

  function kwRestoreFocus(container, focused, caret) {
    if (!focused) return;
    const node = container.querySelector(focused);
    if (node && typeof node.focus === "function") {
      node.focus();
      // The rebuilt search box carries the layer's query text; the caret
      // comes back with it, clamped to the text in hand.
      if (caret && typeof node.setSelectionRange === "function") {
        const len = typeof node.value === "string" ? node.value.length : 0;
        node.setSelectionRange(Math.min(caret[0], len), Math.min(caret[1], len));
      }
    }
  }

  function renderKnowledge(container, data, opts) {
    if (!container) return null;
    const active = document.activeElement;
    let focused = null;
    let caret = null;
    if (active && container.contains(active)) {
      // Nodes restore by kind and id together, so a session sharing a
      // group's literal id refocuses its own node and not the other's.
      for (const name of ["data-kw-id", "data-kw-node", "data-kw-cluster", "data-kw-ref"]) {
        if (active.hasAttribute(name)) {
          focused = '[' + name + '="' + CSS.escape(active.getAttribute(name)) + '"]'
            + '[data-kw-kind="' + CSS.escape(active.getAttribute("data-kw-kind") || "") + '"]';
        }
      }
      // The chrome is rebuilt too, so a live frame must not eat typing or
      // drop the reader off the match list: the search box keeps its caret
      // and a match row is found again by kind and id.
      if (active.classList && active.classList.contains("kw-search")) {
        focused = ".kw-search";
        const s = active.selectionStart;
        const e = active.selectionEnd;
        if (typeof s === "number" && typeof e === "number") caret = [s, e];
      }
      if (active.hasAttribute("data-kw-match-kind")) {
        focused = '.kw-match[data-kw-match-kind="' +
          CSS.escape(active.getAttribute("data-kw-match-kind") || "") +
          '"][data-kw-match-id="' +
          CSS.escape(active.getAttribute("data-kw-match-id") || "") + '"]';
      }
      if (active.hasAttribute("data-kw-tier")) {
        focused = '[data-kw-tier="' + CSS.escape(active.getAttribute("data-kw-tier") || "") + '"]';
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
    // An empty group scope still seats its group, so the holder and its
    // metadata draw instead of an empty notice.
    if (mode === "band"
      && !(overview.findings || []).length && !(overview.relations || []).length
      && !(overview.edges || []).length && !(overview.nodes || []).length
      && !kwScopeGroup(overview)) {
      const p = kwEl(container, "p", { class: "muted" });
      p.textContent = (opts && opts.query)
        ? "No findings match." : "No recorded findings.";
      return { findings: 0, promotions: promotions.length };
    }
    if (mode === "band") {
      kwRenderBand(container, overview, promotions, opts);
      kwRestoreFocus(container, focused, caret);
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
    const sections = (data && data.sections) || [];
    kwActorReads = (data && data.actorReads) || {};
    const collapsed = new Set();
    for (const e of ensembles) {
      if (e && e.id && kwCollapsedEnsembles.has(String(e.id))) {
        for (const m of (e.members || [])) collapsed.add(kwKey("session", String(m)));
      }
    }
    const layout = kwRenderWhole(container, overview, promotions, opts, collapsed);
    kwPlaceWhole(layout, container, overview, promotions, opts, ensembles, sections);
    // The frame takes the drawing's own height and the page scrolls,
    // so the map publishes no heights. The content tracker stays: it
    // still sizes the canvas itself and frames Fit.
    kwRestoreFocus(container, focused, caret);
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
      // Roster rows are sessions: a group end has no row, and must not
      // borrow a session's when the literal ids collide.
      if (String(p.sourceKind || "session") === "group"
        || String(p.destinationKind || "session") === "group") continue;
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
      if (p.source && String(p.sourceKind || "session") !== "group") sharing.add(String(p.source));
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

  // The record consumes the relation style from here: the claimed
  // tuple when the name is drawn, the base tuple when it is not, so the
  // answer always matches the canvas. Callable after load without a
  // render; with no render run, every name answers its base tuple.
  window.knowledgeRelationStyle = function (name) {
    const t = kwRelTuple(name);
    return { dash: t.dash, width: t.width, ink: t.ink };
  };

  window.KnowledgeLayer = { renderKnowledge, renderArcs };
})();


