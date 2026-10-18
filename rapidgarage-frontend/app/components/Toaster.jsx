import React from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import { subscribe, dismiss, pause, resume } from './toast';
import { t } from '../i18n';

const ICONS = { success: CheckCircle2, error: AlertCircle, info: Info };

// Visible toasts plus two live regions that are always on the page (screen
// readers only announce changes to regions that already exist): errors are
// announced right away, everything else politely.
export default class Toaster extends React.Component {
  constructor(props) {
    super(props);
    this.state = { items: [], polite: '', assertive: '' };
    this.seen = new Set();
  }

  componentDidMount() {
    this.unsub = subscribe((items) => {
      const fresh = items.filter((i) => !this.seen.has(i.id));
      fresh.forEach((i) => this.seen.add(i.id));
      const next = { items };
      const err = fresh.filter((i) => i.type === 'error').pop();
      const info = fresh.filter((i) => i.type !== 'error').pop();
      // A trailing no-break space toggles so the same text is announced again.
      if (err) next.assertive = err.message + (this.state.assertive.endsWith('\u00a0') ? '' : '\u00a0');
      if (info) next.polite = info.message + (this.state.polite.endsWith('\u00a0') ? '' : '\u00a0');
      this.setState(next);
      if (!items.length) resume();
    });
  }

  componentWillUnmount() { if (this.unsub) this.unsub(); }

  // Closing with the keyboard: focus the next toast's button, or the page.
  close(id, button) {
    const all = Array.prototype.slice.call(document.querySelectorAll('.toaster .toast .btn'));
    const i = all.indexOf(button);
    const next = all[i + 1] || all[i - 1];
    dismiss(id);
    if (button === document.activeElement) {
      if (next && next.isConnected) next.focus();
      else { const main = document.getElementById('main'); if (main) main.focus(); }
    }
  }

  render() {
    return (
      <React.Fragment>
        <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{this.state.polite}</div>
        <div className="sr-only" role="alert" aria-live="assertive" aria-atomic="true">{this.state.assertive}</div>
        <section className="toaster" aria-label={t('toast.region')} hidden={!this.state.items.length}
          onMouseEnter={pause} onMouseLeave={resume} onFocus={pause}
          onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) resume(); }}>
          {this.state.items.map((item) => {
            const Icon = ICONS[item.type] || Info;
            return (
              <div key={item.id} className={'toast toast-' + item.type}>
                <Icon className="toast-icon" size={18} aria-hidden="true" />
                <p>{item.message}</p>
                <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={t('toast.dismiss')} onClick={(e) => this.close(item.id, e.currentTarget)}>
                  <X size={16} aria-hidden="true" />
                </button>
              </div>
            );
          })}
        </section>
      </React.Fragment>
    );
  }
}
