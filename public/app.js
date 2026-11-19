"use strict";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const SECTION = {
  all: { name: "Everything", sub: "Embraced:Fully and Quick Lift Cards LLC together. A colored edge and tag show which section each task belongs to." },
  ef: { name: "Embraced:Fully", short: "E:F", sub: "Embraced:Fully projects and tasks." },
  qlc: { name: "Quick Lift Cards LLC", short: "QLC", sub: "Quick Lift Cards LLC projects and tasks." },
};
const STATUS = { todo: "To do", progress: "In progress", done: "Done" };
const OWNER = { babs: "Babs", david: "David", both: "Babs + David", none: "Not decided" };
const NEXT = { todo: "progress", progress: "done", done: "todo" };
const RANK = { progress: 0, todo: 1, done: 2 };
const PALETTE = 8;

let me = null, tasks = [], projects = [], loaded = false;
let ws = "all", view = "list", who = "all", pFilter = "all", listGroup = "project";
let doneOpen = false, showDoneGantt = false, zoom = "weeks", editId = null, dOwner = "none", dStatus = "todo", wantScroll = true;

/* ---------- talking to the server ---------- */
async function api(method, url, body) {
  const r = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  if (r.status === 401) { showGate(); throw { code: "auth" }; }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw { code: j.code || "error", message: j.error || "That did not save." };
  return j;
}
function showGate() { $("app").hidden = true; $("gate").hidden = false; }
async function load() {
  try {
    const d = await api("GET", "/api/data");
    me = d.me; tasks = d.tasks; projects = d.projects; loaded = true;
    $("meName").textContent = OWNER[me] || me;
    render();
  } catch (e) {
    if (e.code !== "auth" && !loaded) $("main").innerHTML = `<div class="card"><div class="empty">The list could not load. Refresh the page to try again.</div></div>`;
  }
}
function toast(msg) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), 3500); }
function failWrite(e) { if (e && e.code === "auth") return; toast((e && e.message) || "That did not save. Check your connection and try again."); }
const replaceTask = (row) => { const i = tasks.findIndex((t) => t.id === row.id); if (i >= 0) tasks[i] = row; else tasks.push(row); };

/* ---------- dates ---------- */
const DAY = 864e5;
const midnight = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
let today = midnight();
const pd = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s || "") ? new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) : null);
const iso = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const fmt = (d) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
const diff = (a, b) => Math.round((b - a) / DAY);
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
function dueState(t) {
  if (t.status === "done") return "";
  const d = pd(t.due); if (!d) return "";
  const n = diff(today, d); return n < 0 ? "late" : n <= 7 ? "soon" : "";
}
function whenText(t) {
  const s = pd(t.start), d = pd(t.due);
  if (s && d) return fmt(s) + " → " + fmt(d);
  if (d) return "Due " + fmt(d);
  if (s) return "Starts " + fmt(s);
  return "No dates yet";
}
const sortKey = (t) => t.due || t.start || "9999-99-99";
const byDate = (a, b) => sortKey(a).localeCompare(sortKey(b)) || (a.name || "").localeCompare(b.name || "");
const byStatusDate = (a, b) => RANK[a.status] - RANK[b.status] || byDate(a, b);

/* ---------- sections and projects ---------- */
const wsColor = (w) => (w === "qlc" ? "var(--qlc)" : "var(--ef)");
const wsChip = (t) => (ws === "all" ? `<span class="wchip" style="--wsc:${wsColor(t.workspace)}">${SECTION[t.workspace].short}</span>` : "");
const projById = (id) => (id && projects.find((p) => p.id === id)) || null;
const sortedProjects = (w = ws) => projects.filter((p) => w === "all" || p.workspace === w).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
const pcolor = (p) => "var(--p" + (((p && p.color) || 0) % PALETTE) + ")";
function chip(t) { const p = projById(t.projectId); return p ? `<span class="pchip"><i style="background:${pcolor(p)}"></i>${esc(p.name)}</span>` : ""; }
function nextColor(w) {
  const used = new Array(PALETTE).fill(0); projects.filter((p) => p.workspace === w).forEach((p) => { used[(p.color || 0) % PALETTE]++; });
  return used.indexOf(Math.min(...used));
}
async function findOrCreateProject(name, w) {
  const ex = projects.find((p) => p.workspace === w && (p.name || "").toLowerCase() === name.toLowerCase());
  if (ex) return ex.id;
  const row = await api("POST", "/api/projects", { workspace: w, name, color: nextColor(w) });
  projects.push(row);
  return row.id;
}
// Groups of tasks by project, in section order. Used by the List (by project) and the Gantt.
function groupsFor(list, includeEmpty) {
  const out = [];
  (ws === "all" ? ["ef", "qlc"] : [ws]).forEach((w) => {
    sortedProjects(w).forEach((p) => {
      const ts = list.filter((t) => t.projectId === p.id);
      if (ts.length || includeEmpty) out.push({ ws: w, p, tasks: ts });
    });
    const none = list.filter((t) => t.workspace === w && !projById(t.projectId));
    if (none.length) out.push({ ws: w, p: null, tasks: none });
  });
  return out;
}
const gLabel = (g) => (ws === "all" ? SECTION[g.ws].short + " · " : "") + (g.p ? g.p.name : "No project");
const gColor = (g) => (g.p ? pcolor(g.p) : "var(--muted)");

function visible() {
  return tasks.filter((t) =>
    (ws === "all" || t.workspace === ws) &&
    (who === "all" || t.owner === who || t.owner === "both") &&
    (ws === "all" || pFilter === "all" || (pFilter === "none" ? !projById(t.projectId) : t.projectId === pFilter)));
}

/* ---------- actions ---------- */
async function setStatus(id, status) {
  const t = tasks.find((x) => x.id === id); if (!t || t.status === status) return;
  const before = { status: t.status, doneAt: t.doneAt };
  t.status = status; t.doneAt = status === "done" ? iso(today) : null; render();
  try { replaceTask(await api("PATCH", "/api/tasks?id=" + id, { status })); render(); }
  catch (e) { Object.assign(t, before); render(); failWrite(e); }
}

/* ---------- render ---------- */
function renderChrome() {
  document.body.dataset.ws = ws;
  document.title = SECTION[ws].name + " · Task Tracker";
  $("h1").textContent = SECTION[ws].name;
  $("subline").textContent = SECTION[ws].sub;
  document.querySelectorAll("[data-nav]").forEach((b) => b.setAttribute("aria-current", String(b.dataset.nav === ws) === "true" ? "page" : "false"));
  document.querySelectorAll("[data-view]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.view === view)));
  document.querySelectorAll("[data-who]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.who === who)));
  const open = (w) => tasks.filter((t) => t.status !== "done" && (w === "all" || t.workspace === w)).length;
  ["all", "ef", "qlc"].forEach((w) => { $("cnt-" + w).textContent = loaded ? open(w) : ""; });
  $("projBtn").hidden = ws === "all";
}
function renderFilter() {
  const pb = $("pbar"); pb.hidden = ws === "all";
  if (ws !== "all") {
    if (pFilter !== "all" && pFilter !== "none" && !projById(pFilter)) pFilter = "all";
    const count = (id) => tasks.filter((t) => t.workspace === ws && (id === "none" ? !projById(t.projectId) : t.projectId === id)).length;
    const chips = [`<button type="button" class="pbtn" data-proj="all" aria-pressed="${pFilter === "all"}">All projects</button>`,
      ...sortedProjects().map((p) => `<button type="button" class="pbtn" data-proj="${esc(p.id)}" aria-pressed="${pFilter === p.id}"><i style="background:${pcolor(p)}"></i>${esc(p.name)} <span class="c">${count(p.id)}</span></button>`)];
    if (count("none") || pFilter === "none") chips.push(`<button type="button" class="pbtn" data-proj="none" aria-pressed="${pFilter === "none"}"><i style="background:var(--muted)"></i>No project <span class="c">${count("none")}</span></button>`);
    chips.push(`<button type="button" class="pbtn pnew" id="pNewBtn">+ New project</button>`);
    pb.innerHTML = chips.join("");
  }
  fillQuick();
}
const qWorkspace = () => (ws !== "all" ? ws : $("qWs").value);
function fillQuick() {
  $("qWsLabel").hidden = ws !== "all";
  const w = qWorkspace(), qp = $("qProject"), cur = qp.value;
  qp.innerHTML = `<option value="">No project</option>` + (w ? sortedProjects(w).map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("") : "");
  qp.value = [...qp.options].some((o) => o.value === cur) ? cur : "";
}
function renderSummary() {
  const v = visible(), c = (k) => v.filter((t) => t.status === k).length, late = v.filter((t) => dueState(t) === "late").length;
  $("summary").innerHTML = [[c("progress") + " in progress", "var(--mint)"], [c("todo") + " to do", "var(--lav)"], [late + " overdue", "var(--coral)"], [c("done") + " done", "var(--muted)"]]
    .map(([t, col]) => `<span class="pill"><span class="dot" style="background:${col}"></span>${t}</span>`).join("");
}
const ownerText = (t) => (t.owner === "none" || !t.owner ? `<span class="own none">Not decided</span>` : `<span class="own">${OWNER[t.owner]}</span>`);
const tickBtn = (t) => `<button class="tick ${t.status}" type="button" data-cycle="${t.id}" aria-label="${esc(t.name)}: ${STATUS[t.status]}. Press to change." title="${STATUS[t.status]}. Click to change.">${t.status === "done" ? "✓" : ""}</button>`;
function rowHTML(t, showProj) {
  const st = dueState(t);
  return `<div class="row ${t.status}" style="--wsc:${wsColor(t.workspace)}">${tickBtn(t)}<div class="nm"><button class="name" type="button" data-open="${t.id}">${esc(t.name)}</button>${wsChip(t)}${showProj ? chip(t) : ""}</div>${ownerText(t)}<span class="when ${st || (pd(t.start) || pd(t.due) ? "" : "none")}">${whenText(t)}${st === "late" ? '<span class="chip late">Overdue</span>' : ""}</span></div>`;
}

function renderList() {
  const v = visible();
  const head = `<div class="opts"><span>Group by</span><div class="seg" role="group" aria-label="Group by"><button type="button" data-group="status" aria-pressed="${listGroup === "status"}">Status</button><button type="button" data-group="project" aria-pressed="${listGroup === "project"}">Project</button></div></div>`;
  const anyProjects = ws === "all" ? projects.length > 0 : sortedProjects().length > 0;
  if (!tasks.length && !(listGroup === "project" && projects.length)) return `<div class="card"><div class="empty">No tasks yet. Type one in the box above and press Add task.</div></div>`;
  if (listGroup === "project") {
    const showEmpty = who === "all" && pFilter === "all" && ws !== "all";
    const groups = groupsFor(v, showEmpty);
    const hint = anyProjects ? "" : `<div class="card" style="margin-bottom:16px"><div class="empty small">No projects yet. ${ws === "all" ? "Open Embraced:Fully or Quick Lift Cards LLC to add one." : "Press <b>+ New project</b> above to add one."}</div></div>`;
    if (!groups.length) return head + hint + `<div class="card"><div class="empty">No tasks to show.</div></div>`;
    return head + hint + groups.map((g) => {
      const rows = g.tasks.slice().sort(byStatusDate), done = rows.filter((t) => t.status === "done").length;
      const wsDot = ws === "all" ? `<span class="wchip" style="--wsc:${wsColor(g.ws)}">${SECTION[g.ws].short}</span>` : "";
      return `<section class="card" style="margin-bottom:16px"><div class="ghd proj"><span class="pdot" style="background:${gColor(g)}"></span>${wsDot}${g.p ? esc(g.p.name) : "No project"} <span class="of">${done} of ${rows.length} done</span></div>${rows.length ? rows.map((t) => rowHTML(t, false)).join("") : `<div class="empty small">No tasks in this project yet.</div>`}</section>`;
    }).join("");
  }
  if (!v.length) return head + `<div class="card"><div class="empty">No tasks match this filter.</div></div>`;
  return head + ["progress", "todo", "done"].map((k) => {
    const rows = v.filter((t) => t.status === k).sort(byDate);
    if (k === "done" && !rows.length) return "";
    const collapsed = k === "done" && !doneOpen;
    const body = collapsed ? "" : rows.length ? rows.map((t) => rowHTML(t, true)).join("") : `<div class="empty">Nothing here.</div>`;
    return `<section class="card" style="margin-bottom:16px"><div class="ghd">${STATUS[k]} <span class="n">${rows.length}</span>${k === "done" ? `<button class="tg" type="button" data-toggle-done="1">${doneOpen ? "Hide" : "Show"}</button>` : ""}</div>${body}</section>`;
  }).join("");
}

function renderBoard() {
  const v = visible();
  return `<div class="board">` + ["todo", "progress", "done"].map((k) => {
    const cards = v.filter((t) => t.status === k).sort(byDate).map((t) => {
      const st = dueState(t), hasDate = pd(t.start) || pd(t.due);
      return `<div class="tc ${t.status}" draggable="true" data-id="${t.id}" style="--wsc:${wsColor(t.workspace)}">${tickBtn(t)}<div><button class="name" type="button" data-open="${t.id}">${esc(t.name)}</button></div><div class="meta">${wsChip(t)}${chip(t)}<span>${t.owner && t.owner !== "none" ? OWNER[t.owner] : "Not decided"}</span>${hasDate ? `<span class="${st}">${whenText(t)}${st === "late" ? " · Overdue" : ""}</span>` : ""}</div></div>`;
    }).join("");
    return `<div class="col" data-col="${k}"><h3>${STATUS[k]} <span class="n">${v.filter((t) => t.status === k).length}</span></h3>${cards}</div>`;
  }).join("") + `</div>`;
}

function renderGantt() {
  const v = visible().filter((t) => showDoneGantt || t.status !== "done");
  const first = (t) => pd(t.start) || pd(t.due);
  const dated = v.filter((t) => first(t)).sort((a, b) => first(a) - first(b) || (a.name || "").localeCompare(b.name || ""));
  const undated = v.filter((t) => !first(t));
  const px = zoom === "weeks" ? 22 : 7;
  let min = addDays(today, -7), max = addDays(today, 56);
  dated.forEach((t) => [pd(t.start), pd(t.due)].forEach((d) => { if (d) { if (d < min) min = d; if (d > max) max = d; } }));
  const dow = (min.getDay() + 6) % 7; // weeks start on Monday
  const rs = addDays(min, -dow), re = addDays(max, 14);
  const days = Math.min(diff(rs, re) + 1, 1100), W = days * px;
  let months = "", weeks = "";
  for (let i = 0; i < days; i++) {
    const d = addDays(rs, i);
    if (d.getDate() === 1 || i === 0) months += `<div class="gmonth" style="left:${i * px}px">${d.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</div>`;
    if (px >= 14 && d.getDay() === 1) weeks += `<div class="gweek" style="left:${i * px}px">${fmt(d)}</div>`;
  }
  const todayMark = `<div class="gtoday" style="left:${diff(rs, today) * px + px / 2 - 1}px"></div>`;
  const track = (inner) => `<div class="gtrack" style="width:${W}px;background-size:${7 * px}px 100%">${todayMark}${inner}</div>`;
  const rowFor = (t) => {
    const s = pd(t.start), d = pd(t.due), late = dueState(t) === "late" ? " late" : "";
    const cls = t.status + late, tip = esc(t.name) + " · " + whenText(t);
    let mark;
    if (s && d) {
      const left = diff(rs, s) * px, w = Math.max((diff(s, d) + 1) * px, 14);
      const lab = w >= 70 ? (t.owner === "both" ? "B + D" : t.owner === "babs" ? "Babs" : t.owner === "david" ? "David" : "") : "";
      mark = `<button class="gbar ${cls}" type="button" data-open="${t.id}" style="left:${left}px;width:${w}px" title="${tip}">${lab}</button>`;
    } else {
      const at = d || s, left = diff(rs, at) * px + px / 2;
      mark = `<button class="gms ${cls}" type="button" data-open="${t.id}" style="left:${left}px" title="${tip}" aria-label="${tip}"></button>`;
    }
    const sec = ws === "all" ? `<span class="wchip" style="--wsc:${wsColor(t.workspace)}">${SECTION[t.workspace].short}</span> ` : "";
    return `<div class="grow ${t.status}"><button class="gname" type="button" data-open="${t.id}">${esc(t.name)}<small>${sec}${t.owner && t.owner !== "none" ? OWNER[t.owner] : "Not decided"} · ${whenText(t)}</small></button>${track(mark)}</div>`;
  };
  const headRow = (g) => {
    const list = g.tasks;
    const lab = `<div class="gname"><span class="pdot" style="background:${gColor(g)}"></span>${esc(gLabel(g))}<small>${list.length ? list.length + " task" + (list.length > 1 ? "s" : "") : "No dated tasks yet"}</small></div>`;
    if (!list.length) return `<div class="grow gh">${lab}${track("")}</div>`;
    const starts = list.map((t) => pd(t.start) || pd(t.due)), ends = list.map((t) => pd(t.due) || pd(t.start));
    const s = new Date(Math.min(...starts)), e = new Date(Math.max(...ends));
    return `<div class="grow gh">${lab}${track(`<div class="gspan" style="left:${diff(rs, s) * px}px;width:${Math.max((diff(s, e) + 1) * px, 14)}px;background:${gColor(g)}"></div>`)}</div>`;
  };
  const anyProjects = ws === "all" ? projects.length > 0 : sortedProjects().length > 0;
  let rows = "";
  if (anyProjects) groupsFor(dated, who === "all" && pFilter === "all" && ws !== "all").forEach((g) => { rows += headRow(g) + g.tasks.map(rowFor).join(""); });
  else rows = dated.map(rowFor).join("");
  const note = undated.length ? `<div class="gnote"><b>${undated.length} task${undated.length > 1 ? "s" : ""} without dates</b> are not on the chart yet. Open one and add a start or due date: ${undated.slice(0, 6).map((t) => `<a href="#" data-open="${t.id}">${esc(t.name)}</a>`).join(", ")}${undated.length > 6 ? `, and ${undated.length - 6} more (see the List tab)` : ""}.</div>` : "";
  const top = `<div class="opts"><div class="seg" role="group" aria-label="Zoom"><button type="button" data-zoom="weeks" aria-pressed="${zoom === "weeks"}">Weeks</button><button type="button" data-zoom="months" aria-pressed="${zoom === "months"}">Months</button></div><label><input type="checkbox" id="gDone" ${showDoneGantt ? "checked" : ""}> Show finished tasks</label></div>`;
  const chart = rows ? `<div class="gwrap" id="gwrap"><div class="ginner" style="width:${230 + W}px"><div class="ghead"><div class="gcorner">Task</div><div class="gscale" style="width:${W}px">${months}${weeks}</div></div>${rows}</div></div>` : `<div class="card"><div class="empty">No dated tasks to chart yet. Open a task and give it a start or due date.</div></div>`;
  const legend = `<div class="legend"><span><i style="background:var(--lav)"></i>To do</span><span><i style="background:var(--mint)"></i>In progress</span><span><i style="background:var(--coral)"></i>Overdue</span><span><i style="background:var(--muted);opacity:.55"></i>Done</span><span><i style="background:var(--coral);width:3px;border-radius:0"></i>Today</span><span>Diamond = a task with only one date</span></div>`;
  return top + chart + note + legend;
}

function render() {
  today = midnight();
  renderChrome(); renderFilter(); renderSummary();
  if (!$("pscrim").hidden) renderProjects();
  if (!loaded) return;
  const gw = $("gwrap"), keep = gw ? gw.scrollLeft : 0, keepTop = gw ? gw.scrollTop : 0;
  const m = $("main");
  m.className = ws === "all" ? "wsmark" : "";
  m.innerHTML = view === "board" ? renderBoard() : view === "gantt" ? renderGantt() : renderList();
  const g = $("gwrap");
  if (g) { if (wantScroll) { g.scrollLeft = Math.max(0, diff(addDays(today, -7), today) * (zoom === "weeks" ? 22 : 7) - 40); wantScroll = false; } else { g.scrollLeft = keep; g.scrollTop = keepTop; } }
}

/* ---------- navigation ---------- */
function applyHash() {
  const [a, b] = location.hash.slice(1).split("/");
  const nws = ["all", "ef", "qlc"].includes(a) ? a : "all", nv = ["list", "board", "gantt"].includes(b) ? b : "list";
  if (nws !== ws) { ws = nws; pFilter = "all"; $("qWs").value = ""; }
  if (nv !== view) { view = nv; wantScroll = true; }
  render();
}
const go = (nws, nv) => { location.hash = (nws || ws) + "/" + (nv || view); };
document.querySelectorAll("[data-nav]").forEach((b) => b.addEventListener("click", () => go(b.dataset.nav, view)));
document.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => go(ws, b.dataset.view)));
addEventListener("hashchange", applyHash);
document.querySelectorAll("[data-who]").forEach((b) => b.addEventListener("click", () => { who = b.dataset.who; render(); $("qOwner").value = who === "babs" || who === "david" ? who : "none"; }));
$("pbar").addEventListener("click", (e) => {
  if (e.target.closest("#pNewBtn")) { openProjects(); return; }
  const b = e.target.closest("[data-proj]"); if (b) { pFilter = b.dataset.proj; render(); $("qProject").value = projById(pFilter) ? pFilter : ""; }
});
$("signOut").addEventListener("click", async () => { try { await api("POST", "/api/signout"); } catch (_) {} location.reload(); });

$("main").addEventListener("click", (e) => {
  const c = e.target.closest("[data-cycle]");
  if (c) { e.preventDefault(); setStatus(c.dataset.cycle, NEXT[tasks.find((t) => t.id === c.dataset.cycle)?.status || "todo"]); return; }
  const o = e.target.closest("[data-open]"); if (o) { e.preventDefault(); openTask(o.dataset.open); return; }
  if (e.target.closest("[data-toggle-done]")) { doneOpen = !doneOpen; render(); return; }
  const z = e.target.closest("[data-zoom]"); if (z) { zoom = z.dataset.zoom; wantScroll = true; render(); return; }
  const g = e.target.closest("[data-group]"); if (g) { listGroup = g.dataset.group; render(); return; }
});
$("main").addEventListener("change", (e) => { if (e.target.id === "gDone") { showDoneGantt = e.target.checked; render(); } });

/* board drag and drop */
let dragId = null;
$("main").addEventListener("dragstart", (e) => { const c = e.target.closest(".tc"); if (!c) return; dragId = c.dataset.id; c.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", dragId); } catch (_) {} });
$("main").addEventListener("dragend", () => { dragId = null; document.querySelectorAll(".dragging,.over").forEach((n) => n.classList.remove("dragging", "over")); });
$("main").addEventListener("dragover", (e) => { const c = e.target.closest(".col"); if (c && dragId) { e.preventDefault(); document.querySelectorAll(".col.over").forEach((n) => n !== c && n.classList.remove("over")); c.classList.add("over"); } });
$("main").addEventListener("drop", (e) => { const c = e.target.closest(".col"); if (c && dragId) { e.preventDefault(); setStatus(dragId, c.dataset.col); } dragId = null; });

/* ---------- quick add ---------- */
$("qWs").addEventListener("change", () => { $("qProject").value = ""; fillQuick(); });
$("quick").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("quickName").value.trim(); if (!name) return;
  const w = qWorkspace(); if (!w) { toast("Choose a section first: Embraced:Fully or Quick Lift Cards LLC."); return; }
  const start = $("qStart").value, due = $("qDue").value;
  if (start && due && due < start) { toast("The deadline is before the start date. Change one of them."); return; }
  try {
    const row = await api("POST", "/api/tasks", { workspace: w, name, projectId: $("qProject").value, owner: $("qOwner").value, start, due });
    tasks.push(row); render();
    $("quickName").value = ""; $("qStart").value = ""; $("qDue").value = ""; $("quickName").focus();
    toast("Added: " + name);
  } catch (err) { failWrite(err); }
});

/* ---------- task dialog ---------- */
function setSeg(id, val) { document.querySelectorAll("#" + id + " button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === val))); }
$("dOwner").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { dOwner = b.dataset.v; setSeg("dOwner", dOwner); } });
$("dStatus").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { dStatus = b.dataset.v; setSeg("dStatus", dStatus); } });
function fillDProject(w, selected) {
  $("dProject").innerHTML = `<option value="">No project</option>` + (w ? sortedProjects(w).map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("") : "");
  $("dProject").value = selected && projById(selected) ? selected : "";
}
$("dWs").addEventListener("change", () => fillDProject($("dWs").value, ""));
let lastFocus = null, delArmed = false;
function openTask(id) {
  lastFocus = document.activeElement;
  const t = id ? tasks.find((x) => x.id === id) : null;
  editId = t ? t.id : null;
  const w = t ? t.workspace : ws !== "all" ? ws : "";
  $("dTitle").textContent = t ? "Edit task" : "New task";
  $("dName").value = t?.name || ""; $("dStart").value = t?.start || ""; $("dDue").value = t?.due || ""; $("dNotes").value = t?.notes || "";
  $("dWsField").hidden = ws !== "all"; $("dWs").value = w; $("dWs").disabled = !!t;
  fillDProject(w, t ? t.projectId : projById(pFilter) ? pFilter : "");
  $("dNewProject").value = "";
  dOwner = t?.owner || (who === "babs" || who === "david" ? who : "none"); dStatus = t?.status || "todo";
  setSeg("dOwner", dOwner); setSeg("dStatus", dStatus);
  $("dErr").hidden = true; delArmed = false; $("dDel").textContent = "Delete"; $("dDel").hidden = !t;
  $("scrim").hidden = false; $("dName").focus();
}
function closeTask() { $("scrim").hidden = true; editId = null; if (lastFocus && lastFocus.focus) try { lastFocus.focus(); } catch (_) {} }
$("addBtn").addEventListener("click", () => openTask(null));
$("dCancel").addEventListener("click", closeTask);
$("scrim").addEventListener("mousedown", (e) => { if (e.target === $("scrim")) closeTask(); });
$("dlg").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("dName").value.trim(), start = $("dStart").value, due = $("dDue").value, newProj = $("dNewProject").value.trim();
  const err = (m) => { $("dErr").textContent = m; $("dErr").hidden = false; };
  if (!name) return err("Give the task a name.");
  const prev = editId ? tasks.find((x) => x.id === editId) : null;
  const w = prev ? prev.workspace : ws !== "all" ? ws : $("dWs").value;
  if (!w) return err("Choose a section: Embraced:Fully or Quick Lift Cards LLC.");
  if (start && due && due < start) return err("The deadline is before the start date. Change one of them.");
  try {
    const projectId = newProj ? await findOrCreateProject(newProj, w) : $("dProject").value;
    const data = { name, projectId, owner: dOwner, status: dStatus, start, due, notes: $("dNotes").value };
    if (editId) replaceTask(await api("PATCH", "/api/tasks?id=" + editId, data));
    else tasks.push(await api("POST", "/api/tasks", { ...data, workspace: w }));
    closeTask(); render();
  } catch (e2) { if (e2 && e2.message && e2.code !== "auth") err(e2.message); else failWrite(e2); }
});
$("dDel").addEventListener("click", async () => {
  if (!delArmed) { delArmed = true; $("dDel").textContent = "Click again to delete for good"; return; }
  try { await api("DELETE", "/api/tasks?id=" + editId); tasks = tasks.filter((t) => t.id !== editId); closeTask(); render(); } catch (e) { failWrite(e); }
});

/* ---------- projects dialog ---------- */
let pDelArmed = null;
function renderProjects() {
  const list = $("pList");
  if (list.contains(document.activeElement) && document.activeElement.tagName === "INPUT") return;
  $("pTitle").textContent = "Projects · " + SECTION[ws].name;
  const ps = sortedProjects();
  list.innerHTML = ps.length ? ps.map((p) => {
    const n = tasks.filter((t) => t.projectId === p.id).length;
    return `<div class="prow"><span class="pdot" style="background:${pcolor(p)}"></span><input type="text" value="${esc(p.name)}" maxlength="100" data-rename="${esc(p.id)}" aria-label="Project name"><span class="pc">${n} task${n === 1 ? "" : "s"}</span><button class="btn ghost small" type="button" data-pdel="${esc(p.id)}">${pDelArmed === p.id ? "Click again to delete" : "Delete"}</button></div>`;
  }).join("") : `<p class="hint">No projects yet. Type a name above and press Add project.</p>`;
}
function openProjects() { if (ws === "all") return; lastFocus = document.activeElement; pDelArmed = null; $("pErr").hidden = true; $("pNew").value = ""; $("pscrim").hidden = false; renderProjects(); $("pNew").focus(); }
function closeProjects() { $("pscrim").hidden = true; if (lastFocus && lastFocus.focus) try { lastFocus.focus(); } catch (_) {} render(); }
$("projBtn").addEventListener("click", openProjects);
$("pClose").addEventListener("click", closeProjects);
$("pscrim").addEventListener("mousedown", (e) => { if (e.target === $("pscrim")) closeProjects(); });
const pError = (m) => { $("pErr").textContent = m; $("pErr").hidden = false; };
$("pAdd").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("pNew").value.trim(); if (!name) return;
  if (projects.some((p) => p.workspace === ws && (p.name || "").toLowerCase() === name.toLowerCase())) return pError("A project with that name already exists.");
  $("pErr").hidden = true;
  try { projects.push(await api("POST", "/api/projects", { workspace: ws, name, color: nextColor(ws) })); $("pNew").value = ""; render(); } catch (err) { failWrite(err); }
});
$("pList").addEventListener("change", async (e) => {
  const id = e.target.dataset && e.target.dataset.rename; if (!id) return;
  const name = e.target.value.trim(), p = projById(id);
  if (!name || !p) { e.target.value = p ? p.name : ""; return; }
  if (projects.some((x) => x.id !== id && x.workspace === p.workspace && (x.name || "").toLowerCase() === name.toLowerCase())) { pError("A project with that name already exists."); e.target.value = p.name; return; }
  $("pErr").hidden = true;
  try { const row = await api("PATCH", "/api/projects?id=" + id, { name }); Object.assign(p, row); render(); } catch (err) { failWrite(err); }
});
$("pList").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-pdel]"); if (!b) return;
  const id = b.dataset.pdel;
  if (pDelArmed !== id) { pDelArmed = id; renderProjects(); return; }
  pDelArmed = null;
  try {
    await api("DELETE", "/api/projects?id=" + id);
    projects = projects.filter((p) => p.id !== id); tasks.forEach((t) => { if (t.projectId === id) t.projectId = null; });
    if (pFilter === id) pFilter = "all";
  } catch (err) { failWrite(err); }
  render();
});

addEventListener("keydown", (e) => { if (e.key === "Escape") { if (!$("scrim").hidden) closeTask(); else if (!$("pscrim").hidden) closeProjects(); } });

/* ---------- start ---------- */
applyHash();
load();
setInterval(() => { if (!document.hidden && !dragId && $("scrim").hidden && $("pscrim").hidden && document.activeElement.tagName !== "INPUT") load(); }, 20000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
