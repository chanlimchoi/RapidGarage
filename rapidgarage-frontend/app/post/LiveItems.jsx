import React from 'react';
import { Radio } from 'lucide-react';
import { apiFetch } from '../api';
import * as liveClient from '../lib/liveClient';
import { mergeStatus, pollDelay, leftCount } from '../lib/whatsLeft';
import { timeAgo } from '../lib/format';
import { t } from '../i18n';

// Keeps the sale page's item list current while the sale is on: polls the
// small status snapshot (GET /post/:id/items/status, ETag-cached) at the
// server's suggested pace, refreshes at once on a live 'items' nudge (for
// people who saved the sale), and shows "N left · updated 3 min ago".
// props: post, onItems(items), onStamp(updatedAt)
export default class LiveItems extends React.Component {
  constructor(props) {
    super(props);
    this.state = { updatedAt: props.post.itemsUpdatedAt || null, live: false, tick: 0 };
    this.poll = this.poll.bind(this);
    this.onVisible = this.onVisible.bind(this);
  }

  componentDidMount() {
    this.mounted = true;
    this.off = liveClient.on((type, data) => { if (type === 'items' && data && data.postId === this.props.post.id) this.poll(); });
    document.addEventListener('visibilitychange', this.onVisible);
    this.ticker = setInterval(() => this.mounted && this.setState({ tick: this.state.tick + 1 }), 30000);
    this.poll();
  }

  componentWillUnmount() {
    this.mounted = false;
    clearTimeout(this.timer);
    clearInterval(this.ticker);
    if (this.off) this.off();
    document.removeEventListener('visibilitychange', this.onVisible);
  }

  onVisible() { if (document.visibilityState === 'visible') this.poll(); }

  schedule(status) {
    clearTimeout(this.timer);
    const ms = pollDelay(status, { liveOpen: liveClient.isOpen(), hidden: document.visibilityState === 'hidden' });
    if (ms) this.timer = setTimeout(this.poll, ms);
  }

  poll() {
    const post = this.props.post;
    clearTimeout(this.timer);
    return apiFetch('/post/' + post.id + '/items/status').then(({ ok, data }) => {
      if (!this.mounted || !ok || !data) return;
      this.setState({ updatedAt: data.updatedAt, live: data.pollSeconds > 0 });
      if (data.updatedAt !== this.props.post.itemsUpdatedAt && this.props.onStamp) this.props.onStamp(data.updatedAt);
      const m = mergeStatus(this.props.post.items, data);
      if (m.reload) {
        apiFetch('/post/' + post.id + '/items').then((r) => { if (this.mounted && r.ok) this.props.onItems(r.data.items); }).catch(() => null);
      } else if (m.changed) this.props.onItems(m.items);
      this.schedule(data);
    }).catch(() => { if (this.mounted) this.schedule({ pollSeconds: 60 }); });
  }

  render() {
    const items = this.props.post.items || [];
    if (!items.length) return null;
    const c = leftCount(items);
    const at = this.state.updatedAt;
    return (
      <p className="live-items small" aria-live="polite">
        {this.state.live ? <span className="live-dot" title={t('left.liveTitle')}><Radio size={14} aria-hidden="true" /><span>{t('left.live')}</span></span> : null}
        <span>{t('left.count', { count: c.left, total: c.total })}</span>
        {at ? <span className="muted"> · {t('left.updated', { when: timeAgo(at) })}</span> : null}
      </p>
    );
  }
}
