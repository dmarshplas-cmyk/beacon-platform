/* demo.js — a deterministic demo estate served in place of the API when
   config.json has "demo": true. Shapes match el-api-handler responses exactly,
   so views never know the difference. Fictional housing provider, fictional
   sites. Seeded PRNG → identical estate every load. */

const SEED = 20260924;
let s = SEED;
const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const NOW = Date.now();
const DAY = 86400000;
const iso = (ms) => new Date(ms).toISOString();

const SITES = [
  ["ty-gwyn-court", "Ty Gwyn Court", "Newtown", "SY16 2AB", 52.5132, -3.3141, 24, "block"],
  ["maesyrhaf", "Maes-yr-Haf", "Llanidloes", "SY18 6BN", 52.4491, -3.5386, 12, "block"],
  ["bryn-awel", "Bryn Awel", "Welshpool", "SY21 7RA", 52.6597, -3.1476, 18, "block"],
  ["dolafon-house", "Dolafon House", "Newtown", "SY16 1DU", 52.5111, -3.3092, 30, "high-rise"],
  ["cae-glas", "Cae Glas", "Machynlleth", "SY20 8AE", 52.5904, -3.8515, 8, "block"],
  ["parc-hafren", "Parc Hafren", "Caersws", "SY17 5EE", 52.5170, -3.4321, 10, "block"],
  ["plas-derwen", "Plas Derwen", "Montgomery", "SY15 6PA", 52.5605, -3.1481, 14, "block"],
  ["heol-y-castell", "Heol-y-Castell", "Welshpool", "SY21 7JZ", 52.6578, -3.1489, 16, "block"],
  ["llys-hafan", "Llys Hafan", "Newtown", "SY16 4HG", 52.5087, -3.3299, 22, "sheltered"],
  ["cwrt-y-felin", "Cwrt-y-Felin", "Llanfair Caereinion", "SY21 0RX", 52.6499, -3.3255, 9, "block"],
  ["hafod-office", "Hafod Office", "Newtown", "SY16 1AA", 52.5145, -3.3160, 20, "office"],
  ["glan-yr-afon", "Glan-yr-Afon", "Llanidloes", "SY18 6EZ", 52.4478, -3.5402, 12, "block"],
  ["bro-ddyfi", "Bro Ddyfi", "Machynlleth", "SY20 8DR", 52.5920, -3.8530, 11, "sheltered"],
  ["tan-y-bryn", "Tan-y-Bryn", "Caersws", "SY17 5DR", 52.5162, -3.4290, 7, "block"],
  ["sinema-maldwyn", "Sinema Maldwyn", "Newtown", "SY16 2NP", 52.5168, -3.3205, 26, "cinema"],
];
const WINDOWS = {
  "sinema-maldwyn": { days: [0, 1, 2, 3, 4, 5, 6], start: "08:00", end: "13:00", blackouts: [{ from: "2026-12-18", to: "2027-01-03", reason: "Christmas screenings — all-day programme" }], duration_gap_hours: 24, preset: "cinema", note: "Agreed with the duty manager. Doors open 13:30." },
  "hafod-office": { days: [1, 2, 3, 4, 5], start: "19:00", end: "06:30", blackouts: [], duration_gap_hours: 24, preset: "office", note: "" },
  "dolafon-house": { days: [0, 1, 2, 3, 4, 5, 6], start: "01:00", end: "05:00", blackouts: [], duration_gap_hours: 24, preset: "residential", note: "" },
  "llys-hafan": { days: [0, 1, 2, 3, 4, 5, 6], start: "01:00", end: "05:00", blackouts: [], duration_gap_hours: 24, preset: "residential", note: "Sheltered scheme — warden informed" },
  "ty-gwyn-court": { days: [0, 1, 2, 3, 4, 5, 6], start: "01:00", end: "05:00", blackouts: [], duration_gap_hours: 24, preset: "residential", note: "" },
};
const LOCS = ["Ground floor corridor", "First floor corridor", "Second floor corridor", "Stair core A", "Stair core B", "Main entrance", "Rear exit", "Plant room", "Bin store", "Lift lobby", "Community room", "Laundry", "Car park entrance", "Fire exit east", "Fire exit west", "Third floor corridor", "Roof access", "Reception", "Kitchen exit"];

// Per-site "story" knobs so the estate isn't uniformly green.
const STORY = {
  "dolafon-house": { overdueFn: 0.15, failDur: 2, stale: 1, lamp: 1 },
  "maesyrhaf": { overdueFn: 1.0 },                // whole block overdue — comms outage at the gateway
  "bryn-awel": { marginal: 3, mains: 1 },
  "llys-hafan": { failDur: 1, batt: 2 },
  "hafod-office": { stale: 2 },
  "glan-yr-afon": { stale: 11 },        // whole block silent — gateway down
  "cae-glas": { neverDur: 1 },
};

function buildLuminaire(site, i, story) {
  const id = `${site.site_id}-el-${String(i + 1).padStart(2, "0")}`;
  const rated = site.kind === "high-rise" ? 180 : pick([180, 180, 180, 60]);
  const lum = { luminaire_id: id, site_id: site.site_id, tenant_id: "cambrian", name: `EL-${String(i + 1).padStart(2, "0")}`, location: LOCS[i % LOCS.length],
    dev_eui: `70B3D5${(SEED + i * 7919 + site.site_id.length * 131).toString(16).toUpperCase().slice(-10).padStart(10, "0")}`,
    rated_minutes: rated, install_date: iso(NOW - (400 + Math.floor(rnd() * 900)) * DAY).slice(0, 10), battery_date: null, control_enabled: true, codec: "hbi" };
  lum.battery_date = iso(Date.parse(lum.install_date) + Math.floor(rnd() * 200) * DAY).slice(0, 10);

  // --- test history: monthly function tests for 14 months, one duration test per year
  const tests = [];
  const overdueFn = rnd() < (story.overdueFn || 0.02);
  const skipMonths = overdueFn ? 1 + Math.floor(rnd() * 2) : 0;   // overdue fittings missed the last 1–2 scheduled tests
  const dom = site.test_schedule.function.day_of_month;
  const now = new Date(NOW);
  let lastFnDays = null;
  for (let m = 0; m < 15; m++) {
    const at = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - m, dom, 2, 0) + i * 90000; // 02:00, staggered 90 s per fitting
    if (at > NOW) continue;                       // this month's test hasn't happened yet
    if (tests.length < skipMonths) { tests.push(null); continue; } // placeholder to count skips
    tests.push({ kind: "TEST", test_type: "function", result: "pass", started_at: iso(at - 60000), finished_at: iso(at), achieved_min: 1, rated_min: rated, battery_mv: 4050 + Math.floor(rnd() * 200), flags: [], source: "automatic" });
    if (lastFnDays === null) lastFnDays = Math.floor((NOW - at) / DAY);
  }
  for (let k = tests.length - 1; k >= 0; k--) if (tests[k] === null) tests.splice(k, 1);
  // duration tests
  const neverDur = story.neverDur && i < story.neverDur;
  const failDur = story.failDur && i >= 2 && i < 2 + story.failDur;
  const marginal = story.marginal && i >= 5 && i < 5 + story.marginal;
  const durAgeDays = 20 + Math.floor(rnd() * 300);
  if (!neverDur) {
    for (let y = 0; y < 3; y++) {
      const at = NOW - (durAgeDays + y * 365) * DAY;
      let achieved = rated + 18 + Math.floor(rnd() * 40) - y * 6;
      let result = "pass", reason = null, flags = [];
      if (y === 0 && failDur) { achieved = rated - 25 - Math.floor(rnd() * 30); result = "fail"; reason = `achieved ${achieved} min of ${rated} min rated`; flags = ["battery_exhausted_duration"]; }
      else if (y === 0 && marginal) { achieved = rated + 2 + Math.floor(rnd() * 5); result = "pass-marginal"; reason = `only ${achieved - rated} min above rated — battery nearing end of life`; }
      tests.push({ kind: "TEST", test_type: "duration", result, reason, started_at: iso(at - achieved * 60000), finished_at: iso(at), achieved_min: achieved, rated_min: rated, battery_mv: 3900 + Math.floor(rnd() * 250), flags, source: "automatic" });
    }
  }
  tests.sort((a, b) => (a.finished_at < b.finished_at ? 1 : -1));

  // --- faults
  const faults = [];
  const lamp = story.lamp && i === 4;
  if (lamp) faults.push({ kind: "FAULT", opened_at: iso(NOW - 2 * DAY - 3600000 * 5), status: "open", subsystem: "lamp", subsystems: ["lamp"], flags: ["lamp_failure"], summary: "Lamp failure", severity: "alert" });
  if (failDur) faults.push({ kind: "FAULT", opened_at: tests.find((t) => t.test_type === "duration").finished_at, status: "open", subsystem: "battery", subsystems: ["battery"], flags: ["battery_exhausted_duration"], summary: "Battery exhausted before rated duration", severity: "alert" });
  const stale = story.stale && i >= 1 && i < 1 + story.stale;
  if (stale) faults.push({ kind: "FAULT", opened_at: iso(NOW - 2 * DAY), status: "open", subsystem: "comms", subsystems: ["comms"], flags: [], summary: `No report since ${iso(NOW - 3.6 * DAY).slice(0, 16).replace("T", " ")}`, severity: "warn" });
  const batt = story.batt && i >= 8 && i < 8 + story.batt;
  if (batt) faults.push({ kind: "FAULT", opened_at: iso(NOW - 6 * DAY), status: "acknowledged", acked_by: "d.marsh", acked_at: iso(NOW - 5 * DAY), ack_note: "Battery replacement ordered", subsystem: "battery", subsystems: ["battery"], flags: ["battery_charge_low"], summary: "Battery not holding charge", severity: "warn" });
  const mains = story.mains && i === 0;
  if (mains) faults.push({ kind: "FAULT", opened_at: iso(NOW - 9 * DAY), status: "closed", closed_at: iso(NOW - 9 * DAY + 47 * 60000), closed_by: "device", close_note: "Mains restored after 47 min", subsystem: "mains", subsystems: ["mains"], flags: [], summary: "Mains supply lost — luminaire running on battery", severity: "warn" });
  // an old closed lamp fault on some, for history
  if (rnd() < 0.08) faults.push({ kind: "FAULT", opened_at: iso(NOW - (60 + Math.floor(rnd() * 200)) * DAY), status: "closed", closed_at: iso(NOW - 58 * DAY), closed_by: "j.pryce", close_note: "Replaced luminaire", remedial_action: "Luminaire replaced", subsystem: "lamp", subsystems: ["lamp"], flags: ["lamp_failure"], summary: "Lamp failure", severity: "alert" });
  faults.sort((a, b) => (a.opened_at < b.opened_at ? 1 : -1));

  // --- latest + state
  const lastSeen = stale ? NOW - 3.6 * DAY : NOW - Math.floor(rnd() * 20) * 3600000;
  const battery_mv = batt ? 3250 : 3950 + Math.floor(rnd() * 350);
  const latest = { ts: iso(lastSeen), type: "status", charger: batt ? "full" : "trickle", battery_mv, board_temp_c: 14 + Math.floor(rnd() * 9), days_since_function_test: lastFnDays, days_since_duration_test: neverDur ? 0 : durAgeDays, last_duration_test_min: neverDur ? 0 : tests.find((t) => t.test_type === "duration")?.achieved_min, led_intensity: 12, rssi: -70 - Math.floor(rnd() * 40), snr: Math.round((rnd() * 12 - 2) * 10) / 10 };

  const fn = tests.find((t) => t.test_type === "function"), du = tests.find((t) => t.test_type === "duration");
  const due = (last, interval, grace) => {
    if (!last) return { status: "never", days_since: null, due_in_days: 0, due_at: null };
    const l = Date.parse(last.finished_at), dueAt = l + interval * DAY, since = Math.floor((NOW - l) / DAY), dueIn = Math.ceil((dueAt - NOW) / DAY);
    const status = NOW > dueAt + grace * DAY ? "overdue" : NOW > dueAt ? "due" : dueIn <= 7 ? "due-soon" : "ok";
    return { status, days_since: since, due_in_days: dueIn, due_at: iso(dueAt) };
  };
  const fnDue = due(fn, 31, 7), duDue = due(du, 365, 30);
  const open = faults.filter((f) => f.status === "open" || f.status === "acknowledged");
  const sum = (t) => (t ? { at: t.finished_at, result: t.result, achieved_min: t.achieved_min, reason: t.reason } : null);
  let status = "ok";
  if (open.some((f) => f.severity === "alert") || du?.result === "fail") status = "alert";
  else if (fnDue.status === "overdue" || duDue.status === "overdue" || stale || open.length || fnDue.status === "due" || duDue.status === "due" || du?.result === "pass-marginal" || duDue.status === "never" || battery_mv < 3300) status = "warn";
  const state = { luminaire_id: id, status, comms: stale ? "stale" : "ok", last_seen: latest.ts, charger: latest.charger, battery_mv, battery_low: battery_mv < 3300, board_temp_c: latest.board_temp_c,
    function_test: { ...fnDue, last: sum(fn) }, duration_test: { ...duDue, last: sum(du), rated_min: rated }, counter_gap: null, open_faults: open.length,
    worst_fault: open.some((f) => f.severity === "alert") ? "alert" : open.length ? "warn" : null };

  return { lum, tests, faults, latest, state };
}

function monthGrid(tests, year) {
  const out = [];
  for (let m = 0; m < 12; m++) {
    const start = Date.UTC(year, m, 1), end = Date.UTC(year, m + 1, 1);
    const inM = tests.filter((t) => t.test_type === "function" && Date.parse(t.finished_at) >= start && Date.parse(t.finished_at) < end);
    out.push(start > NOW ? "future" : !inM.length ? (end > NOW ? "pending" : "missed") : inM.some((t) => t.result.startsWith("pass")) ? "pass" : "fail");
  }
  return out;
}

// ---------------- build the estate ----------------
const YEAR = new Date(NOW).getUTCFullYear();
const DB = { sites: {}, lums: {}, siteStates: {} };
for (const [site_id, name, town, postcode, lat, lng, count, kind] of SITES) {
  const site = { site_id, tenant_id: "cambrian", name, kind, address: { line1: name, town, postcode }, gps: { lat, lng }, tz: "Europe/London",
    test_window: WINDOWS[site_id] || null,
    test_schedule: { function: { day_of_month: 1 + (site_id.length % 20) } } }; // only used to place the simulated automatic tests
  const story = STORY[site_id] || {};
  const lums = Array.from({ length: count }, (_, i) => buildLuminaire(site, i, story));
  DB.sites[site_id] = site;
  for (const l of lums) DB.lums[l.lum.luminaire_id] = l;
  const states = lums.map((l) => l.state);
  const n = states.length, cnt = (f) => states.filter(f).length;
  const overdue = cnt((x) => x.function_test.status === "overdue" || x.duration_test.status === "overdue");
  const due = cnt((x) => ["due", "due-soon"].includes(x.function_test.status) || ["due", "due-soon"].includes(x.duration_test.status));
  const failed = cnt((x) => x.duration_test.last?.result === "fail" || x.function_test.last?.result === "fail");
  const alerts = cnt((x) => x.status === "alert"), warns = cnt((x) => x.status === "warn"), stale = cnt((x) => x.comms !== "ok");
  const compliant = n - cnt((x) => x.status !== "ok");
  const grids = lums.map((l) => monthGrid(l.tests, YEAR));
  const grid = Array.from({ length: 12 }, (_, m) => { const c = grids.map((g) => g[m]); return c.includes("fail") ? "fail" : c.includes("missed") ? "missed" : c.includes("pending") ? "pending" : c.every((x) => x === "future") ? "future" : "pass"; });
  DB.siteStates[site_id] = { luminaires: n, compliant, compliant_pct: Math.round((compliant / n) * 1000) / 10, overdue, due, failed, open_faults: states.reduce((a, x) => a + x.open_faults, 0), stale, alerts, warns,
    status: alerts || overdue || failed ? "alert" : warns || due || stale ? "warn" : "ok", month_grid: grid, computed_at: iso(NOW - 3 * 3600000) };
}


const SCHEDULES = [
  { schedule_id: "cin-fn", tenant_id: "cambrian", name: "Function test — cinema, 1st Tuesday", scope: { site_id: "sinema-maldwyn" }, scope_name: "Sinema Maldwyn", test_type: "function", recurrence: { kind: "monthly-nth-weekday", nth: 1, weekday: 2 }, time: "09:30", tz: "Europe/London", stagger_window_min: 30, enabled: true, note: "Fittings' own clocks fire at 02:00 — the manager wants a daytime test on record each month", created_by: "d.marsh", created_at: iso(NOW - 40 * DAY), last_run_at: iso(NOW - 25 * DAY) },
  { schedule_id: "cin-dur", tenant_id: "cambrian", name: "Duration test — cinema, annual", scope: { site_id: "sinema-maldwyn" }, scope_name: "Sinema Maldwyn", test_type: "duration", recurrence: { kind: "annual", month: 2, day_of_month: 10 }, time: "08:30", tz: "Europe/London", stagger_window_min: 45, enabled: true, note: "Before the February half-term programme", created_by: "d.marsh", created_at: iso(NOW - 40 * DAY) },
  { schedule_id: "haf-dur", tenant_id: "cambrian", name: "Duration test — Hafod Office", scope: { site_id: "hafod-office" }, scope_name: "Hafod Office", test_type: "duration", recurrence: { kind: "annual", month: 11, day_of_month: 14 }, time: "19:30", tz: "Europe/London", stagger_window_min: 60, enabled: false, note: "Paused until the gateway swap is done", created_by: "n.sacke", created_at: iso(NOW - 10 * DAY) },
];
const toMin = (hm) => { const [h, m] = hm.split(":").map(Number); return h * 60 + (m || 0); };
const localParts = (ms, tz = "Europe/London") => { const f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false }); const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value])); const hour = p.hour === "24" ? 0 : Number(p.hour); return { ymd: `${p.year}-${p.month}-${p.day}`, y: Number(p.year), m: Number(p.month), d: Number(p.day), minutes: hour * 60 + Number(p.minute), dow: { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[p.weekday] }; };
const localToMs = (y, m, d, hm, tz = "Europe/London") => { const [H, M] = hm.split(":").map(Number); let g = Date.UTC(y, m - 1, d, H, M); for (let i = 0; i < 3; i++) { const p = localParts(g, tz); const diff = Date.UTC(p.y, p.m - 1, p.d, Math.floor(p.minutes / 60), p.minutes % 60) - Date.UTC(y, m - 1, d, H, M); if (!diff) break; g -= diff; } return g; };
function inWindow(w, ms, tz) { if (!w) return { ok: true }; const p = localParts(ms, tz); const s0 = toMin(w.start), e0 = toMin(w.end), crosses = e0 <= s0; let dayOf = p.dow, inHours; if (!crosses) inHours = p.minutes >= s0 && p.minutes < e0; else if (p.minutes >= s0) inHours = true; else if (p.minutes < e0) { inHours = true; dayOf = (p.dow + 6) % 7; } else inHours = false; if (!inHours) return { ok: false, reason: `outside testing hours (${w.start}–${w.end})` }; if (!w.days.includes(dayOf)) return { ok: false, reason: "not an allowed day" }; const ymd = crosses && p.minutes < e0 ? localParts(ms - DAY, tz).ymd : p.ymd; const bo = (w.blackouts || []).find((b) => ymd >= b.from && ymd <= b.to); if (bo) return { ok: false, reason: `blackout: ${bo.reason || bo.from}` }; return { ok: true }; }
function nextSlot(w, from, tz, need) { if (!w) return from; for (let i = 0; i < 60; i++) { const p = localParts(from + i * DAY, tz); const cands = i === 0 && inWindow(w, from, tz).ok ? [from] : []; cands.push(localToMs(p.y, p.m, p.d, w.start, tz)); for (const c of cands) { if (c < from || !inWindow(w, c, tz).ok) continue; if (need && !inWindow(w, c + need * 60000 - 60000, tz).ok) continue; return c; } } return null; }
const nthWeekday = (y, m, nth, wd) => { if (nth > 0) { const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); return 1 + ((wd - first + 7) % 7) + (nth - 1) * 7; } const dim = new Date(Date.UTC(y, m, 0)).getUTCDate(); const last = new Date(Date.UTC(y, m - 1, dim)).getUTCDay(); return dim - ((last - wd + 7) % 7); };
function occurrences(sch, from, count) { const r = sch.recurrence, out = [], p = localParts(from, sch.tz); const push = (y, m, d) => { const at = localToMs(y, m, d, sch.time, sch.tz); if (at > from) out.push(at); }; if (r.kind === "monthly-dom" || r.kind === "monthly-nth-weekday") for (let i = 0; out.length < count && i < count + 2; i++) { let y = p.y, m = p.m + i; while (m > 12) { m -= 12; y++; } push(y, m, r.kind === "monthly-dom" ? r.day_of_month : nthWeekday(y, m, r.nth, r.weekday)); } else if (r.kind === "annual") for (let i = 0; out.length < count && i < count + 1; i++) push(p.y + i, r.month, r.day_of_month); else if (r.kind === "weekly") for (let i = 0; out.length < count && i < (count + 1) * 7; i++) { const q = localParts(from + i * DAY, sch.tz); if (q.dow === r.weekday) push(q.y, q.m, q.d); } else if (r.kind === "interval") { const [ay, am, ad] = (r.anchor || iso(NOW).slice(0, 10)).split("-").map(Number); let at = localToMs(ay, am, ad, sch.time, sch.tz); while (at <= from) at += r.interval_days * DAY; for (let i = 0; i < count; i++) { out.push(at); at += r.interval_days * DAY; } } return out.slice(0, count); }
const ord = (n) => (n === -1 ? "last" : `${n}${["th", "st", "nd", "rd"][(n % 10 > 3 || Math.floor(n % 100 / 10) === 1) ? 0 : n % 10]}`);
const WDN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"], MNN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const describe = (r, t) => r.kind === "monthly-dom" ? `Monthly on the ${ord(r.day_of_month)} at ${t}` : r.kind === "monthly-nth-weekday" ? `Monthly on the ${ord(r.nth)} ${WDN[r.weekday]} at ${t}` : r.kind === "annual" ? `Every ${ord(r.day_of_month)} ${MNN[r.month - 1]} at ${t}` : r.kind === "weekly" ? `Every ${WDN[r.weekday]} at ${t}` : `Every ${r.interval_days} days at ${t}`;
const PRESETS = { residential: { label: "Residential — overnight", days: [0,1,2,3,4,5,6], start: "01:00", end: "05:00" }, office: { label: "Office — evenings and weekends", days: [0,1,2,3,4,5,6], start: "19:00", end: "06:30" }, cinema: { label: "Cinema / theatre — mornings before opening", days: [0,1,2,3,4,5,6], start: "08:00", end: "13:00" }, retail: { label: "Retail — before opening", days: [0,1,2,3,4,5,6], start: "05:30", end: "08:30" }, school: { label: "School — weekends and holidays", days: [0,6], start: "08:00", end: "18:00" }, healthcare: { label: "Healthcare — any time, by agreement", days: [0,1,2,3,4,5,6], start: "00:00", end: "23:59" }, always: { label: "No restriction", days: [0,1,2,3,4,5,6], start: "00:00", end: "23:59" } };
const schedOut = (sch) => { const site = DB.sites[sch.scope.site_id]; const next = occurrences(sch, Date.now(), 3); const bad = next.map((at) => ({ at, c: inWindow(site?.test_window, at, sch.tz) })).filter((x) => !x.c.ok); return { ...sch, description: describe(sch.recurrence, sch.time), next: next.map((n) => iso(n)), window_check: { ok: !bad.length, problems: bad.map((x) => `${iso(x.at).slice(0, 16)}: ${x.c.reason}`) } }; };
const JOBS = [
  { job_id: "a1b2c3d4", tenant_id: "cambrian", test_type: "duration", scope: { site_id: "dolafon-house" }, scope_name: "Dolafon House", run_at: iso(localToMs(...iso(NOW + 9 * DAY).slice(0, 10).split("-").map(Number), "02:30")), stagger_window_min: 60, note: "Re-test after battery swaps on EL-03/04", status: "pending", created_by: "d.marsh", created_at: iso(NOW - DAY), dispatched: [], held: [], skipped: [] },
  { job_id: "e5f6a7b8", tenant_id: "cambrian", test_type: "function", scope: { site_id: "maesyrhaf" }, scope_name: "Maes-yr-Haf", run_at: iso(NOW - 3 * DAY), stagger_window_min: 30, note: "Gateway back — confirm every fitting still tests", status: "done", created_by: "n.sacke", created_at: iso(NOW - 4 * DAY), dispatched: Array.from({ length: 12 }, (_, i) => `maesyrhaf-el-${String(i + 1).padStart(2, "0")}`), held: [], skipped: [], finished_at: iso(NOW - 3 * DAY + 3600000) },
];
const deviceNext = (latest) => ({ function_in_days: Math.max(0, 31 - (latest.days_since_function_test ?? 0)), duration_in_days: latest.days_since_duration_test != null ? Math.max(0, 365 - latest.days_since_duration_test) : null });

// ---------------- API surface ----------------
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const pub = ({ pk, sk, entity_type, ...rest }) => rest;

export async function demoGet(path) {
  await wait(120 + rnd() * 200);
  let m;
  if (/^\/api\/portfolio/.test(path)) {
    const sites = Object.values(DB.sites).map((s) => ({ ...DB.siteStates[s.site_id], site_id: s.site_id, name: s.name, kind: s.kind, address: s.address, gps: s.gps, tz: s.tz, test_window: s.test_window }));
    const t = sites.reduce((a, x) => ({ sites: a.sites + 1, luminaires: a.luminaires + x.luminaires, compliant: a.compliant + x.compliant, overdue: a.overdue + x.overdue, failed: a.failed + x.failed, open_faults: a.open_faults + x.open_faults,
      sites_alert: a.sites_alert + (x.status === "alert"), sites_warn: a.sites_warn + (x.status === "warn") }), { sites: 0, luminaires: 0, compliant: 0, overdue: 0, failed: 0, open_faults: 0, sites_alert: 0, sites_warn: 0 });
    return { tenant: "cambrian", totals: [{ tenant_id: "cambrian", ...t, compliant_pct: Math.round((t.compliant / t.luminaires) * 1000) / 10, computed_at: iso(NOW - 3 * 3600000) }], sites };
  }
  if ((m = /^\/api\/sites\/([^/]+)\/days/.exec(path))) {
    const st = DB.siteStates[m[1]]; if (!st) throw new Error("not found");
    const days = Array.from({ length: 90 }, (_, i) => ({ day: iso(NOW - i * DAY).slice(0, 10), compliant_pct: Math.min(100, Math.max(60, st.compliant_pct + Math.round((rnd() - 0.5) * 6) + (i > 40 ? -4 : 0))) }));
    return { site_id: m[1], days };
  }
  if ((m = /^\/api\/sites\/([^/]+)$/.exec(path))) {
    const site = DB.sites[m[1]]; if (!site) throw new Error("not found");
    const luminaires = Object.values(DB.lums).filter((l) => l.lum.site_id === site.site_id).map((l) => ({ ...l.lum, state: l.state, device_next: deviceNext(l.latest) }));
    const jobs = JOBS.filter((j) => j.scope.site_id === site.site_id || luminaires.some((l) => l.luminaire_id === j.scope.luminaire_id));
    return { site, state: DB.siteStates[site.site_id], jobs, luminaires };
  }
  if ((m = /^\/api\/luminaires\/([^/]+)\/events/.exec(path))) {
    const l = DB.lums[m[1]]; if (!l) throw new Error("not found");
    const events = [];
    for (let i = 0; i < 40; i++) events.push({ ts: iso(Date.parse(l.latest.ts) - i * 6 * 3600000), type: "status", charger: l.latest.charger, battery_mv: l.latest.battery_mv + Math.floor((rnd() - 0.5) * 40), board_temp_c: l.latest.board_temp_c + Math.floor((rnd() - 0.5) * 3), rssi: l.latest.rssi + Math.floor((rnd() - 0.5) * 10), f_port: 1 });
    for (const t of l.tests.slice(0, 3)) { events.push({ ts: t.finished_at, type: "test-finished", test_type: t.test_type, test_duration_min: t.achieved_min, battery_mv: t.battery_mv, f_port: 1 }); events.push({ ts: t.started_at, type: "test-start", test_type: t.test_type, battery_mv: t.battery_mv + 60, f_port: 1 }); }
    for (const f of l.faults.slice(0, 2)) events.push({ ts: f.opened_at, type: f.subsystem === "mains" ? "mains-failure" : f.subsystem === "comms" ? "status" : "hardware-failure", flags: f.flags, f_port: 1 });
    events.sort((a, b) => (a.ts < b.ts ? 1 : -1));
    return { luminaire_id: m[1], events };
  }
  if ((m = /^\/api\/luminaires\/([^/]+)$/.exec(path))) {
    const l = DB.lums[m[1]]; if (!l) throw new Error("not found");
    const site = DB.sites[l.lum.site_id];
    return { luminaire: { ...l.lum, site_name: site.name }, state: l.state, latest: l.latest, tests: l.tests, faults: l.faults,
      dispatches: [{ test_type: "function", occurrence: `function:${iso(NOW).slice(0, 7)}`, by: "schedule", at: l.tests[0]?.started_at }] };
  }
  if (/^\/api\/jobs/.test(path)) return { jobs: [...JOBS].sort((a, b) => (a.run_at < b.run_at ? 1 : -1)) };
  if (/^\/api\/schedules/.test(path)) return { schedules: SCHEDULES.map(schedOut) };
  if (/^\/api\/windows\/presets/.test(path)) return { presets: PRESETS };
  if ((m = /^\/api\/sites\/([^/]+)\/window$/.exec(path))) return { site_id: m[1], tz: "Europe/London", test_window: DB.sites[m[1]]?.test_window || null, presets: PRESETS };
  if (/^\/api\/agenda/.test(path)) {
    const days = Number(new URLSearchParams(path.split("?")[1] || "").get("days")) || 30, now = Date.now(), horizon = now + days * DAY;
    const items = JOBS.filter((j) => j.status === "pending" && Date.parse(j.run_at) <= horizon).map((j) => { const site = DB.sites[j.scope?.site_id || DB.lums[j.scope?.luminaire_id]?.lum.site_id]; const c = inWindow(site?.test_window, Date.parse(j.run_at), site?.tz); return { kind: "job", at: j.run_at, test_type: j.test_type, scope_name: j.scope_name, scope: j.scope, job_id: j.job_id, note: j.note, by: j.created_by, window_override: j.window_override || null, window_ok: c.ok || !!j.window_override, window_reason: c.reason || null }; });
    for (const sch of SCHEDULES.filter((x) => x.enabled)) { const site = DB.sites[sch.scope.site_id]; for (const at of occurrences(sch, now, 12)) { if (at > horizon) break; const c = inWindow(site?.test_window, at, sch.tz); items.push({ kind: "schedule", at: iso(at), test_type: sch.test_type, scope_name: sch.scope_name, scope: sch.scope, schedule_id: sch.schedule_id, name: sch.name, window_ok: c.ok, window_reason: c.reason || null }); } }
    items.sort((a, b) => a.at.localeCompare(b.at)); return { days, items };
  }
  if (/^\/api\/exceptions/.test(path)) {
    const ex = Object.values(DB.lums).filter((l) => l.state.status !== "ok").map((l) => ({ luminaire_id: l.lum.luminaire_id, name: l.lum.name, location: l.lum.location, site_id: l.lum.site_id, site_name: DB.sites[l.lum.site_id].name, state: l.state, faults: l.faults.filter((f) => f.status !== "closed") }));
    ex.sort((a, b) => (a.state.status === b.state.status ? 0 : a.state.status === "alert" ? -1 : 1));
    return { count: ex.length, exceptions: ex };
  }
  if (/^\/api\/reports\/logbook/.test(path)) {
    const site_id = new URLSearchParams(path.split("?")[1] || "").get("site_id");
    const rows = [["Site", "Luminaire", "Location", "Record", "Type", "Result", "Achieved (min)", "Rated (min)", "At", "Detail", "Source", "By"]];
    for (const l of Object.values(DB.lums).filter((x) => x.lum.site_id === site_id)) {
      for (const t of l.tests) rows.push([DB.sites[site_id].name, l.lum.name, l.lum.location, "Test", t.test_type, t.result, t.achieved_min, t.rated_min, t.finished_at, t.reason || "", t.source, "luminaire"]);
      for (const f of l.faults) rows.push([DB.sites[site_id].name, l.lum.name, l.lum.location, "Fault", f.subsystem, f.status, "", "", f.opened_at, f.summary, "automatic", f.closed_by || ""]);
    }
    return rows.map((r) => r.map((v) => (/[",\n]/.test(String(v ?? "")) ? `"${String(v).replace(/"/g, '""')}"` : v ?? "")).join(",")).join("\r\n");
  }
  throw new Error(`demo: no route for ${path}`);
}

export async function demoPost(path, body) {
  await wait(200);
  let m;
  if (path === "/api/faults/ack" || path === "/api/faults/close") {
    const l = DB.lums[body.luminaire_id]; const f = l?.faults.find((x) => x.opened_at === body.opened_at); if (!f) throw new Error("fault not found");
    const at = iso(Date.now());
    if (path === "/api/faults/ack") Object.assign(f, { status: "acknowledged", acked_at: at, acked_by: "you", ack_note: body.note || "" });
    else Object.assign(f, { status: "closed", closed_at: at, closed_by: "you", close_note: body.note || "", remedial_action: body.action || "" });
    // recompute open count
    const open = l.faults.filter((x) => x.status !== "closed");
    l.state.open_faults = open.length; l.state.worst_fault = open.some((x) => x.severity === "alert") ? "alert" : open.length ? "warn" : null;
    if (!open.some((x) => x.severity === "alert") && l.state.duration_test.last?.result !== "fail") l.state.status = open.length || l.state.function_test.status !== "ok" ? "warn" : "ok";
    return { fault: pub(f) };
  }
  if (path === "/api/control/test") {
    const l = DB.lums[body.luminaire_id]; if (!l) throw new Error("not found");
    const at = iso(Date.now());
    return { accepted: true, test_type: body.test_type, at, note: "queued at the network server — the luminaire reports test-start when it begins" };
  }
  if (path === "/api/jobs") {
    const scopeName = body.scope?.site_id ? DB.sites[body.scope.site_id]?.name : DB.lums[body.scope?.luminaire_id]?.lum.name;
    if (!scopeName) throw new Error("scope not found");
    const site = DB.sites[body.scope?.site_id || DB.lums[body.scope?.luminaire_id]?.lum.site_id];
    const runAt = Date.parse(body.run_at);
    if (site?.test_window) {
      const need = body.test_type === "duration" ? 180 + Number(body.stagger_window_min || 0) : Number(body.stagger_window_min || 0) + 5;
      const c = inWindow(site.test_window, runAt, site.tz), c2 = c.ok ? inWindow(site.test_window, runAt + need * 60000, site.tz) : c;
      if ((!c.ok || !c2.ok) && !String(body.override_reason || "").trim()) { const slot = nextSlot(site.test_window, runAt, site.tz, need); const err = new Error(`Outside this site's testing window — ${!c.ok ? c.reason : `test would run past the end of the testing window (${need} min needed)`}`); err.detail = { next_slot: slot ? iso(slot) : null }; throw err; }
      if (!c.ok || !c2.ok) body.window_override = String(body.override_reason).slice(0, 200);
    }
    const job = { window_override: body.window_override || null, job_id: Math.random().toString(16).slice(2, 10), tenant_id: "cambrian", test_type: body.test_type, scope: body.scope, scope_name: scopeName, run_at: new Date(body.run_at).toISOString(), stagger_window_min: Number(body.stagger_window_min ?? 60), note: body.note || "", status: "pending", created_by: "you", created_at: iso(Date.now()), dispatched: [], held: [], skipped: [] };
    JOBS.push(job); return { job };
  }
  if (path === "/api/schedules" || /^\/api\/schedules\/[^/]+\/update$/.test(path)) {
    const id = path.split("/")[3]; const existing = id ? SCHEDULES.find((x) => x.schedule_id === id) : null; if (id && !existing) throw new Error("schedule not found");
    const merged = { ...(existing || {}), ...body, scope: body.scope || existing?.scope }; const site = DB.sites[merged.scope?.site_id || DB.lums[merged.scope?.luminaire_id]?.lum.site_id];
    const sch = { schedule_id: existing?.schedule_id || Math.random().toString(16).slice(2, 10), tenant_id: "cambrian", name: merged.name || `${merged.test_type === "duration" ? "Duration" : "Function"} test — ${describe(merged.recurrence, merged.time)}`, scope: merged.scope, scope_name: site?.name || DB.lums[merged.scope?.luminaire_id]?.lum.name, test_type: merged.test_type, recurrence: merged.recurrence, time: merged.time, tz: "Europe/London", stagger_window_min: Number(merged.stagger_window_min ?? 60), enabled: merged.enabled !== false, note: merged.note || "", created_by: existing?.created_by || "you", created_at: existing?.created_at || iso(Date.now()), last_run_at: existing?.last_run_at };
    const chk = schedOut(sch).window_check; if (!chk.ok && !String(body.override_reason || "").trim()) { const err = new Error(`Outside the site's testing window: ${chk.problems[0]}`); err.detail = { problems: chk.problems }; throw err; }
    sch.window_override = !chk.ok ? body.override_reason : null;
    if (existing) Object.assign(existing, sch); else SCHEDULES.push(sch); return { schedule: schedOut(sch) };
  }
  if ((m = /^\/api\/schedules\/([^/]+)\/delete$/.exec(path))) { const i = SCHEDULES.findIndex((x) => x.schedule_id === m[1]); if (i < 0) throw new Error("schedule not found"); SCHEDULES.splice(i, 1); return { deleted: m[1] }; }
  if ((m = /^\/api\/sites\/([^/]+)\/window$/.exec(path))) { const site = DB.sites[m[1]]; if (!site) throw new Error("not found"); site.test_window = body.test_window === null ? null : { ...body.test_window, updated_by: "you" }; return { site_id: m[1], test_window: site.test_window }; }
  if (path === "/api/plan/annual") {
    const chosen = Object.values(DB.sites).filter((s) => !Array.isArray(body.site_ids) || body.site_ids.includes(s.site_id)).map((s) => ({ ...s, luminaires: DB.siteStates[s.site_id].luminaires })).sort((a, b) => b.luminaires - a.luminaires);
    const startMs = body.from ? Date.parse(body.from + "T00:00:00Z") : Date.now() + DAY, weeks = Number(body.weeks) || 12, perNight = Math.max(1, Number(body.per_night) || 1), endMs = startMs + weeks * 7 * DAY;
    const used = {}; const step = Math.max(DAY, Math.floor((endMs - startMs) / Math.max(1, chosen.length))); const plan = [];
    chosen.forEach((s, i) => { let cursor = startMs + i * step, placed = null; for (let t = 0; t < 120 && !placed; t++) { let slot; if (s.test_window) slot = nextSlot(s.test_window, cursor, s.tz, 180); else { const q = localParts(cursor, s.tz); slot = localToMs(q.y, q.m, q.d, "02:00", s.tz); if (slot < cursor) slot += DAY; } if (slot === null || slot >= endMs) break; const ymd = localParts(slot, s.tz).ymd; if ((used[ymd] || 0) < perNight) { used[ymd] = (used[ymd] || 0) + 1; placed = slot; } else { const [y, mo, d] = ymd.split("-").map(Number); cursor = localToMs(y, mo, d, "00:00", s.tz) + DAY; } } plan.push(placed ? { site_id: s.site_id, site_name: s.name, at: iso(placed), luminaires: s.luminaires } : { site_id: s.site_id, site_name: s.name, at: null, reason: "no allowed slot in the period" }); });
    plan.sort((a, b) => (a.at || "z").localeCompare(b.at || "z"));
    if (!body.commit) return { plan };
    let created = 0; for (const p of plan) { if (!p.at) continue; JOBS.push({ job_id: Math.random().toString(16).slice(2, 10), tenant_id: "cambrian", test_type: "duration", scope: { site_id: p.site_id }, scope_name: p.site_name, run_at: p.at, stagger_window_min: 60, note: `Annual duration test — planned ${body.from}`, status: "pending", created_by: "you", created_at: iso(Date.now()), dispatched: [], held: [], skipped: [] }); created++; }
    return { plan, created };
  }
  if (path === "/api/jobs/cancel") { const j = JOBS.find((x) => x.job_id === body.job_id); if (!j) throw new Error("job not found"); Object.assign(j, { status: "cancelled", cancelled_by: "you", cancelled_at: iso(Date.now()) }); return { job: j }; }
  if (path === "/api/tests/manual") {
    const l = DB.lums[body.luminaire_id]; const t = { kind: "TEST", test_type: body.test_type, result: body.result, started_at: body.at, finished_at: body.at, achieved_min: body.achieved_min || null, rated_min: l.lum.rated_minutes, flags: [], source: "manual", entered_by: "you", note: body.note || "" };
    l.tests.unshift(t); l.tests.sort((a, b) => (a.finished_at < b.finished_at ? 1 : -1)); return { test: t };
  }
  throw new Error(`demo: no POST route for ${path}`);
}
