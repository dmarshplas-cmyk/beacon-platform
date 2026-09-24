/** test-api-lib.js — routing + tenant-scoping unit tests. */
const path = require("path");
const { matchRoute, tenantFromClaims, allowed, parseLimit, publicItem, shapeSiteSummary, bucketSeries } =
  require(path.join(__dirname, "..", "src", "api-lib.js"));

let pass = 0, fail = 0;
const check = (name, got, expect) => {
  const ok = JSON.stringify(got) === JSON.stringify(expect);
  if (ok) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n    got      ${JSON.stringify(got)}\n    expected ${JSON.stringify(expect)}`); }
};

console.log("── routing ──");
check("sites list", matchRoute("GET", "/api/sites"), { kind: "sites", id: null });
check("sites trailing slash", matchRoute("GET", "/api/sites/"), { kind: "sites", id: null });
check("one site", matchRoute("GET", "/api/sites/plas-llysyn-1"), { kind: "site", id: "plas-llysyn-1" });
check("site weeks", matchRoute("GET", "/api/sites/home/weeks"), { kind: "site_weeks", id: "home" });
check("circuit", matchRoute("GET", "/api/circuits/plas-llysyn-1-main"), { kind: "circuit", id: "plas-llysyn-1-main" });
check("circuit readings", matchRoute("GET", "/api/circuits/c1/readings"), { kind: "circuit_readings", id: "c1" });
check("circuit days", matchRoute("GET", "/api/circuits/c1/days"), { kind: "circuit_days", id: "c1" });
check("circuit weeks", matchRoute("GET", "/api/circuits/c1/weeks"), { kind: "circuit_weeks", id: "c1" });
check("unknown route", matchRoute("GET", "/api/nope"), null);
check("admin preview POST", matchRoute("POST", "/api/admin/import/preview"), { kind: "admin_preview", id: null });
check("admin commit POST", matchRoute("POST", "/api/admin/import/commit"), { kind: "admin_commit", id: null });
check("admin assign POST", matchRoute("POST", "/api/admin/assign"), { kind: "admin_assign", id: null });
check("admin tariff POST", matchRoute("POST", "/api/admin/tariff"), { kind: "admin_tariff", id: null });
const { SERVICE_KEY_KINDS, isServicePath, svcPathToApi } = require(require("path").join(__dirname, "..", "src", "api-lib.js"));
check("svc path detect", isServicePath("/svc/gis/summary"), true);
check("api path not svc", isServicePath("/api/gis/summary"), false);
check("svc→api rewrite", svcPathToApi("/svc/gis/sites.geojson"), "/api/gis/sites.geojson");
check("scope allows gis", SERVICE_KEY_KINDS.has("gis_summary"), true);
check("scope allows export", SERVICE_KEY_KINDS.has("export_readings"), true);
check("scope denies control", SERVICE_KEY_KINDS.has("control_switch"), false);
check("scope denies ask", SERVICE_KEY_KINDS.has("ask"), false);
check("gis sites GET", matchRoute("GET", "/api/gis/sites.geojson"), { kind: "gis_sites", id: null });
check("gis site live GET", matchRoute("GET", "/api/gis/site/plas-llysyn-1/live.json"), { kind: "gis_site_live", id: "plas-llysyn-1" });
check("gis summary GET", matchRoute("GET", "/api/gis/summary"), { kind: "gis_summary", id: null });
const { parseBbox, inBbox, haversineKm } = require(require("path").join(__dirname, "..", "src", "api-lib.js"));
check("bbox parse", parseBbox("-3,52,-1,54"), { w: -3, s: 52, e: -1, n: 54 });
check("bbox reject", parseBbox("-1,54,-3,52"), null);
check("bbox contains", inBbox({ lat: 53, lng: -2 }, parseBbox("-3,52,-1,54")), true);
check("bbox excludes", inBbox({ lat: 51, lng: -2 }, parseBbox("-3,52,-1,54")), false);
check("haversine ~cov-bhm", Math.round(haversineKm({ lat: 52.4068, lng: -1.5197 }, { lat: 52.4862, lng: -1.8904 })), 27);
check("ask POST", matchRoute("POST", "/api/ask"), { kind: "ask", id: null });
check("admin solar POST", matchRoute("POST", "/api/admin/solar"), { kind: "admin_solar", id: null });
check("export rollups GET", matchRoute("GET", "/api/export/rollups"), { kind: "export_rollups", id: null });
check("export readings GET", matchRoute("GET", "/api/export/readings"), { kind: "export_readings", id: null });
const { toCsv } = require(require("path").join(__dirname, "..", "src", "api-lib.js"));
check("csv escaping", toCsv([["a", 'x"y', "1,2"], [null, undefined, 3]]),
  'a,"x""y","1,2"\r\n,,3\r\n');
check("admin routes reject GET", matchRoute("GET", "/api/admin/import/commit"), null);
check("data routes reject POST", matchRoute("POST", "/api/sites"), null);
check("path traversal blocked", matchRoute("GET", "/api/sites/../secrets"), null);
check("empty path", matchRoute("GET", ""), null);

console.log("── tenant claims ──");
check("claim extracted", tenantFromClaims({ "custom:tenant_id": "dm" }), "dm");
check("wildcard extracted", tenantFromClaims({ "custom:tenant_id": "*" }), "*");
check("missing claim", tenantFromClaims({}), null);
check("empty claim", tenantFromClaims({ "custom:tenant_id": "  " }), null);
check("no claims object", tenantFromClaims(undefined), null);

console.log("── authorization ──");
check("exact match allowed", allowed("dm", "dm"), true);
check("cross-tenant denied", allowed("dm", "acme"), false);
check("wildcard sees all", allowed("*", "acme"), true);
check("no tenant denied", allowed(null, "dm"), false);
check("item without tenant denied", allowed("dm", undefined), false);
check("wildcard item-tenant spoof denied", allowed("dm", "*"), false);

console.log("── limits + shaping ──");
check("limit default", parseLimit({}, 12, 52), 12);
check("limit clamped to max", parseLimit({ limit: "999" }, 12, 52), 52);
check("limit floor", parseLimit({ limit: "0" }, 12, 52), 12);
check("limit parsed", parseLimit({ limit: "30" }, 12, 52), 30);
check("internal keys stripped", publicItem({ pk: "X", sk: "Y", entity_type: "z", kwh: 5 }), { kwh: 5 });

const summary = shapeSiteSummary(
  { site_id: "s1", name: "Site 1", tenant_id: "dm", profile: "domestic",
    gps: { lat: 52.5, lng: -3.5 } },
  { window: { end_key: "2026-07-26" }, totals: { kwh: 104.9, cost_gbp: 24.13, off_hours_share_pct: 30 },
    trend: { trend: "unknown" }, reconciliation: { submetered_coverage_pct: 20 },
    dq_worst_circuit_coverage_pct: 100,
    device_health: { min_battery_pct: 95.7, oldest_last_seen: "2026-07-27T15:50:09Z", worst_rssi_avg: -71 } }
);
check("site summary carries gps + health", [summary.gps.lat, summary.latest.kwh, summary.latest.device_health.min_battery_pct],
  [52.5, 104.9, 95.7]);
check("summary with no rollup yet", shapeSiteSummary({ site_id: "new", tenant_id: "dm" }, null).latest, null);

console.log("── bucketSeries ──");
const T0 = Date.parse("2026-07-29T00:00:00Z");
const mk = (min, p, v) => ({ ts: new Date(T0 + min * 60000).toISOString(), power_w: p, ...(v ? { voltage: v } : {}) });
const bs = bucketSeries([mk(0, 100), mk(1, 200), mk(30, 50, 250), mk(31, 70, 248)], T0, T0 + 3600000, 12); // 5-min buckets
check("buckets: count (2 occupied)", bs.length, 2);
check("buckets: first avg", bs[0].avg_w, 150);
check("buckets: min/max carried", [bs[0].min_w, bs[0].max_w], [100, 200]);
check("buckets: voltage averaged", bs[1].v_avg, 249);
check("buckets: no-voltage bucket null", bs[0].v_avg, null);
check("buckets: out-of-window dropped", bucketSeries([mk(-10, 5), mk(70, 5)], T0, T0 + 3600000, 60), []);
check("buckets: empty input", bucketSeries([], T0, T0 + 3600000, 60), []);
const dense = [];
for (let i = 0; i < 1440; i++) dense.push(mk(i, 100 + (i % 7)));
check("buckets: 1440 raw → ≤300 points", bucketSeries(dense, T0, T0 + 86400000, 300).length <= 300, true);

console.log("\u2500\u2500 parseRange \u2500\u2500");
const { parseRange } = require(require("path").join(__dirname, "..", "src", "api-lib.js"));
const NOW = Date.parse("2026-07-30T12:00:00Z");
check("default live 24h", parseRange({}, NOW), { startMs: NOW - 86400000, endMs: NOW, live: true });
check("hours capped at 72", parseRange({ hours: "999" }, NOW).startMs, NOW - 72 * 3600000);
check("date pair inclusive end", parseRange({ start: "2026-07-27", end: "2026-07-28" }, NOW),
  { startMs: Date.parse("2026-07-27T00:00:00Z"), endMs: Date.parse("2026-07-29T00:00:00Z"), live: false });
check("end clamped to now", parseRange({ start: "2026-07-30", end: "2026-07-30" }, NOW).endMs, NOW);
check("bad date format", !!parseRange({ start: "27-07-2026", end: "2026-07-28" }, NOW).err, true);
check("end before start", !!parseRange({ start: "2026-07-28", end: "2026-07-27" }, NOW).err, true);
check(">7 days rejected", !!parseRange({ start: "2026-07-20", end: "2026-07-28" }, NOW).err, true);
check(">31 days ago rejected", !!parseRange({ start: "2026-06-01", end: "2026-06-02" }, NOW).err, true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
