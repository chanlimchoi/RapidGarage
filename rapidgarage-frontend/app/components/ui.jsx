import React from 'react';
import { AlertCircle, AlertTriangle, Info, CheckCircle2, Loader2, X } from 'lucide-react';
import { t } from '../i18n';
import { wireControl } from '../lib/wire';

export { wireControl };

// Labeled form field with hint and inline error, wired up for screen readers.
export function Field({ id, label, optional, hint, error, children }) {
  const hintId = hint ? id + '-hint' : undefined;
  const errId = error ? id + '-error' : undefined;
  const describedBy = [errId, hintId].filter(Boolean).join(' ') || undefined;
  const control = React.Children.only(children);
  const props = { id, 'aria-invalid': error ? 'true' : undefined, 'aria-describedby': describedBy };
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}{optional ? <span className="optional"> {t('ui.optional')}</span> : null}
      </label>
      {wireControl(control, props)}
      {error ? <span className="field-error" id={errId}><AlertCircle size={14} aria-hidden="true" />{error}</span> : null}
      {hint ? <span className="field-hint" id={hintId}>{hint}</span> : null}
    </div>
  );
}

const ALERT_ICONS = { danger: AlertCircle, warning: AlertTriangle, info: Info, success: CheckCircle2 };

export function Alert({ tone, children, className, live }) {
  const tn = tone || 'info';
  const Icon = ALERT_ICONS[tn];
  const role = live === false ? undefined : tn === 'danger' ? 'alert' : 'status';
  return (
    <div className={'alert alert-' + tn + (className ? ' ' + className : '')} role={role}>
      <Icon size={18} aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}

// level: heading level of the title (1 when the empty state is the whole page).
export function EmptyState({ icon: Icon, title, children, action, level }) {
  const H = 'h' + (level || 2);
  return (
    <div className="empty no-results">
      {Icon ? <div className="empty-icon"><Icon size={28} aria-hidden="true" /></div> : null}
      <H className="empty-title">{title}</H>
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
    <div className={'card-grid ' + (className || '')} role="status" aria-label={t('ui.loading')}>
      {Array.from({ length: n }).map((_, i) => <SkeletonCard key={i} />)}
      <span className="sr-only">{t('ui.loadingDots')}</span>
    </div>
  );
}

export function SkeletonBlock({ lines, height }) {
  return (
    <div className="stack" role="status" aria-label={t('ui.loading')}>
      {height ? <div className="skeleton" style={{ height }} aria-hidden="true" /> : null}
      {Array.from({ length: lines || 3 }).map((_, i) => (
        <div key={i} className="skeleton skeleton-line" style={{ width: (90 - i * 15) + '%' }} aria-hidden="true" />
      ))}
      <span className="sr-only">{t('ui.loadingDots')}</span>
    </div>
  );
}

// Modal dialog (a bottom sheet on phones): closes on Escape / backdrop click,
// keeps Tab and focus inside, and returns focus to whatever opened it (or to
// props.returnFocus when that element is gone, e.g. a menu item).
const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';
export function focusables(root) {
  if (!root) return [];
  return Array.prototype.filter.call(root.querySelectorAll(FOCUSABLE), (el) => el.getClientRects().length > 0 && !el.closest('[inert]'));
}

function resolve(r) { return typeof r === 'function' ? r() : r && r.current !== undefined ? r.current : r; }

export class Dialog extends React.Component {
  constructor(props) {
    super(props);
    this.ref = React.createRef();
    this.onKey = this.onKey.bind(this);
    this.onFocusIn = this.onFocusIn.bind(this);
  }

  componentDidMount() {
    this.opener = document.activeElement;
    document.addEventListener('keydown', this.onKey);
    document.addEventListener('focusin', this.onFocusIn);
    const el = this.ref.current;
    const first = el && (el.querySelector('[autofocus]') || focusables(el).find((x) => !x.classList.contains('dialog-close')));
    if (first) first.focus(); else if (el) el.focus();
  }

  componentWillUnmount() {
    document.removeEventListener('keydown', this.onKey);
    document.removeEventListener('focusin', this.onFocusIn);
    const back = this.opener && this.opener.isConnected && this.opener !== document.body ? this.opener : resolve(this.props.returnFocus);
    if (back && back.focus) back.focus();
  }

  // Focus that lands outside (e.g. a click on the page behind) comes back in.
  onFocusIn(e) {
    const el = this.ref.current;
    if (el && !el.contains(e.target)) { const f = focusables(el); (f[0] || el).focus(); }
  }

  onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); if (this.props.onClose) this.props.onClose(); return; }
    if (e.key !== 'Tab' || !this.ref.current) return;
    const items = focusables(this.ref.current);
    if (!items.length) { e.preventDefault(); return; }
    const first = items[0];
    const last = items[items.length - 1];
    const inside = this.ref.current.contains(document.activeElement);
    if (e.shiftKey && (document.activeElement === first || !inside)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (document.activeElement === last || !inside)) { e.preventDefault(); first.focus(); }
  }

  render() {
    const { id, title, description, children, footer, onClose } = this.props;
    return (
      <div className="dialog-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && onClose) onClose(); }}>
        <div className="dialog" role="dialog" aria-modal="true" tabIndex="-1" aria-labelledby={id + '-title'} aria-describedby={description ? id + '-desc' : undefined} ref={this.ref}>
          <header className="dialog-header">
            <h2 id={id + '-title'}>{title}</h2>
            <button type="button" className="btn btn-ghost btn-icon btn-sm dialog-close" aria-label={t('ui.close')} onClick={onClose}><X size={18} aria-hidden="true" /></button>
          </header>
          {description ? <p id={id + '-desc'} className="dialog-desc">{description}</p> : null}
          <div className="dialog-body">{children}</div>
          {footer ? <footer className="dialog-footer">{footer}</footer> : null}
        </div>
      </div>
    );
  }
}
