import React from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import { subscribe, dismiss } from './toast';
import { t } from '../i18n';

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
        {this.state.items.map((item) => {
          const Icon = ICONS[item.type] || Info;
          return (
            <div key={item.id} className={'toast toast-' + item.type} role={item.type === 'error' ? 'alert' : 'status'}>
              <Icon className="toast-icon" size={18} aria-hidden="true" />
              <p>{item.message}</p>
              <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={t('toast.dismiss')} onClick={() => dismiss(item.id)}>
                <X size={16} aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    );
  }
}
