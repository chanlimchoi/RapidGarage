import React from 'react';
import { Link } from 'react-router-dom';
import { BellOff, AlertCircle } from 'lucide-react';
import { unsubscribeAlert, errorMessage } from '../api';
import { EmptyState, SkeletonBlock } from '../components/ui';

// Landing page for the email's "Turn off this alert" link. It POSTs from the
// browser, so link scanners that only GET the URL never unsubscribe anyone.
export default class Unsubscribe extends React.Component {
  constructor(props) {
    super(props);
    this.state = { status: 'working', alert: null, error: '' };
  }

  componentDidMount() {
    const q = new URLSearchParams(this.props.location.search);
    const a = q.get('a');
    const t = q.get('t');
    if (!a || !t) return this.setState({ status: 'error', error: 'This unsubscribe link is incomplete.' });
    unsubscribeAlert(a, t).then(({ ok, data }) => {
      if (!ok) return this.setState({ status: 'error', error: errorMessage(data, 'This unsubscribe link is invalid.') });
      this.setState({ status: data.gone ? 'gone' : 'done', alert: data.alert || null });
    }).catch(() => this.setState({ status: 'error', error: 'Unable to reach the server. Please try the link again.' }));
  }

  render() {
    const s = this.state;
    const manage = <Link className="btn btn-primary" to="/settings#alerts">Manage alerts</Link>;
    let body;
    if (s.status === 'working') body = <SkeletonBlock lines={2} />;
    else if (s.status === 'error') body = <EmptyState icon={AlertCircle} title="We couldn't turn off this alert" action={manage}>{s.error} You can also log in and manage your alerts in Settings.</EmptyState>;
    else if (s.status === 'gone') body = <EmptyState icon={BellOff} title="This alert no longer exists" action={manage}>It was already deleted, so you won't get more emails from it.</EmptyState>;
    else {
      const name = s.alert && s.alert.label ? '“' + s.alert.label + '”' : 'this alert';
      body = <EmptyState icon={BellOff} title="Alert turned off" action={manage}>You won't get more emails for {name}. Your other alerts are unchanged, and you can turn it back on any time.</EmptyState>;
    }
    return <div className="container container-narrow rg-unsubscribe" aria-live="polite">{body}</div>;
  }
}
