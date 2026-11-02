import React, { Component } from 'react';
import { TrendingUp } from 'lucide-react';
import { apiFetch } from '../api';
import { formatCents } from '../lib/items';
import { shouldCheck, priceCheckMessage, priceInput, isCurrent, DEBOUNCE_MS } from '../lib/priceCheck';
import { t } from '../i18n';

// Under the item name on the item editor: what similar items sold for
// nearby (median and range from this site's own sales), with a button that
// puts the median in the price field. Quiet until 3 letters are typed.
export default class PriceCheck extends Component {
  constructor(props) {
    super(props);
    this.state = { result: null };
    this.timer = null;
  }

  componentDidMount() { this.schedule(); }
  componentDidUpdate(prev) { if (prev.name !== this.props.name) this.schedule(); }
  componentWillUnmount() { clearTimeout(this.timer); this.gone = true; }

  schedule() {
    clearTimeout(this.timer);
    const name = this.props.name;
    if (!shouldCheck(name)) { if (this.state.result) this.setState({ result: null }); return; }
    this.timer = setTimeout(() => {
      apiFetch('/post/' + this.props.postId + '/items/price-check?name=' + encodeURIComponent(name.trim())).then(({ ok, data }) => {
        if (this.gone || !isCurrent(name, this.props.name)) return;
        this.setState({ result: ok ? data : null });
      }).catch(() => {});
    }, DEBOUNCE_MS);
  }

  render() {
    const msg = priceCheckMessage(this.state.result);
    const v = msg ? msg.vars : null;
    const text = !msg ? ''
      : msg.key === 'priceCheck.range' ? t('priceCheck.range', { low: formatCents(v.low), high: formatCents(v.high), median: formatCents(v.median), count: v.count, miles: v.miles })
        : msg.key === 'priceCheck.same' ? t('priceCheck.same', { median: formatCents(v.median), count: v.count, miles: v.miles })
          : t('priceCheck.notEnough', { count: v.count, min: v.min, miles: v.miles });
    const use = msg && msg.key !== 'priceCheck.notEnough' ? priceInput(v.median) : '';
    return (
      <p className="field-hint price-check" aria-live="polite">
        {msg ? <React.Fragment>
          <TrendingUp size={14} aria-hidden="true" /> {text}
          {use && this.props.onUse ? <React.Fragment> <button type="button" className="btn btn-ghost btn-sm" onClick={() => this.props.onUse(use)}>{t('priceCheck.use', { price: formatCents(v.median) })}</button></React.Fragment> : null}
        </React.Fragment> : null}
      </p>
    );
  }
}
