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

let me = null, tasks = [], projects = [], attachments = [], loaded = false, presence = {}, presenceAt = Date.now();
let page = "tasks", ws = "all", view = "list", who = "all", pFilter = "all", listGroup = "project";
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
    presence = d.presence || presence; presenceAt = Date.now();
    attachments = d.attachments || [];
    $("app").hidden = false;
    $("meName").textContent = OWNER[me] || me;
    render();
  } catch (e) {
    if (e.code !== "auth" && !loaded) { $("app").hidden = false; $("main").innerHTML = `<div class="card"><div class="empty">The list could not load. Refresh the page to try again.</div></div>`; }
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
  const docs = page === "docs";
  document.body.dataset.ws = docs ? "all" : ws;
  document.title = (docs ? "Documents" : SECTION[ws].name) + " · Task Tracker";
  $("h1").textContent = docs ? "Documents" : SECTION[ws].name;
  $("subline").textContent = docs ? "Every document attached to a task or project, in one place. Search by file name, project, task or person." : SECTION[ws].sub;
  $("tasksPage").hidden = docs; $("docsPage").hidden = !docs; $("addBtn").hidden = docs;
  document.querySelectorAll("[data-nav]").forEach((b) => b.setAttribute("aria-current", (docs ? b.dataset.nav === "docs" : b.dataset.nav === ws) ? "page" : "false"));
  document.querySelectorAll("[data-view]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.view === view)));
  document.querySelectorAll("[data-who]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.who === who)));
  const open = (w) => tasks.filter((t) => t.status !== "done" && (w === "all" || t.workspace === w)).length;
  ["all", "ef", "qlc"].forEach((w) => { $("cnt-" + w).textContent = loaded ? open(w) : ""; });
  $("cnt-docs").textContent = loaded ? attachments.length : "";
  $("projBtn").hidden = docs || ws === "all";
  renderPresence();
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
  return `<div class="row ${t.status}" style="--wsc:${wsColor(t.workspace)}">${tickBtn(t)}<div class="nm"><button class="name" type="button" data-open="${t.id}">${esc(t.name)}</button>${wsChip(t)}${showProj ? chip(t) : ""}${clipChip(t.id)}</div>${ownerText(t)}<span class="when ${st || (pd(t.start) || pd(t.due) ? "" : "none")}">${whenText(t)}${st === "late" ? '<span class="chip late">Overdue</span>' : ""}</span></div>`;
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
      return `<section class="card" style="margin-bottom:16px"><div class="ghd proj"><span class="pdot" style="background:${gColor(g)}"></span>${wsDot}${g.p ? esc(g.p.name) : "No project"} <span class="of">${done} of ${rows.length} done</span>${g.p ? `<button class="tg" type="button" data-docs="${esc(g.p.id)}">Documents (${docsForProject(g.p.id)})</button>` : ""}</div>${rows.length ? rows.map((t) => rowHTML(t, false)).join("") : `<div class="empty small">No tasks in this project yet.</div>`}</section>`;
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
      return `<div class="tc ${t.status}" draggable="true" data-id="${t.id}" style="--wsc:${wsColor(t.workspace)}">${tickBtn(t)}<div><button class="name" type="button" data-open="${t.id}">${esc(t.name)}</button></div><div class="meta">${wsChip(t)}${chip(t)}${clipChip(t.id)}<span>${t.owner && t.owner !== "none" ? OWNER[t.owner] : "Not decided"}</span>${hasDate ? `<span class="${st}">${whenText(t)}${st === "late" ? " · Overdue" : ""}</span>` : ""}</div></div>`;
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
  if (page === "docs") { renderDocs(); return; }
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
  if (a === "docs") { page = "docs"; render(); return; }
  page = "tasks";
  const nws = ["all", "ef", "qlc"].includes(a) ? a : "all", nv = ["list", "board", "gantt"].includes(b) ? b : "list";
  if (nws !== ws) { ws = nws; pFilter = "all"; $("qWs").value = ""; }
  if (nv !== view) { view = nv; wantScroll = true; }
  render();
}
const go = (nws, nv) => { location.hash = (nws || ws) + "/" + (nv || view); };
document.querySelectorAll("[data-nav]").forEach((b) => b.addEventListener("click", () => { if (b.dataset.nav === "docs") location.hash = "docs"; else go(b.dataset.nav, view); }));
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
  const dd = e.target.closest("[data-docs]"); if (dd) { openProjectDocs(dd.dataset.docs); return; }
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
  staged = []; attDelArmed = null; renderDDocs();
  $("scrim").hidden = false; $("dName").focus();
}
function closeTask() { $("scrim").hidden = true; editId = null; staged = []; if (lastFocus && lastFocus.focus) try { lastFocus.focus(); } catch (_) {} }
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
  const saveBtn = $("dSave"); saveBtn.disabled = true;
  try {
    const projectId = newProj ? await findOrCreateProject(newProj, w) : $("dProject").value;
    const data = { name, projectId, owner: dOwner, status: dStatus, start, due, notes: $("dNotes").value };
    let saved;
    if (editId) { saved = await api("PATCH", "/api/tasks?id=" + editId, data); replaceTask(saved); }
    else {
      saved = await api("POST", "/api/tasks", { ...data, workspace: w }); tasks.push(saved); editId = saved.id;
      $("dTitle").textContent = "Edit task"; $("dDel").hidden = false; // if a file fails below, saving again will not make a second task
    }
    render();
    while (staged.length) {
      const f = staged[0];
      await uploadOne(f, { taskId: saved.id }, (p) => { saveBtn.textContent = "Uploading " + Math.round(p * 100) + "%"; });
      staged.shift(); renderDDocs(); render();
    }
    closeTask(); render();
  } catch (e2) { renderDDocs(); if (e2 && e2.message && e2.code !== "auth") err(e2.message); else failWrite(e2); }
  finally { saveBtn.disabled = false; saveBtn.textContent = "Save"; }
});
$("dDel").addEventListener("click", async () => {
  if (!delArmed) { delArmed = true; $("dDel").textContent = "Click again to delete for good"; return; }
  try { const gone = editId; await api("DELETE", "/api/tasks?id=" + gone); tasks = tasks.filter((t) => t.id !== gone); attachments = attachments.filter((a) => a.taskId !== gone); closeTask(); render(); } catch (e) { failWrite(e); }
});

/* ---------- projects dialog ---------- */
let pDelArmed = null;
function renderProjects() {
  const list = $("pList");
  if (list.contains(document.activeElement) && document.activeElement.tagName === "INPUT") return;
  $("pTitle").textContent = "Projects · " + SECTION[ws].name;
  const ps = sortedProjects();
  list.innerHTML = ps.length ? ps.map((p) => {
    const n = docsForProject(p.id);
    return `<div class="prow"><span class="pdot" style="background:${pcolor(p)}"></span><input type="text" value="${esc(p.name)}" maxlength="100" data-rename="${esc(p.id)}" aria-label="Project name"><button class="btn ghost small pc" type="button" data-pdocs="${esc(p.id)}">Documents (${n})</button><button class="btn ghost small" type="button" data-pdel="${esc(p.id)}">${pDelArmed === p.id ? "Click again to delete" : "Delete"}</button></div>`;
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
  const pd2 = e.target.closest("[data-pdocs]"); if (pd2) { closeProjects(); openProjectDocs(pd2.dataset.pdocs); return; }
  const b = e.target.closest("[data-pdel]"); if (!b) return;
  const id = b.dataset.pdel;
  if (pDelArmed !== id) { pDelArmed = id; renderProjects(); return; }
  pDelArmed = null;
  try {
    await api("DELETE", "/api/projects?id=" + id);
    projects = projects.filter((p) => p.id !== id); tasks.forEach((t) => { if (t.projectId === id) t.projectId = null; });
    attachments = attachments.filter((a) => a.projectId !== id);
    if (pFilter === id) pFilter = "all";
  } catch (err) { failWrite(err); }
  render();
});

addEventListener("keydown", (e) => { if (e.key === "Escape") { if (!$("scrim").hidden) closeTask(); else if (!$("pscrim").hidden) closeProjects(); } });

/* ---------- documents ---------- */
// Files go straight from the browser to private storage, then get recorded here.
// Anyone signed in can open them; nobody else can.
const MAX_BYTES = 25 * 1024 * 1024;
const INLINE_EXT = ["pdf", "png", "jpg", "jpeg", "gif", "webp"];
const KINDS = { pdf: "PDF", doc: "Word", docx: "Word", rtf: "Word", odt: "Word", pages: "Word", xls: "Excel", xlsx: "Excel", csv: "Excel", ods: "Excel", numbers: "Excel", ppt: "Slides", pptx: "Slides", key: "Slides", odp: "Slides", png: "Image", jpg: "Image", jpeg: "Image", gif: "Image", webp: "Image", heic: "Image", txt: "Text", md: "Text" };
const BADGE = { PDF: "PDF", Word: "DOC", Excel: "XLS", Slides: "PPT", Image: "IMG", Text: "TXT" };
const CLIP = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.5l-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l9-9a3.7 3.7 0 0 1 5.2 5.2l-9 9a1.8 1.8 0 0 1-2.6-2.6l8.3-8.3"/></svg>`;
let staged = [], attDelArmed = null, docDelArmed = null, queue = [], uBusy = false, uDefault = null;
let docQ = "", docWs = "all", docProj = "all", docType = "all", docSort = "new";

const extOf = (n) => { const m = /\.([A-Za-z0-9]{1,8})$/.exec(n || ""); return m ? m[1].toLowerCase() : ""; };
const kindOf = (n) => KINDS[extOf(n)] || "Other";
const sizeText = (n) => (n < 1024 ? n + " B" : n < 1048576 ? Math.round(n / 1024) + " KB" : (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + " MB");
const dateText = (s) => new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const fileHref = (a, dl) => "/api/file?id=" + encodeURIComponent(a.id) + (dl ? "&dl=1" : "");
const canOpen = (a) => INLINE_EXT.includes(extOf(a.name));
const taskOfAtt = (a) => (a.taskId ? tasks.find((t) => t.id === a.taskId) || null : null);
const projOfAtt = (a) => { const t = taskOfAtt(a); return projById(a.projectId || (t && t.projectId)); };
const attLine = (a) => `${sizeText(a.size)} · ${esc(OWNER[a.by] || a.by || "")}, ${dateText(a.at)}`;
function clipChip(taskId) { const n = attachments.filter((a) => a.taskId === taskId).length; return n ? `<span class="clip" title="${n} document${n > 1 ? "s" : ""}">${CLIP}${n}</span>` : ""; }
function docsForProject(id) { return attachments.filter((a) => { const p = projOfAtt(a); return p && p.id === id; }).length; }
function checkFile(f) {
  if (f.size === 0) return f.name + " is empty.";
  if (f.size > MAX_BYTES) return f.name + " is larger than 25 MB.";
  return "";
}

async function uploadOne(file, target, onProgress) {
  const m = checkFile(file); if (m) throw { message: m };
  const { presignedUrl, pathname } = await api("POST", "/api/upload-url", { name: file.name, size: file.size });
  await new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("PUT", presignedUrl);
    x.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    x.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
    x.onload = () => (x.status >= 200 && x.status < 300 ? resolve() : reject({ message: "Uploading " + file.name + " failed (" + x.status + ")." }));
    x.onerror = () => reject({ message: "Uploading " + file.name + " failed. Check your connection." });
    x.send(file);
  });
  const row = await api("POST", "/api/attachments", { ...target, name: file.name, pathname });
  attachments.unshift(row);
  return row;
}

/* documents inside the task window */
function renderDDocs() {
  const existing = editId ? attachments.filter((a) => a.taskId === editId) : [];
  const rows = existing.map((a) => `<div class="dli"><span class="nm2">${esc(a.name)}<small>${attLine(a)}</small></span><span class="ac">${canOpen(a) ? `<a href="${fileHref(a)}" target="_blank" rel="noopener">Open</a>` : ""}<a href="${fileHref(a, true)}">Download</a><button type="button" class="rm" data-delatt="${esc(a.id)}">${attDelArmed === a.id ? "Click again to delete" : "Delete"}</button></span></div>`)
    .concat(staged.map((f, i) => `<div class="dli"><span class="nm2">${esc(f.name)}<small>${sizeText(f.size)} · uploads when you press Save</small></span><span class="ac"><button type="button" class="rm" data-unstage="${i}">Remove</button></span></div>`));
  $("dDocList").innerHTML = rows.length ? rows.join("") : `<p class="hint">No documents attached yet.</p>`;
}
$("dFiles").addEventListener("change", (e) => {
  const errs = [];
  for (const f of e.target.files) { const m = checkFile(f); if (m) errs.push(m); else staged.push(f); }
  e.target.value = ""; renderDDocs();
  if (errs.length) { $("dErr").textContent = errs.join(" "); $("dErr").hidden = false; }
});
$("dDocList").addEventListener("click", async (e) => {
  const u = e.target.closest("[data-unstage]"); if (u) { staged.splice(+u.dataset.unstage, 1); renderDDocs(); return; }
  const d = e.target.closest("[data-delatt]"); if (!d) return;
  const id = d.dataset.delatt;
  if (attDelArmed !== id) { attDelArmed = id; renderDDocs(); return; }
  attDelArmed = null;
  try { await api("DELETE", "/api/attachments?id=" + encodeURIComponent(id)); attachments = attachments.filter((a) => a.id !== id); } catch (err) { failWrite(err); }
  renderDDocs(); render();
});

/* the Documents page */
const hay = (a) => {
  const t = taskOfAtt(a), p = projOfAtt(a);
  return [a.name, kindOf(a.name), t && t.name, p && p.name, SECTION[a.workspace].name, SECTION[a.workspace].short, OWNER[a.by], dateText(a.at)].filter(Boolean).join(" ").toLowerCase();
};
function hl(text, words) {
  if (!words.length) return esc(text);
  const re = new RegExp("(" + words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")", "gi");
  return String(text).split(re).map((part, i) => (i % 2 ? `<mark>${esc(part)}</mark>` : esc(part))).join("");
}
function fillSel(sel, opts) {
  const cur = sel.value;
  sel.innerHTML = opts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("");
  if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
}
function fillDocControls() {
  if (docProj !== "all" && docProj !== "none" && !projById(docProj)) docProj = "all";
  fillSel($("docProject"), [["all", "All projects"], ...sortedProjects(docWs).map((p) => [p.id, (docWs === "all" ? SECTION[p.workspace].short + " · " : "") + p.name]), ["none", "No project"]]);
  $("docProject").value = docProj;
  if (uDefault) $("uWs").value = uDefault.ws;
  const w = $("uWs").value;
  fillSel($("uProject"), [["", "No specific project"], ...(w ? sortedProjects(w).map((p) => [p.id, p.name]) : [])]);
  if (uDefault) { $("uProject").value = uDefault.projectId || ""; uDefault = null; }
  const pj = $("uProject").value;
  fillSel($("uTask"), [["", "No specific task"], ...(w ? tasks.filter((t) => t.workspace === w && (!pj || t.projectId === pj)).sort((a, b) => (a.name || "").localeCompare(b.name || "")).map((t) => [t.id, t.name]) : [])]);
}
function docRow(a, words) {
  const k = kindOf(a.name), t = taskOfAtt(a), p = projOfAtt(a);
  const badge = BADGE[k] || extOf(a.name).toUpperCase().slice(0, 4) || "FILE";
  const title = canOpen(a) ? `<a href="${fileHref(a)}" target="_blank" rel="noopener">${hl(a.name, words)}</a>` : `<a href="${fileHref(a, true)}">${hl(a.name, words)}</a>`;
  const where = t ? `Task: <button class="lk" type="button" data-task="${esc(t.id)}">${hl(t.name, words)}</button>${p ? " · Project: " + hl(p.name, words) : ""}` : p ? "Project: " + hl(p.name, words) : "General (whole section)";
  return `<div class="docrow"><div class="kind ${k}" aria-hidden="true">${esc(badge)}</div><div><div class="dname">${title}</div><div class="dmeta"><span class="wchip" style="--wsc:${wsColor(a.workspace)}">${SECTION[a.workspace].short}</span><span>${where}</span><span>${sizeText(a.size)}</span><span>${esc(OWNER[a.by] || a.by || "")}, ${dateText(a.at)}</span></div></div><div class="dact">${canOpen(a) ? `<a class="btn ghost small" href="${fileHref(a)}" target="_blank" rel="noopener">Open</a>` : ""}<a class="btn ghost small" href="${fileHref(a, true)}">Download</a><button class="btn ghost small warn" type="button" data-deldoc="${esc(a.id)}">${docDelArmed === a.id ? "Click again to delete" : "Delete"}</button></div></div>`;
}
function renderDocs() {
  fillDocControls();
  $("docWs").value = docWs; $("docType").value = docType; $("docSort").value = docSort;
  const words = docQ.toLowerCase().split(/\s+/).filter(Boolean);
  const list = attachments.filter((a) =>
    (docWs === "all" || a.workspace === docWs) &&
    (docProj === "all" || (docProj === "none" ? !projOfAtt(a) : (projOfAtt(a) || {}).id === docProj)) &&
    (docType === "all" || kindOf(a.name) === docType) &&
    words.every((w) => hay(a).includes(w)));
  list.sort((a, b) => docSort === "old" ? a.at.localeCompare(b.at) : docSort === "name" ? a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) : docSort === "big" ? b.size - a.size : b.at.localeCompare(a.at));
  $("docCount").innerHTML = `<span class="pill">${list.length} document${list.length === 1 ? "" : "s"}${list.length !== attachments.length ? " of " + attachments.length : ""}</span>`;
  $("docList").innerHTML = list.length
    ? `<section class="card">${list.map((a) => docRow(a, words)).join("")}</section>`
    : `<div class="card"><div class="empty">${attachments.length ? "No documents match. Try fewer words or clear a filter." : "No documents yet. Add the first one above, or attach one from any task."}</div></div>`;
  renderQueue();
}
function openProjectDocs(id) {
  const p = projById(id); if (!p) return;
  docWs = p.workspace; docProj = p.id; docQ = ""; $("docSearch").value = "";
  uDefault = { ws: p.workspace, projectId: p.id };
  if (location.hash === "#docs") render(); else location.hash = "docs";
}
$("docSearch").addEventListener("input", (e) => { docQ = e.target.value; renderDocs(); });
$("docWs").addEventListener("change", (e) => { docWs = e.target.value; docProj = "all"; if (docWs !== "all") uDefault = { ws: docWs, projectId: "" }; renderDocs(); });
$("docProject").addEventListener("change", (e) => { docProj = e.target.value; const p = projById(docProj); if (p) uDefault = { ws: p.workspace, projectId: p.id }; renderDocs(); });
$("docType").addEventListener("change", (e) => { docType = e.target.value; renderDocs(); });
$("docSort").addEventListener("change", (e) => { docSort = e.target.value; renderDocs(); });
$("uWs").addEventListener("change", fillDocControls);
$("uProject").addEventListener("change", fillDocControls);
$("docList").addEventListener("click", async (e) => {
  const t = e.target.closest("[data-task]"); if (t) { openTask(t.dataset.task); return; }
  const d = e.target.closest("[data-deldoc]"); if (!d) return;
  const id = d.dataset.deldoc;
  if (docDelArmed !== id) { docDelArmed = id; renderDocs(); return; }
  docDelArmed = null;
  try { await api("DELETE", "/api/attachments?id=" + encodeURIComponent(id)); attachments = attachments.filter((a) => a.id !== id); } catch (err) { failWrite(err); }
  render();
});

/* uploading from the Documents page */
const showUErr = (m) => { $("uErr").textContent = m || ""; $("uErr").hidden = !m; };
function addToQueue(files) {
  const errs = [];
  for (const f of files) { const m = checkFile(f); if (m) errs.push(m); else queue.push({ file: f, state: "wait", p: 0, msg: "" }); }
  renderQueue(); showUErr(errs.join(" "));
}
function renderQueue() {
  $("uQueue").innerHTML = queue.map((q, i) => `<div class="qi"><span class="qn">${esc(q.file.name)}</span><span class="qs${q.state === "err" ? " bad" : ""}">${q.state === "up" ? `<span class="qbar"><i style="width:${Math.round(q.p * 100)}%"></i></span>` : q.state === "err" ? esc(q.msg) : sizeText(q.file.size)}</span>${q.state === "up" ? "" : `<button type="button" data-qrm="${i}">Remove</button>`}</div>`).join("");
  $("uGo").disabled = uBusy; $("uGo").textContent = uBusy ? "Uploading…" : "Upload";
}
$("uFiles").addEventListener("change", (e) => { addToQueue(e.target.files); e.target.value = ""; });
$("uQueue").addEventListener("click", (e) => { const b = e.target.closest("[data-qrm]"); if (b && !uBusy) { queue.splice(+b.dataset.qrm, 1); renderQueue(); } });
["dragenter", "dragover"].forEach((ev) => $("drop").addEventListener(ev, (e) => { e.preventDefault(); $("drop").classList.add("over"); }));
["dragleave", "drop"].forEach((ev) => $("drop").addEventListener(ev, (e) => { e.preventDefault(); $("drop").classList.remove("over"); }));
$("drop").addEventListener("drop", (e) => { if (e.dataTransfer && e.dataTransfer.files) addToQueue(e.dataTransfer.files); });
$("upl").addEventListener("submit", async (e) => {
  e.preventDefault(); if (uBusy) return;
  const w = $("uWs").value;
  if (!w) return showUErr("Choose a section first.");
  if (!queue.length) return showUErr("Choose at least one file.");
  const target = $("uTask").value ? { taskId: $("uTask").value } : $("uProject").value ? { projectId: $("uProject").value } : { workspace: w };
  showUErr(""); uBusy = true; let n = 0;
  for (const q of queue.slice()) {
    q.state = "up"; q.p = 0; renderQueue();
    try { await uploadOne(q.file, target, (p) => { q.p = p; renderQueue(); }); queue = queue.filter((x) => x !== q); n++; }
    catch (err) { q.state = "err"; q.msg = (err && err.message) || "Did not upload"; if (err && err.code === "auth") break; }
  }
  uBusy = false; renderQueue(); render();
  if (n) toast(n + (n === 1 ? " document added" : " documents added"));
});

/* ---------- who is here ---------- */
// Each open, visible page tells the server "I'm here" every 25 seconds. Someone counts as here for 60 seconds after that.
const HERE_SECONDS = 60;
function agoText(sec) {
  if (sec < 90) return "just now";
  if (sec < 3600) return Math.round(sec / 60) + " min ago";
  if (sec < 86400) { const h = Math.round(sec / 3600); return h + (h === 1 ? " hour ago" : " hours ago"); }
  const d = new Date(Date.now() - sec * 1000);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " at " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
function renderPresence() {
  const el = $("presence");
  if (!me) { el.innerHTML = ""; return; }
  const other = me === "babs" ? "david" : "babs", ago = presence[other];
  let on = false, line;
  if (ago == null) line = `<span class="t">${OWNER[other]}<small>Has not opened the tracker yet</small></span>`;
  else {
    const a = ago + (Date.now() - presenceAt) / 1000;
    on = a <= HERE_SECONDS;
    line = `<span class="t">${OWNER[other]}<small>${on ? "Here now" : "Last here " + agoText(a)}</small></span>`;
  }
  el.innerHTML = `<div class="pr on"><span class="pdot2"></span><span class="t">You (${OWNER[me]})<small>Here now</small></span></div><div class="pr${on ? " on" : ""}"><span class="pdot2"></span>${line}</div>`;
}
async function ping() {
  if (document.hidden || !me) return;
  try { const d = await api("POST", "/api/presence"); presence = d.presence; presenceAt = Date.now(); renderPresence(); } catch (_) {}
}
setInterval(ping, 25000);
setInterval(renderPresence, 15000);

/* ---------- start ---------- */
applyHash();
load().then(ping);
setInterval(() => { if (!document.hidden && !dragId && $("scrim").hidden && $("pscrim").hidden && document.activeElement.tagName !== "INPUT") load(); }, 20000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) { load(); ping(); } });
