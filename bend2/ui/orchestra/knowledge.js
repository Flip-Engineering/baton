/* Knowledge records, directed relations, citations and record reading. */
(function () {
  "use strict";
  var KW_SVG_NS = "http://www.w3.org/2000/svg";
  const kwSizeObservers = new WeakMap();
  const kwRowSeen = new Map();
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

  function kwRenderBand(container, overview, promotions, opts) {
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

  const kwRelStyleDrawn = new Map();
  var KW_REL_TUPLES = [];
  ["0.5 3", "6 3", "7 2.5 1.5 2.5", "10 3 2 3", ""].forEach((dash) => {
    ["2", "1"].forEach((width) => {
      ["var(--ink, #141a26)", "var(--muted, #5b6478)"].forEach((ink) => {
        KW_REL_TUPLES.push({ dash, width, ink });
      });
    });
  });
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
  function kwWatchWidth(container, data, opts) {
    const mode = (opts && opts.mode) || "whole";
    let state = kwSizeObservers.get(container);
    if (mode !== "whole" || (opts && opts.notice)) {
      if (state) { state.observer.disconnect(); state.events.abort(); }
      kwSizeObservers.delete(container);
      return;
    }
    if (typeof ResizeObserver !== "function") return;
    if (!state) {
      state = { width: container.clientWidth, data, opts, observer: null,
        events: new AbortController(), readingVisible: false };
      state.captureReading = () => {
        if (!container.isConnected) {
          state.observer.disconnect();
          state.events.abort();
          kwSizeObservers.delete(container);
          return;
        }
        if (container.clientWidth !== state.width) return;
        const active = container.contains(document.activeElement) ? document.activeElement : null;
        const reading = active && active.closest(".kw-science-region");
        state.readingVisible = !!reading && kwScientificReadingVisible(reading);
      };
      window.addEventListener("scroll", state.captureReading, { passive: true, signal: state.events.signal });
      container.addEventListener("focusin", state.captureReading, { signal: state.events.signal });
      state.observer = new ResizeObserver(() => {
        if (!container.isConnected) return;
        const width = container.clientWidth;
        if (width > 0 && width !== state.width) {
          renderKnowledge(container, state.data, state.opts, state.readingVisible);
          state.captureReading();
        }
      });
      kwSizeObservers.set(container, state);
      state.observer.observe(container);
    }
    state.width = container.clientWidth;
    state.data = data;
    state.opts = opts;
    state.captureReading();
  }

  // Typed records retain their payloads and authored relation orientation.
  const KW_SCIENCE_KINDS = ["question", "hypothesis", "study", "observation", "evidence",
    "research-finding", "claim", "argument", "proposal", "decision"];
  const KW_SCIENCE_EDGES = ["supports", "challenges", "contradicts", "negates", "implies",
    "proves", "disproves", "causes", "correlates-with", "competes-with", "replicates",
    "derived-from", "investigates", "produces", "informs", "supersedes"];
  const kwScientificReads = new WeakMap();

  function kwScienceLabel(value) {
    return String(value).replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[-_]/g, " ");
  }

  const KW_RESOURCE_KINDS = ["message", "task", "report", "turn", "file", "external", "issue", "pr"];

  function kwCitation(value) {
    if (typeof value !== "string") return value;
    if (/^https?:\/\//i.test(value)) return {kind:"external",id:value,uri:value};
    const match = value.match(/^(finding|message|task|report|turn|file|external|issue|pr):(.+)$/s);
    return match ? {kind:match[1],id:match[2]} : value;
  }

  function kwScientificGraph(overview) {
    const nodes = new Map();
    const edges = new Map();
    const scientific = overview.scientific || {};
    const rootVersioned = scientific.schemaVersion === 1
      && scientific.schemaId === "urn:baton:knowledge:schema:1";
    const nodeRows = [...(rootVersioned ? scientific.nodes || [] : []),
      ...(overview.findings || []).filter((row) => row && row.schemaVersion === 1),
      ...(overview.nodes || []).filter((row) => row && row.schemaVersion === 1)];
    const envelope = (row) => ({
      ...row,
      schemaVersion: row.schemaVersion === undefined ? scientific.schemaVersion : row.schemaVersion,
      ...(row.schemaId || !scientific.schemaId ? {} : { schemaId: scientific.schemaId }),
    });
    for (const row of nodeRows) {
      if (row && KW_SCIENCE_KINDS.includes(row.kind) && typeof row.statement === "string")
        nodes.set(String(row.id), envelope(row));
    }
    const edgeRows = [...(rootVersioned ? scientific.edges || [] : []),
      ...(overview.relations || []).filter((row) => row && row.schemaVersion === 1),
      ...(overview.edges || []).filter((row) => row && row.schemaVersion === 1),
      ...Array.from(nodes.values()).flatMap((node) => node.relations || [])];
    for (const row of edgeRows) {
      if (row && KW_SCIENCE_EDGES.includes(row.kind) && row.source && row.target)
        edges.set(String(row.id), envelope(row));
    }
    const graph = { nodes, edges, referencesMade: new Map(), referencedBy: new Map() };
    for (const row of [...nodes.values(), ...edges.values()]) {
      for (const field of ["evidence", "context", "details", "basis"])
        kwScientificReferenceUses(graph, row, row[field], field);
    }
    const referenceLinks = new Map();
    for (const [sourceKey, uses] of graph.referencesMade) for (const use of uses) {
      const targetKey = (use.reference.kind === "edge" ? "edge:" : "node:") + use.reference.id;
      const id = "reference-use:" + sourceKey + ":" + targetKey;
      if (referenceLinks.has(id)) {
        referenceLinks.get(id).details.fields.push(use.path);
        continue;
      }
      const source = use.source.source
        ? { kind: "edge", edgeKind: use.source.kind, id: use.source.id }
        : { kind: use.source.kind, id: use.source.id };
      const link = { id, kind: "references", source, target: use.reference,
        referenceUse: true, label: "cites",
        rationale: "Explicit references in the source record.", details: { fields: [use.path] } };
      referenceLinks.set(id, link);
      edges.set(id, link);
    }
    for (const link of referenceLinks.values()) {
      const ref = link.target;
      if (KW_RESOURCE_KINDS.includes(ref.kind) && !nodes.has(String(ref.id)))
        nodes.set(String(ref.id), {id:ref.id,kind:ref.kind,statement:ref.id,reference:ref,resource:true});
    }
    return graph;
  }

  function kwScientificReferenceUses(graph, source, value, path) {
    if (Array.isArray(value)) {
      for (const [index, item] of value.entries())
        kwScientificReferenceUses(graph, source, item, path + "[" + index + "]");
      return;
    }
    if (!value || typeof value !== "object") return;
    if (typeof value.id === "string" && (KW_SCIENCE_KINDS.includes(value.kind) || KW_RESOURCE_KINDS.includes(value.kind)
      || value.kind === "edge" && KW_SCIENCE_EDGES.includes(value.edgeKind))) {
      const sourceKey = kwScientificKey(source);
      const targetKey = (value.kind === "edge" ? "edge:" : "node:") + value.id;
      const use = { source, reference: value, path };
      for (const [index, key] of [[graph.referencesMade, sourceKey], [graph.referencedBy, targetKey]]) {
        if (!index.has(key)) index.set(key, []);
        index.get(key).push(use);
      }
      return;
    }
    for (const [key, item] of Object.entries(value))
      kwScientificReferenceUses(graph, source, item, path + "." + key);
  }

  function kwScientificKey(row) {
    return (row.source && row.target ? "edge:" : "node:") + row.id;
  }

  function kwScientificResolve(graph, reference) {
    if (!reference) return null;
    const row = reference.kind === "edge" ? graph.edges.get(String(reference.id))
      : graph.nodes.get(String(reference.id));
    return row && (reference.kind === "edge" ? row.kind === reference.edgeKind
      : row.kind === reference.kind) ? row : null;
  }

  function kwScientificMatches(reference, row) {
    return reference && String(reference.id) === String(row.id)
      && (row.source ? reference.kind === "edge" && reference.edgeKind === row.kind
        : reference.kind === row.kind);
  }

  function kwScientificField(parent, label, value, graph, activate, owner = null) {
    if (value === null || value === undefined || value === "") return;
    const field = kwEl(parent, "div", { class: "kw-science-field" });
    kwEl(field, "h4", null, kwScienceLabel(label));
    kwScientificValue(field, value, graph, activate,
      KnowledgeJSON.numberSource(owner, label, value));
  }

  function kwScientificValue(parent, value, graph, activate, numberText = null) {
    if (Array.isArray(value)) {
      if (!value.length) { kwEl(parent, "p", { class: "muted" }, "None recorded"); return; }
      const list = kwEl(parent, "ul", { class: "kw-science-values" });
      for (const [index, item] of value.entries()) {
        kwScientificValue(kwEl(list, "li"), item, graph, activate,
          KnowledgeJSON.numberSource(value, index, item));
      }
      return;
    }
    if (value && typeof value === "object") {
      // Exact typed references resolve within the returned scientific graph.
      const target = kwScientificResolve(graph, value);
      const sameKind = !!target && !target.resource;
      if (sameKind) {
        const open = kwEl(parent, "button", { class: "kw-science-reference", type: "button",
          "data-science-focus": "reference:" + value.kind + ":" + value.id },
        target.statement || target.rationale || target.id);
        open.addEventListener("click", () => activate(kwScientificKey(target)));
        kwEl(parent, "span", { class: "kw-science-reference-id mono" }, value.kind + " · " + value.id);
        return;
      }
      if (value.kind && (value.id || value.uri) && !Object.hasOwn(value, "statement")) {
        if (value.kind === "entity" && typeof value.label === "string")
          kwEl(parent, "p", { class: "kw-science-value" }, value.label);
        kwEl(parent, "p", { class: "kw-science-reference-id mono" },
          value.kind + " · " + String(value.id || value.uri));
        if (value.uri && /^https?:\/\//i.test(value.uri)) {
          kwEl(parent, "a", { href: value.uri, target: "_blank", rel: "noopener noreferrer" },
            value.kind === "entity" ? "Open entity URI" : "Open source");
        }
        if (value.sha256) kwEl(parent, "p", { class: "mono" }, "SHA-256 " + value.sha256);
        if (value.kind === "edge" && value.edgeKind) kwEl(parent, "p", null, kwScienceLabel(value.edgeKind));
        if (value.kind === "message" && value.id) {
          const held = graph.messages[String(value.id)];
          if (held && held.state === "ok" && held.message) {
            const message = held.message;
            kwEl(parent, "p", { class: "kw-science-author" },
              [message.kind, message.sender && "From " + message.sender,
                message.recipient && "To " + message.recipient].filter(Boolean).join(" · "));
            if (typeof message.body === "string") {
              kwEl(parent, "pre", { class: "kw-science-message-body", tabindex: "-1",
                "data-science-focus": "message:" + value.id,
                "aria-label": "Supporting message " + value.id }, message.body);
              if (message.body === "") kwEl(parent, "p", { class: "muted" }, "Stored body is empty.");
            }
          } else {
            if (held) {
              kwEl(parent, "p", { class: "muted" }, "Message read: " + held.state);
              if (held.status) kwEl(parent, "p", null, "Status " + held.status);
              if (held.reason) kwEl(parent, "p", { class: "kw-science-value" }, held.reason);
            }
            if (typeof graph.onReadMessage === "function") {
              const read = kwEl(parent, "button", { type: "button", class: "kw-science-reference",
                "data-science-focus": "message:" + value.id },
              held && held.state === "reading" ? "Reading supporting message…" : "Read supporting message");
              const reading = !!held && held.state === "reading";
              read.setAttribute("aria-disabled", String(reading));
              read.addEventListener("click", () => {
                if (!reading) graph.onReadMessage(String(value.id));
              });
            }
          }
        } else if (KW_SCIENCE_KINDS.includes(value.kind) || value.kind === "edge" || value.kind === "finding") {
          kwEl(parent, "p", { class: "muted" }, "Referenced record is outside this returned graph.");
          if (typeof graph.onOpenReference === "function") {
            const open = kwEl(parent, "button", { type: "button", class: "kw-science-reference",
              "data-science-focus": "outside:" + value.kind + ":" + value.id }, "Open in all holdings");
            open.addEventListener("click", () => graph.onOpenReference(value));
          }
        } else if (value.kind === "entity") {
          kwEl(parent, "p", { class: "muted" }, "Referenced entity");
        } else {
          kwEl(parent, "p", { class: "muted" }, kwScienceLabel(value.kind) + " resource");
        }
        return;
      }
      for (const [key, item] of Object.entries(value)) kwScientificField(parent, key, item, graph, activate, value);
      return;
    }
    kwEl(parent, "p", { class: "kw-science-value" }, numberText === null ? String(value) : numberText);
  }

  function kwScientificTile(parent, row, graph, activate) {
    const tile = kwEl(parent, "article", { class: "kw-science-node", "data-science-id": row.id,
      "data-science-kind": row.kind });
    kwEl(tile, "p", { class: "kw-science-kind" }, kwScienceLabel(row.kind));
    const open = kwEl(tile, "button", { class: "kw-science-statement", type: "button",
      "data-science-focus": "node:" + row.id }, row.statement || row.rationale || row.id);
    open.addEventListener("click", () => activate(kwScientificKey(row)));
    kwEl(tile, "p", { class: "kw-science-author" }, "By " + row.author);
    kwEl(tile, "p", { class: "kw-science-reference-id mono" }, row.id);
    if (row.uncertainty) kwEl(tile, "p", { class: "kw-science-uncertainty" }, row.uncertainty);
    const connected = Array.from(graph.edges.values()).filter((edge) =>
      kwScientificMatches(edge.source, row) || kwScientificMatches(edge.target, row)).length;
    const key = kwScientificKey(row);
    const uses = (graph.referencesMade.get(key) || []).length
      + (graph.referencedBy.get(key) || []).filter((use) => kwScientificMatches(use.reference, row)).length;
    kwEl(tile, "p", { class: "kw-science-degree" },
      connected + (connected === 1 ? " authored relation" : " authored relations")
      + " · " + uses + (uses === 1 ? " reference use" : " reference uses"));
    return tile;
  }

  function kwScientificDetails(parent, row, graph, activate) {
    const preferred = {
      observation: ["result", "property", "subject", "phenomenonTime", "resultTime", "procedure"],
      "research-finding": ["inference", "inputs", "method", "overturnConditions"],
      hypothesis: ["predictions", "overturnConditions", "explanation"],
      argument: ["premises", "derivation", "witness", "method"],
      study: ["questions", "state", "outputs", "method", "design", "studyIdentity"],
      evidence: ["description", "source", "selection"],
      proposal: ["proposedAction", "purpose", "rationale", "alternatives"],
      decision: ["selected", "rationale", "alternatives"],
      causes: ["exposure", "outcome", "identification", "alternativeExplanations", "mechanism"],
    }[row.kind] || [];
    const details = row.details || {};
    const section = kwEl(parent, "section", { class: "kw-science-details" });
    kwEl(section, "h4", null, "Scientific details");
    for (const field of [...preferred, ...Object.keys(details).filter((key) => !preferred.includes(key))])
      kwScientificField(section, field, details[field], graph, activate, details);
  }

  function kwScientificAssertionNote(parent, kind) {
    const text = ["proves", "disproves", "implies", "negates", "contradicts"].includes(kind)
      ? "Authored logical assertion. Review its proposition, scope and reasoning."
      : kind === "causes" ? "Authored causal assertion. Review its identification, assumptions and alternatives." : "";
    if (text) kwEl(parent, "p", { class: "kw-science-assertion-note" }, text);
  }

  function kwScientificUses(parent, row, graph, activate, read) {
    const key = kwScientificKey(row);
    for (const [direction, uses, title] of [
      ["made", graph.referencesMade.get(key) || [], "References made"],
      ["by", (graph.referencedBy.get(key) || []).filter((use) => kwScientificMatches(use.reference, row)), "Referenced by"],
    ]) {
      if (!uses.length) continue;
      const disclosureKey = key + ":" + direction;
      const section = kwEl(parent, "details", { class: "kw-science-reference-uses",
        "data-science-uses": direction, "data-science-uses-key": disclosureKey });
      section.open = read.referencesOpen.has(disclosureKey);
      section.addEventListener("toggle", () => {
        if (!section.isConnected) return;
        if (section.open) read.referencesOpen.add(disclosureKey);
        else read.referencesOpen.delete(disclosureKey);
      });
      kwEl(section, "summary", { "data-science-focus": "uses:" + disclosureKey }, title + " · " + uses.length);
      kwEl(section, "p", { class: "muted" }, "Explicit reference uses within this reading");
      for (const use of uses) {
        const entry = kwEl(section, "article", { class: "kw-science-reference-use", "data-science-reference-path": use.path });
        kwEl(entry, "p", { class: "kw-science-reference-id mono" }, use.path);
        const reference = direction === "made" ? use.reference :
          { kind: use.source.source ? "edge" : use.source.kind, id: use.source.id,
            ...(use.source.source ? { edgeKind: use.source.kind } : {}) };
        kwScientificValue(entry, reference, graph, activate);
        kwEl(entry, "p", { class: "kw-science-author" }, "Referenced by " + use.source.author);
      }
    }
  }

  function kwScientificDetail(parent, row, graph, activate, read, connections) {
    kwEl(parent, "p", { class: "kw-science-kind" }, kwScienceLabel(row.kind));
    kwEl(parent, "h3", { class: "kw-science-detail-title" }, row.statement || row.rationale || row.id);
    if (row.author) kwEl(parent, "p", { class: "kw-science-author" }, "Authored by " + row.author);
    kwEl(parent, "p", { class: "kw-science-reference-id mono" }, row.id);
    const navigation = kwEl(parent, "nav", { class: "kw-science-connections-nav",
      "aria-label": "Relations for the selected record" });
    for (const connection of connections) {
      const jump = kwEl(navigation, "button", { type: "button",
        "data-science-focus": "jump:" + connection.side }, connection.label);
      jump.addEventListener("click", connection.open);
    }
    if (row.source) {
      kwScientificField(parent, "Source", row.source, graph, activate);
      kwScientificField(parent, "Target", row.target, graph, activate);
      kwScientificField(parent, "Rationale", row.rationale, graph, activate);
      kwScientificField(parent, "Basis", row.basis, graph, activate);
      kwScientificAssertionNote(parent, row.kind);
    }
    if (row.resource) kwScientificValue(parent, row.reference, graph, activate);
    else if (row.details && Object.keys(row.details).length) kwScientificDetails(parent, row, graph, activate);
    if (!row.source) {
      const citation = row.legacy ? kwCitation(row.evidence) : row.evidence;
      kwScientificField(parent, "Cited records", citation, graph, activate);
    }
    kwScientificUses(parent, row, graph, activate, read);
    kwScientificField(parent, "Context", row.context, graph, activate);
    kwScientificField(parent, "Limits", row.limits, graph, activate);
    kwScientificField(parent, "Uncertainty", row.uncertainty, graph, activate);
    const key = kwScientificKey(row);
    const identity = kwEl(parent, "details", { class: "kw-science-identity",
      "data-science-identity": key });
    identity.open = read.identityOpen.has(key);
    identity.addEventListener("toggle", () => {
      if (!identity.isConnected) return;
      if (identity.open) read.identityOpen.add(key);
      else read.identityOpen.delete(key);
    });
    kwEl(identity, "summary", { "data-science-focus": "identity:" + key }, "Record identity and sharing");
    for (const key of ["schemaVersion", "schemaId", "provenance", "promotions", "detailRead"])
      kwScientificField(identity, key, row[key], graph, activate);
  }

  function kwScientificConnection(parent, edge, selected, graph, activate) {
    const outgoing = kwScientificMatches(edge.source, selected);
    const endpoint = outgoing ? edge.target : edge.source;
    const row = kwScientificResolve(graph, endpoint);
    const entry = kwEl(parent, "article", { class: "kw-science-connection", "data-science-edge": edge.id });
    const relation = kwEl(entry, "button", { class: "kw-science-relation", type: "button",
      "data-science-focus": "edge:" + edge.id },
    (outgoing ? "→ " : "← ") + kwScienceLabel(edge.kind));
    relation.addEventListener("click", () => activate(kwScientificKey(edge)));
    if (edge.author) kwEl(entry, "p", { class: "kw-science-author" }, "Relation authored by " + edge.author);
    kwEl(entry, "p", { class: "kw-science-rationale" }, edge.rationale);
    kwScientificAssertionNote(entry, edge.kind);
    kwScientificField(entry, "Basis", edge.basis, graph, activate);
    kwScientificField(entry, "Scope", edge.context && edge.context.scope, graph, activate);
    kwScientificField(entry, "Limits", edge.limits, graph, activate);
    if (row) kwScientificTile(entry, row, graph, activate);
    else kwScientificValue(entry, endpoint, graph, activate);
    if (edge.uncertainty) kwEl(entry, "p", { class: "kw-science-uncertainty" }, edge.uncertainty);
  }

  function kwRenderScientific(container, data, opts, graph, readingResize = false) {
    container.classList.add("kw-science");
    let read = kwScientificReads.get(container);
    if (!read) {
      read = { selected: "", addressSelected: "", query: "", relation: "", history: [], legacy: false,
        identityOpen: new Set(), referencesOpen: new Set() };
      kwScientificReads.set(container, read);
    }
    const requested = (opts && opts.scientificSelected) || (opts.selectedId ? "node:" + opts.selectedId : "");
    if (requested !== read.addressSelected) {
      read.selected = requested;
      read.addressSelected = requested;
    }
    if (opts.focusRelationSeq && opts.focusRelationSeq !== read.focusRelationSeq) {
      read.relation = opts.focusRelation || "";
      read.focusRelationSeq = opts.focusRelationSeq;
    }
    const select = (key) => {
      read.selected = key;
      read.addressSelected = key;
      if (opts) opts.scientificSelected = key;
      if (opts && typeof opts.onSelectScientific === "function") opts.onSelectScientific(key);
    };
    graph.messages = data.messages || {};
    graph.onReadMessage = opts && opts.onReadMessage;
    graph.onOpenReference = opts && opts.onOpenScientificReference;
    for (const identity of container.querySelectorAll("details[data-science-identity]")) {
      const key = identity.getAttribute("data-science-identity");
      if (identity.open) read.identityOpen.add(key);
      else read.identityOpen.delete(key);
    }
    for (const references of container.querySelectorAll("details[data-science-uses-key]")) {
      const key = references.getAttribute("data-science-uses-key");
      if (references.open) read.referencesOpen.add(key);
      else read.referencesOpen.delete(key);
    }
    const previous = container.contains(document.activeElement) ? document.activeElement : null;
    const readerTop = container.querySelector(".kw-science-neighborhood")?.scrollTop || 0;
    const focus = previous && previous.getAttribute("data-science-focus");
    const caret = previous && typeof previous.selectionStart === "number"
      ? [previous.selectionStart, previous.selectionEnd] : null;
    const minHeight = container.style.minHeight;
    container.style.minHeight = container.getBoundingClientRect().height + "px";
    container.textContent = "";
    const overview = data.overview || {};
    const redraw = () => kwRenderScientific(container, data, opts, graph);
    const activate = (id) => {
      if (read.selected !== String(id)) read.history.push(read.selected);
      select(String(id));
      redraw();
    };
    const tools = kwEl(container, "div", { class: "kw-science-tools" });
    const home = kwEl(tools, "button", { type: "button", "data-science-focus": "overview" }, "Clear selection");
    home.addEventListener("click", () => { select(""); redraw(); });
    const back = kwEl(tools, "button", { type: "button", "data-science-focus": "back" }, "Back");
    back.disabled = !read.history.length;
    back.addEventListener("click", () => { if (read.history.length) { select(read.history.pop()); redraw(); } });
    const filters = kwEl(container, "div", { class: "kw-science-filters" });
    const search = kwEl(filters, "input", { type: "search", placeholder: "Find knowledge or a relation…",
      "aria-label": "Search knowledge records", "data-science-focus": "search" });
    search.value = read.query;
    search.addEventListener("input", () => {
      if (read.selected) { read.history.push(read.selected); select(""); }
      read.query = search.value;
      redraw();
    });
    const relation = kwEl(filters, "select", { "aria-label": "Filter relations", "data-science-focus": "relation-filter" });
    kwEl(relation, "option", { value: "" }, "All relations");
    for (const kind of Array.from(new Set(Array.from(graph.edges.values(), (edge) => edge.kind))).sort())
      kwEl(relation, "option", { value: kind }, kwScienceLabel(kind));
    relation.value = read.relation;
    relation.addEventListener("change", () => { read.relation = relation.value; redraw(); });
    kwEl(container, "p", { class: "kw-science-caption" },
      graph.nodes.size + " knowledge records · "
      + Array.from(graph.edges.values()).filter((edge) => !edge.referenceUse).length + " relations · "
      + Array.from(graph.edges.values()).filter((edge) => edge.referenceUse).length + " reference links");
    const selected = read.selected.startsWith("edge:") ? graph.edges.get(read.selected.slice(5))
      : read.selected.startsWith("node:") ? graph.nodes.get(read.selected.slice(5)) : null;
    const edges = Array.from(graph.edges.values()).filter((edge) => !read.relation || edge.kind === read.relation);
    const content = kwEl(container, "div", { class: "kg-content" + (selected ? " has-selection" : "") });
    kwKnowledgeCanvas(content, graph, read, activate, tools, container);
    if (!graph.nodes.size && !graph.edges.size) kwEl(container, "p", { class: "kg-empty" }, "No knowledge records in this scope.");
    if (!selected) kwEl(content, "p", { class: "kg-reader-prompt" }, "Select a knowledge record or relation to read its evidence and limits.");
    if (selected) {
      const neighborhood = kwEl(content, "div", { class: "kw-science-neighborhood" });
      const openRegion = (side) => {
        const region = neighborhood.querySelector('[data-science-focus="' + side + '"]');
        if (region) {
          region.focus({ preventScroll: true });
        }
      };
      const incomingEdges = edges.filter((edge) => kwScientificMatches(edge.target, selected));
      const outgoingEdges = edges.filter((edge) => kwScientificMatches(edge.source, selected));
      const incoming = kwEl(neighborhood, "section", { class: "kw-science-incoming kw-science-region",
        tabindex: "-1", "data-science-focus": "incoming", "aria-label": "Incoming relations" });
      kwEl(incoming, "h3", null, selected.source ? "Source and incoming assertions" : "Incoming relations");
      const returnFromIncoming = kwEl(incoming, "button", { type: "button", class: "kw-science-record-return",
        "data-science-focus": "return:incoming" }, "Return to record");
      returnFromIncoming.addEventListener("click", () => openRegion("detail"));
      if (selected.source) {
        const source = kwScientificResolve(graph, selected.source);
        if (source) kwScientificTile(incoming, source, graph, activate);
        else kwScientificValue(incoming, selected.source, graph, activate);
      }
      const detail = kwEl(neighborhood, "section", { class: "kw-science-detail kw-science-region", tabindex: "-1",
        "data-science-focus": "detail", "aria-label": "Selected scientific record" });
      kwScientificDetail(detail, selected, graph, activate, read, [
        { side: "incoming", label: selected.source ? "Source and incoming assertions"
          : "Incoming relations · " + incomingEdges.length, open: () => openRegion("incoming") },
        { side: "outgoing", label: selected.target ? "Target and outgoing assertions"
          : "Outgoing relations · " + outgoingEdges.length, open: () => openRegion("outgoing") },
      ]);
      const outgoing = kwEl(neighborhood, "section", { class: "kw-science-outgoing kw-science-region",
        tabindex: "-1", "data-science-focus": "outgoing", "aria-label": "Outgoing relations" });
      kwEl(outgoing, "h3", null, selected.target ? "Target and outgoing assertions" : "Outgoing relations");
      const returnFromOutgoing = kwEl(outgoing, "button", { type: "button", class: "kw-science-record-return",
        "data-science-focus": "return:outgoing" }, "Return to record");
      returnFromOutgoing.addEventListener("click", () => openRegion("detail"));
      if (selected.target) {
        const target = kwScientificResolve(graph, selected.target);
        if (target) kwScientificTile(outgoing, target, graph, activate);
        else kwScientificValue(outgoing, selected.target, graph, activate);
      }
      for (const [side, connected] of [[incoming, incomingEdges], [outgoing, outgoingEdges]]) {
        for (const edge of connected) kwScientificConnection(side, edge, selected, graph, activate);
        if (!connected.length) kwEl(side, "p", { class: "muted" }, "No relations in this reading");
      }
    }
    const reader = container.querySelector(".kw-science-neighborhood");
    if (reader) reader.scrollTop = readerTop;
    if (focus) {
      const restored = Array.from(container.querySelectorAll("[data-science-focus]"))
        .find((control) => control.getAttribute("data-science-focus") === focus);
      if (restored) {
        restored.focus({ preventScroll: true });
        if (caret && typeof restored.setSelectionRange === "function") restored.setSelectionRange(...caret);
      }
    }
    container.style.minHeight = minHeight;
    return { findings: graph.nodes.size, promotions: (overview.promotions || []).length };
  }

  // Legacy records retain their labels. Only knowledge endpoints enter the graph.
  function kwAddLegacyKnowledge(graph, overview) {
    const resourceKinds = new Set(["message", "task", "report", "turn", "issue", "pr", "external", "file", "http", "https"]);
    for (const row of [...(overview.findings || []), ...(overview.nodes || [])]) {
      if (!row || row.schemaVersion === 1 || row.referenceOnly || !row.id || !row.claim) continue;
      if (!graph.nodes.has(String(row.id))) graph.nodes.set(String(row.id), {
        ...row, kind: row.kind || "finding", statement: row.claim, legacy: true,
        promotions: (overview.promotions || []).filter((p) => p.finding === row.id),
      });
    }
    const endpoint = (value) => {
      if (value && typeof value === "object") return value.id && !["session", "group", "actor", "player"].includes(value.kind) ? value : null;
      const text = String(value || "");
      const id = text.startsWith("finding:") ? text.slice(8) : text;
      if (graph.nodes.has(id)) return { kind: graph.nodes.get(id).kind, id };
      if (text.startsWith("finding:") && id) return { kind: "finding", id };
      const separator = text.indexOf(":");
      const kind = text.slice(0, separator);
      if (!resourceKinds.has(kind)) return null;
      return { kind: kind === "http" || kind === "https" ? "external" : kind, id: text };
    };
    for (const row of [...(overview.edges || []), ...(overview.relations || [])]) {
      if (!row || row.schemaVersion === 1 || !row.id || graph.edges.has(String(row.id))) continue;
      if (row.sourceKind === "session" || row.sourceKind === "group"
        || row.targetKind === "session" || row.targetKind === "group") continue;
      if (row.provenance && !["authored", "recorded-evidence"].includes(row.provenance)) continue;
      const source = endpoint(row.sourceReference || row.source), target = endpoint(row.targetReference || row.target);
      if (!source || !target) continue;
      for (const ref of [source, target]) if (!graph.nodes.has(ref.id)) graph.nodes.set(ref.id, {
        id: ref.id, kind: ref.kind, statement: ref.id,
        reference: { kind: ref.kind, id: /^https?:/.test(ref.id) ? ref.id : ref.id.slice(ref.id.indexOf(":") + 1),
          ...(/^https?:/.test(ref.id) ? { uri: ref.id } : {}) },
        resource: true, outside: ref.kind === "finding", legacy: true,
      });
      graph.edges.set(String(row.id), { ...row, kind: row.relation || row.kind || "references",
        source, target, rationale: row.rationale || "", legacy: true });
    }
    return graph;
  }

  const kwGraphViews = new WeakMap();
  let kwGraphSerial = 0;

  function kwKnowledgeRoute(from, to, lane, same) {
    const dx = to.x - from.x;
    const x1 = dx > 0 ? from.x + from.width : from.x;
    const x2 = dx > 0 ? to.x : to.x + to.width;
    const y1 = from.y + from.height / 2, y2 = to.y + to.height / 2;
    let d, lx, ly, mx, my;
    if (same) {
      const lift = 34 + lane * 26;
      d = "M " + (from.x + 70) + " " + from.y + " C " + (from.x + 70) + " " + (from.y - lift)
        + " " + (from.x + 200) + " " + (from.y - lift) + " " + (from.x + 200) + " " + from.y;
      lx = mx = from.x + 135; ly = my = from.y - lift * .75;
    } else if (Math.abs(dx) < 1) {
      const outside = from.x + from.width + 58 + lane * 25;
      d = "M " + (from.x + from.width) + " " + y1 + " C " + outside + " " + y1
        + " " + outside + " " + y2 + " " + (to.x + to.width) + " " + y2;
      mx = from.x + from.width + (outside - from.x - from.width) * .75;
      lx = mx; ly = my = (y1 + y2) / 2;
    } else {
      const middle = (x1 + x2) / 2 + lane * 20;
      d = "M " + x1 + " " + y1 + " C " + middle + " " + y1 + " " + middle + " " + y2 + " " + x2 + " " + y2;
      mx = (x1 + x2 + 6 * middle) / 8; my = (y1 + y2) / 2;
      lx = mx; ly = my + lane * 24;
    }
    return { d, lx, ly, mx, my };
  }

  // Strongly connected components keep cycles together. Directed paths set columns.
  function kwKnowledgeLayout(graph) {
    const records = new Map(Array.from(graph.nodes.values()).map((row) => [kwScientificKey(row), row]));
    const endpointKey = (reference) => (reference.kind === "edge" ? "edge:" : "node:") + reference.id;
    for (const edge of graph.edges.values()) for (const ref of [edge.source, edge.target]) {
      const key = endpointKey(ref);
      if (ref.kind === "edge" || records.has(key)) continue;
      records.set(key, { id: ref.id, kind: ref.kind, statement: ref.id, outside: true, reference: ref });
    }
    // Relations referenced by another assertion have a selectable junction.
    for (const edge of graph.edges.values()) for (const ref of [edge.source, edge.target]) {
      if (ref.kind !== "edge") continue;
      const key = endpointKey(ref);
      if (!records.has(key)) records.set(key, graph.edges.get(String(ref.id))
        || { id: ref.id, kind: ref.edgeKind, source: {}, target: {}, outside: true, reference: ref });
    }
    const links = Array.from(graph.edges.values()).map((edge) => ({ row: edge,
      from: endpointKey(edge.source), to: endpointKey(edge.target) }));
    const adjacent = new Map(Array.from(records.keys()).map((key) => [key, []]));
    const undirected = new Map(Array.from(records.keys()).map((key) => [key, new Set()]));
    for (const link of links) if (records.has(link.from) && records.has(link.to)) {
      if (!link.row.referenceUse) adjacent.get(link.from).push(link.to);
      undirected.get(link.from).add(link.to);
      undirected.get(link.to).add(link.from);
    }
    // A relation junction belongs to its own endpoints' component.
    for (const [key, row] of records) if (key.startsWith("edge:") && graph.edges.has(String(row.id))) {
      for (const ref of [row.source, row.target]) {
        const end = endpointKey(ref);
        if (!records.has(end) || end === key) continue;
        undirected.get(key).add(end);
        undirected.get(end).add(key);
      }
    }
    let index = 0;
    const discovery = new Map(), low = new Map(), stack = [], stacked = new Set();
    const components = [], componentOf = new Map();
    const visit = (key) => {
      discovery.set(key, index); low.set(key, index++); stack.push(key); stacked.add(key);
      for (const next of adjacent.get(key)) {
        if (!discovery.has(next)) { visit(next); low.set(key, Math.min(low.get(key), low.get(next))); }
        else if (stacked.has(next)) low.set(key, Math.min(low.get(key), discovery.get(next)));
      }
      if (low.get(key) !== discovery.get(key)) return;
      const component = [];
      let next;
      do { next = stack.pop(); stacked.delete(next); componentOf.set(next, components.length); component.push(next); } while (next !== key);
      components.push(component.sort());
    };
    for (const key of Array.from(records.keys()).sort()) if (!discovery.has(key)) visit(key);
    const parents = components.map(() => new Set());
    for (const link of links) {
      if (link.row.referenceUse) continue;
      const a = componentOf.get(link.from), b = componentOf.get(link.to);
      if (a !== undefined && b !== undefined && a !== b) parents[b].add(a);
    }
    const ranks = new Map();
    const rank = (component) => {
      if (!ranks.has(component)) ranks.set(component,
        parents[component].size ? 1 + Math.max(...Array.from(parents[component], rank)) : 0);
      return ranks.get(component);
    };
    const islands = [], seen = new Set();
    for (const key of Array.from(records.keys()).sort()) {
      if (seen.has(key)) continue;
      const island = [], pending = [key]; seen.add(key);
      while (pending.length) {
        const current = pending.pop(); island.push(current);
        for (const next of undirected.get(current)) if (!seen.has(next)) { seen.add(next); pending.push(next); }
      }
      islands.push(island);
    }
    islands.sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));
    const positions = new Map();
    let top = 28, width = 320;
    for (const island of islands) {
      const columns = new Map();
      for (const key of island) {
        if (key.startsWith("edge:")) continue;
        const column = rank(componentOf.get(key));
        if (!columns.has(column)) columns.set(column, []);
        columns.get(column).push(key);
      }
      let count = 1;
      for (const [column, keys] of columns) {
        keys.sort((a, b) => componentOf.get(a) - componentOf.get(b) || a.localeCompare(b));
        count = Math.max(count, keys.length);
        keys.forEach((key, i) => positions.set(key, { x: 28 + column * 410, y: top + i * 148,
          width: 270, height: 100, row: records.get(key) }));
        width = Math.max(width, 326 + column * 410);
      }
      top += count * 148 + 60;
    }
    const pairLanes = new Map(), lanes = new Map();
    for (const link of links) {
      const pair = link.from + "\u0000" + link.to;
      const lane = pairLanes.get(pair) || 0; pairLanes.set(pair, lane + 1);
      lanes.set(kwScientificKey(link.row), lane);
    }
    const placing = new Set();
    const placeJunction = (key) => {
      if (positions.has(key)) return positions.get(key);
      const row = records.get(key);
      if (!row) return null;
      if (placing.has(key)) return {x:28,y:top,width:18,height:18};
      placing.add(key);
      const fromKey = endpointKey(row.source), toKey = endpointKey(row.target);
      const from = positions.get(fromKey) || (fromKey.startsWith("edge:") && placeJunction(fromKey));
      const to = positions.get(toKey) || (toKey.startsWith("edge:") && placeJunction(toKey));
      const route = from && to ? kwKnowledgeRoute(from, to, lanes.get(key) || 0, fromKey === toKey) : null;
      const box = {x:route ? route.mx - 9 : 28,y:route ? route.my - 9 : top,
        width:18,height:18,row,junction:true};
      positions.set(key,box); placing.delete(key); return box;
    };
    for (const key of records.keys()) if (key.startsWith("edge:")) placeJunction(key);
    return { records, links, positions, width, height: Math.max(180, top), endpointKey };
  }

  function kwKnowledgeCanvas(container, graph, read, activate, tools, viewOwner) {
    const layout = kwKnowledgeLayout(graph);
    const frame = kwEl(container, "div", { class: "kg-frame" });
    const width = Math.max(280, frame.clientWidth || container.clientWidth || 800), height = 520;
    const svg = kwSvg(frame, "svg", { class: "kg-canvas kw-canvas", viewBox: "0 0 " + width + " " + height,
      role: "group", "aria-label": "Knowledge records and directed relations", tabindex: "0",
      "data-science-focus": "graph" });
    const label = kwSvg(svg, "title");
    label.textContent = "Select a record or relation to read its evidence, reasoning and limits. Drag to pan; use the zoom controls to change scale.";
    const defs = kwSvg(svg, "defs");
    const arrowId = "kg-arrow-" + ++kwGraphSerial;
    const marker = kwSvg(defs, "marker", { id: arrowId, markerWidth: 8, markerHeight: 8,
      refX: 7, refY: 4, orient: "auto", markerUnits: "userSpaceOnUse" });
    kwSvg(marker, "path", { d: "M 0 0 L 8 4 L 0 8 Z", class: "kg-arrow" });
    const world = kwSvg(svg, "g", { class: "kg-world" });
    let camera = kwGraphViews.get(viewOwner);
    const initialView = !camera;
    if (!camera) { camera = { x: 0, y: 0, k: 1 }; kwGraphViews.set(viewOwner, camera); }
    const zoomLabel = kwEl(tools, "output", { class: "kg-zoom-level", "aria-label": "Graph scale" });
    const paint = () => {
      world.setAttribute("transform", "translate(" + camera.x + " " + camera.y + ") scale(" + camera.k + ")");
      zoomLabel.textContent = Math.round(camera.k * 100) + "%";
    };
    const fit = () => {
      let boxes = Array.from(layout.positions.values());
      if (!boxes.length) boxes = [{x:0,y:0,width:layout.width,height:layout.height}];
      const left = Math.min(...boxes.map((box) => box.x)) - 40;
      const top = Math.min(...boxes.map((box) => box.y)) - 40;
      const right = Math.max(...boxes.map((box) => box.x + box.width)) + 90;
      const bottom = Math.max(...boxes.map((box) => box.y + box.height)) + 40;
      camera.k = Math.min(1, width / (right - left), height / (bottom - top));
      camera.x = (width - (right - left) * camera.k) / 2 - left * camera.k;
      camera.y = (height - (bottom - top) * camera.k) / 2 - top * camera.k;
      paint();
    };
    const zoom = (factor, x = width / 2, y = height / 2) => {
      const k = camera.k * factor;
      camera.x = x - (x - camera.x) * factor;
      camera.y = y - (y - camera.y) * factor;
      camera.k = k; paint();
    };
    for (const [word, action] of [["Zoom in", () => zoom(1.25)], ["Zoom out", () => zoom(.8)], ["Fit graph", () => fit()]]) {
      const button = kwEl(tools, "button", { type: "button", "data-science-focus": word.toLowerCase().replaceAll(" ", "-") }, word);
      button.addEventListener("click", action);
    }
    const matches = (row) => !read.query || KnowledgeJSON.stringify(row).toLocaleLowerCase().includes(read.query.toLocaleLowerCase());
    const edgeLayer = kwSvg(world, "g", { class: "kg-relations" });
    const pairCounts = new Map();
    for (const link of layout.links) {
      const from = layout.positions.get(link.from), to = layout.positions.get(link.to);
      if (!from || !to) continue;
      const pair = link.from + "\u0000" + link.to;
      const lane = pairCounts.get(pair) || 0; pairCounts.set(pair, lane + 1);
      const {d, lx, ly} = kwKnowledgeRoute(from, to, lane, link.from === link.to);
      const key = kwScientificKey(link.row);
      const dim = read.relation && link.row.kind !== read.relation || read.query && !matches(link.row)
        && !matches(from.row) && !matches(to.row);
      const edge = kwSvg(edgeLayer, "g", { class: "kg-edge" + (link.row.referenceUse ? " is-reference-use" : "") + (dim ? " is-dim" : "")
        + (key === read.selected ? " is-selected" : ""), role: "button", tabindex: "0",
        "data-science-focus": key, "data-knowledge-edge": link.row.id,
        "data-relation": link.row.kind, "data-from": link.from, "data-to": link.to,
        "aria-label": kwScienceLabel(link.row.kind) + ": " + (from.row.statement || from.row.id)
          + " → " + (to.row.statement || to.row.id) });
      kwSvg(edge, "path", { d, class: "kg-edge-line", "marker-end": "url(#" + arrowId + ")" });
      kwSvg(edge, "path", { d, class: "kg-edge-hit" });
      const name = kwSvg(edge, "text", { x: lx, y: ly - 6, class: "kg-edge-label" });
      name.textContent = link.row.label || kwScienceLabel(link.row.kind);
      const title = kwSvg(edge, "title"); title.textContent = edge.getAttribute("aria-label");
      const open = () => activate(key);
      edge.addEventListener("click", open);
      edge.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); } });
    }
    const nodeLayer = kwSvg(world, "g", { class: "kg-records" });
    for (const [key, box] of layout.positions) {
      const row = box.row;
      const dim = read.query && !matches(row)
        || read.relation && !layout.links.some((link) => link.row.kind === read.relation && (link.from === key || link.to === key));
      const node = kwSvg(nodeLayer, "g", { class: "kg-node" + (row.outside || row.resource ? " is-reference" : "")
        + (dim ? " is-dim" : "") + (read.selected === key ? " is-selected" : ""),
        role: "button", tabindex: "0", transform: "translate(" + box.x + " " + box.y + ")",
        "data-science-focus": key, "data-knowledge-node": row.id, "data-knowledge-kind": row.kind,
        "aria-label": kwScienceLabel(row.kind) + ": " + (row.statement || row.rationale || row.id) });
      kwSvg(node, "rect", { width: box.width, height: box.height, rx: box.junction ? 9 : 3, class: "kg-node-boundary" });
      const title = kwSvg(node, "title"); title.textContent = node.getAttribute("aria-label");
      if (!box.junction) {
      const foreign = kwSvg(node, "foreignObject", { x: 12, y: 9, width: box.width - 24, height: box.height - 18 });
      const words = document.createElementNS("http://www.w3.org/1999/xhtml", "div");
      words.setAttribute("class", "kg-node-words"); foreign.appendChild(words);
      kwEl(words, "span", { class: "kg-node-kind" }, kwScienceLabel(row.kind) + (row.outside ? " · outside this scope" : ""));
      kwEl(words, "span", { class: "kg-node-statement" }, row.statement || row.rationale || row.id);
      }
      const open = () => {
        if (row.outside) { if (graph.onOpenReference) graph.onOpenReference(row.reference); }
        else activate(key);
      };
      node.addEventListener("click", open);
      node.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); } });
    }
    if (initialView) fit(); else paint();
    let drag = null;
    svg.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.target.closest(".kg-node, .kg-edge")) return;
      const rect = svg.getBoundingClientRect();
      drag = { x: event.clientX, y: event.clientY, rect, cx: camera.x, cy: camera.y };
      svg.setPointerCapture(event.pointerId);
    });
    svg.addEventListener("pointermove", (event) => {
      if (!drag) return;
      camera.x = drag.cx + (event.clientX - drag.x) * width / drag.rect.width;
      camera.y = drag.cy + (event.clientY - drag.y) * height / drag.rect.height;
      paint();
    });
    svg.addEventListener("pointerup", () => { drag = null; });
    svg.addEventListener("pointercancel", () => { drag = null; });
    svg.addEventListener("wheel", (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const rect = svg.getBoundingClientRect();
      zoom(Math.exp(-event.deltaY * .002), (event.clientX - rect.left) * width / rect.width,
        (event.clientY - rect.top) * height / rect.height);
    }, { passive: false });
    svg.addEventListener("keydown", (event) => {
      if (event.target !== svg) return;
      if (event.key === "+" || event.key === "=") { event.preventDefault(); zoom(1.25); }
      else if (event.key === "-") { event.preventDefault(); zoom(.8); }
      else if (event.key === "0") { event.preventDefault(); fit(); }
      else if (event.key === "Escape") { event.preventDefault(); activate(""); }
      else if (event.key.startsWith("Arrow")) {
        event.preventDefault();
        camera.x += event.key === "ArrowLeft" ? 50 : event.key === "ArrowRight" ? -50 : 0;
        camera.y += event.key === "ArrowUp" ? 50 : event.key === "ArrowDown" ? -50 : 0; paint();
      }
    });
  }
  function renderKnowledge(container, data, opts = {}, readingResize = false) {
    if (!container) return null;
    const overview = (data && data.overview) || {};
    if (opts.mode === "band") {
      container.textContent = "";
      kwRenderBand(container, overview, overview.promotions || [], opts);
      return { findings: (overview.findings || []).length, promotions: (overview.promotions || []).length };
    }
    kwWatchWidth(container, data, opts);
    if (opts.notice) {
      container.textContent = "";
      kwEl(container, "p", { class: "muted" }, opts.notice);
      return { findings: 0, promotions: 0 };
    }
    const graph = kwAddLegacyKnowledge(kwScientificGraph(overview), overview);
    return kwRenderScientific(container, data || {}, opts, graph, readingResize);
  }

  const kwArcSizeObservers = new WeakMap();

  function kwWatchArcSize(mount, data) {
    let state = kwArcSizeObservers.get(mount);
    if (!(data && data.promotions && data.promotions.length)) {
      if (state) state.observer.disconnect();
      kwArcSizeObservers.delete(mount);
      return;
    }
    if (typeof ResizeObserver !== "function") return;
    if (!state) {
      state = { width: mount.clientWidth, height: mount.clientHeight, data, observer: null };
      state.observer = new ResizeObserver(() => {
        if (!mount.isConnected) {
          state.observer.disconnect();
          kwArcSizeObservers.delete(mount);
          return;
        }
        if (mount.clientWidth !== state.width || mount.clientHeight !== state.height)
          renderArcs(mount, state.data);
      });
      kwArcSizeObservers.set(mount, state);
      state.observer.observe(mount);
    }
    state.width = mount.clientWidth;
    state.height = mount.clientHeight;
    state.data = data;
  }

  // Roster overlay: one arc per recorded promotion joins the source
  // row to the destination row in the margin gutter, so sharing reads
  // at a glance in the default view. Rows that are not rendered take
  // no arc. The selection lights its own arcs.
  function renderArcs(mount, data) {
    if (!mount || typeof document === "undefined") return;
    kwWatchArcSize(mount, data);
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
    const width = mount.clientWidth || 0;
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
      const owed = Math.max(seat.pendingCount || 0, seat.unreadCount || 0);
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


