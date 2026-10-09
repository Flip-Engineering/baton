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
  // Bumped by every fetched read and by interactions that change what the
  // document draws; the redraw signature carries it.
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
  if (ex && ex.phase === "running") return "running";
  if (ex && ex.phase === "starting") return "waiting";
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

// Two different reads, kept apart with different names.
//
// A seat OWES WORK when the recorded queue holds messages it has not
// acknowledged. That is the actor's own inbox responsibility: an ordinary
// pending task or report belongs to the actor, and it never establishes that a
// person must act.
//
// A seat NEEDS A PERSON when the record holds a fact only a person can clear: an
// explicit stop, or a failure on the current attempt (a provider failure at
// exit 0 included, which deriveStatus reports as failed).
function owesWork(p) {
  return Math.max(p.pendingCount || 0, p.unacknowledgedCount || 0) > 0;
}

function needsPerson(p) {
  const stop = p.stop || null;
  if (stop && stop.status === "stopped") return true;
  return deriveStatus(p) === "failed";
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
function fact(label, value, tone) {
  const span = document.createElement("span");
  span.className = "fact" + (tone ? " " + tone : "");
  const figure = document.createElement("b");
  text(figure, String(value));
  span.appendChild(figure);
  const name = document.createElement("span");
  text(name, " " + label);
  span.appendChild(name);
  return span;
}

// The separator between two figures on the plate line. It carries the space
// before it, and the label's own leading space carries the one after, so the
// line still reads as prose: "read just now · 14 need a person".
function factSeparator() {
  const span = document.createElement("span");
  span.className = "fact-sep";
  text(span, " ·");
  return span;
}

// The visible header line: what this snapshot is, and the counts no region
// states. The three counts are exclusive, in this precedence: a seat that needs
// a person, then a seat that owes work to its own inbox, then a quiet seat. The
// pit counts what is running, so this line does not count it a second time.
function renderHeaderLine() {
  let people = 0;
  let owing = 0;
  let quiet = 0;
  for (const p of state.players.values()) {
    if (needsPerson(p)) {
      people += 1;
      continue;
    }
    if (owesWork(p)) {
      owing += 1;
      continue;
    }
    const tone = (typeof stateMark === "function" ? stateMark(p) : null);
    if (tone && (tone.tone === "ended" || tone.tone === "unknown")) quiet += 1;
  }
  el.snapshotLine.textContent = "";
  const snapshot = document.createElement("span");
  snapshot.className = "fact";
  text(snapshot, (state.snapshotLabel || "No snapshot loaded.")
    + (state.capturedAt ? " · read " + (ageText(state.capturedAt) || "just now") : ""));
  el.snapshotLine.appendChild(snapshot);
  if (state.players.size) {
    el.snapshotLine.appendChild(factSeparator());
    el.snapshotLine.appendChild(fact("need a person", people, people > 0 ? "attention" : ""));
    el.snapshotLine.appendChild(factSeparator());
    el.snapshotLine.appendChild(fact("owe work", owing, ""));
    el.snapshotLine.appendChild(factSeparator());
    el.snapshotLine.appendChild(fact("quiet", quiet, ""));
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
function select(id) {
  if (!state.players.has(id)) return;
  state.selectionId = id;
  state.knowledgeOpen = false;
  state.findingId = null;
  // Every selection intent renders, even the same seat again: the map or the
  // record may have dismissed a card since, and that dismissal is not in the
  // shell's signature.
  markDrawnStale();
  // The seat is addressable: a reader can send the link to a seat and land on
  // the same record.
  if (typeof history.replaceState === "function") {
    history.replaceState(null, "", "#seat=" + encodeURIComponent(id));
  }
  renderTree();
  void loadActorKnowledge(id);
  void loadActorWork(id);
  // Move keyboard focus to the selected seat's row; when the row is not drawn
  // (a quiet seat) the record itself takes the focus, since it holds the answer.
  const row = el.roster.querySelector('.doc-row[data-doc-id="' + CSS.escape(id) + '"] .doc-open');
  const record = document.getElementById("record");
  const target = row || record;
  if (target && typeof target.focus === "function") target.focus();
}

function focusKey(kind, id) {
  return kind + ":" + id;
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
    if (res.status === 403) data = { refused: true };
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
      evidence: finding.evidence, limits: finding.limits };
  });
  const unshared = authored.filter((f) => !promoted.has(f.id)).length;
  return { contractVersion: CONTRACT_VERSION, actor: id, authored, received,
    counts: { authored: authored.length, received: received.length, unshared },
    empty: authored.length === 0 && received.length === 0 };
}

async function loadKnowledgeOverview() {
  if (state.fixtureName) {
    state.knowledge = state.fixtureKnowledge || null;
    state.knowledgeNotice = state.fixtureKnowledge ? "" : "A fixture carries no knowledge records.";
    markDrawnStale();
    renderDocumentSoon();
    return;
  }
  if (!knowledgeWired()) {
    state.knowledge = null;
    state.knowledgeNotice = "No live endpoint is configured.";
    markDrawnStale();
    renderDocumentSoon();
    return;
  }
  try {
    const res = await fetch(state.apiBase + "/orchestra/knowledge/overview");
    if (!res.ok) throw new Error("the endpoint answered " + res.status);
    state.knowledge = await res.json();
    state.knowledgeNotice = "";
  } catch (e) {
    state.knowledge = null;
    state.knowledgeNotice = "Knowledge unavailable: " + (e && e.message ? e.message : e);
  }
  markDrawnStale();
  renderDocumentSoon();
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
    if (res.status === 403) data = { refused: true };
    else if (!res.ok) data = { error: "the endpoint answered " + res.status };
    else data = await res.json();
  } catch (e) {
    data = { error: e && e.message ? e.message : String(e) };
  }
  if (state.knowledgeActorRequest !== request || state.selectionId !== id) return;
  state.knowledgeActor = data;
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
  if (!actor || !state.players.has(actor) || actor === state.selectionId) return;
  state.selectionId = actor;
  renderTree();
  void loadActorKnowledge(actor);
  void loadActorWork(actor);
}

// Open the complete claim, evidence and limits beside the graph.
function toggleFinding(id) {
  if (!id) return;
  state.findingId = state.findingId === id ? null : id;
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

// ── the shell's two readings of the run ────────────────────────────────────
// The plate word: the run in one expression mark. A seat that needs a person
// outranks everything, then the arrival of recorded changes, then silence.
const PLATE_PULSE_MS = 90000;

function plateWord() {
  for (const p of state.players.values()) {
    if (needsPerson(p)) return "fermata";
  }
  const now = Date.now();
  for (const t of state.transitions) {
    if (t && t.at && now - Date.parse(t.at) < PLATE_PULSE_MS) return "attacca";
  }
  return "tacet";
}

// The rail: the seats a person must act on, held by an explicit stop or a failed
// attempt. The chip names the recorded fact and selects the seat, so the record
// below answers the rail. A seat that only owes work to its own inbox is not
// here; that work shows on the seat's own row and in the pit's queue tick.
const RAIL_CHIPS = 12;
let railSignature = "";

function railReason(p) {
  const stop = p.stop || null;
  if (stop && stop.status === "stopped") {
    return { word: "stopped", detail: stop.id || "an explicit stop" };
  }
  const ex = p.execution || null;
  if (ex && ex.failure) {
    const failure = ex.failure;
    return {
      word: "failed",
      detail: [failure.cause, failure.errorStatus, failure.stopReason]
        .filter(Boolean).join(" · "),
    };
  }
  return { word: "failed", detail: "the attempt did not finish" };
}

function renderRail() {
  if (!el.rail) return;
  if (el.rail.contains(document.activeElement)) return;
  const waiting = orderPlayers([...state.players.values()]).filter(needsPerson);
  const signature = waiting.map((p) => p.id + ":" + railReason(p).word).join("|");
  if (signature === railSignature) return;
  railSignature = signature;
  el.rail.textContent = "";
  if (!waiting.length) {
    el.rail.hidden = true;
    return;
  }
  el.rail.hidden = false;
  const label = document.createElement("span");
  label.className = "rail-label";
  text(label, "fermata");
  el.rail.appendChild(label);
  const count = document.createElement("span");
  count.className = "rail-count";
  text(count, waiting.length
    + (waiting.length === 1 ? " seat needs a person" : " seats need a person"));
  el.rail.appendChild(count);
  waiting.slice(0, RAIL_CHIPS).forEach((p) => {
    const reason = railReason(p);
    const chip = document.createElement("button");
    chip.type = "button";
    chip.dataset.railId = p.id;
    chip.title = p.id + " · " + reason.word + ": " + reason.detail;
    text(chip, p.id + " · " + reason.word);
    chip.addEventListener("click", () => select(p.id));
    el.rail.appendChild(chip);
  });
  if (waiting.length > RAIL_CHIPS) {
    const more = document.createElement("span");
    more.className = "rail-more";
    text(more, "+" + (waiting.length - RAIL_CHIPS) + " more");
    el.rail.appendChild(more);
  }
}

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
  if (state.selectionId && !state.players.has(state.selectionId)) state.selectionId = null;
  // A seat address is honoured once, on the first snapshot that carries the seat.
  if (state.pendingSeat) {
    const addressed = state.pendingSeat;
    state.pendingSeat = "";
    if (state.players.has(addressed)) state.selectionId = addressed;
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
  state.fixtureName = query.get("fixture") || "";
  state.subject = query.get("subject") || "";

  // A seat address (#seat=<id>) selects that seat once the snapshot lands, so a
  // link a reader sends opens the same record.
  const seatAddress = String(location.hash || "").match(/^#seat=(.+)$/);
  if (seatAddress) state.pendingSeat = decodeURIComponent(seatAddress[1]);

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
  if (el.showEnded) {
    el.showEnded.addEventListener("click", () => {
      state.showEnded = state.showEnded !== true;
      el.showEnded.setAttribute("aria-pressed", state.showEnded ? "true" : "false");
      renderDocument();
    });
  }
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
      // whether a recorded fact holds the seat for a person.
      owesWork: owesWork(p),
      needsPerson: needsPerson(p),
      action: action.label || "",
      actionAt: action.at || "",
      stale: action.stale === true,
      taskTitle: (state.tasks[p.id] && state.tasks[p.id].title) || "",
      ensembles,
      live: ["running", "waiting", "pending"].indexOf(status) !== -1,
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
    // What the actor owes its own inbox, and whether a recorded fact holds the
    // seat for a person. The selection header paints its tone dot from
    // needsPerson: an explicit stop or a failed attempt, never a queued message.
    owesWork: owesWork(p),
    needsPerson: needsPerson(p),
    // The recorded terminal of the current attempt, when the server read has it:
    // null, or the provider failure the attempt ended on. The record states the
    // cause and the stop reason in one line.
    failure: (p.execution && p.execution.failure) || null,
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
      p.owesWork ? 1 : 0, p.needsPerson ? 1 : 0, p.action, p.actionAt,
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
    state.showEnded ? 1 : 0,
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
  }, documentData(), {
    selectedId: state.selectionId,
    selectedFindingId: state.findingId || "",
    selectedSeat: selectedSeat(),
    selectedFinding,
    query: state.docQuery || "",
    position: historyPosition(),
    showEnded: state.showEnded === true,
    knowledgeWholeOpen: state.knowledgeWholeOpen === true,
    knowledgeQuery: state.knowledgeSearch || "",
    knowledgeNotice: state.knowledgeNotice || "",
    onSelect: select,
    // A selection intent always renders, even when the same finding is activated
    // again: the map may have dismissed its card since, and its own state changed
    // without the shell's signature moving.
    onSelectFinding: (id) => { state.findingId = id; markDrawnStale(); renderDocument(); },
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
