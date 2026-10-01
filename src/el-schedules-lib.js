/**
 * el-schedules-lib.js — testing windows, recurring schedules, slot finding,
 * annual planning. Pure, no I/O. All wall-clock maths is done in the site's
 * timezone via Intl (no deps).
 *
 * WINDOW (site.test_window) — when tests may run on this site:
 *   { days: [0..6] allowed weekdays (0 = Sunday), start: "HH:MM", end: "HH:MM",
 *     blackouts: [{ from: "YYYY-MM-DD", to: "YYYY-MM-DD", reason }],
 *     duration_gap_hours: 24,   // no duration test within this of another on the same fitting
 *     preset: "cinema" }
 *   A window may cross midnight (start "22:00", end "05:00"): then the test
 *   night belongs to the weekday it starts on.
 *
 * SCHEDULE (el_config SCHEDULE#) — a recurring rule, opt-in per site:
 *   { schedule_id, tenant_id, name, scope: {site_id}|{luminaire_id}, test_type,
 *     recurrence: { kind: "monthly-dom" | "monthly-nth-weekday" | "annual" | "weekly" | "interval",
 *                   day_of_month, nth (1-4 or -1 for last), weekday (0-6), month (1-12), interval_days, anchor (YYYY-MM-DD) },
 *     time: "HH:MM", tz, stagger_window_min, enabled, note, created_by, created_at,
 *     last_materialised: "<occurrence key>" }
 */

const DAY = 86400000;

// ---------- timezone helpers ----------
function parts(ms, tz = "Europe/London") {
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const hour = p.hour === "24" ? 0 : Number(p.hour);
  return { ymd: `${p.year}-${p.month}-${p.day}`, y: Number(p.year), m: Number(p.month), d: Number(p.day), hour, minute: Number(p.minute),
    dow: { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[p.weekday], minutes: hour * 60 + Number(p.minute) };
}
/** Epoch ms for local wall time y-m-d HH:MM in tz (iterative, DST-safe). */
function localToMs(y, m, d, hm = "00:00", tz = "Europe/London") {
  const [H, M] = hm.split(":").map(Number);
  let guess = Date.UTC(y, m - 1, d, H, M);
  for (let i = 0; i < 3; i++) {
    const p = parts(guess, tz);
    const diff = (Date.UTC(p.y, p.m - 1, p.d, p.hour, p.minute) - Date.UTC(y, m - 1, d, H, M));
    if (!diff) break;
    guess -= diff;
  }
  return guess;
}
const hm2min = (hm) => { const [h, m] = String(hm || "00:00").split(":").map(Number); return h * 60 + (m || 0); };
const pad = (n) => String(n).padStart(2, "0");
const ymdOf = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

// ---------- windows ----------
const PRESETS = {
  residential: { label: "Residential — overnight", days: [0, 1, 2, 3, 4, 5, 6], start: "01:00", end: "05:00" },
  office: { label: "Office — evenings and weekends", days: [0, 1, 2, 3, 4, 5, 6], start: "19:00", end: "06:30" },
  cinema: { label: "Cinema / theatre — mornings before opening", days: [0, 1, 2, 3, 4, 5, 6], start: "08:00", end: "13:00" },
  retail: { label: "Retail — before opening", days: [0, 1, 2, 3, 4, 5, 6], start: "05:30", end: "08:30" },
  school: { label: "School — weekends and holidays", days: [0, 6], start: "08:00", end: "18:00" },
  healthcare: { label: "Healthcare — any time, by agreement", days: [0, 1, 2, 3, 4, 5, 6], start: "00:00", end: "23:59" },
  always: { label: "No restriction", days: [0, 1, 2, 3, 4, 5, 6], start: "00:00", end: "23:59" },
};

function validateWindow(w = {}) {
  const days = Array.isArray(w.days) ? [...new Set(w.days.map(Number).filter((d) => d >= 0 && d <= 6))].sort() : [0, 1, 2, 3, 4, 5, 6];
  if (!days.length) return { ok: false, reason: "at least one day must be allowed" };
  const HM = /^([01]\d|2[0-3]):([0-5]\d)$/;
  if (!HM.test(w.start || "") || !HM.test(w.end || "")) return { ok: false, reason: "start and end must be HH:MM" };
  const blackouts = (w.blackouts || []).map((b) => ({ from: String(b.from || "").slice(0, 10), to: String(b.to || b.from || "").slice(0, 10), reason: String(b.reason || "").slice(0, 120) }))
    .filter((b) => /^\d{4}-\d{2}-\d{2}$/.test(b.from) && /^\d{4}-\d{2}-\d{2}$/.test(b.to) && b.to >= b.from);
  return { ok: true, window: { days, start: w.start, end: w.end, blackouts, duration_gap_hours: Math.max(0, Math.min(168, Number(w.duration_gap_hours ?? 24) || 0)), preset: w.preset || null, note: String(w.note || "").slice(0, 200) } };
}

/** Is instant `ms` inside the site window? Cross-midnight windows belong to their start day. */
function inWindow(window, ms, tz = "Europe/London") {
  if (!window) return { ok: true };
  const p = parts(ms, tz);
  const s = hm2min(window.start), e = hm2min(window.end);
  const crosses = e <= s;
  let dayOf = p.dow, inHours;
  if (!crosses) inHours = p.minutes >= s && p.minutes < e;
  else if (p.minutes >= s) inHours = true;                       // evening part, same day
  else if (p.minutes < e) { inHours = true; dayOf = (p.dow + 6) % 7; } // small hours, belongs to previous day
  else inHours = false;
  if (!inHours) return { ok: false, reason: `outside testing hours (${window.start}–${window.end})` };
  if (!window.days.includes(dayOf)) return { ok: false, reason: "not an allowed day" };
  const ymd = crosses && p.minutes < e ? parts(ms - DAY, tz).ymd : p.ymd;
  const bo = (window.blackouts || []).find((b) => ymd >= b.from && ymd <= b.to);
  if (bo) return { ok: false, reason: `blackout: ${bo.reason || `${bo.from}–${bo.to}`}` };
  return { ok: true };
}

/** Earliest allowed instant ≥ fromMs (minute resolution, searches 60 days). Prefers the window's start time. */
function nextSlot(window, fromMs, tz = "Europe/London", needMin = 0) {
  if (!window) return fromMs;
  const s = hm2min(window.start), e = hm2min(window.end), crosses = e <= s;
  const len = crosses ? 1440 - s + e : e - s;
  if (needMin && needMin > len) return null;
  const p0 = parts(fromMs, tz);
  for (let i = 0; i < 60; i++) {
    const dayMs = fromMs + i * DAY;
    const p = parts(dayMs, tz);
    const start = localToMs(p.y, p.m, p.d, window.start, tz);
    const candidates = i === 0 && inWindow(window, fromMs, tz).ok ? [fromMs] : [];
    candidates.push(start);
    for (const c of candidates) {
      if (c < fromMs) continue;
      const chk = inWindow(window, c, tz);
      if (!chk.ok) continue;
      if (needMin) { const endMs = c + needMin * 60000; if (!inWindow(window, endMs - 60000, tz).ok) continue; }
      return c;
    }
  }
  void p0;
  return null;
}

// ---------- recurrence ----------
function validateSchedule(input = {}, nowMs = Date.now()) {
  const testType = ["function", "duration"].includes(input.test_type) ? input.test_type : null;
  if (!testType) return { ok: false, reason: "test_type must be function or duration" };
  const scope = input.scope || {};
  if (!scope.site_id && !scope.luminaire_id) return { ok: false, reason: "scope needs site_id or luminaire_id" };
  const r = input.recurrence || {};
  const HM = /^([01]\d|2[0-3]):([0-5]\d)$/;
  if (!HM.test(input.time || "")) return { ok: false, reason: "time must be HH:MM" };
  const kinds = ["monthly-dom", "monthly-nth-weekday", "annual", "weekly", "interval"];
  if (!kinds.includes(r.kind)) return { ok: false, reason: `recurrence.kind must be one of ${kinds.join(", ")}` };
  const rec = { kind: r.kind };
  if (r.kind === "monthly-dom" || r.kind === "annual") { const d = Number(r.day_of_month); if (!(d >= 1 && d <= 28)) return { ok: false, reason: "day_of_month must be 1–28" }; rec.day_of_month = d; }
  if (r.kind === "annual") { const m = Number(r.month); if (!(m >= 1 && m <= 12)) return { ok: false, reason: "month must be 1–12" }; rec.month = m; }
  if (r.kind === "monthly-nth-weekday") { const n = Number(r.nth), w = Number(r.weekday); if (![1, 2, 3, 4, -1].includes(n)) return { ok: false, reason: "nth must be 1–4 or -1 (last)" }; if (!(w >= 0 && w <= 6)) return { ok: false, reason: "weekday must be 0–6" }; rec.nth = n; rec.weekday = w; }
  if (r.kind === "weekly") { const w = Number(r.weekday); if (!(w >= 0 && w <= 6)) return { ok: false, reason: "weekday must be 0–6" }; rec.weekday = w; }
  if (r.kind === "interval") { const n = Number(r.interval_days); if (!(n >= 1 && n <= 400)) return { ok: false, reason: "interval_days must be 1–400" }; rec.interval_days = n; rec.anchor = /^\d{4}-\d{2}-\d{2}$/.test(r.anchor || "") ? r.anchor : new Date(nowMs).toISOString().slice(0, 10); }
  return { ok: true, schedule: {
    name: String(input.name || "").slice(0, 80) || defaultName(testType, rec, input.time),
    scope: scope.luminaire_id ? { luminaire_id: String(scope.luminaire_id) } : { site_id: String(scope.site_id) },
    test_type: testType, recurrence: rec, time: input.time, tz: input.tz || "Europe/London",
    stagger_window_min: Math.max(0, Math.min(360, Number(input.stagger_window_min ?? 60) || 0)),
    enabled: input.enabled !== false, note: String(input.note || "").slice(0, 300),
  } };
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const ordinal = (n) => (n === -1 ? "last" : `${n}${["th", "st", "nd", "rd"][(n % 10 > 3 || Math.floor(n % 100 / 10) === 1) ? 0 : n % 10]}`);
function describe(rec, time) {
  switch (rec.kind) {
    case "monthly-dom": return `Monthly on the ${ordinal(rec.day_of_month)} at ${time}`;
    case "monthly-nth-weekday": return `Monthly on the ${ordinal(rec.nth)} ${WEEKDAYS[rec.weekday]} at ${time}`;
    case "annual": return `Every ${ordinal(rec.day_of_month)} ${MONTHS[rec.month - 1]} at ${time}`;
    case "weekly": return `Every ${WEEKDAYS[rec.weekday]} at ${time}`;
    case "interval": return `Every ${rec.interval_days} days at ${time}`;
    default: return "";
  }
}
const defaultName = (t, rec, time) => `${t === "duration" ? "Duration" : "Function"} test — ${describe(rec, time)}`;

/** Nth weekday of a month → day of month (nth -1 = last). */
function nthWeekday(y, m, nth, weekday) {
  if (nth > 0) { const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); return 1 + ((weekday - first + 7) % 7) + (nth - 1) * 7; }
  const dim = daysInMonth(y, m), last = new Date(Date.UTC(y, m - 1, dim)).getUTCDay();
  return dim - ((last - weekday + 7) % 7);
}

/** Occurrences strictly after fromMs, up to `count`. Returns [{ at: ms, key }]. */
function occurrences(schedule, fromMs, count = 12) {
  const { recurrence: r, time, tz = "Europe/London" } = schedule;
  const out = [];
  const p = parts(fromMs, tz);
  const push = (y, m, d) => { if (d > daysInMonth(y, m)) return; const at = localToMs(y, m, d, time, tz); if (at > fromMs) out.push({ at, key: `${schedule.schedule_id || "s"}:${ymdOf(y, m, d)}` }); };
  if (r.kind === "monthly-dom" || r.kind === "monthly-nth-weekday") {
    for (let i = 0; out.length < count && i < count + 2; i++) {
      let y = p.y, m = p.m + i; while (m > 12) { m -= 12; y++; }
      push(y, m, r.kind === "monthly-dom" ? r.day_of_month : nthWeekday(y, m, r.nth, r.weekday));
    }
  } else if (r.kind === "annual") {
    for (let i = 0; out.length < count && i < count + 1; i++) push(p.y + i, r.month, r.day_of_month);
  } else if (r.kind === "weekly") {
    for (let i = 0; out.length < count && i < (count + 1) * 7; i++) { const q = parts(fromMs + i * DAY, tz); if (q.dow === r.weekday) push(q.y, q.m, q.d); }
  } else if (r.kind === "interval") {
    const [ay, am, ad] = r.anchor.split("-").map(Number);
    let at = localToMs(ay, am, ad, time, tz);
    while (at <= fromMs) at += r.interval_days * DAY;
    for (let i = 0; i < count; i++) { const q = parts(at, tz); out.push({ at: localToMs(q.y, q.m, q.d, time, tz), key: `${schedule.schedule_id || "s"}:${q.ymd}` }); at += r.interval_days * DAY; }
  }
  return out.slice(0, count);
}

/** Occurrences of a schedule that should now be materialised into jobs (≤ nowMs, not yet done). */
function dueOccurrences(schedule, nowMs, lookbackHours = 6) {
  if (schedule.enabled === false) return [];
  const from = nowMs - lookbackHours * 3600000;
  return occurrences(schedule, from, 3).filter((o) => o.at <= nowMs && o.key !== schedule.last_materialised);
}

/** Check a schedule's next occurrences against the site window. */
function scheduleWindowCheck(schedule, window, nowMs = Date.now()) {
  const occ = occurrences(schedule, nowMs, 3);
  const bad = occ.map((o) => ({ ...o, check: inWindow(window, o.at, schedule.tz) })).filter((o) => !o.check.ok);
  return { ok: !bad.length, problems: bad.map((o) => `${new Date(o.at).toISOString().slice(0, 16)}: ${o.check.reason}`) };
}

// ---------- annual planning ----------
/**
 * planAnnual(sites, { from: "YYYY-MM-DD", weeks, perNight }, nowMs) →
 *   [{ site_id, at, reason? }] — one duration test per site, spread across the
 *   period, inside each site's window, at most `perNight` sites per calendar day,
 *   skipping any site whose window has no slot in the period (reported with reason).
 */
function planAnnual(sites = [], { from, weeks = 12, perNight = 1 } = {}, nowMs = Date.now()) {
  const startMs = from ? Date.parse(from + "T00:00:00Z") : nowMs + DAY;
  const endMs = startMs + weeks * 7 * DAY;
  const ordered = [...sites].sort((a, b) => (b.luminaires || 0) - (a.luminaires || 0)); // big sites first: hardest to place
  const used = {}; // ymd → count
  const out = [];
  const step = Math.max(DAY, Math.floor((endMs - startMs) / Math.max(1, ordered.length)));
  ordered.forEach((s, i) => {
    const tz = s.tz || "Europe/London";
    let cursor = startMs + i * step;
    let placed = null;
    for (let tries = 0; tries < 120 && !placed; tries++) {
      let slot;
      if (s.test_window) slot = nextSlot(s.test_window, cursor, tz, s.rated_minutes || 180);
      else { const q = parts(cursor, tz); slot = localToMs(q.y, q.m, q.d, "02:00", tz); if (slot < cursor) slot += DAY; } // no window: 02:00 local by default
      if (slot === null || slot >= endMs) break;
      const ymd = parts(slot, tz).ymd;
      if ((used[ymd] || 0) < perNight) { used[ymd] = (used[ymd] || 0) + 1; placed = slot; }
      else cursor = localToMs(...ymd.split("-").map(Number), "00:00", tz) + DAY;
    }
    out.push(placed ? { site_id: s.site_id, site_name: s.name, at: new Date(placed).toISOString(), luminaires: s.luminaires } : { site_id: s.site_id, site_name: s.name, at: null, reason: "no allowed slot in the period" });
  });
  return out.sort((a, b) => (a.at || "z").localeCompare(b.at || "z"));
}

module.exports = { PRESETS, validateWindow, inWindow, nextSlot, validateSchedule, occurrences, dueOccurrences, scheduleWindowCheck, describe, planAnnual, parts, localToMs, WEEKDAYS, MONTHS, ordinal };
