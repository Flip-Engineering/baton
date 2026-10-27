/* Orchestra live view. Read-only. All DOM text via textContent. */

const CONTRACT_VERSION = 1;
const AGE_REFRESH_MS = 30000;

const state = {
  apiBase: "",
  fixtureName: "",
  subject: "",
  cursor: "",
  generation: "",
  opened: false,
  gapHeld: false,
  gapText: "",
  players: new Map(),
  ensembles: new Map(),
  transitions: [],
  tasks: {},
  providers: {},
  selectionId: null,
  snapshotLabel: "",
  capturedAt: "",
  // Live scope shows running and queued actors; all shows every actor.
  scope: "live",
  // Bumped by every fetched read and by interactions that change what the document
  // draws; the redraw signature carries it.
  renderSeq: 0,
  // A seat named by the page address (#seat=<id>), honoured on the first
  // snapshot that carries it.
  pendingSeat: "",
  // A relation named by the page address (#relation=<provenance>:<source>:<target>),
  // honoured on the first snapshot that carries its ends.
  pendingRelation: null,
  sse: null,
  connected: false,
  knowledge: null,
  fixtureKnowledge: null,
  knowledgeNotice: "",
  knowledgeActor: null,
  knowledgeActorId: "",
  knowledgeActorRequest: null,
  // The selected knowledge tier and its recorded holder.
  knowledgeScope: { kind: "universal", id: "" },
  knowledgeScopeExplicit: false,
  // The ensemble a reader has selected, when they picked one: the position the roster
  // marks and the address names, cleared when a seat selection takes the hash.
  ensembleId: null,
  // The relation the record asked the map to light, by its recorded name.
  knowledgeFocusRelation: "",
  // Bumped by every relation activation, so activating the same relation again
  // after a dismissal is a new request rather than the same one.
  knowledgeFocusSeq: 0,
  // The project surface: the selected actor's recorded workspace, its prior conversations and
  // the outcome of continuing one. Read on demand; the actor it belongs to travels with it.
  project: null,
  projectNotice: "",
  projectError: null,
  // The project read's own outcome: "" before any read, then reading, none,
  // missing, error or ok. The record reads this so a read that did not answer
  // is named rather than left out.
  projectRead: "",
  projectActor: "",
  projectRequest: null,
  resume: null,
  work: null,
  workRequest: null,
  workActorId: "",
  // Complete stored bodies, keyed by message id, with an explicit read state.
  messages: {},
  knowledgeOpen: false,
  includeUnshared: false,
  knowledgeSearch: "",
  findingId: null,
  scientificSelected: "",
  ribbonSeq: null,
  graphRecord: null,
  graphRecordRequest: null,
  knowledgeLiveOnly: false,
  knowledgeSeatEmpty: "",
  view: "now",
};

// A sink for values nothing displays. Stream, cursor, generation and contract
// bookkeeping is written on every frame and is not human oversight, so it lands
// here instead of on the page. The retired panel mounts and the renderers that
// wrote to them are gone; only these writers remain.
const sink = document.createElement("div");
const el = {
  snapshotLine: document.getElementById("snapshot-line"),
  notice: document.getElementById("notice"),
  fixtureNotice: document.getElementById("fixture-notice"),
  // The document shell.
  attentionBand: document.getElementById("attention-band"),
  selection: document.getElementById("selection"),
  ribbon: document.getElementById("ribbon"),
  knowledgeWhole: document.getElementById("knowledge-whole"),
  mapScope: document.getElementById("map-scope"),
  platePit: document.getElementById("plate-pit"),
  plateMap: document.getElementById("plate-map"),
  plateStaves: document.getElementById("plate-staves"),
  plateRecord: document.getElementById("plate-record"),
  plateProject: document.getElementById("plate-project"),
  projectState: document.getElementById("project-state"),
  projectBody: document.getElementById("project-body"),
  projectLoad: document.getElementById("project-load"),
  mapScopeAll: document.getElementById("map-scope-all"),
  mapScopeHolder: document.getElementById("map-scope-holder"),
  counts: document.getElementById("doc-counts"),
  find: document.getElementById("doc-find"),
  showEnded: document.getElementById("doc-ended"),
  reconnect: document.getElementById("reconnect"),
  // The plate line and the rail.
  plateMark: document.getElementById("plate-mark"),
  rail: document.getElementById("rail"),
  // Written, never displayed.
  connState: sink,
  cursorState: sink,
  contractState: sink,
  generationState: sink,
  includeUnshared: sink,
  knowledgeSearch: sink,
};

function text(parent, value) {
  parent.appendChild(document.createTextNode(value == null ? "" : String(value)));
}


/* --- recorded state ------------------------------------------------------- */

function deriveStatus(p) {
  const stop = p.stop || null;
  if (stop && stop.status === "stopped") return "stopped";
  const ex = p.execution || null;
  if (ex && (ex.phase === "running" || ex.phase === "starting")) return "running";
  if (ex && ex.phase === "exited") {
    // A physical exit 0 does not prove the turn finished: a provider refusal can
    // end the process with a zero status, and an OMP 403 is recorded that way.
    // The terminal for the current attempt decides, read as
    // execution.failure: null, or {cause, eventType, stopReason, errorStatus,
    // errorMessage}. The field is absent until the server read projects it, and
    // the physical status stands while it is absent.
    const failure = ex.failure || null;
    if (failure || ex.status !== "exit 0") return "failed";
    return "completed";
  }
  // Owed means the pending work set plus recorded reports awaiting
  // a read; the unread count carries what the pending
  // set omits. Status and ordering read this total; the row marks show
  // the two counts as two separate facts.
  if (Math.max(p.pendingCount || 0, p.unreadCount || 0) > 0) return "pending";
  return "unknown";
}

// A seat owes work when its recorded queue holds unread messages: the actor's
// own inbox answers them.
function owesWork(p) {
  return Math.max(p.pendingCount || 0, p.unreadCount || 0) > 0;
}

// Identify an explicit stop or failure on the current attempt.
function notProgressing(p) {
  const stop = p.stop || null;
  if (stop && stop.status === "stopped") {
    return { word: "stopped", detail: stop.id || "a recorded stop" };
  }
  if (deriveStatus(p) === "failed") {
    return { word: "failed", detail: "the attempt ended on a recorded failure" };
  }
  return null;
}

function roleRank(role) {
  if (role === "principal-conductor") return 0;
  if (role === "associate-conductor") return 1;
  if (role === "operator") return 2;
  return 3;
}

// The activity rail class for one recorded change kind. Kind values carry ":" and
// "-", so the class is the kind with every other character replaced by "-".

function ageText(at) {
  if (!at) return "";
  const then = Date.parse(at);
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return seconds + "s ago";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return minutes + "m ago";
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours + "h ago";
  return Math.round(hours / 24) + "d ago";
}

function lastTransitionFor(id) {
  for (const t of state.transitions) {
    if (t.session === id) return t;
  }
  return null;
}

// What the actor is doing now when the database records it, otherwise the last
// committed transition, marked stale. Nothing here invents work.
function actionFor(p) {
  const current = p.currentAction || null;
  const label = current && current.label ? current.label : "";
  const last = lastTransitionFor(p.id);
  if (label && label.toLowerCase() !== deriveStatus(p)) {
    return { label, at: current.at || "", stale: false };
  }
  // A bare phase word repeats the recorded status beside it, so the slot
  // falls back to the actor's latest recorded transition instead.
  if (last) return { label: last.summary || last.kind || "", at: last.at || "", stale: true };
  if (label) return { label, at: current.at || "", stale: false };
  return null;
}

function pendingItems(p) {
  return Array.isArray(p.pendingSample) ? p.pendingSample : [];
}

/* --- notices and transport ------------------------------------------------ */

function setNotice(message) {
  if (!message) {
    el.notice.hidden = true;
    el.notice.textContent = "";
    return;
  }
  el.notice.hidden = false;
  el.notice.textContent = "";
  text(el.notice, message);
}

function setConn(word) {
  el.connState.textContent = "";
  text(el.connState, word);
}

// Keep the count and its label in separate elements, with a text separator.
// A figure on the plate line. With a jump target it becomes the page's index: clicking it
// focuses the first seat in that state.
function fact(label, value, tone, jump) {
  const node = document.createElement(jump ? "button" : "span");
  node.className = "fact" + (tone ? " " + tone : "") + (jump ? " fact-jump" : "");
  if (jump) {
    node.type = "button";
    node.title = "Focus the first " + label + " seat";
    node.setAttribute("aria-label", "Focus the first " + label + " seat");
    node.addEventListener("click", () => focusFirstRow(jump));
  }
  const figure = document.createElement("b");
  text(figure, String(value));
  node.appendChild(figure);
  const name = document.createElement("span");
  text(name, " " + label);
  node.appendChild(name);
  return node;
}

// Focus the first actor matching a state without changing the viewing position.
function focusFirstRow(matches) {
  const wanted = [...state.players.values()].filter(matches).map((p) => p.id);
  const find = () => {
    for (const id of wanted) {
      const control = el.attentionBand.querySelector('.att-seat[data-att-id="' + CSS.escape(id) + '"]');
      if (control) return control;
    }
    return null;
  };
  let control = find();
  if (!control && state.scope !== "all" && el.showEnded) {
    state.scope = "all";
    el.showEnded.setAttribute("aria-pressed", "true");
    renderDocument();
    control = find();
  }
  if (!control) return;
  control.focus({ preventScroll: true });
}

// The separator between two figures on the plate line. It carries the space
// before it, and the label's own leading space carries the one after, so the
// line still reads as prose: "read just now · 12 running · 2 stopped or failed".
function factSeparator() {
  const span = document.createElement("span");
  span.className = "fact-sep";
  text(span, " ·");
  return span;
}

// Authored relations and recorded evidence citations for the selected finding.
// The scope response supplies citations in edges and authored rows in relations.
function relationsFor(findingId) {
  const knowledge = state.knowledge || {};
  const all = (knowledge.relations || []).concat((knowledge.edges || [])
    .filter((edge) => edge && edge.provenance === "recorded-evidence"));
  if (!all.length) return [];
  const id = String(findingId || "");
  const ref = "finding:" + id;
  return all.filter((r) => r
    && (r.source === ref || r.target === ref || r.source === id || r.target === id
      || r.sourceReference === ref || r.targetReference === ref));
}

// Show current actor states and the number of actors with pending input.
function renderHeaderLine() {
  let running = 0;
  let stopped = 0;
  let waiting = 0;
  let owed = 0;
  for (const p of state.players.values()) {
    const status = deriveStatus(p);
    if (status === "running") running += 1;
    else if (status === "pending") waiting += 1;
    if (status === "stopped" || status === "failed") stopped += 1;
    if (owesWork(p)) owed += 1;
  }
  el.snapshotLine.textContent = "";
  const snapshot = document.createElement("span");
  snapshot.className = "fact";
  // Display the subject and snapshot age separately.
  const subject = String(state.subject || "");
  if (subject && state.players.size) {
    text(snapshot, subject);
    snapshot.title = state.snapshotLabel || "";
  } else {
    text(snapshot, state.snapshotLabel || "No snapshot loaded.");
  }
  el.snapshotLine.appendChild(snapshot);
  if (subject && state.players.size && state.capturedAt) {
    el.snapshotLine.appendChild(factSeparator());
    const age = document.createElement("span");
    age.className = "fact fact-age";
    text(age, "read " + (ageText(state.capturedAt) || "just now"));
    el.snapshotLine.appendChild(age);
  }
  if (state.players.size) {
    // Count running, stopped or failed, and queued actors.
    el.snapshotLine.appendChild(factSeparator());
    el.snapshotLine.appendChild(fact("running", running, "", (p) => deriveStatus(p) === "running"));
    el.snapshotLine.appendChild(factSeparator());
    el.snapshotLine.appendChild(fact("stopped or failed", stopped,
      stopped > 0 ? "attention" : "", (p) => ["stopped", "failed"].includes(deriveStatus(p))));
    el.snapshotLine.appendChild(factSeparator());
    el.snapshotLine.appendChild(fact("queued", waiting, "", (p) => deriveStatus(p) === "pending"));
    if (owed > 0) {
      el.snapshotLine.appendChild(factSeparator());
      el.snapshotLine.appendChild(fact("owe work", owed, "", owesWork));
    }
  }
  el.snapshotLine.title = state.capturedAt ? "snapshot captured " + state.capturedAt : "";
}
function setCursor(cursor) {
  state.cursor = cursor || "";
  el.cursorState.textContent = "";
  text(el.cursorState, state.cursor || "none");
  renderHeaderLine();
}

function queryString() {
  const parts = [];
  if (state.subject) parts.push("subject=" + encodeURIComponent(state.subject));
  if (state.cursor) parts.push("since=" + encodeURIComponent(state.cursor));
  if (state.generation) parts.push("generation=" + encodeURIComponent(state.generation));
  return parts.length ? "?" + parts.join("&") : "";
}

function setGeneration(generation) {
  state.generation = generation || "";
  const node = el.generationState;
  if (!node) return;
  node.textContent = "";
  text(node, state.generation || "none");
  renderHeaderLine();
}

function holdGapNotice(message) {
  state.gapHeld = true;
  state.gapText = message;
  setNotice(message);
}

function clearGapNotice() {
  if (state.gapHeld) {
    state.gapHeld = false;
    state.gapText = "";
    setNotice("");
  }
}

/* --- rendering ------------------------------------------------------------ */
// The seat address survives a reload and a shared link: the hash names the selection,
// inside the reader's tree or outside it.
function writeSeatAddress(id) {
  if (typeof history.replaceState === "function") {
    history.replaceState(null, "", "#seat=" + encodeURIComponent(id));
  }
}

// An ensemble is addressable as well, so a reader can send a link to a group's
// holdings rather than to one of its seats. Selecting a seat replaces this address,
// because the hash names one position and the scope follows it.
function writeEnsembleAddress(id) {
  if (typeof history.replaceState === "function") {
    history.replaceState(null, "", "#ensemble=" + encodeURIComponent(id));
  }
}

// The record is addressable by finding as well as by seat, so a reader can send a
// link to a claim. With no finding open the seat address stands, or the plain one.
function writeFindingAddress(id) {
  if (typeof history.replaceState !== "function") return;
  if (id) {
    history.replaceState(null, "", "#finding=" + encodeURIComponent(id));
    return;
  }
  if (state.selectionId) {
    writeSeatAddress(state.selectionId);
    return;
  }
  history.replaceState(null, "", location.pathname + location.search);
}

// A seam's relation is addressable in its own identity, so the back-and-forward
// routing reaches what a click opened. A cited seam carries its canonical
// citing finding separately from its drawn ends (an anchored seam draws from
// the author's seat), so the finding leads the resolution and takes the
// address's source slot: the click, the address and the reload all open the
// citing record. An authored relation opens the claiming seat.
function resolveRelationAddress(rel) {
  if (!rel) return;
  const ends = [rel.finding, rel.source, rel.target];
  const findingEnd = ends.find((e) => String(e || "").indexOf("finding:") === 0);
  if (findingEnd) {
    openRecordAt(String(findingEnd).slice("finding:".length));
  } else if (rel.source) {
    select(String(rel.source));
  }
}

function openRelationAt(rel) {
  if (!rel) return;
  resolveRelationAddress(rel);
  if (typeof history.replaceState === "function") {
    // Each field encodes on its own and the colons stay literal, so the
    // boot parse reads the same three components this writer emits, and a
    // field's own colons (typed prefixes, endpoint punctuation) survive
    // the round trip inside its encoding.
    const source = rel.finding ? String(rel.finding) : String(rel.source || "");
    history.replaceState(null, "", "#relation="
      + encodeURIComponent(String(rel.provenance || ""))
      + ":" + encodeURIComponent(source)
      + ":" + encodeURIComponent(String(rel.target || "")));
  }
}

function select(id) {
  // An id outside the snapshot is an outside-tree subject, never a dead one: the
  // record reads the id and says so, and the reads answer their own refusal. No
  // other seat behaviour changes, and the address write below still happens.
  if (!id) return;
  state.selectionId = id;
  state.knowledgeOpen = false;
  state.findingId = null;
  // A seat selection replaces the ensemble position: the hash names one, and the
  // scope that follows it is the seat's own.
  state.ensembleId = null;
  // A new selection clears the relation the record had asked the map to light.
  state.knowledgeFocusRelation = "";
  // Individual holdings follow the selected actor within the chosen tier.
  if (["actor", "worker"].includes(state.knowledgeScope.kind) && state.knowledgeScope.id !== id) {
    setKnowledgeScope({ kind: "actor", id: id });
  }
  // The project read follows the selection: an open project reloads for the new seat, and an
  // outstanding read for another one is superseded here rather than settling as that seat's.
  if (state.projectActor !== id && (state.project || state.projectPending)) void loadProject(id);
  // Every selection intent renders, even the same seat again: the map or the
  // record may have dismissed a card since, and that dismissal is not in the
  // shell's signature.
  markDrawnStale();
  // The seat is addressable, outside the tree as well: a reader can send the link.
  writeSeatAddress(id);
  renderTree();
  void loadActorKnowledge(id);
  void loadActorWork(id);
  // Keep focus at the selection source; the adjacent record updates in place.
}

// The document is the page. Every path that used to repaint a panel calls this
// entry instead, so one order and one selection serve the whole screen. The call
// is coalesced, so a snapshot, a frame and a selection in one turn repaint once.
function renderTree() {
  renderDocumentSoon();
}

// A committed player event repaints through the one coalesced entry, so the
// document, the staves and the record all follow the event.

// Complete recorded work for the selected actor, read on demand from the
// work route: the full task body, the exact current input, the open native
// request, and the latest report. Nothing is truncated; rows appear only
// for records the route returns.

async function loadActorWork(id) {
  const request = {};
  state.workRequest = request;
  state.work = null;
  state.workActorId = id || "";
  if (!knowledgeWired() || !id) {
    return;
  }
  let data;
  try {
    const res = await fetch(state.apiBase + "/orchestra/work?subject=" + encodeURIComponent(id));
    if (res.status === 403) {
      const body = await res.json().catch(() => ({}));
      // The route's own reason travels with the refusal, so the record names it.
      data = { refused: true, reason: body.error || "reader-scope-denied" };
    }
    else if (!res.ok) data = { error: "the endpoint answered " + res.status };
    else data = await res.json();
  } catch (e) {
    data = { error: e && e.message ? e.message : String(e) };
  }
  if (state.workRequest !== request || state.selectionId !== id) return;
  state.work = data;
  markDrawnStale();
  renderDocumentSoon();
}


const TRANSITION_LIMIT = 50;


// History stays available on demand: the rail opens with the newest batch
// and a control reads the rest. Row shape and order are unchanged.

/* --- knowledge (on demand, read-only) ------------------------------------- */

// Read finding and promotion summaries on demand; actor details include evidence
// and limits. The recorded hierarchy determines display order.

function knowledgeWired() {
  return !state.fixtureName && Boolean(state.apiBase);
}

// A fixture may carry a knowledge block so the band and the list render without
// the live endpoint. The records are synthetic and the screen is labeled as a
// fixture; the shapes match the overview and actor routes.
function fixtureActorKnowledge(id) {
  const source = state.fixtureKnowledge || {};
  const findings = source.findings || [];
  const promotions = source.promotions || [];
  const authored = findings.filter((f) => String(f.author || "") === id);
  const promoted = new Set(promotions.map((p) => p.finding).filter(Boolean));
  const received = promotions.filter((p) => String(p.destination || "") === id).map((p) => {
    const finding = findings.find((f) => f.id === p.finding) || {};
    return { id: p.id, finding: p.finding, author: p.author, source: p.source,
      destination: p.destination, promotedBy: p.promotedBy, claim: finding.claim,
      kind: finding.kind, evidenceMessage: finding.evidenceMessage,
      evidence: finding.evidence, limits: finding.limits };
  });
  const unshared = authored.filter((f) => !promoted.has(f.id)).length;
  // The actor route answers as the live one does: a worker scope, and the relations
  // a holder authored or that touch a held finding, with the far end kept as the
  // reference it is even when it lies outside the holdings.
  const held = new Set([...authored.map((f) => f.id), ...received.map((r) => r.finding)]);
  const touches = (end) => {
    const ref = String(end == null ? "" : end);
    const bare = ref.indexOf("finding:") === 0 ? ref.slice(8) : ref;
    return held.has(ref) || held.has(bare);
  };
  const relations = (source.relations || []).filter((r) => r.author === id
    || touches(r.source) || touches(r.target));
  return { contractVersion: CONTRACT_VERSION, actor: id, authored, received,
    scope: { kind: "worker", id, holders: [id] },
    relations,
    counts: { authored: authored.length, received: received.length, unshared },
    empty: authored.length === 0 && received.length === 0 && relations.length === 0 };
}

function scopeLabel(kind, id) {
  const holder = shortSeatId(id || "");
  if (kind === "all") return "All tiers";
  if (kind === "unstated") return "Held records";
  if (kind === "group") return "Ensemble: " + (holder || "choose a holder");
  if (kind === "worker" || kind === "actor") {
    return "Individual: " + (holder || "choose a holder");
  }
  return "Orchestra" + (holder ? ": " + holder : " holdings");
}

function knowledgeTier(kind) { return kind === "actor" ? "worker" : kind; }

function orchestraHolder() {
  const known = (state.fixtureKnowledge || state.knowledge || {}).actors || {};
  let id = state.subject || state.selectionId || "";
  const seen = new Set();
  while (id && !seen.has(id)) {
    seen.add(id);
    const actor = state.players.get(id) || known[id];
    if (!actor) break;
    if (!actor.parent && ["principal-conductor", "conductor"].includes(actor.role)) return id;
    id = actor.parent || "";
  }
  const roots = [...state.players.values()].filter(p => !p.parent
    && ["principal-conductor", "conductor"].includes(p.role));
  return roots.length === 1 ? roots[0].id : "";
}

function knowledgeHolders(kind) {
  if (kind === "group") return [...state.ensembles.values()].map(g => g.id).sort();
  if (kind === "all") return [];
  const known = (state.fixtureKnowledge || state.knowledge || {}).actors || {};
  const actors = new Map(Object.entries(known).map(([id, actor]) => [id, { ...actor, id }]));
  for (const actor of state.players.values()) actors.set(actor.id, actor);
  return [...actors.values()].filter(p => kind === "worker" || (!p.parent
    && ["principal-conductor", "conductor"].includes(p.role))).map(p => p.id).sort();
}

function chooseKnowledgeTier(kind) {
  let id = "";
  if (kind === "universal") id = orchestraHolder();
  if (kind === "worker") id = state.selectionId || state.subject || knowledgeHolders(kind)[0] || "";
  if (kind === "group") {
    const selected = state.players.get(state.selectionId);
    const group = [...state.ensembles.values()].find(g => g.owner === state.selectionId
      || (g.members || []).includes(selected ? selected.id : state.selectionId));
    id = state.ensembleId || (group && group.id) || knowledgeHolders(kind)[0] || "";
  }
  state.scientificSelected = "";
  state.findingId = null;
  setKnowledgeScope({ kind, id });
}

// Scope reads select authored or explicitly promoted holdings.
function knowledgeScopeQuery() {
  const scope = state.knowledgeScope || { kind: "universal", id: "" };
  if (scope.kind === "actor" || scope.kind === "worker") return scope.id ? "?actor=" + encodeURIComponent(scope.id) : "?scope=worker";
  if (scope.kind === "group") return scope.id ? "?group=" + encodeURIComponent(scope.id) : "?scope=group";
  if (scope.kind === "all") return "?scope=all";
  return scope.id ? "?scope=universal&subject=" + encodeURIComponent(scope.id) : "";
}

function setKnowledgeScope(scope) {
  state.knowledgeScopeExplicit = true;
  state.knowledgeScope = scope || { kind: "universal", id: "" };
  if (typeof history.replaceState === "function") {
    const address = new URL(location.href);
    address.searchParams.set("knowledge-tier", knowledgeTier(state.knowledgeScope.kind));
    if (state.knowledgeScope.id) address.searchParams.set("knowledge-holder", state.knowledgeScope.id);
    else address.searchParams.delete("knowledge-holder");
    const scientific = new URLSearchParams(address.hash.slice(1));
    if (scientific.has("science")) {
      if (state.scientificSelected) {
        scientific.set("scope", state.knowledgeScope.kind);
        scientific.set("holder", state.knowledgeScope.id || "");
        address.hash = scientific.toString();
      } else address.hash = "";
    }
    history.replaceState(null, "", address.pathname + address.search + address.hash);
  }
  renderMapScope();
  void loadKnowledgeOverview();
}

// Fixture holdings use the live predicates. Ensemble holdings require a group
// promotion. Authored relationships retain their outside references.
function fixtureScopedKnowledge(scope) {
  const source = state.fixtureKnowledge || null;
  if (!source) return null;
  const asking = scope || { kind: "universal", id: "" };
  const findings = source.findings || [];
  const allPromotions = source.promotions || [];
  const known = source.actors || {};
  const relations = source.relations || [];
  let holders = null;
  if (asking.kind === "all") holders = null;
  else if (asking.kind === "actor" || asking.kind === "worker") holders = asking.id ? [asking.id] : [];
  else if (asking.kind === "group") {
    const ensemble = state.ensembles.get(asking.id);
    holders = (ensemble && ensemble.owner) ? [ensemble.owner] : [];
  } else {
    holders = Object.keys(known).filter((id) => {
      const actor = known[id] || {};
      return !actor.parent && (actor.role === "principal-conductor" || actor.role === "conductor");
    });
    if (asking.id) holders = holders.filter((id) => id === asking.id);
  }
  const held = holders === null ? findings : findings.filter((f) => asking.kind === "group"
    ? allPromotions.some(p => p.finding === f.id && p.destinationKind === "group" && p.destination === asking.id)
    : holders.includes(f.author) || allPromotions.some(p => p.finding === f.id
      && (p.destinationKind || "session") === "session" && holders.includes(p.destination)));
  const present = new Set(held.map((f) => f.id));
  const promotions = allPromotions.filter((p) => present.has(p.finding));
  const touches = (end) => {
    const ref = String(end == null ? "" : end);
    const bare = ref.indexOf("finding:") === 0 ? ref.slice(8) : ref;
    return present.has(ref) || present.has(bare);
  };
  // Every recorded relation when the scope is everything, as the live query answers
  // it; otherwise the ones a holder authored or that touch a held finding, with the
  // other end kept as the reference it is.
  const heldRelations = holders === null ? relations
    : relations.filter((r) => (asking.kind !== "group" && holders.includes(r.author)) || touches(r.source) || touches(r.target));
  const relationIds = new Set(heldRelations.map(r => r.id));
  const heldEdges = holders === null ? (source.edges || []) : (source.edges || []).filter(edge =>
    relationIds.has(edge.id) || (edge.provenance === "recorded-evidence" && touches(edge.source)));
  const references = new Set(heldEdges.flatMap(edge => [edge.source, edge.target]));
  const heldNodes = holders === null ? (source.nodes || []) : (source.nodes || []).filter(node =>
    present.has(node.id) || (node.referenceOnly && references.has(node.reference)));
  const actors = {};
  const touch = (id) => {
    if (id === null || id === undefined || id === "") return null;
    if (!actors[id]) actors[id] = { authored: 0, received: 0, role: "", parent: "" };
    return actors[id];
  };
  for (const finding of held) {
    const actor = touch(finding.author);
    if (actor) actor.authored += 1;
  }
  for (const promotion of promotions) {
    const destination = touch(promotion.destination);
    if (destination) destination.received += 1;
    touch(promotion.source);
    touch(promotion.promotedBy);
  }
  for (const relation of heldRelations) touch(relation.author);
  // The tiers follow complete recorded parent chains, so each touched actor's
  // ancestors join the map with the roles the fixture records.
  const chain = (id) => {
    const seen = new Set([id]);
    let parent = (known[id] || {}).parent || "";
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      touch(parent);
      parent = (known[parent] || {}).parent || "";
    }
  };
  // Walk first, assign second: the chain adds ancestors to `actors` while it
  // runs, so assigning roles and parents over a snapshot taken before the walk
  // leaves every chain-added ancestor with the touch() defaults and the map's
  // depth tiers lose the chain past the first ancestor.
  for (const id of Object.keys(actors)) {
    chain(id);
  }
  for (const id of Object.keys(actors)) {
    const recorded = known[id] || {};
    actors[id].role = recorded.role || "";
    actors[id].parent = recorded.parent || "";
  }
  return Object.assign({}, source, {
    scope: { kind: asking.kind, id: asking.id || null, holders },
    findings: held,
    promotions,
    relations: heldRelations,
    nodes: heldNodes,
    edges: heldEdges,
    actors,
    empty: held.length === 0 && promotions.length === 0 && heldRelations.length === 0,
  });
}

// The keyboard spine: move the row cursor by one over the rows on screen and focus the
// row's own control, so Enter opens the record. False when there is nowhere to move.
function stepRow(delta) {
  if (!el.attentionBand) return false;
  const rows = [...el.attentionBand.querySelectorAll(".att-seat")];
  if (!rows.length) return false;
  const current = rows.findIndex((row) => row.contains(document.activeElement));
  const next = current < 0
    ? (delta > 0 ? 0 : rows.length - 1)
    : Math.min(rows.length - 1, Math.max(0, current + delta));
  if (next === current) return false;
  const control = rows[next];
  if (!control) return false;
  control.focus({ preventScroll: true });
  return true;
}

// Escape returns the record to its prompt and the page address to the plain view.
function clearSelection() {
  state.selectionId = null;
  state.knowledgeOpen = false;
  state.findingId = null;
  state.knowledgeFocusRelation = "";
  if (typeof history.replaceState === "function") {
    history.replaceState(null, "", location.pathname + location.search);
  }
  renderTree();
}

// ── the project surface ────────────────────────────────────────────────────
// Read and continue recorded project sessions on demand.

function projectName(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  return value.project || value.path || value.database || "";
}

// Read the stop from the recorded session metadata.
function projectStopped(session) {
  const stop = session && session.stop;
  return Boolean(stop && stop.status === "stopped");
}

async function loadProject(actor) {
  // Track each project read from request start to response handling.
  const request = {};
  state.projectRequest = request;
  state.projectPending = request;
  state.projectActor = actor || "";
  state.projectRead = actor ? "reading" : "none";
  state.projectNotice = actor ? "Reading the recorded project…" : "";
  state.projectError = null;
  state.project = null;
  state.resume = null;
  renderProject();
  if (!actor) {
    state.project = null;
    state.projectPending = null;
    state.projectNotice = "Select a seat to read its project.";
    markDrawnStale();
    renderProject();
    renderDocumentSoon();
    return;
  }
  if (state.fixtureName || !state.apiBase) {
    state.project = null;
    state.projectPending = null;
    state.projectNotice = "This page has no recorded workspace to read.";
    state.projectRead = "missing";
    markDrawnStale();
    renderProject();
    renderDocumentSoon();
    return;
  }
  try {
    const res = await fetch(state.apiBase + "/orchestra/project-sessions?actor=" + encodeURIComponent(actor));
    const body = await res.json().catch(() => ({}));
    if (state.projectRequest !== request) return;
    state.projectPending = null;
    if (res.status === 400 && body.error === "project-workspace-required") {
      state.project = null;
      state.projectNotice = actor + " has no recorded workspace. Select a conversation with a recorded project workspace.";
      state.projectError = { status: res.status, body };
      state.projectRead = "missing";
    } else if (!res.ok) {
      state.project = null;
      state.projectNotice = "The project could not be read (" + res.status + ").";
      state.projectError = { status: res.status, body };
      state.projectRead = "error";
    } else {
      state.project = {
        actor,
        name: projectName(body.project),
        identity: body.project,
        sessions: body.sessions || [],
        selected: body.selected || null,
      };
      state.projectNotice = "";
      state.projectRead = "ok";
    }
  } catch (e) {
    if (state.projectRequest !== request) return;
    state.projectPending = null;
    state.project = null;
    state.projectNotice = "The project could not be read.";
    state.projectError = { body: { cause: String(e && e.message ? e.message : e) } };
    state.projectRead = "error";
  }
  markDrawnStale();
  renderProject();
  renderDocumentSoon();
}

// Continuing the selected conversation. One request at a time, and its outcome belongs to the
// session that asked: a newer selection or request is never overwritten by a late answer.
async function resumeSession(session, liftStop) {
  if (!session || !state.apiBase || state.fixtureName) return;
  if (state.resume && state.resume.pending) return;
  const actor = state.projectActor;
  const operation = {};
  state.resume = { actor, session, operation, pending: true };
  markDrawnStale();
  renderProject();
  renderDocumentSoon();
  let outcome = { actor, session, operation, pending: false };
  try {
    const res = await fetch(state.apiBase + "/orchestra/resume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(liftStop ? { session, liftStop: true } : { session }),
    });
    const body = await res.json().catch(() => ({}));
    if (!state.resume || state.resume.operation !== operation) return;
    if (res.ok) {
      const delivery = body.delivery || null;
      outcome = Object.assign(outcome, {
        ok: true,
        answer: body,
        delivery,
        messageId: body.message ?? "",
        receipt: delivery ? delivery.receipt : null,
        latestReportId: body.latestReportId || "",
        latestReport: body.latestReport || "",
      });
    } else {
      const execution = body.execution || null;
      const words = [body.error, execution && execution.stderr, execution && execution.stdout]
        .filter(Boolean).join(" ");
      outcome = Object.assign(outcome, {
        ok: false,
        status: res.status,
        answer: body,
        // Retain stop metadata and the returned refusal.
        stopped: projectStopped(state.project && state.project.selected) || /terminally stopped/i.test(words),
        refused: {
          error: body.error || "the route answered " + res.status,
          status: res.status,
          code: execution && execution.code,
          stdout: execution && execution.stdout,
          stderr: execution && execution.stderr,
        },
      });
    }
  } catch (e) {
    if (!state.resume || state.resume.operation !== operation) return;
    // A request that never reached the coordinator keeps its own cause.
    outcome = Object.assign(outcome, {
      ok: false,
      refused: { error: "the request did not reach the coordinator: " + (e && e.message ? e.message : e) },
    });
  }
  state.resume = outcome;
  markDrawnStale();
  renderProject();
  renderDocumentSoon();
}

// Redraw when any displayed metadata or complete report changes.
function projectSignature() {
  return JSON.stringify([state.projectNotice, state.projectRead, state.projectError,
    state.project, state.resume]);
}

function projectValue(value) {
  return value === undefined || value === null || value === "" ? "unknown" : String(value);
}

function projectFacts(parent, entries, className = "") {
  const facts = document.createElement("dl");
  facts.className = "project-facts " + className;
  for (const [label, value] of entries) {
    const pair = document.createElement("div");
    const term = document.createElement("dt");
    const detail = document.createElement("dd");
    term.textContent = label;
    detail.textContent = projectValue(value);
    pair.append(term, detail);
    facts.appendChild(pair);
  }
  parent.appendChild(facts);
  return facts;
}

function projectReport(parent, label, id, body, key) {
  const detail = document.createElement("details");
  detail.className = "project-detail";
  detail.dataset.projectDetail = key;
  const summary = document.createElement("summary");
  summary.textContent = label;
  detail.appendChild(summary);
  projectFacts(detail, [["Report ID", id]]);
  const content = document.createElement("pre");
  content.className = "project-report";
  content.textContent = body === undefined || body === null || body === ""
    ? "No report body is recorded for this conversation." : String(body);
  detail.appendChild(content);
  parent.appendChild(detail);
}

function projectFailure(parent, failure) {
  const body = failure.body || {};
  const execution = body.execution || {};
  projectFacts(parent, [["HTTP status", failure.status], ["Error", body.error],
    ["Cause", body.cause], ["Exit code", execution.code], ["Signal", execution.signal]]);
  for (const [label, value] of [["stdout", execution.stdout], ["stderr", execution.stderr]]) {
    if (value === undefined || value === null || value === "") continue;
    const content = document.createElement("pre");
    content.className = "project-report";
    content.textContent = label + ":\n" + value;
    parent.appendChild(content);
  }
}

let projectDrawn = "";

function renderProject() {
  if (!el.projectBody) return;
  const signature = projectSignature();
  if (signature === projectDrawn) return;
  const active = document.activeElement;
  const key = active && active.dataset ? active.dataset.projectKey || "" : "";
  const listTop = el.projectBody.querySelector(".project-list")?.scrollTop || 0;
  const opened = new Set([...el.projectBody.querySelectorAll("details[open]")]
    .map(node => node.dataset.projectDetail));
  const minHeight = el.projectBody.style.minHeight;
  el.projectBody.style.minHeight = el.projectBody.getBoundingClientRect().height + "px";
  projectDrawn = signature;
  const project = state.project;
  if (el.projectState) {
    el.projectState.textContent = project
      ? project.sessions.length + (project.sessions.length === 1 ? " recorded conversation" : " recorded conversations")
      : (state.projectNotice || "Select a conversation to read its recorded project.");
  }
  el.projectBody.textContent = "";
  if (state.projectError) projectFailure(el.projectBody, state.projectError);
  if (project) {
    const identity = typeof project.identity === "object" && project.identity ? project.identity : {};
    const heading = document.createElement("h3");
    heading.textContent = "Recorded project identity";
    el.projectBody.appendChild(heading);
    projectFacts(el.projectBody, [["Project", identity.project], ["Canonical workspace", identity.canonical],
      ["Requested workspace", identity.input], ["Database", identity.database], ["Pointer", identity.pointer],
      ["Identity rule", identity.rule], ["Git result", identity.git?.ok], ["Git cause", identity.git?.cause]], "project-identity");
  }
  const chosenSession = project && project.selected ? project.selected : null;
  if (chosenSession) {
    const heading = document.createElement("h3");
    heading.className = "project-selected-title";
    heading.textContent = "Selected conversation: " + projectValue(chosenSession.id);
    el.projectBody.appendChild(heading);
    const row = document.createElement("div");
    row.className = "project-resume";
    const resume = state.resume && state.resume.session === chosenSession.id ? state.resume : null;
    const stopped = projectStopped(chosenSession) || Boolean(resume?.stopped);
    const continuing = Boolean(resume?.pending);
    const addAction = (label, liftStop, key) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "doc-scope-btn";
      button.dataset.projectKey = key;
      button.textContent = label;
      button.disabled = continuing || (stopped && !liftStop);
      button.title = liftStop ? "Explicitly lift the recorded stop and continue this conversation."
        : "Continue this conversation through its recorded receiver.";
      button.addEventListener("click", () => { void resumeSession(chosenSession.id, liftStop); });
      row.appendChild(button);
    };
    addAction("Continue", false, "continue");
    if (stopped) addAction("Lift stop and continue", true, "lift-stop");
    const knowledge = document.createElement("button");
    knowledge.type = "button";
    knowledge.className = "doc-scope-btn";
    knowledge.dataset.projectKey = "knowledge";
    knowledge.textContent = "Open shared knowledge";
    knowledge.addEventListener("click", () => {
      setKnowledgeScope({ kind: "actor", id: chosenSession.id });

    });
    row.appendChild(knowledge);
    const said = document.createElement("p");
    said.className = "project-outcome";
    said.setAttribute("role", "status");
    if (continuing) said.textContent = "Waiting for the coordinator response…";
    else if (resume?.ok === false) said.textContent = "Resume refused. The returned cause is recorded below.";
    else if (resume?.delivery) said.textContent = resume.receipt === null || resume.receipt === undefined
      ? "Delivery pending: no recipient receipt is recorded." : "Recipient receipt recorded.";
    else if (resume?.ok) said.textContent = projectValue(resume.answer?.cause);
    else if (stopped) said.textContent = "The recorded stop remains in effect.";
    else said.textContent = "Continue sends owed input through the recorded receiver.";
    row.appendChild(said);
    el.projectBody.appendChild(row);
    if (resume && !continuing) {
      const response = document.createElement("section");
      response.className = "project-response";
      const heading = document.createElement("h4");
      heading.textContent = "Resume response";
      response.appendChild(heading);
      if (resume.ok && resume.delivery) {
        projectFacts(response, [["Message ID", resume.messageId], ["Recipient", resume.delivery.recipient],
          ["Kind", resume.delivery.kind], ["Receipt", resume.receipt ?? "pending (no recipient receipt)"]]);
      } else if (resume.ok) {
        projectFacts(response, [["Result", resume.answer?.ok], ["Cause", resume.answer?.cause]]);
      } else {
        projectFailure(response, { status: resume.status,
          body: resume.answer || { error: resume.refused?.error } });
      }
      if (resume.ok && (resume.latestReportId || resume.latestReport)) {
        projectReport(response, "Retained report returned by resume", resume.latestReportId,
          resume.latestReport, "resume:" + chosenSession.id);
      }
      el.projectBody.appendChild(response);
    }
    projectReport(el.projectBody, "Retained report from the project read", chosenSession.latestReportId,
      chosenSession.latestReport, "selected:" + chosenSession.id);
  } else if (project) {
    const notice = document.createElement("p");
    notice.className = "project-outcome";
    notice.textContent = "No conversation is selected in this project. Select a recorded conversation below.";
    el.projectBody.appendChild(notice);
  }
  if (project && project.sessions.length) {
    const list = document.createElement("ul");
    list.className = "project-list";
    list.setAttribute("aria-label", "Recorded project conversations");
    project.sessions.forEach((session, index) => {
      const item = document.createElement("li");
      const open = document.createElement("button");
      const chosen = chosenSession && chosenSession.id === session.id;
      const stopped = projectStopped(session);
      item.className = "project-conversation" + (chosen ? " is-selected" : "") + (stopped ? " is-stopped" : "");
      open.type = "button";
      open.className = "project-session" + (chosen ? " is-selected" : "") + (stopped ? " is-stopped" : "");
      open.dataset.projectKey = "session:" + session.id;
      open.setAttribute("aria-pressed", chosen ? "true" : "false");
      const title = document.createElement("span");
      title.className = "project-session-id";
      title.textContent = projectValue(session.id);
      open.appendChild(title);
      if (session.id === project.actor) {
        const current = document.createElement("span");
        current.className = "project-current";
        current.textContent = "current";
        open.appendChild(current);
      }
      const entries = [["Role", session.role], ["Kind", session.kind], ["Parent", session.parent],
        ["Configured harness", session.harness], ["Configured model", session.model], ["Configured effort", session.effort]];
      if (["Harness", "Model", "Effort"].some(label => session["observed" + label]
        && session["observed" + label] !== session[label.toLowerCase()])) {
        entries.push(["Observed harness", session.observedHarness], ["Observed model", session.observedModel],
          ["Observed effort", session.observedEffort]);
      }
      entries.push(["Workspace", session.workspace], ["Branch", session.branch], ["Native conversation", session.native],
        ["Execution phase", session.execution?.phase], ["Execution status", session.execution?.status],
        ["Pending input", session.pendingCount], ["Unread input", session.unreadCount],
        ["Latest report ID", session.latestReportId]);
      if (session.stop) entries.push(["Stop status", session.stop.status], ["Stop reason", session.stop.reason],
        ["Stop outcome", session.stop.outcome], ["Stopped attempt", session.stop.attempt]);
      else entries.push(["Stop", "none recorded"]);
      open.addEventListener("click", () => {
        void loadProject(session.id);
        setKnowledgeScope({ kind: "actor", id: session.id });
      });
      open.addEventListener("keydown", event => {
        let next;
        if (event.key === "ArrowDown") next = Math.min(index + 1, project.sessions.length - 1);
        else if (event.key === "ArrowUp") next = Math.max(index - 1, 0);
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = project.sessions.length - 1;
        if (next === undefined) return;
        event.preventDefault();
        const button = list.children[next].querySelector("button");
        button.focus({ preventScroll: true });
      });
      item.appendChild(open);
      projectFacts(item, entries, "project-session-facts");
      list.appendChild(item);
    });
    el.projectBody.appendChild(list);
    list.scrollTop = listTop;
  }
  for (const detail of el.projectBody.querySelectorAll("details")) {
    if (opened.has(detail.dataset.projectDetail)) detail.open = true;
  }
  const back = key
    ? el.projectBody.querySelector('[data-project-key="' + CSS.escape(key) + '"]') : null;
  if (back && typeof back.focus === "function") back.focus({ preventScroll: true });
  el.projectBody.style.minHeight = minHeight;
}

// The plate's index states what each section holds, from the facts those sections draw - the
// page's own contents line, so a reader can see where to go without hunting.
function renderPlateIndex() {
  const running = [...state.players.values()]
    .filter((p) => deriveStatus(p) === "running").length;
  const findings = (state.knowledge && state.knowledge.findings) || [];
  const project = state.project;
  const set = (node, value) => { if (node) node.textContent = value; };
  set(el.platePit, running ? running + " running" : "nothing running");
  const scientific = state.knowledge && state.knowledge.scientific;
  const records = findings.length + (scientific ? scientific.nodes.length + scientific.edges.length : 0);
  set(el.plateMap, records ? records + (records === 1 ? " knowledge record" : " knowledge records") : "no knowledge records");
  set(el.plateStaves, state.players.size ? state.players.size + " seats" : "no seats");
  set(el.plateRecord, state.selectionId ? shortSeatId(state.selectionId) : "none selected");
  set(el.plateProject, project ? project.sessions.length + " conversations" : "");
}

async function loadKnowledgeOverview() {
  if (!state.knowledgeScopeExplicit && state.knowledgeScope.kind === "universal" && !state.knowledgeScope.id) {
    state.knowledgeScope.id = orchestraHolder();
  }
  const asked = knowledgeScopeQuery();
  if (state.fixtureName) {
    state.knowledge = fixtureScopedKnowledge(state.knowledgeScope);
    state.knowledgeNotice = state.knowledge ? "" : "A fixture carries no knowledge records.";
    renderMapScope();
    markDrawnStale();
    renderDocumentSoon();
    return;
  }
  if (!knowledgeWired()) {
    state.knowledge = null;
    state.knowledgeNotice = "No live endpoint is configured.";
    renderMapScope();
    markDrawnStale();
    renderDocumentSoon();
    return;
  }
  try {
    const res = await fetch(state.apiBase + "/orchestra/knowledge/overview" + asked);
    const answered = KnowledgeJSON.parse(await res.text());
    if (!res.ok) {
      const execution = answered && answered.execution;
      const cause = [answered && answered.error, answered && answered.cause,
        execution && execution.error && execution.error.message,
        execution && execution.stderr, execution && execution.stdout].filter(Boolean).join("\n");
      throw new Error("The endpoint answered " + res.status + (cause ? ":\n" + cause : ""));
    }
    // The reader may have moved scope while this was in flight; the newer read owns
    // the map.
    if (asked !== knowledgeScopeQuery()) return;
    state.knowledge = answered;
    state.knowledgeNotice = "";
  } catch (e) {
    if (asked !== knowledgeScopeQuery()) return;
    state.knowledge = null;
    state.knowledgeNotice = "Knowledge unavailable: " + (e && e.message ? e.message : e);
  }
  renderMapScope();
  markDrawnStale();
  renderDocumentSoon();
}

// Controls show the requested tier; the status names the holdings actually drawn.
function renderMapScope() {
  if (!el.mapScope) return;
  const asked = state.knowledgeScope || { kind: "universal", id: "" };
  const stated = (state.knowledge && state.knowledge.scope) || null;
  // Display the returned scope and its finding count.
  const kind = stated ? stated.kind : (state.knowledge ? "unstated" : asked.kind);
  const id = (stated && stated.id) || asked.id;
  const findings = (state.knowledge && state.knowledge.findings) || [];
  const scientific = (state.knowledge && state.knowledge.scientific) || {};
  const records = findings.length + (scientific.nodes || []).length + (scientific.edges || []).length;
  const what = scopeLabel(kind, id);
  const count = records + (records === 1 ? " record" : " records");
  el.mapScope.textContent = what + " · " + count;
  const tier = knowledgeTier(asked.kind);
  const map = document.getElementById("map");
  if (map) map.dataset.knowledgeTier = knowledgeTier(kind);
  for (const button of document.querySelectorAll("[data-knowledge-tier]")) {
    if (button.tagName !== "BUTTON") continue;
    button.setAttribute("aria-pressed", button.dataset.knowledgeTier === tier ? "true" : "false");
  }
  if (el.mapScopeAll) {
    const all = tier === "all";
    el.mapScopeAll.setAttribute("aria-pressed", all ? "true" : "false");
    el.mapScopeAll.textContent = "All tiers";
  }
  if (el.mapScopeHolder) {
    const ids = knowledgeHolders(tier);
    if (asked.id && !ids.includes(asked.id)) ids.push(asked.id);
    const options = ids.length ? (tier === "universal" && !asked.id ? ["", ...ids] : ids) : [""];
    const signature = JSON.stringify([tier, options]);
    if (el.mapScopeHolder.dataset.options !== signature) {
      el.mapScopeHolder.replaceChildren(...options.map(value => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value || (tier === "all" ? "Every holder"
          : tier === "universal" && ids.length ? "All orchestra holdings" : "No recorded holder");
        return option;
      }));
      el.mapScopeHolder.dataset.options = signature;
    }
    el.mapScopeHolder.value = asked.id || "";
    el.mapScopeHolder.disabled = tier === "all" || !ids.length;
  }
}

async function loadActorKnowledge(id) {
  const request = {};
  state.knowledgeActorRequest = request;
  state.knowledgeActor = null;
  state.knowledgeActorId = id || "";
  if (state.fixtureName) {
    if (state.fixtureKnowledge && id) state.knowledgeActor = fixtureActorKnowledge(id);
    return;
  }
  if (!knowledgeWired() || !id) {
    return;
  }
  let data;
  try {
    const res = await fetch(state.apiBase + "/orchestra/knowledge?actor=" + encodeURIComponent(id));
    if (res.status === 403) {
      const body = await res.json().catch(() => ({}));
      // The route's own reason travels with the refusal, so the record names it.
      data = { refused: true, reason: body.error || "reader-scope-denied" };
    }
    else if (!res.ok) data = { error: "the endpoint answered " + res.status };
    else data = KnowledgeJSON.parse(await res.text());
  } catch (e) {
    data = { error: e && e.message ? e.message : String(e) };
  }
  if (state.knowledgeActorRequest !== request || state.selectionId !== id) return;
  state.knowledgeActor = data;
  // The record reads this too: a landing paints through the drawn revision.
  markDrawnStale();
  renderDocumentSoon();
}

// The actor view carries the full record; an overview expansion lists what the
// overview endpoint actually returned (claim, author, sharing path) so a field the
// endpoint does not carry is never shown as recorded `unknown`.

// Evidence and limits cite supporting records as message: references. Each
// reference is a button that reads the complete stored message inline,
// so the supporting record is inspectable without leaving the graph.


// The complete supporting message body is read on demand through the public
// message route, so older references outside the snapshot resolve too.

// Showing the findings no recorded promotion carries. One place owns the state
// and its control's pressed state.
function setIncludeUnshared(on) {
  state.includeUnshared = Boolean(on);
  if (el.includeUnshared) {
    el.includeUnshared.setAttribute("aria-pressed", state.includeUnshared ? "true" : "false");
  }
}

// A graph re-render recreates its nodes and drops keyboard focus with the
// removed node. When focus was lost to the remount, restore it to the same
// finding node or actor anchor if still present and visible. Focus the user
// placed elsewhere is never moved.

// Select the finding author for actor details while keeping the graph visible
// and keyboard focus on its node.
function followGraphAuthor(id) {
  const actor = graphFindingAuthor(id);
  if (!actor || actor === state.selectionId) return;
  state.selectionId = actor;
  writeSeatAddress(actor);
  renderTree();
  void loadActorKnowledge(actor);
  void loadActorWork(actor);
}

// Select a finding while preserving the current page position.
function openRecordAt(id) {
  if (!id) return;
  state.findingId = id;
  writeFindingAddress(id);
  markDrawnStale();
  renderDocument();
}

function locateEntity(ref) {
  const id = String(ref || "");
  if (!id) return;
  if (state.players.has(id)) {
    select(id);
    return;
  }
  state.findingId = id;
  writeFindingAddress(id);
  markDrawnStale();
  renderDocument();
}

// Open the complete claim, evidence and limits beside the graph.
function toggleFinding(id) {
  if (!id) return;
  state.findingId = state.findingId === id ? null : id;
  writeFindingAddress(state.findingId);
  if (state.findingId) {
    // A finding selected from the seats opens its recorded content. A finding no
    // recorded promotion carries has no row until the unshared rows are shown,
    // and the detail pane holds the record only while the block is open.
    const promotions = (state.knowledge && state.knowledge.promotions) || [];
    if (!promotions.some((p) => (p.finding || p.id) === id)) setIncludeUnshared(true);
    state.knowledgeOpen = true;
    // Read the selected record through its author's knowledge endpoint.
    void loadGraphRecord(graphFindingAuthor(state.findingId), state.findingId);
    followGraphAuthor(state.findingId);
  }
}

// Read the finding author from actor knowledge, the overview or a promotion.
function graphFindingAuthor(id) {
  const data = state.knowledgeActor;
  if (data && state.knowledgeActorId === state.selectionId && state.selectionId) {
    for (const f of data.authored || []) if (f && f.id === id) return state.selectionId;
    for (const r of data.received || []) if (r && (r.finding || r.id) === id && r.author) return r.author;
  }
  const overview = state.knowledge || {};
  const record = (overview.findings || []).find((f) => f && f.id === id) || {};
  if (record.author) return record.author;
  const edge = (overview.promotions || []).find((p) => p && (p.finding || p.id) === id) || {};
  return edge.author || "";
}

// The selected inline record, read through the existing on-demand actor
// knowledge endpoint without touching the dossier slot. The request guard
// keeps a late earlier finding response from replacing the newly selected
// record. Only selected records read full bodies; overview frames stay
// excerpted.
async function loadGraphRecord(actor, findingId) {
  const request = {};
  state.graphRecordRequest = request;
  state.graphRecord = { actor: actor || "", data: null };
  const current = state.knowledgeActor;
  if (actor && current && state.knowledgeActorId === actor && !current.refused && !current.error) {
    state.graphRecord = { actor, data: current };
    return;
  }
  if (state.fixtureName) {
    if (state.fixtureKnowledge && actor) state.graphRecord = { actor, data: fixtureActorKnowledge(actor) };
    return;
  }
  if (!knowledgeWired() || !actor) {
    return;
  }
  let data;
  try {
    const res = await fetch(state.apiBase + "/orchestra/knowledge?actor=" + encodeURIComponent(actor));
    if (res.status === 403) data = { refused: true };
    else if (!res.ok) data = { error: "the endpoint answered " + res.status };
    else data = KnowledgeJSON.parse(await res.text());
  } catch (e) {
    data = { error: e && e.message ? e.message : String(e) };
  }
  if (state.graphRecordRequest !== request || state.findingId !== findingId) return;
  state.graphRecord = { actor, data };
}

// The complete recorded fields for the selected finding from its author
// read, shaped like the dossier expansion. Null until that read arrives.

// The selected record expansion: the complete recorded fields once the
// on-demand author read arrives; meanwhile only what the overview carries,
// plus the actual read state. Evidence and limits are never guessed.

// One row per finding: the claim once, its author, how many recorded
// promotions carry it, and every recorded sharing path. Promotion rows
// repeated the claim per edge; the group shows the finding and its
// relationships together.

// The knowledge band renders the read as seats: every actor that holds a recorded
// finding sits at its recorded distance from the podium, and each recorded
// promotion is a line between two seats. A page without the mount, or without the
// module, keeps the promotion list only.


// The seats read the same recorded state as the tree - each seat's liveness, its
// place in the hierarchy and the selected actor - so a tree refresh refreshes the
// seats with it. The promotion list is unchanged by that state and stays as it is.

// The knowledge graph draws the same overview behind the readout. A page
// without the graph mount, or without kgraph.js, keeps the readout only.


// The dossier block: authored, received and never-shared counts with the stored
// findings behind them. A refused actor keeps the reason visible.

// A seat's id shortened to the part that tells it apart in a dense list, with the full id
// on the title, the label and the record.
function shortSeatId(id) {
  const full = String(id || "");
  if (full.length <= 24) return full;
  const trimmed = full.replace(/[-_.]\d{4,}$/, "");
  const parts = trimmed.split(/[-_.]/).filter(Boolean);
  const last = parts[parts.length - 1] || "";
  // A trailing index (dsflash-1, muse-2) travels with the name it numbers; a plain
  // name stands alone.
  let text = last.length <= 2 && parts.length > 1 ? parts.slice(-2).join("-") : last;
  if (text.length < 4) text = trimmed.slice(-18);
  if (text.length > 18) text = text.slice(-18);
  return "\u2026" + text;
}

// ── the shell's two readings of the run ────────────────────────────────────
// The plate word: the run in one plain state word, from what the seats are doing.

// List stopped or failed actors; their record contains the cause.
const RAIL_CHIPS = 12;
let railSignature = "";

function railReason(p) {
  const held = notProgressing(p);
  if (held) return held;
  return { word: (deriveStatus(p) || "unknown"), detail: "the recorded state" };
}

function renderRail() {
  if (!el.rail) return;
  if (el.rail.contains(document.activeElement)) return;
  const holding = orderPlayers([...state.players.values()]).filter((p) => notProgressing(p) !== null);
  const signature = holding.map((p) => p.id + ":" + railReason(p).word).join("|");
  if (signature === railSignature) return;
  railSignature = signature;
  el.rail.textContent = "";
  if (!holding.length) {
    el.rail.hidden = true;
    return;
  }
  el.rail.hidden = false;
  const label = document.createElement("span");
  label.className = "rail-label";
  text(label, "Not progressing");
  el.rail.appendChild(label);
  const count = document.createElement("span");
  count.className = "rail-count";
  const figure = document.createElement("b");
  text(figure, String(holding.length));
  count.appendChild(figure);
  const countLabel = document.createElement("span");
  text(countLabel, holding.length === 1 ? " seat" : " seats");
  count.appendChild(countLabel);
  el.rail.appendChild(count);
  holding.slice(0, RAIL_CHIPS).forEach((p) => {
    const reason = railReason(p);
    const chip = document.createElement("button");
    chip.type = "button";
    chip.dataset.railId = p.id;
    // Color each chip by state and retain the full id in its accessible label.
    chip.className = "rail-chip rail-" + reason.word;
    chip.title = p.id + " · " + reason.word + ": " + reason.detail;
    chip.setAttribute("aria-label", p.id + ", " + reason.word + ", " + reason.detail);
    text(chip, shortSeatId(p.id) + " · " + reason.word);
    chip.addEventListener("click", () => select(p.id));
    el.rail.appendChild(chip);
  });
  if (holding.length > RAIL_CHIPS) {
    const more = document.createElement("span");
    more.className = "rail-more";
    text(more, "+" + (holding.length - RAIL_CHIPS) + " more");
    el.rail.appendChild(more);
  }
}

// Summarize current states, prioritizing running actors.
function plateWord() {
  let working = 0;
  let waiting = 0;
  let stopped = 0;
  let failed = 0;
  for (const p of state.players.values()) {
    const status = deriveStatus(p);
    // Work in flight is a running seat; a seat with queued input is counted by the
    // owe-work fact instead, so no seat is counted as two things.
    if (status === "running") working += 1;
    else if (status === "pending") waiting += 1;
    if (status === "stopped") stopped += 1;
    if (status === "failed") failed += 1;
  }
  if (working) return "running";
  if (stopped) return "stopped";
  if (failed) return "failed";
  if (waiting) return "queued";
  return "idle";
}

// The shell's own three reads in one place, so the state word, the counts and the
// rail never disagree with each other.
function renderShell() {
  if (el.plateMark) {
    el.plateMark.textContent = "";
    text(el.plateMark, plateWord());
  }
  renderHeaderLine();
  renderRail();
}

// Ages belong to the document now: the roster states them, so the timer repaints
// the document rather than rows of the retired tree.
function renderAges() {
  renderDocumentSoon();
}


/* --- snapshot and stream -------------------------------------------------- */

function applySnapshot(data, label) {
  if (!data || !Array.isArray(data.players)) {
    throw new Error("snapshot needs players[], got " + typeof data);
  }
  if (data.contractVersion !== CONTRACT_VERSION) {
    setNotice("Contract version " + data.contractVersion + " received, page requires " + CONTRACT_VERSION + ". Rendered state is shown as recorded.");
  }
  el.contractState.textContent = "";
  text(el.contractState, "want " + CONTRACT_VERSION + " / got " + data.contractVersion);
  state.players = new Map(data.players.map((p) => [p.id, p]));
  state.ensembles = new Map((data.ensembles || []).map((e) => [e.id, e]));
  state.transitions = Array.isArray(data.transitions) ? data.transitions.slice() : [];
  state.tasks = data.tasks || {};
  state.providers = data.providers || {};
  state.fixtureKnowledge = data.knowledge || null;
  state.snapshotLabel = label + (state.subject ? " subject " + state.subject : "");
  state.capturedAt = data.capturedAt || "";
  setCursor(data.cursor || "");
  if (data.selection && data.selection.gap === true) {
    holdGapNotice("Snapshot reports an event history gap. Shown state is authoritative as of the cursor.");
  }
  // A selection outside the snapshot is retained: the record reads the id as an
  // outside-tree subject and the reads answer their own refusal.
  // A seat address is honoured once, on the first snapshot, seat or not, so a
  // shared link opens the record it names.
  if (state.pendingSeat) {
    const addressed = state.pendingSeat;
    state.pendingSeat = "";
    state.selectionId = addressed;
  }
  // A relation address opens what its seam stands for, once, on the same first
  // snapshot: the finding end for a cited relation, the claiming seat otherwise.
  if (state.pendingRelation) {
    openRelationAt(state.pendingRelation);
    state.pendingRelation = null;
  }
  renderTree();
  // Knowledge reads are on demand: refresh them with every authoritative snapshot.
  void loadKnowledgeOverview();
  if (state.selectionId) void loadActorKnowledge(state.selectionId);
  // The selected work read refreshes with the snapshot the same way.
  if (state.selectionId) void loadActorWork(state.selectionId);
}

async function loadSnapshot() {
  const name = state.fixtureName;
  const url = name
    ? "fixtures/" + name + ".json"
    : state.apiBase + "/orchestra/snapshot" + queryString();
  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    throw new Error("snapshot request failed: " + (e && e.message ? e.message : e));
  }
  if (!res.ok) throw new Error("snapshot request returned " + res.status);
  const data = KnowledgeJSON.parse(await res.text());
  applySnapshot(data, name ? "DOM behavior fixture " + name + ", not live state" : "Live snapshot");
}

function connectEvents() {
  if (state.fixtureName) {
    setConn("off (fixture)");
    return;
  }
  if (state.sse) state.sse.close();
  state.opened = false;
  const url = state.apiBase + "/orchestra/events" + queryString();
  let es;
  try {
    es = new EventSource(url);
  } catch (e) {
    setConn("unavailable");
    setNotice("Event stream unavailable: " + (e && e.message ? e.message : e));
    return;
  }
  state.sse = es;
  setConn("connecting");

  es.addEventListener("hello", (ev) => {
    let msg = {};
    try { msg = JSON.parse(ev.data); } catch (e) { msg = {}; }
    if (msg.contractVersion !== CONTRACT_VERSION) {
      setNotice("Contract version " + msg.contractVersion + " on stream, page requires " + CONTRACT_VERSION + ".");
      return;
    }
    if (typeof msg.generation === "string" && msg.generation
        && state.generation && msg.generation !== state.generation) {
      if (state.sse) state.sse.close();
      state.sse = null;
      setConn("generation");
      setGeneration(msg.generation);
      setCursor("");
      holdGapNotice("Owner generation changed. Re-reading current state.");
      resnapshotThenResume();
      return;
    }
    if (typeof msg.generation === "string" && msg.generation) setGeneration(msg.generation);
    if (ev.lastEventId) setCursor(ev.lastEventId);
    else if (msg.cursor) setCursor(msg.cursor);
    state.opened = true;
    setConn("live");
    if (state.gapHeld && state.gapText === "Stream lost. Re-reading current state.") clearGapNotice();
    if (state.gapHeld) setNotice(state.gapText);
    else setNotice("");
  });

  es.addEventListener("gap", (ev) => {
    let g = {};
    try { g = JSON.parse(ev.data); } catch (e) { g = {}; }
    if (state.sse) state.sse.close();
    state.sse = null;
    setConn("gap");
    if (typeof g.generation === "string" && g.generation) setGeneration(g.generation);
    if (g.reason === "reader-scope-changed") {
      holdGapNotice("Reader scope changed. Re-reading current state.");
    } else if (g.reason === "ensemble-removed" || g.reason === "entity-removed") {
      holdGapNotice("A tracked entry was removed. Re-reading current state.");
    } else if (g.reason === "owner-generation-changed") {
      holdGapNotice("Owner generation changed. Re-reading current state.");
    } else if (g.reason === "owner-notification-lost" || g.reason === "event-read-failed") {
      holdGapNotice("Event read failed. Re-reading current state.");
    } else {
      holdGapNotice("Event history was pruned. Re-reading current state.");
    }
    resnapshotThenResume();
  });

  es.addEventListener("cursor", (ev) => {
    let next = "";
    try {
      const data = JSON.parse(ev.data);
      if (data && typeof data.cursor === "string") next = data.cursor;
    } catch (e) { /* empty data carries the cursor in the frame id */ }
    setCursor(next || ev.lastEventId);
  });

  es.addEventListener("player", (ev) => {
    let p = null;
    try { p = JSON.parse(ev.data); } catch (e) { return; }
    if (!p || !p.id) return;
    const known = state.players.has(p.id);
    state.players.set(p.id, p);
    // Player frames carry the concise task record; the selected read loads
    // the complete work. A frame without one deletes the stored record so
    // stale work metadata never persists. A frame for the selected actor
    // refreshes the selected read, guarded like every on-demand read.
    if (p.task) state.tasks[p.id] = p.task;
    else delete state.tasks[p.id];
    if (p.id === state.selectionId) void loadActorWork(p.id);
    if (ev.lastEventId) setCursor(ev.lastEventId);
    // A new actor or a reparent changes what the page holds; every other frame
    // repaints through the one coalesced entry as well, so the staves keep their
    // own order, focus and selection without a second patch path.
    renderTree();
    clearGapNotice();
  });

  es.addEventListener("ensemble", (ev) => {
    let e = null;
    try { e = JSON.parse(ev.data); } catch (err) { return; }
    if (!e || !e.id) return;
    state.ensembles.set(e.id, e);
    if (ev.lastEventId) setCursor(ev.lastEventId);
    renderTree();
    clearGapNotice();
  });

  es.addEventListener("transition", (ev) => {
    let t = null;
    try { t = JSON.parse(ev.data); } catch (e) { return; }
    if (!t) return;
    t.arrival = true;
    state.transitions.unshift(t);
    if (ev.lastEventId) setCursor(ev.lastEventId);
    const actor = state.players.get(t.session);
    if (actor) {
      // A transition on the selected actor can carry a new report, input,
      // or receipt, so the selected read refreshes with it.
      if (state.selectionId === actor.id) {
        void loadActorWork(actor.id);
      }
    }
    // A recorded knowledge change refreshes the open knowledge reads.
    if (t.entity === "knowledge" || t.entity === "promotion") {
      void loadKnowledgeOverview();
      if (state.selectionId) void loadActorKnowledge(state.selectionId);
    }
    clearGapNotice();
    renderDocumentSoon();
  });

  es.addEventListener("pending", (ev) => {
    let m = null;
    try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (!m || !m.session) return;
    const p = state.players.get(m.session);
    if (p) {
      if (typeof m.pendingCount === "number") p.pendingCount = m.pendingCount;
      if (typeof m.unreadCount === "number") p.unreadCount = m.unreadCount;
      if (typeof m.lastTurnId === "string") p.lastTurnId = m.lastTurnId;
      if (typeof m.latestReportId === "string") p.latestReportId = m.latestReportId;
      renderTree();
    }
    if (ev.lastEventId) setCursor(ev.lastEventId);
  });

  es.onerror = () => {
    if (state.sse) state.sse.close();
    state.sse = null;
    if (!state.opened) {
      setConn("retrying");
      scheduleEventsRetry();
      return;
    }
    setConn("reconnecting");
    holdGapNotice("Stream lost. Re-reading current state.");
    resnapshotThenResume();
  };
}

async function resnapshotThenResume() {
  try {
    await loadSnapshot();
  } catch (e) {
    scheduleEndpointRetry(e);
    return;
  }
  connectEvents();
}

function scheduleEndpointRetry(cause) {
  const wait = 1000;
  setConn("retrying");
  setNotice("Snapshot endpoint unreachable (" + (cause && cause.message ? cause.message : cause) + "). Retrying in " + Math.round(wait / 1000) + "s.");
  setTimeout(resnapshotThenResume, wait);
}

function scheduleEventsRetry() {
  const wait = 1000;
  setConn("retrying");
  setNotice("Event stream unavailable before first hello. Retrying events in " + Math.round(wait / 1000) + "s.");
  setTimeout(async () => {
    if (state.opened) return;
    // Response headers identify an available stream. A 503 carries its JSON
    // refusal. The probe body is cancelled before connectEvents opens the stream.
    try {
      const probe = await fetch(state.apiBase + "/orchestra/events" + queryString());
      if (probe.status === 503) {
        const body = await probe.json().catch(() => ({}));
        if (body && body.error === "native-owner-subscription-unavailable") {
          setConn("unavailable");
          setNotice("Live stream unavailable: the shared owner subscription is not installed yet (#676). The client continues checking for the owner subscription.");
          scheduleEventsRetry();
          return;
        }
      }
      if (probe.body) await probe.body.cancel().catch(() => {});
    } catch (e) { /* A failed request resumes the event connection. */ }
    connectEvents();
  }, wait);
}

function selectEnsemble(id) {
  const group = String(id || "");
  if (!group) return;
  state.ensembleId = group;
  writeEnsembleAddress(group);
  if (state.knowledgeScope.kind === "group") setKnowledgeScope({ kind: "group", id: group });
  markDrawnStale();
}

/* --- controls ------------------------------------------------------------- */

function init() {
  const query = new URLSearchParams(location.search);
  state.apiBase = query.get("api") || "";
  const meta = document.querySelector('meta[name="orchestra-api-base"]');
  if (!state.apiBase && meta) state.apiBase = meta.getAttribute("content") || "";
  // Use the serving origin when no API address is configured.
  if (!state.apiBase && /^https?:$/.test(location.protocol || "")) {
    state.apiBase = location.origin;
  }
  state.fixtureName = query.get("fixture") || "";
  state.subject = query.get("subject") || "";

  // A seat address (#seat=<id>) selects that seat once the snapshot lands, and a finding
  // address (#finding=<id>) opens that claim's record, so a link a reader sends opens the
  // same record.
  const seatAddress = String(location.hash || "").match(/^#seat=(.+)$/);
  if (seatAddress) state.pendingSeat = decodeURIComponent(seatAddress[1]);
  const findingAddress = String(location.hash || "").match(/^#finding=(.+)$/);
  if (findingAddress) state.findingId = decodeURIComponent(findingAddress[1]);
  const scientificAddress = new URLSearchParams(String(location.hash || "").slice(1));
  if (scientificAddress.has("science")) {
    state.scientificSelected = scientificAddress.get("science") || "";
    state.knowledgeScope = { kind: scientificAddress.get("scope") || "universal",
      id: scientificAddress.get("holder") || "" };
  }
  const relationAddress = String(location.hash || "").match(/^#relation=([^:]*):([^:]*):(.*)$/);
  if (relationAddress) {
    state.pendingRelation = {
      provenance: decodeURIComponent(relationAddress[1]),
      source: decodeURIComponent(relationAddress[2]),
      target: decodeURIComponent(relationAddress[3]),
    };
  }
  // An ensemble link restores the group's position and the scope that follows it. The
  // scope is set here rather than through setKnowledgeScope so the boot's own reads
  // carry it, instead of fetching universal first and the group behind it.
  const ensembleAddress = String(location.hash || "").match(/^#ensemble=(.+)$/);
  if (ensembleAddress) {
    state.ensembleId = decodeURIComponent(ensembleAddress[1]);
    state.knowledgeScope = { kind: "group", id: state.ensembleId };
  }
  const addressedTier = query.get("knowledge-tier");
  if (["universal", "worker", "group", "all"].includes(addressedTier)) {
    state.knowledgeScopeExplicit = true;
    state.knowledgeScope = { kind: addressedTier, id: query.get("knowledge-holder") || "" };
  }

  // The plate's section links move the reader without taking the record's address
  // with them: the seat or finding address stays in the bar, so a reload restores
  // the record a reader was reading.
  for (const link of document.querySelectorAll(".plate-nav a")) {
    link.addEventListener("click", (ev) => {
      const id = String(link.getAttribute("href") || "").replace(/^#/, "");
      const target = id ? document.getElementById(id) : null;
      if (!target) return;
      ev.preventDefault();
      if (typeof target.scrollIntoView === "function") target.scrollIntoView({ block: "start" });
      if (typeof target.focus === "function") target.focus({ preventScroll: true });
    });
  }

  // Query changes filter actors while retaining typing focus.
  if (el.find) {
    el.find.addEventListener("input", () => {
      const query = el.find.value.trim();
      if (query === state.docQuery) return;
      state.docQuery = query;
      renderDocument();
    });
  }
  if (el.projectLoad) {
    // Installed once: the surface reads on demand for whatever is selected.
    el.projectLoad.addEventListener("click", () => { void loadProject(state.selectionId); });
  }
  if (el.showEnded) {
    el.showEnded.addEventListener("click", () => {
      // Switch between current work and all recorded actors.
      state.scope = state.scope === "all" ? "live" : "all";
      el.showEnded.setAttribute("aria-pressed", state.scope === "all" ? "true" : "false");
      renderDocument();
    });
  }
  if (el.mapScopeAll) {
    el.mapScopeAll.addEventListener("click", () => {
      const all = (state.knowledgeScope || {}).kind === "all";
      chooseKnowledgeTier(all ? "universal" : "all");
    });
  }
  for (const button of document.querySelectorAll("button[data-knowledge-tier]")) {
    button.addEventListener("click", () => chooseKnowledgeTier(button.dataset.knowledgeTier));
  }
  if (el.mapScopeHolder) el.mapScopeHolder.addEventListener("change", () => {
    setKnowledgeScope({ kind: knowledgeTier(state.knowledgeScope.kind), id: el.mapScopeHolder.value });
  });
  // The keyboard spine: one cursor walks the rows the reader can see, from anywhere in
  // the page. Typing fields and the pit and axis own their own keys, so both are left alone.
  document.addEventListener("keydown", (ev) => {
    if (ev.defaultPrevented || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const target = ev.target;
    if (target && target.closest
      && target.closest("input, textarea, select, [contenteditable], #ribbon, #attention-band")) return;
    // The stage owns arrow keys; j and k focus its actors from the page.
    if (ev.key === "j") { if (stepRow(1)) ev.preventDefault(); }
    else if (ev.key === "k") { if (stepRow(-1)) ev.preventDefault(); }
    else if (ev.key === "/") { if (el.find) { ev.preventDefault(); el.find.focus({ preventScroll: true }); } }
    else if (ev.key === "Escape" && state.selectionId) { clearSelection(); ev.preventDefault(); }
  });
  // The whole-orchestra canvas draws on demand: opening its disclosure repaints,
  // and the composition draws the canvas only while that disclosure is open, so
  // it is never the default surface and holds no region while it is closed.
  const whole = el.knowledgeWhole ? el.knowledgeWhole.parentElement : null;
  if (whole && whole.tagName === "DETAILS") {
    whole.addEventListener("toggle", () => renderDocument());
  }
  document.getElementById("reconnect").addEventListener("click", async () => {
    try {
      await loadSnapshot();
      setNotice("");
    } catch (e) {
      scheduleEndpointRetry(e);
      return;
    }
    connectEvents();
  });

  document.addEventListener("keydown", (ev) => {
    if (ev.defaultPrevented || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const active = document.activeElement;
    const inField = active && (active.isContentEditable
      || ["INPUT", "SELECT", "TEXTAREA"].includes(active.tagName));
    if (ev.key === "/" && !inField && el.find) {
      ev.preventDefault();
      el.find.focus({ preventScroll: true });
    }
  });

  // A pointer gesture owns the DOM until it ends: repaints are held so a drag,
  // a hover or an in-flight animation is never destroyed mid-gesture, and the
  // held repaint runs on release.
  document.addEventListener("pointerdown", () => { pointerActive = true; }, true);
  document.addEventListener("pointerup", () => {
    pointerActive = false;
    flushDeferredRepaint();
  }, true);
  document.addEventListener("pointercancel", () => {
    pointerActive = false;
    flushDeferredRepaint();
  }, true);

  setInterval(renderAges, AGE_REFRESH_MS);

  if (state.fixtureName) {
    el.fixtureNotice.hidden = false;
    el.fixtureNotice.textContent = "";
    text(el.fixtureNotice, "DOM behavior fixture " + state.fixtureName + ", not live state. Live updates are off.");
    loadSnapshot().catch((e) => {
      state.snapshotLabel = "Fixture failed to load: " + (e && e.message ? e.message : e);
      renderHeaderLine();
    });
    setConn("off (fixture)");
    return;
  }

  if (!state.apiBase) {
    state.snapshotLabel = "No live endpoint configured. Open with ?api=<base> or ?fixture=fixture-small for DOM review.";
    renderHeaderLine();
    setConn("idle");
    return;
  }

  loadSnapshot().then(connectEvents).catch((e) => {
    state.snapshotLabel = "Snapshot failed to load: " + (e && e.message ? e.message : e);
    renderHeaderLine();
    // A failed initial snapshot uses the existing endpoint retry path.
    scheduleEndpointRetry(e);
  });
}

/* --- the document --------------------------------------------------------- */

// Snapshot state becomes the shapes the document and its modules read. Nothing
// is invented: every field is recorded, or derived from recorded state by the
// same helpers the retired panels used.
function documentPlayers() {
  const out = [];
  for (const p of state.players.values()) {
    const action = actionFor(p) || {};
    const status = deriveStatus(p);
    const ensembles = [];
    for (const id of (p.ownedEnsembles || []).concat(p.memberEnsembles || [])) {
      if (id && ensembles.indexOf(id) === -1) ensembles.push(id);
    }
    out.push({
      id: p.id,
      parent: p.parent || "",
      role: p.role || "",
      model: p.observedModel || p.model || "",
      status,
      taskCompletion: p.taskCompletion || null,
      pendingCount: p.pendingCount || 0,
      // Reports this seat was sent and never read. The snapshot records
      // the count, and it is a different kind of waiting from a queued input.
      unreadCount: p.unreadCount || 0,
      // The stored sample carries the kinds, so the report mark reads its own
      // count. This is not unreadCount minus pendingCount: a stopped
      // actor's queued inputs leave pendingCount while its reports stay
      // unread, so the difference reads as reports that are not there.
      reportCount: pendingItems(p).filter((m) => m && m.kind === "report").length,
      // Everything the seat owes, whatever the kind, for ordering and the rail.
      owedTotal: Math.max(p.pendingCount || 0, p.unreadCount || 0),
      // Two reads with two names: the work the actor owes its own inbox, and
      // whether the current attempt is stopped or failed.
      owesWork: owesWork(p),
      notProgressing: notProgressing(p) !== null,
      action: action.label || "",
      actionAt: action.at || "",
      stale: action.stale === true,
      taskTitle: (state.tasks[p.id] && state.tasks[p.id].title) || "",
      ensembles,
      live: ["running", "pending"].indexOf(status) !== -1,
    });
  }
  return out;
}

function documentData() {
  const ensembles = [];
  for (const e of state.ensembles.values()) {
    ensembles.push({
      id: e.id, owner: e.owner || "",
      coupling: e.coupling || "", members: e.members || [],
      sections: e.sections || [],
    });
  }
  return {
    players: documentPlayers(),
    ensembles,
    events: state.transitions || [],
    knowledge: state.knowledge || null,
    // Complete stored bodies already read, keyed by message id, with their read
    // state; the selection renderer draws a body it holds and asks for one it
    // does not.
    messages: state.messages,
  };
}

// The complete stored body of one recorded message, read on demand through the
// read-only message route. The read state is explicit, so the reader can say what
// it is doing rather than guess a body, and a body once read stays available.
async function loadMessageBody(id) {
  const key = String(id || "");
  if (!key) return;
  const held = state.messages[key];
  if (held && held.state === "ok") return;
  if (held && held.state === "reading") return;
  if (!knowledgeWired()) {
    state.messages[key] = { state: "unwired", message: null };
    renderDocument();
    return;
  }
  state.messages[key] = { state: "reading", message: null };
  renderDocument();
  try {
    const res = await fetch(state.apiBase + "/orchestra/message?id=" + encodeURIComponent(key));
    const data = await res.json();
    if (!res.ok) {
      state.messages[key] = {
        state: res.status === 403 ? "refused" : res.status === 400 ? "unreadable" : "error",
        message: null,
        status: res.status,
        reason: [data.error, data.cause].filter(Boolean).join(": "),
      };
    } else {
      state.messages[key] = (data && data.message)
        ? { state: "ok", message: data.message }
        : { state: "missing", message: null };
    }
  } catch (e) {
    state.messages[key] = {
      state: "error",
      message: null,
      reason: (e && e.message) || String(e),
    };
  }
  markDrawnStale();
  renderDocument();
}

// The selected id the snapshot does not carry, with the reads that answer for it.
// The record renders this as an outside-tree subject: it names the id and each read's
// own refusal instead of showing the empty prompt.
function selectedSubject() {
  const id = state.selectionId;
  if (!id || state.players.has(id)) return null;
  return {
    id,
    knowledge: state.knowledgeActorId === id ? state.knowledgeActor : null,
    work: state.workActorId === id ? state.work : null,
  };
}

function selectedSeat() {
  if (!state.selectionId) return null;
  const p = state.players.get(state.selectionId);
  if (!p) return null;
  const action = actionFor(p) || {};
  return {
    id: p.id,
    role: p.role || "",
    model: p.observedModel || p.model || "",
    parent: p.parent || "",
    status: deriveStatus(p),
    // What the actor owes its own inbox, and whether the record holds the seat.
    // The selection header paints its tone dot from notProgressing: an explicit
    // stop or a failed attempt, never a queued message, and never a request.
    owesWork: owesWork(p),
    notProgressing: notProgressing(p) !== null,
    // The recorded terminal of the current attempt, when the server read has it:
    // null, or the provider failure the attempt ended on. The record states the
    // cause and the stop reason in one line.
    failure: (p.execution && p.execution.failure) || null,
    // The project surface's reads, when this seat is the conversation it has open: its
    // retained report as the project route returned it, and the outcome of continuing it.
    retained: state.project && state.project.selected && state.project.selected.id === p.id
      ? {
        session: p.id,
        reportId: state.project.selected.latestReportId || "",
        report: state.project.selected.latestReport || null,
      }
      : null,
    // The project read's own outcome for this seat, so the record names a read
    // that did not answer instead of leaving the Retained block out.
    retainedRead: state.projectActor === p.id && state.projectRead
      && state.projectRead !== "ok"
      ? { state: state.projectRead, reason: state.projectNotice || "" }
      : null,
    resume: state.resume && state.resume.actor === p.id ? state.resume : null,
    pendingCount: p.pendingCount || 0,
    unreadCount: p.unreadCount || 0,
    // The report count the record states for this seat, read from the sample.
    reportCount: pendingItems(p).filter((m) => m && m.kind === "report").length,
    owedTotal: Math.max(p.pendingCount || 0, p.unreadCount || 0),
    action: action.label || "",
    taskTitle: (state.tasks[p.id] && state.tasks[p.id].title) || "",
    // The recorded work read for this seat, when the on-demand read has landed
    // for it: the task body, the current input, the open request and the report.
    work: state.workActorId === p.id ? state.work : null,
    // The recorded ids of the messages this seat has not read. A count
    // alone says nothing about what they ask, so the ids travel with the seat and
    // the reader can open the complete stored body of any of them.
    pending: pendingItems(p).map((m) => ({
      id: String((m && m.id) || ""),
      kind: (m && m.kind) || "",
      at: (m && m.at) || "",
      seq: (m && m.seq) || 0,
    })).filter((m) => m.id),
    // The bodies already read for those ids, in the shape the record renderer
    // draws; an id whose body has not been read keeps its identity stub.
    pendingMessages: pendingItems(p)
      .map((m) => state.messages[String((m && m.id) || "")])
      .filter((held) => held && held.state === "ok" && held.message)
      .map((held) => ({
        id: String(held.message.id || ""),
        sender: held.message.sender || "",
        recipient: held.message.recipient || "",
        kind: held.message.kind || "",
        body: held.message.body == null ? "" : held.message.body,
      })),
    // The seat's authored findings from the recorded knowledge overview, so
    // the record reaches every claim the seat holds without the map. The
    // record draws {id, claim} rows and renders nothing when none are held.
    authored: ((state.knowledge && Array.isArray(state.knowledge.findings))
      ? state.knowledge.findings : [])
      .filter((f) => f && String(f.author || "") === p.id)
      .map((f) => ({ id: String(f.id), claim: f.claim == null ? "" : String(f.claim) })),
  };
}

function selectHistoryEvent(index) {
  const event = state.transitions[index];
  state.ribbonSeq = index > 0 && event ? String(event.seq) : null;
  // The reading position changes what the document draws; the revision carries
  // it so the repaint is not suppressed as unchanged.
  markDrawnStale();
  renderDocument();
}

function historyPosition() {
  if (state.ribbonSeq === null) return 0;
  const index = state.transitions.findIndex((event) => String(event.seq) === state.ribbonSeq);
  return index < 0 ? 0 : index;
}

// What the document draws, as one string, so a repaint that would draw the same
// thing is skipped and any repaint is held while the pointer is down. Replacing
// the DOM under the pointer is what cancels hover rings, drags and every one-shot
// animation, so a still DOM is the prerequisite for motion doing real work.
let drawnSignature = "";
let deferredSignature = "";
let pointerActive = false;

function drawnNow(data) {
  const rows = [];
  for (const p of data.players) {
    rows.push([
      p.id, p.status, p.pendingCount, p.unreadCount,
      p.owesWork ? 1 : 0, p.notProgressing ? 1 : 0, p.action, p.actionAt,
      p.taskCompletion && p.taskCompletion.open === true ? 1 : 0,
      (p.ensembles || []).join(","),
    ].join("~"));
  }
  const events = data.events || [];
  const knowledge = data.knowledge || null;
  return [
    rows.join("|"),
    (data.ensembles || []).length,
    // The list changes at either end: the stream appends, and older history
    // loads in front of what is held. Length plus both ends covers both, and a
    // reply that replaces a held entry moves the newest end.
    events.length + ":" + (events[0] ? events[0].seq : "") + ":"
      + (events[events.length - 1] ? events[events.length - 1].seq : ""),
    knowledge
      ? (knowledge.findings || []).length + ":" + (knowledge.promotions || []).length
      : "none",
    state.selectionId || "",
    state.findingId || "",
    state.scientificSelected || "",
    state.docQuery || "",
    state.scope === "all" ? 1 : 0,
    state.ribbonSeq || "",
    // Every fetched read marks the drawn document stale through this revision,
    // so a landing paints without the signature enumerating each future input.
    state.renderSeq || 0,
    state.workActorId || "",
    state.work
      ? (state.work.refused ? "refused" : state.work.error ? "error" : "read")
      : "none",
    // Each body's read state, not just how many are held: a body that finishes
    // reading must repaint, and the count alone would not change.
    Object.keys(state.messages || {})
      .map((key) => key + ":" + ((state.messages[key] || {}).state || ""))
      .join(","),
  ].join("#");
}

// A fetched read or an interaction that changes what the document draws bumps
// the revision; the caller then runs its own repaint, so a gesture in progress
// keeps its continuity.
function markDrawnStale() {
  state.renderSeq = (state.renderSeq || 0) + 1;
}

// A held repaint runs once the gesture ends, so a drag finishes against the DOM
// it started on and the pending change lands immediately after.
function flushDeferredRepaint() {
  if (!deferredSignature) return;
  deferredSignature = "";
  renderDocument();
}

function renderDocument() {
  if (!window.OversightDocument) return;
  const drawn = drawnNow(documentData());
  if (drawn === drawnSignature) return;
  if (pointerActive) {
    deferredSignature = drawn;
    return;
  }
  drawnSignature = drawn;
  renderMapScope();
  renderProject();
  renderPlateIndex();
  const active = document.activeElement;
  let knowledgeFocus = null;
  if (active && active.closest) {
    for (const name of ["data-kw-id", "data-kw-node"]) {
      if (active.hasAttribute(name)) {
        knowledgeFocus = '[' + name + '="' + CSS.escape(active.getAttribute(name)) + '"]';
      }
    }
    if (active.hasAttribute("data-science-focus")) {
      knowledgeFocus = '[data-science-focus="' + CSS.escape(active.getAttribute("data-science-focus")) + '"]';
    }
    if (active.hasAttribute("data-kw-focus")) {
      knowledgeFocus = '[data-kw-focus="' + CSS.escape(active.getAttribute("data-kw-focus")) + '"]';
    }
  }
  const findings = (state.knowledge && state.knowledge.findings) || [];
  const promotions = (state.knowledge && state.knowledge.promotions) || [];
  let selectedFinding = null;
  if (state.findingId) {
    const record = findings.find((f) => f && f.id === state.findingId) || null;
    if (record) {
      // The recorded sharing steps travel with the record so the selected-record
      // module can list each one; nothing is inferred when none is recorded.
      selectedFinding = {
        id: record.id,
        author: record.author,
        claim: record.claim,
        evidence: record.evidence,
        limits: record.limits,
        // The record's own typed semantics travel with it when the route serves
        // them: the authored kind, the retained message that evidences it, and the
        // named relations it stands in. An absent field stays absent, and no
        // relation is inferred from parentage, proximity or promotion.
        kind: record.kind || "",
        evidenceMessage: record.evidenceMessage || "",
        relations: relationsFor(record.id),
        promotions: promotions.filter((p) => p && (p.finding || p.id) === record.id),
      };
    }
  }
  const result = window.OversightDocument.render({
    attention: el.attentionBand,
    legend: document.getElementById("orchestra-legend"),
    selection: el.selection,
    ribbon: el.ribbon,
    knowledgeWhole: el.knowledgeWhole,
    counts: el.counts,
    // The scope control includes recorded history on request.
    scopeControl: el.showEnded,
  }, documentData(), {
    selectedId: state.selectionId,
    selectedFindingId: state.findingId || "",
    selectedSeat: selectedSeat(),
    // The selected id when the snapshot does not carry it: the record renders it as an
    // outside-tree subject with the reads that answer for it.
    selectedSubject: selectedSubject(),
    // The record's way back: clearing the selection returns the page to its prompt.
    onClearSelection: () => { clearSelection(); },
    // The open conversation, so the axis can name the window it draws.
    projectConversation: state.project && state.project.selected ? state.project.selected.id : "",
    selectedFinding,
    query: state.docQuery || "",
    position: historyPosition(),
    scope: state.scope === "all" ? "all" : "live",
    knowledgeWholeOpen: state.knowledgeWholeOpen === true,
    knowledgeQuery: state.knowledgeSearch || "",
    knowledgeNotice: state.knowledgeNotice || "",
    // A click on an actor the snapshot does not carry - an earlier Principal, a prior session -
    // selects it as an outside-tree subject and reads its project, and the record names it as
    // outside this tree rather than returning silently.
    onSelect: (id) => {
      if (state.players.has(id)) { select(id); return; }
      select(id);
      void loadProject(id);
    },
    onSelectEnsemble: selectEnsemble,
    // A selection intent always renders, even when the same finding is activated
    // again: the map may have dismissed its card since, and its own state changed
    // without the shell's signature moving.
    onSelectFinding: (id) => {
      state.findingId = id;
      writeFindingAddress(id);
      markDrawnStale();
      renderDocument();
    },
    // The map's pinned card opens the record at its finding, on that finding's block.
    onOpenRecord: (id) => { openRecordAt(id); },
    // A stage seam opens its relation: the record scopes to what the seam stands
    // for, and the address names the relation's own identity.
    onSelectRelation: (rel) => { openRelationAt(rel); },
    // The way back from a record: the mark that holds it, on whichever surface it lives.
    onLocate: (ref) => { locateEntity(ref); },
    // The record's relation statements light that relation's edges on the map; the
    // map receives the name it should light and clears it with the next selection.
    onFocusRelation: (name) => {
      state.knowledgeFocusRelation = String(name || "");
      // Every activation is a fresh request: activating the same relation again
      // after a dismissal opens its card again.
      state.knowledgeFocusSeq = (state.knowledgeFocusSeq || 0) + 1;
      markDrawnStale();
      renderDocument();
    },
    focusRelation: state.knowledgeFocusRelation || "",
    focusRelationSeq: state.knowledgeFocusSeq || 0,
    // The ensemble the reader has selected, so the roster marks the band they are on.
    selectedEnsemble: state.ensembleId || "",
    scientificSelected: state.scientificSelected,
    onSelectScientific: (key) => {
      state.scientificSelected = key;
      state.findingId = "";
      const scope = state.knowledgeScope || { kind: "universal", id: "" };
      const address = new URLSearchParams({ science: key, scope: scope.kind, holder: scope.id || "" });
      if (typeof history.replaceState === "function") history.replaceState(null, "", "#" + address);
    },
    onOpenScientificReference: (reference) => {
      state.scientificSelected = (reference.kind === "edge" ? "edge:" : "node:") + reference.id;
      setKnowledgeScope({ kind: "all", id: "" });
      const address = new URLSearchParams({ science: state.scientificSelected, scope: "all", holder: "" });
      if (typeof history.replaceState === "function") history.replaceState(null, "", "#" + address);
    },
    onReadMessage: (id) => { void loadMessageBody(id); },
    onScrub: selectHistoryEvent,
    onSelectEvent: selectHistoryEvent,
    onListOpen: () => {},
  });
  if (knowledgeFocus) {
    const next = el.knowledgeWhole.querySelector(knowledgeFocus);
    if (next) next.focus({ preventScroll: true });
  }
  renderShell();
  return result;
}

// One repaint per turn: a snapshot applies, a frame lands and a selection moves
// in the same task, and the reader sees the result once.
let documentPending = false;
function renderDocumentSoon() {
  if (documentPending) return;
  documentPending = true;
  const run = () => { documentPending = false; renderDocument(); };
  if (typeof queueMicrotask === "function") queueMicrotask(run);
  else setTimeout(run, 0);
}

init();
