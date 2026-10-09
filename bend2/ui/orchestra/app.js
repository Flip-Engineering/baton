/* Orchestra live view. Read-only. All DOM text via textContent. */

const CONTRACT_VERSION = 1;
const ARRIVAL_THROTTLE_MS = 1000;
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
  pendingOpen: null,
  search: "",
  statusFilter: "running",
  ensembleFilter: "all",
  collapsed: new Set(),
  arrivalAt: new Map(),
  structure: "",
  snapshotLabel: "",
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
  // Written, never displayed.
  connState: sink,
  cursorState: sink,
  contractState: sink,
  generationState: sink,
  tree: sink,
  search: sink,
  statusFilter: sink,
  ensembleFilter: sink,
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
    return ex.status === "exit 0" ? "completed" : "failed";
  }
  if ((p.pendingCount || 0) > 0) return "pending";
  return "unknown";
}

// An ended turn that still owes a reply reads as waiting on input, which is a
// different state from a session that is working now.
function awaitingInput(p) {
  const ex = p.execution || null;
  return Boolean(ex && ex.phase === "exited" && (p.pendingCount || 0) > 0);
}

function roleRank(role) {
  if (role === "principal-conductor") return 0;
  if (role === "associate-conductor") return 1;
  if (role === "operator") return 2;
  return 3;
}

function childrenOf(id) {
  const out = [];
  for (const p of state.players.values()) {
    if ((p.parent || "") === id) out.push(p);
  }
  out.sort((a, b) => roleRank(a.role) - roleRank(b.role) || (a.id < b.id ? -1 : 1));
  return out;
}


function matchesFilters(p) {
  if (state.statusFilter !== "all" && deriveStatus(p) !== state.statusFilter) return false;
  if (state.ensembleFilter !== "all") {
    const ens = state.ensembles.get(state.ensembleFilter);
    if (!ens) return false;
    const members = ensembleMemberSet(state.ensembleFilter);
    if (!members.has(p.id)) return false;
  }
  if (state.search) {
    const q = state.search.toLowerCase();
    const hay = [p.id, p.model, p.observedModel, p.branch, p.workspace, p.role, p.harness];
    for (const ensId of (p.memberEnsembles || []).concat(p.ownedEnsembles || [])) {
      hay.push(ensId);
      const ens = state.ensembles.get(ensId);
      for (const s of (ens && ens.sections) || []) hay.push(s.capability);
    }
    if (!hay.some((v) => (v || "").toLowerCase().includes(q))) return false;
  }
  return true;
}

function subtreeVisible(p) {
  if (matchesFilters(p)) return true;
  return childrenOf(p.id).some(subtreeVisible);
}

// Every stored member of one ensemble: its members, its sections' members and its
// owner. The ensemble filter and the tag both read this one set.
function ensembleMemberSet(ensId) {
  const ens = state.ensembles.get(ensId);
  const members = new Set();
  if (!ens) return members;
  for (const id of ens.members || []) members.add(id);
  for (const section of ens.sections || []) for (const id of section.members || []) members.add(id);
  if (ens.owner) members.add(ens.owner);
  return members;
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

// The visible header line states the snapshot fact only.
function renderHeaderLine() {
  // The header states the one recorded fact a reader needs: what this snapshot is
  // and when it was taken. Stream, cursor, generation and contract are transport
  // bookkeeping, so they are not shown.
  el.snapshotLine.textContent = "";
  text(el.snapshotLine, state.snapshotLabel || "No snapshot loaded.");
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

// One arrival mark per row per second; a later event inside the window wins the
// data and skips the second animation.
function markArrival(id) {
  if (!id || !state.players.has(id)) return;
  const now = Date.now();
  const previous = state.arrivalAt.get(id) || 0;
  if (now - previous < ARRIVAL_THROTTLE_MS) return;
  state.arrivalAt.set(id, now);
  const row = rowElement(id);
  if (row) {
    row.classList.remove("arrival");
    void row.offsetWidth;
    row.classList.add("arrival");
  }
}

function rowElement(id) {
  return el.tree.querySelector('[data-row="' + CSS.escape(id) + '"]');
}

/* --- membership tags and the message connector ----------------------------- */

// Ensemble membership cross-cuts parentage, so it is a column device: a rule with
// the group label, repeated per member row. Consecutive member rows read as one
// column, and no row is regrouped or duplicated.


// One transient hairline for a message that moved between two rows, positioned in
// the tree's own content coordinates because the tree is the scroll container.
function messageConnector(fromId, toId) {
  if (!fromId || !toId || fromId === toId) return;
  const from = rowElement(fromId);
  const to = rowElement(toId);
  if (!from || !to) return;
  const host = document.createElement("li");
  host.className = "connector-host";
  host.setAttribute("role", "presentation");
  const line = document.createElement("div");
  line.className = "connector";
  line.setAttribute("aria-hidden", "true");
  const base = el.tree.getBoundingClientRect().top - el.tree.scrollTop;
  const a = from.getBoundingClientRect();
  const b = to.getBoundingClientRect();
  const top = Math.min(a.top, b.top) - base;
  const bottom = Math.max(a.bottom, b.bottom) - base;
  line.style.top = Math.round(top) + "px";
  line.style.height = Math.round(bottom - top) + "px";
  host.appendChild(line);
  el.tree.appendChild(host);
  setTimeout(() => host.remove(), 500);
}

// The line the tree pane shows when membership changed.
function setTreeNotice(message) {
  const node = document.getElementById("tree-notice");
  if (!node) return;
  node.hidden = !message;
  node.textContent = "";
  if (message) text(node, message);
}

/* --- rendering ------------------------------------------------------------ */

function structureSignature() {
  const ids = [...state.players.keys()].sort();
  const parents = ids.map((id) => id + "<" + ((state.players.get(id) || {}).parent || ""));
  return [
    ids.join(","),
    parents.join(","),
    [...state.collapsed].sort().join(","),
    state.search,
    state.statusFilter,
    state.ensembleFilter,
    state.selectionId || "",
    state.pendingOpen || "",
    [...state.ensembles.keys()].sort().join(","),
  ].join("|");
}

function select(id) {
  if (!state.players.has(id)) return;
  state.selectionId = id;
  state.knowledgeOpen = false;
  state.findingId = null;
  renderTree();
  void loadActorKnowledge(id);
  void loadActorWork(id);
  // Move keyboard focus to the selected actor's row.
  const target = el.tree.querySelector("[data-focus=\"" + CSS.escape(focusKey("id", id)) + "\"]");
  if (target && typeof target.focus === "function") target.focus();
}

function toggleCollapse(id) {
  if (state.collapsed.has(id)) state.collapsed.delete(id);
  else state.collapsed.add(id);
  renderTree();
}


function togglePending(id) {
  state.pendingOpen = state.pendingOpen === id ? null : id;
  renderTree();
}

function focusKey(kind, id) {
  return kind + ":" + id;
}

function restoreFocus(key) {
  if (!key) return;
  const next = el.tree.querySelector('[data-focus="' + CSS.escape(key) + '"]');
  if (next && typeof next.focus === "function") next.focus();
}

// The document is the page. Every path that used to repaint a panel calls this
// entry instead, so one order and one selection serve the whole screen. The call
// is coalesced, so a snapshot, a frame and a selection in one turn repaint once.
function renderTree() {
  renderDocumentSoon();
}

function renderAction(row, p) {
  const action = actionFor(p);
  let slot = row.querySelector(".node-action");
  if (!action) {
    if (slot) slot.remove();
    return;
  }
  if (!slot) {
    slot = document.createElement("span");
    row.appendChild(slot);
  }
  slot.className = "node-action" + (action.stale ? " stale" : "");
  slot.dataset.row = p.id;
  slot.textContent = "";
  const when = ageText(action.at);
  text(slot, action.label + (when ? " · " + when : ""));
}

function buildRow(p, hasChildren) {
  const status = deriveStatus(p);
  const row = document.createElement("div");
  row.className = "node-row";
  row.dataset.row = p.id;
  row.setAttribute("aria-selected", state.selectionId === p.id ? "true" : "false");

  // A row with children carries the real expand control, named for assistive
  // technology; a leaf carries a mark with no control behind it.
  let twisty;
  if (hasChildren) {
    twisty = document.createElement("button");
    twisty.type = "button";
    twisty.className = "twisty";
    twisty.dataset.focus = focusKey("twisty", p.id);
    twisty.setAttribute("aria-label", (state.collapsed.has(p.id) ? "Expand " : "Collapse ") + p.id);
    text(twisty, state.collapsed.has(p.id) ? "+" : "-");
    twisty.addEventListener("click", () => toggleCollapse(p.id));
  } else {
    twisty = document.createElement("span");
    twisty.className = "twisty leaf";
    twisty.setAttribute("aria-hidden", "true");
    text(twisty, ".");
  }
  row.appendChild(twisty);

  const dot = document.createElement("span");
  dot.className = "dot " + status;
  dot.setAttribute("aria-hidden", "true");
  row.appendChild(dot);

  const tag = document.createElement("span");
  tag.className = "role-tag " + (p.role || "");
  text(tag, shortRole(p.role));
  row.appendChild(tag);

  const idBtn = document.createElement("button");
  idBtn.className = "node-id";
  idBtn.type = "button";
  idBtn.dataset.focus = focusKey("id", p.id);
  text(idBtn, p.id.length > 24 ? p.id.slice(0, 23) + "…" : p.id);
  idBtn.title = p.id;
  idBtn.addEventListener("click", () => select(p.id));
  row.appendChild(idBtn);

  const statusWord = document.createElement("span");
  statusWord.className = "status-word";
  text(statusWord, status);
  row.appendChild(statusWord);

  if (awaitingInput(p)) {
    const owed = document.createElement("span");
    owed.className = "status-word";
    text(owed, "awaiting input");
    row.appendChild(owed);
  }

  if ((p.pendingCount || 0) > 0) {
    const badge = document.createElement("button");
    badge.className = "pend-badge";
    badge.type = "button";
    badge.dataset.focus = focusKey("pending", p.id);
    badge.setAttribute("aria-expanded", state.pendingOpen === p.id ? "true" : "false");
    badge.setAttribute("aria-label",
      p.pendingCount + " messages awaiting acknowledgement for " + p.id);
    text(badge, "pending " + p.pendingCount);
    badge.addEventListener("click", () => togglePending(p.id));
    row.appendChild(badge);
  }

  const model = document.createElement("span");
  model.className = "model-note";
  text(model, (p.observedModel || p.model || "unknown") + " / " + (p.branch || "no branch"));
  row.appendChild(model);

  renderAction(row, p);

  return row;
}



// A committed player event re-renders the full changed row: status, awaiting marker,
// pending badge, model and branch, and the current-action slot all follow the event.
// Filter membership and an open pending list follow too; focus stays on its row.
function updateRow(p) {
  const row = rowElement(p.id);
  if (!row || !matchesFilters(p)) { renderTree(); return; }
  const focused = row.contains(document.activeElement) && document.activeElement.dataset
    ? document.activeElement.dataset.focus : null;
  const fresh = buildRow(p, childrenOf(p.id).filter(subtreeVisible).length > 0);
  row.replaceWith(fresh);
  if (focused) restoreFocus(focused);
  const li = fresh.parentElement;
  if (li && state.pendingOpen === p.id) {
    const oldList = li.querySelector(":scope > .pending-list");
    if (oldList) oldList.replaceWith(renderPendingList(p));
    else fresh.after(renderPendingList(p));
  }
  // The document is the page, so a row update repaints through the one coalesced
  // entry. The retired panel renderers are gone from this path.
  renderDocumentSoon();
}

// The header switch shows one view at a time. Switching to Knowledge
// re-renders the seats, whose layout reads zero while hidden.

// The ensemble board reads the same snapshot as the tree: recorded
// membership, derived status and the current action label per actor.

// The traffic surface reads the same snapshot: derived status per actor and
// the committed transitions the activity rail already holds.

// Every stored message the badge counts, newest first, named by id and kind. The
// count is the stored count; this list is the sample behind it.
function renderPendingList(p) {
  const ul = document.createElement("ul");
  ul.className = "pending-list";
  const items = pendingItems(p);
  if (!items.length) {
    const li = document.createElement("li");
    li.className = "muted";
    text(li, "No stored sample in this snapshot for the " + (p.pendingCount || 0) + " awaiting messages.");
    ul.appendChild(li);
    return ul;
  }
  for (const item of items) {
    const li = document.createElement("li");
    li.className = "mono";
    const when = ageText(item.at);
    text(li, (item.kind || "message") + " · " + (item.id || "unrecorded id") + (when ? " · " + when : ""));
    ul.appendChild(li);
  }
  return ul;
}

function shortRole(role) {
  if (role === "principal-conductor") return "principal";
  if (role === "associate-conductor") return "associate";
  if (role === "operator") return "operator";
  return "player";
}

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
    renderDocumentSoon();
    return;
  }
  if (!knowledgeWired()) {
    state.knowledge = null;
    state.knowledgeNotice = "No live endpoint is configured.";
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
  state.snapshotLabel = label + (state.subject ? " subject " + state.subject : "")
    + " at " + (data.capturedAt || "time unrecorded");
  setCursor(data.cursor || "");
  if (data.selection && data.selection.gap === true) {
    holdGapNotice("Snapshot reports an event history gap. Shown state is authoritative as of the cursor.");
  }
  if (state.selectionId && !state.players.has(state.selectionId)) state.selectionId = null;
  if (state.pendingOpen && !state.players.has(state.pendingOpen)) state.pendingOpen = null;
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
    // A new actor or a reparent restructures the tree; an attribute change is
    // patched in place so focus, selection and filters stay where they are.
    if (!known || structureSignature() !== state.structure) renderTree();
    else {
      updateRow(p);
    }
    markArrival(p.id);
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
      const row = rowElement(actor.id);
      if (row) renderAction(row, actor);
      // A transition on the selected actor can carry a new report, input,
      // or receipt, so the selected read refreshes with it.
      if (state.selectionId === actor.id) {
        void loadActorWork(actor.id);
      }
    }
    // Message admission goes to the recipient; its acknowledgement returns to
    // the sender.
    if (t.entity === "message" && t.counterpart) {
      if (t.kind === "receipt") {
        markArrival(t.counterpart);
        messageConnector(t.session, t.counterpart);
      } else if (t.operation === "insert") {
        markArrival(t.counterpart);
        messageConnector(t.counterpart, t.session);
      }
    }
    // A membership or ensemble change is a structural change: the tree re-renders
    // and the pane names what changed.
    if (t.entity === "membership" || t.entity === "section-membership"
        || t.entity === "ensemble" || t.entity === "section") {
      setTreeNotice((t.kind || t.entity) + ": " + (t.summary || t.entityId || "recorded change"));
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
      awaitingInput: awaitingInput(p),
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
    pendingCount: p.pendingCount || 0,
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
  };
}

function selectHistoryEvent(index) {
  const event = state.transitions[index];
  state.ribbonSeq = index > 0 && event ? String(event.seq) : null;
  renderDocument();
}

function historyPosition() {
  if (state.ribbonSeq === null) return 0;
  const index = state.transitions.findIndex((event) => String(event.seq) === state.ribbonSeq);
  return index < 0 ? 0 : index;
}

function renderDocument() {
  if (!window.OversightDocument) return;
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
    onSelectFinding: (id) => { state.findingId = id; renderDocument(); },
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
