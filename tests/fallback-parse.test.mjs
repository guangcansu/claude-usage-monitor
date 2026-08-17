import test from 'node:test';
import assert from 'node:assert/strict';

import { parseAdjacentUsageBlocks } from '../src/fallback-parse.js';

test('extracts only complete adjacent metric blocks and does not copy unrelated reset text', () => {
  const metric = parseAdjacentUsageBlocks([
    '45% used',
    'Resets in 2 hours',
    'Unrelated conversation text must never be copied',
  ]);

  assert.deepEqual(metric, { usedPercent: 45, resetLabel: 'Resets in 2 hours', spent: null });
});

test('rejects reset text unless the entire visible block matches the reset grammar', () => {
  const metric = parseAdjacentUsageBlocks(['45% used', 'Resets in 2 hours secret account note']);

  assert.deepEqual(metric, { usedPercent: 45, resetLabel: null, spent: null });
});
