import test from 'node:test';
import assert from 'node:assert/strict';

import { resetText } from '../popup/format.js';

test('uses the reset label when the timestamp is null', () => {
  assert.equal(resetText({ resetsAt: null, resetLabel: 'Resets in 20 minutes' }), 'Resets in 20 minutes');
});

test('formats a valid reset timestamp with Intl formatting', () => {
  assert.equal(
    resetText({ resetsAt: '2026-08-17T18:00:00.000Z', resetLabel: 'ignored' }, 'en-US', 'UTC'),
    'Resets Monday, Aug 17, 6:00 PM',
  );
});
