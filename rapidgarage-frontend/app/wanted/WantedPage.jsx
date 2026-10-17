import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, MapPin, Tag, UserRound, Pencil, Trash2, Flag, MessageCircle, RefreshCw, CircleCheck, Clock, LogIn, SearchX, Sparkles, Store, ShieldCheck, EyeOff } from 'lucide-react';
import { errorMessage, fetchWanted, renewWanted, fulfillWanted, deleteWanted, contactWanted } from '../api';
import { formatCents } from '../lib/items';
import { formatMiles, timeAgo } from '../lib/format';
import { DAYS_DEFAULT } from '../lib/wanted';
import { Alert, EmptyState, SkeletonBlock, Spinner } from '../components/ui';
import toast from '../components/toast';
import ReportWantedDialog from './ReportWantedDialog';
import { STATUS_CHIP, statusLabel, categoryLabel, expiryText } from './WantedCard';
import { t } from '../i18n';

// /wanted/:id: what a buyer is looking for. Sellers message them; the owner
// sees the sales that matched and can edit, renew, mark found or delete.
export default class WantedPage extends React.Component {
  constructor(props) {
    super(props);
    this.state = { wanted: null, error: '', busy: null, reportOpen: false };
  }

  componentDidMount() { this.mounted = true; this.load(); }
  componentWillUnmount() { this.mounted = false; }
  componentDidUpdate(prev) {
    if (prev.match.params.id !== this.props.match.params.id || (prev.user || {}).id !== (this.props.user || {}).id) this.load();
  }

  load() {
    fetchWanted(this.props.match.params.id).then(({ ok, data }) => {
      if (!this.mounted) return;
      this.setState(ok ? { wanted: data, error: '' } : { wanted: null, error: errorMessage(data, t('want.notFound')) });
      // Opening my own post marks its matches seen; refresh the nav badge.
      if (ok && data.mine && this.props.onSeen) this.props.onSeen();
    }).catch(() => this.mounted && this.setState({ error: t('common.network') }));
  }

  act(name, call, done) {
    this.setState({ busy: name });
    call().then(({ ok, data }) => {
      if (!this.mounted) return;
      this.setState({ busy: null });
      if (!ok) { toast.error(errorMessage(data, t('want.actionFailed'))); return; }
      done(data);
    }).catch(() => { if (this.mounted) this.setState({ busy: null }); toast.error(t('common.network')); });
  }

  contact() {
    const w = this.state.wanted;
    if (!this.props.user) { toast.info(t('want.loginToMessage')); this.props.history.push('/login'); return; }
    this.act('contact', () => contactWanted(w.id), (data) => this.props.history.push('/messages/' + data.id));
  }
  renew() { this.act('renew', () => renewWanted(this.state.wanted.id, DAYS_DEFAULT), (data) => { toast.success(t('want.renewed', { count: DAYS_DEFAULT })); this.setState({ wanted: data }); }); }
  fulfill() {
    if (!window.confirm(t('want.confirmFulfill'))) return;
    this.act('fulfill', () => fulfillWanted(this.state.wanted.id), (data) => { toast.success(t('want.fulfilled')); this.setState({ wanted: data }); });
  }
  remove() {
    const w = this.state.wanted;
    if (!window.confirm(t('want.confirmDelete', { title: w.title }))) return;
    this.act('delete', () => deleteWanted(w.id), () => { toast.success(t('want.deleted')); this.props.history.push('/wanted'); });
  }
  openReport() {
    if (!this.props.user) { toast.info(t('want.loginToReport')); this.props.history.push('/login'); return; }
    this.setState({ reportOpen: true });
  }

  renderMatches(w) {
    const matches = w.matches || [];
    return (
      <section className="panel stack" aria-labelledby="wanted-matches">
        <h2 id="wanted-matches" className="h4"><Sparkles size={18} aria-hidden="true" />{t('want.matchesTitle')}</h2>
        {matches.length ? (
          <ul className="wanted-matches">
            {matches.map((m) => (
              <li key={m.id} className="wanted-match" data-match-id={m.id}>
                {m.post.thumbUrl ? <img src={m.post.thumbUrl} alt="" className="wanted-match-thumb" loading="lazy" /> : <span className="wanted-match-thumb wanted-match-thumb-empty" aria-hidden="true"><Store size={20} /></span>}
                <div className="wanted-match-body">
                  <Link to={'/post/' + m.post.id} className="wanted-match-title">{m.post.title}</Link>
                  <span className="small muted">{[m.post.city, formatMiles(m.distanceMiles), t('want.by', { name: m.post.seller.name }), timeAgo(m.matchedAt)].filter(Boolean).join(' · ')}</span>
                  {m.item ? <span className="small">{t('want.matchItem', { name: m.item.name, price: m.item.priceCents === null ? t('want.noPrice') : formatCents(m.item.priceCents) })}</span> : null}
                </div>
                {m.isNew ? <span className="chip chip-brand">{t('want.new')}</span> : null}
              </li>
            ))}
          </ul>
        ) : <p className="muted small">{t('want.noMatches')}</p>}
      </section>
    );
  }

  render() {
    const { wanted: w, error, busy } = this.state;
    const user = this.props.user;
    if (error) {
      return <div className="container container-narrow"><EmptyState icon={SearchX} title={t('want.notFound')} action={<Link className="btn btn-secondary" to="/wanted">{t('want.board')}</Link>}>{error}</EmptyState></div>;
    }
    if (!w) return <div className="container container-narrow"><SkeletonBlock lines={6} /></div>;
    const admin = !!(user && user.role === 'admin');
    const open = w.status === 'active' && !w.hidden;
    return (
      <div className="container container-narrow wanted-page">
        <Link to="/wanted" className="back-link"><ArrowLeft size={16} aria-hidden="true" />{t('want.board')}</Link>
        <article className="panel stack">
          <header className="stack-sm">
            <span className="event-kicker">{t('want.kicker')}</span>
            <h1 className="wanted-title">{w.title}</h1>
            <div className="chips">
              <span className={'chip ' + (STATUS_CHIP[w.status] || '')}><Clock size={12} aria-hidden="true" />{w.status === 'active' ? expiryText(w) : statusLabel(w.status)}</span>
              {w.maxPriceCents !== null ? <span className="chip chip-brand"><Tag size={12} aria-hidden="true" />{w.maxPriceCents === 0 ? t('want.freeOnly') : t('want.upTo', { price: formatCents(w.maxPriceCents) })}</span> : null}
              {w.category ? <span className="chip">{categoryLabel(w.category)}</span> : null}
              {w.hidden ? <span className="chip chip-warning"><EyeOff size={12} aria-hidden="true" />{t('card.hidden')}</span> : null}
            </div>
          </header>
          {w.hidden && (w.mine || admin) ? <Alert tone="warning" live={false}>{w.mine ? t('want.hiddenOwner') : t('want.hiddenAdmin')}</Alert> : null}
          <dl className="wanted-facts">
            <div><dt><MapPin size={16} aria-hidden="true" />{t('want.area')}</dt><dd>{t('want.within', { miles: w.radiusMiles, area: w.areaLabel })}</dd></div>
            <div><dt><UserRound size={16} aria-hidden="true" />{t('want.postedBy')}</dt><dd>{w.mine ? t('want.you') : w.poster.name} · {timeAgo(w.createdAt)}</dd></div>
            {w.matchWords.length ? <div><dt><Sparkles size={16} aria-hidden="true" />{t('want.matchOn')}</dt><dd className="chips">{w.matchWords.map((x) => <span key={x} className="chip">{x}</span>)}</dd></div> : null}
          </dl>
          {w.details ? <p className="wanted-details">{w.details}</p> : null}

          {w.mine ? (
            <div className="row wanted-owner-actions">
              <Link className="btn btn-secondary btn-sm" to={'/wanted/' + w.id + '/edit'}><Pencil size={14} aria-hidden="true" />{t('common.edit')}</Link>
              {w.status !== 'fulfilled' ? <button type="button" className="btn btn-secondary btn-sm" onClick={() => this.renew()} disabled={!!busy}>{busy === 'renew' ? <Spinner /> : <RefreshCw size={14} aria-hidden="true" />}{t('want.renew')}</button> : null}
              {w.status !== 'fulfilled' ? <button type="button" className="btn btn-secondary btn-sm" onClick={() => this.fulfill()} disabled={!!busy}>{busy === 'fulfill' ? <Spinner /> : <CircleCheck size={14} aria-hidden="true" />}{t('want.markFound')}</button> : null}
              <button type="button" className="btn btn-danger btn-sm" onClick={() => this.remove()} disabled={!!busy}>{busy === 'delete' ? <Spinner /> : <Trash2 size={14} aria-hidden="true" />}{t('common.delete')}</button>
            </div>
          ) : (
            <div className="stack-sm">
              {w.blocked ? <Alert tone="info" live={false}>{t('want.blocked')}</Alert> : null}
              {!open && !w.blocked ? <Alert tone="info" live={false}>{t('want.closedNote')}</Alert> : null}
              <div className="row">
                {w.conversationId ? (
                  <Link className="btn btn-primary" to={'/messages/' + w.conversationId}><MessageCircle size={16} aria-hidden="true" />{t('want.openConversation')}</Link>
                ) : w.canContact || (!user && open) ? (
                  <button type="button" className="btn btn-primary" onClick={() => this.contact()} disabled={!!busy}>
                    {busy === 'contact' ? <Spinner /> : user ? <MessageCircle size={16} aria-hidden="true" /> : <LogIn size={16} aria-hidden="true" />}{t('want.message', { name: w.poster.name })}
                  </button>
                ) : null}
                {admin ? <button type="button" className="btn btn-danger btn-sm" onClick={() => this.remove()} disabled={!!busy}><ShieldCheck size={14} aria-hidden="true" />{t('want.adminDelete')}</button> : null}
                {w.reportedByMe ? <span className="small muted">{t('want.reportedAlready')}</span> : (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => this.openReport()}><Flag size={14} aria-hidden="true" />{t('want.report')}</button>
                )}
              </div>
              {open && (w.canContact || !user) ? <p className="field-hint">{t('want.sellerHint')}</p> : null}
            </div>
          )}
        </article>
        {w.mine ? this.renderMatches(w) : null}
        {this.state.reportOpen ? <ReportWantedDialog wanted={w} onDone={(sent) => this.setState({ reportOpen: false }, () => sent && this.load())} /> : null}
      </div>
    );
  }
}
