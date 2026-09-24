/**
 * time.js — zero-dependency timezone helpers (replaces moment-timezone).
 * Uses Intl.DateTimeFormat, built into every Node Lambda runtime.
 * Keeps deploy zips dependency-free (same `zip -j` workflow as housing-iaq).
 */

const FMT_CACHE = {};
const WD_NAMES = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH_NAMES = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtFor(tz) {
  if (!FMT_CACHE[tz]) {
    FMT_CACHE[tz] = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    });
  }
  return FMT_CACHE[tz];
}

const pad2 = (n) => String(n).padStart(2, "0");

/** Local calendar parts of a Date instant in the given IANA timezone. */
function localParts(date, tz) {
  const parts = {};
  for (const p of fmtFor(tz).formatToParts(date)) parts[p.type] = p.value;
  let hour = Number(parts.hour);
  if (hour === 24) hour = 0; // Intl "24:00" quirk at midnight in some runtimes
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour,
    minute: Number(parts.minute),
  };
}

/** "YYYY-MM-DD" local date key for an instant. */
function dayKeyOf(date, tz) {
  const p = localParts(date, tz);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/** Local hour (0-23) for an instant. */
function hourOf(date, tz) {
  return localParts(date, tz).hour;
}

/** "YYYY-MM-DD HH:mm" local formatting for an instant. */
function formatLocal(date, tz) {
  const p = localParts(date, tz);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)} ${pad2(p.hour)}:${pad2(p.minute)}`;
}

/** Calendar arithmetic on a dayKey (timezone-independent — a local date is a local date). */
function addDaysToDayKey(dayKey, n) {
  const [y, m, d] = dayKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/** ISO weekday (1=Mon … 7=Sun) of a dayKey. */
function weekdayOfDayKey(dayKey) {
  const [y, m, d] = dayKey.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun
  return wd === 0 ? 7 : wd;
}

/** "Mon 20 Jul" style label for a dayKey. */
function labelOfDayKey(dayKey) {
  const [y, m, d] = dayKey.split("-").map(Number);
  return `${WD_NAMES[weekdayOfDayKey(dayKey)]} ${d} ${MONTH_NAMES[m]}`;
}

/**
 * UTC instant corresponding to a local wall-clock time in tz.
 * Two-pass offset correction handles DST (offsets are whole minutes).
 */
function utcFromLocal(dayKey, hour, tz) {
  const [y, m, d] = dayKey.split("-").map(Number);
  const target = Date.UTC(y, m - 1, d, hour, 0, 0, 0);
  let guess = target;
  for (let i = 0; i < 2; i++) {
    const p = localParts(new Date(guess), tz);
    const asIf = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, 0, 0);
    guess += target - asIf;
  }
  return new Date(guess);
}

/**
 * Rolling analysis window: the last 7 FULL local days (ending yesterday 23:59:59
 * local — expressed here as an exclusive end at today's local midnight).
 * Same semantics as the Tago V3.x script.
 */
function getLastSevenFullDaysWindow(tz, now = new Date()) {
  const todayKey = dayKeyOf(now, tz);
  const endKey = addDaysToDayKey(todayKey, -1);
  const startKey = addDaysToDayKey(endKey, -6);

  const dayKeys = [];
  for (let i = 0; i < 7; i++) dayKeys.push(addDaysToDayKey(startKey, i));

  const start = utcFromLocal(startKey, 0, tz);                       // inclusive
  const endExclusive = utcFromLocal(addDaysToDayKey(endKey, 1), 0, tz); // exclusive

  const [ey] = endKey.split("-").map(Number);
  const label = `${labelOfDayKey(startKey)} – ${labelOfDayKey(endKey)} ${ey}`;

  return { start, endExclusive, startKey, endKey, dayKeys, label };
}

module.exports = {
  localParts,
  dayKeyOf,
  hourOf,
  formatLocal,
  addDaysToDayKey,
  weekdayOfDayKey,
  labelOfDayKey,
  utcFromLocal,
  getLastSevenFullDaysWindow,
};
