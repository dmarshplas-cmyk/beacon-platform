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
  const jobs = (await db.queryByPrefix(recordsTable, "JOBS", "", { limit: 500, desc: false })).filter((j) => j.status === "pending" || j.status === "running");
  const due = jobs.filter((j) => Date.parse(j.run_at) <= now);
  const results = { jobs: jobs.length, due: due.length, sent: 0, held: 0, skipped: 0, failed: 0, closed: 0 };
  if (!due.length) { log("idle", results); return results; }

  const items = await db.scanConfig(configTable);
  const lums = items.filter((i) => i.entity_type === "luminaire" && i.enabled !== false);
  const dlApps = Object.fromEntries(items.filter((i) => i.entity_type === "downlink_app").map((d) => [d.app_id, d]));

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
