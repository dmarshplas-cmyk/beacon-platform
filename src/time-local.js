/** time-local.js — local wall-clock parts for an instant in a timezone (no deps). */
function localParts(date, tz = "Europe/London") {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false,
  });
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  const hour = p.hour === "24" ? 0 : Number(p.hour);
  return {
    ymd: `${p.year}-${p.month}-${p.day}`, year: Number(p.year), month: Number(p.month), dom: Number(p.day),
    hour, minute: Number(p.minute), hm: `${String(hour).padStart(2, "0")}:${p.minute}`,
    dow: { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[p.weekday],
  };
}
module.exports = { localParts };
