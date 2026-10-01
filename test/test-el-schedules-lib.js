"use strict";
const assert = require("assert");
const S = require("../src/el-schedules-lib");
let n = 0; const t = (name, fn) => { fn(); n++; console.log("  ok", name); };
const TZ = "Europe/London";
const ms = (iso) => Date.parse(iso);

t("local wall time → instant, DST aware", () => {
  assert.strictEqual(new Date(S.localToMs(2026, 7, 15, "02:00", TZ)).toISOString(), "2026-07-15T01:00:00.000Z"); // BST
  assert.strictEqual(new Date(S.localToMs(2026, 1, 15, "02:00", TZ)).toISOString(), "2026-01-15T02:00:00.000Z"); // GMT
});

const cinema = { days: [0, 1, 2, 3, 4, 5, 6], start: "08:00", end: "13:00", blackouts: [{ from: "2026-12-24", to: "2026-12-26", reason: "Christmas screenings" }] };
const flats = { days: [0, 1, 2, 3, 4, 5, 6], start: "01:00", end: "05:00", blackouts: [] };
const office = { days: [1, 2, 3, 4, 5], start: "19:00", end: "06:30", blackouts: [] };

t("window: cinema allows mornings, refuses evenings and blackout days", () => {
  assert.strictEqual(S.inWindow(cinema, ms("2026-10-05T09:30:00Z"), TZ).ok, true);   // 10:30 BST
  assert.strictEqual(S.inWindow(cinema, ms("2026-10-05T19:00:00Z"), TZ).ok, false);
  assert.match(S.inWindow(cinema, ms("2026-12-25T10:00:00Z"), TZ).reason, /blackout/);
});

t("window crossing midnight belongs to its start day", () => {
  assert.strictEqual(S.inWindow(office, ms("2026-10-05T22:00:00Z"), TZ).ok, true);     // Mon 23:00
  assert.strictEqual(S.inWindow(office, ms("2026-10-06T03:00:00Z"), TZ).ok, true);     // Tue 04:00 → Monday night
  assert.strictEqual(S.inWindow(office, ms("2026-10-11T03:00:00Z"), TZ).ok, false);    // Sun 04:00 → Saturday night, not allowed
  assert.strictEqual(S.inWindow(office, ms("2026-10-06T12:00:00Z"), TZ).ok, false);
});

t("nextSlot finds the next allowed start and respects test length", () => {
  const from = ms("2026-10-05T15:00:00Z"); // Mon 16:00 BST, cinema closed
  const slot = S.nextSlot(cinema, from, TZ, 180);
  assert.strictEqual(new Date(slot).toISOString(), "2026-10-06T07:00:00.000Z"); // Tue 08:00 BST
  assert.strictEqual(S.nextSlot(flats, from, TZ, 300), null);                   // 5h test can't fit a 4h window
  const inside = ms("2026-10-05T09:00:00Z");
  assert.strictEqual(S.nextSlot(cinema, inside, TZ, 60), inside);               // already inside: now is fine
});

t("schedule validation and description", () => {
  const v = S.validateSchedule({ test_type: "function", scope: { site_id: "s" }, recurrence: { kind: "monthly-nth-weekday", nth: 2, weekday: 2 }, time: "10:00" });
  assert.strictEqual(v.ok, true);
  assert.strictEqual(v.schedule.name, "Function test — Monthly on the 2nd Tuesday at 10:00");
  assert.strictEqual(S.validateSchedule({ test_type: "duration", scope: { site_id: "s" }, recurrence: { kind: "annual", month: 3, day_of_month: 31 }, time: "10:00" }).ok, false);
  assert.strictEqual(S.validateSchedule({ test_type: "duration", scope: {}, recurrence: { kind: "weekly", weekday: 1 }, time: "10:00" }).ok, false);
});

t("occurrences: monthly-dom, nth weekday, annual, weekly, interval", () => {
  const now = ms("2026-10-01T12:00:00Z");
  const dom = S.occurrences({ schedule_id: "a", recurrence: { kind: "monthly-dom", day_of_month: 14 }, time: "02:00", tz: TZ }, now, 3).map((o) => new Date(o.at).toISOString());
  assert.deepStrictEqual(dom, ["2026-10-14T01:00:00.000Z", "2026-11-14T02:00:00.000Z", "2026-12-14T02:00:00.000Z"]);
  const nth = S.occurrences({ schedule_id: "b", recurrence: { kind: "monthly-nth-weekday", nth: 2, weekday: 2 }, time: "10:00", tz: TZ }, now, 2).map((o) => new Date(o.at).toISOString().slice(0, 10));
  assert.deepStrictEqual(nth, ["2026-10-13", "2026-11-10"]);
  const last = S.occurrences({ schedule_id: "c", recurrence: { kind: "monthly-nth-weekday", nth: -1, weekday: 5 }, time: "10:00", tz: TZ }, now, 1).map((o) => new Date(o.at).toISOString().slice(0, 10));
  assert.deepStrictEqual(last, ["2026-10-30"]);
  const ann = S.occurrences({ schedule_id: "d", recurrence: { kind: "annual", month: 3, day_of_month: 15 }, time: "01:00", tz: TZ }, now, 2).map((o) => new Date(o.at).toISOString().slice(0, 10));
  assert.deepStrictEqual(ann, ["2027-03-15", "2028-03-15"]);
  const wk = S.occurrences({ schedule_id: "e", recurrence: { kind: "weekly", weekday: 0 }, time: "09:00", tz: TZ }, now, 2).map((o) => new Date(o.at).toISOString().slice(0, 10));
  assert.deepStrictEqual(wk, ["2026-10-04", "2026-10-11"]);
  const iv = S.occurrences({ schedule_id: "f", recurrence: { kind: "interval", interval_days: 10, anchor: "2026-09-25" }, time: "09:00", tz: TZ }, now, 2).map((o) => new Date(o.at).toISOString().slice(0, 10));
  assert.deepStrictEqual(iv, ["2026-10-05", "2026-10-15"]);
});

t("dueOccurrences materialises once", () => {
  const sch = { schedule_id: "a", enabled: true, recurrence: { kind: "monthly-dom", day_of_month: 14 }, time: "02:00", tz: TZ };
  const tick = ms("2026-10-14T01:10:00Z");
  const due = S.dueOccurrences(sch, tick);
  assert.strictEqual(due.length, 1); assert.strictEqual(due[0].key, "a:2026-10-14");
  assert.strictEqual(S.dueOccurrences({ ...sch, last_materialised: "a:2026-10-14" }, tick).length, 0);
  assert.strictEqual(S.dueOccurrences(sch, ms("2026-10-14T00:50:00Z")).length, 0);
  assert.strictEqual(S.dueOccurrences({ ...sch, enabled: false }, tick).length, 0);
});

t("schedule vs window check", () => {
  const bad = { schedule_id: "x", recurrence: { kind: "monthly-dom", day_of_month: 14 }, time: "02:00", tz: TZ };
  const r = S.scheduleWindowCheck(bad, cinema, ms("2026-10-01T12:00:00Z"));
  assert.strictEqual(r.ok, false); assert.strictEqual(r.problems.length, 3);
  const good = { ...bad, time: "10:00" };
  assert.strictEqual(S.scheduleWindowCheck(good, cinema, ms("2026-10-01T12:00:00Z")).ok, true);
});

t("annual plan spreads sites, respects windows, one per night", () => {
  const sites = [
    { site_id: "cin", name: "Cinema", tz: TZ, luminaires: 40, rated_minutes: 180, test_window: cinema },
    { site_id: "fl1", name: "Flats 1", tz: TZ, luminaires: 12, rated_minutes: 180, test_window: flats },
    { site_id: "fl2", name: "Flats 2", tz: TZ, luminaires: 18, rated_minutes: 180, test_window: flats },
    { site_id: "off", name: "Office", tz: TZ, luminaires: 30, rated_minutes: 180, test_window: office },
  ];
  const plan = S.planAnnual(sites, { from: "2027-02-01", weeks: 8, perNight: 1 }, ms("2026-10-01T12:00:00Z"));
  assert.strictEqual(plan.filter((p) => p.at).length, 4);
  const days = plan.map((p) => p.at.slice(0, 10)); assert.strictEqual(new Set(days).size, 4);
  for (const p of plan) { const s = sites.find((x) => x.site_id === p.site_id); assert.strictEqual(S.inWindow(s.test_window, Date.parse(p.at), TZ).ok, true, p.site_id); }
});
console.log(`\n${n} schedules tests passed`);
