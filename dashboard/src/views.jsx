/* views.jsx — Beacon console. Estate (luminaire wall) · Site · Luminaire · Exceptions · Reports */
import React, { useEffect, useMemo, useState } from "react";
import * as A from "./api.js";
import { Panel, Led } from "./ui.jsx";

const MONTHS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
const go = (h) => { window.location.hash = h; };

function useApi(path, deps = []) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setErr(null);
    A.api(path).then((d) => live && setData(d), (e) => live && setErr(e.message));
    return () => { live = false; };
  }, [path, tick, ...deps]);
  return { data, err, reload: () => setTick((t) => t + 1) };
}

/* ---------- shared bits ---------- */

/** Twelve-month function-test strip. */
export function MonthStrip({ grid = [], year, size = "s" }) {
  return (
    <div className={`mstrip ${size}`} role="img" aria-label={`Monthly function tests ${year || ""}`}>
      {grid.map((c, i) => (
        <span key={i} className={`mcell ${c}`} title={`${MONTHS[i]} — ${c}`}>{size === "l" ? MONTHS[i] : ""}</span>
      ))}
    </div>
  );
}

/** Rated-vs-achieved duration bar. */
function DurationBar({ achieved, rated, result }) {
  if (achieved === null || achieved === undefined) return <span className="muted">—</span>;
  const pct = Math.min(130, (achieved / rated) * 100);
  return (
    <div className="dbar" title={`${achieved} min achieved of ${rated} min rated`}>
      <div className={`dbar-fill ${result || ""}`} style={{ width: `${Math.min(100, pct)}%` }} />
      <div className="dbar-rated" />
      <span className="dbar-text num">{achieved}<span className="unit">/{rated}</span></span>
    </div>
  );
}

const STATUS_LABEL = { ok: "Compliant", warn: "Attention", alert: "Action needed", idle: "No data" };
const StatusChip = ({ status }) => <span className={`chip ${status === "ok" ? "amber" : status === "alert" ? "alert" : status === "warn" ? "warn" : ""}`}><Led status={status} />{STATUS_LABEL[status] || status}</span>;

/* ---------- Estate ---------- */

export function Estate() {
  const { data, err } = useApi("/api/portfolio");
  const [hover, setHover] = useState(null);
  if (err) return <div className="loading">{err}</div>;
  if (!data) return <div className="loading">Loading estate…</div>;
  const t = data.totals[0] || {};
  const sites = [...data.sites].sort((a, b) => rank(b) - rank(a) || a.name.localeCompare(b.name));
  const nextTest = sites.map((s) => s.next_runs?.function).filter(Boolean).sort()[0];
  const nextDuration = sites.map((s) => s.next_runs?.duration).filter(Boolean).sort()[0];
  const year = new Date().getFullYear();

  return (
    <div className="page estate-page">
      <div className="page-head">
        <div>
          <h1 className="h1">Cambrian Housing</h1>
          <div className="sub muted">{t.sites} sites · {t.luminaires} emergency luminaires · state as of {A.fmtDateTime(t.computed_at)}</div>
        </div>
        <div className="kpi-row">
          <Kpi label="Compliant" value={A.fmtPct(t.compliant_pct)} tone={t.compliant_pct >= 98 ? "ok" : t.compliant_pct >= 90 ? "warn" : "alert"} />
          <Kpi label="Overdue tests" value={t.overdue} tone={t.overdue ? "warn" : "ok"} />
          <Kpi label="Failed tests" value={t.failed} tone={t.failed ? "alert" : "ok"} />
          <Kpi label="Open faults" value={t.open_faults} tone={t.open_faults ? "warn" : "ok"} />
          <Kpi label="Next function test" value={nextTest ? A.fmtDate(nextTest) : "—"} small />
          <Kpi label="Next duration test" value={nextDuration ? A.fmtDate(nextDuration) : "—"} small />
        </div>
      </div>

      <div className="estate-grid">
        <Panel className="wall-panel" title="Every luminaire" right={<span className="legend-line"><i className="mcell pass" /> compliant <i className="mcell due" /> test due <i className="mcell missed" /> overdue or fault <i className="mcell silent" /> silent</span>}>
          <Wall sites={sites} onHover={setHover} />
          <div className="wall-caption muted">{hover ? hover : "Each cell is one fitting. Hover a block to see the site; click to open it."}</div>
        </Panel>

        <Panel className="attn-panel" title="Needs attention" right={<a href="#/exceptions">Open queue</a>}>
          <AttentionList sites={sites} />
        </Panel>
      </div>

      <Panel title={`Sites — monthly function tests ${year}`}>
        <table className="tbl sites-tbl">
          <thead><tr><th className="led-col"></th><th>Site</th><th className="r">Fittings</th><th className="r">Compliant</th><th>Function tests</th><th className="r">Overdue</th><th className="r">Faults</th><th>Next test</th></tr></thead>
          <tbody>
            {sites.map((s) => (
              <tr key={s.site_id} className="rowlink" onClick={() => go(`/site/${s.site_id}`)}>
                <td className="led-col"><Led status={s.status} /></td>
                <td><strong>{s.name}</strong><span className="muted"> {s.address?.town}</span></td>
                <td className="r num">{s.luminaires}</td>
                <td className="r num">{A.fmtPct(s.compliant_pct)}</td>
                <td><MonthStrip grid={s.month_grid} /></td>
                <td className={`r num ${s.overdue ? "warn-text" : ""}`}>{s.overdue || "—"}</td>
                <td className={`r num ${s.open_faults ? "warn-text" : ""}`}>{s.open_faults || "—"}</td>
                <td className="muted">{A.fmtDate(s.next_runs?.function)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

const rank = (s) => (s.status === "alert" ? 2 : s.status === "warn" ? 1 : 0);

function Kpi({ label, value, tone, small }) {
  return (
    <div className={`kpi ${tone || ""} ${small ? "small" : ""}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value num">{value ?? "—"}</div>
    </div>
  );
}

/** The wall: one cell per luminaire, grouped by site. Blocks size to fitting count. */
function Wall({ sites, onHover }) {
  const { data } = useApi("/api/exceptions");
  const cellState = useMemo(() => {
    const m = {};
    for (const e of data?.exceptions || []) m[e.luminaire_id] = e.state.status === "alert" ? "missed" : e.state.comms === "stale" ? "silent" : "due";
    return m;
  }, [data]);
  return (
    <div className="wall">
      {sites.map((s) => (
        <button key={s.site_id} className={`wall-block ${s.status}`} style={{ "--cols": Math.max(4, Math.ceil(Math.sqrt(s.luminaires * 2.2))) }} onClick={() => go(`/site/${s.site_id}`)}
          onMouseEnter={() => onHover(`${s.name} — ${s.luminaires} fittings, ${A.fmtPct(s.compliant_pct)} compliant${s.overdue ? `, ${s.overdue} overdue` : ""}${s.open_faults ? `, ${s.open_faults} open faults` : ""}`)}
          onMouseLeave={() => onHover(null)} aria-label={s.name}>
          <div className="wall-cells">
            {Array.from({ length: s.luminaires }, (_, i) => {
              const id = `${s.site_id}-el-${String(i + 1).padStart(2, "0")}`;
              const st = cellState[id] || (s.status === "alert" && !data ? "pass" : "pass");
              return <i key={i} className={`wcell ${st}`} />;
            })}
          </div>
          <div className="wall-name">{s.name}</div>
        </button>
      ))}
    </div>
  );
}

function AttentionList({ sites }) {
  const { data } = useApi("/api/exceptions");
  if (!data) return <div className="muted">Loading…</div>;
  const items = data.exceptions.slice(0, 7);
  if (!items.length) return <div className="empty">Nothing needs attention. Every fitting is tested, on schedule and reporting.</div>;
  return (
    <div className="attn-list">
      {items.map((e) => (
        <button key={e.luminaire_id} className={`attn ${e.state.status}`} onClick={() => go(`/luminaire/${e.luminaire_id}`)}>
          <Led status={e.state.status} />
          <div className="attn-body">
            <div className="attn-title">{e.site_name} · {e.name} <span className="muted">{e.location}</span></div>
            <div className="attn-why">{whyText(e)}</div>
          </div>
        </button>
      ))}
      {data.count > items.length && <a className="more" href="#/exceptions">{data.count - items.length} more in the queue</a>}
    </div>
  );
}

function whyText(e) {
  const s = e.state, parts = [];
  const f = e.faults?.find((x) => x.status !== "closed");
  if (f) parts.push(f.summary);
  if (s.duration_test?.last?.result === "fail") parts.push(`Duration test failed: ${s.duration_test.last.reason}`);
  if (s.duration_test?.last?.result === "pass-marginal") parts.push("Duration test marginal — battery nearing end of life");
  if (s.function_test?.status === "overdue") parts.push(`Function test ${A.dueText(s.function_test)}`);
  if (s.duration_test?.status === "overdue") parts.push(`Duration test ${A.dueText(s.duration_test)}`);
  if (s.duration_test?.status === "never") parts.push("No duration test on record");
  if (s.comms === "stale" && !f) parts.push(`Silent since ${A.fmtDateTime(s.last_seen)}`);
  if (s.battery_low && !f) parts.push(`Battery ${A.fmtMv(s.battery_mv)} — low`);
  if (!parts.length && s.function_test?.status === "due") parts.push("Function test due");
  return parts[0] || "Needs review";
}

/* ---------- Site ---------- */

export function Site({ siteId }) {
  const { data, err, reload } = useApi(`/api/sites/${siteId}`);
  const [running, setRunning] = useState(null);
  if (err) return <div className="loading">{err}</div>;
  if (!data) return <div className="loading">Loading site…</div>;
  const { site, state, luminaires, next_runs } = data;
  const lums = [...luminaires].sort((a, b) => rank(b.state) - rank(a.state) || a.name.localeCompare(b.name));
  const year = new Date().getFullYear();

  const runAll = async (type) => {
    setRunning(type);
    try { for (const l of luminaires) await A.apiPost("/api/control/test", { luminaire_id: l.luminaire_id, test_type: type }); }
    finally { setRunning(null); }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <a className="back" href="#/">Estate</a>
          <h1 className="h1">{site.name}</h1>
          <div className="sub muted">{site.address?.line1}, {site.address?.town} {site.address?.postcode} · {site.kind} · {state.luminaires} emergency luminaires</div>
        </div>
        <div className="kpi-row">
          <Kpi label="Compliant" value={A.fmtPct(state.compliant_pct)} tone={state.status} />
          <Kpi label="Overdue" value={state.overdue} tone={state.overdue ? "warn" : "ok"} />
          <Kpi label="Failed" value={state.failed} tone={state.failed ? "alert" : "ok"} />
          <Kpi label="Open faults" value={state.open_faults} tone={state.open_faults ? "warn" : "ok"} />
          <Kpi label="Silent" value={state.stale} tone={state.stale ? "warn" : "ok"} />
        </div>
      </div>

      <div className="grid three">
        <Panel title={`Function tests ${year}`}>
          <MonthStrip grid={state.month_grid} year={year} size="l" />
          <div className="muted small-note">A month is green when every fitting passed a function test in it.</div>
        </Panel>
        <Panel title="Test schedule" right={<a href={`#/site/${siteId}/schedule`}>Change</a>}>
          <div className="sched">
            <div><span className="muted">Monthly function test</span><br /><strong>{ordinal(site.test_schedule?.function?.day_of_month)} of the month, {site.test_schedule?.function?.time}</strong><br /><span className="muted">next {A.fmtDate(next_runs?.function)}</span></div>
            <div><span className="muted">Annual duration test</span><br /><strong>{ordinal(site.test_schedule?.duration?.day_of_month)} {monthName(site.test_schedule?.duration?.month)}, {site.test_schedule?.duration?.time}</strong><br /><span className="muted">next {A.fmtDate(next_runs?.duration)}</span></div>
            <div className="muted small-note">Fittings are staggered over {site.test_schedule?.stagger_window_min} min so the site is never dark all at once. Tests are held back for 24 h after a real mains outage.</div>
          </div>
        </Panel>
        <Panel title="Run now">
          <div className="control-copy muted">Sends a test command to every fitting on this site. Use outside occupied hours for a duration test — fittings need 24 h to recharge afterwards.</div>
          <div className="control-buttons">
            <button className="btn" disabled={!!running} onClick={() => runAll("function")}>{running === "function" ? "Sending…" : "Run function test"}</button>
            <button className="btn ghost" disabled={!!running} onClick={() => runAll("duration")}>{running === "duration" ? "Sending…" : "Run duration test"}</button>
          </div>
          <div className="control-buttons"><a className="btn ghost" href={`#/reports?site=${siteId}`}>Export logbook</a></div>
        </Panel>
      </div>

      <Panel title="Luminaires">
        <table className="tbl lum-tbl">
          <thead><tr><th className="led-col"></th><th>Fitting</th><th>Location</th><th>Function test</th><th>Duration test</th><th>Achieved</th><th className="r">Battery</th><th>Last report</th></tr></thead>
          <tbody>
            {lums.map((l) => {
              const s = l.state;
              return (
                <tr key={l.luminaire_id} className="rowlink" onClick={() => go(`/luminaire/${l.luminaire_id}`)}>
                  <td className="led-col"><Led status={s.status} /></td>
                  <td><strong>{l.name}</strong></td>
                  <td className="muted">{l.location}</td>
                  <td className={cls(s.function_test?.status)}>{A.fmtDate(s.function_test?.last?.at)}<span className="muted"> · {A.dueText(s.function_test)}</span></td>
                  <td className={cls(s.duration_test?.status, s.duration_test?.last?.result)}>{A.fmtDate(s.duration_test?.last?.at)}<span className="muted"> · {A.dueText(s.duration_test)}</span></td>
                  <td><DurationBar achieved={s.duration_test?.last?.achieved_min} rated={s.duration_test?.rated_min} result={s.duration_test?.last?.result} /></td>
                  <td className={`r num ${s.battery_low ? "warn-text" : ""}`}>{A.fmtMv(s.battery_mv)}</td>
                  <td className={s.comms === "stale" ? "warn-text" : "muted"}>{A.ago(s.last_seen)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

const cls = (due, result) => (result === "fail" ? "alert-text" : due === "overdue" ? "alert-text" : ["due", "never", "due-soon"].includes(due) || result === "pass-marginal" ? "warn-text" : "");
const ordinal = (n) => (n ? `${n}${["th", "st", "nd", "rd"][(n % 10 > 3 || Math.floor(n % 100 / 10) === 1) ? 0 : n % 10]}` : "—");
const monthName = (m) => (m ? ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][m - 1] : "—");

/* ---------- Schedule editor ---------- */
export function ScheduleEditor({ siteId }) {
  const { data, err } = useApi(`/api/sites/${siteId}`);
  const [form, setForm] = useState(null);
  const [saved, setSaved] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (data && !form) setForm(JSON.parse(JSON.stringify(data.site.test_schedule || { enabled: true, function: { day_of_month: 1, time: "02:00" }, duration: { month: 3, day_of_month: 15, time: "01:00" }, stagger_window_min: 60 }))); }, [data]);
  if (err) return <div className="loading">{err}</div>;
  if (!data || !form) return <div className="loading">Loading…</div>;
  const set = (path, v) => setForm((f) => { const n = JSON.parse(JSON.stringify(f)); let o = n; const ks = path.split("."); for (const k of ks.slice(0, -1)) o = o[k]; o[ks.at(-1)] = v; return n; });
  const save = async () => { setSaving(true); setSaved(null); try { const r = await A.apiPost(`/api/sites/${siteId}/schedule`, { test_schedule: form }); setSaved(`Saved. Next function test ${A.fmtDate(r.next_runs.function)}, next duration test ${A.fmtDate(r.next_runs.duration)}.`); } catch (e) { setSaved(e.message); } finally { setSaving(false); } };
  return (
    <div className="page narrow">
      <div className="page-head"><div><a className="back" href={`#/site/${siteId}`}>{data.site.name}</a><h1 className="h1">Test schedule</h1></div></div>
      <Panel title="Monthly function test">
        <div className="form-row"><label>Day of month<input type="number" min="1" max="28" value={form.function?.day_of_month ?? ""} onChange={(e) => set("function.day_of_month", Number(e.target.value))} /></label>
          <label>Time<input type="time" value={form.function?.time ?? ""} onChange={(e) => set("function.time", e.target.value)} /></label></div>
      </Panel>
      <Panel title="Annual duration test">
        <div className="form-row"><label>Month<select value={form.duration?.month ?? 3} onChange={(e) => set("duration.month", Number(e.target.value))}>{Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{monthName(i + 1)}</option>)}</select></label>
          <label>Day<input type="number" min="1" max="28" value={form.duration?.day_of_month ?? ""} onChange={(e) => set("duration.day_of_month", Number(e.target.value))} /></label>
          <label>Time<input type="time" value={form.duration?.time ?? ""} onChange={(e) => set("duration.time", e.target.value)} /></label></div>
        <div className="muted small-note">Choose a night when the building is at its quietest. Fittings are depleted for up to 24 h afterwards.</div>
      </Panel>
      <Panel title="Stagger">
        <div className="form-row"><label>Spread fittings over (minutes)<input type="number" min="5" max="360" value={form.stagger_window_min ?? 60} onChange={(e) => set("stagger_window_min", Number(e.target.value))} /></label></div>
      </Panel>
      <div className="control-buttons"><button className="btn" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save schedule"}</button>{saved && <span className="muted">{saved}</span>}</div>
    </div>
  );
}

/* ---------- Luminaire ---------- */

export function Luminaire({ luminaireId }) {
  const { data, err, reload } = useApi(`/api/luminaires/${luminaireId}`);
  const ev = useApi(`/api/luminaires/${luminaireId}/events?hours=720`);
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);
  const [manual, setManual] = useState(false);
  if (err) return <div className="loading">{err}</div>;
  if (!data) return <div className="loading">Loading luminaire…</div>;
  const { luminaire: l, state: s, latest, tests, faults } = data;
  const durations = tests.filter((t) => t.test_type === "duration").slice(0, 6).reverse();
  const functions = tests.filter((t) => t.test_type === "function").slice(0, 14).reverse();
  const openFaults = faults.filter((f) => f.status !== "closed");

  const run = async (type) => { setBusy(type); setMsg(null); try { const r = await A.apiPost("/api/control/test", { luminaire_id: l.luminaire_id, test_type: type }); setMsg(`${type === "duration" ? "Duration" : "Function"} test ${r.note}`); } catch (e) { setMsg(e.message); } finally { setBusy(null); } };
  const act = async (f, kind, note, action) => { await A.apiPost(`/api/faults/${kind}`, { luminaire_id: l.luminaire_id, opened_at: f.opened_at, note, action }); reload(); };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <a className="back" href={`#/site/${l.site_id}`}>{l.site_name || l.site_id}</a>
          <h1 className="h1">{l.name} <span className="muted h1-sub">{l.location}</span></h1>
          <div className="sub muted">{l.dev_eui} · rated {A.fmtMin(l.rated_minutes)} · installed {A.fmtDate(l.install_date)} · battery fitted {A.fmtDate(l.battery_date)}</div>
        </div>
        <div className="head-status"><StatusChip status={s.status} /></div>
      </div>

      <div className="grid three">
        <Panel title="Duration test" right={<span className={cls(s.duration_test?.status, s.duration_test?.last?.result)}>{A.dueText(s.duration_test)}</span>}>
          <DurationRing achieved={s.duration_test?.last?.achieved_min} rated={s.duration_test?.rated_min} result={s.duration_test?.last?.result} at={s.duration_test?.last?.at} />
          {s.duration_test?.last?.reason && <div className={`reason ${s.duration_test.last.result}`}>{s.duration_test.last.reason}</div>}
        </Panel>
        <Panel title="Battery over duration tests">
          <DurationHistory tests={durations} rated={s.duration_test?.rated_min} />
        </Panel>
        <Panel title="Now">
          <dl className="facts">
            <dt>Function test</dt><dd className={cls(s.function_test?.status)}>{A.fmtDate(s.function_test?.last?.at)} · {A.dueText(s.function_test)}</dd>
            <dt>Last report</dt><dd className={s.comms === "stale" ? "warn-text" : ""}>{A.fmtDateTime(s.last_seen)} ({A.ago(s.last_seen)})</dd>
            <dt>Battery</dt><dd className={s.battery_low ? "warn-text" : ""}>{A.fmtMv(s.battery_mv)} · charger {s.charger || "—"}</dd>
            <dt>Board temperature</dt><dd>{s.board_temp_c != null ? `${s.board_temp_c} °C` : "—"}</dd>
            <dt>Radio</dt><dd>{latest?.rssi != null ? `${latest.rssi} dBm` : "—"}{latest?.snr != null ? ` · SNR ${latest.snr}` : ""}</dd>
            <dt>Device counters</dt><dd className="muted">{latest?.days_since_function_test ?? "—"} d since function · {latest?.days_since_duration_test ?? "—"} d since duration</dd>
          </dl>
          <div className="control-buttons">
            <button className="btn" disabled={!!busy || !l.control_enabled} onClick={() => run("function")}>{busy === "function" ? "Sending…" : "Run function test"}</button>
            <button className="btn ghost" disabled={!!busy || !l.control_enabled} onClick={() => run("duration")}>{busy === "duration" ? "Sending…" : "Run duration test"}</button>
            <button className="btn ghost" onClick={() => setManual((m) => !m)}>Add manual entry</button>
          </div>
          {msg && <div className="muted small-note">{msg}</div>}
          {manual && <ManualEntry luminaireId={l.luminaire_id} onDone={() => { setManual(false); reload(); }} />}
        </Panel>
      </div>

      <div className="grid two">
        <Panel title={`Function tests — last ${functions.length}`}>
          <div className="fn-strip">
            {functions.map((t, i) => <span key={i} className={`mcell ${t.result.startsWith("pass") ? "pass" : "fail"}`} title={`${A.fmtDate(t.finished_at)} — ${t.result}`} />)}
          </div>
          <div className="muted small-note">Left to right, oldest to newest. Each cell is one automatic function test.</div>
        </Panel>
        <Panel title={`Faults${openFaults.length ? ` — ${openFaults.length} open` : ""}`}>
          {faults.length === 0 && <div className="empty">No faults recorded for this fitting.</div>}
          {faults.map((f) => <FaultRow key={f.opened_at} f={f} onAck={(n) => act(f, "ack", n)} onClose={(n, a) => act(f, "close", n, a)} />)}
        </Panel>
      </div>

      <Panel title="Record" right={<span className="muted">tests and faults, newest first · exported to the logbook</span>}>
        <table className="tbl">
          <thead><tr><th>When</th><th>Record</th><th>Result</th><th>Detail</th><th>Source</th></tr></thead>
          <tbody>
            {[...tests.map((t) => ({ at: t.finished_at || t.started_at, kind: `${t.test_type} test`, result: t.result, detail: t.achieved_min != null && t.test_type === "duration" ? `${t.achieved_min} min of ${t.rated_min}` : t.reason || "", src: t.source + (t.entered_by ? ` · ${t.entered_by}` : "") })),
              ...faults.map((f) => ({ at: f.opened_at, kind: `${f.subsystem} fault`, result: f.status, detail: f.summary + (f.remedial_action ? ` — ${f.remedial_action}` : ""), src: "automatic" }))]
              .sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 40)
              .map((r, i) => <tr key={i}><td className="muted nowrap">{A.fmtDateTime(r.at)}</td><td>{r.kind}</td><td className={r.result === "fail" ? "alert-text" : r.result === "pass-marginal" ? "warn-text" : ""}>{r.result}</td><td className="muted">{r.detail}</td><td className="muted">{r.src}</td></tr>)}
          </tbody>
        </table>
      </Panel>

      <Panel title="Raw events — last 30 days" right={<span className="muted">{ev.data?.events?.length ?? "…"} uplinks</span>}>
        {ev.data && <table className="tbl mono-tbl"><tbody>
          {ev.data.events.slice(0, 25).map((e, i) => <tr key={i}><td className="muted nowrap">{A.fmtDateTime(e.ts)}</td><td>{e.type}{e.test_type ? ` (${e.test_type})` : ""}</td><td className="muted">{e.battery_mv != null ? A.fmtMv(e.battery_mv) : ""}{e.test_duration_min != null ? ` · ${e.test_duration_min} min` : ""}{e.flags?.length ? ` · ${e.flags.join(", ")}` : ""}{e.rssi != null ? ` · ${e.rssi} dBm` : ""}</td></tr>)}
        </tbody></table>}
      </Panel>
    </div>
  );
}

function DurationRing({ achieved, rated = 180, result, at }) {
  const R = 54, C = 2 * Math.PI * R;
  const pct = achieved == null ? 0 : Math.min(1, achieved / rated);
  const tone = result === "fail" ? "alert" : result === "pass-marginal" ? "warn" : achieved == null ? "idle" : "ok";
  return (
    <div className="ring-wrap">
      <svg viewBox="0 0 140 140" className={`ring ${tone}`} role="img" aria-label={`Achieved ${achieved ?? "none"} of ${rated} minutes`}>
        <circle cx="70" cy="70" r={R} className="ring-track" />
        <circle cx="70" cy="70" r={R} className="ring-fill" strokeDasharray={`${C * pct} ${C}`} transform="rotate(-90 70 70)" />
        <text x="70" y="66" className="ring-num">{achieved ?? "—"}</text>
        <text x="70" y="86" className="ring-lbl">of {rated} min</text>
      </svg>
      <div className="ring-side">
        <div className={`ring-result ${tone}`}>{result ? ({ pass: "Pass", "pass-marginal": "Pass, marginal", fail: "Fail", incomplete: "Incomplete" })[result] : "Not yet tested"}</div>
        <div className="muted">{at ? A.fmtDate(at) : ""}</div>
      </div>
    </div>
  );
}

function DurationHistory({ tests, rated = 180 }) {
  if (!tests.length) return <div className="empty">No duration tests on record yet.</div>;
  const W = 320, H = 120, pad = 26, max = Math.max(rated * 1.3, ...tests.map((t) => t.achieved_min || 0));
  const x = (i) => pad + (i * (W - pad * 2)) / Math.max(1, tests.length - 1);
  const y = (v) => H - 18 - ((H - 34) * v) / max;
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`}>
        <line className="rated-line" x1={pad} x2={W - pad} y1={y(rated)} y2={y(rated)} />
        <text className="axis" x={W - pad} y={y(rated) - 4} textAnchor="end">rated {rated}</text>
        <polyline className="dur-line" points={tests.map((t, i) => `${x(i)},${y(t.achieved_min || 0)}`).join(" ")} />
        {tests.map((t, i) => (
          <g key={i}>
            <circle className={`dur-pt ${t.result}`} cx={x(i)} cy={y(t.achieved_min || 0)} r="4"><title>{`${A.fmtDate(t.finished_at)} — ${t.achieved_min} min (${t.result})`}</title></circle>
            <text className="axis" x={x(i)} y={H - 4} textAnchor="middle">{new Date(t.finished_at).getFullYear()}</text>
            <text className="axis num" x={x(i)} y={y(t.achieved_min || 0) - 8} textAnchor="middle">{t.achieved_min}</text>
          </g>
        ))}
      </svg>
      <div className="muted small-note">Minutes achieved in each annual test. A falling line is a battery approaching replacement.</div>
    </div>
  );
}

function FaultRow({ f, onAck, onClose }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [action, setAction] = useState("");
  return (
    <div className={`fault ${f.status} ${f.severity}`}>
      <div className="fault-head">
        <Led status={f.status === "closed" ? "idle" : f.severity} />
        <div className="fault-title">{f.summary}</div>
        <div className="muted">{A.fmtDateTime(f.opened_at)}</div>
        <span className={`chip ${f.status === "closed" ? "" : f.status === "acknowledged" ? "cyan" : f.severity === "alert" ? "alert" : "warn"}`}>{f.status}</span>
      </div>
      {f.ack_note && <div className="fault-note muted">Acknowledged by {f.acked_by} · {f.ack_note}</div>}
      {f.close_note && <div className="fault-note muted">Closed by {f.closed_by} · {f.close_note}{f.remedial_action ? ` · ${f.remedial_action}` : ""}</div>}
      {f.status !== "closed" && (
        <div className="fault-actions">
          {!open && f.status === "open" && <button className="btn tiny ghost" onClick={() => { setOpen("ack"); }}>Acknowledge</button>}
          {!open && <button className="btn tiny ghost" onClick={() => { setOpen("close"); }}>Close with action</button>}
          {open && (
            <div className="fault-form">
              <input placeholder={open === "ack" ? "Note (optional)" : "What was done?"} value={note} onChange={(e) => setNote(e.target.value)} />
              {open === "close" && <select value={action} onChange={(e) => setAction(e.target.value)}><option value="">Remedial action…</option><option>Battery replaced</option><option>Luminaire replaced</option><option>Lamp replaced</option><option>Re-commissioned</option><option>Fault cleared on inspection</option><option>Other</option></select>}
              <button className="btn tiny" onClick={() => (open === "ack" ? onAck(note) : onClose(note, action))}>{open === "ack" ? "Acknowledge" : "Close fault"}</button>
              <button className="btn tiny ghost" onClick={() => setOpen(false)}>Cancel</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ManualEntry({ luminaireId, onDone }) {
  const [f, setF] = useState({ test_type: "function", result: "pass", at: new Date().toISOString().slice(0, 16), achieved_min: "", note: "" });
  const [busy, setBusy] = useState(false);
  const save = async () => { setBusy(true); try { await A.apiPost("/api/tests/manual", { luminaire_id: luminaireId, ...f, at: new Date(f.at).toISOString(), achieved_min: Number(f.achieved_min) || null }); onDone(); } finally { setBusy(false); } };
  return (
    <div className="manual">
      <div className="muted small-note">For a test done by hand, e.g. during commissioning. Recorded as a manual entry with your name.</div>
      <div className="form-row">
        <label>Type<select value={f.test_type} onChange={(e) => setF({ ...f, test_type: e.target.value })}><option value="function">Function</option><option value="duration">Duration</option></select></label>
        <label>Result<select value={f.result} onChange={(e) => setF({ ...f, result: e.target.value })}><option value="pass">Pass</option><option value="fail">Fail</option></select></label>
        <label>When<input type="datetime-local" value={f.at} onChange={(e) => setF({ ...f, at: e.target.value })} /></label>
        {f.test_type === "duration" && <label>Minutes<input type="number" value={f.achieved_min} onChange={(e) => setF({ ...f, achieved_min: e.target.value })} /></label>}
      </div>
      <div className="form-row"><label>Note<input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></label></div>
      <div className="control-buttons"><button className="btn tiny" disabled={busy} onClick={save}>Save entry</button></div>
    </div>
  );
}

/* ---------- Exceptions ---------- */

export function Exceptions() {
  const { data, err, reload } = useApi("/api/exceptions");
  const [filter, setFilter] = useState("all");
  if (err) return <div className="loading">{err}</div>;
  if (!data) return <div className="loading">Loading queue…</div>;
  const items = data.exceptions.filter((e) => filter === "all" || e.state.status === filter);
  const bySite = {};
  for (const e of items) (bySite[e.site_name] ||= []).push(e);
  return (
    <div className="page">
      <div className="page-head">
        <div><a className="back" href="#/">Estate</a><h1 className="h1">Needs attention</h1><div className="sub muted">{data.count} fittings across {Object.keys(bySite).length} sites. Work the reds first.</div></div>
        <div className="seg">
          {["all", "alert", "warn"].map((f) => <button key={f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>{f === "all" ? "All" : f === "alert" ? "Action needed" : "Attention"}</button>)}
        </div>
      </div>
      {!items.length && <div className="empty">Queue is clear.</div>}
      {Object.entries(bySite).map(([site, list]) => (
        <Panel key={site} title={site} right={<span className="muted">{list.length}</span>}>
          <table className="tbl">
            <thead><tr><th className="led-col"></th><th>Fitting</th><th>Location</th><th>Why</th><th>Function</th><th>Duration</th><th>Last report</th></tr></thead>
            <tbody>
              {list.map((e) => (
                <tr key={e.luminaire_id} className="rowlink" onClick={() => go(`/luminaire/${e.luminaire_id}`)}>
                  <td className="led-col"><Led status={e.state.status} /></td>
                  <td><strong>{e.name}</strong></td>
                  <td className="muted">{e.location}</td>
                  <td>{whyText(e)}</td>
                  <td className={cls(e.state.function_test?.status)}>{A.dueText(e.state.function_test)}</td>
                  <td className={cls(e.state.duration_test?.status, e.state.duration_test?.last?.result)}>{A.dueText(e.state.duration_test)}</td>
                  <td className={e.state.comms === "stale" ? "warn-text" : "muted"}>{A.ago(e.state.last_seen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      ))}
    </div>
  );
}

/* ---------- Reports ---------- */

export function Reports({ presetSite }) {
  const { data } = useApi("/api/portfolio");
  const [siteId, setSiteId] = useState(presetSite || "");
  const [from, setFrom] = useState(`${new Date().getFullYear()}-01-01`);
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  useEffect(() => { if (data && !siteId) setSiteId(data.sites[0]?.site_id || ""); }, [data]);
  const site = data?.sites.find((s) => s.site_id === siteId);
  const fetchCsv = async () => { setBusy(true); try { const csv = await A.api(`/api/reports/logbook?site_id=${siteId}&from=${from}&to=${to}`); setPreview(typeof csv === "string" ? csv : ""); return csv; } finally { setBusy(false); } };
  const download = async () => { const csv = await fetchCsv(); const blob = new Blob([csv], { type: "text/csv" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `beacon-logbook-${siteId}-${from}-${to}.csv`; a.click(); };
  const rows = preview ? preview.split("\r\n").filter(Boolean).map((r) => r.split(",")) : null;
  return (
    <div className="page">
      <div className="page-head"><div><a className="back" href="#/">Estate</a><h1 className="h1">Logbook and reports</h1><div className="sub muted">The record a fire risk assessor or insurer asks for. Every automatic test, every fault, every remedial action, per fitting.</div></div></div>
      <div className="grid two">
        <Panel title="Emergency lighting logbook">
          <div className="form-row">
            <label>Site<select value={siteId} onChange={(e) => setSiteId(e.target.value)}>{(data?.sites || []).map((s) => <option key={s.site_id} value={s.site_id}>{s.name}</option>)}</select></label>
            <label>From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
            <label>To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          </div>
          <div className="control-buttons"><button className="btn" disabled={busy || !siteId} onClick={download}>{busy ? "Preparing…" : "Download CSV"}</button><button className="btn ghost" disabled={busy || !siteId} onClick={fetchCsv}>Preview</button></div>
          {site && <div className="muted small-note">{site.name}: {site.luminaires} fittings, {A.fmtPct(site.compliant_pct)} compliant today. The PDF certificate layout (BS 5266-1 Annex-style) ships in the next drop.</div>}
        </Panel>
        <Panel title="What's in it">
          <ul className="plain">
            <li>Monthly function tests with date, result and the luminaire that reported them</li>
            <li>Annual duration tests with minutes achieved against rated duration</li>
            <li>Faults with subsystem, when opened, who acknowledged and closed them, and the remedial action</li>
            <li>Genuine mains failures and how long each fitting ran on battery</li>
            <li>Manual entries flagged as such, with the person who entered them</li>
          </ul>
        </Panel>
      </div>
      {rows && (
        <Panel title={`Preview — ${rows.length - 1} records`}>
          <div className="scroll-x"><table className="tbl mono-tbl"><thead><tr>{rows[0].map((h, i) => <th key={i}>{h}</th>)}</tr></thead><tbody>{rows.slice(1, 60).map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table></div>
        </Panel>
      )}
    </div>
  );
}
