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
];
const LOCS = ["Ground floor corridor", "First floor corridor", "Second floor corridor", "Stair core A", "Stair core B", "Main entrance", "Rear exit", "Plant room", "Bin store", "Lift lobby", "Community room", "Laundry", "Car park entrance", "Fire exit east", "Fire exit west", "Third floor corridor", "Roof access", "Reception", "Kitchen exit"];

// Per-site "story" knobs so the estate isn't uniformly green.
const STORY = {
  "dolafon-house": { overdueFn: 0.15, failDur: 2, stale: 1, lamp: 1 },
  "maesyrhaf": { overdueFn: 1.0 },                // whole block overdue — comms outage at the gateway
  "bryn-awel": { marginal: 3, mains: 1 },
  "llys-hafan": { failDur: 1, batt: 2 },
  "hafod-office": { stale: 2 },
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
    test_schedule: { enabled: true, function: { day_of_month: 1 + (site_id.length % 20), time: "02:00" }, duration: { month: 3 + (site_id.length % 9), day_of_month: 12, time: "01:00" }, stagger_window_min: 60 } };
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

function nextRuns(site) {
  const now = new Date(NOW), s = site.test_schedule;
  const f = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), s.function.day_of_month)); if (f.getTime() < NOW) f.setUTCMonth(f.getUTCMonth() + 1);
  const d = new Date(Date.UTC(now.getUTCFullYear(), s.duration.month - 1, s.duration.day_of_month)); if (d.getTime() < NOW) d.setUTCFullYear(d.getUTCFullYear() + 1);
  return { function: `${f.toISOString().slice(0, 10)}T${s.function.time}`, duration: `${d.toISOString().slice(0, 10)}T${s.duration.time}` };
}

// ---------------- API surface ----------------
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const pub = ({ pk, sk, entity_type, ...rest }) => rest;

export async function demoGet(path) {
  await wait(120 + rnd() * 200);
  let m;
  if (/^\/api\/portfolio/.test(path)) {
    const sites = Object.values(DB.sites).map((s) => ({ ...DB.siteStates[s.site_id], site_id: s.site_id, name: s.name, kind: s.kind, address: s.address, gps: s.gps, tz: s.tz, next_runs: nextRuns(s) }));
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
    const luminaires = Object.values(DB.lums).filter((l) => l.lum.site_id === site.site_id).map((l) => ({ ...l.lum, state: l.state }));
    return { site, state: DB.siteStates[site.site_id], next_runs: nextRuns(site), luminaires };
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
  if (/^\/api\/sites\/[^/]+\/schedule/.test(path)) {
    const id = path.split("/")[3]; DB.sites[id].test_schedule = body.test_schedule; return { site_id: id, test_schedule: body.test_schedule, next_runs: nextRuns(DB.sites[id]) };
  }
  if (path === "/api/tests/manual") {
    const l = DB.lums[body.luminaire_id]; const t = { kind: "TEST", test_type: body.test_type, result: body.result, started_at: body.at, finished_at: body.at, achieved_min: body.achieved_min || null, rated_min: l.lum.rated_minutes, flags: [], source: "manual", entered_by: "you", note: body.note || "" };
    l.tests.unshift(t); l.tests.sort((a, b) => (a.finished_at < b.finished_at ? 1 : -1)); return { test: t };
  }
  throw new Error(`demo: no POST route for ${path}`);
}
