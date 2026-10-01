/**
 * el-jobs-lib.js — ad-hoc test jobs. Pure, no I/O.
 *
 * Luminaires run their own monthly function test and annual duration test
 * (BS EN 62034 automatic test system); Clearway records the results. Jobs
 * exist for the "just in case": a re-test after a battery swap, a duration
 * test brought forward before an inspection, a whole site re-run after a
 * gateway outage.
 *
 * JOB item (el_records):
 *   pk "JOBS", sk "<run_at ISO>#<job_id>", entity_type "job"
 *   { job_id, tenant_id, scope: { site_id } | { luminaire_id }, test_type,
 *     run_at, stagger_window_min, status: pending|running|done|cancelled,
 *     created_by, created_at, note, dispatched: [luminaire_id…], held: [{luminaire_id, reason}], skipped: [...] }
 */

const rules = require("./el-rules");

function validateJob(input = {}, nowMs = Date.now()) {
  const testType = ["function", "duration"].includes(input.test_type) ? input.test_type : null;
  if (!testType) return { ok: false, reason: "test_type must be function or duration" };
  const scope = input.scope || {};
  if (!scope.site_id && !scope.luminaire_id) return { ok: false, reason: "scope needs site_id or luminaire_id" };
  const runAt = Date.parse(input.run_at);
  if (!runAt) return { ok: false, reason: "run_at must be an ISO datetime" };
  if (runAt < nowMs - 5 * 60000) return { ok: false, reason: "run_at is in the past" };
  if (runAt > nowMs + 400 * 86400000) return { ok: false, reason: "run_at is more than 400 days away" };
  const stagger = Math.max(0, Math.min(360, Number(input.stagger_window_min ?? 60) || 0));
  return { ok: true, job: {
    test_type: testType,
    scope: scope.luminaire_id ? { luminaire_id: String(scope.luminaire_id) } : { site_id: String(scope.site_id) },
    run_at: new Date(runAt).toISOString(),
    stagger_window_min: stagger,
    note: String(input.note || "").slice(0, 300),
  } };
}

/** Luminaires a job applies to. */
function expandScope(job, luminaires = []) {
  if (job.scope?.luminaire_id) return luminaires.filter((l) => l.luminaire_id === job.scope.luminaire_id);
  return luminaires.filter((l) => l.site_id === job.scope?.site_id);
}

/**
 * plan(job, luminaires, latestByLum, nowMs) → { dispatch: [...], held: [...], done: bool }
 * A job is "open" from run_at until run_at + stagger + 6h. Each tick dispatches
 * the fittings whose stagger offset has elapsed and that haven't been sent.
 */
function plan(job, luminaires, latestByLum = {}, nowMs = Date.now()) {
  const runAt = Date.parse(job.run_at);
  const into = (nowMs - runAt) / 60000;
  if (into < 0) return { dispatch: [], held: [], done: false };
  const lums = expandScope(job, luminaires).sort((a, b) => String(a.luminaire_id).localeCompare(String(b.luminaire_id)));
  const offsets = rules.staggerOffsets(lums.length, job.stagger_window_min || 0);
  const already = new Set(job.dispatched || []);
  const dispatch = [], held = [];
  lums.forEach((lum, i) => {
    if (offsets[i] > into || already.has(lum.luminaire_id)) return;
    const hold = rules.testHoldoff(latestByLum[lum.luminaire_id]?.last_mains_restored_at, lum, nowMs);
    if (hold.hold) held.push({ luminaire_id: lum.luminaire_id, reason: hold.reason });
    else dispatch.push(lum);
  });
  const windowClosed = into > (job.stagger_window_min || 0) + 360;
  const allSent = lums.every((l) => already.has(l.luminaire_id) || dispatch.some((d) => d.luminaire_id === l.luminaire_id));
  return { dispatch, held, done: windowClosed || allSent };
}

/** Expected next automatic tests from the luminaire's own counters. */
function deviceNext(latest, lum = {}) {
  if (!latest) return { function_in_days: null, duration_in_days: null };
  const fi = (lum.function_interval_days ?? rules.DEFAULTS.function_interval_days), di = (lum.duration_interval_days ?? rules.DEFAULTS.duration_interval_days);
  return {
    function_in_days: latest.days_since_function_test != null ? Math.max(0, fi - latest.days_since_function_test) : null,
    duration_in_days: latest.days_since_duration_test != null ? Math.max(0, di - latest.days_since_duration_test) : null,
  };
}

module.exports = { validateJob, expandScope, plan, deviceNext };
