/**
 * el-scheduler-handler.js — 15-minute tick that runs ad-hoc test JOBS.
 *
 * Luminaires schedule their own monthly/annual tests; nothing here runs
 * automatically. A job is created by a person through the API ("duration
 * test, Dolafon House, 2 Nov 01:00"). The tick picks pending jobs whose
 * run_at has passed, dispatches downlinks with stagger and mains hold-off
 * (el-jobs-lib), records each dispatch, and closes the job when done.
 *
 * Bytes come from luminaire.control.commands (vendor spec); no bytes → the
 * fitting is recorded as skipped, never guessed.
 */

const db = require("./dynamodb");
const ctl = require("./control-lib");
const J = require("./el-jobs-lib");
const SW = require("./el-schedules-lib");
const crypto = require("crypto");
const codecs = require("./el-codec");

const log = (msg, extra) => console.log(`[scheduler] ${msg}`, extra ? JSON.stringify(extra) : "");

async function dispatchOne(lum, testType, dlApps, configTable, recordsTable, jobId) {
  const cmdName = testType === "duration" ? "run_duration_test" : "run_function_test";
  const enc = codecs.getCodec(lum.codec || "hbi")?.encode({ name: cmdName }, lum.control);
  const dl = lum.control?.app_id ? dlApps[lum.control.app_id] : null;
  if (!enc || !dl?.api_key || !dl?.base_url || !lum.control?.device_id) return { ok: false, reason: "no downlink bytes or credentials" };
  const url = ctl.downlinkUrl(dl.base_url, lum.control.app_id, lum.control.device_id, "replace");
  const body = ctl.buildDownlinkBody(enc.fPort, enc.hex, { confirmed: true });
  const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${dl.api_key}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) return { ok: false, reason: `LNS ${res.status}` };
  const at = new Date().toISOString();
  await db.putRollup(recordsTable, { pk: `LUMINAIRE#${lum.luminaire_id}`, sk: `DISPATCH#${at}`, entity_type: "dispatch", tenant_id: lum.tenant_id, site_id: lum.site_id,
    luminaire_id: lum.luminaire_id, test_type: testType, job_id: jobId, by: "job", at });
  return { ok: true };
}

exports.handler = async () => {
  const configTable = process.env.CONFIG_TABLE, recordsTable = process.env.RECORDS_TABLE;
  const now = Date.now();
  // 1. Recurring schedules → jobs (one per occurrence, once).
  const cfgAll = await db.scanConfig(configTable);
  const schedules = cfgAll.filter((i) => i.entity_type === "schedule" && i.enabled !== false);
  let materialised = 0;
  for (const sch of schedules) {
    for (const occ of SW.dueOccurrences(sch, now)) {
      const job_id = crypto.randomUUID().slice(0, 8);
      const at = new Date(occ.at).toISOString();
      await db.putRollup(recordsTable, { pk: "JOBS", sk: `JOB#${at}#${job_id}`, entity_type: "job", job_id, tenant_id: sch.tenant_id, test_type: sch.test_type, scope: sch.scope, scope_name: sch.scope_name,
        run_at: at, stagger_window_min: sch.stagger_window_min ?? 60, note: sch.name, status: "pending", created_by: `schedule:${sch.schedule_id}`, created_at: new Date(now).toISOString(), dispatched: [], held: [], skipped: [], schedule_id: sch.schedule_id });
      await db.putConfigItem(configTable, { ...sch, last_materialised: occ.key, last_run_at: at });
      materialised++;
    }
  }
  if (materialised) log("materialised schedule occurrences", { materialised });

  // 2. Run due jobs.
  const jobs = (await db.queryByPrefix(recordsTable, "JOBS", "JOB#", { limit: 500, desc: false })).filter((j) => j.status === "pending" || j.status === "running");
  const due = jobs.filter((j) => Date.parse(j.run_at) <= now);
  const results = { schedules: schedules.length, materialised, jobs: jobs.length, due: due.length, sent: 0, held: 0, skipped: 0, failed: 0, closed: 0 };
  if (!due.length) { log("idle", results); return results; }

  const lums = cfgAll.filter((i) => i.entity_type === "luminaire" && i.enabled !== false);
  const dlApps = Object.fromEntries(cfgAll.filter((i) => i.entity_type === "downlink_app").map((d) => [d.app_id, d]));

  for (const job of due) {
    const scope = J.expandScope(job, lums);
    const latestByLum = {};
    await Promise.all(scope.map(async (l) => {
      const latest = await db.getRollup(recordsTable, `LUMINAIRE#${l.luminaire_id}`, "LATEST");
      latestByLum[l.luminaire_id] = { last_mains_restored_at: latest?.type === "mains-restored" ? latest.ts : null };
    }));
    const p = J.plan(job, scope, latestByLum, now);
    const dispatched = [...(job.dispatched || [])], skipped = [...(job.skipped || [])];
    for (const lum of p.dispatch) {
      try {
        const r = await dispatchOne(lum, job.test_type, dlApps, configTable, recordsTable, job.job_id);
        if (r.ok) { dispatched.push(lum.luminaire_id); results.sent++; }
        else { skipped.push({ luminaire_id: lum.luminaire_id, reason: r.reason }); results.skipped++; }
      } catch (err) { skipped.push({ luminaire_id: lum.luminaire_id, reason: err?.message }); results.failed++; }
    }
    results.held += p.held.length;
    const done = p.done && !p.held.length ? true : Date.parse(job.run_at) + ((job.stagger_window_min || 0) + 360) * 60000 < now;
    const upd = { ...job, status: done ? "done" : "running", dispatched, skipped, held: p.held, last_tick: new Date(now).toISOString(), ...(done ? { finished_at: new Date(now).toISOString() } : {}) };
    await db.putRollup(recordsTable, upd);
    if (done) results.closed++;
    log("job", { job_id: job.job_id, status: upd.status, sent: dispatched.length, held: p.held.length, skipped: skipped.length });
  }
  log("done", results);
  return results;
};
