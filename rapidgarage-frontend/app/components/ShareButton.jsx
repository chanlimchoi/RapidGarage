import React from 'react';
import { Share2, Link2, Check, ExternalLink, MessageCircle, ChevronDown } from 'lucide-react';
import { shareUrl, quickLinks, canShare } from '../lib/share';
import { recordShare } from '../api';
import toast from './toast';
import { t, locale } from '../i18n';
import * as activity from '../lib/activity';

// Share a sale, a neighborhood sale or a wanted post. Phones (and browsers
// with the Web Share API) get the system share sheet; everywhere else a menu
// with Copy link, Facebook, WhatsApp, X and KakaoTalk (copies the link: Kakao
// has no keyless web share). Sales count presses for the seller dashboard
// (a number per day; nothing about who or where).
export default class ShareButton extends React.Component {
  constructor(props) {
    super(props);
    this.state = { open: false, copied: false };
    this.onDoc = this.onDoc.bind(this);
    this.onKey = this.onKey.bind(this);
  }

  componentDidUpdate(prev, prevState) {
    // Disclosure popover: move focus into it when it opens.
    if (this.state.open && !prevState.open && this.root) {
      const first = this.root.querySelector('.cal-menu-list a[href], .cal-menu-list button');
      if (first) first.focus();
    }
  }

  componentWillUnmount() { this.listen(false); clearTimeout(this.copiedTimer); }

  listen(on) {
    const fn = on ? 'addEventListener' : 'removeEventListener';
    document[fn]('mousedown', this.onDoc);
    document[fn]('keydown', this.onKey);
  }
  onDoc(e) { if (this.root && !this.root.contains(e.target)) this.close(); }
  onKey(e) { if (e.key === 'Escape') { this.close(); if (this.button) this.button.focus(); } }
  close() { if (this.state.open) { this.setState({ open: false }); this.listen(false); } }

  url() { return shareUrl(window.location.origin, this.props.kind, this.props.item.id, locale()); }

  track(channel) {
    if (this.props.kind === 'post') recordShare(this.props.item.id, channel);
    else if (this.props.kind === 'event' || this.props.kind === 'wanted') activity.track('share', { type: this.props.kind, id: this.props.item.id });
  }

  async click() {
    if (this.state.open) return this.close();
    const data = { title: this.props.title, text: this.props.text || this.props.title, url: this.url() };
    if (navigator.share && (!navigator.canShare || navigator.canShare(data))) {
      try { await navigator.share(data); this.track('native'); return undefined; } catch (err) {
        if (err && err.name === 'AbortError') return undefined; // the person closed the sheet
      }
    }
    this.setState({ open: true });
    this.listen(true);
    return undefined;
  }

  async copy(channel) {
    const url = this.url();
    let ok = false;
    try { await navigator.clipboard.writeText(url); ok = true; } catch (e) {
      // Older browsers / no permission: select the field and use execCommand.
      if (this.input) { this.input.focus(); this.input.select(); try { ok = document.execCommand('copy'); } catch (e2) { ok = false; } }
    }
    if (!ok) { if (this.input) { this.input.focus(); this.input.select(); } toast.error(t('share.copyFailed')); return; }
    this.track(channel);
    toast.success(channel === 'kakao' ? t('share.kakaoCopied') : t('share.copied'));
    this.setState({ copied: true });
    clearTimeout(this.copiedTimer);
    this.copiedTimer = setTimeout(() => this.setState({ copied: false }), 2500);
  }

  render() {
    const { kind, item, title, compact } = this.props;
    if (!canShare(kind, item)) return null;
    const url = this.url();
    const q = quickLinks(url, title);
    const id = 'share-menu-' + kind + '-' + item.id;
    const out = (key, href, label) => (
      <a className={'cal-menu-item share-' + key} href={href} target="_blank" rel="noopener noreferrer"
        onClick={() => { this.track(key); this.close(); }}>
        <ExternalLink size={14} aria-hidden="true" />{label}
      </a>
    );
    return (
      <div className={'cal-menu share-menu' + (this.state.open ? ' is-open' : '')} ref={(el) => { this.root = el; }}
        onBlur={(e) => { if (this.state.open && e.relatedTarget && this.root && !this.root.contains(e.relatedTarget)) this.close(); }}>
        <button type="button" className={'btn ' + (compact ? 'btn-ghost btn-sm' : 'btn-secondary') + ' share-btn'} aria-expanded={this.state.open} aria-controls={id}
          ref={(el) => { this.button = el; }} onClick={() => this.click()}>
          <Share2 size={16} aria-hidden="true" />{t('share.button')}{navigator.share ? null : <ChevronDown size={14} aria-hidden="true" />}
        </button>
        {this.state.open ? (
          <div className="cal-menu-list share-menu-list" id={id} role="group" aria-label={t('share.menuLabel')}>
            <label className="share-link-field">
              <span className="small muted">{t('share.linkLabel')}</span>
              <input type="text" readOnly value={url} ref={(el) => { this.input = el; }} onFocus={(e) => e.target.select()} className="share-link-input" />
            </label>
            <button type="button" className="cal-menu-item share-copy" onClick={() => this.copy('copy')}>
              {this.state.copied ? <Check size={14} aria-hidden="true" /> : <Link2 size={14} aria-hidden="true" />}{this.state.copied ? t('share.copiedShort') : t('share.copy')}
            </button>
            {out('facebook', q.facebook, 'Facebook')}
            {out('whatsapp', q.whatsapp, 'WhatsApp')}
            {out('x', q.x, 'X')}
            <button type="button" className="cal-menu-item share-kakao" onClick={() => this.copy('kakao')}>
              <MessageCircle size={14} aria-hidden="true" />
              <span><strong>{t('share.kakao')}</strong><span className="small muted cal-menu-hint">{t('share.kakaoHint')}</span></span>
            </button>
            <p className="small muted share-note">{t('share.note')}</p>
          </div>
        ) : null}
      </div>
    );
  }
}
