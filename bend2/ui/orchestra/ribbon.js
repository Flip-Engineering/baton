/* Recorded activity across the selected time window.

   Each interval has a note whose height and size represent its count and whose
   color represents its most frequent event kind. The needle selects a time;
   player chips select that player's newest entry. The full record opens from
   the list control.

   The time scale is linear over the window and the axis spans the mount's
   content width with no inset of its own, so the grid lines up column for
   column with the staves below it.

   Read-only. Every character of text is written through textContent, the module
   starts no request, and it renders nothing without its mount.

   options: {position, onScrub, onSelectEvent, onSelectActor, selectedId,
             onListOpen}
   data: {events} newest first, as the page holds them; {subject} the subject the
   events were recorded under; {conversationId} the project's open conversation. */

const RIBBON_BARS_MAX = 180;
// The list is a moving window over the history, centred on the slider
// position and re-rendered on every scrub. Twenty-one rows is ten events
// of context on each side of the current one: the whole window stands in
// page flow at roughly the height the old 320px box clipped to, and the
// axis stays the one paging gesture, as the list's own note row states.
const RIBBON_LIST_ROWS = 21;
// One window per key press, less the current row so a single row carries
// over between consecutive windows and the reader keeps their place.
const RIBBON_PAGE_STEP = 20;
const RIBBON_CHIPS_MAX = 8;
// A second kind counts as a real mix of the stretch at a quarter of its entries
// or more. A stray entry does not earn a head.
const RIBBON_SECOND_SHARE = 0.25;
// The five ruled lines of a staff, as percentages up from the axis floor, and
// the position above the staff for the busiest stretch.
const STAFF_LINES = [12, 31, 50, 69, 88];
const STAFF_ABOVE = 97;
const RIBBON_LIVE_MS = 90000;

const ribbonListOpen = new WeakMap();
const ribbonLastSeq = new WeakMap();

// One drag at a time, owned by the document rather than by the strip. The page
// redraws the whole document on every scrub report, which replaces the strip's
// nodes and any listener attached to them. These listeners and this record
// survive that redraw, so the pointer keeps owning the scrub past the first
// point.
let ribbonDragging = null;
let ribbonQueued = null;
let ribbonFrame = 0;

function ribbonCount(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function ribbonShort(id) {
  const full = String(id);
  return full.length > 26 ? full.slice(0, 25) + "\u2026" : full;
}

function ribbonAge(at) {
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

// A span in words, from two recorded times.
function ribbonSpan(fromMs, toMs) {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) return "";
  const minutes = Math.round((toMs - fromMs) / 60000);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return minutes + (minutes === 1 ? " minute" : " minutes");
  const hours = Math.round(minutes / 60);
  if (hours < 48) return hours + (hours === 1 ? " hour" : " hours");
  return Math.round(hours / 24) + " days";
}

function ribbonEscape(value) {
  if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(value);
  return String(value).replace(/["\\]/g, "\\$&");
}

// Recorded kind to a class: message:report -> ribbon-kind-message-report.
function ribbonKindClass(kind) {
  const slug = String(kind || "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return "ribbon-kind-" + (slug || "unknown");
}

// The ink a recorded kind carries in the score. Kinds that read as one thing
// share an ink; everything else carries the score's own warm ink. The colours
// live in the region's stylesheet, one rule per group.
function ribbonInkClass(kind) {
  const slug = ribbonKindClass(kind).slice("ribbon-kind-".length);
  if (slug === "message-task" || slug === "message-guidance"
    || slug === "message-recovery") return "ribbon-ink-waiting";
  // The recorded vocabulary names a receipt with and without its prefix, and
  // receipts are the window's busiest kind.
  if (slug === "message-report" || slug === "message-receipt"
    || slug === "report" || slug === "receipt") return "ribbon-ink-report";
  if (slug === "execution" || slug === "native-request") return "ribbon-ink-running";
  if (slug === "stop") return "ribbon-ink-failed";
  if (slug.startsWith("ensemble") || slug.startsWith("membership")
    || slug.startsWith("section") || slug === "role") return "ribbon-ink-structure";
  return "ribbon-ink-note";
}

function ribbonSeats(event) {
  const seats = [];
  for (const value of [event.session, event.counterpart]) {
    const id = String(value || "");
    if (id && seats.indexOf(id) === -1) seats.push(id);
  }
  return seats;
}

// The contour: one line through the notes, scaled to the interval count.
function ribbonContour(points, bars) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  node.setAttribute("class", "ribbon-shape");
  node.setAttribute("viewBox", "0 0 " + bars + " 100");
  node.setAttribute("preserveAspectRatio", "none");
  node.setAttribute("aria-hidden", "true");
  const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  line.setAttribute("points", points);
  line.setAttribute("vector-effect", "non-scaling-stroke");
  node.appendChild(line);
  return node;
}

// The busiest recorded kinds, named as the database names them.
function ribbonKindTally(events, limit) {
  const tally = new Map();
  for (const event of events) {
    const kind = String((event || {}).kind || "unknown");
    tally.set(kind, (tally.get(kind) || 0) + 1);
  }
  return [...tally.entries()]
    .sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : 1))
    .slice(0, limit);
}

// The mark at the axis's left end states one measured fact about the window in
// a familiar word: one agent when a single agent carries the whole window, busy
// while the busiest part carries twelve or more entries, live while entries
// arrive. The reading beside the word states the measurement itself, so nothing
// has to be decoded. The counts the shell already computes are quoted, never
// recomputed.
function ribbonTempo(busiest, uniqueSeats, recent, shellCounts) {
  let word = "";
  let reading = "";
  if (uniqueSeats === 1) {
    word = "one agent";
    reading = "every entry in this window came from one agent";
  } else if (busiest >= 12) {
    word = "busy";
    reading = "the busiest part of this window holds "
      + ribbonCount(busiest) + " recorded entries";
  } else if (recent) {
    word = "live";
    reading = "entries are arriving";
  }
  if (!word) return null;
  return {
    word: word,
    reading: reading,
    title: reading + (shellCounts ? " \u00b7 " + shellCounts : ""),
  };
}

// The counts the shell already computed, quoted in the mark's title.
function ribbonShellCounts() {
  const node = document.getElementById("doc-counts");
  return node && node.textContent ? node.textContent.trim() : "";
}

// The measured rate, in the words the page uses for a recorded entry.
function ribbonRate(total, spanMs) {
  if (!Number.isFinite(spanMs) || spanMs <= 0 || total < 2) return "";
  const minutes = spanMs / 60000;
  if (minutes < 1) return ribbonCount(total) + " entries in under a minute";
  const per = total / minutes;
  const rounded = per >= 10 ? Math.round(per) : Math.round(per * 10) / 10;
  return ribbonCount(rounded) + " entries a minute";
}

function ribbonEventText(event, index, total) {
  if (!event) return "no recorded change at this position";
  const from = String(event.session || "");
  const to = String(event.counterpart || "");
  const where = from && to ? from + " to " + to : (from || to || "no actor recorded");
  return "change " + ribbonCount(total - index) + " of " + ribbonCount(total)
    + ", " + (event.kind || "unknown") + ", " + where
    + (event.at ? ", " + event.at : "");
}

function ribbonPositionFromClient(container, clientX) {
  const axis = container ? container.querySelector(".ribbon-axis") : null;
  if (!axis) return null;
  const box = axis.getBoundingClientRect();
  if (!box.width) return null;
  return Math.min(1, Math.max(0, (clientX - box.left) / box.width));
}

function ribbonFlush() {
  const pending = ribbonQueued;
  ribbonQueued = null;
  if (pending === null || !ribbonDragging) return;
  const opts = ribbonDragging.opts || {};
  if (typeof opts.onScrub === "function") opts.onScrub(pending);
}

// One report per frame: each report redraws the document.
function ribbonReport(index) {
  ribbonQueued = index;
  if (ribbonFrame) return;
  ribbonFrame = window.requestAnimationFrame(() => {
    ribbonFrame = 0;
    ribbonFlush();
  });
}

function ribbonAt(container, clientX) {
  if (!ribbonDragging) return;
  const fraction = ribbonPositionFromClient(container, clientX);
  if (fraction === null) return;
  const mapping = ribbonDragging.map;
  const next = mapping ? mapping(fraction) : null;
  if (next !== null && next !== undefined) ribbonReport(next);
}

function ribbonMove(event) {
  if (!ribbonDragging || event.pointerId !== ribbonDragging.pointerId) return;
  ribbonAt(ribbonDragging.container, event.clientX);
}

function ribbonEndDrag(event) {
  if (!ribbonDragging) return;
  if (event && event.pointerId !== ribbonDragging.pointerId) return;
  if (ribbonFrame) {
    window.cancelAnimationFrame(ribbonFrame);
    ribbonFrame = 0;
  }
  if (event && typeof event.clientX === "number") ribbonAt(ribbonDragging.container, event.clientX);
  ribbonFlush();
  document.removeEventListener("pointermove", ribbonMove, true);
  document.removeEventListener("pointerup", ribbonEndDrag, true);
  document.removeEventListener("pointercancel", ribbonEndDrag, true);
  ribbonDragging = null;
}

function renderRibbon(container, data, options) {
  const opts = options || {};
  if (!container) return { events: 0, position: 0 };
  const events = Array.isArray((data || {}).events) ? data.events : [];
  const total = events.length;
  const subject = String((data || {}).subject || "");
  const conversation = String((data || {}).conversationId || "");
  // What the events are, in one clause: the recorded history of the subject
  // they were recorded under. No filter is applied by this region.
  const scopeWords = subject
    ? "recorded history of subject " + subject
    : "the subject's recorded history";

  // Captured before the mount is cleared, because the page redraws this ribbon
  // on every scrub and on every frame it renders. Reading it after the rebuild
  // reads the body and loses the reader's place.
  const active = document.activeElement;
  const focusKey = active && container.contains(active) && active.dataset
    ? (active.dataset.focus || "") : "";

  if (ribbonDragging && ribbonDragging.container === container) {
    // A redraw during a drag: keep the live options so the pointer keeps
    // owning the scrub. The axis mapping is rebuilt below.
    ribbonDragging.opts = opts;
  }

  container.textContent = "";

  if (!total) {
    // Nothing arrived in this window: state it in one line, keep the span rule
    // and the control's place, and take a fraction of the drawing's height.
    container.classList.add("ribbon-quiet");
    const head = document.createElement("div");
    head.className = "ribbon-head";
    const quiet = document.createElement("span");
    quiet.className = "ribbon-summary";
    quiet.textContent = "no arrivals in this window \u00b7 " + scopeWords;
    head.appendChild(quiet);
    const quietPulse = document.createElement("span");
    quietPulse.className = "ribbon-pulse";
    quietPulse.setAttribute("aria-hidden", "true");
    head.appendChild(quietPulse);
    const quietSlider = document.createElement("div");
    quietSlider.className = "ribbon-slider";
    quietSlider.setAttribute("role", "slider");
    quietSlider.setAttribute("aria-disabled", "true");
    quietSlider.setAttribute("aria-label", "Position in the recorded history");
    quietSlider.setAttribute("aria-valuemin", "0");
    quietSlider.setAttribute("aria-valuemax", "0");
    quietSlider.setAttribute("aria-valuenow", "0");
    quietSlider.setAttribute("aria-valuetext", "no recorded arrivals");
    quietSlider.tabIndex = -1;
    const quietAxis = document.createElement("div");
    quietAxis.className = "ribbon-axis";
    quietAxis.setAttribute("aria-hidden", "true");
    quietSlider.appendChild(quietAxis);
    container.appendChild(head);
    container.appendChild(quietSlider);
    return { events: 0, position: 0 };
  }
  container.classList.remove("ribbon-quiet");

  // The page holds events newest first; the axis runs oldest to newest.
  let position = Number(opts.position);
  if (!Number.isFinite(position) || position < 0) position = 0;
  if (position > total - 1) position = total - 1;
  const current = events[position] || events[0];

  // Recorded times, oldest first, each with the index the page knows.
  const timed = [];
  for (let index = total - 1; index >= 0; index -= 1) {
    const at = Date.parse((events[index] || {}).at || "");
    if (Number.isFinite(at)) timed.push({ at, index });
  }
  const usable = timed.length >= 2 && timed[timed.length - 1].at > timed[0].at;
  const firstAt = usable ? timed[0].at : 0;
  const lastAt = usable ? timed[timed.length - 1].at : 0;
  const spanMs = usable ? lastAt - firstAt : 0;

  function fractionOf(index) {
    if (!usable) return total < 2 ? 1 : (total - 1 - index) / (total - 1);
    const at = Date.parse((events[index] || {}).at || "");
    if (!Number.isFinite(at)) return 1;
    return Math.min(1, Math.max(0, (at - firstAt) / spanMs));
  }

  // The stretch a fraction of the axis falls in, taken at the stretch's center:
  // the bar is the unit a press activates.
  function stretchAt(fraction) {
    const column = Math.min(bars - 1, Math.max(0, Math.floor(fraction * bars)));
    return (column + 0.5) / bars;
  }

  // The inverse: a column reports the recorded change nearest that time.
  function indexAt(fraction) {
    if (!usable) return Math.round((1 - fraction) * (total - 1));
    const want = firstAt + fraction * spanMs;
    let low = 0;
    let high = timed.length - 1;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (timed[mid].at < want) low = mid + 1;
      else high = mid;
    }
    const after = timed[low];
    const before = timed[Math.max(0, low - 1)];
    const pick = Math.abs(after.at - want) <= Math.abs(want - before.at) ? after : before;
    return pick.index;
  }
  if (ribbonDragging && ribbonDragging.container === container) ribbonDragging.map = indexAt;

  // Buckets over the axis: height follows the count, ink follows the recorded
  // kind that dominates the stretch.
  const bars = Math.max(1, Math.min(RIBBON_BARS_MAX, total));
  const counts = new Array(bars).fill(0);
  const kinds = new Array(bars).fill(null);
  const seats = new Array(bars).fill(null);
  const seatTally = new Map();
  const seatNewest = new Map();
  // The kinds each seat's entries were recorded under, so a chip can carry the
  // seat's inks the way a note carries a stretch's.
  const seatKinds = new Map();
  for (let index = 0; index < total; index += 1) {
    const event = events[index] || {};
    const column = Math.min(bars - 1, Math.floor(fractionOf(index) * bars));
    counts[column] += 1;
    if (!kinds[column]) kinds[column] = new Map();
    const kind = String(event.kind || "unknown");
    kinds[column].set(kind, (kinds[column].get(kind) || 0) + 1);
    if (!seats[column]) seats[column] = new Map();
    for (const id of ribbonSeats(event)) {
      seats[column].set(id, (seats[column].get(id) || 0) + 1);
      seatTally.set(id, (seatTally.get(id) || 0) + 1);
      if (!seatNewest.has(id)) seatNewest.set(id, index);
      if (!seatKinds.has(id)) seatKinds.set(id, new Map());
      const seatKindTally = seatKinds.get(id);
      seatKindTally.set(kind, (seatKindTally.get(kind) || 0) + 1);
    }
  }
  let busiest = 1;
  for (const value of counts) if (value > busiest) busiest = value;
  const here = Math.min(bars - 1, Math.floor(fractionOf(position) * bars));

  // The newest recorded time drives the arrival test and the live pulse, and the
  // tempo mark reads it, so it is computed before the head is built.
  const liveMs = Date.parse((events[0] || {}).at || "");
  const live = Number.isFinite(liveMs) && (Date.now() - liveMs) < RIBBON_LIVE_MS;
  const previousSeq = ribbonLastSeq.get(container) || "";
  const newestSeq = String((events[0] || {}).seq || "");
  const arriving = Boolean(newestSeq) && Boolean(previousSeq) && newestSeq !== previousSeq;
  ribbonLastSeq.set(container, newestSeq);

  const head = document.createElement("div");
  head.className = "ribbon-head";
  if (live) head.classList.add("ribbon-live");

  const uniqueSeats = new Set([...seatTally.keys()]).size;
  const tempo = ribbonTempo(busiest, uniqueSeats, live, ribbonShellCounts());
  if (tempo) {
    const mark = document.createElement("span");
    mark.className = "ribbon-tempo";
    mark.title = tempo.title;
    mark.textContent = tempo.word;
    head.appendChild(mark);
    const reading = document.createElement("span");
    reading.className = "ribbon-tempo-read";
    reading.textContent = tempo.reading;
    head.appendChild(reading);
  }
  const summary = document.createElement("span");
  summary.className = "ribbon-summary";
  const spanWord = ribbonSpan(firstAt, lastAt);
  const rateWord = ribbonRate(total, spanMs);
  const allKinds = ribbonKindTally(events, 8);
  head.appendChild(summary);

  // The window stated in one line: the figure, the span, and the two kinds that
  // dominate, each word in the ink its bars carry. The full breakdown is the
  // line's title, so nothing is explained by a sentence under the chart.
  summary.title = ribbonCount(total) + " recorded entries"
    + (spanWord ? " over " + spanWord : "")
    + (rateWord ? " \u00b7 " + rateWord : "")
    + (allKinds.length
      ? " \u00b7 " + allKinds.map((entry) => entry[0] + " " + ribbonCount(entry[1])).join(", ")
      : "")
    + (conversation ? " \u00b7 conversation " + conversation + " open" : "");

  function lineText() {
    if (position !== 0) {
      return ribbonEventText(current, position, total)
        + (current && current.at ? " \u00b7 " + ribbonAge(current.at) : "");
    }
    // What the window holds, when it last moved, and whose history it is: the
    // events handed here are the page's recorded history for its subject.
    const newest = ribbonAge((events[0] || {}).at);
    return ribbonCount(total) + " entries" + (spanWord ? " over " + spanWord : "")
      + (newest ? " \u00b7 newest " + newest : "")
      + " \u00b7 " + scopeWords;
  }

  // One line for the figures, the scrub position or a hovered stretch: the line
  // never grows into a second one.
  function renderLine(extra) {
    summary.textContent = "";
    summary.appendChild(document.createTextNode((extra || lineText()) + " "));
  }
  renderLine();

  const liveWord = document.createElement("span");
  liveWord.className = "ribbon-pulse";
  liveWord.setAttribute("aria-hidden", "true");
  head.appendChild(liveWord);


  const slider = document.createElement("div");
  slider.className = "ribbon-slider";
  slider.dataset.focus = "ribbon-slider";
  slider.tabIndex = 0;
  slider.setAttribute("role", "slider");
  slider.setAttribute("aria-label", "Position in the recorded history");
  slider.setAttribute("aria-valuemin", "1");
  slider.setAttribute("aria-valuemax", String(total));
  slider.setAttribute("aria-valuenow", String(total - position));
  slider.setAttribute("aria-valuetext", ribbonEventText(current, position, total));

  const axis = document.createElement("div");
  axis.className = "ribbon-axis";
  // Empty intervals retain their horizontal space without drawing a note.
  for (const line of STAFF_LINES) {
    const rule = document.createElement("span");
    rule.className = "ribbon-staffline";
    rule.style.bottom = line + "%";
    rule.setAttribute("aria-hidden", "true");
    axis.appendChild(rule);
  }
  let newestNote = null;
  const contour = [];
  for (let column = 0; column < bars; column += 1) {
    const counted = counts[column];
    const cell = document.createElement("span");
    cell.className = "ribbon-cell";
    if (!counted) {
      // A quiet interval keeps its space and is drawn as a rest on the floor.
      const rest = document.createElement("span");
      rest.className = "ribbon-rest";
      rest.style.bottom = STAFF_LINES[0] + "%";
      rest.setAttribute("aria-hidden", "true");
      cell.appendChild(rest);
      contour.push((column + 0.5).toFixed(2) + " " + (100 - STAFF_LINES[0]).toFixed(2));
    }
    if (counted) {
      const share = counted / busiest;
      const pitch = Math.min(STAFF_LINES.length, Math.round(share * STAFF_LINES.length));
      const note = document.createElement("span");
      note.className = "ribbon-note" + (column === here ? " ribbon-here" : "");
      const pitchBottom = pitch < STAFF_LINES.length ? STAFF_LINES[pitch] : STAFF_ABOVE;
      note.style.bottom = pitchBottom + "%";
      const size = (2.6 + 3.4 * share).toFixed(1);
      note.style.width = size + "px";
      note.style.height = size + "px";
      // The kinds the stretch holds, busiest first. The note's ink is the first
      // one; a real second kind carries its own ink as a second, smaller head.
      const stretchKinds = [...(kinds[column] || new Map()).entries()]
        .sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : 1));
      const dominant = stretchKinds.length ? stretchKinds[0][0] : "unknown";
      const dominantInk = ribbonInkClass(dominant);
      note.classList.add(ribbonKindClass(dominant), dominantInk);
      const runner = stretchKinds.length > 1 ? stretchKinds[1] : null;
      const runnerShare = runner ? runner[1] / counted : 0;
      const runnerInk = runner ? ribbonInkClass(runner[0]) : "";
      // A second ink over a real share of the stretch. A kind that carries the
      // note's own ink would add a head and no information, so it stays out.
      if (runner && runnerShare >= RIBBON_SECOND_SHARE && runnerInk !== dominantInk) {
        const second = document.createElement("span");
        second.className = "ribbon-second " + ribbonKindClass(runner[0]) + " " + runnerInk;
        const secondSize = (2.2 + 1.8 * runnerShare).toFixed(1);
        second.style.width = secondSize + "px";
        second.style.height = secondSize + "px";
        second.setAttribute("aria-hidden", "true");
        note.appendChild(second);
      }
      const seatNames = [...(seats[column] || new Map()).entries()]
        .sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : 1))
        .slice(0, 4)
        .map((entry) => entry[0]);
      const stretchCount = ribbonCount(counted) + (counted === 1 ? " recorded entry" : " recorded entries");
      const kindWords = stretchKinds
        .map((entry) => entry[0] + " " + ribbonCount(entry[1])).join(", ");
      const seatWords = seatNames.join(", ");
      // The stretch by name and count, in the title. The kinds are the stretch's
      // inks, and this states them; the line below states the count and the seats.
      note.title = [stretchCount, kindWords, seatWords].filter(Boolean).join(" \u00b7 ");
      note.addEventListener("pointerenter", () => renderLine(
        [stretchCount, seatWords].filter(Boolean).join(" \u00b7 ")));
      cell.appendChild(note);
      newestNote = note;
      contour.push((column + 0.5).toFixed(2) + " " + (100 - pitchBottom).toFixed(2));
    }
    axis.appendChild(cell);
  }
  // The shape of the run: gathered where the line rises, quiet where it drops.
  axis.appendChild(ribbonContour(contour.join(" "), bars));
  // The end of the score, where the newest entry sits.
  const endBar = document.createElement("span");
  endBar.className = "ribbon-endbar";
  endBar.setAttribute("aria-hidden", "true");
  axis.appendChild(endBar);
  // The newest drawn note is the one an arrival inks.
  if (arriving && newestNote) newestNote.classList.add("ribbon-arrival");
  axis.addEventListener("pointerleave", () => renderLine());

  const needle = document.createElement("span");
  needle.className = "ribbon-needle";
  needle.style.left = (fractionOf(position) * 100) + "%";
  needle.setAttribute("aria-hidden", "true");
  axis.appendChild(needle);
  slider.appendChild(axis);

  function setPosition(next) {
    if (next < 0) next = 0;
    if (next > total - 1) next = total - 1;
    if (typeof opts.onScrub === "function") opts.onScrub(next);
  }

  slider.addEventListener("pointerdown", (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();
    ribbonDragging = { container, opts, pointerId: event.pointerId, map: indexAt };
    document.addEventListener("pointermove", ribbonMove, true);
    document.addEventListener("pointerup", ribbonEndDrag, true);
    document.addEventListener("pointercancel", ribbonEndDrag, true);
    const fraction = ribbonPositionFromClient(container, event.clientX);
    // The press activates the stretch under the pointer: the recorded change
    // nearest that stretch, through the mapping the drag and the rows use. A
    // drag from here reads the pointer directly.
    if (fraction !== null) setPosition(indexAt(stretchAt(fraction)));
    if (typeof slider.focus === "function") slider.focus({ preventScroll: true });
  });
  slider.addEventListener("keydown", (event) => {
    const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"];
    if (keys.indexOf(event.key) === -1) return;
    event.preventDefault();
    // Shift steps by one interval of the drawing, so a long window is walkable.
    const step = event.shiftKey ? Math.max(1, Math.round(total / bars)) : 1;
    if (event.key === "Home") setPosition(total - 1);
    else if (event.key === "End") setPosition(0);
    else if (event.key === "PageUp") setPosition(position + RIBBON_PAGE_STEP);
    else if (event.key === "PageDown") setPosition(position - RIBBON_PAGE_STEP);
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") setPosition(position + step);
    else setPosition(position - step);
  });

  // The seats that moved most in this window; a chip jumps to that seat's
  // newest recorded change.
  const busiestSeats = [...seatTally.entries()]
    .sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : 1))
    .slice(0, RIBBON_CHIPS_MAX);
  const seatRow = document.createElement("div");
  seatRow.className = "ribbon-seats";
  if (busiestSeats.length) {
    const label = document.createElement("span");
    label.className = "ribbon-seats-label";
    label.textContent = "Busiest agents";
    seatRow.appendChild(label);
    for (const entry of busiestSeats) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "ribbon-chip";
      chip.dataset.focus = "ribbon-seat:" + entry[0];
      chip.dataset.seat = entry[0];
      // What the seat last recorded, and the kinds its entries carry. A seat's
      // ink mix is the window's own mix for every busy seat, so the chip carries
      // the seat's recency instead: a lit dot while its entries are arriving,
      // and the read-out in the title.
      const kindsHeld = [...(seatKinds.get(entry[0]) || new Map()).entries()]
        .sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : 1));
      const at = seatNewest.get(entry[0]);
      const newestAt = at !== undefined && events[at] ? events[at].at || "" : "";
      const newestMs = Date.parse(newestAt);
      const seatLive = Number.isFinite(newestMs) && (Date.now() - newestMs) < RIBBON_LIVE_MS;
      chip.title = entry[0] + ", " + ribbonCount(entry[1]) + " recorded entries in this window"
        + (kindsHeld.length
          ? " \u00b7 " + kindsHeld.slice(0, 3)
            .map((row) => row[0] + " " + ribbonCount(row[1])).join(", ")
          : "")
        + (newestAt ? " \u00b7 newest " + (ribbonAge(newestAt) || newestAt) : "")
        + " \u00b7 opens this agent's record";
      const value = document.createElement("span");
      value.className = "ribbon-chip-count";
      value.textContent = ribbonCount(entry[1]);
      chip.appendChild(value);
      const id = document.createElement("span");
      id.className = "ribbon-chip-id";
      id.textContent = ribbonShort(entry[0]);
      chip.appendChild(id);
      // The head's own live test, at the seat's scale: the mark the page already
      // uses for entries arriving.
      if (seatLive) {
        const lit = document.createElement("span");
        lit.className = "ribbon-chip-live";
        lit.setAttribute("aria-hidden", "true");
        chip.appendChild(lit);
      }
      // The spine navigates: a chip opens the seat through the shell when the
      // shell passes that callback, and otherwise moves the needle to the seat's
      // newest recorded entry.
      const opensSeat = typeof opts.onSelectActor === "function";
      if (String(opts.selectedId || "") === entry[0]) chip.setAttribute("aria-current", "true");
      chip.addEventListener("click", () => {
        if (opensSeat) opts.onSelectActor(entry[0]);
        else if (typeof opts.onSelectEvent === "function") opts.onSelectEvent(at);
      });
      seatRow.appendChild(chip);
    }
  }

  const actions = document.createElement("div");
  actions.className = "ribbon-actions";
  const now = document.createElement("button");
  now.type = "button";
  now.className = "ribbon-button";
  now.dataset.focus = "ribbon-now";
  now.textContent = position === 0 ? "At the newest change" : "Back to the newest change";
  now.disabled = position === 0;
  now.addEventListener("click", () => setPosition(0));
  actions.appendChild(now);

  const listOpen = ribbonListOpen.get(container) === true;
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "ribbon-button";
  toggle.dataset.focus = "ribbon-list";
  toggle.setAttribute("aria-expanded", listOpen ? "true" : "false");
  toggle.textContent = listOpen
    ? "Hide all changes"
    : "Show all changes (" + ribbonCount(total) + ")";
  toggle.addEventListener("click", () => {
    ribbonListOpen.set(container, !listOpen);
    if (typeof opts.onListOpen === "function") opts.onListOpen(!listOpen);
    renderRibbon(container, data, opts);
  });
  actions.appendChild(toggle);

  container.appendChild(head);
  container.appendChild(slider);
  container.appendChild(seatRow);
  container.appendChild(actions);

  if (listOpen) {
    const list = document.createElement("ol");
    list.className = "ribbon-list";
    const start = Math.max(0, position - Math.floor(RIBBON_LIST_ROWS / 2));
    const end = Math.min(total, start + RIBBON_LIST_ROWS);
    for (let index = start; index < end; index += 1) {
      const event = events[index] || {};
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ribbon-row";
      button.dataset.focus = "ribbon-row:" + index;
      if (index === position) button.setAttribute("aria-current", "true");
      const when = document.createElement("time");
      when.textContent = event.at || "time unrecorded";
      button.appendChild(when);
      const kind = document.createElement("span");
      kind.className = "ribbon-row-kind";
      kind.textContent = event.kind || "unknown";
      button.appendChild(kind);
      const who = document.createElement("span");
      who.className = "ribbon-row-who";
      who.textContent = ribbonShort(event.session || event.counterpart || "");
      button.appendChild(who);
      const far = document.createElement("span");
      far.className = "ribbon-row-far";
      far.textContent = event.counterpart ? "with " + ribbonShort(event.counterpart) : "";
      button.appendChild(far);
      button.addEventListener("click", () => {
        if (typeof opts.onSelectEvent === "function") opts.onSelectEvent(index);
      });
      item.appendChild(button);
      list.appendChild(item);
    }
    if (start > 0 || end < total) {
      const note = document.createElement("li");
      note.className = "ribbon-row-note";
      note.textContent = "Showing " + ribbonCount(start + 1) + " to " + ribbonCount(end)
        + " of " + ribbonCount(total) + ". Drag the axis to read another part.";
      list.appendChild(note);
    }
    container.appendChild(list);
  }

  if (focusKey) {
    const next = container.querySelector('[data-focus="' + ribbonEscape(focusKey) + '"]');
    if (next && typeof next.focus === "function") next.focus();
  }

  return { events: total, position };
}
