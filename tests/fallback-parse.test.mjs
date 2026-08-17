import test from 'node:test';
import assert from 'node:assert/strict';

import * as fallbackParse from '../src/fallback-parse.js';

const { parseAdjacentUsageBlocks } = fallbackParse;

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

test('accepts the current live reset labels as complete blocks', () => {
  const fixtures = [
    ['16% used', 'Resets in 3 hr 49 min', { usedPercent: 16, resetLabel: 'Resets in 3 hr 49 min', spent: null }],
    ['31% used', 'Resets Wed 4:59 PM', { usedPercent: 31, resetLabel: 'Resets Wed 4:59 PM', spent: null }],
    ['$28.19 spent', 'Resets Sep 1', { usedPercent: null, resetLabel: 'Resets Sep 1', spent: 28.19 }],
  ];

  for (const [metricBlock, resetBlock, expected] of fixtures) {
    assert.deepEqual(parseAdjacentUsageBlocks([metricBlock, resetBlock]), expected);
  }
});

test('derives local target expiries for every strict reset-label form retained across refreshes', () => {
  assert.equal(typeof fallbackParse.resetLabelExpiry, 'function');
  const observedAt = new Date(2026, 7, 17, 13, 0, 0);
  const fixtures = [
    ['Resets in 20 minutes', new Date(2026, 7, 17, 13, 20, 0)],
    ['Resets in 3 hr 49 min', new Date(2026, 7, 17, 16, 49, 0)],
    ['Resets at 4:59 PM', new Date(2026, 7, 17, 16, 59, 0)],
    ['Resets Wed 4:59 PM', new Date(2026, 7, 19, 16, 59, 0)],
    ['Resets on Wednesday at 4:59 PM', new Date(2026, 7, 19, 16, 59, 0)],
    ['Resets Sep 1', new Date(2026, 8, 1, 0, 0, 0)],
    ['Resets on September 1, 2026 at 4:59 PM', new Date(2026, 8, 1, 16, 59, 0)],
  ];

  for (const [label, expected] of fixtures) {
    assert.equal(fallbackParse.resetLabelExpiry(label, observedAt), expected.toISOString());
  }
});

test('does not derive an expiry by rolling an invalid calendar target into a later date', () => {
  assert.equal(typeof fallbackParse.resetLabelExpiry, 'function');
  const observedAt = new Date(2024, 2, 1, 13, 0, 0);

  assert.equal(fallbackParse.resetLabelExpiry('Resets Feb 29', observedAt), null);
  assert.equal(fallbackParse.resetLabelExpiry('Resets on February 30, 2026', observedAt), null);
});

test('selects the smallest session ancestor layer containing a metric', () => {
  assert.equal(typeof fallbackParse.selectNearestUsageMetric, 'function');
  const metric = fallbackParse.selectNearestUsageMetric([
    ['Current session'],
    ['Current session'],
    ['Current session', '16% used', 'Resets in 3 hr 49 min'],
    ['Unrelated surrounding text', '99% used', 'Resets in 1 hour'],
  ]);

  assert.deepEqual(metric, { usedPercent: 16, resetLabel: 'Resets in 3 hr 49 min', spent: null });
});

test('selects the smallest all-models ancestor layer containing a metric', () => {
  assert.equal(typeof fallbackParse.selectNearestUsageMetric, 'function');
  const metric = fallbackParse.selectNearestUsageMetric([
    ['All models'],
    ['All models'],
    ['All models', '31% used', 'Resets Wed 4:59 PM'],
    ['Private surrounding text', '84% used', 'Resets in 2 hours'],
  ]);

  assert.deepEqual(metric, { usedPercent: 31, resetLabel: 'Resets Wed 4:59 PM', spent: null });
});

test('selects the smallest credits ancestor layer and returns only parsed primitives', () => {
  assert.equal(typeof fallbackParse.selectNearestUsageMetric, 'function');
  const metric = fallbackParse.selectNearestUsageMetric([
    ['Usage credits'],
    ['Usage credits'],
    ['Usage credits', '$28.19 spent', 'Resets Sep 1', '56% used'],
    ['Conversation text that must never be returned', '$99 spent'],
  ]);

  assert.deepEqual(metric, { usedPercent: 56, resetLabel: 'Resets Sep 1', spent: 28.19 });
});

test('does not inspect an ancestor layer beyond the six-layer privacy bound', () => {
  assert.equal(typeof fallbackParse.selectNearestUsageMetric, 'function');
  const metric = fallbackParse.selectNearestUsageMetric([
    ['Current session'],
    ['Current session'],
    ['Current session'],
    ['Current session'],
    ['Current session'],
    ['Current session'],
    ['100% used', 'Resets in 1 hour'],
  ]);

  assert.equal(metric, null);
});
