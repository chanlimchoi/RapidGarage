import React from 'react';
import { Link } from 'react-router-dom';
import { MessageCircle, ArrowLeft, Send, Ban, ImageOff, LogIn, Inbox, AlertTriangle, Flag, MoreHorizontal, ShieldOff } from 'lucide-react';
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

const POLL_MS = 10000;

function clock(value) {
  const d = new Date(value);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ', ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function initialsOf(name) {
  return String(name || '?').split(/\s+/).map((w) => w.charAt(0)).join('').slice(0, 2).toUpperCase();
}

// "Bea B." already ends a sentence; "Bea" needs a period.
const endSentence = (s) => (/[.!?]$/.test(s) ? s : s + '.');

function postLabel(post) {
  if (post.status === 'deleted') return 'Post deleted';
  if (post.status === 'hidden') return post.canView ? 'Hidden by moderator' : 'Post unavailable';
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
    if (!reason) { this.setState({ reportError: 'Choose a reason.' }); return; }
    if (note.length > REPORT_NOTE_MAX) { this.setState({ reportError: 'Keep the note under ' + REPORT_NOTE_MAX + ' characters.' }); return; }
    this.setState({ reporting: true, reportError: '' });
    reportConversation(conv.id, reason, note.trim(), alsoBlock)
      .then(({ ok, status, data }) => {
        if (this.unmounted) return;
        if (ok || status === 409) {
          const patch = { reporting: false, reportOpen: false, conv: Object.assign({}, this.state.conv, { reportedByMe: true }) };
          if (ok && data.blocked) Object.assign(patch.conv, { blocked: data.blocked, canSend: false });
          this.setState(patch);
          if (ok) toast.success('Thanks. A moderator will review this conversation.' + (alsoBlock ? ' ' + endSentence(conv.other ? conv.other.name : 'They') + ' is blocked.' : ''));
          else toast.info("You've already reported this conversation.");
          return;
        }
        if (status === 429) { this.setState({ reporting: false, reportOpen: false }); toast.error("You've sent a lot of reports recently. Please try again later."); return; }
        this.setState({ reporting: false, reportError: errorMessage(data, 'Could not send the report.') });
      })
      .catch(() => { if (!this.unmounted) this.setState({ reporting: false, reportError: 'Unable to reach the server. Please try again.' }); });
  }

  renderReportDialog() {
    const { conv, reason, note, alsoBlock, reportError, reporting } = this.state;
    const name = conv.other ? conv.other.name : 'this person';
    const left = REPORT_NOTE_MAX - note.length;
    return (
      <Dialog id="convreport-dialog" title="Report conversation" onClose={() => !reporting && this.setState({ reportOpen: false })}
        description={'A moderator will be able to read this conversation to review your report. ' + name + " won't be told who reported it."}>
        <form onSubmit={(e) => this.submitReport(e)} noValidate>
          <fieldset className="field report-reasons">
            <legend className="field-label">What's wrong?</legend>
            {CONVERSATION_REPORT_REASONS.map((r) => (
              <label key={r.value} className="radio-row">
                <input type="radio" name="convreport-reason" value={r.value} checked={reason === r.value}
                  onChange={() => this.setState({ reason: r.value, reportError: '' })} />
                <span>{r.label}</span>
              </label>
            ))}
          </fieldset>
          <Field id="convreport-note" label="Details" optional hint={left >= 0 ? left + ' characters left' : 'Too long by ' + (-left)}>
            <textarea className="textarea" rows={3} maxLength={REPORT_NOTE_MAX} value={note} onChange={(e) => this.setState({ note: e.target.value })}
              placeholder="What happened? This goes to moderators only." />
          </Field>
          {!(conv.blocked && conv.blocked.byMe) ? (
            <label className="checkbox-row" htmlFor="convreport-block">
              <input id="convreport-block" type="checkbox" checked={alsoBlock} onChange={(e) => this.setState({ alsoBlock: e.target.checked })} />
              <span><strong>Also block {name}</strong><span className="field-hint" style={{ display: 'block' }}>Neither of you will be able to send messages.</span></span>
            </label>
          ) : null}
          {reportError ? <Alert tone="danger">{reportError}</Alert> : null}
          <div className="dialog-footer">
            <button type="button" className="btn btn-ghost" disabled={reporting} onClick={() => this.setState({ reportOpen: false })}>Cancel</button>
            <button type="submit" className="btn btn-danger" disabled={reporting}>{reporting ? <Spinner /> : <Flag size={16} aria-hidden="true" />}Send report</button>
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
        if (!ok) { this.setState({ listError: errorMessage(data, 'Could not load your messages.') }); return; }
        const patch = { list: data.results, listError: '' };
        // Keep the open thread's block / post state in sync with the list.
        const open = this.state.conv && data.results.filter((c) => c.id === this.state.conv.id)[0];
        if (open) patch.conv = Object.assign({}, this.state.conv, { blocked: open.blocked, post: open.post, canSend: !open.blocked.byMe && !open.blocked.byThem && !this.state.conv.messagingBanned });
        this.setState(patch);
      })
      .catch(() => { if (!this.unmounted) this.setState({ listError: 'Unable to reach the server.' }); });
  }

  loadThread() {
    const id = this.currentId();
    if (!this.props.match.params.id) { this.setState({ conv: null, messages: [], threadError: '' }); return; }
    if (!id) { this.setState({ conv: null, threadError: 'Conversation not found.' }); return; }
    this.setState({ loadingThread: true, threadError: '', conv: null, messages: [] });
    fetchConversation(id)
      .then(({ ok, data }) => {
        if (this.unmounted || this.currentId() !== id) return;
        if (!ok) { this.setState({ loadingThread: false, threadError: errorMessage(data, 'Conversation not found.') }); return; }
        this.setState({ loadingThread: false, conv: data.conversation, messages: data.messages, hasMore: data.hasMore }, () => {
          this.scrollToEnd();
          this.markListRead(id);
          if (this.inputRef.current && window.matchMedia && window.matchMedia('(min-width: 900px)').matches) this.inputRef.current.focus();
        });
        if (this.props.onUnreadChange) this.props.onUnreadChange();
      })
      .catch(() => { if (!this.unmounted) this.setState({ loadingThread: false, threadError: 'Unable to reach the server.' }); });
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
        if (!ok) { this.setState({ loadingOlder: false }); toast.error(errorMessage(data, 'Could not load older messages.')); return; }
        this.setState({ loadingOlder: false, hasMore: data.hasMore, messages: data.messages.concat(this.state.messages) }, () => {
          if (el) el.scrollTop = el.scrollHeight - prevHeight;
        });
      })
      .catch(() => { this.setState({ loadingOlder: false }); toast.error('Unable to reach the server.'); });
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
    if (!text) { this.setState({ sendError: 'Write a message first.' }); return; }
    if (text.length > MESSAGE_MAX) { this.setState({ sendError: 'Keep messages under ' + MESSAGE_MAX + ' characters.' }); return; }
    this.setState({ sending: true, sendError: '' });
    sendMessage(conv.id, text)
      .then(({ ok, status, data }) => {
        if (this.unmounted) return;
        if (!ok) {
          const msg = errorMessage(data, 'Could not send your message.');
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
      .catch(() => { if (!this.unmounted) this.setState({ sending: false, sendError: 'Unable to reach the server. Your message was not sent.' }); });
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
    if (block && !window.confirm('Block ' + conv.other.name + "? Neither of you will be able to send messages. You can unblock them later.")) return;
    setBlocked(conv.id, block)
      .then(({ ok, data }) => {
        if (!ok) { toast.error(errorMessage(data, 'Could not update the block.')); return; }
        const blocked = data.blocked;
        this.setState({ menuOpen: false, conv: Object.assign({}, this.state.conv, { blocked, canSend: !blocked.byMe && !blocked.byThem && !this.state.conv.messagingBanned }) });
        toast.success(block ? conv.other.name + ' is blocked.' : conv.other.name + ' is unblocked.');
        this.loadList();
      })
      .catch(() => toast.error('Unable to reach the server.'));
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
        <EmptyState icon={Inbox} title="No messages yet" action={<Link className="btn btn-primary" to="/">Browse sales</Link>}>
          When you message a seller, or a buyer messages you, the conversation shows up here.
        </EmptyState>
      );
    }
    return (
      <ul className="convo-list">
        {list.map((c) => {
          const label = postLabel(c.post);
          const preview = !c.lastMessage ? 'No messages yet' : c.lastMessage.removed ? 'Message removed by moderator' : (c.lastMessage.mine ? 'You: ' : '') + c.lastMessage.body;
          return (
            <li key={c.id}>
              <Link to={'/messages/' + c.id} className={'convo-item' + (c.id === activeId ? ' active' : '') + (c.unreadCount ? ' unread' : '')}
                aria-current={c.id === activeId ? 'page' : undefined}>
                {this.renderThumb(c.post)}
                <span className="convo-main">
                  <span className="convo-top">
                    <strong className="convo-name">{c.other ? c.other.name : 'Former user'}</strong>
                    <span className="convo-time">{c.lastMessageAt ? timeAgo(c.lastMessageAt) : ''}</span>
                  </span>
                  <span className="convo-post">{c.post.title}{label ? ' · ' + label : ''}</span>
                  <span className="convo-preview">{preview}</span>
                </span>
                {c.unreadCount ? <span className="nav-badge" aria-label={c.unreadCount + ' unread'}>{c.unreadCount > 99 ? '99+' : c.unreadCount}</span> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    );
  }

  renderThread() {
    const { conv, messages, hasMore, threadError, loadingThread, loadingOlder, draft, sending, sendError } = this.state;
    const back = <Link to="/messages" className="back-link thread-back"><ArrowLeft size={16} aria-hidden="true" />All messages</Link>;
    if (threadError) return <div className="thread-pane">{back}<EmptyState icon={MessageCircle} title="Conversation not found">{threadError}</EmptyState></div>;
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
            <h2 id="thread-title">{conv.other ? conv.other.name : 'Former user'}{conv.other ? <RatingBadge summary={conv.otherRating} personId={conv.other.id} compact /> : null}</h2>
            <div className="thread-sub">
              <span className="chip">{conv.role === 'buyer' ? 'Seller' : 'Buyer'}</span>
              {conv.post.canView && conv.post.status !== 'deleted'
                ? <Link to={'/post/' + conv.post.id}>{conv.post.title}</Link>
                : <span>{conv.post.title}</span>}
              {label ? <span className="chip chip-warning">{label}</span> : null}
            </div>
          </div>
          <div className="menu thread-menu" ref={this.menuRef}>
            <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-haspopup="menu" aria-expanded={this.state.menuOpen}
              aria-label="Conversation options" onClick={() => this.toggleMenu()}><MoreHorizontal size={18} aria-hidden="true" /></button>
            {this.state.menuOpen ? (
              <div className="menu-panel" role="menu" aria-label="Conversation options" onKeyDown={(e) => this.onMenuKey(e)}>
                <button type="button" role="menuitem" className="menu-item" onClick={() => this.toggleBlock()}>
                  <Ban size={18} aria-hidden="true" />{blocked.byMe ? 'Unblock ' : 'Block '}{conv.other ? conv.other.name : ''}
                </button>
                <button type="button" role="menuitem" className="menu-item menu-item-danger" disabled={conv.reportedByMe} onClick={() => this.openReport()}>
                  <Flag size={18} aria-hidden="true" />{conv.reportedByMe ? 'Reported' : 'Report conversation'}
                </button>
              </div>
            ) : null}
          </div>
        </header>
        {conv.other ? <RatePanel conversationId={conv.id} iWrote={messages.some((m) => m.mine)}
          refreshKey={[messages.some((m) => m.mine), messages.some((m) => !m.mine), blocked.byMe, blocked.byThem].join()} /> : null}
        {label && !conv.post.canView ? <Alert tone="warning">This post is no longer available. You can still read this conversation.</Alert> : null}
        <div className="thread-log" ref={this.logRef} role="log" aria-live="polite" aria-label={'Messages with ' + (conv.other ? conv.other.name : 'former user')} tabIndex="0">
          {hasMore ? (
            <div className="thread-older">
              <button type="button" className="btn btn-ghost btn-sm" disabled={loadingOlder} onClick={() => this.loadOlder()}>{loadingOlder ? <Spinner /> : null}Load older messages</button>
            </div>
          ) : null}
          {!messages.length ? <p className="thread-empty muted">Say hello. Ask about the items, times or prices.</p> : null}
          {messages.map((m) => (
            <div key={m.id} className={'bubble-row' + (m.mine ? ' mine' : '')}>
              <span className="sr-only">{m.mine ? 'You' : (conv.other ? conv.other.name : 'Them')}: </span>
              {!m.mine ? <span className="avatar avatar-sm" aria-hidden="true">{initialsOf(conv.other && conv.other.name)}</span> : null}
              <div className={'bubble' + (m.removed ? ' bubble-removed' : '')}>
                {m.removed
                  ? <p className="bubble-text"><ShieldOff size={14} aria-hidden="true" /> Removed by moderator</p>
                  : <p className="bubble-text">{linkify(m.body)}</p>}
                <time className="bubble-time" dateTime={m.createdAt}>{clock(m.createdAt)}</time>
              </div>
            </div>
          ))}
        </div>
        {conv.canSend ? (
          <form className="composer" onSubmit={(e) => this.send(e)}>
            <label htmlFor="composer-input" className="sr-only">Message {conv.other ? conv.other.name : ''}</label>
            <textarea id="composer-input" ref={this.inputRef} className="textarea composer-input" rows={1} maxLength={MESSAGE_MAX} value={draft}
              placeholder="Write a message…" aria-describedby="composer-hint" aria-invalid={sendError ? 'true' : undefined}
              onChange={(e) => this.setState({ draft: e.target.value, sendError: '' })} onKeyDown={(e) => this.onComposerKey(e)} />
            <button type="submit" className="btn btn-primary composer-send" disabled={sending || !draft.trim()} aria-label="Send message">
              {sending ? <Spinner /> : <Send size={16} aria-hidden="true" />}<span className="hide-mobile">Send</span>
            </button>
            <div id="composer-hint" className="composer-hint field-hint">
              {sendError ? <span className="field-error" role="alert"><AlertTriangle size={14} aria-hidden="true" />{sendError}</span>
                : left < 200 ? left + ' characters left' : 'Enter to send · Shift+Enter for a new line'}
            </div>
          </form>
        ) : (
          <Alert tone="info" className="composer-blocked">
            {conv.messagingBanned ? <p>A moderator has turned off messaging for your account. You can still read your conversations.</p> : blocked.byMe ? <p>You blocked {endSentence(conv.other ? conv.other.name : 'this person')} Unblock them to send messages.</p> : <p>You can't reply to this conversation.</p>}
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
          <EmptyState icon={LogIn} title="Log in to see your messages" action={<Link className="btn btn-primary" to="/login">Log in</Link>}>Messages between buyers and sellers are private to the two of you.</EmptyState>
        </div>
      );
    }
    const hasThread = !!this.props.match.params.id;
    return (
      <div className={'container messages-page' + (hasThread ? ' has-thread' : '')}>
        <header className="page-header messages-header">
          <div><h1>Messages</h1></div>
        </header>
        <div className="messages-layout">
          <nav className="convo-pane" aria-label="Conversations">{this.renderList()}</nav>
          {hasThread ? this.renderThread() : (
            <div className="thread-pane thread-placeholder">
              <EmptyState icon={MessageCircle} title="Pick a conversation">Choose a conversation on the left to read and reply.</EmptyState>
            </div>
          )}
        </div>
      </div>
    );
  }
}
