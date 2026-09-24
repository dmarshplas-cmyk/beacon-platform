"use strict";
const assert = require("assert");
const R = require("../src/el-rules");

const NOW = Date.parse("2026-09-24T12:00:00Z");
const daysAgo = (d) => new Date(NOW - d * 86400000).toISOString();
const lum = { luminaire_id: "el-01", rated_minutes: 180 };

let n = 0;
const t = (name, fn) => { fn(); n++; console.log("  ok", name); };

t("function test with start+finish passes", () => {
  const r = R.deriveTestResult({ type: "test-start", ts: daysAgo(1), test_type: "function" },
    { type: "test-finished", ts: daysAgo(1), test_type: "function", test_duration_min: 1 }, [], lum);
  assert.strictEqual(r.result, "pass");
  assert.strictEqual(r.test_type, "function");
});

t("duration test below rated fails with reason", () => {
  const r = R.deriveTestResult(null, { type: "test-finished", ts: daysAgo(2), test_type: "duration", test_duration_min: 142 }, [], lum);
  assert.strictEqual(r.result, "fail");
  assert.match(r.reason, /142 min of 180/);
});

t("duration test just above rated is pass-marginal", () => {
  const r = R.deriveTestResult(null, { type: "test-finished", ts: daysAgo(2), test_type: "duration", test_duration_min: 184 }, [], lum);
  assert.strictEqual(r.result, "pass-marginal");
});

t("duration test comfortably above rated passes", () => {
  const r = R.deriveTestResult(null, { type: "test-finished", ts: daysAgo(2), test_type: "duration", test_duration_min: 205 }, [], lum);
  assert.strictEqual(r.result, "pass");
});

t("failure event inside the window fails the test", () => {
  const r = R.deriveTestResult({ type: "test-start", ts: daysAgo(1), test_type: "duration" },
    { type: "test-finished", ts: daysAgo(1), test_type: "duration", test_duration_min: 190 },
    [{ type: "battery-failure", ts: daysAgo(1), flags: ["battery_exhausted_duration"] }], lum);
  assert.strictEqual(r.result, "fail");
  assert.deepStrictEqual(r.flags, ["battery_exhausted_duration"]);
});

t("start with no finish is incomplete", () => {
  const r = R.deriveTestResult({ type: "test-start", ts: daysAgo(1), test_type: "function" }, null, [], lum);
  assert.strictEqual(r.result, "incomplete");
});

t("hardware lamp failure opens an alert fault on lamp subsystem", () => {
  const f = R.faultFromEvent({ type: "hardware-failure", ts: daysAgo(0), flags: ["lamp_failure"] });
  assert.strictEqual(f.subsystem, "lamp");
  assert.strictEqual(f.severity, "alert");
  assert.match(f.summary, /Lamp failure/);
});

t("mains failure opens a warn fault", () => {
  const f = R.faultFromEvent({ type: "mains-failure", ts: daysAgo(0) });
  assert.strictEqual(f.subsystem, "mains");
  assert.strictEqual(f.severity, "warn");
});

t("status events do not open faults", () => {
  assert.strictEqual(R.faultFromEvent({ type: "status", ts: daysAgo(0) }), null);
});

t("due state: ok / due-soon / due / overdue / never", () => {
  assert.strictEqual(R.dueState(daysAgo(5), 31, 7, NOW).status, "ok");
  assert.strictEqual(R.dueState(daysAgo(26), 31, 7, NOW).status, "due-soon");
  assert.strictEqual(R.dueState(daysAgo(33), 31, 7, NOW).status, "due");
  assert.strictEqual(R.dueState(daysAgo(40), 31, 7, NOW).status, "overdue");
  assert.strictEqual(R.dueState(null, 31, 7, NOW).status, "never");
});

const pass = (type, d, ach) => ({ kind: "TEST", test_type: type, result: "pass", finished_at: daysAgo(d), achieved_min: ach });

t("healthy luminaire state is ok", () => {
  const s = R.luminaireState(lum, { ts: daysAgo(0), battery_mv: 4100, charger: "trickle", days_since_function_test: 10 },
    { function: pass("function", 10, 1), duration: pass("duration", 100, 200) }, [], NOW);
  assert.strictEqual(s.status, "ok");
  assert.strictEqual(s.comms, "ok");
  assert.strictEqual(s.function_test.status, "ok");
});

t("overdue function test makes it warn; failed duration makes it alert", () => {
  const s1 = R.luminaireState(lum, { ts: daysAgo(0), battery_mv: 4100 }, { function: pass("function", 45, 1), duration: pass("duration", 100, 200) }, [], NOW);
  assert.strictEqual(s1.status, "warn");
  const s2 = R.luminaireState(lum, { ts: daysAgo(0), battery_mv: 4100 },
    { function: pass("function", 5, 1), duration: { kind: "TEST", test_type: "duration", result: "fail", finished_at: daysAgo(3), achieved_min: 120 } }, [], NOW);
  assert.strictEqual(s2.status, "alert");
});

t("stale comms is warn; open alert fault is alert", () => {
  const s = R.luminaireState(lum, { ts: daysAgo(3), battery_mv: 4100 }, { function: pass("function", 5, 1), duration: pass("duration", 50, 200) }, [], NOW);
  assert.strictEqual(s.comms, "stale");
  assert.strictEqual(s.status, "warn");
  const s2 = R.luminaireState(lum, { ts: daysAgo(0), battery_mv: 4100 }, { function: pass("function", 5, 1), duration: pass("duration", 50, 200) },
    [{ status: "open", severity: "alert" }], NOW);
  assert.strictEqual(s2.status, "alert");
});

t("device counter disagreement is flagged, not fatal", () => {
  const s = R.luminaireState(lum, { ts: daysAgo(0), battery_mv: 4100, days_since_function_test: 2 },
    { function: pass("function", 20, 1), duration: pass("duration", 50, 200) }, [], NOW);
  assert.strictEqual(s.counter_gap, "function");
});

t("site rollup counts and status", () => {
  const ok = R.luminaireState(lum, { ts: daysAgo(0), battery_mv: 4100 }, { function: pass("function", 5, 1), duration: pass("duration", 50, 200) }, [], NOW);
  const od = R.luminaireState({ luminaire_id: "el-02" }, { ts: daysAgo(0), battery_mv: 4100 }, { function: pass("function", 45, 1), duration: pass("duration", 50, 200) }, [], NOW);
  const r = R.siteRollup([ok, ok, od]);
  assert.strictEqual(r.luminaires, 3);
  assert.strictEqual(r.compliant, 2);
  assert.strictEqual(r.overdue, 1);
  assert.strictEqual(r.status, "alert");
  assert.strictEqual(R.siteRollup([ok]).status, "ok");
});

t("month grid marks pass / missed / pending / future", () => {
  const tests = [pass("function", 10, 1), { ...pass("function", 40, 1) }, { ...pass("function", 70, 1), result: "fail" }];
  const g = R.monthGrid(tests, 2026, NOW);
  assert.strictEqual(g.length, 12);
  assert.strictEqual(g[8], "pass");   // September (now)
  assert.strictEqual(g[7], "pass");   // August
  assert.strictEqual(g[6], "fail");   // July
  assert.strictEqual(g[5], "missed"); // June
  assert.strictEqual(g[11], "future");
});

t("mains hold-off blocks a test for 24h", () => {
  assert.strictEqual(R.testHoldoff(new Date(NOW - 5 * 3600000).toISOString(), lum, NOW).hold, true);
  assert.strictEqual(R.testHoldoff(new Date(NOW - 30 * 3600000).toISOString(), lum, NOW).hold, false);
});

t("stagger spreads tests across the window", () => {
  assert.deepStrictEqual(R.staggerOffsets(1), [0]);
  assert.deepStrictEqual(R.staggerOffsets(4, 60), [0, 15, 30, 45]);
  assert.strictEqual(R.staggerOffsets(100, 60, 2)[99], 198);
});

t("combined site grid is green only when every fitting passed", () => {
  const a = ["pass","pass","pass","pass","pass","pass","pass","pass","pass","pending","future","future"];
  const b = ["pass","missed","pass","pass","fail","pass","pass","pass","pass","pending","future","future"];
  const g = R.combineGrids([a, b]);
  assert.deepStrictEqual(g.slice(0, 5), ["pass","missed","pass","pass","fail"]);
  assert.strictEqual(g[9], "pending"); assert.strictEqual(g[11], "future");
});

console.log(`\n${n} rules tests passed`);
