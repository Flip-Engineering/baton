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
  sse: null,
  connected: false,
  knowledge: null,
  fixtureKnowledge: null,
  knowledgeNotice: "",
  knowledgeActor: null,
  knowledgeActorId: "",
  knowledgeActorRequest: null,
  // The knowledge the map is showing: universal by default, the selected worker's or
  // group's holdings once one is chosen, all held records only when asked for.
  knowledgeScope: { kind: "universal", id: "" },
  // The relation the record asked the map to light, by its recorded name.
  knowledgeFocusRelation: "",
  // Bumped by every relation activation, so activating the same relation again
  // after a dismissal is a new request rather than the same one.
  knowledgeFocusSeq: 0,
  // The project surface: the selected actor's recorded workspace, its prior conversations and
  // the outcome of continuing one. Read on demand; the actor it belongs to travels with it.
  project: null,
  projectNotice: "",
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
  roster: document.getElementById("roster"),
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
  // acknowledgement; the unacknowledged count carries what the pending
  // set omits. Status and ordering read this total; the row marks show
  // the two counts as two separate facts.
  if (Math.max(p.pendingCount || 0, p.unacknowledgedCount || 0) > 0) return "pending";
  return "unknown";
}

// A seat owes work when its recorded queue holds unacknowledged messages: the actor's
// own inbox answers them.
function owesWork(p) {
  return Math.max(p.pendingCount || 0, p.unacknowledgedCount || 0) > 0;
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

// Focus the first seat in one of these states, revealing the recorded rows first when the
// seat is not on screen. The roster's own control states how many rows that adds.
function focusFirstRow(matches) {
  const wanted = [...state.players.values()].filter(matches).map((p) => p.id);
  const find = () => {
    for (const id of wanted) {
      const control = el.roster.querySelector('.doc-row[data-doc-id="' + CSS.escape(id) + '"] .doc-open');
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
  control.focus();
  if (typeof control.scrollIntoView === "function") control.scrollIntoView({ block: "nearest" });
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

// The recorded relations that name one finding on either end, exactly as the
// route states them: source and target may be finding:ID or message:ID references
// or ordinary external references, so both the prefixed and the bare id match. A
// relation exists only when it is recorded - nothing is inferred here.
function relationsFor(findingId) {
  const all = (state.knowledge && state.knowledge.relations) || [];
  if (!all.length) return [];
  const id = String(findingId || "");
  const ref = "finding:" + id;
  return all.filter((r) => r
    && (r.source === ref || r.target === ref || r.source === id || r.target === id));
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

function select(id) {
  // An id outside the snapshot is an outside-tree subject, never a dead one: the
  // record reads the id and says so, and the reads answer their own refusal. No
  // other seat behaviour changes, and the address write below still happens.
  if (!id) return;
  state.selectionId = id;
  state.knowledgeOpen = false;
  state.findingId = null;
  // A new selection clears the relation the record had asked the map to light.
  state.knowledgeFocusRelation = "";
  // The map follows the selection into that worker's own holdings. Universal is the
  // default and stays one click away on the map's own control.
  if (state.knowledgeScope.kind !== "actor" || state.knowledgeScope.id !== id) {
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

// Omit a repeated worker label when the holder's name includes that word.
function scopeLabel(kind, id) {
  const holder = shortSeatId(id || "");
  if (kind === "all") return "All held records";
  if (kind === "unstated") return "Held records";
  if (kind === "group") return "Group " + (holder || "not named");
  if (kind === "worker" || kind === "actor") {
    if (!holder) return "Worker holdings";
    return holder.toLowerCase().indexOf("worker") === -1 ? "Worker " + holder : holder;
  }
  return "Universal knowledge";
}

// The scope the map shows: ?actor=ID for a worker's holdings, ?group=ENSEMBLE for the
// recorded owner's, ?scope=all for every held record, and nothing for universal.
function knowledgeScopeQuery() {
  const scope = state.knowledgeScope || { kind: "universal", id: "" };
  if (scope.kind === "actor" && scope.id) return "?actor=" + encodeURIComponent(scope.id);
  if (scope.kind === "group" && scope.id) return "?group=" + encodeURIComponent(scope.id);
  if (scope.kind === "all") return "?scope=all";
  return "";
}

function setKnowledgeScope(scope) {
  state.knowledgeScope = scope || { kind: "universal", id: "" };
  renderMapScope();
  void loadKnowledgeOverview();
}

// The scope answered from the fixture with the rule the server applies: holders are the
// parentless conductors for universal, the named session for a worker, the recorded owner
// for a group, and null (every record) only for all. A scope holds what its holders
// authored or had promoted into it, plus the actors and ancestors it touches; a relation
// stays when a holder authored it or an end is held, the other end as the reference it is.
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
  const held = holders === null ? findings : findings.filter((f) => holders.includes(f.author)
    || allPromotions.some((p) => p.finding === f.id && holders.includes(p.destination)));
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
    : relations.filter((r) => holders.includes(r.author) || touches(r.source) || touches(r.target));
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
  for (const id of Object.keys(actors)) {
    const recorded = known[id] || {};
    actors[id].role = recorded.role || "";
    actors[id].parent = recorded.parent || "";
    chain(id);
  }
  return Object.assign({}, source, {
    scope: { kind: asking.kind, id: asking.id || null, holders },
    findings: held,
    promotions,
    relations: heldRelations,
    actors,
    empty: held.length === 0 && promotions.length === 0 && heldRelations.length === 0,
  });
}

// The keyboard spine: move the row cursor by one over the rows on screen and focus the
// row's own control, so Enter opens the record. False when there is nowhere to move.
function stepRow(delta) {
  if (!el.roster) return false;
  const rows = [...el.roster.querySelectorAll(".doc-row")];
  if (!rows.length) return false;
  const current = rows.findIndex((row) => row.contains(document.activeElement));
  const next = current < 0
    ? (delta > 0 ? 0 : rows.length - 1)
    : Math.min(rows.length - 1, Math.max(0, current + delta));
  if (next === current) return false;
  const control = rows[next].querySelector(".doc-open");
  if (!control) return false;
  control.focus();
  if (typeof control.scrollIntoView === "function") control.scrollIntoView({ block: "nearest" });
  return true;
}

// Escape returns the record to its prompt and the page address to the plain view.
function clearSelection() {
  state.selectionId = null;
  state.knowledgeOpen = false;
  state.findingId = null;
  state.knowledgeFocusRelation = "";
  setKnowledgeScope({ kind: "universal", id: "" });
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
  state.resume = null;
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
      state.projectNotice = shortSeatId(actor) + " has no recorded workspace.";
      state.projectRead = "missing";
    } else if (!res.ok) {
      state.project = null;
      state.projectNotice = "The project could not be read (" + res.status + ").";
      state.projectRead = "error";
    } else {
      state.project = {
        actor,
        name: projectName(body.project),
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
        messageId: body.message || "",
        receipt: (delivery && delivery.receipt) || "",
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

// Compare rendered session and resume fields before updating the DOM.
function projectSignature() {
  const project = state.project;
  const resume = state.resume;
  const parts = [state.projectNotice];
  if (project) {
    parts.push(project.actor, project.name, String(project.sessions.length));
    project.sessions.forEach((session) => {
      parts.push([session.id, session.latestReportId || "", session.pendingCount || 0,
        projectStopped(session) ? "stopped" : ""].join(":"));
    });
    const chosen = project.selected;
    // The rendered values themselves, not a length or a digest: equal-length changes to a
    // report, a notice or a refusal must redraw, and an unrelated frame must not.
    parts.push(chosen ? [chosen.id, chosen.latestReportId || "",
      String(chosen.latestReport || "")].join(":") : "-");
  } else {
    parts.push("-");
  }
  if (resume) {
    const refusal = resume.refused || {};
    parts.push([resume.session, resume.pending ? "pending" : resume.ok ? "ok" : "refused",
      resume.receipt || "", resume.messageId || "", resume.latestReportId || "",
      String(resume.latestReport || ""), resume.stopped ? "stopped" : "",
      refusal.error || "", refusal.status === undefined ? "" : String(refusal.status),
      refusal.code === undefined || refusal.code === null ? "" : String(refusal.code),
      refusal.stdout || "", refusal.stderr || ""].join(":"));
  } else {
    parts.push("none");
  }
  return parts.join("|");
}

let projectDrawn = "";

function renderProject() {
  if (!el.projectBody) return;
  const signature = projectSignature();
  if (signature === projectDrawn) return;
  const active = document.activeElement;
  const key = active && active.dataset ? active.dataset.projectKey || "" : "";
  const report = el.projectBody.querySelector(".project-report");
  const scroll = report ? report.scrollTop : 0;
  projectDrawn = signature;
  const project = state.project;
  if (el.projectState) {
    el.projectState.textContent = project
      ? (project.name || "project") + " \u00b7 " + project.sessions.length
        + (project.sessions.length === 1 ? " conversation" : " conversations")
      : (state.projectNotice || "Nothing read yet.");
  }
  el.projectBody.textContent = "";
  if (project && project.sessions.length) {
    const list = document.createElement("ul");
    list.className = "project-list";
    project.sessions.forEach((session) => {
      const item = document.createElement("li");
      const open = document.createElement("button");
      const chosen = project.selected && project.selected.id === session.id;
      open.type = "button";
      open.className = "project-session" + (chosen ? " is-selected" : "")
        + (projectStopped(session) ? " is-stopped" : "");
      open.dataset.projectKey = "session:" + session.id;
      open.title = session.id + (projectStopped(session) ? " \u00b7 stopped" : "")
        + (session.latestReportId ? " \u00b7 report kept" : "");
      text(open, shortSeatId(session.id || ""));
      if (session.pendingCount) {
        const mark = document.createElement("span");
        mark.className = "project-pending mono";
        text(mark, String(session.pendingCount));
        open.appendChild(mark);
      }
      open.addEventListener("click", () => {
        void loadProject(session.id);
        // The knowledge overview answers for any recorded actor, so the map follows the
        // conversation the reader picked - prior ones included.
        setKnowledgeScope({ kind: "actor", id: session.id });
      });
      item.appendChild(open);
      list.appendChild(item);
    });
    el.projectBody.appendChild(list);
  }
  const chosenSession = project && project.selected ? project.selected : null;
  if (chosenSession) {
    const row = document.createElement("div");
    row.className = "project-resume";
    const resume = state.resume && state.resume.session === chosenSession.id ? state.resume : null;
    const stopped = projectStopped(chosenSession);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "doc-scope-btn";
    button.dataset.projectKey = "continue";
    if (resume && resume.pending) {
      button.disabled = true;
      text(button, "Continuing\u2026");
    } else if (stopped) {
      text(button, "Lift the stop and continue");
      button.title = "The session is recorded as stopped; the stop stands until it is lifted here.";
    } else {
      text(button, "Continue");
      button.title = "Continue " + chosenSession.id + " through its recorded receiver.";
    }
    button.addEventListener("click", () => { void resumeSession(chosenSession.id, stopped); });
    row.appendChild(button);
    const said = document.createElement("p");
    said.className = "project-outcome";
    if (resume && resume.pending) text(said, "asking the coordinator\u2026");
    else if (resume && resume.ok) text(said, "accepted");
    else if (resume && resume.ok === false) text(said, "not continued");
    else if (stopped) text(said, "stopped");
    else if (chosenSession.latestReportId) text(said, "a report is kept");
    else text(said, "ready to continue");
    if (chosenSession.pendingCount) {
      text(said, " \u00b7 " + chosenSession.pendingCount + " waiting");
    }
    row.appendChild(said);
    el.projectBody.appendChild(row);
    // Expand the report and resume response on request.
    const detail = document.createElement("details");
    detail.className = "project-detail";
    const summary = document.createElement("summary");
    text(summary, "The report and the coordinator's answer");
    detail.appendChild(summary);
    const reportBody = document.createElement("pre");
    reportBody.className = "project-report";
    text(reportBody, chosenSession.latestReport
      ? String(chosenSession.latestReport)
      : "No report is kept for this conversation.");
    detail.appendChild(reportBody);
    if (resume) {
      const facts = document.createElement("p");
      facts.className = "muted";
      const bits = [];
      if (resume.ok) {
        bits.push(resume.receipt ? "delivery receipt " + resume.receipt : "the coordinator accepted the resume");
        if (resume.messageId) bits.push("message " + resume.messageId);
        if (resume.latestReportId) bits.push("report kept " + resume.latestReportId);
        bits.push("an admission is not completed work, and that report predates this request");
      } else if (resume.refused) {
        bits.push(resume.refused.error || "no cause was recorded");
        if (resume.refused.status) bits.push("status " + resume.refused.status);
        if (resume.refused.code !== undefined && resume.refused.code !== null) bits.push("code " + resume.refused.code);
        if (resume.refused.stdout) bits.push("stdout: " + resume.refused.stdout);
        if (resume.refused.stderr) bits.push("stderr: " + resume.refused.stderr);
      }
      text(facts, bits.join(" \u00b7 "));
      detail.appendChild(facts);
    }
    el.projectBody.appendChild(detail);
  }
  const back = key
    ? el.projectBody.querySelector('[data-project-key="' + CSS.escape(key) + '"]') : null;
  if (back && typeof back.focus === "function") back.focus();
  const next = el.projectBody.querySelector(".project-report");
  if (next && scroll) next.scrollTop = scroll;
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
  set(el.plateMap, findings.length ? findings.length + (findings.length === 1 ? " finding" : " findings") : "no findings");
  set(el.plateStaves, state.players.size ? state.players.size + " seats" : "no seats");
  set(el.plateRecord, state.selectionId ? shortSeatId(state.selectionId) : "none selected");
  set(el.plateProject, project ? project.sessions.length + " conversations" : "");
}

async function loadKnowledgeOverview() {
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
    if (!res.ok) throw new Error("the endpoint answered " + res.status);
    const answered = await res.json();
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

// The map states which scope it drew, read from the scope the answer carries, and
// offers the one step to every held record. The universal view is the default and
// stays the way back.
function renderMapScope() {
  if (!el.mapScope) return;
  const asked = state.knowledgeScope || { kind: "universal", id: "" };
  const stated = (state.knowledge && state.knowledge.scope) || null;
  // Display the returned scope and its finding count.
  const kind = stated ? stated.kind : (state.knowledge ? "unstated" : asked.kind);
  const id = (stated && stated.id) || asked.id;
  const findings = (state.knowledge && state.knowledge.findings) || [];
  const what = scopeLabel(kind, id);
  const count = findings.length + (findings.length === 1 ? " item" : " items");
  el.mapScope.textContent = what + " · " + count;
  if (el.mapScopeAll) {
    const all = kind === "all";
    el.mapScopeAll.setAttribute("aria-pressed", all ? "true" : "false");
    el.mapScopeAll.textContent = all ? "Back to universal knowledge" : "All held records";
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
    else data = await res.json();
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

// Open the record at a finding: select it, render, then land the record on its block.
// The map's pinned card and any future caller use this one path, so the block a reader
// lands on is the block the record keeps.
function openRecordAt(id) {
  if (!id) return;
  state.findingId = id;
  writeFindingAddress(id);
  markDrawnStale();
  renderDocument();
  const land = () => {
    const block = el.selection && el.selection.querySelector("#sel-sec-finding");
    if (block && typeof block.scrollIntoView === "function") {
      block.scrollIntoView({ block: "start" });
      return true;
    }
    return false;
  };
  // A click arrives during a pointer gesture, which defers the repaint; the block exists
  // after the flush, so one frame later is the retry.
  if (!land() && typeof requestAnimationFrame === "function") requestAnimationFrame(land);
}

// The way back: a reader who has read a record returns to the mark that holds it, with
// the surface it lives on in view. A seat selects through the same path the staves use,
// so the map, the stage and the roster agree on what is selected; a finding keeps the
// address, so the return move is one a reader can pass on.
function locateEntity(ref) {
  const id = String(ref || "");
  if (!id) return;
  if (state.players.has(id)) {
    select(id);
    reveal(el.attentionBand);
    return;
  }
  state.findingId = id;
  writeFindingAddress(id);
  markDrawnStale();
  renderDocument();
  reveal(el.knowledgeWhole);
}

// Bring a mount's region into view. The surfaces sit as sections in one page scroll, so
// the landing a reader wants is the section that holds the mount, not its first pixel.
function reveal(mount) {
  const region = mount && typeof mount.closest === "function" ? mount.closest("section") : null;
  const target = region || mount;
  if (target && typeof target.scrollIntoView === "function") target.scrollIntoView({ block: "start" });
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
    else data = await res.json();
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
    // The address restores the whole selection, not only the id: the map opens on
    // that actor's holdings, the scope a row click sets.
    setKnowledgeScope({ kind: "actor", id: addressed });
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
  const data = await res.json();
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
      if (typeof m.unacknowledgedCount === "number") p.unacknowledgedCount = m.unacknowledgedCount;
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

  // Query changes move to the first visible match while retaining typing focus.
  if (el.find) {
    el.find.addEventListener("input", () => {
      const query = el.find.value.trim();
      if (query === state.docQuery) return;
      state.docQuery = query;
      renderDocument();
      const match = el.roster.querySelector(".doc-cursor");
      if (match) match.scrollIntoView({ block: "nearest" });
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
  if (el.roster) {
    // A band naming one recorded ensemble opens that group's own knowledge on the
    // map; the map's scope line states which holdings it drew.
    el.roster.addEventListener("click", (ev) => {
      const open = ev.target && ev.target.closest ? ev.target.closest("[data-doc-group]") : null;
      if (!open) return;
      setKnowledgeScope({ kind: "group", id: open.getAttribute("data-doc-group") });
    });
  }
  if (el.mapScopeAll) {
    el.mapScopeAll.addEventListener("click", () => {
      // Universal knowledge is the default view; the one control discovers every
      // held record and the same control names the way back.
      const all = (state.knowledgeScope || {}).kind === "all";
      setKnowledgeScope(all ? { kind: "universal", id: "" } : { kind: "all", id: "" });
    });
  }
  // The keyboard spine: one cursor walks the rows the reader can see, from anywhere in
  // the page. Typing fields and the pit and axis own their own keys, so both are left alone.
  document.addEventListener("keydown", (ev) => {
    if (ev.defaultPrevented || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const target = ev.target;
    if (target && target.closest
      && target.closest("input, textarea, select, [contenteditable], #ribbon, #attention-band")) return;
    // j and k step from anywhere; the arrow keys step only once focus is already in the
    // roster, so they keep scrolling the page.
    const inRoster = Boolean(target && target.closest && target.closest("#roster"));
    if (ev.key === "j" || (inRoster && ev.key === "ArrowDown")) { if (stepRow(1)) ev.preventDefault(); }
    else if (ev.key === "k" || (inRoster && ev.key === "ArrowUp")) { if (stepRow(-1)) ev.preventDefault(); }
    else if (ev.key === "/") { if (el.find) { ev.preventDefault(); el.find.focus(); } }
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
      el.find.focus();
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
      pendingCount: p.pendingCount || 0,
      // Reports this seat was sent and never acknowledged. The snapshot records
      // the count, and it is a different kind of waiting from a queued input.
      unacknowledgedCount: p.unacknowledgedCount || 0,
      // The stored sample carries the kinds, so the report mark reads its own
      // count. This is not unacknowledgedCount minus pendingCount: a stopped
      // actor's queued inputs leave pendingCount while its reports stay
      // unacknowledged, so the difference reads as reports that are not there.
      reportCount: pendingItems(p).filter((m) => m && m.kind === "report").length,
      // Everything the seat owes, whatever the kind, for ordering and the rail.
      owedTotal: Math.max(p.pendingCount || 0, p.unacknowledgedCount || 0),
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
    unacknowledgedCount: p.unacknowledgedCount || 0,
    // The report count the record states for this seat, read from the sample.
    reportCount: pendingItems(p).filter((m) => m && m.kind === "report").length,
    owedTotal: Math.max(p.pendingCount || 0, p.unacknowledgedCount || 0),
    action: action.label || "",
    taskTitle: (state.tasks[p.id] && state.tasks[p.id].title) || "",
    // The recorded work read for this seat, when the on-demand read has landed
    // for it: the task body, the current input, the open request and the report.
    work: state.workActorId === p.id ? state.work : null,
    // The recorded ids of the messages this seat has not acknowledged. A count
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
      p.id, p.status, p.pendingCount, p.unacknowledgedCount,
      p.owesWork ? 1 : 0, p.notProgressing ? 1 : 0, p.action, p.actionAt,
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
  const rowFocus = active && active.dataset ? active.dataset.docKey : null;
  let knowledgeFocus = null;
  let knowledgeMount = null;
  if (active && active.closest) {
    for (const name of ["data-kw-id", "data-kw-node"]) {
      if (active.hasAttribute(name)) {
        knowledgeFocus = '[' + name + '="' + CSS.escape(active.getAttribute(name)) + '"]';
        const row = active.closest(".doc-row");
        knowledgeMount = row ? row.dataset.docId : "whole";
      }
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
    roster: el.roster,
    selection: el.selection,
    ribbon: el.ribbon,
    knowledgeWhole: el.knowledgeWhole,
    counts: el.counts,
    // The document owns the roster's scope, so it owns the control that names it.
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
    onReadMessage: (id) => { void loadMessageBody(id); },
    onScrub: selectHistoryEvent,
    onSelectEvent: selectHistoryEvent,
    onListOpen: () => {},
  });
  if (knowledgeFocus) {
    const mount = knowledgeMount === "whole" ? el.knowledgeWhole
      : el.roster.querySelector('[data-doc-id="' + CSS.escape(knowledgeMount) + '"]');
    const next = mount && mount.querySelector(knowledgeFocus);
    if (next) next.focus();
  }
  if (rowFocus) {
    const next = el.roster.querySelector('[data-doc-key="' + CSS.escape(rowFocus) + '"]');
    if (next) next.focus();
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
