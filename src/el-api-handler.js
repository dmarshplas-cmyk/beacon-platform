/**
 * el-api-handler.js — tenant-scoped API behind the Cognito JWT authorizer
 * (Pulse model: tenant claim enforced per item; "*" = platform operator).
 *
 *  GET  /api/portfolio                          tenant totals + site states (estate view)
 *  GET  /api/sites/{id}                         site state + luminaire states
 *  GET  /api/sites/{id}/days?limit=             site compliance history
 *  GET  /api/luminaires/{id}                    state + tests + faults + dispatches
 *  GET  /api/luminaires/{id}/events?hours=      raw events (audit)
 *  GET  /api/exceptions                         open faults + overdue/failed across the tenant
 *  POST /api/faults/ack     { luminaire_id, opened_at, note }
 *  POST /api/faults/close   { luminaire_id, opened_at, note, action }
 *  POST /api/tests/manual   { luminaire_id, test_type, result, at, note }   — manual logbook entry
 *  POST /api/control/test   { luminaire_id, test_type }                    — run a test now
 *  POST /api/sites/{id}/schedule { test_schedule }
 *  GET  /api/reports/logbook?site_id=&from=&to=   CSV logbook (PDF renderer is a later drop)
 *  POST /api/admin/import/preview|commit          (Pulse import, luminaire rows)
 *
 * ENV: CONFIG_TABLE, EVENTS_TABLE, RECORDS_TABLE
 */

const db = require("./dynamodb");
const ctl = require("./control-lib");
const codecs = require("./el-codec");
const S = require("./el-schedule-lib");
const { tenantFromClaims, allowed, parseLimit, publicItem, toCsv } = require("./api-lib");

const log = (msg, extra) => console.log(`[api] ${msg}${extra !== undefined ? " " + JSON.stringify(extra) : ""}`);
const respond = (statusCode, body, headers = {}) => ({ statusCode, headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
function parseBody(event) {
  try { const b = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf8") : (event.body || "{}")); return b && typeof b === "object" ? b : {}; } catch { return {}; }
}

const ROUTES = [
  { m: "GET", re: /^\/api\/portfolio\/?$/, kind: "portfolio" },
  { m: "GET", re: /^\/api\/sites\/([A-Za-z0-9_-]+)\/?$/, kind: "site" },
  { m: "GET", re: /^\/api\/sites\/([A-Za-z0-9_-]+)\/days\/?$/, kind: "site_days" },
  { m: "POST", re: /^\/api\/sites\/([A-Za-z0-9_-]+)\/schedule\/?$/, kind: "site_schedule" },
  { m: "GET", re: /^\/api\/luminaires\/([A-Za-z0-9_-]+)\/?$/, kind: "luminaire" },
  { m: "GET", re: /^\/api\/luminaires\/([A-Za-z0-9_-]+)\/events\/?$/, kind: "luminaire_events" },
  { m: "GET", re: /^\/api\/exceptions\/?$/, kind: "exceptions" },
  { m: "POST", re: /^\/api\/faults\/ack\/?$/, kind: "fault_ack" },
  { m: "POST", re: /^\/api\/faults\/close\/?$/, kind: "fault_close" },
  { m: "POST", re: /^\/api\/tests\/manual\/?$/, kind: "test_manual" },
  { m: "POST", re: /^\/api\/control\/test\/?$/, kind: "control_test" },
  { m: "GET", re: /^\/api\/reports\/logbook\/?$/, kind: "report_logbook" },
];
function matchRoute(method, path) {
  for (const r of ROUTES) { if (r.m !== method) continue; const m = r.re.exec(path || ""); if (m) return { kind: r.kind, id: m[1] ?? null }; }
  return null;
}

let cache = { at: 0, sites: [], lums: [] };
async function loadConfig(configTable, cacheSeconds) {
  const now = Date.now();
  if (cache.at && now - cache.at < cacheSeconds * 1000) return cache;
  const [sites, lums] = await Promise.all([db.scanConfig(configTable, "site"), db.scanConfig(configTable, "luminaire")]);
  cache = { at: now, sites, lums };
  return cache;
}

exports.handler = async (event = {}) => {
  const configTable = process.env.CONFIG_TABLE, recordsTable = process.env.RECORDS_TABLE, eventsTable = process.env.EVENTS_TABLE;
  if (!configTable || !recordsTable) return respond(500, { error: "server misconfigured" });
  const cacheSeconds = Math.max(5, Number(process.env.CACHE_SECONDS ?? 60));
  const method = event.requestContext?.http?.method || "GET";
  const rawPath = event.rawPath || event.requestContext?.http?.path || "";
  const qs = event.queryStringParameters || {};

  const tenant = tenantFromClaims(event.requestContext?.authorizer?.jwt?.claims);
  if (!tenant) return respond(403, { error: "no tenant claim" });
  const route = matchRoute(method, rawPath);
  if (!route) return respond(404, { error: "not found" });
  const cfg = await loadConfig(configTable, cacheSeconds);
  const mySites = cfg.sites.filter((s) => allowed(tenant, s.tenant_id));
  const siteOk = (id) => mySites.find((s) => s.site_id === id) || null;
  const lumOk = (id) => { const l = cfg.lums.find((x) => x.luminaire_id === id); return l && siteOk(l.site_id) ? l : null; };
  const who = tenant === "*" ? "operator" : (event.requestContext?.authorizer?.jwt?.claims?.email || tenant);

  try {
    switch (route.kind) {
      case "portfolio": {
        const states = await Promise.all(mySites.map((s) => db.getRollup(recordsTable, `SITE#${s.site_id}`, "STATE")));
        const sites = mySites.map((s, i) => ({ ...publicItem(states[i] || {}), site_id: s.site_id, name: s.name, address: s.address || null, gps: s.gps || null, tz: s.tz, next_runs: S.nextRuns(s) }));
        const tenants = tenant === "*" ? [...new Set(mySites.map((s) => s.tenant_id))] : [tenant];
        const totals = (await Promise.all(tenants.map((t) => db.getRollup(recordsTable, `TENANT#${t}`, "STATE")))).filter(Boolean).map(publicItem);
        return respond(200, { tenant, totals, sites });
      }
      case "site": {
        const site = siteOk(route.id); if (!site) return respond(404, { error: "not found" });
        const lums = cfg.lums.filter((l) => l.site_id === site.site_id && l.enabled !== false);
        const [state, states] = await Promise.all([
          db.getRollup(recordsTable, `SITE#${site.site_id}`, "STATE"),
          Promise.all(lums.map((l) => db.getRollup(recordsTable, `LUMINAIRE#${l.luminaire_id}`, "STATE"))),
        ]);
        return respond(200, { site: publicItem(site), state: publicItem(state || {}), next_runs: S.nextRuns(site),
          luminaires: lums.map((l, i) => ({ ...publicItem(l), state: publicItem(states[i] || {}) })) });
      }
      case "site_days": {
        const site = siteOk(route.id); if (!site) return respond(404, { error: "not found" });
        const days = await db.queryByPrefix(recordsTable, `SITE#${site.site_id}`, "DAY#", { limit: parseLimit(qs, 90, 400), desc: true });
        return respond(200, { site_id: site.site_id, days: days.map(publicItem) });
      }
      case "site_schedule": {
        const site = siteOk(route.id); if (!site) return respond(404, { error: "not found" });
        const v = S.validateTestSchedule(parseBody(event).test_schedule);
        if (!v.ok) return respond(400, { error: v.reason });
        const item = await db.getConfigItem(configTable, site.pk, site.sk);
        await db.putConfigItem(configTable, { ...item, test_schedule: v.schedule });
        cache.at = 0;
        return respond(200, { site_id: site.site_id, test_schedule: v.schedule, next_runs: S.nextRuns({ ...site, test_schedule: v.schedule }) });
      }
      case "luminaire": {
        const lum = lumOk(route.id); if (!lum) return respond(404, { error: "not found" });
        const pk = `LUMINAIRE#${lum.luminaire_id}`;
        const [state, latest, tests, faults, dispatches] = await Promise.all([
          db.getRollup(recordsTable, pk, "STATE"), db.getRollup(recordsTable, pk, "LATEST"),
          db.queryByPrefix(recordsTable, pk, "TEST#", { limit: 60, desc: true }),
          db.queryByPrefix(recordsTable, pk, "FAULT#", { limit: 60, desc: true }),
          db.queryByPrefix(recordsTable, pk, "DISPATCH#", { limit: 20, desc: true }),
        ]);
        const { control, ...pub } = publicItem(lum);
        return respond(200, { luminaire: { ...pub, control_enabled: control?.enabled === true }, state: publicItem(state || {}), latest: publicItem(latest || {}),
          tests: tests.map(publicItem), faults: faults.map(publicItem), dispatches: dispatches.map(publicItem) });
      }
      case "luminaire_events": {
        const lum = lumOk(route.id); if (!lum) return respond(404, { error: "not found" });
        const hours = Math.max(1, Math.min(24 * 90, Number(qs.hours) || 24 * 7));
        const rows = await db.queryReadings(eventsTable, lum.luminaire_id, new Date(Date.now() - hours * 3600000).toISOString(), new Date().toISOString());
        return respond(200, { luminaire_id: lum.luminaire_id, events: rows.map(({ circuit_id, ttl, ...e }) => e) });
      }
      case "exceptions": {
        const lums = cfg.lums.filter((l) => siteOk(l.site_id) && l.enabled !== false);
        const states = await Promise.all(lums.map((l) => db.getRollup(recordsTable, `LUMINAIRE#${l.luminaire_id}`, "STATE")));
        const out = [];
        for (let i = 0; i < lums.length; i++) {
          const st = states[i]; if (!st || st.status === "ok") continue;
          const faults = st.open_faults ? (await db.queryByPrefix(recordsTable, `LUMINAIRE#${lums[i].luminaire_id}`, "FAULT#", { limit: 20, desc: true })).filter((f) => f.status === "open").map(publicItem) : [];
          out.push({ luminaire_id: lums[i].luminaire_id, name: lums[i].name, location: lums[i].location, site_id: lums[i].site_id, site_name: siteOk(lums[i].site_id)?.name, state: publicItem(st), faults });
        }
        return respond(200, { count: out.length, exceptions: out });
      }
      case "fault_ack": case "fault_close": {
        const b = parseBody(event);
        const lum = lumOk(String(b.luminaire_id || "")); if (!lum) return respond(404, { error: "not found" });
        const f = await db.getRollup(recordsTable, `LUMINAIRE#${lum.luminaire_id}`, `FAULT#${b.opened_at}`);
        if (!f) return respond(404, { error: "fault not found" });
        const at = new Date().toISOString();
        const upd = route.kind === "fault_ack"
          ? { ...f, status: f.status === "open" ? "acknowledged" : f.status, acked_at: at, acked_by: who, ack_note: String(b.note || "").slice(0, 500) }
          : { ...f, status: "closed", closed_at: at, closed_by: who, close_note: String(b.note || "").slice(0, 500), remedial_action: String(b.action || "").slice(0, 200) };
        await db.putRollup(recordsTable, upd);
        return respond(200, { fault: publicItem(upd) });
      }
      case "test_manual": {
        const b = parseBody(event);
        const lum = lumOk(String(b.luminaire_id || "")); if (!lum) return respond(404, { error: "not found" });
        const testType = ["function", "duration"].includes(b.test_type) ? b.test_type : null;
        const result = ["pass", "fail"].includes(b.result) ? b.result : null;
        const at = Date.parse(b.at) ? new Date(b.at).toISOString() : null;
        if (!testType || !result || !at) return respond(400, { error: "test_type (function|duration), result (pass|fail) and at (ISO) are required" });
        const item = { pk: `LUMINAIRE#${lum.luminaire_id}`, sk: `TEST#${at}`, entity_type: "test", tenant_id: lum.tenant_id, site_id: lum.site_id, luminaire_id: lum.luminaire_id,
          kind: "TEST", test_type: testType, result, reason: result === "fail" ? String(b.note || "manual entry") : null, started_at: at, finished_at: at,
          achieved_min: Number(b.achieved_min) || null, rated_min: lum.rated_minutes || 180, flags: [], source: "manual", entered_by: who, note: String(b.note || "").slice(0, 500), recorded_at: new Date().toISOString() };
        await db.putRollup(recordsTable, item);
        return respond(200, { test: publicItem(item) });
      }
      case "control_test": {
        const b = parseBody(event);
        const lum = lumOk(String(b.luminaire_id || "")); if (!lum) return respond(404, { error: "not found" });
        const testType = b.test_type === "duration" ? "duration" : "function";
        if (lum.control?.enabled !== true) return respond(400, { error: "control not enabled on this luminaire" });
        const enc = codecs.getCodec(lum.codec || "hbi")?.encode({ name: testType === "duration" ? "run_duration_test" : "run_function_test" }, lum.control);
        if (!enc) return respond(400, { error: "no downlink bytes configured for this command — awaiting vendor command set" });
        const dl = await db.getConfigItem(configTable, `DOWNLINK#${lum.control.app_id}`, "META");
        if (!dl?.api_key || !dl?.base_url) return respond(500, { error: `no downlink credentials for app "${lum.control.app_id}"` });
        const url = ctl.downlinkUrl(dl.base_url, lum.control.app_id, lum.control.device_id, "replace");
        const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${dl.api_key}`, "content-type": "application/json" }, body: JSON.stringify(ctl.buildDownlinkBody(enc.fPort, enc.hex, { confirmed: true })) });
        if (!res.ok) return respond(502, { error: `LNS rejected the downlink (${res.status})` });
        const at = new Date().toISOString();
        await db.putRollup(recordsTable, { pk: `LUMINAIRE#${lum.luminaire_id}`, sk: `DISPATCH#${at}`, entity_type: "dispatch", tenant_id: lum.tenant_id, site_id: lum.site_id, luminaire_id: lum.luminaire_id, test_type: testType, occurrence: "manual", by: who, at });
        return respond(200, { accepted: true, test_type: testType, at, note: "queued at the network server — the luminaire reports test-start when it begins" });
      }
      case "report_logbook": {
        const site = siteOk(String(qs.site_id || "")); if (!site) return respond(404, { error: "site_id required" });
        const lums = cfg.lums.filter((l) => l.site_id === site.site_id);
        const from = qs.from || `${new Date().getUTCFullYear()}-01-01`, to = qs.to || new Date().toISOString().slice(0, 10);
        const rows = [["Site", "Luminaire", "Location", "Record", "Type", "Result", "Achieved (min)", "Rated (min)", "At", "Detail", "Source", "By"]];
        for (const l of lums) {
          const pk = `LUMINAIRE#${l.luminaire_id}`;
          const [tests, faults] = await Promise.all([db.queryByPrefix(recordsTable, pk, "TEST#", { limit: 200, desc: false }), db.queryByPrefix(recordsTable, pk, "FAULT#", { limit: 200, desc: false })]);
          for (const t of tests) { const at = (t.finished_at || t.started_at || "").slice(0, 10); if (at < from || at > to) continue;
            rows.push([site.name, l.name || l.luminaire_id, l.location || "", "Test", t.test_type, t.result, t.achieved_min ?? "", t.rated_min ?? "", t.finished_at || t.started_at, t.reason || "", t.source, t.entered_by || "luminaire"]); }
          for (const f of faults) { const at = (f.opened_at || "").slice(0, 10); if (at < from || at > to) continue;
            rows.push([site.name, l.name || l.luminaire_id, l.location || "", "Fault", f.subsystem, f.status, "", "", f.opened_at, `${f.summary}${f.remedial_action ? " — " + f.remedial_action : ""}`, "automatic", f.closed_by || ""]); }
        }
        return respond(200, toCsv(rows), { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="beacon-logbook-${site.site_id}-${from}-${to}.csv"` });
      }
      default:
        return respond(404, { error: "not found" });
    }
  } catch (err) {
    log("route FAIL", { kind: route.kind, id: route.id, message: err?.message });
    return respond(500, { error: "internal error" });
  }
};
