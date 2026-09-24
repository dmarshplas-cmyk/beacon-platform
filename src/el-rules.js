/**
 * el-rules.js — emergency lighting compliance rules. Pure, no I/O.
 *
 * Regime (BS 5266-1:2016 / BS EN 50172, evidenced via a BS EN 62034
 * automatic test system):
 *   - function test  : monthly   (default interval 31 days, grace 7)
 *   - duration test  : annual    (default interval 365 days, grace 30)
 *     pass = achieved minutes ≥ rated minutes (default 180)
 *   - every luminaire event is recorded; genuine mains failures are logged
 *     and defer the next scheduled test until the battery has recovered.
 *
 * Nothing here "certifies" compliance. It records what the luminaire reported
 * and what the responsible person did about it.
 *
 * Inputs are canonical events from el-codec (with `ts`, `luminaire_id` added
 * by ingest). Outputs are records for el_records and a luminaire state
 * snapshot for the console.
 */

const DAY = 86400000;

const DEFAULTS = {
  rated_minutes: 180,
  function_interval_days: 31,
  function_grace_days: 7,
  duration_interval_days: 365,
  duration_grace_days: 30,
  mains_holdoff_hours: 24,        // don't schedule a test this soon after a real outage
  stale_after_hours: 36,          // no uplink for this long → comms fault
  battery_mv_floor: 3300,         // warn below this on a Li-ion pack (vendor to confirm)
  duration_margin_pct: 5,         // warn (not fail) when achieved is within 5% of rated
};

const cfg = (lum, key) => (lum && lum[key] != null ? lum[key] : DEFAULTS[key]);

/**
 * deriveTestResult(startEv, finishEv, failureEvs, lum)
 * Correlate one test window into a TEST record. Any of the inputs may be null:
 *   - finish only  → still a result (start uplink lost)
 *   - start only, no finish within window → "incomplete"
 *   - failure event inside the window → fail, with reason
 */
function deriveTestResult(startEv, finishEv, failureEvs = [], lum = {}) {
  const testType = finishEv?.test_type || startEv?.test_type || "unknown";
  const rated = cfg(lum, "rated_minutes");
  const achieved = finishEv?.test_duration_min ?? null;
  const failures = (failureEvs || []).filter((e) => e.type === "battery-failure" || e.type === "hardware-failure");
  const flags = [...new Set(failures.flatMap((e) => e.flags || []))];

  let result, reason = null;
  if (!finishEv && startEv) {
    result = "incomplete";
    reason = "test started but no completion was reported";
  } else if (flags.length) {
    result = "fail";
    reason = flags.join(", ");
  } else if (testType === "duration") {
    if (achieved === null) { result = "incomplete"; reason = "no duration reported"; }
    else if (achieved < rated) { result = "fail"; reason = `achieved ${achieved} min of ${rated} min rated`; }
    else {
      const margin = (achieved - rated) / rated * 100;
      result = margin < cfg(lum, "duration_margin_pct") ? "pass-marginal" : "pass";
      if (result === "pass-marginal") reason = `only ${achieved - rated} min above rated — battery nearing end of life`;
    }
  } else {
    result = "pass";
  }

  return {
    kind: "TEST",
    test_type: testType,
    result,
    reason,
    started_at: startEv?.ts || null,
    finished_at: finishEv?.ts || null,
    achieved_min: achieved,
    rated_min: rated,
    battery_mv: finishEv?.battery_mv ?? startEv?.battery_mv ?? null,
    flags,
    source: "automatic",   // BS EN 62034 ATS; manual entries use "manual"
  };
}

/**
 * faultFromEvent(ev, lum) → FAULT record or null.
 * Faults are opened by battery/hardware failure events and by stale comms.
 */
function faultFromEvent(ev) {
  if (!ev) return null;
  if (ev.type === "battery-failure" || ev.type === "hardware-failure") {
    const flags = ev.flags || [];
    const subsystems = [...new Set(flags.map(subsystemOf))];
    return {
      kind: "FAULT",
      opened_at: ev.ts,
      status: "open",
      subsystem: subsystems[0] || (ev.type === "battery-failure" ? "battery" : "control"),
      subsystems,
      flags,
      summary: flags.length ? flags.map(flagText).join("; ") : ev.type,
      severity: severityOf(flags, ev.type),
    };
  }
  if (ev.type === "mains-failure") {
    return {
      kind: "FAULT", opened_at: ev.ts, status: "open", subsystem: "mains", subsystems: ["mains"],
      flags: [], summary: "Mains supply lost — luminaire running on battery", severity: "warn",
    };
  }
  return null;
}

const SUBSYSTEM = {
  lamp_failure: "lamp",
  battery_too_low: "battery", battery_too_high: "battery", battery_charge_low: "battery",
  battery_exhausted_test: "battery", battery_exhausted_duration: "battery",
  battery_current_limits: "charger", battery_current_control: "charger", supply_too_high: "charger",
  config_corrupted: "control", ram_loss: "control", rtc_loss: "control", rtc_failure: "control",
  lora_cmd_error: "comms", lora_timeout: "comms",
};
const subsystemOf = (f) => SUBSYSTEM[f] || "control";

const TEXT = {
  lamp_failure: "Lamp failure", battery_too_low: "Battery voltage critically low",
  battery_too_high: "Battery voltage too high", battery_charge_low: "Battery not holding charge",
  battery_exhausted_test: "Battery exhausted during test", battery_exhausted_duration: "Battery exhausted before rated duration",
  battery_current_limits: "Charger current out of limits", battery_current_control: "Charger control error",
  supply_too_high: "Supply voltage too high", config_corrupted: "Configuration memory corrupted",
  ram_loss: "Memory loss", rtc_loss: "Clock reset — test schedule may have drifted", rtc_failure: "Clock failure",
  lora_cmd_error: "Radio module not responding", lora_timeout: "Radio module timeout",
};
const flagText = (f) => TEXT[f] || f;

function severityOf(flags, type) {
  if (flags.some((f) => ["lamp_failure", "battery_exhausted_duration", "battery_too_low", "battery_charge_low"].includes(f))) return "alert";
  if (type === "hardware-failure") return "alert";
  return "warn";
}

/**
 * dueState(lastAt, intervalDays, graceDays, nowMs) →
 *   { status: ok|due|overdue|never, days_since, due_in_days, due_at }
 */
function dueState(lastAt, intervalDays, graceDays, nowMs = Date.now()) {
  if (!lastAt) return { status: "never", days_since: null, due_in_days: 0, due_at: null };
  const last = Date.parse(lastAt);
  const dueAt = last + intervalDays * DAY;
  const daysSince = Math.floor((nowMs - last) / DAY);
  const dueIn = Math.ceil((dueAt - nowMs) / DAY);
  let status = "ok";
  if (nowMs > dueAt + graceDays * DAY) status = "overdue";
  else if (nowMs > dueAt) status = "due";
  else if (dueIn <= 7) status = "due-soon";
  return { status, days_since: daysSince, due_in_days: dueIn, due_at: new Date(dueAt).toISOString() };
}

/**
 * luminaireState(lum, latestStatusEv, lastTests, openFaults, nowMs)
 * The per-fitting snapshot the console and the daily rollup both use.
 *  lastTests: { function: TESTrec|null, duration: TESTrec|null }
 */
function luminaireState(lum, latest, lastTests = {}, openFaults = [], nowMs = Date.now()) {
  const fn = dueState(lastTests.function?.finished_at, cfg(lum, "function_interval_days"), cfg(lum, "function_grace_days"), nowMs);
  const du = dueState(lastTests.duration?.finished_at, cfg(lum, "duration_interval_days"), cfg(lum, "duration_grace_days"), nowMs);

  // The luminaire's own counters are a second opinion on "days since" — they
  // survive missed uplinks. If the device says it tested more recently than
  // our records show, we trust the device for due-state but flag the gap.
  let counterGap = null;
  if (latest?.days_since_function_test != null && fn.days_since != null
      && latest.days_since_function_test + 1 < fn.days_since) {
    counterGap = "function";
  }

  const lastSeen = latest?.ts || null;
  const staleHours = lastSeen ? (nowMs - Date.parse(lastSeen)) / 3600000 : null;
  const comms = staleHours === null ? "never" : staleHours > cfg(lum, "stale_after_hours") ? "stale" : "ok";

  const faults = openFaults.filter((f) => f.status === "open");
  const lastFail = [lastTests.function, lastTests.duration].find((t) => t && (t.result === "fail" || t.result === "incomplete"));

  let status = "ok";
  if (faults.some((f) => f.severity === "alert") || lastFail?.result === "fail") status = "alert";
  else if (fn.status === "overdue" || du.status === "overdue" || comms === "stale" || faults.length || lastFail) status = "warn";
  else if (fn.status === "due" || du.status === "due" || lastTests.duration?.result === "pass-marginal") status = "warn";
  else if (fn.status === "never" || du.status === "never") status = "warn";

  const batteryMv = latest?.battery_mv ?? null;
  const batteryLow = batteryMv != null && batteryMv < cfg(lum, "battery_mv_floor");
  if (batteryLow && status === "ok") status = "warn";

  return {
    luminaire_id: lum.luminaire_id,
    status,
    comms, last_seen: lastSeen,
    charger: latest?.charger ?? null,
    battery_mv: batteryMv, battery_low: batteryLow,
    board_temp_c: latest?.board_temp_c ?? null,
    function_test: { ...fn, last: summariseTest(lastTests.function) },
    duration_test: { ...du, last: summariseTest(lastTests.duration), rated_min: cfg(lum, "rated_minutes") },
    counter_gap: counterGap,
    open_faults: faults.length,
    worst_fault: faults.map((f) => f.severity).includes("alert") ? "alert" : faults.length ? "warn" : null,
  };
}

function summariseTest(t) {
  if (!t) return null;
  return { at: t.finished_at || t.started_at, result: t.result, achieved_min: t.achieved_min ?? null, reason: t.reason ?? null };
}

/**
 * siteRollup(states) → site compliance summary from luminaire states.
 * compliant = no overdue tests, no open alerts, no failed last test.
 */
function siteRollup(states = []) {
  const n = states.length;
  const count = (fn) => states.filter(fn).length;
  const overdue = count((s) => s.function_test.status === "overdue" || s.duration_test.status === "overdue");
  const due = count((s) => ["due", "due-soon"].includes(s.function_test.status) || ["due", "due-soon"].includes(s.duration_test.status));
  const failed = count((s) => s.function_test.last?.result === "fail" || s.duration_test.last?.result === "fail");
  const faults = states.reduce((a, s) => a + (s.open_faults || 0), 0);
  const stale = count((s) => s.comms !== "ok");
  const alerts = count((s) => s.status === "alert");
  const warns = count((s) => s.status === "warn");
  const compliant = n - count((s) => s.status !== "ok");
  return {
    luminaires: n, compliant, compliant_pct: n ? Math.round((compliant / n) * 1000) / 10 : null,
    overdue, due, failed, open_faults: faults, stale, alerts, warns,
    status: alerts || overdue || failed ? "alert" : warns || due || stale ? "warn" : "ok",
  };
}

/**
 * monthGrid(tests, year) → 12 cells for a luminaire or site: the monthly
 * function-test strip. Each cell: pass | fail | missed | pending.
 */
function monthGrid(tests = [], year, nowMs = Date.now()) {
  const out = [];
  for (let m = 0; m < 12; m++) {
    const start = Date.UTC(year, m, 1), end = Date.UTC(year, m + 1, 1);
    const inMonth = tests.filter((t) => t.test_type === "function" && t.finished_at && Date.parse(t.finished_at) >= start && Date.parse(t.finished_at) < end);
    let cell;
    if (start > nowMs) cell = "future";
    else if (!inMonth.length) cell = end > nowMs ? "pending" : "missed";
    else if (inMonth.some((t) => t.result === "pass" || t.result === "pass-marginal")) cell = "pass";
    else cell = "fail";
    out.push(cell);
  }
  return out;
}

/**
 * combineGrids(grids) → site-level strip. A month is pass only if EVERY
 * luminaire passed; fail if any failed; missed if any missed; else pending/future.
 */
function combineGrids(grids = []) {
  if (!grids.length) return Array(12).fill("future");
  return Array.from({ length: 12 }, (_, m) => {
    const cells = grids.map((g) => g[m]);
    if (cells.includes("fail")) return "fail";
    if (cells.includes("missed")) return "missed";
    if (cells.includes("pending")) return "pending";
    if (cells.every((c) => c === "future")) return "future";
    return "pass";
  });
}

/** Should a scheduled test run now? Hold off after a real outage. */
function testHoldoff(lastMainsRestoredAt, lum, nowMs = Date.now()) {
  if (!lastMainsRestoredAt) return { hold: false };
  const h = (nowMs - Date.parse(lastMainsRestoredAt)) / 3600000;
  const need = cfg(lum, "mains_holdoff_hours");
  return h < need ? { hold: true, reason: `mains restored ${Math.round(h)}h ago — battery still recovering (${need}h hold-off)` } : { hold: false };
}

/** Stagger N luminaires across a window: returns offset minutes per index. */
function staggerOffsets(count, windowMin = 60, minGapMin = 2) {
  if (count <= 1) return [0];
  const gap = Math.max(minGapMin, Math.floor(windowMin / count));
  return Array.from({ length: count }, (_, i) => i * gap);
}

module.exports = {
  DEFAULTS, deriveTestResult, faultFromEvent, dueState, luminaireState, siteRollup,
  monthGrid, combineGrids, testHoldoff, staggerOffsets, flagText, subsystemOf,
};
