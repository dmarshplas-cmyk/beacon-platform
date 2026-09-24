/**
 * el-scheduler-handler.js — 15-minute tick. For every site with an enabled
 * test_schedule, plan which luminaires are due a downlink now (el-schedule-lib)
 * and send it through the LNS using Pulse's control-lib. Records each
 * dispatch on the luminaire item (`last_dispatch`) and as a DISPATCH record.
 *
 * Downlink bytes come from luminaire.control:
 *   { enabled: true, app_id, device_id, f_port, commands: { run_function_test: hex, run_duration_test: hex } }
 * Missing bytes → skipped and logged; nothing is ever invented.
 */

const db = require("./dynamodb");
const ctl = require("./control-lib");
const S = require("./el-schedule-lib");
const codecs = require("./el-codec");

const log = (msg, extra) => console.log(`[scheduler] ${msg}`, extra ? JSON.stringify(extra) : "");

exports.handler = async () => {
  const configTable = process.env.CONFIG_TABLE, recordsTable = process.env.RECORDS_TABLE;
  const now = Date.now();
  const items = await db.scanConfig(configTable);
  const sites = items.filter((i) => i.entity_type === "site" && i.test_schedule?.enabled === true);
  const lums = items.filter((i) => i.entity_type === "luminaire" && i.enabled !== false);
  const dlApps = Object.fromEntries(items.filter((i) => i.entity_type === "downlink_app").map((d) => [d.app_id, d]));
  const results = { sites: sites.length, planned: 0, sent: 0, held: 0, skipped: 0, failed: 0 };

  for (const site of sites) {
    const siteLums = lums.filter((l) => l.site_id === site.site_id);
    // latest mains-restored per luminaire for hold-off
    const latestByLum = {};
    await Promise.all(siteLums.map(async (l) => {
      const latest = await db.getRollup(recordsTable, `LUMINAIRE#${l.luminaire_id}`, "LATEST");
      latestByLum[l.luminaire_id] = { last_mains_restored_at: latest?.type === "mains-restored" ? latest.ts : null };
    }));

    for (const p of S.plan(site, siteLums, latestByLum, now)) {
      results.planned++;
      if (p.skipped) { results.held++; log("held", p); continue; }
      const lum = siteLums.find((l) => l.luminaire_id === p.luminaire_id);
      const cmdName = p.test_type === "duration" ? "run_duration_test" : "run_function_test";
      const codec = codecs.getCodec(lum.codec || "hbi");
      const enc = codec?.encode({ name: cmdName }, lum.control);
      const dl = lum.control?.app_id ? dlApps[lum.control.app_id] : null;
      if (!enc || !dl?.api_key || !dl?.base_url || !lum.control?.device_id) {
        results.skipped++; log("skip — no downlink bytes/creds", { luminaire_id: lum.luminaire_id, cmd: cmdName }); continue;
      }
      try {
        const url = ctl.downlinkUrl(dl.base_url, lum.control.app_id, lum.control.device_id, "replace");
        const body = ctl.buildDownlinkBody(enc.fPort, enc.hex, { confirmed: true });
        const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${dl.api_key}`, "content-type": "application/json" }, body: JSON.stringify(body) });
        if (!res.ok) { results.failed++; log("downlink FAIL", { luminaire_id: lum.luminaire_id, status: res.status }); continue; }
        const at = new Date().toISOString();
        await db.putConfigItem(configTable, { ...lum, last_dispatch: { test_type: p.test_type, occurrence: p.occurrence, at } });
        await db.putRollup(recordsTable, { pk: `LUMINAIRE#${lum.luminaire_id}`, sk: `DISPATCH#${at}`, entity_type: "dispatch",
          tenant_id: lum.tenant_id, site_id: lum.site_id, luminaire_id: lum.luminaire_id, test_type: p.test_type, occurrence: p.occurrence, by: "schedule", at });
        results.sent++;
      } catch (err) { results.failed++; log("dispatch FAIL", { luminaire_id: lum.luminaire_id, message: err?.message }); }
    }
  }
  log("done", results);
  return results;
};
