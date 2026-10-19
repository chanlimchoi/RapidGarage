import React from 'react';
import { Sparkles, Check, RotateCcw } from 'lucide-react';
import { describeSale, fetchAiKey, errorMessage } from '../api';
import { Alert, Spinner } from '../components/ui';
import AiKeyChoice, { keySource } from './AiKeyChoice';
import { t } from '../i18n';

// Edit sale: "Write title & description with AI". Claude writes a suggestion
// from the item list and up to 3 photos; "Use these" copies it into the form,
// where the seller edits and saves as usual. Nothing is saved here.
// props: post, config, onUse({ title, description })
export default class AiWritePanel extends React.Component {
  constructor(props) {
    super(props);
    this.state = { busy: false, error: '', draft: null, saved: null, useOnce: false, oneTimeKey: '' };
  }

  componentDidMount() {
    this.mounted = true;
    if (this.props.config && this.props.config.userAiKeys) {
      fetchAiKey().then(({ ok, data }) => { if (this.mounted && ok) this.setState({ saved: data }); }).catch(() => null);
    }
  }
  componentWillUnmount() { this.mounted = false; }

  source() { return keySource(this.props.config, this.state.saved, this.state.useOnce); }

  write() {
    const once = this.source() === 'one_time';
    const key = once ? this.state.oneTimeKey.trim() : null;
    if (once && !key) return this.setState({ error: t('aikey.pasteKey') });
    // The one-time key leaves the page's state the moment it is sent.
    this.setState({ busy: true, error: '', oneTimeKey: '' });
    describeSale(this.props.post.id, key).then(({ ok, data }) => {
      if (!this.mounted) return;
      if (!ok) return this.setState({ busy: false, error: errorMessage(data, t('aiwrite.failed')) });
      return this.setState({ busy: false, draft: { title: data.title, description: data.description } });
    }).catch(() => this.mounted && this.setState({ busy: false, error: t('common.network') }));
    return undefined;
  }

  use() {
    this.props.onUse(this.state.draft);
    this.setState({ draft: null });
  }

  render() {
    const { busy, error, draft } = this.state;
    return (
      <section className="card-form ai-draft ai-write" aria-labelledby="ai-write-title" aria-busy={busy}>
        <h2 id="ai-write-title" className="h4"><Sparkles size={18} aria-hidden="true" style={{ verticalAlign: '-3px', marginRight: 6 }} />{t('aiwrite.title')}</h2>
        <p className="small muted">{t('aiwrite.lead')}</p>
        {draft ? (
          <React.Fragment>
            <div className="ai-write-preview" aria-live="polite">
              <p><strong>{draft.title}</strong></p>
              {draft.description ? <p className="small ai-write-description">{draft.description}</p> : null}
            </div>
            <div className="form-actions">
              <button type="button" className="btn btn-primary" onClick={() => this.use()}><Check size={16} aria-hidden="true" />{t('aiwrite.use')}</button>
              <button type="button" className="btn btn-ghost" onClick={() => this.setState({ draft: null })}><RotateCcw size={16} aria-hidden="true" />{t('ai.discard')}</button>
            </div>
          </React.Fragment>
        ) : (
          <React.Fragment>
            <AiKeyChoice id="ai-write" config={this.props.config} saved={this.state.saved} useOnce={this.state.useOnce} oneTimeKey={this.state.oneTimeKey}
              onChange={(patch) => this.setState(Object.assign({ error: '' }, patch))} />
            <div className="form-actions">
              <button type="button" className="btn btn-secondary" disabled={busy || !this.source()} onClick={() => this.write()}>
                {busy ? <Spinner /> : <Sparkles size={16} aria-hidden="true" />}{busy ? t('ai.working') : t('aiwrite.write')}
              </button>
            </div>
          </React.Fragment>
        )}
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <p className="small muted ai-draft-privacy">{t('aiwrite.privacy')}</p>
      </section>
    );
  }
}
