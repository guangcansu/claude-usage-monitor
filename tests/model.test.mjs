import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getBadgePresentation,
  makeEmptyState,
  normalizePercent,
  withRefreshFailure,
} from '../src/shared/model.js';

const NOW = new Date('2026-08-17T18:00:00.000Z');

test('normalizePercent accepts only finite percentages in the inclusive range', () => {
  assert.equal(normalizePercent(0), 0);
  assert.equal(normalizePercent(100), 100);
  assert.equal(normalizePercent(45.5), 45.5);
  assert.equal(normalizePercent(Number.NaN), null);
  assert.equal(normalizePercent(Number.POSITIVE_INFINITY), null);
  assert.equal(normalizePercent(Number.NEGATIVE_INFINITY), null);
  assert.equal(normalizePercent(-0.01), null);
  assert.equal(normalizePercent(100.01), null);
  assert.equal(normalizePercent('45'), null);
});

test('makeEmptyState creates a state with no fabricated usage values', () => {
  const state = makeEmptyState('signed-out', 'AUTH_REQUIRED', NOW);

  assert.deepEqual(state, {
    version: 1,
    status: 'signed-out',
    diagnostic: 'AUTH_REQUIRED',
    collectedAt: NOW.toISOString(),
    stale: false,
    source: 'none',
    items: { session: null, weekly: null },
    credits: null,
  });
});

test('withRefreshFailure preserves only ready or partial data and marks it stale', () => {
  const previous = {
    version: 1,
    status: 'ready',
    diagnostic: null,
    collectedAt: '2026-08-17T17:00:00.000Z',
    stale: false,
    source: 'api',
    items: {
      session: {
        id: 'session',
        label: 'Current session',
        usedPercent: 45,
        remainingPercent: 55,
        resetsAt: '2026-08-17T19:00:00Z',
        resetLabel: null,
      },
      weekly: null,
    },
    credits: null,
  };

  const failed = withRefreshFailure(previous, 'network-error', 'NETWORK_FAILURE', NOW);
  assert.equal(failed.status, 'network-error');
  assert.equal(failed.diagnostic, 'NETWORK_FAILURE');
  assert.equal(failed.collectedAt, NOW.toISOString());
  assert.equal(failed.stale, true);
  assert.equal(failed.source, 'api');
  assert.deepEqual(failed.items, previous.items);
  assert.deepEqual(failed.credits, previous.credits);

  const noData = withRefreshFailure(makeEmptyState('loading', null, NOW), 'network-error', 'NETWORK_FAILURE', NOW);
  assert.equal(noData.stale, false);
  assert.equal(noData.items.session, null);
  assert.equal(noData.items.weekly, null);
  assert.equal(noData.credits, null);
});

test('badge shows remaining percentage and applies warning and danger thresholds', () => {
  const state = makeEmptyState('ready', null, NOW);
  state.items.session = {
    id: 'session',
    label: 'Current session',
    usedPercent: 45,
    remainingPercent: 55,
    resetsAt: null,
    resetLabel: null,
  };
  assert.deepEqual(getBadgePresentation(state), { text: '55', color: '#5f5d58' });

  state.items.session.remainingPercent = 19;
  assert.deepEqual(getBadgePresentation(state), { text: '19', color: '#b66a32' });

  state.items.session.remainingPercent = 4;
  assert.deepEqual(getBadgePresentation(state), { text: '4', color: '#b13a35' });
});

test('badge is unsupported or blank for non-live states', () => {
  assert.deepEqual(
    getBadgePresentation(makeEmptyState('unsupported', 'USAGE_SHAPE_UNRECOGNIZED', NOW)),
    { text: '?', color: '#5f5d58' },
  );
  assert.deepEqual(getBadgePresentation(makeEmptyState('signed-out', 'AUTH_REQUIRED', NOW)), {
    text: '',
    color: '#5f5d58',
  });
  assert.deepEqual(getBadgePresentation(makeEmptyState('demo', null, NOW)), {
    text: '',
    color: '#5f5d58',
  });
});
