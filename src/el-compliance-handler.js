/**
 * el-compliance-handler.js — daily 03:00 UTC. Writes:
 *   LUMINAIRE#id / STATE            current snapshot (el-rules.luminaireState)
 *   SITE#id       / DAY#YYYY-MM-DD  site rollup for the day (history)
 *   SITE#id       / STATE           latest site rollup + month grid
 *   TENANT#id     / STATE           portfolio totals
 * then emails a digest of anything needing attention via SNS.
 *
 * Also opens a "comms" FAULT for luminaires that have gone stale, and
 * closes it when they report again — so the exceptions queue is complete.
 *
 * Manual invoke: { "site_id": "…", "now": "ISO" } for one site / a past day.
 */

const db = require("./dynamodb");
const rules = require("./el-rules");
let sns = null;
try { const { SNSClient, PublishCommand } = require("@aws-sdk/client-sns"); sns = { client: new SNSClient({}), PublishCommand }; } catch { /* optional */ }

const log = (msg, extra) => console.log(`[compliance] ${msg}`, extra ? JSON.stringify(extra) : "");

async function lastTests(recordsTable, lumId) {
  const tests = await db.queryByPrefix(recordsTable, `LUMINAIRE#${lumId}`, "TEST#", { limit: 60, desc: true });
  return {
    function: tests.find((t) => t.test_type === "function" || t.test_type === "short") || null,
    duration: tests.find((t) => t.test_type === "duration") || null,
    all: tests,
  };
}

async function openFaults(recordsTable, lumId) {
  const faults = await db.queryByPrefix(recordsTable, `LUMINAIRE#${lumId}`, "FAULT#", { limit: 50, desc: true });
  return faults.filter((f) => f.status === "open");
}

exports.handler = async (event = {}) => {
  const configTable = process.env.CONFIG_TABLE, recordsTable = process.env.RECORDS_TABLE;
  const nowMs = event.now ? Date.parse(event.now) : Date.now();
  const day = new Date(nowMs).toISOString().slice(0, 10);
  const year = new Date(nowMs).getUTCFullYear();

  const cfgItems = await db.scanConfig(configTable);
  const sites = cfgItems.filter((i) => i.entity_type === "site" && (!event.site_id || i.site_id === event.site_id));
  const lums = cfgItems.filter((i) => i.entity_type === "luminaire" && i.enabled !== false);
  const tenantTotals = {};
  const attention = [];

  for (const site of sites) {
    const siteLums = lums.filter((l) => l.site_id === site.site_id);
    const states = [];
    const grids = [];
    for (const lum of siteLums) {
      const pk = `LUMINAIRE#${lum.luminaire_id}`;
      const [latest, tests, faults] = await Promise.all([
        db.getRollup(recordsTable, pk, "LATEST"), lastTests(recordsTable, lum.luminaire_id), openFaults(recordsTable, lum.luminaire_id),
      ]);
      const state = rules.luminaireState(lum, latest, tests, faults, nowMs);

      // comms fault lifecycle
      const commsOpen = faults.find((f) => f.subsystem === "comms" && f.status === "open");
      if (state.comms === "stale" && !commsOpen) {
        const at = new Date(nowMs).toISOString();
        await db.putRollup(recordsTable, { pk, sk: `FAULT#${at}`, entity_type: "fault", tenant_id: lum.tenant_id, site_id: lum.site_id, luminaire_id: lum.luminaire_id,
          kind: "FAULT", opened_at: at, status: "open", subsystem: "comms", subsystems: ["comms"], flags: [], severity: "warn",
          summary: `No report since ${latest?.ts ? latest.ts.slice(0, 16).replace("T", " ") : "install"}` });
        state.open_faults += 1;
      } else if (state.comms === "ok" && commsOpen) {
        await db.putRollup(recordsTable, { ...commsOpen, status: "closed", closed_at: new Date(nowMs).toISOString(), closed_by: "device", close_note: "Luminaire reporting again" });
      }

      await db.putRollup(recordsTable, { pk, sk: "STATE", entity_type: "state", tenant_id: lum.tenant_id, site_id: lum.site_id, name: lum.name, location: lum.location, ...state, computed_at: new Date(nowMs).toISOString() });
      states.push({ ...state, name: lum.name, location: lum.location });
      grids.push(rules.monthGrid(tests.all, year, nowMs));
      if (state.status !== "ok") attention.push({ site: site.name, lum: lum.name || lum.luminaire_id, status: state.status, fn: state.function_test.status, du: state.duration_test.status, faults: state.open_faults });
    }

    const roll = rules.siteRollup(states);
    const grid = rules.combineGrids(grids); // green only when every fitting passed that month
    const siteItem = { tenant_id: site.tenant_id, site_id: site.site_id, name: site.name, address: site.address || null, gps: site.gps || null, ...roll, month_grid: grid, computed_at: new Date(nowMs).toISOString() };
    await db.putRollup(recordsTable, { pk: `SITE#${site.site_id}`, sk: `DAY#${day}`, entity_type: "site_day", ...siteItem });
    await db.putRollup(recordsTable, { pk: `SITE#${site.site_id}`, sk: "STATE", entity_type: "site_state", ...siteItem });

    const tt = tenantTotals[site.tenant_id] ||= { sites: 0, luminaires: 0, compliant: 0, overdue: 0, failed: 0, open_faults: 0, sites_alert: 0, sites_warn: 0 };
    tt.sites++; tt.luminaires += roll.luminaires; tt.compliant += roll.compliant; tt.overdue += roll.overdue; tt.failed += roll.failed; tt.open_faults += roll.open_faults;
    if (roll.status === "alert") tt.sites_alert++; else if (roll.status === "warn") tt.sites_warn++;
  }

  for (const [tenant, t] of Object.entries(tenantTotals)) {
    await db.putRollup(recordsTable, { pk: `TENANT#${tenant}`, sk: "STATE", entity_type: "tenant_state", tenant_id: tenant, ...t,
      compliant_pct: t.luminaires ? Math.round((t.compliant / t.luminaires) * 1000) / 10 : null, computed_at: new Date(nowMs).toISOString() });
  }

  if (attention.length && sns && process.env.ALERTS_TOPIC_ARN) {
    const lines = attention.slice(0, 40).map((a) => `${a.status.toUpperCase().padEnd(5)} ${a.site} — ${a.lum}: function ${a.fn}, duration ${a.du}, open faults ${a.faults}`);
    const msg = `Beacon — ${attention.length} luminaire(s) need attention (${day})\n\n${lines.join("\n")}${attention.length > 40 ? `\n…and ${attention.length - 40} more` : ""}\n\n${process.env.DASHBOARD_URL || ""}`;
    try { await sns.client.send(new sns.PublishCommand({ TopicArn: process.env.ALERTS_TOPIC_ARN, Subject: `Beacon: ${attention.length} luminaires need attention`, Message: msg })); }
    catch (err) { log("digest FAIL", { message: err?.message }); }
  }

  log("done", { sites: sites.length, luminaires: lums.length, attention: attention.length });
  return { sites: sites.length, luminaires: lums.length, attention: attention.length };
};
