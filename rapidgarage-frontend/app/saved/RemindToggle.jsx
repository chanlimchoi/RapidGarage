import React from 'react';
import { Bell, BellRing } from 'lucide-react';
import * as saved from '../lib/saved';
import { saleDays } from '../lib/schedule';
import { t } from '../i18n';

// "Remind me the morning of": a per-sale switch for signed-in visitors.
// Turning it on saves the sale too. Hidden for your own, hidden or past sales.
export default class RemindToggle extends React.Component {
  constructor(props) {
    super(props);
    this.update = () => this.forceUpdate();
  }

  componentDidMount() { this.unsub = saved.subscribe(this.update); }
  componentWillUnmount() { if (this.unsub) this.unsub(); }

  render() {
    const { post, compact } = this.props;
    const user = saved.currentUser();
    if (!user || !post || post.hidden || user.id === post.userId) return null;
    if (!post.schedule || !saleDays(post).some((d) => d.endsAt > Date.now())) return null;
    const on = saved.isReminding(post.id);
    const Icon = on ? BellRing : Bell;
    const label = on ? t('rem.onLabel') : t('rem.offLabel');
    return (
      <button type="button" className={'btn ' + (compact ? 'btn-ghost btn-sm' : 'btn-secondary') + ' remind-btn' + (on ? ' is-on' : '')}
        aria-pressed={on} disabled={saved.isPending(post.id)}
        title={t('rem.hint')}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); saved.setReminder(post, !on); }}>
        <Icon size={compact ? 14 : 16} aria-hidden="true" />{compact ? (on ? t('rem.onShort') : t('rem.offShort')) : label}
        {/* Visible text first, so the accessible name starts with what's shown. */}
        {compact ? <span className="sr-only">: {post.title}</span> : null}
      </button>
    );
  }
}
