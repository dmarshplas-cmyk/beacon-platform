"use strict";
const assert = require("assert");
const J = require("../src/el-jobs-lib");
let n = 0; const t = (name, fn) => { fn(); n++; console.log("  ok", name); };
const NOW = Date.parse("2026-10-01T12:00:00Z");
const lums = [{ luminaire_id: "a", site_id: "s1" }, { luminaire_id: "b", site_id: "s1" }, { luminaire_id: "c", site_id: "s1" }, { luminaire_id: "d", site_id: "s1" }, { luminaire_id: "z", site_id: "s2" }];

t("job validation", () => {
  assert.strictEqual(J.validateJob({ test_type: "duration", scope: { site_id: "s1" }, run_at: "2026-11-02T01:00:00Z" }, NOW).ok, true);
  assert.strictEqual(J.validateJob({ test_type: "short", scope: { site_id: "s1" }, run_at: "2026-11-02T01:00:00Z" }, NOW).ok, false);
  assert.strictEqual(J.validateJob({ test_type: "function", scope: {}, run_at: "2026-11-02T01:00:00Z" }, NOW).ok, false);
  assert.strictEqual(J.validateJob({ test_type: "function", scope: { site_id: "s1" }, run_at: "2026-09-01T01:00:00Z" }, NOW).ok, false);
  assert.strictEqual(J.validateJob({ test_type: "function", scope: { site_id: "s1" }, run_at: "2026-10-01T12:03:00Z" }, NOW).ok, true); // "now"
});

t("scope expands to a site or one luminaire", () => {
  assert.strictEqual(J.expandScope({ scope: { site_id: "s1" } }, lums).length, 4);
  assert.strictEqual(J.expandScope({ scope: { luminaire_id: "z" } }, lums).length, 1);
});

t("nothing before run_at; staggered after", () => {
  const job = { scope: { site_id: "s1" }, run_at: "2026-10-01T12:00:00Z", stagger_window_min: 60 };
  assert.deepStrictEqual(J.plan(job, lums, {}, NOW - 60000).dispatch, []);
  assert.deepStrictEqual(J.plan(job, lums, {}, NOW + 5 * 60000).dispatch.map((l) => l.luminaire_id), ["a"]);
  const p = J.plan(job, lums, {}, NOW + 50 * 60000);
  assert.deepStrictEqual(p.dispatch.map((l) => l.luminaire_id), ["a", "b", "c", "d"]);
  assert.strictEqual(p.done, true);
});

t("already-dispatched are skipped; hold-off reported", () => {
  const job = { scope: { site_id: "s1" }, run_at: "2026-10-01T12:00:00Z", stagger_window_min: 0, dispatched: ["a", "b"] };
  const p = J.plan(job, lums, { c: { last_mains_restored_at: "2026-10-01T10:00:00Z" } }, NOW + 60000);
  assert.deepStrictEqual(p.dispatch.map((l) => l.luminaire_id), ["d"]);
  assert.strictEqual(p.held[0].luminaire_id, "c");
  assert.strictEqual(p.done, false);
});

t("job closes after the window even if some were held", () => {
  const job = { scope: { site_id: "s1" }, run_at: "2026-10-01T12:00:00Z", stagger_window_min: 0, dispatched: ["a"] };
  assert.strictEqual(J.plan(job, lums, { b: { last_mains_restored_at: new Date(NOW + 7 * 3600000).toISOString() } }, NOW + 7 * 3600000).done, true);
});

t("device counters give expected next automatic tests", () => {
  assert.deepStrictEqual(J.deviceNext({ days_since_function_test: 20, days_since_duration_test: 300 }), { function_in_days: 11, duration_in_days: 65 });
  assert.deepStrictEqual(J.deviceNext({ days_since_function_test: 40 }), { function_in_days: 0, duration_in_days: null });
});
console.log(`\n${n} jobs tests passed`);
