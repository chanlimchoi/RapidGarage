import React from 'react';
import { Link } from 'react-router-dom';
import { MessageCircle, ArrowLeft, Send, Ban, ImageOff, LogIn, Inbox, AlertTriangle, Flag, MoreHorizontal, ShieldOff, Bookmark, MapPin, ExternalLink } from 'lucide-react';
import {
  errorMessage, fetchConversations, fetchConversation, fetchMessagesAfter, fetchMessagesBefore,
  sendMessage, setBlocked, MESSAGE_MAX, reportConversation, CONVERSATION_REPORT_REASONS, REPORT_NOTE_MAX, meetupAction,
} from '../api';
import { Alert, EmptyState, SkeletonBlock, Spinner, Dialog, Field } from '../components/ui';
import { timeAgo } from '../lib/format';
import toast from '../components/toast';
import linkify from './linkify';
import RatePanel from '../ratings/RatePanel';
import { RatingBadge } from '../ratings/Stars';
import HoldPanel from './HoldPanel';
import { holdEventText } from './holdText';
import SafetyTips, { SafetyLink } from './SafetyTips';
import MeetupDialog from './MeetupDialog';
import MeetupCard from './MeetupCard';
import { meetupEventText, meetTime, upcomingAgreed, syncMeetups } from './meetupText';
import { checkMessage, showTips, hideTips } from '../lib/safety';
import { t, intlLocale } from '../i18n';
import * as liveClient from '../lib/liveClient';

const POLL_MS = 10000;

function clock(value) {
  const d = new Date(value);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString(intlLocale(), { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleString(intlLocale(), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function initialsOf(name) {
  return String(name || '?').split(/\s+/).map((w) => w.charAt(0)).join('').slice(0, 2).toUpperCase();
}

// Names are "First L.", so "You blocked {name}. ..." can end up with "B.."; collapse it.
const tidy = (s) => s.replace(/\.\./g, '.');
// A conversation is about a sale, or about a buyer's wanted post.
const subjectPath = (post) => (post.wanted ? '/wanted/' : '/post/') + post.id;

function postLabel(post) {
  if (post.status === 'deleted') return t('msg.postDeleted');
  if (post.status === 'hidden') return post.canView ? t('msg.hidden') : t('msg.unavailable');
  if (post.status === 'closed') return t('msg.wantedClosed');
  return null;
}

// /messages (inbox) and /messages/:id (thread). On small screens the list and
// the thread are separate screens; on wide screens they sit side by side.
export default class Messages extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      list: null, listError: '',
      conv: null, messages: [], hasMore: false, threadError: '', loadingThread: false, loadingOlder: false,
      draft: '', sending: false, sendError: '',
      menuOpen: false, reportOpen: false, reason: '', note: '', alsoBlock: false, reportError: '', reporting: false,
      nudge: null, nudgeOk: false, meetDialog: null, meetBusy: null, tipsTick: 0,
    };
    this.menuRef = React.createRef();
    this.onDocClick = this.onDocClick.bind(this);
    this.logRef = React.createRef();
    this.inputRef = React.createRef();
    this.poll = this.poll.bind(this);
  }

  componentDidMount() {
    if (this.props.user) this.init();
    // Live events fetch at once; polling is the fallback (every 10 s without a
    // live connection, every 60 s with one).
    this.ticks = 0;
    this.timer = setInterval(() => { if (!document.hidden && (!liveClient.isOpen() || ++this.ticks % 6 === 0)) this.poll(); }, POLL_MS);
    this.offLive = liveClient.on((type) => { if (type === 'message' && !document.hidden) this.poll(); });
    document.addEventListener('mousedown', this.onDocClick);
  }

  onDocClick(e) {
    if (this.state.menuOpen && this.menuRef.current && !this.menuRef.current.contains(e.target)) this.setState({ menuOpen: false });
  }

  // Menu keys: arrows / Home / End move, Escape closes and returns focus to
  // the button, Tab closes and moves on.
  onMenuKey(e) {
    const trigger = this.menuRef.current && this.menuRef.current.querySelector('button[aria-haspopup]');
    if (e.key === 'Escape') { e.stopPropagation(); this.setState({ menuOpen: false }); if (trigger) trigger.focus(); return; }
    if (e.key === 'Tab') { this.setState({ menuOpen: false }); return; }
    const items = Array.prototype.slice.call(this.menuRef.current.querySelectorAll('[role="menuitem"]:not(:disabled)'));
    if (!items.length) return;
    const i = items.indexOf(document.activeElement);
    let next = null;
    if (e.key === 'ArrowDown') next = (i + 1) % items.length;
    else if (e.key === 'ArrowUp') next = (i - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    if (next === null) return;
    e.preventDefault();
    items[next].focus();
  }

  toggleMenu() {
    this.setState({ menuOpen: !this.state.menuOpen }, () => {
      const first = this.state.menuOpen && this.menuRef.current && this.menuRef.current.querySelector('[role="menuitem"]:not(:disabled)');
      if (first) first.focus();
    });
  }

  openReport() {
    // The menu item goes away with the menu: focus its button, so the dialog
    // hands focus back there when it closes.
    const trigger = this.menuRef.current && this.menuRef.current.querySelector('button[aria-haspopup]');
    if (trigger) trigger.focus();
    this.setState({ menuOpen: false, reportOpen: true, reason: '', note: '', alsoBlock: false, reportError: '' });
  }

  submitReport(e) {
    e.preventDefault();
    const { conv, reason, note, alsoBlock } = this.state;
    if (!reason) { this.setState({ reportError: t('report.chooseReason') }); return; }
    if (note.length > REPORT_NOTE_MAX) { this.setState({ reportError: t('report.noteLong', { max: REPORT_NOTE_MAX }) }); return; }
    this.setState({ reporting: true, reportError: '' });
    reportConversation(conv.id, reason, note.trim(), alsoBlock)
      .then(({ ok, status, data }) => {
        if (this.unmounted) return;
        if (ok || status === 409) {
          const patch = { reporting: false, reportOpen: false, conv: Object.assign({}, this.state.conv, { reportedByMe: true }) };
          if (ok && data.blocked) Object.assign(patch.conv, { blocked: data.blocked, canSend: false });
          this.setState(patch);
          if (ok) toast.success(t('msg.reportThanks') + (alsoBlock ? tidy(t('msg.alsoBlocked', { name: conv.other ? conv.other.name : t('msg.they') })) : ''));
          else toast.info(t('msg.reportedAlready'));
          return;
        }
        if (status === 429) { this.setState({ reporting: false, reportOpen: false }); toast.error(t('report.tooMany')); return; }
        this.setState({ reporting: false, reportError: errorMessage(data, t('report.sendFailed')) });
      })
      .catch(() => { if (!this.unmounted) this.setState({ reporting: false, reportError: t('common.network') }); });
  }

  renderReportDialog() {
    const { conv, reason, note, alsoBlock, reportError, reporting } = this.state;
    const name = conv.other ? conv.other.name : t('msg.thisPerson');
    const left = REPORT_NOTE_MAX - note.length;
    return (
      <Dialog id="convreport-dialog" title={t('msg.reportTitle')} onClose={() => !reporting && this.setState({ reportOpen: false })}
        description={t('msg.reportDesc', { name })}>
        <form onSubmit={(e) => this.submitReport(e)} noValidate>
          <fieldset className="field report-reasons">
            <legend className="field-label">{t('msg.whatsWrong')}</legend>
            {CONVERSATION_REPORT_REASONS.map((r) => (
              <label key={r.value} className="radio-row">
                <input type="radio" name="convreport-reason" value={r.value} checked={reason === r.value}
                  onChange={() => this.setState({ reason: r.value, reportError: '' })} />
                <span>{r.label}</span>
              </label>
            ))}
          </fieldset>
          <Field id="convreport-note" label={t('report.details')} optional hint={left >= 0 ? t('common.charsLeft', { count: left }) : t('common.tooLongBy', { n: -left })}>
            <textarea className="textarea" rows={3} maxLength={REPORT_NOTE_MAX} value={note} onChange={(e) => this.setState({ note: e.target.value })}
              placeholder={t('msg.notePlaceholder')} />
          </Field>
          {!(conv.blocked && conv.blocked.byMe) ? (
            <label className="checkbox-row" htmlFor="convreport-block">
              <input id="convreport-block" type="checkbox" checked={alsoBlock} onChange={(e) => this.setState({ alsoBlock: e.target.checked })} />
              <span><strong>{t('msg.alsoBlock', { name })}</strong><span className="field-hint" style={{ display: 'block' }}>{t('msg.blockHint')}</span></span>
            </label>
          ) : null}
          {reportError ? <Alert tone="danger">{reportError}</Alert> : null}
          <div className="dialog-footer">
            <button type="button" className="btn btn-ghost" disabled={reporting} onClick={() => this.setState({ reportOpen: false })}>{t('common.cancel')}</button>
            <button type="submit" className="btn btn-danger" disabled={reporting}>{reporting ? <Spinner /> : <Flag size={16} aria-hidden="true" />}{t('report.send')}</button>
          </div>
        </form>
      </Dialog>
    );
  }

  componentWillUnmount() {
    clearInterval(this.timer);
    if (this.offLive) this.offLive();
    document.removeEventListener('mousedown', this.onDocClick);
    this.unmounted = true;
  }

  componentDidUpdate(prev) {
    if (!prev.user && this.props.user) this.init();
    if (prev.match.params.id !== this.props.match.params.id && this.props.user) {
      this.setState({ draft: '', sendError: '', nudge: null, nudgeOk: false, meetDialog: null });
      this.loadThread();
    }
  }

  init() {
    this.loadList();
    this.loadThread();
  }

  currentId() {
    const id = this.props.match.params.id;
    return /^[1-9]\d*$/.test(id || '') ? Number(id) : null;
  }

  loadList() {
    return fetchConversations()
      .then(({ ok, data }) => {
        if (this.unmounted) return;
        if (!ok) { this.setState({ listError: errorMessage(data, t('msg.loadFailed')) }); return; }
        const patch = { list: data.results, listError: '' };
        // Keep the open thread's block / post state in sync with the list.
        const open = this.state.conv && data.results.filter((c) => c.id === this.state.conv.id)[0];
        if (open) patch.conv = Object.assign({}, this.state.conv, { blocked: open.blocked, post: open.post, canSend: !open.blocked.byMe && !open.blocked.byThem && !this.state.conv.messagingBanned });
        this.setState(patch);
      })
      .catch(() => { if (!this.unmounted) this.setState({ listError: t('common.networkShort') }); });
  }

  loadThread() {
    const id = this.currentId();
    if (!this.props.match.params.id) { this.setState({ conv: null, messages: [], threadError: '' }); return; }
    if (!id) { this.setState({ conv: null, threadError: t('msg.notFound') }); return; }
    this.setState({ loadingThread: true, threadError: '', conv: null, messages: [] });
    fetchConversation(id)
      .then(({ ok, data }) => {
        if (this.unmounted || this.currentId() !== id) return;
        if (!ok) { this.setState({ loadingThread: false, threadError: errorMessage(data, t('msg.notFound')) }); return; }
        this.setState({ loadingThread: false, conv: data.conversation, messages: syncMeetups(data.messages), hasMore: data.hasMore }, () => {
          this.scrollToEnd();
          this.markListRead(id);
          if (this.inputRef.current && window.matchMedia && window.matchMedia('(min-width: 900px)').matches) this.inputRef.current.focus();
        });
        if (this.props.onUnreadChange) this.props.onUnreadChange();
      })
      .catch(() => { if (!this.unmounted) this.setState({ loadingThread: false, threadError: t('common.networkShort') }); });
  }

  markListRead(id) {
    if (!this.state.list) return;
    this.setState({ list: this.state.list.map((c) => (c.id === id ? Object.assign({}, c, { unreadCount: 0 }) : c)) });
  }

  poll() {
    if (!this.props.user) return;
    this.loadList();
    const conv = this.state.conv;
    if (!conv) return;
    const last = this.state.messages[this.state.messages.length - 1];
    fetchMessagesAfter(conv.id, last ? last.id : 0)
      .then(({ ok, data }) => {
        if (this.unmounted || !ok || !this.state.conv || this.state.conv.id !== conv.id || !data.messages.length) return;
        this.appendMessages(data.messages);
        this.markListRead(conv.id);
        if (this.props.onUnreadChange) this.props.onUnreadChange();
      })
      .catch(() => {});
  }

  appendMessages(incoming) {
    const seen = new Set(this.state.messages.map((m) => m.id));
    const fresh = incoming.filter((m) => !seen.has(m.id));
    if (!fresh.length) return;
    const el = this.logRef.current;
    const nearBottom = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    this.setState({ messages: syncMeetups(this.state.messages.concat(fresh)) }, () => { if (nearBottom || fresh.some((m) => m.mine)) this.scrollToEnd(); });
  }

  loadOlder() {
    const conv = this.state.conv;
    const first = this.state.messages[0];
    if (!conv || !first) return;
    const el = this.logRef.current;
    const prevHeight = el ? el.scrollHeight : 0;
    this.setState({ loadingOlder: true });
    fetchMessagesBefore(conv.id, first.id)
      .then(({ ok, data }) => {
        if (!ok) { this.setState({ loadingOlder: false }); toast.error(errorMessage(data, t('msg.olderFailed'))); return; }
        this.setState({ loadingOlder: false, hasMore: data.hasMore, messages: data.messages.concat(this.state.messages) }, () => {
          if (el) el.scrollTop = el.scrollHeight - prevHeight;
        });
      })
      .catch(() => { this.setState({ loadingOlder: false }); toast.error(t('common.networkShort')); });
  }

  scrollToEnd() {
    const el = this.logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }

  send(e) {
    if (e) e.preventDefault();
    const { conv, draft, sending } = this.state;
    const text = draft.trim();
    if (!conv || sending) return;
    if (!text) { this.setState({ sendError: t('msg.writeFirst') }); return; }
    if (text.length > MESSAGE_MAX) { this.setState({ sendError: t('msg.tooLong', { max: MESSAGE_MAX }) }); return; }
    // A gentle check before sending contact details or scam-like wording.
    // It runs on this device only: nothing is blocked, logged or reported.
    if (!this.state.nudgeOk) {
      const c = checkMessage(text);
      if (c.contact || c.scam) { this.setState({ nudge: c }); return; }
    }
    this.setState({ sending: true, sendError: '', nudge: null, nudgeOk: false });
    sendMessage(conv.id, text)
      .then(({ ok, status, data }) => {
        if (this.unmounted) return;
        if (!ok) {
          const msg = errorMessage(data, t('msg.sendFailed'));
          this.setState({ sending: false, sendError: msg });
          // Blocked: say so, then refresh so the composer is replaced by the notice.
          if (status === 403) {
            toast.error(msg);
            if (data && data.error && data.error.code === 'messaging_banned') this.setState({ conv: Object.assign({}, this.state.conv, { messagingBanned: true, canSend: false }) });
            this.loadList();
          }
          return;
        }
        this.setState({ sending: false, draft: '' }, () => { if (this.inputRef.current) this.inputRef.current.focus(); });
        this.appendMessages([data]);
        this.loadList();
      })
      .catch(() => { if (!this.unmounted) this.setState({ sending: false, sendError: t('msg.notSent') }); });
  }

  onComposerKey(e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      this.send();
    }
  }

  toggleBlock() {
    const conv = this.state.conv;
    const block = !conv.blocked.byMe;
    if (block && !window.confirm(t('msg.confirmBlock', { name: conv.other.name }))) return;
    setBlocked(conv.id, block)
      .then(({ ok, data }) => {
        if (!ok) { toast.error(errorMessage(data, t('msg.blockFailed'))); return; }
        // Blocking ends open meetup suggestions; reload so their cards say so.
        if (block) this.loadThreadQuietly();
        const blocked = data.blocked;
        this.setState({ menuOpen: false, conv: Object.assign({}, this.state.conv, { blocked, canSend: !blocked.byMe && !blocked.byThem && !this.state.conv.messagingBanned }) });
        toast.success(tidy(t(block ? 'msg.blocked' : 'msg.unblocked', { name: conv.other.name })));
        this.loadList();
      })
      .catch(() => toast.error(t('common.networkShort')));
  }

  loadThreadQuietly() {
    const conv = this.state.conv;
    if (!conv) return;
    fetchConversation(conv.id).then(({ ok, data }) => {
      if (!ok || this.unmounted || !this.state.conv || this.state.conv.id !== conv.id) return;
      this.setState({ messages: syncMeetups(data.messages), hasMore: data.hasMore });
    }).catch(() => {});
  }

  meetupAct(p, action) {
    this.setState({ meetBusy: p.id });
    meetupAction(p.id, action)
      .then(({ ok, data }) => {
        if (this.unmounted) return;
        this.setState({ meetBusy: null });
        if (!ok) { toast.error(errorMessage(data, t('meet.failed'))); this.loadThreadQuietly(); return; }
        this.patchMeetup(data);
        toast.success(t({ accept: 'meet.acceptedToast', decline: 'meet.declinedToast', cancel: p.status === 'accepted' ? 'meet.calledOffToast' : 'meet.withdrawnToast' }[action]));
        this.poll();
      })
      .catch(() => { if (!this.unmounted) { this.setState({ meetBusy: null }); toast.error(t('common.networkShort')); } });
  }

  patchMeetup(p) {
    this.setState({ messages: this.state.messages.map((m) => (m.kind === 'meetup' && m.meetup && m.meetup.id === p.id ? Object.assign({}, m, { meetup: Object.assign({}, p, { event: m.meetup.event }) }) : m)) });
  }

  meetupDone(p, counterOf) {
    this.setState({ meetDialog: null });
    if (counterOf) this.patchMeetup(Object.assign({}, counterOf, { status: 'countered' }));
    toast.success(t('meet.sent'));
    this.poll();
  }

  renderNudge() {
    const { nudge } = this.state;
    return (
      <div className="send-nudge" role="alert">
        <p className="send-nudge-title"><AlertTriangle size={16} aria-hidden="true" /><strong>{t('nudge.title')}</strong></p>
        {nudge.contact ? <p>{t('nudge.contact')}</p> : null}
        {nudge.scam ? <p>{t('nudge.scam')}</p> : null}
        <div className="send-nudge-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => { this.setState({ nudge: null }); if (this.inputRef.current) this.inputRef.current.focus(); }}>{t('nudge.edit')}</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => this.setState({ nudgeOk: true }, () => this.send())}>{t('nudge.send')}</button>
          <SafetyLink hash={nudge.scam ? 'pay' : 'privacy'} />
        </div>
        <p className="small muted">{t('nudge.private')}</p>
      </div>
    );
  }

  renderThumb(post, size) {
    if (post.thumbUrl) return <img className={'convo-thumb' + (size ? ' convo-thumb-' + size : '')} src={post.thumbUrl} alt="" />;
    return <span className={'convo-thumb convo-thumb-empty' + (size ? ' convo-thumb-' + size : '')} aria-hidden="true"><ImageOff size={18} /></span>;
  }

  renderList() {
    const { list, listError } = this.state;
    const activeId = this.currentId();
    if (listError && !list) return <Alert tone="danger">{listError}</Alert>;
    if (!list) return <SkeletonBlock lines={5} />;
    if (!list.length) {
      return (
        <EmptyState icon={Inbox} title={t('msg.noneTitle')} action={<Link className="btn btn-primary" to="/">{t('nav.browseSales')}</Link>}>
          {t('msg.noneText')}
        </EmptyState>
      );
    }
    return (
      <ul className="convo-list">
        {list.map((c) => {
          const label = postLabel(c.post);
          const preview = !c.lastMessage ? t('msg.noneTitle') : c.lastMessage.removed ? t('msg.removed')
            : c.lastMessage.kind === 'hold' ? holdEventText(c.lastMessage, c.other ? c.other.name : t('msg.formerUser'))
              : c.lastMessage.kind === 'meetup' ? meetupEventText(c.lastMessage, c.other ? c.other.name : t('msg.formerUser'))
              : c.lastMessage.mine ? t('msg.youPrefix', { text: c.lastMessage.body }) : c.lastMessage.body;
          return (
            <li key={c.id}>
              <Link to={'/messages/' + c.id} className={'convo-item' + (c.id === activeId ? ' active' : '') + (c.unreadCount ? ' unread' : '')}
                aria-current={c.id === activeId ? 'page' : undefined}>
                {this.renderThumb(c.post)}
                <span className="convo-main">
                  <span className="convo-top">
                    <strong className="convo-name">{c.other ? c.other.name : t('msg.formerUser')}</strong>
                    <span className="convo-time">{c.lastMessageAt ? timeAgo(c.lastMessageAt) : ''}</span>
                  </span>
                  <span className="convo-post">{c.post.title}{label ? ' · ' + label : ''}</span>
                  <span className="convo-preview">{preview}</span>
                </span>
                {c.unreadCount ? <span className="nav-badge" aria-label={t('msg.unread', { count: c.unreadCount })}>{c.unreadCount > 99 ? '99+' : c.unreadCount}</span> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    );
  }

  renderThread() {
    const { conv, messages, hasMore, threadError, loadingThread, loadingOlder, draft, sending, sendError } = this.state;
    const back = <Link to="/messages" className="back-link thread-back"><ArrowLeft size={16} aria-hidden="true" />{t('msg.all')}</Link>;
    if (threadError) return <div className="thread-pane">{back}<EmptyState icon={MessageCircle} title={t('msg.notFoundTitle')}>{threadError}</EmptyState></div>;
    if (loadingThread || !conv) return <div className="thread-pane">{back}<SkeletonBlock lines={6} /></div>;
    const label = postLabel(conv.post);
    const blocked = conv.blocked || {};
    const left = MESSAGE_MAX - draft.length;
    const otherName = conv.other ? conv.other.name : t('msg.formerUser');
    const agreed = upcomingAgreed(messages);
    const pendingMeetup = messages.some((m) => m.kind === 'meetup' && m.meetup && m.meetup.status === 'pending');
    const tips = showTips(conv.id, messages, hasMore);
    return (
      <section className="thread-pane" aria-labelledby="thread-title">
        {back}
        <header className="thread-header">
          {this.renderThumb(conv.post, 'lg')}
          <div className="thread-heading">
            <h2 id="thread-title">{conv.other ? conv.other.name : t('msg.formerUser')}{conv.other ? <RatingBadge summary={conv.otherRating} personId={conv.other.id} compact /> : null}</h2>
            <div className="thread-sub">
              <span className="chip">{conv.role === 'buyer' ? t('post.seller') : t('msg.buyer')}</span>
              {conv.post.wanted ? <span className="chip chip-brand">{t('want.kicker')}</span> : null}
              {conv.post.canView && conv.post.status !== 'deleted'
                ? <Link to={subjectPath(conv.post)}>{conv.post.title}</Link>
                : <span>{conv.post.title}</span>}
              {label ? <span className="chip chip-warning">{label}</span> : null}
              <SafetyLink className="thread-safety" />
            </div>
          </div>
          <div className="menu thread-menu" ref={this.menuRef}>
            <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-haspopup="menu" aria-expanded={this.state.menuOpen}
              aria-label={t('msg.options')} onClick={() => this.toggleMenu()}><MoreHorizontal size={18} aria-hidden="true" /></button>
            {this.state.menuOpen ? (
              <div className="menu-panel" role="menu" aria-label={t('msg.options')} onKeyDown={(e) => this.onMenuKey(e)}>
                <button type="button" role="menuitem" className="menu-item" onClick={() => this.toggleBlock()}>
                  <Ban size={18} aria-hidden="true" />{t(blocked.byMe ? 'msg.unblockNamed' : 'msg.blockNamed', { name: conv.other ? conv.other.name : '' }).trim()}
                </button>
                <button type="button" role="menuitem" className="menu-item menu-item-danger" disabled={conv.reportedByMe} onClick={() => this.openReport()}>
                  <Flag size={18} aria-hidden="true" />{conv.reportedByMe ? t('msg.reported') : t('msg.reportTitle')}
                </button>
              </div>
            ) : null}
          </div>
        </header>
        {conv.other ? <RatePanel conversationId={conv.id} iWrote={messages.some((m) => m.mine)}
          refreshKey={[messages.some((m) => m.mine), messages.some((m) => !m.mine), blocked.byMe, blocked.byThem].join()} /> : null}
        {conv.post.wanted ? null : <HoldPanel conversationId={conv.id} role={conv.role} canAct={conv.canSend}
          refreshKey={messages.filter((m) => m.kind === 'hold').map((m) => m.id).join()} onChange={() => this.poll()} />}
        {label && !conv.post.canView ? <Alert tone="warning">{t('msg.postGone')}</Alert> : null}
        {agreed ? (
          <div className="meet-agreed" role="status">
            <MapPin size={16} aria-hidden="true" />
            <span>{t('meet.agreedBanner', { place: agreed.place.name, time: meetTime(agreed.meetAt) })}</span>
            <a href={agreed.place.mapsUrl} target="_blank" rel="noopener noreferrer" className="small"><ExternalLink size={13} aria-hidden="true" /> {t('meet.directions')}</a>
          </div>
        ) : null}
        <div className="thread-log" ref={this.logRef} role="log" aria-live="polite" aria-label={t('msg.with', { name: conv.other ? conv.other.name : t('msg.formerUserLower') })} tabIndex="0">
          {hasMore ? (
            <div className="thread-older">
              <button type="button" className="btn btn-ghost btn-sm" disabled={loadingOlder} onClick={() => this.loadOlder()}>{loadingOlder ? <Spinner /> : null}{t('msg.loadOlder')}</button>
            </div>
          ) : null}
          {tips ? <SafetyTips onDismiss={() => { hideTips(conv.id); this.setState({ tipsTick: this.state.tipsTick + 1 }); }} /> : null}
          {!messages.length ? <p className="thread-empty muted">{t('msg.sayHello')}</p> : null}
          {messages.map((m) => (m.kind === 'meetup' && !m.removed && m.meetup && (m.meetup.event === 'proposed' || m.meetup.event === 'countered') && m.meetup.place ? (
            <MeetupCard key={m.id} m={m} other={otherName} canAct={conv.canSend} busy={this.state.meetBusy === m.meetup.id} clock={clock}
              onAction={(p, a) => this.meetupAct(p, a)} onCounter={(p) => this.setState({ meetDialog: { counterOf: p } })} />
          ) : m.kind === 'meetup' && !m.removed ? (
            <div key={m.id} className={'thread-event meet-event meet-event-' + (m.meetup && m.meetup.event)}>
              <MapPin size={14} aria-hidden="true" />
              <span>{meetupEventText(m, otherName)}</span>
              <time className="bubble-time" dateTime={m.createdAt}>{clock(m.createdAt)}</time>
            </div>
          ) : m.kind === 'hold' && !m.removed ? (
            <div key={m.id} className={'thread-event hold-event hold-event-' + (m.hold && m.hold.event)}>
              <Bookmark size={14} aria-hidden="true" />
              <span>{holdEventText(m, conv.other ? conv.other.name : t('msg.formerUser'))}</span>
              <time className="bubble-time" dateTime={m.createdAt}>{clock(m.createdAt)}</time>
            </div>
          ) : (
            <div key={m.id} className={'bubble-row' + (m.mine ? ' mine' : '')}>
              <span className="sr-only">{t('msg.speaker', { name: m.mine ? t('msg.you') : (conv.other ? conv.other.name : t('msg.them')) })} </span>
              {!m.mine ? <span className="avatar avatar-sm" aria-hidden="true">{initialsOf(conv.other && conv.other.name)}</span> : null}
              <div className={'bubble' + (m.removed ? ' bubble-removed' : '')}>
                {m.removed
                  ? <p className="bubble-text"><ShieldOff size={14} aria-hidden="true" /> {t('msg.removedShort')}</p>
                  : <p className="bubble-text">{linkify(m.body)}</p>}
                <time className="bubble-time" dateTime={m.createdAt}>{clock(m.createdAt)}</time>
              </div>
            </div>
          )))}
        </div>
        {conv.canSend ? (
          <div className="composer-tools">
            <button type="button" className="btn btn-secondary btn-sm meet-suggest" disabled={pendingMeetup} title={pendingMeetup ? t('meet.pendingExists') : undefined}
              onClick={() => this.setState({ meetDialog: { counterOf: null } })}><MapPin size={14} aria-hidden="true" />{t('meet.suggest')}</button>
            {pendingMeetup ? <span className="small muted">{t('meet.pendingExists')}</span> : null}
          </div>
        ) : null}
        {conv.canSend ? (
          <form className="composer" onSubmit={(e) => this.send(e)}>
            {this.state.nudge ? this.renderNudge() : null}
            <label htmlFor="composer-input" className="sr-only">{t('msg.messageNamed', { name: conv.other ? conv.other.name : '' }).trim()}</label>
            <textarea id="composer-input" ref={this.inputRef} className="textarea composer-input" rows={1} maxLength={MESSAGE_MAX} value={draft}
              placeholder={t('msg.placeholder')} aria-describedby="composer-hint" aria-invalid={sendError ? 'true' : undefined}
              onChange={(e) => this.setState({ draft: e.target.value, sendError: '', nudge: null, nudgeOk: false })} onKeyDown={(e) => this.onComposerKey(e)} />
            <button type="submit" className="btn btn-primary composer-send" disabled={sending || !draft.trim()} aria-label={t('msg.send')}>
              {sending ? <Spinner /> : <Send size={16} aria-hidden="true" />}<span className="hide-mobile">{t('msg.sendShort')}</span>
            </button>
            <div id="composer-hint" className="composer-hint field-hint">
              {sendError ? <span className="field-error" role="alert"><AlertTriangle size={14} aria-hidden="true" />{sendError}</span>
                : left < 200 ? t('common.charsLeft', { count: left }) : t('msg.enterHint')}
            </div>
          </form>
        ) : (
          <Alert tone="info" className="composer-blocked">
            {conv.messagingBanned ? <p>{t('msg.banned')}</p> : blocked.byMe ? <p>{tidy(t('msg.youBlocked', { name: conv.other ? conv.other.name : t('msg.thisPerson') }))}</p> : <p>{t('msg.cantReply')}</p>}
          </Alert>
        )}
        {this.state.reportOpen ? this.renderReportDialog() : null}
        {this.state.meetDialog ? (
          <MeetupDialog conversationId={conv.id} otherName={otherName} counterOf={this.state.meetDialog.counterOf}
            onClose={() => this.setState({ meetDialog: null })} onDone={(p) => this.meetupDone(p, this.state.meetDialog && this.state.meetDialog.counterOf)} />
        ) : null}
      </section>
    );
  }

  render() {
    const { user, ready } = this.props;
    if (!user) {
      if (!ready) return <div className="container"><SkeletonBlock lines={4} /></div>;
      return (
        <div className="container container-narrow">
          <EmptyState icon={LogIn} level={1} title={t('msg.loginTitle')} action={<Link className="btn btn-primary" to="/login">{t('nav.logIn')}</Link>}>{t('msg.private')}</EmptyState>
        </div>
      );
    }
    const hasThread = !!this.props.match.params.id;
    return (
      <div className={'container messages-page' + (hasThread ? ' has-thread' : '')}>
        <header className="page-header messages-header">
          <div><h1>{t('nav.messages')}</h1></div>
        </header>
        <div className="messages-layout">
          <nav className="convo-pane" aria-label={t('msg.conversations')}>{this.renderList()}</nav>
          {hasThread ? this.renderThread() : (
            <div className="thread-pane thread-placeholder">
              <EmptyState icon={MessageCircle} title={t('msg.pickTitle')}>{t('msg.pickText')}</EmptyState>
            </div>
          )}
        </div>
      </div>
    );
  }
}
