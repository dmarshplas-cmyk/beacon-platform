/**
 * el-ingest-handler.js — generic secure webhook ingest for Beacon.
 * Auth, registry cache and quarantine are Pulse's ingest-handler unchanged;
 * what differs is what happens after normalisation:
 *
 *   event → el_events (raw audit trail, TTL)
 *         → rules: test-finished closes a test window into a TEST record,
 *                  failure/mains events open FAULT records,
 *                  mains-restored closes the mains fault,
 *                  every event refreshes LUMINAIRE#id / LATEST (state cache)
 *
 * Records are append-only: a TEST or FAULT item is never overwritten by a
 * later uplink; corrections are new items referencing the old (see api).
 *
 *   POST /ingest/{source}   Auth: x-api-key: <token>  (or Bearer)
 *
 * ENV: CONFIG_TABLE, EVENTS_TABLE, RECORDS_TABLE
 *      EVENTS_TTL_DAYS (default 400), CACHE_SECONDS (default 60)
 */

const crypto = require("crypto");
const db = require("./dynamodb");
const { normalize } = require("./el-adapters");
const rules = require("./el-rules");

const log = (msg, extra) =>
  console.log(`[ingest] ${msg}${extra !== undefined ? " " + JSON.stringify(extra) : ""}`);

// -------------------- Registry cache --------------------
let cache = { at: 0, sources: {}, luminaires: {} };

async function loadRegistry(configTable, cacheSeconds) {
  const now = Date.now();
  if (cache.at && now - cache.at < cacheSeconds * 1000) return cache;
  const [sources, lums] = await Promise.all([
    db.scanConfig(configTable, "source"),
    db.scanConfig(configTable, "luminaire"),
  ]);
  const sourceMap = {};
  for (const s of sources) if (s.source_id) sourceMap[String(s.source_id).toLowerCase()] = s;
  const lumMap = {};
  for (const l of lums) {
    if (l.enabled === false) continue;
    const key = String(l.dev_eui ?? l.device_key ?? "").trim().toUpperCase();
    if (key && l.luminaire_id) lumMap[key] = l;
  }
  cache = { at: now, sources: sourceMap, luminaires: lumMap };
  log("registry refreshed", { sources: sources.length, luminaires: Object.keys(lumMap).length });
  return cache;
}

// -------------------- Auth (identical to Pulse) --------------------
function extractToken(headers = {}) {
  const h = {};
  for (const [k, v] of Object.entries(headers)) h[k.toLowerCase()] = v;
  if (h["x-api-key"]) return String(h["x-api-key"]).trim();
  const auth = h["authorization"];
  if (auth && /^bearer\s+/i.test(auth)) return auth.replace(/^bearer\s+/i, "").trim();
  return null;
}
function verifyToken(token, secretHash) {
  if (!token || !secretHash) return false;
  const presented = crypto.createHash("sha256").update(token, "utf8").digest("hex");
  const a = Buffer.from(presented, "hex"), b = Buffer.from(String(secretHash), "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const respond = (statusCode, body) => ({ statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

// -------------------- Record derivation --------------------
/**
 * Apply one event to the records table. Returns a list of record items written.
 * Test correlation: on test-finished, look back up to 6 h in el_events for the
 * matching test-start and any failure events in between.
 */
async function applyEvent(tables, lum, ev) {
  const written = [];
  const pk = `LUMINAIRE#${lum.luminaire_id}`;
  const tenant = lum.tenant_id, site = lum.site_id;
  const base = { tenant_id: tenant, site_id: site, luminaire_id: lum.luminaire_id };

  if (ev.type === "test-finished") {
    const since = new Date(Date.parse(ev.ts) - 6 * 3600000).toISOString();
    const window = await db.queryReadings(tables.events, lum.luminaire_id, since, ev.ts);
    const start = [...window].reverse().find((e) => e.type === "test-start");
    const failures = window.filter((e) => e.type === "battery-failure" || e.type === "hardware-failure"
      && (!start || Date.parse(e.ts) >= Date.parse(start.ts)));
    const rec = rules.deriveTestResult(start, ev, failures, lum);
    const item = { pk, sk: `TEST#${ev.ts}`, entity_type: "test", ...base, ...rec, recorded_at: new Date().toISOString() };
    await db.putRollup(tables.records, item);
    written.push(item);
  }

  const fault = rules.faultFromEvent(ev);
  if (fault) {
    const item = { pk, sk: `FAULT#${ev.ts}`, entity_type: "fault", ...base, ...fault };
    await db.putRollup(tables.records, item);
    written.push(item);
  }

  if (ev.type === "mains-restored") {
    // close the most recent open mains fault
    const open = await db.queryByPrefix(tables.records, pk, "FAULT#", { limit: 20, desc: true });
    const m = open.find((f) => f.subsystem === "mains" && f.status === "open");
    if (m) {
      const closed = { ...m, status: "closed", closed_at: ev.ts, closed_by: "device", close_note: `Mains restored after ${ev.outage_min ?? "?"} min` };
      await db.putRollup(tables.records, closed);
      written.push(closed);
    }
  }

  // Latest-state cache: one item per luminaire, overwritten (not a record).
  if (ev.type !== "shutdown") {
    const latest = { pk, sk: "LATEST", entity_type: "latest", ...base, ...ev };
    await db.putRollup(tables.records, latest);
  }
  return written;
}

// -------------------- Handler --------------------
exports.handler = async (event = {}) => {
  const tables = { config: process.env.CONFIG_TABLE, events: process.env.EVENTS_TABLE, records: process.env.RECORDS_TABLE };
  if (!tables.config || !tables.events || !tables.records) return respond(500, { error: "server misconfigured" });
  const cacheSeconds = Math.max(5, Number(process.env.CACHE_SECONDS ?? 60));
  const ttlDays = Number(process.env.EVENTS_TTL_DAYS ?? 400) || null;

  const sourceId = String(event.pathParameters?.source ?? "").toLowerCase();
  if (!sourceId) return respond(404, { error: "unknown source" });
  const reg = await loadRegistry(tables.config, cacheSeconds);
  const source = reg.sources[sourceId];
  const token = extractToken(event.headers);
  if (!source || source.enabled === false || !verifyToken(token, source.secret_hash)) {
    log("auth failed", { sourceId, hasSource: !!source, hasToken: !!token });
    return respond(401, { error: "unauthorized" });
  }

  let body;
  try {
    body = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf8") : (event.body || ""));
  } catch { return respond(400, { error: "body is not valid JSON" }); }

  const { events, errors } = normalize(source, body);
  if (!events.length) { log("nothing usable", { sourceId, errors }); return respond(400, { error: "no usable events", details: errors }); }

  const nowSec = Math.floor(Date.now() / 1000);
  let accepted = 0, quarantined = 0, records = 0;
  const items = [];
  const derived = [];

  for (const ev of events) {
    const lum = reg.luminaires[ev.device_key];
    const lumId = lum ? lum.luminaire_id : `UNKNOWN#${ev.device_key}`;
    const item = { ...ev, luminaire_id: lumId, circuit_id: lumId, source_id: sourceId, ...(ttlDays ? { ttl: nowSec + ttlDays * 86400 } : {}) };
    // el_events keeps Pulse's key names (circuit_id, ts) so dynamodb.js is reused untouched.
    items.push(item);
    if (lum) { accepted++; derived.push([lum, item]); } else quarantined++;
  }

  try { await db.batchPut(tables.events, items); } catch (err) { log("write FAIL", { message: err?.message }); return respond(500, { error: "write failed" }); }

  for (const [lum, ev] of derived) {
    try { records += (await applyEvent(tables, lum, ev)).length; }
    catch (err) { log("derive FAIL", { luminaire_id: lum.luminaire_id, type: ev.type, message: err?.message }); }
  }

  if (quarantined) log("quarantined unknown devices", { sourceId, keys: [...new Set(items.filter((i) => i.luminaire_id.startsWith("UNKNOWN#")).map((i) => i.luminaire_id))] });
  return respond(200, { accepted, quarantined, records, ...(errors.length ? { warnings: errors } : {}) });
};

exports.applyEvent = applyEvent; // for the simulator / tests
