import React from 'react';
import { Download, Share, X, WifiOff, RefreshCw, Plus } from 'lucide-react';
import * as pwa from './pwa';
import toast from '../components/toast';
import { t } from '../i18n';
import { tx } from '../i18n/rich';

// Offline notice, "new version" notice and the install card. Shown at the
// bottom of the screen on phones, bottom-left on wider screens.
export default class PwaBanners extends React.Component {
  constructor(props) {
    super(props);
    this.state = { s: null, iosOpen: false };
  }

  componentDidMount() {
    this.unsub = pwa.subscribe((s) => {
      if (s.installed && !this.wasInstalled) { this.wasInstalled = true; toast.success(t('pwa.installed')); }
      this.setState({ s: Object.assign({}, s) });
    });
  }

  componentWillUnmount() { if (this.unsub) this.unsub(); }

  install() {
    pwa.promptInstall().then((outcome) => {
      if (outcome === 'accepted') toast.success(t('pwa.installing'));
    });
  }

  renderInstall() {
    const { s, iosOpen } = this.state;
    if (!this.props.offerInstall || pwa.isStandalone() || s.installed || pwa.dismissedRecently()) return null;
    const ios = !s.deferred && pwa.isIosSafari();
    if (!s.deferred && !ios) return null;
    return (
      <div className="pwa-card install-card" role="region" aria-labelledby="install-title">
        <img src="/icons/icon-192.png" alt="" width="44" height="44" className="install-icon" />
        <div className="install-text">
          <strong id="install-title">{t('pwa.title')}</strong>
          {ios && iosOpen ? (
            <span className="small">{tx('pwa.ios', { share: <Share size={14} aria-label={t('pwa.share')} />, add: <strong>{t('pwa.addHome')}</strong>, plus: <Plus size={14} aria-hidden="true" /> })}</span>
          ) : <span className="small muted">{t('pwa.lead')}</span>}
        </div>
        <div className="install-actions">
          {ios
            ? (!iosOpen ? <button type="button" className="btn btn-primary btn-sm" onClick={() => this.setState({ iosOpen: true })}><Download size={16} aria-hidden="true" />{t('pwa.how')}</button> : null)
            : <button type="button" className="btn btn-primary btn-sm install-btn" onClick={() => this.install()}><Download size={16} aria-hidden="true" />{t('pwa.install')}</button>}
          <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={t('pwa.notNow')} onClick={() => pwa.dismiss()}><X size={16} aria-hidden="true" /></button>
        </div>
      </div>
    );
  }

  render() {
    const { s } = this.state;
    if (!s) return null;
    return (
      <div className="pwa-banners">
        {s.offline ? (
          <div className="pwa-card offline-card" role="status">
            <WifiOff size={18} aria-hidden="true" />
            <span className="small"><strong>{t('pwa.offlineTitle')}</strong> {t('pwa.offline')}</span>
          </div>
        ) : null}
        {s.updateReady ? (
          <div className="pwa-card update-card" role="status">
            <RefreshCw size={18} aria-hidden="true" />
            <span className="small">{t('pwa.update')}</span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => pwa.applyUpdate()}>{t('map.reload')}</button>
          </div>
        ) : null}
        {!s.offline ? this.renderInstall() : null}
      </div>
    );
  }
}
