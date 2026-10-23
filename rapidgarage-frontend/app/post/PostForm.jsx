import React from 'react';
import { Field, Alert, Spinner } from '../components/ui';
import { rules, validateAll, serverFieldErrors, focusFirstError } from '../lib/validate';
import { browserTimeZone, formDays, validateDays } from '../lib/schedule';
import ScheduleEditor from './ScheduleEditor';
import { priceErrors, toPriceNumber, formatPrice } from '../lib/price';
import { PERCENT_CHOICES, markdownBody, markdownValues } from '../lib/markdown';
import { markdownErrors, describe as describeMarkdown } from '../lib/markdownText';
import { MIN_CHOICES as BUNDLE_MINS, PERCENT_CHOICES as BUNDLE_PERCENTS, bundleValues, bundleBody, bundleErrors, describe as describeBundle } from '../lib/bundles';
import { t } from '../i18n';

const SCHEMA = {
  title: rules.title,
  street: rules.required(() => t('form.street')),
  city: rules.required(() => t('form.city')),
  zipCode: rules.zip,
};

// Price rules span three fields, so they run together (lib/price.js mirrors the server).
function validateForm(values) {
  return Object.assign(validateAll(values, SCHEMA), priceErrors(values), markdownErrors(values), values.isFree ? {} : bundleErrors(values), validateDays(values.days));
}

export function initialValues(post) {
  const p = post || {};
  return {
    title: p.title || '', street: p.street || '', city: p.city || '', state: p.state || '', zipCode: p.zipCode || '',
    days: formDays(p), timeZone: (p.schedule && p.schedule.timeZone) || browserTimeZone(), description: p.description || '',
    isFree: !!p.isFree,
    priceMin: p.priceMin === null || p.priceMin === undefined ? '' : String(p.priceMin),
    priceMax: p.priceMax === null || p.priceMax === undefined ? '' : String(p.priceMax),
    ...markdownValues(p),
    ...bundleValues(p),
  };
}

// Body for POST/PUT /post. No days clears the schedule (schedule: null).
export function toBody(v) {
  return {
    title: v.title.trim(), street: v.street.trim(), city: v.city.trim(), state: v.state.trim(), zipCode: v.zipCode.trim(),
    schedule: v.days.length ? { timeZone: v.timeZone, days: v.days.map((d) => ({ date: d.date, start: d.start, end: d.end })) } : null,
    description: v.description,
    isFree: !!v.isFree,
    priceMin: v.isFree ? null : toPriceNumber(v.priceMin),
    priceMax: v.isFree ? null : toPriceNumber(v.priceMax),
    // A free sale has nothing to mark down.
    ...markdownBody(v.isFree ? { markdownPercent: '' } : v),
    // Bundle deal: N+ items, X% off (none on a free sale).
    ...bundleBody(v.isFree ? {} : v),
  };
}

// Shared fields for New post and Edit post with inline validation.
// Errors show after a field is touched (blur) or on submit.
export default class PostForm extends React.Component {
  constructor(props) {
    super(props);
    this.state = { values: initialValues(props.post), touched: {}, submitted: false, serverErrors: {} };
    this.formRef = React.createRef();
    this.submit = this.submit.bind(this);
  }

  // Parent passes field errors from the server (e.g. { zipCode: '…' }).
  setServerErrors(data) {
    const errs = serverFieldErrors(data);
    this.setState({ serverErrors: errs });
    focusFirstError(this.formRef.current, errs);
  }

  // "Write with AI" (AiWritePanel) fills these in; the seller still saves.
  setText(patch) {
    const serverErrors = Object.assign({}, this.state.serverErrors);
    Object.keys(patch).forEach((k) => delete serverErrors[k]);
    this.setState({ values: Object.assign({}, this.state.values, patch), serverErrors });
  }

  errors() {
    const own = validateForm(this.state.values);
    return Object.assign({}, this.state.serverErrors, own);
  }

  shown(name, errors) {
    return (this.state.submitted || this.state.touched[name]) ? errors[name] : '';
  }

  change(name) {
    return (e) => {
      const serverErrors = Object.assign({}, this.state.serverErrors);
      delete serverErrors[name];
      this.setState({ values: Object.assign({}, this.state.values, { [name]: e.target.value }), serverErrors });
    };
  }

  toggleFree(e) {
    const isFree = e.target.checked;
    const serverErrors = Object.assign({}, this.state.serverErrors);
    ['isFree', 'priceMin', 'priceMax'].forEach((k) => delete serverErrors[k]);
    // Ticking Free clears the prices (a sale can't be both).
    const values = Object.assign({}, this.state.values, isFree ? { isFree, priceMin: '', priceMax: '' } : { isFree });
    this.setState({ values, serverErrors });
  }

  changeDays(days) {
    const serverErrors = Object.assign({}, this.state.serverErrors);
    Object.keys(serverErrors).forEach((k) => { if (k === 'schedule' || k === 'timeZone' || k.indexOf('days.') === 0) delete serverErrors[k]; });
    this.setState({ values: Object.assign({}, this.state.values, { days }), serverErrors });
  }

  blur(name) {
    return () => this.setState({ touched: Object.assign({}, this.state.touched, { [name]: true }) });
  }

  submit(e) {
    e.preventDefault();
    if (this.props.textDisabled) { this.props.onSubmit(null); return; }
    const errors = validateForm(this.state.values);
    this.setState({ submitted: true });
    if (Object.keys(errors).length) {
      focusFirstError(this.formRef.current, errors);
      return;
    }
    this.props.onSubmit(toBody(this.state.values));
  }

  input(name, id, extra) {
    return (
      <input className="input" type="text" name={name} value={this.state.values[name]}
        onChange={this.change(name)} onBlur={this.blur(name)} {...(extra || {})} />
    );
  }

  render() {
    const errors = this.errors();
    const v = this.state.values;
    const preview = Object.keys(priceErrors(v)).length ? null
      : formatPrice({ isFree: v.isFree, priceMin: toPriceNumber(v.priceMin), priceMax: toPriceNumber(v.priceMax) });
    const { textDisabled, saving, submitLabel, error, children, footer } = this.props;
    return (
      <form ref={this.formRef} onSubmit={this.submit} noValidate className="stack">
        <section className="card-form">
          <h2 className="h4">{t('post.details')}</h2>
          {textDisabled ? <Alert tone="info">{t('form.textDisabled')}</Alert> : null}
          <fieldset disabled={textDisabled} style={{ border: 0, padding: 0, margin: 0 }} className="form-grid">
            <Field id="title" label={t('form.title')} error={this.shown('title', errors)} hint={t('form.titleHint')}>
              {this.input('title', 'title', { maxLength: 255, autoFocus: this.props.autoFocus, required: true })}
            </Field>
            <Field id="address" label={t('form.street')} error={this.shown('street', errors)}>
              {this.input('street', 'address', { autoComplete: 'street-address', required: true })}
            </Field>
            <div className="form-grid form-grid-3">
              <Field id="city" label={t('form.city')} error={this.shown('city', errors)}>
                {this.input('city', 'city', { autoComplete: 'address-level2', required: true })}
              </Field>
              <Field id="state" label={t('form.state')} optional>
                {this.input('state', 'state', { autoComplete: 'address-level1', maxLength: 32, placeholder: 'NY' })}
              </Field>
              <Field id="zipcode" label={t('form.zip')} error={this.shown('zipCode', errors)}>
                {this.input('zipCode', 'zipcode', { inputMode: 'numeric', autoComplete: 'postal-code', maxLength: 10, placeholder: '10001', required: true })}
              </Field>
            </div>
            <ScheduleEditor days={v.days} timeZone={v.timeZone} errors={errors} disabled={textDisabled}
              shownFor={(k) => this.state.submitted || this.state.touched[k] || !!this.state.serverErrors[k]}
              onChange={(days) => this.changeDays(days)} onBlurRow={(i) => this.blur('days.' + i)()} />
            <fieldset className="price-fieldset" aria-describedby="price-hint">
              <legend className="field-label">{t('form.prices')} <span className="optional"> {t('ui.optional')}</span></legend>
              <label className="checkbox-row" htmlFor="isFree">
                <span className="switch">
                  <input id="isFree" name="isFree" type="checkbox" role="switch" checked={v.isFree} onChange={(e) => this.toggleFree(e)}
                    aria-invalid={this.shown('isFree', errors) ? 'true' : undefined} />
                  <span className="switch-track" aria-hidden="true" />
                </span>
                <span><strong>{t('form.allFree')}</strong></span>
              </label>
              {this.shown('isFree', errors) ? <span className="field-error" id="isFree-error">{errors.isFree}</span> : null}
              <div className="form-grid form-grid-2">
                <Field id="priceMin" label={t('form.lowest')} optional error={this.shown('priceMin', errors)}>
                  {this.input('priceMin', 'priceMin', { inputMode: 'numeric', placeholder: '1', disabled: v.isFree, maxLength: 7 })}
                </Field>
                <Field id="priceMax" label={t('form.highest')} optional error={this.shown('priceMax', errors)}>
                  {this.input('priceMax', 'priceMax', { inputMode: 'numeric', placeholder: '50', disabled: v.isFree, maxLength: 7 })}
                </Field>
              </div>
              <span className="field-hint" id="price-hint">
                {t('form.priceHint')}
                {preview ? <span className="price-preview">{t('form.showsAs')}<span className="chip chip-price">{preview}</span></span> : null}
              </span>
            </fieldset>
            {!v.isFree ? (
              <fieldset className="markdown-fieldset" aria-describedby="markdown-hint">
                <legend className="field-label">{t('md.legend')} <span className="optional"> {t('ui.optional')}</span></legend>
                <div className="form-grid form-grid-2">
                  <Field id="markdownPercent" label={t('md.percent')} error={this.shown('markdownPercent', errors)}>
                    <select className="input" name="markdownPercent" value={v.markdownPercent} onChange={this.change('markdownPercent')} onBlur={this.blur('markdownPercent')}>
                      <option value="">{t('md.none')}</option>
                      {PERCENT_CHOICES.concat(v.markdownPercent && PERCENT_CHOICES.indexOf(Number(v.markdownPercent)) === -1 ? [Number(v.markdownPercent)] : [])
                        .map((p) => <option key={p} value={String(p)}>{t('md.percentOption', { percent: p })}</option>)}
                    </select>
                  </Field>
                  <Field id="markdownFrom" label={t('md.from')} error={this.shown('markdownFrom', errors)}>
                    <input className="input" type="time" name="markdownFrom" step="900" value={v.markdownFrom} disabled={!v.markdownPercent}
                      onChange={this.change('markdownFrom')} onBlur={this.blur('markdownFrom')} />
                  </Field>
                </div>
                <label className="checkbox-row" htmlFor="markdownLastDay">
                  <input id="markdownLastDay" name="markdownLastDay" type="checkbox" checked={v.markdownLastDay} disabled={!v.markdownPercent}
                    onChange={(e) => this.setState({ values: Object.assign({}, this.state.values, { markdownLastDay: e.target.checked }) })} />
                  <span>{t('md.lastDay')}</span>
                </label>
                <span className="field-hint" id="markdown-hint">
                  {v.markdownPercent && v.markdownFrom && !Object.keys(markdownErrors(v)).length
                    ? describeMarkdown({ percent: Number(v.markdownPercent), from: v.markdownFrom, lastDayOnly: v.markdownLastDay })
                    : t('md.hint')}
                </span>
              </fieldset>
            ) : null}
            {!v.isFree ? (
              <fieldset className="markdown-fieldset bundle-fieldset" aria-describedby="bundle-hint">
                <legend className="field-label">{t('bundle.legend')} <span className="optional"> {t('ui.optional')}</span></legend>
                <div className="form-grid form-grid-2">
                  <Field id="bundleMinItems" label={t('bundle.minItems')} error={this.shown('bundleMinItems', errors)}>
                    <select className="input" name="bundleMinItems" value={v.bundleMinItems} onChange={this.change('bundleMinItems')} onBlur={this.blur('bundleMinItems')}>
                      <option value="">{t('bundle.none')}</option>
                      {BUNDLE_MINS.concat(v.bundleMinItems && BUNDLE_MINS.indexOf(Number(v.bundleMinItems)) === -1 ? [Number(v.bundleMinItems)] : [])
                        .map((n) => <option key={n} value={String(n)}>{t('bundle.minOption', { count: n })}</option>)}
                    </select>
                  </Field>
                  <Field id="bundlePercent" label={t('bundle.percent')} error={this.shown('bundlePercent', errors)}>
                    <select className="input" name="bundlePercent" value={v.bundlePercent} onChange={this.change('bundlePercent')} onBlur={this.blur('bundlePercent')}>
                      <option value="">{t('bundle.none')}</option>
                      {BUNDLE_PERCENTS.concat(v.bundlePercent && BUNDLE_PERCENTS.indexOf(Number(v.bundlePercent)) === -1 ? [Number(v.bundlePercent)] : [])
                        .map((p) => <option key={p} value={String(p)}>{t('md.percentOption', { percent: p })}</option>)}
                    </select>
                  </Field>
                </div>
                <span className="field-hint" id="bundle-hint">
                  {v.bundleMinItems && v.bundlePercent ? describeBundle({ minItems: Number(v.bundleMinItems), percent: Number(v.bundlePercent) }) + '. ' : ''}{t('bundle.hint')}
                </span>
              </fieldset>
            ) : null}
            <Field id="description" label={t('form.description')} optional hint={t('form.descriptionHint')}>
              <textarea className="textarea" name="description" rows="6" value={v.description} onChange={this.change('description')} />
            </Field>
          </fieldset>
        </section>
        {this.props.textAddon || null}
        {children}
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {footer || null}
        <div className="form-actions">
          <button type="submit" className="btn btn-primary btn-lg" disabled={saving}>{saving ? <Spinner /> : null}{saving ? t('common.saving') : submitLabel}</button>
          {this.props.cancel || null}
        </div>
      </form>
    );
  }
}
