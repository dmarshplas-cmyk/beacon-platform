"use strict";
const assert = require("assert");
const S = require("../src/el-schedule-lib");
let n = 0; const t = (name, fn) => { fn(); n++; console.log("  ok", name); };

const site = { site_id: "s1", tz: "Europe/London", test_schedule: { enabled: true, function: { day_of_month: 1, time: "02:00" }, duration: { month: 3, day_of_month: 15, time: "01:00" }, stagger_window_min: 60 } };
const lums = [{ luminaire_id: "a" }, { luminaire_id: "b" }, { luminaire_id: "c" }, { luminaire_id: "d" }];

t("schedule validation", () => {
  assert.strictEqual(S.validateTestSchedule(site.test_schedule).ok, true);
  assert.strictEqual(S.validateTestSchedule({ enabled: true, function: { day_of_month: 31, time: "02:00" } }).ok, false);
  assert.strictEqual(S.validateTestSchedule({ enabled: true }).ok, false);
  assert.strictEqual(S.validateTestSchedule({ enabled: false }).schedule.enabled, false);
});

t("nothing planned outside the window", () => {
  assert.deepStrictEqual(S.plan(site, lums, {}, Date.parse("2026-10-01T00:30:00Z")), []); // 01:30 BST, window opens 02:00 local
});

t("function test window dispatches with stagger", () => {
  const p1 = S.plan(site, lums, {}, Date.parse("2026-10-01T01:05:00Z")); // 02:05 BST
  assert.deepStrictEqual(p1.map((x) => x.luminaire_id), ["a"]);          // offsets 0,15,30,45
  const p2 = S.plan(site, lums, {}, Date.parse("2026-10-01T01:50:00Z")); // 02:50 BST
  assert.deepStrictEqual(p2.map((x) => x.luminaire_id), ["a", "b", "c", "d"]);
  assert.strictEqual(p2[0].occurrence, "function:2026-10");
});

t("already-dispatched luminaires are skipped", () => {
  const done = lums.map((l) => ({ ...l, last_dispatch: { occurrence: "function:2026-10" } }));
  assert.deepStrictEqual(S.plan(site, done, {}, Date.parse("2026-10-01T01:50:00Z")), []);
});

t("hold-off after a recent mains outage is reported", () => {
  const latest = { a: { last_mains_restored_at: "2026-10-01T00:00:00Z" } };
  const p = S.plan(site, lums, latest, Date.parse("2026-10-01T01:50:00Z"));
  assert.match(p[0].skipped, /mains restored/);
  assert.strictEqual(p[1].skipped, undefined);
});

t("duration day plans duration tests only", () => {
  const p = S.plan(site, lums, {}, Date.parse("2026-03-15T01:50:00Z")); // 01:50 GMT
  assert.ok(p.every((x) => x.test_type === "duration"));
  assert.strictEqual(p[0].occurrence, "duration:2026");
});

t("next runs are computed", () => {
  const nr = S.nextRuns(site, Date.parse("2026-09-24T12:00:00Z"));
  assert.strictEqual(nr.function, "2026-10-01T02:00");
  assert.strictEqual(nr.duration, "2027-03-15T01:00");
});
console.log(`\n${n} schedule tests passed`);
