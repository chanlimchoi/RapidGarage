import React from 'react';
import { Field, Alert, Spinner } from '../components/ui';
import { rules, validateAll, serverFieldErrors, focusFirstError } from '../lib/validate';
import { toLocalInput, fromLocalInput } from '../lib/format';

const SCHEMA = {
  title: rules.title,
  street: rules.required('Street address'),
  city: rules.required('City'),
  zipCode: rules.zip,
  endDate: (v, all) => (v && all.startDate && new Date(v) < new Date(all.startDate) ? 'End must be after the start.' : ''),
};

export function initialValues(post) {
  const p = post || {};
  return {
    title: p.title || '', street: p.street || '', city: p.city || '', state: p.state || '', zipCode: p.zipCode || '',
    startDate: toLocalInput(p.startDate), endDate: toLocalInput(p.endDate), description: p.description || '',
  };
}

// Body for POST/PUT /post. Empty dates are sent as null to clear them.
export function toBody(v) {
  return {
    title: v.title.trim(), street: v.street.trim(), city: v.city.trim(), state: v.state.trim(), zipCode: v.zipCode.trim(),
    startDate: fromLocalInput(v.startDate), endDate: fromLocalInput(v.endDate), description: v.description,
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

  errors() {
    const own = validateAll(this.state.values, SCHEMA);
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

  blur(name) {
    return () => this.setState({ touched: Object.assign({}, this.state.touched, { [name]: true }) });
  }

  submit(e) {
    e.preventDefault();
    if (this.props.textDisabled) { this.props.onSubmit(null); return; }
    const errors = validateAll(this.state.values, SCHEMA);
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
    const { textDisabled, saving, submitLabel, error, children, footer } = this.props;
    return (
      <form ref={this.formRef} onSubmit={this.submit} noValidate className="stack">
        <section className="card-form">
          <h2 className="h4">Sale details</h2>
          {textDisabled ? <Alert tone="info">Only the seller can change the text. As an admin you can manage the photos below.</Alert> : null}
          <fieldset disabled={textDisabled} style={{ border: 0, padding: 0, margin: 0 }} className="form-grid">
            <Field id="title" label="Title" error={this.shown('title', errors)} hint="For example: “Moving sale: furniture, books and kitchenware”">
              {this.input('title', 'title', { maxLength: 255, autoFocus: this.props.autoFocus, required: true })}
            </Field>
            <Field id="address" label="Street address" error={this.shown('street', errors)}>
              {this.input('street', 'address', { autoComplete: 'street-address', required: true })}
            </Field>
            <div className="form-grid form-grid-3">
              <Field id="city" label="City" error={this.shown('city', errors)}>
                {this.input('city', 'city', { autoComplete: 'address-level2', required: true })}
              </Field>
              <Field id="state" label="State" optional>
                {this.input('state', 'state', { autoComplete: 'address-level1', maxLength: 32, placeholder: 'NY' })}
              </Field>
              <Field id="zipcode" label="Zip code" error={this.shown('zipCode', errors)}>
                {this.input('zipCode', 'zipcode', { inputMode: 'numeric', autoComplete: 'postal-code', maxLength: 10, placeholder: '10001', required: true })}
              </Field>
            </div>
            <div className="form-grid form-grid-2">
              <Field id="startDate" label="Starts" optional error={this.shown('startDate', errors)}>
                <input className="input" type="datetime-local" name="startDate" value={v.startDate} onChange={this.change('startDate')} onBlur={this.blur('startDate')} />
              </Field>
              <Field id="endDate" label="Ends" optional error={this.shown('endDate', errors)}>
                <input className="input" type="datetime-local" name="endDate" value={v.endDate} min={v.startDate || undefined} onChange={this.change('endDate')} onBlur={this.blur('endDate')} />
              </Field>
            </div>
            <Field id="description" label="Description" optional hint="What's for sale, payment options, parking, early birds…">
              <textarea className="textarea" name="description" rows="6" value={v.description} onChange={this.change('description')} />
            </Field>
          </fieldset>
        </section>
        {children}
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {footer || null}
        <div className="form-actions">
          <button type="submit" className="btn btn-primary btn-lg" disabled={saving}>{saving ? <Spinner /> : null}{saving ? 'Saving…' : submitLabel}</button>
          {this.props.cancel || null}
        </div>
      </form>
    );
  }
}
