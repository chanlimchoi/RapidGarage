import React from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import { subscribe, dismiss } from './toast';

const ICONS = { success: CheckCircle2, error: AlertCircle, info: Info };

export default class Toaster extends React.Component {
  constructor(props) {
    super(props);
    this.state = { items: [] };
  }

  componentDidMount() { this.unsub = subscribe((items) => this.setState({ items })); }
  componentWillUnmount() { if (this.unsub) this.unsub(); }

  render() {
    return (
      <div className="toaster" aria-live="polite" aria-relevant="additions">
        {this.state.items.map((t) => {
          const Icon = ICONS[t.type] || Info;
          return (
            <div key={t.id} className={'toast toast-' + t.type} role={t.type === 'error' ? 'alert' : 'status'}>
              <Icon className="toast-icon" size={18} aria-hidden="true" />
              <p>{t.message}</p>
              <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Dismiss notification" onClick={() => dismiss(t.id)}>
                <X size={16} aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    );
  }
}
