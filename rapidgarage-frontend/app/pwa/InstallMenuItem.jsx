import React from 'react';
import { Download } from 'lucide-react';
import * as pwa from './pwa';
import { t } from '../i18n';

// "Install app" entry for the account/mobile menus; only when the browser offers it.
export default class InstallMenuItem extends React.Component {
  constructor(props) { super(props); this.state = { can: false }; }
  componentDidMount() { this.unsub = pwa.subscribe(() => this.setState({ can: pwa.canPrompt() })); }
  componentWillUnmount() { if (this.unsub) this.unsub(); }
  render() {
    if (!this.state.can) return null;
    return (
      <button type="button" role={this.props.role} className="menu-item menu-install" onClick={() => { if (this.props.onClick) this.props.onClick(); pwa.promptInstall(); }}>
        <Download size={18} aria-hidden="true" />{t('pwa.installApp')}
      </button>
    );
  }
}
