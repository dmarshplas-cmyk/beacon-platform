/**
 * el-schedule-lib.js — test scheduling. Pure, no I/O.
 *
 * A site carries a `test_schedule`:
 *   { enabled: true,
 *     function: { day_of_month: 1,  time: "02:00" },            // monthly
 *     duration: { month: 3, day_of_month: 15, time: "01:00" },  // annual
 *     stagger_window_min: 60 }
 * The scheduler ticks every 15 min. A luminaire is dispatched when its
 * window opened since the last tick, it isn't held off (recent mains
 * outage), and it hasn't already been dispatched for this occurrence.
 *
 * Dispatch = a downlink `run_function_test` / `run_duration_test` via
 * control-lib (bytes come from luminaire.control.commands — HBI spec).
 * Each dispatch is recorded on the luminaire as `last_dispatch`
 * { test_type, occurrence, at } so a double tick never re-sends.
 */

const { localParts } = require("./time-local");
const rules = require("./el-rules");

const HM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function validateTestSchedule(s) {
  if (!s || typeof s !== "object") return { ok: false, reason: "no schedule" };
  if (s.enabled !== true) return { ok: true, schedule: { enabled: false } };
  const out = { enabled: true, stagger_window_min: Math.max(5, Math.min(360, Number(s.stagger_window_min) || 60)) };
  if (s.function) {
    const d = Number(s.function.day_of_month);
    if (!(d >= 1 && d <= 28)) return { ok: false, reason: "function.day_of_month must be 1–28" };
    if (!HM_RE.test(s.function.time || "")) return { ok: false, reason: "function.time must be HH:MM" };
    out.function = { day_of_month: d, time: s.function.time };
  }
  if (s.duration) {
    const m = Number(s.duration.month), d = Number(s.duration.day_of_month);
    if (!(m >= 1 && m <= 12)) return { ok: false, reason: "duration.month must be 1–12" };
    if (!(d >= 1 && d <= 28)) return { ok: false, reason: "duration.day_of_month must be 1–28" };
    if (!HM_RE.test(s.duration.time || "")) return { ok: false, reason: "duration.time must be HH:MM" };
    out.duration = { month: m, day_of_month: d, time: s.duration.time };
  }
  if (!out.function && !out.duration) return { ok: false, reason: "enabled schedule needs function and/or duration" };
  return { ok: true, schedule: out };
}

/** Occurrence key for a rule at a local date, e.g. "function:2026-10" or "duration:2026". */
function occurrenceKey(testType, parts) {
  return testType === "function" ? `function:${parts.ymd.slice(0, 7)}` : `duration:${parts.ymd.slice(0, 4)}`;
}

/**
 * Minutes from the window's opening at a local instant, or null if the rule
 * isn't open today. Window = [rule time, rule time + 6h).
 */
function minutesIntoWindow(rule, testType, parts) {
  if (!rule) return null;
  if (Number(parts.dom) !== rule.day_of_month) return null;
  if (testType === "duration" && Number(parts.month) !== rule.month) return null;
  const [h, m] = rule.time.split(":").map(Number);
  const open = h * 60 + m, now = parts.hour * 60 + parts.minute;
  const into = now - open;
  return into >= 0 && into < 360 ? into : null;
}

/**
 * plan(site, luminaires, latestByLum, nowMs) → [{ luminaire_id, test_type, occurrence, reason? }]
 * Luminaires already dispatched for this occurrence, or held off, are skipped
 * (held-off ones are returned with `skipped: reason` so the console can show why).
 */
function plan(site, luminaires, latestByLum = {}, nowMs = Date.now()) {
  const v = validateTestSchedule(site?.test_schedule);
  if (!v.ok || !v.schedule.enabled) return [];
  const s = v.schedule;
  const parts = localParts(new Date(nowMs), site.tz || "Europe/London");
  const out = [];
  const lums = [...luminaires].sort((a, b) => String(a.luminaire_id).localeCompare(String(b.luminaire_id)));
  const offsets = rules.staggerOffsets(lums.length, s.stagger_window_min);

  for (const testType of ["duration", "function"]) {
    const into = minutesIntoWindow(s[testType], testType, parts);
    if (into === null) continue;
    const occurrence = occurrenceKey(testType, parts);
    lums.forEach((lum, i) => {
      if (offsets[i] > into) return;                              // not this fitting's turn yet
      if (lum.last_dispatch?.occurrence === occurrence) return;   // already sent
      const hold = rules.testHoldoff(latestByLum[lum.luminaire_id]?.last_mains_restored_at, lum, nowMs);
      if (hold.hold) { out.push({ luminaire_id: lum.luminaire_id, test_type: testType, occurrence, skipped: hold.reason }); return; }
      out.push({ luminaire_id: lum.luminaire_id, test_type: testType, occurrence });
    });
    if (testType === "duration" && out.length) break; // duration day: don't also run a function test
  }
  return out;
}

/** Next scheduled occurrences for a site, for display. */
function nextRuns(site, nowMs = Date.now()) {
  const v = validateTestSchedule(site?.test_schedule);
  if (!v.ok || !v.schedule.enabled) return {};
  const s = v.schedule; const out = {};
  const now = new Date(nowMs);
  if (s.function) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), s.function.day_of_month));
    if (d.getTime() < nowMs) d.setUTCMonth(d.getUTCMonth() + 1);
    out.function = `${d.toISOString().slice(0, 10)}T${s.function.time}`;
  }
  if (s.duration) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), s.duration.month - 1, s.duration.day_of_month));
    if (d.getTime() < nowMs) d.setUTCFullYear(d.getUTCFullYear() + 1);
    out.duration = `${d.toISOString().slice(0, 10)}T${s.duration.time}`;
  }
  return out;
}

module.exports = { validateTestSchedule, plan, nextRuns, minutesIntoWindow, occurrenceKey };
