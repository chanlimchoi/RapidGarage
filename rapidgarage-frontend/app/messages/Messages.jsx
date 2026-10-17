import React from 'react';
import { Link } from 'react-router-dom';
import { MessageCircle, ArrowLeft, Send, Ban, ImageOff, LogIn, Inbox, AlertTriangle, Flag, MoreHorizontal, ShieldOff, Bookmark } from 'lucide-react';
import {
  errorMessage, fetchConversations, fetchConversation, fetchMessagesAfter, fetchMessagesBefore,
  sendMessage, setBlocked, MESSAGE_MAX, reportConversation, CONVERSATION_REPORT_REASONS, REPORT_NOTE_MAX,
} from '../api';
import { Alert, EmptyState, SkeletonBlock, Spinner, Dialog, Field } from '../components/ui';
import { timeAgo } from '../lib/format';
import toast from '../components/toast';
import linkify from './linkify';
import RatePanel from '../ratings/RatePanel';
import { RatingBadge } from '../ratings/Stars';
import HoldPanel from './HoldPanel';
import { holdEventText } from './holdText';
import { t, intlLocale } from '../i18n';

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

function postLabel(post) {
  if (post.status === 'deleted') return t('msg.postDeleted');
  if (post.status === 'hidden') return post.canView ? t('msg.hidden') : t('msg.unavailable');
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
    };
    this.menuRef = React.createRef();
    this.onDocClick = this.onDocClick.bind(this);
    this.logRef = React.createRef();
    this.inputRef = React.createRef();
    this.poll = this.poll.bind(this);
  }

  componentDidMount() {
    if (this.props.user) this.init();
    this.timer = setInterval(() => { if (!document.hidden) this.poll(); }, POLL_MS);
    document.addEventListener('mousedown', this.onDocClick);
  }

  onDocClick(e) {
    if (this.state.menuOpen && this.menuRef.current && !this.menuRef.current.contains(e.target)) this.setState({ menuOpen: false });
  }

  onMenuKey(e) {
    if (e.key === 'Escape') { this.setState({ menuOpen: false }); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = Array.prototype.slice.call(this.menuRef.current.querySelectorAll('[role="menuitem"]:not(:disabled)'));
    const i = items.indexOf(document.activeElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
  }

  toggleMenu() {
    this.setState({ menuOpen: !this.state.menuOpen }, () => {
      const first = this.state.menuOpen && this.menuRef.current && this.menuRef.current.querySelector('[role="menuitem"]:not(:disabled)');
      if (first) first.focus();
    });
  }

  openReport() {
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
    document.removeEventListener('mousedown', this.onDocClick);
    this.unmounted = true;
  }

  componentDidUpdate(prev) {
    if (!prev.user && this.props.user) this.init();
    if (prev.match.params.id !== this.props.match.params.id && this.props.user) {
      this.setState({ draft: '', sendError: '' });
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
        this.setState({ loadingThread: false, conv: data.conversation, messages: data.messages, hasMore: data.hasMore }, () => {
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
    this.setState({ messages: this.state.messages.concat(fresh) }, () => { if (nearBottom || fresh.some((m) => m.mine)) this.scrollToEnd(); });
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
    this.setState({ sending: true, sendError: '' });
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
        const blocked = data.blocked;
        this.setState({ menuOpen: false, conv: Object.assign({}, this.state.conv, { blocked, canSend: !blocked.byMe && !blocked.byThem && !this.state.conv.messagingBanned }) });
        toast.success(tidy(t(block ? 'msg.blocked' : 'msg.unblocked', { name: conv.other.name })));
        this.loadList();
      })
      .catch(() => toast.error(t('common.networkShort')));
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
    return (
      <section className="thread-pane" aria-labelledby="thread-title">
        {back}
        <header className="thread-header">
          {this.renderThumb(conv.post, 'lg')}
          <div className="thread-heading">
            <h2 id="thread-title">{conv.other ? conv.other.name : t('msg.formerUser')}{conv.other ? <RatingBadge summary={conv.otherRating} personId={conv.other.id} compact /> : null}</h2>
            <div className="thread-sub">
              <span className="chip">{conv.role === 'buyer' ? t('post.seller') : t('msg.buyer')}</span>
              {conv.post.canView && conv.post.status !== 'deleted'
                ? <Link to={'/post/' + conv.post.id}>{conv.post.title}</Link>
                : <span>{conv.post.title}</span>}
              {label ? <span className="chip chip-warning">{label}</span> : null}
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
        <HoldPanel conversationId={conv.id} role={conv.role} canAct={conv.canSend}
          refreshKey={messages.filter((m) => m.kind === 'hold').map((m) => m.id).join()} onChange={() => this.poll()} />
        {label && !conv.post.canView ? <Alert tone="warning">{t('msg.postGone')}</Alert> : null}
        <div className="thread-log" ref={this.logRef} role="log" aria-live="polite" aria-label={t('msg.with', { name: conv.other ? conv.other.name : t('msg.formerUserLower') })} tabIndex="0">
          {hasMore ? (
            <div className="thread-older">
              <button type="button" className="btn btn-ghost btn-sm" disabled={loadingOlder} onClick={() => this.loadOlder()}>{loadingOlder ? <Spinner /> : null}{t('msg.loadOlder')}</button>
            </div>
          ) : null}
          {!messages.length ? <p className="thread-empty muted">{t('msg.sayHello')}</p> : null}
          {messages.map((m) => (m.kind === 'hold' && !m.removed ? (
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
          <form className="composer" onSubmit={(e) => this.send(e)}>
            <label htmlFor="composer-input" className="sr-only">{t('msg.messageNamed', { name: conv.other ? conv.other.name : '' }).trim()}</label>
            <textarea id="composer-input" ref={this.inputRef} className="textarea composer-input" rows={1} maxLength={MESSAGE_MAX} value={draft}
              placeholder={t('msg.placeholder')} aria-describedby="composer-hint" aria-invalid={sendError ? 'true' : undefined}
              onChange={(e) => this.setState({ draft: e.target.value, sendError: '' })} onKeyDown={(e) => this.onComposerKey(e)} />
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
      </section>
    );
  }

  render() {
    const { user, ready } = this.props;
    if (!user) {
      if (!ready) return <div className="container"><SkeletonBlock lines={4} /></div>;
      return (
        <div className="container container-narrow">
          <EmptyState icon={LogIn} title={t('msg.loginTitle')} action={<Link className="btn btn-primary" to="/login">{t('nav.logIn')}</Link>}>{t('msg.private')}</EmptyState>
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
