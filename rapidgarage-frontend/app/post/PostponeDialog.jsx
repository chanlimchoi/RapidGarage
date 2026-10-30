import React from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock } from 'lucide-react';
import { postponeSale, errorMessage } from '../api';
import { Dialog, Alert, Spinner } from '../components/ui';
import toast from '../components/toast';
import { t } from '../i18n';

const CHOICES = [1, 7];

// Postpone a sale: move every upcoming day 1 or 7 days later (same hours), or
// edit the dates by hand. People who saved it are told the new date.
export default class PostponeDialog extends React.Component {
  constructor(props) { super(props); this.state = { byDays: 7, busy: false, error: '' }; }

  submit(e) {
    e.preventDefault();
    this.setState({ busy: true, error: '' });
    postponeSale(this.props.postId, { byDays: this.state.byDays }).then(({ ok, data }) => {
      if (!ok) return this.setState({ busy: false, error: errorMessage(data, t('wx.postponeFailed')) });
      toast.success(data.told ? t('wx.postponedTold', { count: data.told }) : t('wx.postponed'));
      if (this.props.onDone) this.props.onDone(data.post);
      return null;
    }).catch(() => this.setState({ busy: false, error: t('common.networkShort') }));
  }

  render() {
    const { byDays, busy, error } = this.state;
    return (
      <Dialog id="postpone-dialog" title={t('wx.postponeTitle')} description={t('wx.postponeDesc')} onClose={() => !busy && this.props.onClose()}>
        <form onSubmit={(e) => this.submit(e)} noValidate>
          <fieldset className="field postpone-choices">
            <legend className="field-label">{t('wx.moveBy')}</legend>
            {CHOICES.map((n) => (
              <label key={n} className="checkbox-row" htmlFor={'postpone-' + n}>
                <input id={'postpone-' + n} type="radio" name="postpone-by" checked={byDays === n} onChange={() => this.setState({ byDays: n })} />
                <span>{n === 1 ? t('wx.oneDay') : t('wx.oneWeek')}</span>
              </label>
            ))}
          </fieldset>
          <p className="small muted">{t('wx.otherDates')} <Link to={'/post/' + this.props.postId + '/edit'}>{t('wx.editDates')}</Link></p>
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? <Spinner /> : <CalendarClock size={16} aria-hidden="true" />}{t('wx.postponeAction')}</button>
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => this.props.onClose()}>{t('common.cancel')}</button>
          </div>
        </form>
      </Dialog>
    );
  }
}
