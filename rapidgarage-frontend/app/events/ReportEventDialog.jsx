import React from 'react';
import { Flag } from 'lucide-react';
import { errorMessage, reportEvent, REPORT_REASONS, REPORT_NOTE_MAX } from '../api';
import { Alert, Dialog, Field, Spinner } from '../components/ui';
import toast from '../components/toast';
import { t } from '../i18n';

// Same reasons and limits as reporting a sale.
export default class ReportEventDialog extends React.Component {
  constructor(props) {
    super(props);
    this.state = { reason: '', note: '', error: '', busy: false };
  }

  submit(e) {
    e.preventDefault();
    const { reason, note } = this.state;
    if (!reason) { this.setState({ error: t('report.chooseReason') }); return; }
    if (note.length > REPORT_NOTE_MAX) { this.setState({ error: t('report.noteLong', { max: REPORT_NOTE_MAX }) }); return; }
    this.setState({ busy: true, error: '' });
    reportEvent(this.props.event.id, reason, note.trim())
      .then(({ ok, status, data }) => {
        if (ok) { toast.success(t('post.reportThanks')); this.props.onDone(true); return; }
        if (status === 409) { toast.info(t('ev.reportedAlready')); this.props.onDone(true); return; }
        if (status === 429) { toast.error(t('report.tooMany')); this.props.onDone(false); return; }
        this.setState({ busy: false, error: errorMessage(data, t('report.sendFailed')) });
      })
      .catch(() => this.setState({ busy: false, error: t('common.network') }));
  }

  render() {
    const { reason, note, error, busy } = this.state;
    const left = REPORT_NOTE_MAX - note.length;
    return (
      <Dialog id="event-report-dialog" title={t('ev.reportTitle')} onClose={() => !busy && this.props.onDone(false)} description={t('ev.reportDesc')}>
        <form onSubmit={(e) => this.submit(e)} className="stack" noValidate>
          <fieldset className="field report-reasons">
            <legend className="field-label">{t('ev.reportWhy')}</legend>
            {REPORT_REASONS.map((r) => (
              <label key={r.value} className="radio-row">
                <input type="radio" name="event-report-reason" value={r.value} checked={reason === r.value}
                  onChange={() => this.setState({ reason: r.value, error: '' })} />
                <span>{r.label}</span>
              </label>
            ))}
          </fieldset>
          <Field id="event-report-note" label={t('report.details')} optional hint={left >= 0 ? t('common.charsLeft', { count: left }) : t('common.tooLongBy', { n: -left })}>
            <textarea className="textarea" rows={3} value={note} onChange={(e) => this.setState({ note: e.target.value })} placeholder={t('report.notePlaceholder')} />
          </Field>
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => this.props.onDone(false)}>{t('common.cancel')}</button>
            <button type="submit" className="btn btn-danger" disabled={busy}>{busy ? <Spinner /> : <Flag size={16} aria-hidden="true" />}{t('report.send')}</button>
          </div>
        </form>
      </Dialog>
    );
  }
}
