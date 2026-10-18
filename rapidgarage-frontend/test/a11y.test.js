import { describe, test, mock } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { photoAlt, prefersReducedMotion, scrollBehavior, inertOutside } from '../app/lib/a11y.js';
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

// Minimal element stand-in: enough tree + attributes for inertOutside().
function node(tagName, cls, kids) {
  const n = { tagName, className: cls || '', attrs: {}, children: kids || [], parentElement: null,
    setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    hasAttribute(k) { return k in this.attrs; }, removeAttribute(k) { delete this.attrs[k]; },
    matches(sel) { return sel.split(',').some((s) => { s = s.trim(); return s[0] === '.' ? this.className.split(' ').includes(s.slice(1)) : /^\[aria-live\]$/.test(s) ? 'aria-live' in this.attrs : false; }); } };
  n.children.forEach((c) => { c.parentElement = n; });
  return n;
}

describe('inertOutside', () => {
  test('hides everything but the dialog and live regions, then restores', () => {
    const backdrop = node('DIV', 'dialog-backdrop');
    const nav = node('HEADER'); const footer = node('FOOTER'); const toaster = node('SECTION', 'toaster');
    const live = node('DIV', 'sr-only'); live.setAttribute('aria-live', 'polite');
    const already = node('DIV', 'decor'); already.setAttribute('aria-hidden', 'true');
    const panel = node('DIV', 'panel'); const page = node('DIV', 'page', [panel, backdrop]);
    const main = node('MAIN', '', [page]);
    const app = node('DIV', 'app', [nav, main, footer, live, toaster, already]);
    const body = node('BODY', '', [app]);
    assert.ok(body);
    const undo = inertOutside(backdrop);
    for (const n of [panel, nav, footer, already]) { assert.equal(n.getAttribute('inert'), ''); assert.equal(n.getAttribute('aria-hidden'), 'true'); }
    for (const n of [backdrop, page, main, app, toaster, live]) assert.equal(n.hasAttribute('inert'), false);
    undo();
    for (const n of [panel, nav, footer, already]) assert.equal(n.hasAttribute('inert'), false);
    assert.equal(nav.hasAttribute('aria-hidden'), false);
    assert.equal(already.getAttribute('aria-hidden'), 'true', 'keeps an aria-hidden it did not set');
  });

  test('a nested modal does not undo the outer one', () => {
    const inner = node('DIV', 'inner'); const outer = node('DIV', 'outer'); const side = node('ASIDE');
    node('BODY', '', [node('DIV', 'app', [side, outer, inner])]);
    const undoOuter = inertOutside(outer);
    const undoInner = inertOutside(inner);
    undoInner();
    assert.equal(side.getAttribute('inert'), '', 'still inert while the outer modal is open');
    undoOuter();
    assert.equal(side.hasAttribute('inert'), false);
  });
});
