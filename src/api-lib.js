/**
 * api-lib.js — pure routing + tenant-authorization logic for the data API.
 * No I/O — locally testable. The Lambda in api-handler.js does the DynamoDB
 * calls; everything decidable without a database lives here.
 *
 * Multi-tenancy model:
 *  - Every config and rollup item carries tenant_id.
 *  - The caller's tenant comes from the Cognito JWT claim `custom:tenant_id`
 *    (validated by the API Gateway JWT authorizer before we ever run).
 *  - tenant "*" is the platform-operator wildcard (your NOC user): sees all.
 *  - Everything else is exact-match. No claim → no access.
 */

const ROUTES = [
  { m: "POST", re: /^\/api\/admin\/import\/preview\/?$/, kind: "admin_preview" },
  { m: "POST", re: /^\/api\/admin\/import\/commit\/?$/, kind: "admin_commit" },
  { m: "POST", re: /^\/api\/admin\/assign\/?$/, kind: "admin_assign" },
  { m: "POST", re: /^\/api\/admin\/mv\/?$/, kind: "admin_mv" },
  { m: "POST", re: /^\/api\/control\/switch\/?$/, kind: "control_switch" },
  { m: "POST", re: /^\/api\/control\/schedule\/?$/, kind: "control_schedule" },
  { m: "POST", re: /^\/api\/admin\/tariff\/?$/, kind: "admin_tariff" },
  { m: "POST", re: /^\/api\/admin\/solar\/?$/, kind: "admin_solar" },
  { m: "POST", re: /^\/api\/ask\/?$/, kind: "ask" },
  { m: "GET", re: /^\/api\/gis\/sites\.geojson$/, kind: "gis_sites" },
  { m: "GET", re: /^\/api\/gis\/summary\/?$/, kind: "gis_summary" },
  { m: "GET", re: /^\/api\/gis\/site\/([^/]+)\/live\.json$/, kind: "gis_site_live" },
  { m: "GET", re: /^\/api\/export\/rollups\/?$/, kind: "export_rollups" },
  { m: "GET", re: /^\/api\/export\/readings\/?$/, kind: "export_readings" },
  { re: /^\/api\/sites\/?$/, kind: "sites" },
  { re: /^\/api\/sites\/([A-Za-z0-9_-]+)\/?$/, kind: "site" },
  { re: /^\/api\/sites\/([A-Za-z0-9_-]+)\/weeks\/?$/, kind: "site_weeks" },
  { re: /^\/api\/sites\/([A-Za-z0-9_-]+)\/mv\/?$/, kind: "site_mv" },
  { re: /^\/api\/circuits\/([A-Za-z0-9_-]+)\/?$/, kind: "circuit" },
  { re: /^\/api\/circuits\/([A-Za-z0-9_-]+)\/readings\/?$/, kind: "circuit_readings" },
  { re: /^\/api\/circuits\/([A-Za-z0-9_-]+)\/days\/?$/, kind: "circuit_days" },
  { re: /^\/api\/circuits\/([A-Za-z0-9_-]+)\/weeks\/?$/, kind: "circuit_weeks" },
];

/** matchRoute("GET", "/api/sites/home") -> { kind: "site", id: "home" } | null */
function matchRoute(method, path) {
  const meth = (method || "GET").toUpperCase();
  for (const r of ROUTES) {
    if ((r.m || "GET") !== meth) continue;
    const m = r.re.exec(path || "");
    if (m) return { kind: r.kind, id: m[1] ?? null };
  }
  return null;
}

/** Tenant from JWT claims (HTTP API payload v2 authorizer shape). */
function tenantFromClaims(claims) {
  const t = claims?.["custom:tenant_id"];
  if (typeof t !== "string") return null;
  const v = t.trim();
  return v.length ? v : null;
}

/** Can `tenant` see an item owned by `itemTenant`? */
function allowed(tenant, itemTenant) {
  if (!tenant) return false;
  if (tenant === "*") return true;
  return !!itemTenant && tenant === itemTenant;
}

/** Clamp a ?limit= query param into a safe range. */
function parseLimit(qs, fallback, max) {
  const n = Number(qs?.limit);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), max);
}

/** Strip internal keys from an item before returning it to a client. */
function publicItem(item) {
  if (!item || typeof item !== "object") return item;
  const { pk, sk, entity_type, ...rest } = item;
  return rest;
}

/** Compact site summary for the list / NOC-map endpoint. */
function shapeSiteSummary(siteCfg, latestWeek) {
  return {
    site_id: siteCfg.site_id,
    name: siteCfg.name || siteCfg.site_id,
    tenant_id: siteCfg.tenant_id,
    profile: siteCfg.profile || null,
    gps: siteCfg.gps || null,
    address: siteCfg.address || null,
    latest: latestWeek ? {
      week: latestWeek.window?.end_key || null,
      kwh: latestWeek.totals?.kwh ?? null,
      cost_gbp: latestWeek.totals?.cost_gbp ?? null,
      off_hours_share_pct: latestWeek.totals?.off_hours_share_pct ?? null,
      trend: latestWeek.trend?.trend ?? null,
      coverage_pct: latestWeek.reconciliation?.submetered_coverage_pct ?? null,
      dq_worst_circuit_coverage_pct: latestWeek.dq_worst_circuit_coverage_pct ?? null,
      device_health: latestWeek.device_health ?? null,
    } : null,
  };
}

/**
 * bucketSeries — downsample raw readings into <= maxPoints time buckets for
 * charting. Pure. readings: [{ts, power_w?, voltage?}] (any order).
 * Returns [{t (bucket-start ISO), avg_w, min_w, max_w, v_avg}] — buckets with
 * no samples are omitted (charts show honest gaps).
 */
function bucketSeries(readings, startMs, endMs, maxPoints = 300) {
  const span = Math.max(1, endMs - startMs);
  const n = Math.max(1, Math.min(maxPoints, 2000));
  const w = span / n;
  const buckets = new Array(n);
  for (const r of readings || []) {
    const t = Date.parse(r.ts);
    if (!(t >= startMs && t < endMs)) continue;
    const p = Number(r.power_w);
    if (!Number.isFinite(p)) continue;
    const i = Math.min(n - 1, Math.floor((t - startMs) / w));
    const b = buckets[i] || (buckets[i] = { sum: 0, cnt: 0, min: Infinity, max: -Infinity, vsum: 0, vcnt: 0 });
    b.sum += p; b.cnt++;
    if (p < b.min) b.min = p;
    if (p > b.max) b.max = p;
    const v = Number(r.voltage);
    if (Number.isFinite(v)) { b.vsum += v; b.vcnt++; }
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const b = buckets[i];
    if (!b) continue;
    out.push({
      t: new Date(startMs + i * w).toISOString(),
      avg_w: Math.round((b.sum / b.cnt) * 10) / 10,
      min_w: Math.round(b.min * 10) / 10,
      max_w: Math.round(b.max * 10) / 10,
      v_avg: b.vcnt ? Math.round((b.vsum / b.vcnt) * 10) / 10 : null,
    });
  }
  return out;
}

/**
 * parseRange(qs, nowMs) — resolve a readings window.
 * Modes: ?hours=N (live, 1..72, default 24) or ?start=YYYY-MM-DD&end=YYYY-MM-DD
 * (historical days, inclusive; span <= 7 days; within the last 31 days).
 * Returns { startMs, endMs, live } or { err }.
 */
function parseRange(qs = {}, nowMs = Date.now()) {
  const DAY = 86400000;
  const dre = /^\d{4}-\d{2}-\d{2}$/;
  if (qs.start || qs.end) {
    if (!dre.test(qs.start || "") || !dre.test(qs.end || "")) {
      return { err: "start and end must both be YYYY-MM-DD" };
    }
    const startMs = Date.parse(`${qs.start}T00:00:00Z`);
    const endMs = Date.parse(`${qs.end}T00:00:00Z`) + DAY; // inclusive end day
    if (!(endMs > startMs)) return { err: "end must not be before start" };
    if (endMs - startMs > 7 * DAY) return { err: "range is capped at 7 days" };
    if (startMs < nowMs - 31 * DAY) return { err: "range must be within the last 31 days" };
    return { startMs, endMs: Math.min(endMs, nowMs), live: false };
  }
  const hours = Math.max(1, Math.min(72, Number(qs.hours) || 24));
  return { startMs: nowMs - hours * 3600000, endMs: nowMs, live: true };
}

/** CSV cell escaping + row assembly (RFC4180). */
function toCsv(rows) {
  const esc = (v) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(esc).join(",")).join("\r\n") + "\r\n";
}

/** Service-key surface: /svc/* mirrors read-only /api/* routes for
 * machine clients (pk_live_ keys). The gateway leaves /svc unauthenticated;
 * the handler enforces the key, then treats the path as its /api twin. */
const SERVICE_KEY_KINDS = new Set(["gis_sites", "gis_summary", "gis_site_live", "export_rollups", "export_readings"]);
function isServicePath(rawPath) { return typeof rawPath === "string" && rawPath.startsWith("/svc/"); }
function svcPathToApi(rawPath) { return rawPath.replace(/^\/svc\//, "/api/"); }

/** GIS helpers — pure. bbox = "w,s,e,n" (lon/lat, GeoJSON order). */
function parseBbox(str) {
  const p = String(str || "").split(",").map(Number);
  if (p.length !== 4 || p.some((x) => !Number.isFinite(x))) return null;
  const [w, so, e, n] = p;
  if (w >= e || so >= n) return null;
  return { w, s: so, e, n };
}
function inBbox(gps, b) {
  return !!gps && gps.lng >= b.w && gps.lng <= b.e && gps.lat >= b.s && gps.lat <= b.n;
}
function haversineKm(a, b) {
  const R = 6371, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

module.exports = { matchRoute, tenantFromClaims, allowed, parseLimit, publicItem, shapeSiteSummary, bucketSeries, parseRange, toCsv, parseBbox, inBbox, haversineKm, SERVICE_KEY_KINDS, isServicePath, svcPathToApi };

