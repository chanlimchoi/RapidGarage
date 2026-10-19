import React from 'react';
import { Link } from 'react-router-dom';
import { PartyPopper, Gift } from 'lucide-react';
import { fetchSaleSummary } from '../api';
import { formatCents } from '../lib/items';
import DuplicateButton from '../post/DuplicateButton';
import { t } from '../i18n';

// Dashboard, ended sale: "How it went" with what to do next (leftovers free on
// the curb, or the same sale again). The same summary is emailed once.
// props: postId, hidden
export default class SaleRecap extends React.Component {
  constructor(props) {
    super(props);
    this.state = { s: null };
  }

  componentDidMount() {
    this.mounted = true;
    fetchSaleSummary(this.props.postId).then(({ ok, data }) => { if (this.mounted && ok) this.setState({ s: data }); }).catch(() => null);
  }
  componentWillUnmount() { this.mounted = false; }

  render() {
    const s = this.state.s;
    if (!s) return null;
    return (
      <section className="panel stack sale-recap" aria-labelledby="sale-recap-title">
        <h2 id="sale-recap-title" className="h4"><PartyPopper size={18} aria-hidden="true" />{t('recap.title')}</h2>
        {s.items.total ? (
          <p>{t('recap.items', { sold: s.items.sold, total: s.items.total })}{s.items.soldValueCents ? ' · ' + t('recap.value', { value: formatCents(s.items.soldValueCents) }) : ''}</p>
        ) : null}
        <p className="small muted">{t('recap.reach', { views: s.views, saves: s.saves, conversations: s.conversations })}</p>
        {!this.props.hidden ? (
          <div className="form-actions">
            {s.items.unsold ? <Link className="btn btn-secondary btn-sm" to={'/post/' + s.postId}><Gift size={14} aria-hidden="true" />{t('recap.curb')}</Link> : null}
            <DuplicateButton postId={s.postId} small label={t('recap.again')} />
          </div>
        ) : null}
      </section>
    );
  }
}
