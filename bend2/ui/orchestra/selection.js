/* Selected actor, finding and complete message reads in the oversight document.
   Message read states and bodies come from the shell; buttons request reads. */

var SEL_EVENT_LIMIT = 8;
var selEventsOpen = false;
var selMsgOpen = new Set();
var selLast = null;

function selEl(tag, className, text) {
  var node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function selFacts(parent, facts) {
  var dl = selEl("dl", "doc-facts");
  facts.forEach(function (fact) {
    dl.appendChild(selEl("dt", null, fact[0]));
    var empty = fact[1] === "" || fact[1] === null || fact[1] === undefined;
    var dd = selEl("dd", empty ? "unknown" : null, empty ? "unknown" : fact[1]);
    dl.appendChild(dd);
  });
  parent.appendChild(dl);
}

function selEventAge(at) {
  if (window.OversightDocument && typeof window.OversightDocument.ageText === "function") {
    return window.OversightDocument.ageText(at);
  }
  return at || "";
}

function selBodyBlock(parent, heading, meta, body) {
  var block = selEl("div", null);
  if (heading) block.appendChild(selEl("p", null, heading));
  if (meta) block.appendChild(selEl("p", "muted", meta));
  if (typeof body === "string") block.appendChild(selEl("p", "sel-body", body));
  if (block.childNodes.length) parent.appendChild(block);
}

function selEventText(ev) {
  var parts = [selEventAge(ev.at) || ev.at || "time unrecorded"];
  if (ev.kind) parts.push(ev.kind);
  if (ev.kind === "receipt" && ev.counterpart) parts.push("message from " + ev.counterpart);
  if (ev.summary) parts.push(ev.summary);
  return parts.join(" · ");
}

function renderSelection(mount, data, options) {
  if (!mount) return;
  selLast = { mount: mount, data: data, options: options };
  var focused = mount.contains(document.activeElement)
    && document.activeElement.dataset
    ? document.activeElement.dataset.selkey || "" : "";
  mount.textContent = "";
  var input = data || {};
  var seat = input.seat || null;
  var finding = input.finding || null;
  var events = Array.isArray(input.events) ? input.events : [];
  if (!seat && !finding) {
    mount.appendChild(selEl("p", "muted", "Select a row to read its record here."));
    return;
  }
  if (seat) {
    var seatBlock = selEl("div", "sel-block");
    seatBlock.appendChild(selEl("h2", "doc-section", seat.id));
    selFacts(seatBlock, [
      ["role", seat.role],
      ["status", seat.status],
      ["action", seat.action],
      ["task", seat.taskTitle],
      ["model", seat.model],
      ["parent", seat.parent],
    ]);
    mount.appendChild(seatBlock);
  }
  if (finding) {
    var findingBlock = selEl("div", "sel-block");
    findingBlock.appendChild(selEl("h2", "doc-section", "Finding " + (finding.id || "")));
    selFacts(findingBlock, [
      ["claim", finding.claim],
      ["evidence", finding.evidence],
      ["limits", finding.limits],
      ["author", finding.author],
    ]);
    var steps = Array.isArray(finding.promotions) ? finding.promotions : [];
    if (steps.length) {
      findingBlock.appendChild(selEl("p", null, "Sharing path"));
      var path = selEl("ul", "sel-events");
      steps.forEach(function (step) {
        if (!step) return;
        path.appendChild(selEl("li", null,
          (step.source || "?") + " → " + (step.destination || "?")
          + (step.promotedBy ? " via " + step.promotedBy : "")));
      });
      findingBlock.appendChild(path);
    }
    mount.appendChild(findingBlock);
  }
  var stubs = seat && Array.isArray(seat.pending) ? seat.pending : [];
  var messages = input.messages || {};
  var pendingTotal = seat ? Number(seat.pendingCount || 0) : 0;
  if (pendingTotal > 0 || stubs.length) {
    var waiting = selEl("div", "sel-block");
    waiting.appendChild(selEl("h2", "doc-section", "Awaiting " + pendingTotal));
    if (stubs.length < pendingTotal) {
      waiting.appendChild(selEl("p", "muted", "Showing " + stubs.length
        + " messages included in this snapshot."));
    }
    stubs.forEach(function (stub) {
      if (!stub || !stub.id) return;
      var mid = stub.id;
      var read = messages[mid] || null;
      var message = read && read.state === "ok" ? read.message : null;
      var label = (stub.kind ? stub.kind + " " : "") + mid
        + (message && message.sender ? " from " + message.sender : "");
      var open = selMsgOpen.has(mid);
      var button = selEl("button", null, open ? "Hide " + label : "Read " + label);
      button.type = "button";
      button.dataset.selkey = "sel:msg:" + mid;
      button.setAttribute("aria-expanded", String(open));
      button.addEventListener("click", function () {
        if (selMsgOpen.has(mid)) {
          selMsgOpen.delete(mid);
        } else {
          selMsgOpen.add(mid);
        }
        renderSelection(selLast.mount, selLast.data, selLast.options);
        if (selMsgOpen.has(mid) && (!read || read.state !== "ok")
          && options && typeof options.onReadMessage === "function") {
          options.onReadMessage(mid);
        }
      });
      waiting.appendChild(button);
      if (!open) return;
      if (message && typeof message.body === "string") {
        waiting.appendChild(selEl("p", "sel-body", message.body));
        if (message.body === "") waiting.appendChild(selEl("p", "muted", "Stored body is empty."));
      } else {
        var status = read ? read.state : "unwired";
        var labels = {
          reading: "Reading message…",
          missing: "Message is not present in the store.",
          refused: "Message read refused.",
          unreadable: "Message read was invalid.",
          error: "Message read failed.",
          unwired: "Message reads require a live endpoint.",
        };
        var cause = read && (read.reason || read.status);
        waiting.appendChild(selEl("p", "muted", (labels[status] || "Message body unavailable.")
          + (cause ? " " + cause : "")));
      }
    });
    mount.appendChild(waiting);
  }
  if (seat && seat.work) {
    var w = seat.work;
    var work = selEl("div", "sel-block");
    work.appendChild(selEl("h2", "doc-section", "Work"));
    if (w.refused) {
      work.appendChild(selEl("p", "muted",
        "Work for this actor is outside the bound reader's scope."));
    } else if (w.error) {
      work.appendChild(selEl("p", "muted", "Work unavailable: " + w.error));
    } else {
      if (w.task) {
        selBodyBlock(work, w.task.title ? "Task: " + w.task.title : "Task",
          w.task.status || "", w.task.description || "");
      }
      if (w.input) {
        selBodyBlock(work, "Exact current input",
          [w.input.kind, w.input.sender ? "from " + w.input.sender : "", w.input.id]
            .filter(Boolean).join(" · "),
          w.input.body || "");
      }
      if (w.request) {
        selBodyBlock(work, "Open request",
          [w.request.method, w.request.event, w.request.id].filter(Boolean).join(" · "),
          w.request.reply || "");
      }
      if (w.report) {
        selBodyBlock(work, "Latest report",
          [w.report.recipient ? "to " + w.report.recipient : "", w.report.id]
            .filter(Boolean).join(" · "),
          w.report.body || "");
      }
    }
    mount.appendChild(work);
  }
  if (seat) {
    var mine = events.filter(function (ev) {
      return ev && ev.session === seat.id;
    });
    if (mine.length) {
      var eventsBlock = selEl("div", "sel-block");
      eventsBlock.appendChild(selEl("h2", "doc-section", "Changes"));
      var ul = selEl("ul", "sel-events");
      var listed = selEventsOpen ? mine : mine.slice(0, SEL_EVENT_LIMIT);
      listed.forEach(function (ev) {
        ul.appendChild(selEl("li", "mono", selEventText(ev)));
      });
      eventsBlock.appendChild(ul);
      if (selEventsOpen || listed.length < mine.length) {
        var more = selEl("button", null,
          selEventsOpen ? "Show fewer" : "Show all " + mine.length + " changes");
        more.type = "button";
        more.dataset.selkey = "sel:events";
        more.addEventListener("click", function () {
          selEventsOpen = !selEventsOpen;
          renderSelection(selLast.mount, selLast.data, selLast.options);
        });
        eventsBlock.appendChild(more);
      }
      mount.appendChild(eventsBlock);
    } else {
      var none = selEl("div", "sel-block");
      none.appendChild(selEl("h2", "doc-section", "Changes"));
      none.appendChild(selEl("p", "muted", "No recorded changes."));
      mount.appendChild(none);
    }
  }
  if (focused) {
    var next = mount.querySelector("[data-selkey=\"" + CSS.escape(focused) + "\"]");
    if (next && typeof next.focus === "function") next.focus();
  }
}

window.renderSelection = renderSelection;
