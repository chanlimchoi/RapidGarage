// node --test: "Free on the curb" helpers (mirror of the server's rules).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { liveOffer, itemFree, freeItems, pickupChoices, pickChoice, timeLeft, validateCurb, curbBody, offerable, markList, NOTE_MAX } from '../app/lib/curbside.js';

const NOW = new Date(2026, 9, 17, 13, 0, 0); // local 1:00 pm
const H = 3600 * 1000;

describe('which things are free right now', () => {
  const items = [{ id: 1, curbside: true }, { id: 2, curbside: true, curbsideGone: true }, { id: 3 }, { id: 4, curbside: true, sold: true }];
  test('only a live offer counts; paused, expired, gone and off do not', () => {
    for (const state of ['paused', 'expired', 'gone', 'off']) assert.equal(liveOffer({ curbside: { state } }), null);
    assert.equal(liveOffer({ curbside: null }), null);
    assert.equal(liveOffer({}), null);
    assert.equal(liveOffer({ curbside: { state: 'active' } }).state, 'active');
  });
  test('a partial offer frees only its untaken, unsold items', () => {
    const post = { curbside: { state: 'active', all: false }, items };
    assert.deepEqual(freeItems(post).map((i) => i.id), [1]);
  });
  test('a whole-sale offer frees every unsold item', () => {
    const post = { curbside: { state: 'active', all: true }, items };
    assert.deepEqual(freeItems(post).map((i) => i.id), [1, 2, 3]);
    assert.equal(itemFree({ curbside: { state: 'paused', all: true } }, items[2]), false);
  });
});

describe('pickup-until choices', () => {
  const cs = { defaultUntil: new Date(2026, 9, 17, 23, 59).toISOString(), maxUntil: new Date(NOW.getTime() + 72 * H).toISOString() };
  test('end of day (default), +2h, +4h, tomorrow noon, 72h max, in order', () => {
    const c = pickupChoices(cs, NOW);
    assert.deepEqual(c.map((x) => x.kind), ['hours', 'hours', 'endOfDay', 'tomorrowNoon', 'max']);
    assert.equal(pickChoice(c, null), cs.defaultUntil.replace(/\.\d+Z$/, '.000Z'));
  });
  test('never past maxUntil, never sooner than 15 minutes, no near-duplicates', () => {
    const late = new Date(2026, 9, 17, 22, 30);
    const c = pickupChoices({ defaultUntil: new Date(2026, 9, 17, 23, 59).toISOString(), maxUntil: new Date(late.getTime() + 3 * H).toISOString() }, late);
    c.forEach((x) => assert.ok(new Date(x.value) <= new Date(late.getTime() + 3 * H)));
    // +4h and tomorrow noon don't fit before the 3h cap; "max" is the cap itself.
    assert.deepEqual(c.map((x) => x.kind), ['endOfDay', 'hours', 'max']);
    assert.equal(pickupChoices({ maxUntil: new Date(NOW.getTime() + 5 * 60 * 1000).toISOString() }, NOW).length, 0);
  });
  test('editing keeps the offer\'s current time when it is one of the choices', () => {
    const c = pickupChoices(cs, NOW);
    assert.equal(pickChoice(c, c[3].value), c[3].value);
    assert.equal(pickChoice([], null), '');
  });
  test('time left', () => {
    assert.deepEqual(timeLeft(new Date(NOW.getTime() + 2.5 * H), NOW), { hours: 2, minutes: 30 });
    assert.deepEqual(timeLeft(new Date(NOW.getTime() - H), NOW), { hours: 0, minutes: 0 });
  });
});

describe('the seller form', () => {
  test('needs items (unless everything), a time, and a short note', () => {
    assert.deepEqual(validateCurb({ all: false, itemIds: [], until: '' }), { items: 'curb.err.items', until: 'curb.err.until' });
    assert.deepEqual(validateCurb({ all: true, until: 'x', note: 'a'.repeat(NOTE_MAX + 1) }), { note: 'curb.err.note' });
    assert.deepEqual(validateCurb({ all: false, itemIds: [3], until: 'x', note: 'by the gate' }), {});
  });
  test('body: whole sale sends no itemIds; the note is trimmed', () => {
    assert.deepEqual(curbBody({ all: true, itemIds: [1], until: 'u', note: '  gate ' }), { all: true, until: 'u', note: 'gate' });
    assert.deepEqual(curbBody({ all: false, itemIds: [1, 2], until: 'u' }), { all: false, until: 'u', note: '', itemIds: [1, 2] });
  });
  test('sold and held items can\'t go out', () => {
    const items = [{ id: 1 }, { id: 2, sold: true }, { id: 3, reserved: true }, { id: 4, reservedUntil: new Date(NOW.getTime() + H).toISOString() }, { id: 5, reservedUntil: new Date(NOW.getTime() - H).toISOString() }];
    assert.deepEqual(offerable(items, NOW).map((i) => i.id), [1, 5]);
  });
  test('the "taken" log shows who and what, newest first, undone last', () => {
    const cs = { marks: [
      { id: 1, itemId: 7, by: { id: 9, name: 'Tom T.' }, at: '2026-10-17T17:00:00Z', undone: true },
      { id: 2, itemId: 8, by: { id: 4, name: 'Bea B.' }, at: '2026-10-17T16:00:00Z', undone: false },
      { id: 3, itemId: null, by: { id: 5, name: 'Al A.' }, at: '2026-10-17T18:00:00Z', undone: false },
    ] };
    assert.deepEqual(markList(cs, [{ id: 7, name: 'Lamp' }, { id: 8, name: 'Rug' }]).map((m) => [m.who, m.item, m.undone]),
      [['Al A.', null, false], ['Bea B.', 'Rug', false], ['Tom T.', 'Lamp', true]]);
  });
});
