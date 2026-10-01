/* ui.jsx — primitives shared across views. */
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

export const Eyebrow = ({ children }) => <div className="eyebrow">{children}</div>;

export const Panel = ({ title, right, children, className = "" }) => (
  <section className={`panel ${className}`}>
    {(title || right) && (
      <div className="panel-head">
        {title && <Eyebrow>{title}</Eyebrow>}
        {right && <div className="panel-right">{right}</div>}
      </div>
    )}
    {children}
  </section>
);

export const Led = ({ status }) => <span className={`led ${status}`} aria-label={status} />;

/** Skeleton block for loading states. */
export const Skeleton = ({ lines = 3, height = 14 }) => (
  <div className="skeleton" aria-hidden="true">
    {Array.from({ length: lines }, (_, i) => <div key={i} className="skel-line" style={{ height, width: `${90 - (i % 3) * 18}%` }} />)}
  </div>
);

export const PageSkeleton = () => (
  <div className="page">
    <div className="page-head"><div><div className="skel-line" style={{ width: 240, height: 28 }} /><div className="skel-line" style={{ width: 360, height: 12, marginTop: 10 }} /></div></div>
    <Panel><Skeleton lines={5} /></Panel>
    <Panel><Skeleton lines={8} /></Panel>
  </div>
);

/** Status filter chips: options = [{ id, label, count? }]. */
export const Chips = ({ options, value, onChange }) => (
  <div className="chips" role="tablist">
    {options.map((o) => (
      <button key={o.id} role="tab" aria-selected={value === o.id} className={`chip-btn ${value === o.id ? "on" : ""} ${o.tone || ""}`} onClick={() => onChange(o.id)}>
        {o.label}{o.count != null && <span className="chip-count num">{o.count}</span>}
      </button>
    ))}
  </div>
);

export const SearchBox = ({ value, onChange, placeholder = "Search", autoFocusKey }) => {
  const ref = React.useRef(null);
  useEffect(() => {
    if (!autoFocusKey) return;
    const onKey = (e) => { if (e.key === autoFocusKey && !/input|textarea|select/i.test(document.activeElement?.tagName || "")) { e.preventDefault(); ref.current?.focus(); } };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [autoFocusKey]);
  return (
    <label className="search">
      <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M13 13l4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
      <input ref={ref} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
      {value ? <button className="search-clear" onClick={() => onChange("")} aria-label="Clear">×</button> : autoFocusKey ? <kbd>{autoFocusKey}</kbd> : null}
    </label>
  );
};

/* ---------- toasts ---------- */
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((text, tone = "ok") => {
    const id = Math.random().toString(36).slice(2);
    setItems((t) => [...t, { id, text, tone }]);
    setTimeout(() => setItems((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">{items.map((t) => <div key={t.id} className={`toast ${t.tone}`}>{t.text}</div>)}</div>
    </ToastCtx.Provider>
  );
}

/** Floating hover card anchored to the pointer. */
export function HoverCard({ card }) {
  if (!card) return null;
  const { x, y, title, lines, status } = card;
  const left = Math.min(x + 14, window.innerWidth - 300), top = Math.min(y + 14, window.innerHeight - 160);
  return (
    <div className="hovercard" style={{ left, top }} role="tooltip">
      <div className="hovercard-title"><Led status={status} />{title}</div>
      {lines.map((l, i) => <div key={i} className="hovercard-line">{l}</div>)}
    </div>
  );
}
