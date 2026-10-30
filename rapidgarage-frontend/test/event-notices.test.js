import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notificationText, notificationLink } from '../app/lib/savedSearch.js';

const n = (kind, data) => ({ kind, post: { id: 9, title: "Sam's toys", seller: { name: 'Sam S.' } }, data: Object.assign({ eventId: 4, eventName: 'Elm Street Block Sale' }, data) });

test('neighborhood-sale notices read naturally and open the event', () => {
  assert.equal(notificationText(n('event_join')), "Sam's toys asked to join Elm Street Block Sale. Approve or decline it on the event page.");
  assert.equal(notificationText(n('event_joined')), "Sam's toys joined Elm Street Block Sale.");
  assert.equal(notificationText(n('event_approved')), "Sam's toys is now part of Elm Street Block Sale.");
  assert.equal(notificationText(n('event_removed', { declined: true })), "The organizer of Elm Street Block Sale declined Sam's toys.");
  assert.equal(notificationText(n('event_removed', { declined: false })), "Sam's toys was removed from Elm Street Block Sale.");
  assert.equal(notificationLink(n('event_join')), '/events/4');
  assert.equal(notificationLink({ kind: 'price_drop', post: { id: 9 } }), '/post/9');
});
