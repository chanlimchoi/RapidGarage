import { describe, test, mock } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { photoAlt, prefersReducedMotion, scrollBehavior } from '../app/lib/a11y.js';
import { wireControl } from '../app/lib/wire.js';
import toast, { subscribe, pause, resume, dismiss } from '../app/components/toast.js';

const tmpl = (v) => `${v.title}, photo ${v.n} of ${v.count}`;
const media = (reduce) => ({ matchMedia: (q) => ({ matches: reduce && /reduce/.test(q) }) });

describe('accessibility helpers', () => {
  test('photo alt: the seller\'s words, else title and position', () => {
    assert.equal(photoAlt({ alt: '  Green couch ' }, 0, 3, 'Moving sale', tmpl), 'Green couch');
    assert.equal(photoAlt({ alt: null }, 1, 3, 'Moving sale', tmpl), 'Moving sale, photo 2 of 3');
    assert.equal(photoAlt({ alt: '   ' }, 2, 3, 'Moving sale', tmpl), 'Moving sale, photo 3 of 3');
    assert.equal(photoAlt(undefined, 0, 1, '', tmpl), ', photo 1 of 1');
  });

  test('reduced motion turns smooth scrolling off', () => {
    assert.equal(prefersReducedMotion(media(true)), true);
    assert.equal(scrollBehavior(media(true)), 'auto');
    assert.equal(scrollBehavior(media(false)), 'smooth');
    assert.equal(prefersReducedMotion({}), false);
    assert.equal(prefersReducedMotion({ matchMedia: () => { throw new Error('old browser'); } }), false);
  });

  test('label wiring reaches the input inside a prefix/suffix wrapper', () => {
    const h = React.createElement;
    const props = { id: 'wanted-radius', 'aria-invalid': 'true', 'aria-describedby': 'wanted-radius-error' };
    const bare = wireControl(h('input', { name: 'q' }), props);
    assert.equal(bare.props.id, 'wanted-radius');
    const wrapped = wireControl(h('div', { className: 'input-suffix' }, h('input', { name: 'radiusMiles' }), h('span', { 'aria-hidden': 'true' }, 'mi')), props);
    assert.equal(wrapped.props.id, undefined, 'the wrapper does not take the id');
    const kids = React.Children.toArray(wrapped.props.children);
    assert.equal(kids[0].props.id, 'wanted-radius');
    assert.equal(kids[0].props['aria-describedby'], 'wanted-radius-error');
    assert.equal(kids[1].props.id, undefined);
    // Components (e.g. PasswordInput) get the props and pass them on themselves.
    const Comp = () => null;
    assert.equal(wireControl(h(Comp, {}), props).props.id, 'wanted-radius');
  });
});

describe('toasts', () => {
  test('pause while hovered or focused, then carry on', () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    try {
      let items = [];
      const off = subscribe((x) => { items = x; });
      toast.success('Saved');
      mock.timers.tick(3000);
      pause();
      mock.timers.tick(60000);
      assert.equal(items.length, 1, 'stays while paused');
      resume();
      mock.timers.tick(1500);
      assert.equal(items.length, 1, 'remaining time continues (2s left)');
      mock.timers.tick(600);
      assert.equal(items.length, 0);
      toast.error('Nope');
      mock.timers.tick(9000);
      assert.equal(items.length, 1, 'errors stay longer');
      dismiss(items[0].id);
      assert.equal(items.length, 0);
      off();
    } finally { mock.timers.reset(); }
  });
});
