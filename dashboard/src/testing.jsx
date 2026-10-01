/* testing.jsx — the Testing planner: agenda · one-off tests · recurring schedules · testing windows · plan the year */
import React, { useEffect, useMemo, useState } from "react";
import * as A from "./api.js";
import { Panel, Led, Skeleton, PageSkeleton, Chips, useToast } from "./ui.jsx";

const go = (h) => { window.location.hash = h; };
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const ord = (n) => (n === -1 ? "last" : `${n}${["th", "st", "nd", "rd"][(n % 10 > 3 || Math.floor(n % 100 / 10) === 1) ? 0 : n % 10]}`);
const localInput = (ms) => { const d = new Date(ms); d.setSeconds(0, 0); const off = d.getTimezoneOffset(); return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16); };

function useApi(path, deps = []) {
  const [data, setData] = useState(null); const [err, setErr] = useState(null); const [tick, setTick] = useState(0);
  useEffect(() => { let live = true; setErr(null); A.api(path).then((d) => live && setData(d), (e) => live && setErr(e.message)); return () => { live = false; }; }, [path, tick, ...deps]);
  return { data, err, reload: () => setTick((t) => t + 1) };
}

/* ======================================================================
   Testing page
   ====================================================================== */
export function Testing({ tab: initialTab, presetSite }) {
  const portfolio = useApi("/api/portfolio");
  const agenda = useApi("/api/agenda?days=30");
  const schedules = useApi("/api/schedules");
  const [tab, setTab] = useState(initialTab || "agenda");
  const [siteId, setSiteId] = useState(presetSite || "");
  useEffect(() => { if (portfolio.data && !siteId) setSiteId(portfolio.data.sites[0]?.site_id || ""); }, [portfolio.data]);
  if (portfolio.err) return <div className="page"><div className="errorbox">{portfolio.err}</div></div>;
  if (!portfolio.data) return <PageSkeleton />;
  const sites = [...portfolio.data.sites].sort((a, b) => a.name.localeCompare(b.name));
  const reloadAll = () => { agenda.reload(); schedules.reload(); portfolio.reload(); };
  const pending = (agenda.data?.items || []).filter((i) => i.kind === "job").length;
  const week = (agenda.data?.items || []).filter((i) => Date.parse(i.at) < Date.now() + 7 * 86400000).length;
  const withWindows = sites.filter((s) => s.test_window).length;
  const problems = (schedules.data?.schedules || []).filter((s) => !s.window_check?.ok).length;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <a className="back" href="#/">Estate</a>
          <h1 className="h1">Testing</h1>
          <div className="sub muted">Fittings run their own monthly and annual tests. This is where you set when a site may be tested, add schedules where the fitting's own clock isn't good enough, and plan the year.</div>
        </div>
        <div className="kpi-row">
          <Kpi label="Next 7 days" value={week} />
          <Kpi label="One-off tests" value={pending} />
          <Kpi label="Schedules" value={schedules.data?.schedules.length ?? "…"} tone={problems ? "warn" : undefined} />
          <Kpi label="Sites with windows" value={`${withWindows}/${sites.length}`} tone={withWindows < sites.length ? "warn" : "ok"} />
        </div>
      </div>

      <div className="toolbar">
        <Chips value={tab} onChange={setTab} options={[{ id: "agenda", label: "Agenda" }, { id: "oneoff", label: "One-off test" }, { id: "schedules", label: "Schedules", count: schedules.data?.schedules.length }, { id: "windows", label: "Testing windows", count: withWindows, tone: withWindows < sites.length ? "warn" : undefined }, { id: "plan", label: "Plan the year" }]} />
      </div>

      {tab === "agenda" && <Agenda agenda={agenda} onChange={reloadAll} />}
      {tab === "oneoff" && <OneOff sites={sites} presetSite={siteId} onDone={() => { reloadAll(); setTab("agenda"); }} />}
      {tab === "schedules" && <Schedules schedules={schedules} sites={sites} presetSite={siteId} onChange={reloadAll} />}
      {tab === "windows" && <Windows sites={sites} siteId={siteId} setSiteId={setSiteId} onChange={reloadAll} />}
      {tab === "plan" && <PlanYear sites={sites} onDone={() => { reloadAll(); setTab("agenda"); }} />}
    </div>
  );
}

function Kpi({ label, value, tone }) { return <div className={`kpi ${tone || ""}`}><div className="kpi-label">{label}</div><div className="kpi-value num">{value ?? "—"}</div></div>; }
const TypeTag = ({ t }) => <span className={`ttag ${t}`}>{t === "duration" ? "Duration" : "Function"}</span>;

/* ---------- Agenda ---------- */
function Agenda({ agenda, onChange }) {
  const toast = useToast();
  if (agenda.err) return <div className="errorbox">{agenda.err}</div>;
  if (!agenda.data) return <Panel title="Next 30 days"><Skeleton lines={6} /></Panel>;
  const byDay = {};
  for (const i of agenda.data.items) (byDay[i.at.slice(0, 10)] ||= []).push(i);
  const days = Object.keys(byDay).sort();
  const cancel = async (j) => { await A.apiPost("/api/jobs/cancel", { job_id: j.job_id }); toast("Test cancelled."); onChange(); };
  return (
    <Panel title="Next 30 days" right={<span className="muted">{agenda.data.items.length} planned · schedules and one-off tests</span>}>
      {!days.length && <div className="empty">Nothing planned. Every fitting still runs its own routine tests.</div>}
      <div className="agenda">
        {days.map((d) => {
          const dt = new Date(d + "T12:00:00");
          const isToday = d === new Date().toISOString().slice(0, 10);
          return (
            <div key={d} className={`agenda-day ${isToday ? "today" : ""}`}>
              <div className="agenda-date"><div className="agenda-dow">{WD[dt.getDay()]}</div><div className="agenda-dom num">{dt.getDate()}</div><div className="agenda-mon">{MONTHS[dt.getMonth()].slice(0, 3)}</div></div>
              <div className="agenda-items">
                {byDay[d].map((i, k) => (
                  <div key={k} className={`agenda-item ${i.kind} ${i.window_ok === false ? "bad" : ""}`}>
                    <span className="agenda-time num">{new Date(i.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>
                    <TypeTag t={i.test_type} />
                    <span className="agenda-scope">{i.scope_name}{i.scope?.luminaire_id ? "" : " — whole site"}</span>
                    <span className="muted agenda-src">{i.kind === "job" ? `one-off · ${i.by}` : `schedule · ${i.name}`}{i.note && i.kind === "job" ? ` · ${i.note}` : ""}</span>
                    {i.window_override && <span className="tag warn" title={i.window_override}>override</span>}
                    {i.window_ok === false && <span className="tag alert" title={i.window_reason}>outside window</span>}
                    {i.kind === "job" && <button className="btn tiny ghost agenda-act" onClick={() => cancel(i)}>Cancel</button>}
                    {i.kind === "schedule" && <a className="btn tiny ghost agenda-act" href="#/testing/schedules">Edit schedule</a>}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

/* ---------- One-off ---------- */
export function OneOff({ sites, presetSite, presetLuminaire, luminaireName, onDone, embedded }) {
  const toast = useToast();
  const tomorrow = new Date(Date.now() + 86400000); tomorrow.setHours(2, 0, 0, 0);
  const [f, setF] = useState({ site_id: presetSite || sites[0]?.site_id || "", test_type: "function", run_at: localInput(tomorrow.getTime()), stagger_window_min: presetLuminaire ? 0 : 60, note: "", override_reason: "" });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(null); const [slot, setSlot] = useState(null); const [needOverride, setNeedOverride] = useState(false);
  const site = sites.find((s) => s.site_id === f.site_id);
  const w = site?.test_window;
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await A.apiPost("/api/jobs", { test_type: f.test_type, run_at: new Date(f.run_at).toISOString(), stagger_window_min: f.stagger_window_min, note: f.note, override_reason: needOverride ? f.override_reason : "", scope: presetLuminaire ? { luminaire_id: presetLuminaire } : { site_id: f.site_id } });
      toast(`${f.test_type === "duration" ? "Duration" : "Function"} test scheduled for ${A.fmtDateTime(r.job.run_at)}.`); onDone?.();
    } catch (e) {
      const d = e.detail || {};
      setErr(e.message); setSlot(d.next_slot || null); setNeedOverride(!!d.next_slot);
    } finally { setBusy(false); }
  };
  return (
    <Panel title={embedded ? "Schedule a one-off test" : "One-off test"} className="oneoff">
      <div className="form-row">
        {!presetLuminaire ? <label>Site<select value={f.site_id} onChange={(e) => setF({ ...f, site_id: e.target.value })}>{sites.map((s) => <option key={s.site_id} value={s.site_id}>{s.name}</option>)}</select></label>
          : <label>Fitting<input value={luminaireName || presetLuminaire} readOnly /></label>}
        <label>Type<select value={f.test_type} onChange={(e) => setF({ ...f, test_type: e.target.value })}><option value="function">Function (short)</option><option value="duration">Duration (full rated time)</option></select></label>
        <label>When<input type="datetime-local" value={f.run_at} onChange={(e) => { setF({ ...f, run_at: e.target.value }); setErr(null); setNeedOverride(false); }} /></label>
        {!presetLuminaire && <label>Stagger over (min)<input type="number" min="0" max="360" value={f.stagger_window_min} onChange={(e) => setF({ ...f, stagger_window_min: Number(e.target.value) })} /></label>}
      </div>
      <div className="form-row"><label>Why (goes in the logbook)<input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="e.g. re-test after battery replacement" /></label></div>
      {w ? <div className="winline"><WindowGlyph w={w} small /> <span className="muted">Testing window for {site.name}: {WD.filter((_, i) => w.days.includes(i)).join(" ")} {w.start}–{w.end}{w.blackouts?.length ? ` · ${w.blackouts.length} blackout${w.blackouts.length > 1 ? "s" : ""}` : ""}</span></div>
        : <div className="muted small-note">No testing window set for this site — any time is accepted. <a href="#/testing/windows">Set one</a> if the building has occupied hours.</div>}
      {f.test_type === "duration" && <div className="muted small-note">Fittings are depleted for up to 24 h afterwards, and a test is held back automatically if a real mains outage happened in the last 24 h.</div>}
      {err && (
        <div className="banner warn">
          <strong>{err}</strong>
          <div className="control-buttons">
            {slot && <button className="btn tiny" onClick={() => { setF({ ...f, run_at: localInput(Date.parse(slot)) }); setErr(null); setNeedOverride(false); }}>Use next allowed slot — {A.fmtDateTime(slot)}</button>}
            {needOverride && <input className="override" placeholder="…or give a reason to override (logged)" value={f.override_reason} onChange={(e) => setF({ ...f, override_reason: e.target.value })} />}
          </div>
        </div>
      )}
      <div className="control-buttons"><button className="btn" disabled={busy || (needOverride && !f.override_reason.trim())} onClick={submit}>{busy ? "Scheduling…" : needOverride && f.override_reason.trim() ? "Schedule with override" : "Schedule"}</button></div>
    </Panel>
  );
}

/* ---------- Schedules ---------- */
function Schedules({ schedules, sites, presetSite, onChange }) {
  const toast = useToast();
  const [editing, setEditing] = useState(null); // null | "new" | schedule object
  const [confirm, setConfirm] = useState(null);
  if (schedules.err) return <div className="errorbox">{schedules.err}</div>;
  const list = schedules.data?.schedules || [];
  const toggle = async (s) => { await A.apiPost(`/api/schedules/${s.schedule_id}/update`, { enabled: !s.enabled }); toast(s.enabled ? "Schedule paused." : "Schedule resumed."); onChange(); };
  const del = async (s) => { await A.apiPost(`/api/schedules/${s.schedule_id}/delete`, {}); toast("Schedule deleted. Already-created one-off tests stay on the agenda."); setConfirm(null); onChange(); };
  return (
    <>
      <div className="explain muted">A schedule tells the platform to send a test at a fixed time — useful when the fitting's own timing doesn't suit the building, or when the customer wants a test on a particular day for their records. Each occurrence becomes a one-off test on the agenda, staggered and held back after a mains outage like any other.</div>
      {editing && <ScheduleForm sites={sites} presetSite={presetSite} initial={editing === "new" ? null : editing} onDone={() => { setEditing(null); onChange(); }} onCancel={() => setEditing(null)} />}
      {!editing && <div className="control-buttons" style={{ marginBottom: 12 }}><button className="btn" onClick={() => setEditing("new")}>New schedule</button></div>}
      {!schedules.data && <Panel><Skeleton lines={4} /></Panel>}
      {schedules.data && !list.length && <div className="empty">No schedules. Fittings keep testing themselves on their own clocks.</div>}
      <div className="sched-list">
        {list.map((s) => (
          <div key={s.schedule_id} className={`schedcard ${s.enabled ? "" : "paused"} ${!s.window_check?.ok ? "bad" : ""}`}>
            <div className="schedcard-head">
              <TypeTag t={s.test_type} />
              <div className="schedcard-name">{s.name}</div>
              <span className="muted">{s.scope?.luminaire_id ? s.scope_name : `${s.scope_name} — whole site`}</span>
              <span className={`chip ${s.enabled ? "amber" : ""}`}>{s.enabled ? "active" : "paused"}</span>
            </div>
            <div className="schedcard-body">
              <div><span className="muted">Rule</span><br />{s.description}{s.stagger_window_min ? <span className="muted"> · staggered over {s.stagger_window_min} min</span> : null}</div>
              <div><span className="muted">Next</span><br />{s.next.slice(0, 3).map((n, i) => <span key={i} className="num nextdate">{A.fmtDateTimeY(n)}</span>)}</div>
              <div><span className="muted">Window</span><br />{s.window_check?.ok ? <span className="ok-text">inside the site's testing window</span> : <span className="alert-text" title={s.window_check.problems.join("\n")}>outside the testing window{s.window_override ? ` — override: ${s.window_override}` : ""}</span>}</div>
            </div>
            {s.note && <div className="muted small-note">{s.note}</div>}
            <div className="fault-actions">
              <button className="btn tiny ghost" onClick={() => setEditing(s)}>Edit</button>
              <button className="btn tiny ghost" onClick={() => toggle(s)}>{s.enabled ? "Pause" : "Resume"}</button>
              {confirm === s.schedule_id ? <><span className="muted">Delete this schedule?</span><button className="btn tiny" onClick={() => del(s)}>Yes, delete</button><button className="btn tiny ghost" onClick={() => setConfirm(null)}>Keep</button></> : <button className="btn tiny ghost danger" onClick={() => setConfirm(s.schedule_id)}>Delete</button>}
              <span className="muted schedcard-meta">created by {s.created_by}{s.last_run_at ? ` · last ran ${A.fmtDateTime(s.last_run_at)}` : ""}</span>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function ScheduleForm({ sites, presetSite, initial, onDone, onCancel }) {
  const toast = useToast();
  const [f, setF] = useState(() => initial ? { ...initial, site_id: initial.scope?.site_id || "", kind: initial.recurrence.kind, day_of_month: initial.recurrence.day_of_month || 1, nth: initial.recurrence.nth || 1, weekday: initial.recurrence.weekday ?? 2, month: initial.recurrence.month || 3, interval_days: initial.recurrence.interval_days || 30, override_reason: "" }
    : { name: "", site_id: presetSite || sites[0]?.site_id || "", test_type: "function", kind: "monthly-nth-weekday", day_of_month: 1, nth: 1, weekday: 2, month: 3, interval_days: 30, time: "10:00", stagger_window_min: 60, note: "", enabled: true, override_reason: "" });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(null); const [problems, setProblems] = useState([]);
  const site = sites.find((s) => s.site_id === f.site_id);
  const w = site?.test_window;
  const recurrence = { kind: f.kind, day_of_month: Number(f.day_of_month), nth: Number(f.nth), weekday: Number(f.weekday), month: Number(f.month), interval_days: Number(f.interval_days) };
  const preview = f.kind === "monthly-dom" ? `Monthly on the ${ord(Number(f.day_of_month))} at ${f.time}` : f.kind === "monthly-nth-weekday" ? `Monthly on the ${ord(Number(f.nth))} ${WD[f.weekday]} at ${f.time}` : f.kind === "annual" ? `Every ${ord(Number(f.day_of_month))} ${MONTHS[f.month - 1]} at ${f.time}` : f.kind === "weekly" ? `Every ${WD[f.weekday]} at ${f.time}` : `Every ${f.interval_days} days at ${f.time}`;
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const body = { name: f.name, scope: initial?.scope?.luminaire_id ? initial.scope : { site_id: f.site_id }, test_type: f.test_type, recurrence, time: f.time, stagger_window_min: Number(f.stagger_window_min), note: f.note, enabled: f.enabled !== false, override_reason: f.override_reason };
      await A.apiPost(initial ? `/api/schedules/${initial.schedule_id}/update` : "/api/schedules", body);
      toast(initial ? "Schedule updated." : "Schedule created."); onDone();
    } catch (e) { setErr(e.message); setProblems(e.detail?.problems || []); } finally { setBusy(false); }
  };
  return (
    <Panel title={initial ? "Edit schedule" : "New schedule"} className="schedform">
      <div className="form-row">
        <label>Name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={preview} /></label>
        {!initial?.scope?.luminaire_id && <label>Site<select value={f.site_id} onChange={(e) => setF({ ...f, site_id: e.target.value })}>{sites.map((s) => <option key={s.site_id} value={s.site_id}>{s.name}</option>)}</select></label>}
        <label>Type<select value={f.test_type} onChange={(e) => setF({ ...f, test_type: e.target.value })}><option value="function">Function</option><option value="duration">Duration</option></select></label>
      </div>
      <div className="form-row">
        <label>Repeats<select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
          <option value="monthly-nth-weekday">Monthly, on a weekday (e.g. 2nd Tuesday)</option><option value="monthly-dom">Monthly, on a date</option><option value="annual">Annually</option><option value="weekly">Weekly</option><option value="interval">Every N days</option></select></label>
        {f.kind === "monthly-nth-weekday" && <><label>Which<select value={f.nth} onChange={(e) => setF({ ...f, nth: Number(e.target.value) })}>{[1, 2, 3, 4, -1].map((n) => <option key={n} value={n}>{ord(n)}</option>)}</select></label><label>Weekday<select value={f.weekday} onChange={(e) => setF({ ...f, weekday: Number(e.target.value) })}>{WD.map((d, i) => <option key={i} value={i}>{d}</option>)}</select></label></>}
        {(f.kind === "monthly-dom" || f.kind === "annual") && <label>Day of month<input type="number" min="1" max="28" value={f.day_of_month} onChange={(e) => setF({ ...f, day_of_month: Number(e.target.value) })} /></label>}
        {f.kind === "annual" && <label>Month<select value={f.month} onChange={(e) => setF({ ...f, month: Number(e.target.value) })}>{MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}</select></label>}
        {f.kind === "weekly" && <label>Weekday<select value={f.weekday} onChange={(e) => setF({ ...f, weekday: Number(e.target.value) })}>{WD.map((d, i) => <option key={i} value={i}>{d}</option>)}</select></label>}
        {f.kind === "interval" && <label>Every (days)<input type="number" min="1" max="400" value={f.interval_days} onChange={(e) => setF({ ...f, interval_days: Number(e.target.value) })} /></label>}
        <label>Time<input type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} /></label>
        <label>Stagger (min)<input type="number" min="0" max="360" value={f.stagger_window_min} onChange={(e) => setF({ ...f, stagger_window_min: Number(e.target.value) })} /></label>
      </div>
      <div className="form-row"><label>Note<input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Why this schedule exists — shows on every test it creates" /></label></div>
      <div className="preview"><strong>{preview}</strong>{w ? <span className="muted"> · window {w.start}–{w.end}, {WD.filter((_, i) => w.days.includes(i)).length === 7 ? "every day" : WD.filter((_, i) => w.days.includes(i)).join(" ")}</span> : <span className="muted"> · no testing window on this site</span>}</div>
      {err && <div className="banner warn"><strong>{err}</strong>{problems.length > 0 && <ul className="plain small-note">{problems.map((p, i) => <li key={i}>{p}</li>)}</ul>}
        <div className="control-buttons"><input className="override" placeholder="Reason to override the window (logged)" value={f.override_reason} onChange={(e) => setF({ ...f, override_reason: e.target.value })} /></div></div>}
      <div className="control-buttons"><button className="btn" disabled={busy} onClick={save}>{busy ? "Saving…" : initial ? "Save changes" : "Create schedule"}</button><button className="btn ghost" onClick={onCancel}>Cancel</button></div>
    </Panel>
  );
}

/* ---------- Testing windows ---------- */
function WindowGlyph({ w, small }) {
  // 7 rows × 24 cols: allowed hours lit
  const s = toMin(w.start), e = toMin(w.end), crosses = e <= s;
  const on = (d, h) => { const m = h * 60; const inHours = !crosses ? (m >= s && m < e) : (m >= s || m < e); if (!inHours) return false; const day = crosses && m < e ? (d + 6) % 7 : d; return w.days.includes(day); };
  return (
    <svg viewBox="0 0 96 28" className={`winglyph ${small ? "small" : ""}`} role="img" aria-label="Allowed testing hours">
      {Array.from({ length: 7 }, (_, d) => Array.from({ length: 24 }, (_, h) => <rect key={`${d}-${h}`} x={h * 4} y={d * 4} width="3.4" height="3.4" rx=".6" className={on(d, h) ? "on" : ""} />))}
    </svg>
  );
}
const toMin = (hm) => { const [h, m] = String(hm || "00:00").split(":").map(Number); return h * 60 + (m || 0); };

function Windows({ sites, siteId, setSiteId, onChange }) {
  const toast = useToast();
  const site = sites.find((s) => s.site_id === siteId) || sites[0];
  const presets = useApi("/api/windows/presets");
  const [w, setW] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setW(site?.test_window ? JSON.parse(JSON.stringify(site.test_window)) : null); }, [site?.site_id, site?.test_window]);
  if (!site) return null;
  const P = presets.data?.presets || {};
  const apply = (id) => setW({ ...(P[id] || {}), blackouts: w?.blackouts || [], duration_gap_hours: 24, preset: id, note: w?.note || "" });
  const save = async () => { setBusy(true); try { await A.apiPost(`/api/sites/${site.site_id}/window`, { test_window: w }); toast(`Testing window saved for ${site.name}.`); onChange(); } catch (e) { toast(e.message, "alert"); } finally { setBusy(false); } };
  const clear = async () => { setBusy(true); try { await A.apiPost(`/api/sites/${site.site_id}/window`, { test_window: null }); setW(null); toast(`Testing window removed — ${site.name} can be tested at any time.`); onChange(); } finally { setBusy(false); } };
  const setDay = (d) => setW({ ...w, days: w.days.includes(d) ? w.days.filter((x) => x !== d) : [...w.days, d].sort() });
  const addBlackout = () => setW({ ...w, blackouts: [...(w.blackouts || []), { from: new Date().toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10), reason: "" }] });
  return (
    <div className="grid two windows-grid">
      <Panel title="Sites" right={<span className="muted">{sites.filter((s) => s.test_window).length} of {sites.length} have a window</span>}>
        <div className="sitepick">
          {sites.map((s) => (
            <button key={s.site_id} className={`sitepick-row ${s.site_id === site.site_id ? "on" : ""}`} onClick={() => setSiteId(s.site_id)}>
              <Led status={s.status} /><span className="sitepick-name">{s.name}</span>
              {s.test_window ? <><WindowGlyph w={s.test_window} small /><span className="muted">{s.test_window.start}–{s.test_window.end}</span></> : <span className="tag warn">no window</span>}
            </button>
          ))}
        </div>
      </Panel>
      <Panel title={`Testing window — ${site.name}`} right={<span className="muted">{site.kind} · {site.tz}</span>}>
        <div className="explain muted">When may this building be tested? Duration tests leave fittings depleted for hours and the escape lighting dim during the test, so a cinema wants mornings, flats want the small hours, an office wants evenings.</div>
        <div className="presets">{Object.entries(P).map(([id, p]) => <button key={id} className={`chip-btn ${w?.preset === id ? "on" : ""}`} onClick={() => apply(id)}>{p.label}</button>)}</div>
        {!w && <div className="empty">No window set. Pick a preset above or <button className="linkbtn" onClick={() => apply("residential")}>start from residential</button>.</div>}
        {w && (
          <>
            <div className="winedit">
              <WindowGlyph w={w} />
              <div className="winedit-fields">
                <div className="daytoggles">{WD.map((d, i) => <button key={i} className={`daytoggle ${w.days.includes(i) ? "on" : ""}`} onClick={() => setDay(i)}>{d}</button>)}</div>
                <div className="form-row">
                  <label>From<input type="time" value={w.start} onChange={(e) => setW({ ...w, start: e.target.value, preset: null })} /></label>
                  <label>Until<input type="time" value={w.end} onChange={(e) => setW({ ...w, end: e.target.value, preset: null })} /></label>
                  <label>Gap between duration tests (h)<input type="number" min="0" max="168" value={w.duration_gap_hours ?? 24} onChange={(e) => setW({ ...w, duration_gap_hours: Number(e.target.value) })} /></label>
                </div>
                {toMin(w.end) <= toMin(w.start) && <div className="muted small-note">Window crosses midnight — a test that starts on a Monday evening and ends on Tuesday morning counts as Monday.</div>}
              </div>
            </div>
            <div className="blackouts">
              <div className="eyebrow">Blackout dates <button className="btn tiny ghost" onClick={addBlackout}>Add</button></div>
              {!(w.blackouts || []).length && <div className="muted small-note">None. Add dates when nothing should run — a festival, an exam week, a Christmas run of screenings.</div>}
              {(w.blackouts || []).map((b, i) => (
                <div key={i} className="form-row blackout">
                  <label>From<input type="date" value={b.from} onChange={(e) => { const bl = [...w.blackouts]; bl[i] = { ...b, from: e.target.value, to: b.to < e.target.value ? e.target.value : b.to }; setW({ ...w, blackouts: bl }); }} /></label>
                  <label>To<input type="date" value={b.to} min={b.from} onChange={(e) => { const bl = [...w.blackouts]; bl[i] = { ...b, to: e.target.value }; setW({ ...w, blackouts: bl }); }} /></label>
                  <label>Reason<input value={b.reason} onChange={(e) => { const bl = [...w.blackouts]; bl[i] = { ...b, reason: e.target.value }; setW({ ...w, blackouts: bl }); }} placeholder="e.g. Christmas screenings" /></label>
                  <button className="btn tiny ghost danger self-end" onClick={() => setW({ ...w, blackouts: w.blackouts.filter((_, k) => k !== i) })}>Remove</button>
                </div>
              ))}
            </div>
            <div className="form-row"><label>Note<input value={w.note || ""} onChange={(e) => setW({ ...w, note: e.target.value })} placeholder="e.g. agreed with the duty manager, March 2026" /></label></div>
            <div className="control-buttons">
              <button className="btn" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save window"}</button>
              {site.test_window && <button className="btn ghost danger" disabled={busy} onClick={clear}>Remove window</button>}
              <span className="muted small-note">Applies to one-off tests, schedules and the annual plan. Fittings' own routine tests are unaffected.</span>
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}

/* ---------- Plan the year ---------- */
function PlanYear({ sites, onDone }) {
  const toast = useToast();
  const nextMonth = new Date(); nextMonth.setMonth(nextMonth.getMonth() + 1, 1);
  const [f, setF] = useState({ from: nextMonth.toISOString().slice(0, 10), weeks: 12, per_night: 1, site_ids: sites.map((s) => s.site_id) });
  const [plan, setPlan] = useState(null); const [busy, setBusy] = useState(false);
  const preview = async () => { setBusy(true); try { const r = await A.apiPost("/api/plan/annual", { ...f, commit: false }); setPlan(r.plan); } catch (e) { toast(e.message, "alert"); } finally { setBusy(false); } };
  const commit = async () => { setBusy(true); try { const r = await A.apiPost("/api/plan/annual", { ...f, commit: true }); toast(`${r.created} duration tests placed on the agenda.`); onDone(); } catch (e) { toast(e.message, "alert"); } finally { setBusy(false); } };
  const toggleSite = (id) => setF({ ...f, site_ids: f.site_ids.includes(id) ? f.site_ids.filter((x) => x !== id) : [...f.site_ids, id] });
  const noWindow = sites.filter((s) => f.site_ids.includes(s.site_id) && !s.test_window).length;
  return (
    <div className="grid two plan-grid">
      <Panel title="Plan the annual duration tests">
        <div className="explain muted">Spreads one duration test per site across a period — inside each site's testing window, biggest sites first, never more than the chosen number of sites on the same night. Nothing is created until you commit; each test is a normal one-off you can move or cancel.</div>
        <div className="form-row">
          <label>Start<input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
          <label>Over (weeks)<input type="number" min="1" max="52" value={f.weeks} onChange={(e) => setF({ ...f, weeks: Number(e.target.value) })} /></label>
          <label>Sites per night<input type="number" min="1" max="20" value={f.per_night} onChange={(e) => setF({ ...f, per_night: Number(e.target.value) })} /></label>
        </div>
        <div className="eyebrow">Sites <span className="muted">{f.site_ids.length} of {sites.length}</span> <button className="btn tiny ghost" onClick={() => setF({ ...f, site_ids: f.site_ids.length ? [] : sites.map((s) => s.site_id) })}>{f.site_ids.length ? "None" : "All"}</button></div>
        <div className="sitepick compact">{sites.map((s) => <label key={s.site_id} className={`sitepick-row ${f.site_ids.includes(s.site_id) ? "on" : ""}`}><input type="checkbox" checked={f.site_ids.includes(s.site_id)} onChange={() => toggleSite(s.site_id)} /><span className="sitepick-name">{s.name}</span><span className="muted num">{s.luminaires}</span>{!s.test_window && <span className="tag warn">no window</span>}</label>)}</div>
        {noWindow > 0 && <div className="muted small-note">{noWindow} selected site{noWindow > 1 ? "s have" : " has"} no testing window — they'll be placed at any time of day. Set windows first if that matters.</div>}
        <div className="control-buttons"><button className="btn ghost" disabled={busy || !f.site_ids.length} onClick={preview}>{busy ? "Planning…" : "Preview plan"}</button>{plan && <button className="btn" disabled={busy} onClick={commit}>Commit {plan.filter((p) => p.at).length} tests to the agenda</button>}</div>
      </Panel>
      <Panel title="Proposed plan" right={plan && <span className="muted">{plan.filter((p) => p.at).length} placed{plan.some((p) => !p.at) ? ` · ${plan.filter((p) => !p.at).length} could not be` : ""}</span>}>
        {!plan && <div className="empty">Preview to see where each site's duration test lands.</div>}
        {plan && (
          <table className="tbl"><thead><tr><th>When</th><th>Site</th><th className="r">Fittings</th><th></th></tr></thead><tbody>
            {plan.map((p) => <tr key={p.site_id}><td className="nowrap">{p.at ? A.fmtDateTime(p.at) : <span className="alert-text">not placed</span>}</td><td><strong>{p.site_name}</strong></td><td className="r num">{p.luminaires ?? "—"}</td><td className="muted">{p.reason || ""}</td></tr>)}
          </tbody></table>
        )}
      </Panel>
    </div>
  );
}

/** One-off test for a single fitting, reached from the luminaire page. */
export function LuminaireOneOff({ luminaireId }) {
  const lum = useApi(`/api/luminaires/${luminaireId}`);
  const portfolio = useApi("/api/portfolio");
  if (lum.err) return <div className="page"><div className="errorbox">{lum.err}</div></div>;
  if (!lum.data || !portfolio.data) return <PageSkeleton />;
  const l = lum.data.luminaire;
  return (
    <div className="page narrow">
      <div className="page-head"><div><a className="back" href={`#/luminaire/${luminaireId}`}>{l.site_name} · {l.name}</a><h1 className="h1">Schedule a test</h1><div className="sub muted">One fitting — {l.location}.</div></div></div>
      <OneOff sites={portfolio.data.sites} presetSite={l.site_id} presetLuminaire={luminaireId} luminaireName={`${l.name} — ${l.location}`} embedded onDone={() => go(`/luminaire/${luminaireId}`)} />
    </div>
  );
}
