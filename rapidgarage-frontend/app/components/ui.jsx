import React from 'react';
import { AlertCircle, AlertTriangle, Info, CheckCircle2, Loader2 } from 'lucide-react';

// Labeled form field with hint and inline error, wired up for screen readers.
export function Field({ id, label, optional, hint, error, children }) {
  const hintId = hint ? id + '-hint' : undefined;
  const errId = error ? id + '-error' : undefined;
  const describedBy = [errId, hintId].filter(Boolean).join(' ') || undefined;
  const control = React.Children.only(children);
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}{optional ? <span className="optional"> (optional)</span> : null}
      </label>
      {React.cloneElement(control, { id, 'aria-invalid': error ? 'true' : undefined, 'aria-describedby': describedBy })}
      {error ? <span className="field-error" id={errId}><AlertCircle size={14} aria-hidden="true" />{error}</span> : null}
      {hint ? <span className="field-hint" id={hintId}>{hint}</span> : null}
    </div>
  );
}

const ALERT_ICONS = { danger: AlertCircle, warning: AlertTriangle, info: Info, success: CheckCircle2 };

export function Alert({ tone, children, className, live }) {
  const t = tone || 'info';
  const Icon = ALERT_ICONS[t];
  const role = live === false ? undefined : t === 'danger' ? 'alert' : 'status';
  return (
    <div className={'alert alert-' + t + (className ? ' ' + className : '')} role={role}>
      <Icon size={18} aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children, action }) {
  return (
    <div className="empty no-results">
      {Icon ? <div className="empty-icon"><Icon size={28} aria-hidden="true" /></div> : null}
      <h3>{title}</h3>
      {children ? <p>{children}</p> : null}
      {action || null}
    </div>
  );
}

export function Spinner({ size }) {
  return <Loader2 className="spin" size={size || 16} aria-hidden="true" />;
}

export function SkeletonCard() {
  return (
    <div className="skeleton-card" aria-hidden="true">
      <div className="skeleton skeleton-media" />
      <div className="skeleton-body">
        <div className="skeleton skeleton-line" style={{ width: '75%', height: 16 }} />
        <div className="skeleton skeleton-line" style={{ width: '50%' }} />
        <div className="skeleton skeleton-line" style={{ width: '35%', height: 22, borderRadius: 999 }} />
      </div>
    </div>
  );
}

export function SkeletonGrid({ count, className }) {
  const n = count || 4;
  return (
    <div className={'card-grid ' + (className || '')} role="status" aria-label="Loading">
      {Array.from({ length: n }).map((_, i) => <SkeletonCard key={i} />)}
      <span className="sr-only">Loading…</span>
    </div>
  );
}

export function SkeletonBlock({ lines, height }) {
  return (
    <div className="stack" role="status" aria-label="Loading">
      {height ? <div className="skeleton" style={{ height }} aria-hidden="true" /> : null}
      {Array.from({ length: lines || 3 }).map((_, i) => (
        <div key={i} className="skeleton skeleton-line" style={{ width: (90 - i * 15) + '%' }} aria-hidden="true" />
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}
