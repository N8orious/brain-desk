/* Brain Desk — app
   Data: one JSON file (items.json) in a private GitHub repo, read and written with the GitHub API.
   Claude edits the same file with git, so chats and scheduled tasks stay in sync.
   Edit CONFIG to change zones, modes, the schedule or where data lives. */
(() => {
"use strict";

/* ============================ CONFIG ============================ */
const ZONES = [
  { id: "inbox",  name: "Brain dump", color: "var(--z-inbox)" },
  { id: "work",   name: "Work",       color: "var(--z-work)" },
  { id: "builds", name: "Builds",     color: "var(--z-builds)" },
  { id: "life",   name: "Life",       color: "var(--z-life)" },
];
const WEEKDAYS = [1, 2, 3, 4, 5], WEEKEND = [0, 6], ALL = [0, 1, 2, 3, 4, 5, 6];
// Modes switch on schedule (first match in PRIORITY wins). Any mode can be turned on by hand
// until the next scheduled change, like an iOS Focus.
const MODES = [
  { id: "plan",     name: "Plan",         icon: "sun",     tint: "var(--m-plan)",  when: [{ days: WEEKDAYS, from: "08:00", to: "10:30" }],
    line: "Pick three. Everything else can wait." },
  { id: "focus",    name: "Deep work",    icon: "target",  tint: "var(--m-focus)", when: [{ days: WEEKDAYS, from: "10:30", to: "18:30" }],
    line: "One thing on screen. Builds and life are hidden till 7:30." },
  { id: "low",      name: "Low battery",  icon: "battery", tint: "var(--m-low)",   when: [],
    line: "Small wins only. Anything counts." },
  { id: "shutdown", name: "Shutdown",     icon: "sunset",  tint: "var(--m-shut)",  when: [{ days: WEEKDAYS, from: "18:30", to: "19:30" }],
    line: "Tick, empty your head, set tomorrow. Then you're off." },
  { id: "reset",    name: "Sunday reset", icon: "refresh", tint: "var(--m-reset)", when: [{ days: [0], from: "17:00", to: "20:00" }],
    line: "See the week. Rescue what went quiet." },
  { id: "free",     name: "Free time",    icon: "spark",   tint: "var(--m-free)",  when: [{ days: WEEKDAYS, from: "19:30", to: "23:30" }, { days: WEEKEND, from: "09:00", to: "23:30" }],
    line: "Work is closed. Builds and life only." },
  { id: "sleep",    name: "Wind down",    icon: "moon",    tint: "var(--m-sleep)", when: [{ days: ALL, from: "23:30", to: "24:00" }, { days: WEEKDAYS, from: "00:00", to: "08:00" }, { days: WEEKEND, from: "00:00", to: "09:00" }],
    line: "Tomorrow is set. Nothing to do now." },
];
const PRIORITY = ["reset", "plan", "focus", "shutdown", "free", "sleep"];
const DATA = { owner: "N8orious", repo: "brain-desk-data", path: "items.json", branch: "main" };
const POLL_MS = 15000;
const APP_VERSION = (document.querySelector('script[src*="app.js"]')?.getAttribute("src").split("v=")[1]) || "";
const STALE_DAYS = 14;
const FOCUS_MIN = 25;

/* ============================ HELPERS ============================ */
const MODE = Object.fromEntries(MODES.map(m => [m.id, m]));
const ZONE = Object.fromEntries(ZONES.map(z => [z.id, z]));
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = n => String(n).padStart(2, "0");
const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = n => { const d = new Date(); d.setDate(d.getDate() + n); return dayKey(d); };
const dayOf = iso => iso ? dayKey(new Date(iso)) : "";
const nowIso = () => new Date().toISOString();
const ago = iso => iso ? Math.floor((Date.now() - Date.parse(iso)) / 864e5) : 0;
const mins = t => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const t12 = t => { let [h, m] = t.split(":").map(Number); if (h === 24) h = 0; const ap = h >= 12 ? "pm" : "am"; h = h % 12 || 12; return m ? `${h}:${pad(m)}${ap}` : `${h}${ap}`; };
const store = (k, v) => { try { localStorage.setItem("bd2:" + k, JSON.stringify(v)); } catch (e) {} };
const recall = (k, d) => { try { const v = localStorage.getItem("bd2:" + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
const zoneOf = it => ZONE[it.zone] || ZONE.inbox;

const P = {
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
  battery: '<rect x="2.5" y="7" width="16.5" height="10" rx="2.5"/><path d="M21.5 10.5v3M6 10.5v3"/>',
  sunset: '<path d="M3 17h18M6.5 17a5.5 5.5 0 0 1 11 0M12 3.5v4M9.5 6 12 3.5 14.5 6M4.5 10.5l1.4 1M19.5 10.5l-1.4 1M7 21h10"/>',
  refresh: '<path d="M19.5 11A7.5 7.5 0 0 0 6 6.5L4 8.5M4 4v4.5h4.5M4.5 13A7.5 7.5 0 0 0 18 17.5l2-2M20 20v-4.5h-4.5"/>',
  spark: '<path d="M12 3.5 13.8 9 19.5 10.5 13.8 12.2 12 18 10.2 12.2 4.5 10.5 10.2 9z"/><path d="M18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
  moon: '<path d="M19.5 14.5A8 8 0 1 1 9.5 4.5a6.5 6.5 0 0 0 10 10z"/>',
  now: '<path d="M3 12h4l2.5-6 5 12 2.5-6h4"/>',
  board: '<rect x="3.5" y="4" width="5" height="16" rx="1.5"/><rect x="10.5" y="4" width="5" height="11" rx="1.5"/><rect x="17.5" y="4" width="3" height="7" rx="1.2"/>',
  check: '<circle cx="12" cy="12" r="8.5"/><path d="m8.5 12.2 2.4 2.4 4.6-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  play: '<path d="M8 5.5v13l10-6.5z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M8.5 5.5v13M15.5 5.5v13"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  chev: '<path d="m7 10 5 5 5-5"/>',
  tick: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  dump: '<path d="M4 13.5h4.5l1.5 2.5h4l1.5-2.5H20"/><path d="M6 5h12l2 8.5V19H4v-5.5z"/>',
};
const ico = (n, s = 16) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n]}</svg>`;
function statusIcon(it) {
  if (it.status === "done") return `<svg viewBox="0 0 16 16" width="24" height="24" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="var(--accent)"/><path d="m5 8.3 2 2 4-4.5" fill="none" stroke="var(--accent-ink)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  if (it.status === "dropped") return `<svg viewBox="0 0 16 16" width="24" height="24" aria-hidden="true"><circle cx="8" cy="8" r="6.25" fill="none" stroke="var(--text-3)" stroke-width="1.5"/><path d="M4 12 12 4" stroke="var(--text-3)" stroke-width="1.5"/></svg>`;
  if (it.today) return `<svg viewBox="0 0 16 16" width="24" height="24" aria-hidden="true"><circle cx="8" cy="8" r="6.25" fill="none" stroke="var(--m-focus)" stroke-width="1.5"/><path d="M8 3.5a4.5 4.5 0 0 1 0 9z" fill="var(--m-focus)"/></svg>`;
  return `<svg viewBox="0 0 16 16" width="24" height="24" aria-hidden="true"><circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`;
}

/* ============================ STATE ============================ */
let items = [], habits = {}, streamState = {}, loaded = false;
let view = recall("view", "now");
let gh = { owner: recall("owner", DATA.owner), repo: recall("repo", DATA.repo), token: recall("token", "") };
let override = recall("override", null);
let peekId = null, focusId = null;
const timer = { left: FOCUS_MIN * 60, total: FOCUS_MIN * 60, run: null };

/* ============================ MODES ============================ */
function scheduled(d = new Date()) {
  const day = d.getDay(), m = d.getHours() * 60 + d.getMinutes();
  for (const id of PRIORITY) if (MODE[id].when.some(w => w.days.includes(day) && m >= mins(w.from) && m < mins(w.to))) return id;
  return "free";
}
function nextChange() {
  const s = scheduled(), t0 = Date.now();
  for (let i = 1; i <= 24 * 12; i++) { const t = new Date(t0 + i * 300000); if (scheduled(t) !== s) { t.setMinutes(Math.floor(t.getMinutes() / 5) * 5, 0, 0); return t.getTime(); } }
  return t0 + 864e5;
}
function currentMode() {
  if (override && override.until > Date.now()) return override.id;
  if (override) { override = null; store("override", null); }
  return scheduled();
}
function setMode(id) {
  if (id === scheduled()) override = null;
  else override = { id, until: nextChange(), start: Date.now() };
  store("override", override); view = "today"; store("view", view); render();
}
function blockRange() {
  const now = Date.now(), m = currentMode();
  if (override && override.until > now) return { mode: m, start: override.start || now, end: override.until };
  const s = scheduled(); let start = now;
  for (let i = 1; i <= 24 * 12; i++) { const t = new Date(now - i * 300000); if (scheduled(t) !== s) { start = now - (i - 1) * 300000; break; } }
  return { mode: m, start, end: nextChange() };
}
function fmtDur(ms) { const mi = Math.max(0, Math.round(ms / 60000)), h = Math.floor(mi / 60), r = mi % 60; return h ? `${h}h ${r ? r + "m" : ""}`.trim() : `${r}m`; }
function updateTimeLeft() {
  const el = $("#tleft"); if (!el) return;
  const b = blockRange(), left = b.end - Date.now(), pct = Math.max(0, Math.min(100, left / Math.max(1, b.end - b.start) * 100));
  const next = MODE[scheduled(new Date(b.end + 60000))];
  $("#tlFill").style.width = pct + "%";
  $("#tlLabel").innerHTML = `<b>${fmtDur(left)}</b> left in ${esc(MODE[b.mode].name)}`;
  $("#tlNext").textContent = `then ${next.name} at ${new Date(b.end).toLocaleTimeString("en", { hour: "numeric", minute: "2-digit" })}`;
}
function whenLabel(m) {
  if (!m.when.length) return "By hand";
  const w = m.when[0]; return `${t12(w.from)}–${t12(w.to)}`;
}

/* ============================ DERIVED ============================ */
const isOpen = it => !it.status || it.status === "open";
const openItems = () => items.filter(isOpen);
const inZone = z => openItems().filter(it => (it.zone || "inbox") === z);
const todays = () => openItems().filter(it => it.today).sort((a, b) => (a.todayRank ?? 9) - (b.todayRank ?? 9));
const carried = it => it.today && it.todayDate && it.todayDate < dayKey();
const doneOn = k => items.filter(it => it.status === "done" && dayOf(it.doneAt) === k);
const touched = it => it.touchedAt || it.updatedAt || it.createdAt;
const isStale = it => isOpen(it) && !it.today && ago(touched(it)) >= STALE_DAYS;
const isEasy = it => it.size === "S" || it.energy === "low";
const stepsLeft = it => (it.steps || []).filter(s => !s.done);
function weekStats() {
  const n = new Date(), dow = (n.getDay() + 6) % 7, mon = new Date(n); mon.setHours(0, 0, 0, 0); mon.setDate(n.getDate() - dow);
  const counts = [0, 0, 0, 0, 0, 0, 0], list = [];
  items.forEach(it => { if (it.status === "done" && it.doneAt) { const i = Math.floor((new Date(it.doneAt) - mon) / 864e5); if (i >= 0 && i < 7) { counts[i]++; list.push(it); } } });
  return { counts, dow, total: list.length, list };
}
function suggestions(n = 6, opts = {}) {
  const t = dayKey(), soon = addDays(2), wk = WEEKDAYS.includes(new Date().getDay());
  const score = it => {
    let s = 0;
    if (it.due && it.due <= t) s += 100; else if (it.due && it.due <= soon) s += 50;
    if (wk && it.zone === "work") s += 20;
    if (opts.notWork && it.zone === "work") s -= 200;
    if (isEasy(it)) s += 6;
    if (isStale(it)) s += 4;
    if (ago(touched(it)) <= 1) s += 2;
    if ((it.zone || "inbox") === "inbox") s -= 5;
    return s;
  };
  return openItems().filter(it => !it.today).sort((a, b) => score(b) - score(a)).slice(0, n);
}
function fmtDue(d) {
  const t = dayKey(); if (d === t) return "Today";
  const diff = Math.round((new Date(d + "T00:00") - new Date(t + "T00:00")) / 864e5);
  if (diff === 1) return "Tomorrow"; if (diff < 0) return `${-diff}d late`; if (diff < 7) return new Date(d + "T00:00").toLocaleString("en", { weekday: "short" });
  const dt = new Date(d + "T00:00"); return `${dt.getDate()} ${dt.toLocaleString("en", { month: "short" })}`;
}

/* ============================ STORAGE (GitHub) ============================
   Every change is queued as an op, then applied to the freshest copy of items.json and
   committed. If someone else (Claude, another device) committed first, we re-read and retry. */
let fileSha = null, etag = null, queue = [], flushing = false, flushT = null, syncState = "idle";
const enc = str => { const b = new TextEncoder().encode(str); let o = ""; for (let i = 0; i < b.length; i += 0x8000) o += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(o); };
const dec = b64 => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\n/g, "")), c => c.charCodeAt(0)));
const ghUrl = () => `https://api.github.com/repos/${encodeURIComponent(gh.owner)}/${encodeURIComponent(gh.repo)}/contents/${DATA.path}`;
const ghHeaders = extra => Object.assign({ Authorization: "Bearer " + gh.token, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" }, extra || {});
const toList = data => Object.entries((data && data.items) || {}).map(([id, d]) => Object.assign({ id }, d));
async function readFile(useEtag) {
  const r = await fetch(ghUrl() + "?ref=" + DATA.branch + "&t=" + Date.now(), { headers: ghHeaders(useEtag && etag ? { "If-None-Match": etag } : null), cache: "no-store" });
  if (r.status === 304) return null;
  if (r.status === 404) return { data: { items: {} }, sha: null };
  if (!r.ok) throw Object.assign(new Error("GitHub " + r.status), { status: r.status });
  etag = r.headers.get("ETag");
  const j = await r.json();
  return { data: JSON.parse(dec(j.content) || "{}"), sha: j.sha };
}
function applyOps(data, ops) {
  data.items = data.items || {}; data.habits = data.habits || {}; data.streams = data.streams || {};
  ops.forEach(op => {
    if (op.t === "sset") { data.streams[op.id] = op.doc; return; }
    if (op.t === "hset") data.habits[op.id] = Object.assign(data.habits[op.id] || {}, op.doc);
    else if (op.t === "hdel") delete data.habits[op.id];
    else if (op.t === "htick") { const h = data.habits[op.id]; if (h) { h.days = h.days || {}; if (op.val) h.days[op.date] = true; else delete h.days[op.date]; } }
    else if (op.t === "create") data.items[op.id] = op.doc;
    else if (op.t === "delete") delete data.items[op.id];
    else if (op.t === "patch" && data.items[op.id]) {
      const d = data.items[op.id];
      Object.entries(op.patch).forEach(([k, v]) => { if (v === null || v === undefined) delete d[k]; else d[k] = v; });
    }
  });
  return data;
}
function enqueue(op) { queue.push(op); setSync("saving"); clearTimeout(flushT); flushT = setTimeout(flush, 700); }
async function flush() {
  if (flushing || !queue.length || !gh.token) return;
  flushing = true;
  const ops = queue.slice(), msg = commitMsg(ops);
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const f = await readFile(false);
      const data = applyOps(f.data, ops);
      const body = { message: msg, content: enc(JSON.stringify(data, null, 1) + "\n"), branch: DATA.branch };
      if (f.sha) body.sha = f.sha;
      const r = await fetch(ghUrl(), { method: "PUT", headers: ghHeaders({ "Content-Type": "application/json" }), body: JSON.stringify(body) });
      if (r.ok) {
        const j = await r.json(); fileSha = j.content.sha; etag = null;
        queue = queue.slice(ops.length);
        if (!queue.length) { items = toList(data); habits = data.habits || {}; streamState = data.streams || {}; cacheLocal(); render(); }
        setSync("saved"); break;
      }
      if (r.status !== 409 && r.status !== 422) throw new Error("GitHub " + r.status);
      await new Promise(res => setTimeout(res, 300 + Math.random() * 600));
      if (attempt === 3) throw new Error("conflict");
    }
  } catch (e) { console.warn(e); setSync("error"); toast("Couldn't save to GitHub. Will retry."); setTimeout(flush, 15000); }
  flushing = false;
  if (queue.length) flush();
}
function commitMsg(ops) {
  const op = ops[0];
  if (op.t === "sset") return `desk: ${op.doc.active ? "active" : "inactive"} ${op.id.slice(2)}`.slice(0, 72);
  if (op.t[0] === "h") return `desk: habit ${op.t === "htick" ? (op.val ? "tick" : "untick") : op.t === "hdel" ? "remove" : "edit"} ${(habits[op.id] || op.doc || {}).title || op.id}`.slice(0, 72);
  const t = op.t === "create" ? op.doc.title : (items.find(i => i.id === op.id) || {}).title || op.id;
  const verb = op.t === "create" ? "add" : op.t === "delete" ? "delete" : op.patch.status === "done" ? "done" : op.patch.status === "dropped" ? "drop" : op.patch.today === true ? "today" : "edit";
  return `desk: ${verb} ${t}`.slice(0, 72) + (ops.length > 1 ? ` (+${ops.length - 1})` : "");
}
async function poll(force) {
  if (!gh.token || flushing || queue.length || (!force && document.visibilityState === "hidden")) return;
  try {
    const f = await readFile(!force);
    if (f && !queue.length) { fileSha = f.sha; items = toList(f.data); habits = f.data.habits || {}; streamState = f.data.streams || {}; cacheLocal(); if (!drag || !drag.started) render(); }
    loaded = true; if (syncState === "error") setSync("saved");
  } catch (e) { if (e.status === 401 || e.status === 403 || e.status === 404) { setSync("auth"); render(); } else setSync("error"); }
}
// Refresh button / pull down: fetch the newest cards now, and reload if a newer version of the app is live.
let refreshing = false;
async function refreshNow() {
  if (refreshing) return; refreshing = true;
  const b = $("#refreshBtn"); if (b) b.classList.add("spin");
  try {
    if (queue.length) await flush();
    await poll(true); render();
    const r = await fetch("index.html?t=" + Date.now(), { cache: "no-store" });
    const m = r.ok && (await r.text()).match(/app\.js\?v=([\w.-]+)/);
    if (m && APP_VERSION && m[1] !== APP_VERSION) { toast("New version. Reloading…"); setTimeout(() => location.reload(), 600); return; }
    toast(syncState === "error" ? "Couldn't reach GitHub. Showing the last copy." : "Up to date.");
  } catch (e) { toast("Couldn't refresh. Check your connection."); }
  finally { refreshing = false; const b2 = $("#refreshBtn"); if (b2) b2.classList.remove("spin"); }
}
function cacheLocal() { store("cache", items); store("hcache", habits); store("scache", streamState); }
function setSync(s) { syncState = s; const el = $("#sync"); if (el) { el.dataset.s = s; el.title = { idle: "", saving: "Saving to GitHub…", saved: "Saved to GitHub", error: "Offline. Changes will sync when you're back.", auth: "GitHub access needs fixing" }[s] || ""; } }

/* ============================ WRITES ============================ */
function save(id, patch) {
  const it = items.find(i => i.id === id); if (!it) return;
  patch.updatedAt = nowIso();
  Object.entries(patch).forEach(([k, v]) => { if (v === null || v === undefined) delete it[k]; else it[k] = v; });
  render(); cacheLocal(); enqueue({ t: "patch", id, patch: Object.assign({}, patch) });
}
function create(data) {
  const id = "i" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), t = nowIso();
  const doc = Object.assign({ title: "", zone: "inbox", kind: "task", size: "", energy: "", project: "", due: "", notes: "", steps: [], status: "open", today: false, createdAt: t, updatedAt: t, touchedAt: t, source: "app" }, data);
  items.push(Object.assign({ id }, doc)); cacheLocal(); enqueue({ t: "create", id, doc });
  return id;
}
function remove(id) { items = items.filter(i => i.id !== id); render(); cacheLocal(); enqueue({ t: "delete", id }); }
const snap = id => { const it = items.find(i => i.id === id); return it && { status: it.status || "open", doneAt: it.doneAt || null, droppedAt: it.droppedAt || null, today: !!it.today, todayRank: it.todayRank ?? null, todayDate: it.todayDate || "", touchedAt: it.touchedAt || null }; };
function rerank() { todays().forEach((it, i) => { if (it.todayRank !== i + 1) save(it.id, { todayRank: i + 1 }); }); }
function markDone(id) {
  const b = snap(id); if (!b) return;
  if (b.status !== "open") { save(id, { status: "open", doneAt: null, droppedAt: null, touchedAt: nowIso() }); toast("Reopened."); return; }
  save(id, { status: "done", doneAt: nowIso(), today: false, todayRank: null, touchedAt: nowIso() }); rerank();
  if (focusId === id) focusId = null;
  toast(`Done. ${weekStats().total} this week.`, () => { save(id, b); rerank(); });
}
function dropIt(id) {
  const b = snap(id); if (!b) return;
  save(id, { status: "dropped", droppedAt: nowIso(), today: false, todayRank: null }); rerank();
  if (focusId === id) focusId = null;
  toast("Let go.", () => { save(id, b); rerank(); });
}
function keepIt(id) { save(id, { touchedAt: nowIso(), todayDate: dayKey() }); toast("Kept."); }
// ADHD rule: nothing goes on today without a first step small enough to start in 2 minutes.
function addToday(id, date = dayKey()) {
  const it = items.find(i => i.id === id); if (!it || it.today) return;
  if (todays().length >= 3) { toast("Three is the limit. Finish or remove one first."); return; }
  if (!stepsLeft(it).length) { openStep(id, date); return; }
  addTodayNow(id, date);
}
function addTodayNow(id, date = dayKey()) {
  const it = items.find(i => i.id === id); if (!it || it.today) return;
  const t = todays(); if (t.length >= 3) { toast("Three is the limit. Finish or remove one first."); return; }
  save(id, { today: true, todayRank: t.length + 1, todayDate: date, touchedAt: nowIso() });
}
function removeToday(id) { save(id, { today: false, todayRank: null }); rerank(); }
function closeDay() {
  const tm = addDays(1);
  todays().forEach(it => save(it.id, { todayDate: tm }));
  override = { id: "free", until: nextChange(), start: Date.now() }; store("override", override);
  toast("Day closed. See you tomorrow."); render();
}

/* ============================ RENDER: SHELL ============================ */
function render() {
  const mode = currentMode();
  renderBar(mode); renderModes(mode); renderTop(mode); renderBodyWrap(mode);
  if (peekId) fillPeek(false);
}
// Floating bar: mode button (left), tab bar (centre), clock + sync + add (right). HIG: tab bar on top on iPad.
function renderBar(mode) {
  const m = MODE[mode], t = todays().length, w = weekStats();
  const tab = (id, label, cnt) => `<button class="tab" role="tab" data-act="view" data-v="${id}" aria-selected="${view === id}">${label}${cnt ? `<span class="cnt">${cnt}</span>` : ""}</button>`;
  $("#bar").innerHTML = `<button class="modebtn glass" data-act="modes" style="--tint:${m.tint}" aria-label="Mode: ${m.name}. Change mode" aria-haspopup="dialog">
      <span class="mi">${ico(m.icon, 17)}</span><span class="nm">${m.name}</span>${override ? `<span class="live" title="Turned on by hand"></span>` : ""}<span class="chev">${ico("chev", 14)}</span></button>
    <nav class="tabs glass" role="tablist" aria-label="Views">${tab("now", "Now", "")}${tab("today", "Today", t ? t + "/3" : "")}${tab("board", "Board", openItems().length)}${tab("done", "Done", w.total || "")}</nav>
    <div class="bar-r"><span class="clock" id="clk">${new Date().toLocaleTimeString("en", { hour: "numeric", minute: "2-digit" })}</span>
      <button class="iconbtn glass refresh" id="refreshBtn" data-act="refresh" aria-label="Refresh">${ico("refresh", 20)}<span class="sync" id="sync" data-s="${syncState}"></span></button>
      <button class="addbtn" data-act="dump" aria-label="Dump a thought (N)">${ico("plus", 22)}</button></div>`;
}
function renderModes(mode) {
  const w = weekStats(), max = Math.max(1, ...w.counts);
  $("#modes").innerHTML = `<div class="ph2">Modes · ${override ? "turned on by hand" : "switching on schedule"}</div>` +
    MODES.map(m => `<button class="mrow" data-act="mode" data-m="${m.id}" aria-current="${m.id === mode}" style="--ic:${m.tint}"><span class="mi">${ico(m.icon, 18)}</span><span class="nm">${m.name}</span><span class="wh">${whenLabel(m)}</span>${m.id === mode ? `<span class="ck">${ico("tick", 18)}</span>` : ""}</button>`).join("") +
    `<div class="popfoot"><div class="bars" aria-hidden="true">${w.counts.map((c, i) => `<i class="${c ? "on" : ""} ${i === w.dow ? "cur" : ""}" style="height:${4 + Math.round(c / max * 18)}px"></i>`).join("")}</div><span>${w.total} done this week</span>${override ? `<button data-act="auto">Back to schedule</button>` : `<button data-act="view" data-v="settings">GitHub sync</button>`}</div>`;
}
function openModes() { $("#modes").classList.add("open"); }
function closeModes() { $("#modes").classList.remove("open"); }
// Large title under the bar, with the time left in this mode.
function renderTop(mode) {
  const m = MODE[mode], d = new Date();
  const date = d.toLocaleDateString("en", { weekday: "long", day: "numeric", month: "long" });
  if (view === "settings" || !gh.token || syncState === "auth") { $("#top").innerHTML = `<div class="hero-l"><p class="eyebrow">${date}</p><h1>GitHub sync</h1><p class="line">Where your desk is saved.</p></div>`; return; }
  const title = view === "now" ? "Now" : view === "today" ? m.name : view === "board" ? "Board" : "Done";
  const line = view === "now" ? "Everything you've got going. Tap a switch to mark it active." : view === "today" ? m.line : view === "board" ? "Everything open, by zone. Press and hold a card to move it." : "What you finished and let go of.";
  const ov = override && view === "today" ? `<div class="override">On by hand until ${new Date(override.until).toLocaleTimeString("en", { hour: "numeric", minute: "2-digit" })}<button data-act="auto">Back to schedule</button></div>` : "";
  $("#top").innerHTML = `<div class="hero-l"><p class="eyebrow">${date}</p><h1>${title}</h1><p class="line">${esc(line)}</p>${ov}</div>
    ${view === "today" ? `<div class="tleft" id="tleft" style="--tint:${m.tint}"><div class="tl-txt"><span id="tlLabel"></span><span id="tlNext" class="dim"></span></div><div class="tl-track"><i id="tlFill"></i></div></div>` : ""}`;
}
function renderBodyWrap(mode) { renderBody(mode); updateTimeLeft(); }
function renderBody(mode) {
  const b = $("#body"), sc = $("#scroll"), y = sc.scrollTop;
  let h = loaded || items.length ? "" : `<div class="status">Loading your desk…</div>`;
  if (!gh.token || syncState === "auth" || view === "settings") h = viewSetup();
  else if (view === "board") h += viewBoard();
  else if (view === "done") h += viewDone();
  else if (view === "now") h += viewNow();
  else h += ({ plan: vPlan, focus: vFocus, low: vLow, shutdown: vShutdown, reset: vReset, free: vFree, sleep: vSleep }[mode] || vFree)();
  const before = view === "now" ? tilePos() : null;
  b.innerHTML = h; sc.scrollTop = y;
  if (view === "now") { packTiles(); if (before) flip(before); }
  if (view === "today" && mode === "focus") drawTimer();
}

/* ============================ RENDER: PARTS ============================ */
function chips(it) {
  const c = [];
  const st = it.steps || []; if (st.length) c.push(`<span class="chip">${st.filter(s => s.done).length}/${st.length}</span>`);
  if (it.due) { const f = fmtDue(it.due); c.push(`<span class="chip ${it.due < dayKey() ? "late" : it.due <= addDays(2) ? "due" : ""}">${f}</span>`); }
  if (it.energy === "low") c.push(`<span class="chip low">Low</span>`);
  if (isStale(it)) c.push(`<span class="chip zz" title="Untouched for ${ago(touched(it))} days">${ago(touched(it))}d quiet</span>`);
  return c.join("");
}
function row(it, actions = "") {
  const open = isOpen(it);
  return `<div class="rowwrap">${open ? `<div class="swipe-bg" aria-hidden="true"></div>` : ""}<div class="row ${open ? "" : "isdone"}" data-act="peek" data-id="${esc(it.id)}"${open ? ` data-swipe="1"` : ""}>
    <button class="st" data-act="done" data-id="${esc(it.id)}" aria-label="${open ? "Mark done" : "Reopen"}">${statusIcon(it)}</button>
    <span class="tt"><span class="tl">${esc(it.title)}</span>${it.project ? `<span class="sub2">${esc(it.project)}</span>` : ""}</span>
    <span class="meta">${chips(it)}</span>
    <span class="zdot" style="--c:${zoneOf(it).color}" title="${zoneOf(it).name}"></span>
    ${actions ? `<span class="ra">${actions}</span>` : ""}
  </div></div>`;
}
const A = {
  today: it => `<button class="btn sm" data-act="today" data-id="${esc(it.id)}" title="Add to today">${ico("plus", 14)}<span class="bl">Today</span></button>`,
  tomorrow: it => `<button class="btn sm" data-act="tomorrow" data-id="${esc(it.id)}" title="Add to tomorrow">${ico("plus", 14)}<span class="bl">Tomorrow</span></button>`,
  drop: it => `<button class="btn sm icon bad" data-act="drop" data-id="${esc(it.id)}" aria-label="Let it go" title="Let it go">${ico("x", 18)}</button>`,
  done: it => `<button class="btn sm good" data-act="done" data-id="${esc(it.id)}">Done</button>`,
  keep: it => `<button class="btn sm" data-act="keep" data-id="${esc(it.id)}">Keep</button>`,
  park: it => `<button class="btn sm" data-act="park" data-id="${esc(it.id)}">Park</button>`,
  dropTxt: it => `<button class="btn sm bad" data-act="drop" data-id="${esc(it.id)}">Drop</button>`,
  untoday: it => `<button class="btn sm icon" data-act="untoday" data-id="${esc(it.id)}" aria-label="Remove from today" title="Remove">${ico("x", 18)}</button>`,
};
function panel(title, n, body, extra = "") {
  return `<section class="panel"><div class="ph"><h3>${title}</h3>${n !== "" && n != null ? `<span class="n">${n}</span>` : ""}${extra}</div><div class="pb">${body}</div></section>`;
}
const list = (arr, fn, empty) => arr.length ? arr.map(fn).join("") : `<div class="empty">${empty}</div>`;
function slots(opts = {}) {
  const t = todays(); let h = `<div class="slots">`;
  for (let i = 0; i < 3; i++) {
    const it = t[i];
    if (!it) { h += `<div class="slot empty-slot"><span class="rk">${i + 1}</span><h4>${opts.emptyText || "Open slot. Add one from Suggested."}</h4><span></span></div>`; continue; }
    const nx = stepsLeft(it)[0];
    h += `<div class="slot" data-act="peek" data-id="${esc(it.id)}"><span class="rk">${i + 1}</span>
      <div style="min-width:0"><h4>${esc(it.title)}</h4><div class="sub">${esc(it.project || zoneOf(it).name)}${nx ? " · next: " + esc(nx.t) : ""}</div>${nx ? "" : `<button class="linkbtn" data-act="firststep" data-id="${esc(it.id)}">${ico("plus", 13)}Add a 2-minute first step</button>`}
      ${carried(it) && opts.askCarried !== false ? `<div class="ask"><span class="dim" style="font-size:var(--t-sub)">From ${it.todayDate === addDays(-1) ? "yesterday" : "earlier"}.</span>${A.done(it)}<button class="btn sm" data-act="keep" data-id="${esc(it.id)}">Still on it</button>${A.dropTxt(it)}</div>` : ""}</div>
      <div class="ra">${opts.slotActions ? opts.slotActions(it) : `<button class="btn sm icon" data-act="done" data-id="${esc(it.id)}" aria-label="Mark done" title="Done">${ico("check", 20)}</button>${A.untoday(it)}`}</div></div>`;
  }
  return h + `</div>`;
}

/* ============================ HABITS ============================
   Habits aren't tasks: they never get "done", so they live in a daily tick row, not on the board. */
const habitList = () => Object.entries(habits).map(([id, h]) => Object.assign({ id }, h)).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
function streak(h) {
  let n = 0;
  for (let i = 0; i < 400; i++) { const on = h.days && h.days[addDays(-i)]; if (on) n++; else if (i > 0) break; }
  return n;
}
function habitsPanel() {
  const list = habitList(), k = dayKey();
  const doneN = list.filter(h => h.days && h.days[k]).length;
  const chip = h => {
    const on = !!(h.days && h.days[k]), st = streak(h);
    const dots = [6, 5, 4, 3, 2, 1, 0].map(i => `<i class="${h.days && h.days[addDays(-i)] ? "on" : ""} ${i === 0 ? "td" : ""}"></i>`).join("");
    return `<button class="habit ${on ? "on" : ""}" data-act="habit" data-id="${esc(h.id)}" aria-pressed="${on}"><span class="hc">${on ? ico("tick", 16) : ""}</span><span class="hn">${esc(h.title)}</span><span class="hd" aria-hidden="true">${dots}</span>${st > 1 ? `<span class="hs">${st}d</span>` : ""}</button>`;
  };
  return `<section class="panel habits"><div class="ph"><h3>Habits</h3><span class="n">${doneN}/${list.length} today</span><button class="btn sm act" data-act="habitedit">${list.length ? "Edit" : ico("plus", 16) + "Add"}</button></div>
    ${list.length ? `<div class="hrow">${list.map(chip).join("")}</div>` : `<div class="empty">No habits yet. Add the few things you want to do most days.</div>`}</section>`;
}
function toggleHabit(id) {
  const h = habits[id]; if (!h) return; const k = dayKey(), val = !(h.days && h.days[k]);
  h.days = h.days || {}; if (val) h.days[k] = true; else delete h.days[k];
  cacheLocal(); render(); enqueue({ t: "htick", id, date: k, val });
  if (val) toast(streak(h) > 1 ? `${h.title}: ${streak(h)} days in a row.` : `${h.title}: ticked.`);
}
function openHabitEdit() {
  const list = habitList();
  $("#habitRows").innerHTML = list.map(h => `<div class="hedit" data-id="${esc(h.id)}"><input class="field" value="${esc(h.title)}" aria-label="Habit name"><button class="btn sm icon bad" data-act="hrm" aria-label="Remove habit">${ico("x", 18)}</button></div>`).join("");
  $("#habitModal").classList.add("open");
}
function addHabitRow() { $("#habitRows").insertAdjacentHTML("beforeend", `<div class="hedit" data-id=""><input class="field" placeholder="New habit, e.g. 20 min walk" aria-label="Habit name"><button class="btn sm icon bad" data-act="hrm" aria-label="Remove habit">${ico("x", 18)}</button></div>`); $("#habitRows").lastElementChild.querySelector("input").focus(); }
function saveHabits() {
  const rows = [...document.querySelectorAll("#habitRows .hedit")], keep = new Set();
  rows.forEach((r, i) => {
    const title = r.querySelector("input").value.trim(); let id = r.dataset.id;
    if (!title) return;
    if (!id) { id = "h" + Date.now().toString(36) + i; habits[id] = { title, order: i, days: {}, createdAt: nowIso() }; enqueue({ t: "hset", id, doc: habits[id] }); }
    else if (habits[id].title !== title || habits[id].order !== i) { habits[id].title = title; habits[id].order = i; enqueue({ t: "hset", id, doc: { title, order: i } }); }
    keep.add(id);
  });
  Object.keys(habits).forEach(id => { if (!keep.has(id)) { delete habits[id]; enqueue({ t: "hdel", id }); } });
  cacheLocal(); closeModal("#habitModal"); render();
}

/* ============================ FIRST STEP ============================ */
let stepFor = null;
function stepIdeas(it) {
  const t = (it.title || "").toLowerCase(), out = [];
  if (/order|buy|shop|amazon|ikea/.test(t)) out.push("Open the app and add one thing to the cart");
  if (/fix|repair|window|plumb|service/.test(t)) out.push("Find one number to call and save it");
  if (/plan|decide|theme|strategy|scope/.test(t)) out.push("Open a blank note and write 3 bullets");
  if (/design|wireframe|screen|flow|app|ui/.test(t)) out.push("Open the file and duplicate the last frame");
  if (/call|email|message|agni|client|team|loop in/.test(t)) out.push("Write just the first line of the message");
  if (/clothes|clean|sort|bedsheet|room|desk/.test(t)) out.push("Set a 2-min timer and do one small corner");
  if (/print|3d|a1/.test(t)) out.push("Open the model in Bambu Studio");
  if (/build|code|game|claude code|esp/.test(t)) out.push("Open the project and run it once");
  out.push("Open it and look at it for 2 minutes");
  return [...new Set(out)].slice(0, 3);
}
function openStep(id, date) {
  const it = items.find(i => i.id === id); if (!it) return;
  stepFor = { id, date };
  $("#stepCard").textContent = it.title;
  $("#stepIn2").value = "";
  $("#stepIdeas").innerHTML = stepIdeas(it).map(s => `<button type="button" class="btn sm" data-act="stepidea">${esc(s)}</button>`).join("");
  $("#stepGo").textContent = date ? (date === dayKey() ? "Add to today" : "Add to tomorrow") : "Save step";
  $("#stepModal").classList.add("open"); setTimeout(() => $("#stepIn2").focus(), 30);
}
function saveStep() {
  const v = $("#stepIn2").value.trim(); if (!v || !stepFor) { $("#stepIn2").focus(); return; }
  const it = items.find(i => i.id === stepFor.id); if (!it) return;
  save(it.id, { steps: [...(it.steps || []).map(s => ({ ...s })), { t: v, done: false }], touchedAt: nowIso() });
  if (stepFor.date) addTodayNow(it.id, stepFor.date);
  stepFor = null; closeModal("#stepModal");
}

/* ============================ VIEWS: MODES ============================ */
function vPlan() {
  const t = todays(), sug = suggestions(6), dump = inZone("inbox");
  const left = `<section class="panel"><div class="ph"><h3>Today's three</h3><span class="n">${t.length}/3</span></div>${slots()}
      <div class="below"><button class="btn primary lg" data-act="mode" data-m="focus">${ico("target", 18)}Start deep work</button><span class="dim" style="font-size:var(--t-sub)">Hides everything except these.</span></div></section>`;
  const right = panel("Suggested", "", list(sug, it => row(it, A.today(it)), "Nothing waiting. Nice.")) +
    `<div style="height:26px"></div>` +
    panel("Brain dump", dump.length, list(dump.slice(0, 6), it => row(it, A.today(it) + A.drop(it)), "Empty. Press N whenever something pops up."));
  return habitsPanel() + `<div class="grid g2">${left}<div>${right}</div></div>`;
}
function vFocus() {
  const t = todays();
  if (!t.length) return `<div class="grid g2">${panel("Nothing picked for today", "", `<div class="empty">Pick one thing to start with. Just one.</div>` + list(suggestions(5), it => row(it, A.today(it)), ""))}</div>`;
  const cur = t.find(i => i.id === focusId) || t[0]; focusId = cur.id;
  const nx = stepsLeft(cur)[0], idx = t.indexOf(cur);
  const nowCard = `<section class="panel now">
      <div class="eyebrow"><span class="dot"></span>Now · ${idx + 1} of ${t.length}</div>
      <div><h2>${esc(cur.title)}</h2><div class="proj2">${esc(cur.project || zoneOf(cur).name)}${cur.due ? " · due " + fmtDue(cur.due).toLowerCase() : ""}</div></div>
      <div class="nextstep"><span class="lb">Next step</span><span class="tx">${nx ? esc(nx.t) : "Do the first two minutes. That's all."}</span>${nx ? `<button class="btn sm" data-act="stepdone" data-id="${esc(cur.id)}" data-i="${(cur.steps || []).indexOf(nx)}">Done</button>` : `<button class="btn sm" data-act="peek" data-id="${esc(cur.id)}">Add steps</button>`}</div>
      <div class="timer"><div class="ring"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="54" fill="none" stroke="var(--line)" stroke-width="7"/><circle id="arc" cx="60" cy="60" r="54" fill="none" stroke="var(--m-focus)" stroke-width="7" stroke-linecap="round" stroke-dasharray="339.3" stroke-dashoffset="0"/></svg><div class="tm" id="tm">25:00</div></div>
        <div class="tbtns"><button class="btn primary lg" data-act="timer" id="tbtn">${timer.run ? ico("pause", 18) + "Pause" : ico("play", 18) + (timer.left < timer.total ? "Resume" : `Start ${FOCUS_MIN} min`)}</button><button class="btn lg" data-act="plus5">+5 min</button><button class="btn lg good" data-act="done" data-id="${esc(cur.id)}">${ico("check", 18)}I did it</button></div></div>
    </section>`;
  const others = t.filter(i => i !== cur);
  const work = inZone("work").filter(i => !i.today).slice(0, 8);
  const side = panel("Up next", others.length, list(others, it => row(it, `<button class="btn sm" data-act="focuson" data-id="${esc(it.id)}">Switch</button>`), "That's the only one. Good.")) +
    `<div style="height:26px"></div>` + panel("Work queue", work.length, list(work, it => row(it, A.today(it)), "Queue's clear.")) +
    `<div class="note">${ico("moon", 14)}Builds and life are hidden till 7:30 pm. New thoughts go to the brain dump (N).</div>`;
  return `<div class="focusgrid">${nowCard}<div>${side}</div></div>`;
}
function vLow() {
  const easy = openItems().filter(isEasy).sort((a, b) => (b.today ? 1 : 0) - (a.today ? 1 : 0)).slice(0, 12);
  return habitsPanel() + `<div class="grid g2">${panel("Easy wins", easy.length, list(easy, it => row(it, (it.today ? "" : A.today(it)) + A.drop(it)), "No small tasks tagged. Open a card and set Size to 15 min or Energy to Low."))}
    <div>${panel("Today's three", todays().length + "/3", slots({ askCarried: false }))}<div class="note">${ico("battery", 14)}Low energy is normal. One small thing done beats a big thing stared at.</div></div></div>`;
}
function vShutdown() {
  const t = todays(), k = dayKey();
  // cards worked on today (not dumped today) or with every step ticked: likely done but not marked
  const maybe = openItems().filter(it => !it.today && ((dayOf(it.touchedAt) === k && dayOf(it.createdAt) !== k) || ((it.steps || []).length && !stepsLeft(it).length))).slice(0, 6);
  const doneT = doneOn(k), dumpT = inZone("inbox").filter(it => dayOf(it.createdAt) === k);
  const tick = [...t, ...maybe];
  const c1 = panel("Tick what's done", "", `${list(tick, it => row(it, A.done(it) + A.dropTxt(it)), "Nothing open from today.")}${doneT.length ? `<div class="sect" style="padding:14px 16px 4px">Done today · ${doneT.length}</div>` + doneT.map(it => row(it)).join("") : ""}`, `<span class="step act">1</span>`);
  const c2 = panel("Empty your head", "", `<div style="padding:14px"><button class="btn lg" style="width:100%" data-act="dump">${ico("dump", 18)}Dump everything</button><p class="dim" style="font-size:var(--t-sub);margin:10px 4px 2px">One thought per line. It all lands in the brain dump. Sort it another day.</p></div>${dumpT.length ? `<div class="sect" style="padding:14px 16px 4px">Dumped today · ${dumpT.length}</div>` + dumpT.map(it => row(it)).join("") : ""}`, `<span class="step act">2</span>`);
  const fill = 3 - t.length;
  const c3 = panel("Set tomorrow", "", `${slots({ emptyText: "Open slot", askCarried: false, slotActions: it => A.untoday(it) })}
      ${fill > 0 ? `<div class="sect" style="padding:18px 6px 8px">Fill ${fill} more</div>` + list(suggestions(4), it => row(it, A.tomorrow(it)), "") : ""}
      <div style="padding:14px 0 0"><button class="btn primary lg" style="width:100%" data-act="closeday">${ico("moon", 18)}Close the day</button></div>`, `<span class="step act">3</span>`);
  return habitsPanel() + `<div class="grid g3">${c1}${c2}${c3}</div>`;
}
function vFree() {
  const workN = inZone("work").length;
  const b = inZone("builds"), l = inZone("life");
  const pick = [...b, ...l].filter(i => i.energy !== "high").slice(0, 1)[0] || b[0];
  return habitsPanel() + `${pick ? `<section class="panel" style="margin-bottom:26px"><div class="ph"><h3>If you feel like it</h3><span class="n">no pressure</span></div><div class="pb">${row(pick)}</div></section>` : ""}
    <div class="grid g22">${panel("Builds", b.length, list(b, it => row(it, A.drop(it)), "No builds on the desk."))}${panel("Life", l.length, list(l, it => row(it, A.drop(it)), "Nothing here."))}</div>
    <div class="note">${ico("x", 14)}Work is closed. ${workN} work card${workN === 1 ? "" : "s"} will be there tomorrow.</div>`;
}
function vReset() {
  const w = weekStats();
  const quiet = openItems().filter(isStale).sort((a, b) => ago(touched(b)) - ago(touched(a))).slice(0, 8);
  const dump = inZone("inbox");
  const week = addDays(7), due = openItems().filter(it => it.due && it.due <= week).sort((a, b) => a.due.localeCompare(b.due));
  const sortBtns = it => ZONES.filter(z => z.id !== "inbox").map(z => `<button class="btn sm" data-act="zone" data-z="${z.id}" data-id="${esc(it.id)}"><span class="zdot" style="--c:${z.color}"></span>${z.name}</button>`).join("");
  const wins = `<section class="panel"><div class="statline"><span class="big">${w.total}</span><p>things done this week</p></div><div class="pb">${list(w.list.slice(0, 8), it => row(it), "A quiet week. That's allowed.")}</div></section>`;
  return `<div class="grid g22">${wins}
    ${panel("Gone quiet", quiet.length, list(quiet, it => row(it, A.done(it) + A.keep(it) + A.park(it) + A.dropTxt(it)), `Nothing untouched for ${STALE_DAYS}+ days.`))}
    ${panel("Sort the brain dump", dump.length, list(dump, it => row(it, sortBtns(it)), "Brain dump is empty."))}
    ${panel("Due in the next 7 days", due.length, list(due, it => row(it), "Nothing due."))}</div>`;
}
function vSleep() {
  const t = todays();
  return `<div class="sleep"><span class="moon">${ico("moon", 26)}</span><h2>${t.length ? "Tomorrow is set." : "Nothing set for tomorrow. That's fine."}</h2>
    <p class="muted" style="margin:0">You can stop thinking about it now. It's all on the desk.</p>
    ${t.length ? panel("Tomorrow's three", "", t.map(it => row(it)).join("")) : ""}
    ${habitList().length ? `<div style="width:100%;text-align:left">${habitsPanel()}</div>` : ""}
    <button class="btn lg" data-act="dump">${ico("dump", 18)}Mind racing? Dump it here</button></div>`;
}

/* ============================ VIEW: NOW (workstreams) ============================
   Every thread he has going: SUPR projects, active side projects (rank 1-2) and life admin, one tile each.
   He marks a stream active or inactive by tapping its switch; that's saved in items.json under "streams"
   (keys like "w:Zoca", "b:Peeko", "l:life"), so Task Master can flip it too with `desk.py stream`. */
const openStreams = {};
const WHO = ["Agni", "Pani", "Harsh", "Rohan", "client", "brand team"];
const sideRank = it => { const r = parseInt(it.rank, 10); return r > 0 ? r : 99; };
function streams() {
  const open = openItems();
  const activeSide = new Set(open.filter(it => it.zone === "builds" && sideRank(it) <= 2).map(it => it.project || it.title));
  const groups = new Map();
  const add = (k, meta, it) => { if (!groups.has(k)) groups.set(k, Object.assign({ key: k, cards: [] }, meta)); groups.get(k).cards.push(it); };
  open.forEach(it => {
    const z = it.zone || "inbox", pr = it.project || it.title;
    if (z === "work") add("w:" + pr, { name: pr, area: "SUPR", zone: "work", order: 1 }, it);
    else if (z === "builds" && (activeSide.has(pr) || it.today)) add("b:" + pr, { name: pr, area: sideRank(it) < 99 ? `Side project #${sideRank(it)}` : "Side project", zone: "builds", order: 2 + Math.min(sideRank(it), 9) / 10 }, it);
    else if (z === "life") add("l:life", { name: "Life admin", area: "Life", zone: "life", order: 4 }, it);
  });
  const wk = weekStats(), mon = Date.now() - (wk.dow * 864e5) - 864e5;
  return [...groups.values()].map(g => {
    g.cards.sort((a, b) => (b.today ? 1 : 0) - (a.today ? 1 : 0) || (a.todayRank ?? 9) - (b.todayRank ?? 9) || (a.due || "9").localeCompare(b.due || "9") || sideRank(a) - sideRank(b));
    const all = items.filter(it => (g.zone === "life" ? it.zone === "life" : (it.project || it.title) === g.name && it.zone === g.zone));
    const last = Math.max(...all.map(it => Date.parse(it.doneAt || "") || 0), ...g.cards.map(it => Date.parse(touched(it) || "") || 0));
    const hrs = (Date.now() - last) / 36e5;
    g.active = !!(streamState[g.key] && streamState[g.key].active);
    g.last = last;
    g.done = all.filter(it => it.status === "done" && Date.parse(it.doneAt || "") > mon).length;
    g.ago = !last ? "" : hrs < 1 ? "just now" : hrs < 24 ? `${Math.round(hrs)}h ago` : `${Math.round(hrs / 24)}d ago`;
    g.next = g.cards[0];
    g.due = g.cards.map(it => it.due).filter(Boolean).sort()[0] || "";
    g.who = WHO.find(w => g.cards.some(it => (it.title + " " + (it.notes || "")).toLowerCase().includes(w.toLowerCase()))) || "";
    return g;
  }).sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0) || (a.active ? b.last - a.last : a.order - b.order) || a.name.localeCompare(b.name));
}
function viewNow() {
  const ss = streams();
  if (!ss.length) return `<div class="empty">Nothing in motion. Add something with + or tell Task Master.</div>`;
  const tile = g => {
    const nx = g.next, step = nx ? stepsLeft(nx)[0] : null, more = g.cards.slice(1), showAll = openStreams[g.key];
    const zc = ZONE[g.zone] ? ZONE[g.zone].color : "var(--text-3)";
    return `<section class="stream ${g.active ? "on" : "off"}" data-k="${esc(g.key)}" style="--zc:${zc}">
      <div class="sh"><span class="zdot" style="--c:${zc}"></span><span class="sa">${esc(g.area)}</span>
        <button class="switch" role="switch" aria-checked="${g.active}" data-act="streamtoggle" data-k="${esc(g.key)}" aria-label="${esc(g.name)} active"><span class="sl">${g.active ? "Active" : "Inactive"}</span><span class="tr"><i></i></span></button></div>
      <h3>${esc(g.name)}</h3>
      ${nx ? `<button class="snext" data-act="peek" data-id="${esc(nx.id)}"><span class="lb">${nx.today ? "On today" : "Next"}</span><span class="tx">${esc(step ? step.t : nx.title)}</span>${step ? `<span class="of">${esc(nx.title)}</span>` : ""}</button>` : ""}
      ${more.length ? `<div class="smore">${(showAll ? more : more.slice(0, 2)).map(it => `<button class="sitem" data-act="peek" data-id="${esc(it.id)}">${statusIcon(it).replace(/width="24" height="24"/, 'width="18" height="18"')}<span>${esc(it.title)}</span></button>`).join("")}${more.length > 2 ? `<button class="linkbtn" data-act="streammore" data-k="${esc(g.key)}">${showAll ? "Show less" : `+${more.length - 2} more`}</button>` : ""}</div>` : ""}
      <div class="sf"><span>${g.cards.length} open</span>${g.done ? `<span>${g.done} done this week</span>` : ""}${g.who ? `<span>with ${esc(g.who)}</span>` : ""}${g.due ? `<span class="${g.due < dayKey() ? "late" : ""}">due ${fmtDue(g.due).toLowerCase()}</span>` : ""}<span class="ago">${g.ago}</span></div>
    </section>`;
  };
  const on = ss.filter(g => g.active), off = ss.filter(g => !g.active);
  return (on.length ? `<div class="streams">${on.map(tile).join("")}</div>` : `<div class="empty" style="margin-bottom:20px">Nothing marked active. Tap a switch to show what you're working on.</div>`) +
    (off.length ? `<div class="ph" style="margin-top:22px"><h3>Inactive</h3><span class="n">${off.length}</span></div><div class="streams">${off.map(tile).join("")}</div>` : "");
}

/* auto-arrange: tiles pack into columns with no gaps (grid rows of 4px, each tile spans its height),
   and glide to their new spot when the order changes */
function packTiles() {
  document.querySelectorAll(".streams").forEach(g => {
    const gap = 16, row = 4;
    g.querySelectorAll(".stream").forEach(t => { t.style.gridRowEnd = "auto"; const h = t.getBoundingClientRect().height; t.style.gridRowEnd = `span ${Math.ceil((h + gap) / (row + gap))}`; });
  });
}
function tilePos() { const m = {}; document.querySelectorAll(".stream[data-k]").forEach(t => m[t.dataset.k] = t.getBoundingClientRect()); return m; }
function flip(before) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  document.querySelectorAll(".stream[data-k]").forEach(t => {
    const a = before[t.dataset.k]; if (!a) return;
    const b = t.getBoundingClientRect(), dx = a.left - b.left, dy = a.top - b.top;
    if (!dx && !dy) return;
    t.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: 380, easing: "cubic-bezier(.2,.8,.2,1)" });
  });
}
window.addEventListener("resize", () => { if (view === "now") packTiles(); });

/* ============================ VIEWS: SETUP ============================ */
function viewSetup() {
  const bad = gh.token && syncState === "auth";
  return `<div style="max-width:640px">${panel(gh.token && !bad ? "GitHub sync" : "Connect your desk", "", `<div style="padding:20px;display:flex;flex-direction:column;gap:16px">
    <p class="muted" style="margin:0">Brain Desk saves your cards to a private GitHub repo, so Claude can update the same desk from chats and scheduled check-ins. Paste a token once on this device.</p>
    ${bad ? `<p style="margin:0;color:var(--bad)">GitHub refused the token or can't find the repo. Check the details below.</p>` : ""}
    <div class="props"><label class="k" for="ghOwner">GitHub user</label><input class="field" id="ghOwner" value="${esc(gh.owner)}" autocapitalize="off" autocorrect="off">
      <label class="k" for="ghRepo">Data repo</label><input class="field" id="ghRepo" value="${esc(gh.repo)}" autocapitalize="off" autocorrect="off">
      <label class="k" for="ghToken">Token</label><input class="field" id="ghToken" type="password" placeholder="github_pat_…" value="${esc(gh.token)}" autocapitalize="off" autocorrect="off"></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary lg" data-act="connect">Connect</button>${gh.token ? `<button class="btn lg" data-act="disconnect">Forget token on this device</button>` : ""}${gh.token && !bad ? `<button class="btn lg ghost" data-act="view" data-v="now">Back</button>` : ""}</div>
    <div class="sect" style="margin:6px 0 0">Make a token (2 minutes)</div>
    <ol class="muted" style="margin:0;padding-left:20px;line-height:1.7;font-size:var(--t-sub)">
      <li>Open <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener" style="color:var(--accent)">github.com/settings/personal-access-tokens/new</a></li>
      <li>Name it "Brain Desk iPad", expiration: 1 year</li>
      <li>Repository access: <b>Only select repositories</b> → ${esc(gh.repo)}</li>
      <li>Permissions → Repository → <b>Contents: Read and write</b></li>
      <li>Generate, copy, paste above</li>
    </ol>
    <p class="dim" style="margin:0;font-size:var(--t-foot)">The token stays on this device only. It can't touch any other repo.</p></div>`)}</div>`;
}

/* ============================ VIEWS: BOARD / DONE ============================ */
function viewBoard() {
  return `<div class="board" id="board"><div class="cols">${ZONES.map(z => {
    const arr = inZone(z.id).sort((a, b) => (b.today ? 1 : 0) - (a.today ? 1 : 0) || (touched(b) || "").localeCompare(touched(a) || ""));
    return `<div class="col" data-zone="${z.id}"><div class="colh"><span class="zdot" style="--c:${z.color}"></span><h3>${z.name}</h3><span class="n">${arr.length}</span><button class="btn sm icon ghost" data-act="dump" data-z="${z.id}" aria-label="Add to ${z.name}">${ico("plus", 20)}</button></div>
      <div class="cards">${arr.map(it => `<div class="bcard" data-act="peek" data-id="${esc(it.id)}"><div class="bt"><button class="st" data-act="done" data-id="${esc(it.id)}" aria-label="Mark done">${statusIcon(it)}</button><span class="tt">${esc(it.title)}</span></div>
        <div class="bm">${it.project ? `<span class="proj">${esc(it.project)}</span>` : ""}${chips(it)}</div></div>`).join("") || `<div class="empty">Empty</div>`}</div></div>`;
  }).join("")}</div></div>`;
}
function viewDone() {
  const done = items.filter(it => it.status === "done" && it.doneAt && ago(it.doneAt) < 14).sort((a, b) => b.doneAt.localeCompare(a.doneAt));
  const groups = {}; done.forEach(it => { const k = dayOf(it.doneAt); (groups[k] = groups[k] || []).push(it); });
  const label = k => k === dayKey() ? "Today" : k === addDays(-1) ? "Yesterday" : new Date(k + "T00:00").toLocaleDateString("en", { weekday: "long", day: "numeric", month: "short" });
  const dropped = items.filter(it => it.status === "dropped").sort((a, b) => (b.droppedAt || "").localeCompare(a.droppedAt || "")).slice(0, 20);
  const left = Object.keys(groups).length ? Object.entries(groups).map(([k, arr]) => panel(label(k), arr.length, arr.map(it => row(it)).join(""))).join(`<div style="height:22px"></div>`) : panel("Done", "", `<div class="empty">Nothing finished in the last two weeks yet. Tick the circle on any card.</div>`);
  const w = weekStats();
  return `<div class="statline"><span class="big">${w.total}</span><p>done this week</p></div><div class="grid g2"><div>${left}</div>${panel("Let go", dropped.length, list(dropped, it => row(it, `<button class="btn sm" data-act="restore" data-id="${esc(it.id)}">${ico("undo", 16)}Restore</button>`), "Nothing dropped."))}</div>`;
}

/* ============================ PEEK ============================ */
const KINDS = [["task", "Task"], ["project", "Project"], ["idea", "Idea"], ["errand", "Errand"]];
const SIZES = [["S", "15 min"], ["M", "1 hour"], ["L", "Big"]];
const ENERGY = [["low", "Low"], ["high", "High"]];
function openPeek(id) { peekId = id; fillPeek(true); $("#peek").classList.add("open"); $("#scrim").classList.add("open"); }
function closePeek() { flushPeek(); peekId = null; $("#peek").classList.remove("open"); $("#scrim").classList.remove("open"); }
let pkT = null;
function flushPeek() { if (pkT) { clearTimeout(pkT); pkT = null; commitPeek(); } }
function commitPeek() {
  const it = items.find(i => i.id === peekId); if (!it) return;
  const p = {}, t = $("#pkTitle").value.trim(), n = $("#pkNotes").value, pr = $("#pkProj").value.trim();
  if (t && t !== it.title) p.title = t; if (n !== (it.notes || "")) p.notes = n; if (pr !== (it.project || "")) p.project = pr;
  if (Object.keys(p).length) { p.touchedAt = nowIso(); save(peekId, p); }
}
const seg = (opts, val, key, toggle = true) => opts.map(([k, l]) => `<button type="button" data-act="prop" data-k="${key}" data-v="${k}" data-tg="${toggle ? 1 : 0}" aria-pressed="${k === val}">${l}</button>`).join("");
function fillPeek(full) {
  const it = items.find(i => i.id === peekId); if (!it) { closePeek(); return; }
  const z = zoneOf(it);
  $("#pkHead").innerHTML = `<span class="zdot" style="--c:${z.color}"></span><span>${z.name} · added ${new Date(it.createdAt || Date.now()).toLocaleDateString("en", { day: "numeric", month: "short" })}${it.source === "claude" ? " · by Claude" : it.source === "openclaw" ? " · from OpenClaw" : it.source === "obsidian" ? " · from Obsidian" : ""}</span><button class="btn sm icon" data-act="closepeek" aria-label="Close">${ico("x", 20)}</button>`;
  const ae = document.activeElement;
  if (full || ae !== $("#pkTitle")) $("#pkTitle").value = it.title || "";
  if (full || ae !== $("#pkNotes")) $("#pkNotes").value = it.notes || "";
  if (full || ae !== $("#pkProj")) $("#pkProj").value = it.project || "";
  $("#pkDue").value = it.due || "";
  $("#pkStatus").innerHTML = seg([["open", "Open"], ["done", "Done"], ["dropped", "Let go"]], it.status || "open", "status", false);
  $("#pkToday").innerHTML = seg([["yes", "On today"], ["no", "Not today"]], it.today ? "yes" : "no", "today", false);
  $("#pkZone").innerHTML = seg(ZONES.map(z => [z.id, z.name]), it.zone || "inbox", "zone", false);
  $("#pkKind").innerHTML = seg(KINDS, it.kind || "task", "kind", false);
  $("#pkSize").innerHTML = seg(SIZES, it.size || "", "size");
  $("#pkEnergy").innerHTML = seg(ENERGY, it.energy || "", "energy");
  const st = it.steps || [];
  $("#pkSteps").innerHTML = st.length ? st.map((s, i) => `<div class="srow ${s.done ? "done" : ""}"><button class="cb" data-act="step" data-i="${i}" aria-label="Toggle step"><i>${ico("tick", 15)}</i></button><span>${esc(s.t)}</span><button class="btn sm icon ghost" data-act="delstep" data-i="${i}" aria-label="Remove step">${ico("x", 18)}</button></div>`).join("") : `<div class="dim" style="font-size:var(--t-sub);padding:2px 0 6px">Big or vague? Break off one piece you could start in two minutes.</div>`;
}
function onProp(k, v, tg) {
  const it = items.find(i => i.id === peekId); if (!it) return;
  if (k === "status") { if (v === "done") markDone(it.id); else if (v === "dropped") dropIt(it.id); else if (!isOpen(it)) markDone(it.id); return; }
  if (k === "today") { v === "yes" ? addToday(it.id) : removeToday(it.id); return; }
  const cur = it[k] || "";
  save(it.id, { [k]: tg && cur === v ? "" : v, touchedAt: nowIso() });
}

/* ============================ DUMP MODAL ============================ */
let dumpZone = "inbox";
function openDump(z = "inbox") {
  dumpZone = z; $("#dumpTxt").value = ""; renderDumpZones(); $("#dump").classList.add("open");
  setTimeout(() => $("#dumpTxt").focus(), 30);
}
function renderDumpZones() { $("#dumpZones").innerHTML = ZONES.map(z => `<button type="button" data-act="dumpzone" data-z="${z.id}" aria-pressed="${z.id === dumpZone}">${z.name}</button>`).join(""); }
function saveDump() {
  const lines = $("#dumpTxt").value.split("\n").map(s => s.trim()).filter(Boolean); if (!lines.length) { closeModal("#dump"); return; }
  lines.forEach(line => {
    let zone = dumpZone; const m = line.match(/#(work|builds?|life|inbox|dump)\b/i);
    if (m) { const k = m[1].toLowerCase(); zone = k.startsWith("build") ? "builds" : k === "dump" ? "inbox" : k; line = line.replace(m[0], "").replace(/\s{2,}/g, " ").trim(); }
    if (line) create({ title: line.replace(/^[-*•]\s*/, ""), zone });
  });
  closeModal("#dump"); render();
  toast(lines.length === 1 ? `Added to ${ZONE[dumpZone].name}.` : `${lines.length} thoughts out of your head.`);
}
const closeModal = s => $(s).classList.remove("open");

/* ============================ TIMER ============================ */
function drawTimer() {
  const tm = $("#tm"), arc = $("#arc"); if (!tm) return;
  tm.textContent = `${pad(Math.floor(timer.left / 60))}:${pad(timer.left % 60)}`;
  arc.style.strokeDashoffset = 339.3 * (1 - timer.left / timer.total);
}
function toggleTimer() {
  if (timer.run) { clearInterval(timer.run); timer.run = null; }
  else timer.run = setInterval(() => {
    timer.left--; drawTimer();
    if (timer.left <= 0) { clearInterval(timer.run); timer.run = null; timer.left = timer.total = FOCUS_MIN * 60; toast("That's 25 minutes. Stretch, then go again or stop."); render(); }
  }, 1000);
  render();
}

/* ============================ TOAST ============================ */
let tT = null;
function toast(msg, undo) {
  const t = $("#toast"); t.innerHTML = `<span>${esc(msg)}</span>`;
  if (undo) { const b = document.createElement("button"); b.textContent = "Undo"; b.onclick = () => { undo(); t.classList.remove("show"); }; t.appendChild(b); }
  t.classList.add("show"); clearTimeout(tT); tT = setTimeout(() => t.classList.remove("show"), undo ? 5000 : 2400);
}

/* ============================ EVENTS ============================ */
let suppressClick = false;
document.addEventListener("click", e => {
  if (suppressClick) { suppressClick = false; e.preventDefault(); return; }
  const el = e.target.closest("[data-act]");
  if ($("#modes").classList.contains("open") && !e.target.closest("#modes") && !(el && el.dataset.act === "modes")) { closeModes(); if (!el) return; }
  if (!el) return;
  const a = el.dataset.act, id = el.dataset.id;
  switch (a) {
    case "view": closeModes(); view = el.dataset.v; store("view", view); $("#scroll").scrollTop = 0; render(); break;
    case "refresh": refreshNow(); break;
    case "modes": $("#modes").classList.contains("open") ? closeModes() : openModes(); break;
    case "mode": closeModes(); setMode(el.dataset.m); break;
    case "auto": closeModes(); override = null; store("override", null); view = "today"; render(); break;
    case "dump": openDump(el.dataset.z || "inbox"); break;
    case "dumpzone": dumpZone = el.dataset.z; renderDumpZones(); break;
    case "dumpsave": saveDump(); break;
    case "dumpcancel": closeModal("#dump"); break;
    case "peek": openPeek(id); break;
    case "closepeek": closePeek(); break;
    case "done": markDone(id); break;
    case "drop": dropIt(id); break;
    case "keep": keepIt(id); break;
    case "restore": save(id, { status: "open", droppedAt: null, touchedAt: nowIso() }); toast("Back on the desk."); break;
    case "park": { const it = items.find(i => i.id === id); save(id, { touchedAt: nowIso(), notes: ((it.notes || "") + `\nParked ${dayKey()}`).trim() }); toast("Parked. Quiet for another two weeks."); break; }
    case "today": addToday(id); break;
    case "tomorrow": addToday(id, addDays(1)); break;
    case "untoday": removeToday(id); break;
    case "zone": save(id, { zone: el.dataset.z, rx: null, ry: null, touchedAt: nowIso() }); break;
    case "focuson": focusId = id; save(id, { touchedAt: nowIso() }); break;
    case "stepdone": { const it = items.find(i => i.id === id); const st = (it.steps || []).map(s => ({ ...s })); st[+el.dataset.i].done = true; save(id, { steps: st, touchedAt: nowIso() }); break; }
    case "timer": toggleTimer(); break;
    case "plus5": timer.left += 300; timer.total += 300; drawTimer(); break;
    case "closeday": closeDay(); break;
    case "habit": toggleHabit(id); break;
    case "habitedit": openHabitEdit(); break;
    case "hadd": addHabitRow(); break;
    case "hrm": el.closest(".hedit").remove(); break;
    case "hsave": saveHabits(); break;
    case "hcancel": closeModal("#habitModal"); break;
    case "firststep": openStep(id, null); break;
    case "stepidea": $("#stepIn2").value = el.textContent; $("#stepIn2").focus(); break;
    case "stepgo": saveStep(); break;
    case "stepcancel": stepFor = null; closeModal("#stepModal"); break;
    case "connect": {
      gh = { owner: $("#ghOwner").value.trim(), repo: $("#ghRepo").value.trim(), token: $("#ghToken").value.trim() };
      store("owner", gh.owner); store("repo", gh.repo); store("token", gh.token);
      syncState = "idle"; etag = null; view = "now"; store("view", view);
      poll().then(() => { render(); if (syncState !== "auth") { toast("Connected. Your desk is synced."); flush(); } });
      break;
    }
    case "disconnect": gh.token = ""; store("token", ""); render(); break;
    case "prop": onProp(el.dataset.k, el.dataset.v, el.dataset.tg === "1"); break;
    case "step": { const it = items.find(i => i.id === peekId); const st = (it.steps || []).map(s => ({ ...s })); st[+el.dataset.i].done = !st[+el.dataset.i].done; save(peekId, { steps: st, touchedAt: nowIso() }); break; }
    case "delstep": { const it = items.find(i => i.id === peekId); save(peekId, { steps: (it.steps || []).filter((_, i) => i !== +el.dataset.i) }); break; }
    case "peekfocus": { const pid = peekId; closePeek(); if (!items.find(i => i.id === pid).today) addToday(pid); focusId = pid; setMode("focus"); break; }
    case "streamtoggle": { const k = el.dataset.k, on = !(streamState[k] && streamState[k].active); streamState[k] = { active: on, at: nowIso() }; cacheLocal(); render(); enqueue({ t: "sset", id: k, doc: streamState[k] }); break; }
    case "streammore": { const k = el.dataset.k; openStreams[k] = !openStreams[k]; render(); break; }
    case "peekdelete": { const it = items.find(i => i.id === peekId); $("#cMsg").textContent = `Delete "${it.title}" for good? "Let it go" keeps it in Done instead.`; $("#confirm").classList.add("open"); break; }
    case "cno": closeModal("#confirm"); break;
    case "cyes": { const pid = peekId; closeModal("#confirm"); peekId = null; $("#peek").classList.remove("open"); $("#scrim").classList.remove("open"); remove(pid); toast("Deleted."); break; }
  }
});
$("#scrim").addEventListener("click", closePeek);
["#pkTitle", "#pkNotes", "#pkProj"].forEach(s => $(s).addEventListener("input", () => { clearTimeout(pkT); pkT = setTimeout(() => { pkT = null; commitPeek(); }, 700); }));
$("#pkDue").addEventListener("change", () => save(peekId, { due: $("#pkDue").value || "", touchedAt: nowIso() }));
$("#stepForm").addEventListener("submit", e => { e.preventDefault(); const v = $("#stepIn").value.trim(); if (!v) return; const it = items.find(i => i.id === peekId); save(peekId, { steps: [...(it.steps || []).map(s => ({ ...s })), { t: v, done: false }], touchedAt: nowIso() }); $("#stepIn").value = ""; });
$("#stepIn2").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); saveStep(); } });
$("#dumpTxt").addEventListener("keydown", e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveDump(); } });
document.addEventListener("keydown", e => {
  const typing = /INPUT|TEXTAREA/.test(document.activeElement?.tagName);
  if (e.key === "Escape") { if ($("#modes").classList.contains("open")) { closeModes(); return; } if ($("#stepModal").classList.contains("open")) { closeModal("#stepModal"); return; } if ($("#habitModal").classList.contains("open")) { closeModal("#habitModal"); return; } if ($("#confirm").classList.contains("open")) closeModal("#confirm"); else if ($("#dump").classList.contains("open")) closeModal("#dump"); else if (peekId) closePeek(); return; }
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === "n" || e.key === "N") { e.preventDefault(); openDump(); }
  if (e.key === "1") { view = "now"; store("view", view); render(); }
  if (e.key === "2") { view = "today"; store("view", view); render(); }
  if (e.key === "3") { view = "board"; store("view", view); render(); }
  if (e.key === "4") { view = "done"; store("view", view); render(); }
  if (e.key === "r" || e.key === "R") { e.preventDefault(); refreshNow(); }
  if (e.key === "m" || e.key === "M") { e.preventDefault(); $("#modes").classList.contains("open") ? closeModes() : openModes(); }
});

/* swipe on list rows (touch and Pencil): right = done, left = let go. HIG: the buttons stay as the alternative. */
let sw = null;
const SWIPE_AT = 96;
$("#body").addEventListener("pointerdown", e => {
  if (e.pointerType === "mouse") return;
  const r = e.target.closest('.row[data-swipe="1"]'); if (!r || e.target.closest("button")) return;
  sw = { el: r, bg: r.previousElementSibling, id: r.dataset.id, x: e.clientX, y: e.clientY, dx: 0, on: false };
});
window.addEventListener("pointermove", e => {
  if (!sw) return;
  const dx = e.clientX - sw.x, dy = e.clientY - sw.y;
  if (!sw.on) {
    if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { sw = null; return; }
    if (Math.abs(dx) < 12) return;
    sw.on = true; sw.el.classList.add("swiping");
  }
  sw.dx = dx;
  sw.bg.className = "swipe-bg " + (dx > 0 ? "r" : "l");
  sw.bg.innerHTML = dx > 0 ? `<span>${ico("check", 22)}</span><span></span>` : `<span></span><span>${ico("x", 22)}</span>`;
  sw.bg.style.opacity = Math.min(1, Math.abs(dx) / SWIPE_AT);
  sw.el.style.transform = `translateX(${dx}px)`;
});
function endSwipe(cancel) {
  if (!sw) return;
  const s = sw; sw = null;
  if (!s.on) return;
  suppressClick = true; setTimeout(() => suppressClick = false, 60);
  s.el.classList.remove("swiping");
  if (!cancel && Math.abs(s.dx) >= SWIPE_AT) {
    s.el.style.transform = `translateX(${s.dx > 0 ? "110%" : "-110%"})`;
    setTimeout(() => (s.dx > 0 ? markDone : dropIt)(s.id), 180);
  } else { s.el.style.transform = ""; }
}
window.addEventListener("pointerup", () => endSwipe(false));
window.addEventListener("pointercancel", () => endSwipe(true));

/* board drag: mouse drags after 5px; touch needs a short press so scrolling still works */
let drag = null;
const bodyEl = $("#body");
bodyEl.addEventListener("pointerdown", e => {
  const c = e.target.closest(".bcard"); if (!c || e.target.closest("button")) return;
  drag = { id: c.dataset.id, el: c, x: e.clientX, y: e.clientY, started: false, touch: e.pointerType !== "mouse", pid: e.pointerId };
  if (drag.touch) drag.hold = setTimeout(() => startDrag(e.clientX, e.clientY), 260);
});
function startDrag(x, y) {
  if (!drag) return; drag.started = true;
  const r = drag.el.getBoundingClientRect(), g = drag.el.cloneNode(true);
  g.classList.add("dragghost"); g.style.width = r.width + "px"; g.style.left = r.left + "px"; g.style.top = r.top + "px";
  drag.dx = x - r.left; drag.dy = y - r.top; drag.ghost = g; document.body.appendChild(g); drag.el.classList.add("lifted");
  if (navigator.vibrate) try { navigator.vibrate(8); } catch (e) {}
}
window.addEventListener("pointermove", e => {
  if (!drag) return;
  const d = Math.hypot(e.clientX - drag.x, e.clientY - drag.y);
  if (!drag.started) { if (drag.touch) { if (d > 8) { clearTimeout(drag.hold); drag = null; } return; } if (d < 5) return; startDrag(e.clientX, e.clientY); }
  drag.ghost.style.left = (e.clientX - drag.dx) + "px"; drag.ghost.style.top = (e.clientY - drag.dy) + "px";
  const col = document.elementFromPoint(e.clientX, e.clientY)?.closest(".col");
  document.querySelectorAll(".col").forEach(c => c.classList.toggle("drop", c === col));
});
window.addEventListener("pointerup", e => {
  if (!drag) return; clearTimeout(drag.hold);
  if (drag.started) {
    const col = document.elementFromPoint(e.clientX, e.clientY)?.closest(".col");
    drag.ghost.remove(); drag.el.classList.remove("lifted"); document.querySelectorAll(".col.drop").forEach(c => c.classList.remove("drop"));
    suppressClick = true; setTimeout(() => suppressClick = false, 50);
    const it = items.find(i => i.id === drag.id);
    if (col && it && col.dataset.zone !== it.zone) { save(it.id, { zone: col.dataset.zone, rx: null, ry: null, touchedAt: nowIso() }); toast(`Moved to ${ZONE[col.dataset.zone].name}.`); }
  }
  drag = null;
});
window.addEventListener("pointercancel", () => { if (drag) { clearTimeout(drag.hold); drag.ghost?.remove(); drag.el.classList.remove("lifted"); } drag = null; });
document.addEventListener("touchmove", e => { if (drag && drag.started) e.preventDefault(); }, { passive: false });

/* ============================ BOOT ============================ */
let lastMode = currentMode();
setInterval(() => {
  const c = $("#clk"); if (c) c.textContent = new Date().toLocaleTimeString("en", { hour: "numeric", minute: "2-digit" });
  updateTimeLeft();
  const m = currentMode(); if (m !== lastMode) { lastMode = m; render(); }
}, 15000);
render();
items = recall("cache", []); habits = recall("hcache", {}); streamState = recall("scache", {}); loaded = items.length > 0; render();
if (gh.token) { poll().then(render); }
setInterval(poll, POLL_MS);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") poll(true).then(render); });
window.addEventListener("pageshow", () => poll(true).then(render));   // home-screen app coming back from the background
window.addEventListener("focus", () => poll(true).then(render));
/* pull down from the top to refresh */
(() => {
  const sc = $("#scroll"), pull = document.createElement("div"); pull.className = "pull"; pull.innerHTML = ico("refresh", 20); document.body.appendChild(pull);
  let y0 = null, dy = 0;
  sc.addEventListener("touchstart", e => { y0 = sc.scrollTop <= 0 && e.touches.length === 1 ? e.touches[0].clientY : null; dy = 0; }, { passive: true });
  sc.addEventListener("touchmove", e => { if (y0 === null) return; dy = Math.max(0, e.touches[0].clientY - y0); pull.style.opacity = Math.min(1, dy / 90); pull.style.transform = `translate(-50%, ${Math.min(dy, 110) * .6}px) rotate(${dy * 2}deg)`; }, { passive: true });
  sc.addEventListener("touchend", () => { if (y0 !== null && dy > 90) refreshNow(); y0 = null; pull.style.opacity = 0; pull.style.transform = ""; });
})();
window.addEventListener("online", () => { flush(); poll(); });
})();
