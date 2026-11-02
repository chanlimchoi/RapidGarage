import React, { Component } from 'react';
import { Languages } from 'lucide-react';
import { fetchTranslation } from '../api';
import { Spinner } from '../components/ui';
import { differs, languageName, failureKey } from '../lib/listingLanguage';
import { LOCALES, locale, intlLocale, t } from '../i18n';
import toast from '../components/toast';

const NATIVE = LOCALES.reduce((m, l) => Object.assign(m, { [l.code]: l.name }), {});
const FAIL = { 'lang.failed': () => t('lang.failed'), 'lang.tooLong': () => t('lang.tooLong') };

// "Written in Korean" + "Translate to English" / "Show original" on a sale page.
// props: post, config, translation (the current result or null), showing (bool),
// onTranslation(result), onToggle(showing).
class ListingLanguage extends Component {
  constructor(props) { super(props); this.state = { busy: false }; }

  translate() {
    const { post, translation } = this.props;
    if (translation && translation.translated && translation.to === locale()) return this.props.onToggle(true);
    this.setState({ busy: true });
    return fetchTranslation(post.id, locale()).then(({ ok, data }) => {
      this.setState({ busy: false });
      if (!ok || !data.translated) {
        const key = ok ? failureKey(data.reason) : 'lang.failed';
        if (key) toast.error(FAIL[key]());
        return;
      }
      this.props.onTranslation(data);
      this.props.onToggle(true);
    }).catch(() => { this.setState({ busy: false }); toast.error(t('common.network')); });
  }

  render() {
    const { post, config, showing } = this.props;
    const ui = locale();
    if (!post || !differs(post.language, ui)) return null;
    const from = languageName(post.language, intlLocale(ui), NATIVE);
    const to = languageName(ui, intlLocale(ui), NATIVE);
    return (
      <div className="listing-language" lang={showing ? ui : undefined}>
        <span className="chip chip-language" lang={ui}><Languages size={12} aria-hidden="true" />{showing ? t('lang.translatedFrom', { language: from }) : t('lang.writtenIn', { language: from })}</span>
        {showing ? (
          <button type="button" className="btn btn-link btn-sm" onClick={() => this.props.onToggle(false)}>{t('lang.showOriginal')}</button>
        ) : config && config.translation ? (
          <button type="button" className="btn btn-link btn-sm" disabled={this.state.busy} onClick={() => this.translate()}>
            {this.state.busy ? <Spinner size={12} /> : null}{t('lang.translateTo', { language: to })}
          </button>
        ) : null}
        {showing ? <span className="muted small">{t('lang.machine')}</span> : null}
      </div>
    );
  }
}

export default ListingLanguage;
