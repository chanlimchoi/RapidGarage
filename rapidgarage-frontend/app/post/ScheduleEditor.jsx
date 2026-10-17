import React from 'react';
import { CalendarPlus, Trash2, AlertCircle } from 'lucide-react';
import { MAX_DAYS, addDays, nextSaturday, zoneNote } from '../lib/schedule';

// Day-by-day sale times. Controlled: days = [{ date, start, end }].
export default function ScheduleEditor({ days, timeZone, errors, shownFor, onChange, onBlurRow, disabled }) {
  const set = (i, patch) => onChange(days.map((d, j) => (j === i ? Object.assign({}, d, patch) : d)));
  const remove = (i) => onChange(days.filter((_, j) => j !== i));
  const add = () => {
    const last = days[days.length - 1];
    const date = last && last.date ? addDays(last.date, 1) : nextSaturday();
    onChange(days.concat({ date, start: last ? last.start : '08:00', end: last ? last.end : '14:00' }));
  };
  const zone = zoneNote({ schedule: { timeZone } }) || ('Times are in your time zone (' + (timeZone || '').replace(/_/g, ' ') + ').');
  return (
    <fieldset className="schedule-fieldset" aria-describedby="schedule-hint">
      <legend className="field-label">When <span className="optional"> (optional)</span></legend>
      {days.length ? (
        <ol className="schedule-rows">
          {days.map((d, i) => {
            const err = shownFor('days.' + i) ? errors['days.' + i] : '';
            const errId = 'day-' + i + '-error';
            const aria = { 'aria-invalid': err ? 'true' : undefined, 'aria-describedby': err ? errId : undefined };
            return (
              <li key={i} className="schedule-row" onBlur={() => onBlurRow(i)}>
                <div className="field">
                  <label className="field-label" htmlFor={'day-' + i + '-date'}>Day {i + 1}</label>
                  <input className="input" type="date" id={'day-' + i + '-date'} name={'days.' + i} value={d.date} disabled={disabled}
                    onChange={(e) => set(i, { date: e.target.value })} {...aria} />
                </div>
                <div className="field">
                  <label className="field-label" htmlFor={'day-' + i + '-start'}>Starts</label>
                  <input className="input" type="time" id={'day-' + i + '-start'} value={d.start} step={900} disabled={disabled}
                    onChange={(e) => set(i, { start: e.target.value })} {...aria} />
                </div>
                <div className="field">
                  <label className="field-label" htmlFor={'day-' + i + '-end'}>Ends</label>
                  <input className="input" type="time" id={'day-' + i + '-end'} value={d.end} step={900} disabled={disabled}
                    onChange={(e) => set(i, { end: e.target.value })} {...aria} />
                </div>
                <button type="button" className="btn btn-ghost btn-icon schedule-remove" onClick={() => remove(i)} disabled={disabled}
                  aria-label={'Remove day ' + (i + 1)}><Trash2 size={16} aria-hidden="true" /></button>
                {err ? <span className="field-error schedule-row-error" id={errId}><AlertCircle size={14} aria-hidden="true" />{err}</span> : null}
              </li>
            );
          })}
        </ol>
      ) : <p className="small muted schedule-empty">No dates yet. Buyers see "Dates not set" and the sale never ends on its own.</p>}
      <div className="row">
        <button type="button" className="btn btn-secondary btn-sm" onClick={add} disabled={disabled || days.length >= MAX_DAYS}>
          <CalendarPlus size={16} aria-hidden="true" />{days.length ? 'Add another day' : 'Add a day'}
        </button>
      </div>
      {shownFor('schedule') && errors.schedule ? <span className="field-error" role="alert"><AlertCircle size={14} aria-hidden="true" />{errors.schedule}</span> : null}
      {errors.timeZone ? <span className="field-error" role="alert"><AlertCircle size={14} aria-hidden="true" />{errors.timeZone}</span> : null}
      <span className="field-hint" id="schedule-hint">{zone} The sale drops out of search, the map and alerts after its last day ends.</span>
    </fieldset>
  );
}
