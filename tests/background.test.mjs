import test from 'node:test';
import assert from 'node:assert/strict';

import * as background from '../src/background.js';
import { makeEmptyState } from '../src/shared/model.js';

const { createBackgroundController, fallbackState, registerBackground } = background;

function makeChrome(initialState = null) {
  const stored = { usageState: initialState };
  const badge = { texts: [], colors: [] };
  return {
    stored,
    badge,
    storage: {
      local: {
        get: async (key) => ({ [key]: stored[key] }),
        set: async (values) => Object.assign(stored, values),
      },
    },
    action: {
      setBadgeText: async (value) => badge.texts.push(value),
      setBadgeBackgroundColor: async (value) => badge.colors.push(value),
    },
  };
}

function makeReadyCreditsState(collectedAt, { usedPercent = 56, spent = 28.19, limit = 50 } = {}) {
  const state = makeEmptyState('ready', null, collectedAt);
  state.source = 'api';
  state.items.session = {
    id: 'session',
    label: 'Current session',
    usedPercent: 45,
    remainingPercent: 55,
    resetsAt: null,
    resetLabel: null,
  };
  state.items.weekly = {
    id: 'weekly',
    label: 'Weekly limits',
    usedPercent: 27,
    remainingPercent: 73,
    resetsAt: null,
    resetLabel: null,
  };
  state.credits = {
    usedPercent,
    remainingPercent: 100 - usedPercent,
    spent,
    limit,
    currency: 'USD',
    resetsAt: null,
    resetLabel: null,
  };
  return state;
}

test('selects normalized All models data when weekly has no usable percentage', () => {
  const state = fallbackState({
    session: { usedPercent: 45, resetLabel: 'Resets in 2 hours' },
    weekly: { resetLabel: 'Resets in 3 days' },
    allModels: { usedPercent: 23, resetLabel: 'Resets in 3 days' },
  }, new Date('2026-08-17T18:00:00.000Z'));

  assert.equal(state.items.weekly.usedPercent, 23);
  assert.equal(state.items.weekly.resetLabel, 'Resets in 3 days');
});

test('revalidates fallback reset labels before persistence', () => {
  const state = fallbackState({
    session: { usedPercent: 45, resetLabel: 'Resets in 2 hours unrelated page text' },
  }, new Date('2026-08-17T18:00:00.000Z'));

  assert.equal(state.items.session.resetLabel, null);
});

test('purely enriches only missing API reset fields from normalized page data', () => {
  const api = makeEmptyState('ready', 'API_DIAGNOSTIC', new Date('2026-08-17T18:00:00.000Z'));
  api.source = 'api';
  api.items.session = {
    id: 'session',
    label: 'Current session',
    usedPercent: 45,
    remainingPercent: 55,
    resetsAt: '2026-08-17T19:00:00Z',
    resetLabel: 'Resets in 1 hour',
  };
  api.credits = {
    usedPercent: 56,
    remainingPercent: 44,
    spent: 28.19,
    limit: 50,
    currency: 'USD',
    resetsAt: null,
    resetLabel: null,
  };
  const original = structuredClone(api);
  const page = fallbackState(
    {
      session: { usedPercent: 99, resetLabel: 'Resets in 2 hours' },
      credits: { usedPercent: 99, spent: 99, resetLabel: 'Resets Sep 1' },
    },
    new Date('2026-08-17T18:05:00.000Z'),
  );

  assert.equal(typeof background.enrichApiStateWithPageFallback, 'function');
  const enriched = background.enrichApiStateWithPageFallback(api, page);

  assert.deepEqual(api, original);
  assert.deepEqual(enriched, {
    ...original,
    credits: { ...original.credits, resetLabel: 'Resets Sep 1' },
  });
});

test('does not overwrite a non-null API reset timestamp or label with page reset data', () => {
  const api = makeEmptyState('partial', null, new Date('2026-08-17T18:00:00.000Z'));
  api.source = 'api';
  api.credits = {
    usedPercent: 56,
    remainingPercent: 44,
    spent: 28.19,
    limit: 50,
    currency: 'USD',
    resetsAt: '2026-09-01T00:00:00Z',
    resetLabel: 'API reset',
  };
  const page = fallbackState(
    { credits: { usedPercent: 99, spent: 99, resetLabel: 'Resets Sep 2' } },
    new Date('2026-08-17T18:05:00.000Z'),
  );

  assert.equal(typeof background.enrichApiStateWithPageFallback, 'function');
  assert.deepEqual(background.enrichApiStateWithPageFallback(api, page), api);
});

test('persists and returns API credits enriched with a page reset label through the badge commit path', async () => {
  const live = makeEmptyState('ready', 'API_DIAGNOSTIC', new Date('2026-08-17T18:00:00.000Z'));
  live.source = 'api';
  live.items.session = {
    id: 'session',
    label: 'Current session',
    usedPercent: 45,
    remainingPercent: 55,
    resetsAt: null,
    resetLabel: null,
  };
  live.items.weekly = {
    id: 'weekly',
    label: 'Weekly limits',
    usedPercent: 27,
    remainingPercent: 73,
    resetsAt: null,
    resetLabel: null,
  };
  live.credits = {
    usedPercent: 56,
    remainingPercent: 44,
    spent: 28.19,
    limit: 50,
    currency: 'USD',
    resetsAt: null,
    resetLabel: null,
  };
  const chromeApi = makeChrome(live);
  const controller = createBackgroundController({ chromeApi, collectUsage: async () => live });

  const result = await controller.applyPageFallback({
    credits: { usedPercent: 99, spent: 99, resetLabel: 'Resets Sep 1' },
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.state, chromeApi.stored.usageState);
  assert.deepEqual(chromeApi.stored.usageState, {
    ...live,
    credits: { ...live.credits, resetLabel: 'Resets Sep 1' },
  });
  assert.deepEqual(chromeApi.badge.texts.at(-1), { text: '55' });
  assert.equal(chromeApi.badge.colors.length, chromeApi.badge.texts.length);
});

test('reapplies a persisted page reset after restart while each successful refresh keeps API usage authoritative', async () => {
  const observedAt = new Date(2026, 7, 17, 13, 0, 0);
  let apiState = makeReadyCreditsState(observedAt);
  const chromeApi = makeChrome();
  const firstController = createBackgroundController({
    chromeApi,
    now: () => observedAt,
    collectUsage: async () => structuredClone(apiState),
  });

  await firstController.applyPageFallback({
    credits: { usedPercent: 99, spent: 99, resetLabel: 'Resets Sep 1' },
  });

  apiState = makeReadyCreditsState(observedAt, { usedPercent: 58, spent: 29.25, limit: 50 });
  const restartedController = createBackgroundController({
    chromeApi,
    now: () => observedAt,
    collectUsage: async () => structuredClone(apiState),
  });
  const refreshed = await restartedController.refreshUsage();

  assert.equal(refreshed.source, 'api');
  assert.deepEqual(refreshed.credits, {
    usedPercent: 58,
    remainingPercent: 42,
    spent: 29.25,
    limit: 50,
    currency: 'USD',
    resetsAt: null,
    resetLabel: 'Resets Sep 1',
  });
  assert.deepEqual(chromeApi.stored.usageState, refreshed);
});

test('persists only reset fields with page provenance and expires them at the represented reset', async () => {
  let currentTime = new Date(2026, 7, 17, 13, 0, 0);
  let apiState = makeReadyCreditsState(currentTime);
  const chromeApi = makeChrome();
  const controller = createBackgroundController({
    chromeApi,
    now: () => currentTime,
    collectUsage: async () => structuredClone(apiState),
  });

  await controller.applyPageFallback({
    credits: { usedPercent: 99, spent: 99, resetLabel: 'Resets Sep 1' },
  });

  assert.deepEqual(chromeApi.stored.pageResetFallback, {
    version: 1,
    source: 'page',
    collectedAt: currentTime.toISOString(),
    items: { session: null, weekly: null },
    credits: {
      resetsAt: null,
      resetLabel: 'Resets Sep 1',
      expiresAt: new Date(2026, 8, 1, 0, 0, 0).toISOString(),
    },
  });

  currentTime = new Date(2026, 8, 1, 0, 0, 1);
  apiState = makeReadyCreditsState(currentTime, { usedPercent: 58, spent: 29.25, limit: 50 });
  const restartedController = createBackgroundController({
    chromeApi,
    now: () => currentTime,
    collectUsage: async () => structuredClone(apiState),
  });
  const refreshed = await restartedController.refreshUsage();

  assert.equal(refreshed.credits.resetLabel, null);
  assert.equal(chromeApi.stored.pageResetFallback, null);
});

test('does not restore a page reset that expires while fallback waits for the API refresh', async () => {
  let currentTime = new Date(2026, 7, 17, 13, 0, 0);
  let resolveCollection;
  const collection = new Promise((resolve) => {
    resolveCollection = resolve;
  });
  const chromeApi = makeChrome();
  const controller = createBackgroundController({
    chromeApi,
    now: () => currentTime,
    collectUsage: () => collection,
  });

  const application = controller.applyPageFallback({
    credits: { usedPercent: 99, spent: 99, resetLabel: 'Resets in 1 minute' },
  });
  await new Promise((resolve) => setImmediate(resolve));
  currentTime = new Date(2026, 7, 17, 13, 2, 0);
  resolveCollection(makeReadyCreditsState(currentTime, { usedPercent: 58, spent: 29.25, limit: 50 }));

  const result = await application;

  assert.equal(result.ok, false);
  assert.deepEqual(result.state.credits, {
    usedPercent: 58,
    remainingPercent: 42,
    spent: 29.25,
    limit: 50,
    currency: 'USD',
    resetsAt: null,
    resetLabel: null,
  });
  assert.deepEqual(chromeApi.stored.usageState, result.state);
  assert.equal(chromeApi.stored.pageResetFallback, null);
});

test('removes an expired page reset from stale API data when the next refresh fails', async () => {
  let currentTime = new Date(2026, 7, 17, 13, 0, 0);
  const chromeApi = makeChrome();
  const controller = createBackgroundController({
    chromeApi,
    now: () => currentTime,
    collectUsage: async () => makeReadyCreditsState(currentTime),
  });

  await controller.applyPageFallback({
    credits: { usedPercent: 99, spent: 99, resetLabel: 'Resets Sep 1' },
  });

  currentTime = new Date(2026, 8, 1, 0, 0, 1);
  const unavailable = makeEmptyState('network-error', 'NETWORK_FAILURE', currentTime);
  const restartedController = createBackgroundController({
    chromeApi,
    now: () => currentTime,
    collectUsage: async () => unavailable,
  });
  const refreshed = await restartedController.refreshUsage();

  assert.equal(refreshed.stale, true);
  assert.equal(refreshed.credits.resetLabel, null);
  assert.equal(chromeApi.stored.pageResetFallback, null);
});

test('rejects persisted reset fallbacks without safe page provenance or strict reset fields', async () => {
  const currentTime = new Date(2026, 7, 17, 13, 0, 0);
  const expiresAt = new Date(2026, 8, 1, 0, 0, 0).toISOString();
  const unsafeFallbacks = [
    {
      version: 1,
      source: 'api',
      collectedAt: currentTime.toISOString(),
      items: { session: null, weekly: null },
      credits: { resetsAt: null, resetLabel: 'Resets Sep 1', expiresAt },
    },
    {
      version: 1,
      source: 'page',
      collectedAt: currentTime.toISOString(),
      items: { session: null, weekly: null },
      credits: { resetsAt: null, resetLabel: 'Resets Sep 1 private account text', expiresAt },
    },
  ];

  for (const unsafeFallback of unsafeFallbacks) {
    const chromeApi = makeChrome();
    chromeApi.stored.pageResetFallback = unsafeFallback;
    const controller = createBackgroundController({
      chromeApi,
      now: () => currentTime,
      collectUsage: async () => makeReadyCreditsState(currentTime),
    });

    const refreshed = await controller.refreshUsage();

    assert.equal(refreshed.credits.resetLabel, null);
    assert.equal(chromeApi.stored.pageResetFallback, null);
  }
});

test('deduplicates concurrent API refreshes and does not let a fallback overwrite live API data', async () => {
  const chromeApi = makeChrome();
  let collectCalls = 0;
  let resolveCollection;
  const controller = createBackgroundController({
    chromeApi,
    collectUsage: () => {
      collectCalls += 1;
      return new Promise((resolve) => {
        resolveCollection = resolve;
      });
    },
  });
  const live = makeEmptyState('ready', null, new Date('2026-08-17T18:00:00.000Z'));
  live.source = 'api';
  live.items.session = { id: 'session', label: 'Current session', usedPercent: 45, remainingPercent: 55, resetsAt: null, resetLabel: null };

  const first = controller.refreshUsage();
  const second = controller.refreshUsage();
  const fallback = controller.applyPageFallback({ session: { usedPercent: 10, resetLabel: 'Resets in 1 hour' } });
  assert.equal(collectCalls, 1);

  resolveCollection(live);
  await Promise.all([first, second, fallback]);

  assert.equal(chromeApi.stored.usageState.source, 'api');
  assert.equal(chromeApi.stored.usageState.items.session.usedPercent, 45);
});

test('applies a page fallback after an unavailable API refresh commits', async () => {
  const chromeApi = makeChrome();
  const unavailable = makeEmptyState('unsupported', 'USAGE_SHAPE_UNRECOGNIZED', new Date('2026-08-17T18:00:00.000Z'));
  const controller = createBackgroundController({ chromeApi, collectUsage: async () => unavailable });

  const refresh = controller.refreshUsage();
  const fallback = controller.applyPageFallback({ session: { usedPercent: 10, resetLabel: 'Resets in 1 hour' } });
  await Promise.all([refresh, fallback]);

  assert.equal(chromeApi.stored.usageState.source, 'page');
  assert.equal(chromeApi.stored.usageState.items.session.usedPercent, 10);
});

test('does not replace an already available API result with page fallback data', async () => {
  const live = makeEmptyState('ready', null, new Date('2026-08-17T18:00:00.000Z'));
  live.source = 'api';
  live.items.session = { id: 'session', label: 'Current session', usedPercent: 45, remainingPercent: 55, resetsAt: null, resetLabel: null };
  const chromeApi = makeChrome(live);
  const controller = createBackgroundController({ chromeApi, collectUsage: async () => live });

  const result = await controller.applyPageFallback({ session: { usedPercent: 10, resetLabel: 'Resets in 1 hour' } });

  assert.equal(result.ok, false);
  assert.equal(chromeApi.stored.usageState.source, 'api');
  assert.equal(chromeApi.stored.usageState.items.session.usedPercent, 45);
});

test('starts an API refresh before applying fallback when no refresh is in flight', async () => {
  const chromeApi = makeChrome();
  let calls = 0;
  const unavailable = makeEmptyState('unsupported', 'USAGE_SHAPE_UNRECOGNIZED', new Date('2026-08-17T18:00:00.000Z'));
  const controller = createBackgroundController({
    chromeApi,
    collectUsage: async () => {
      calls += 1;
      return unavailable;
    },
  });

  const result = await controller.applyPageFallback({ session: { usedPercent: 10, resetLabel: 'Resets in 1 hour' } });

  assert.equal(calls, 1);
  assert.equal(result.ok, true);
  assert.equal(chromeApi.stored.usageState.source, 'page');
});

test('keeps a fresh API result when fallback starts the API refresh', async () => {
  const chromeApi = makeChrome();
  const live = makeEmptyState('partial', null, new Date('2026-08-17T18:00:00.000Z'));
  live.source = 'api';
  live.items.session = { id: 'session', label: 'Current session', usedPercent: 45, remainingPercent: 55, resetsAt: null, resetLabel: null };
  const controller = createBackgroundController({ chromeApi, collectUsage: async () => live });

  const result = await controller.applyPageFallback({ session: { usedPercent: 10, resetLabel: 'Resets in 1 hour' } });

  assert.equal(result.ok, false);
  assert.equal(result.state.source, 'api');
  assert.equal(chromeApi.stored.usageState.items.session.usedPercent, 45);
});

test('keeps a stored ready API result when the fallback-triggered refresh is unavailable', async () => {
  const cached = makeEmptyState('ready', null, new Date('2026-08-17T18:00:00.000Z'));
  cached.source = 'api';
  cached.items.session = { id: 'session', label: 'Current session', usedPercent: 45, remainingPercent: 55, resetsAt: null, resetLabel: null };
  const chromeApi = makeChrome(cached);
  const unavailable = makeEmptyState('unsupported', 'USAGE_SHAPE_UNRECOGNIZED', new Date('2026-08-17T18:01:00.000Z'));
  const controller = createBackgroundController({ chromeApi, collectUsage: async () => unavailable });

  const result = await controller.applyPageFallback({ session: { usedPercent: 10, resetLabel: 'Resets in 1 hour' } });

  assert.equal(result.ok, false);
  assert.equal(chromeApi.stored.usageState.source, 'api');
  assert.equal(chromeApi.stored.usageState.items.session.usedPercent, 45);
});

test('contains rejected install work inside the registered event handler', async () => {
  const installed = [];
  const chromeApi = {
    alarms: { create: () => {}, onAlarm: { addListener: () => {} } },
    runtime: {
      onInstalled: { addListener: (listener) => installed.push(listener) },
      onStartup: { addListener: () => {} },
      onMessage: { addListener: () => {} },
    },
    storage: { local: { get: async () => { throw new Error('storage unavailable'); }, set: async () => {} } },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
  };

  registerBackground(chromeApi, async () => makeEmptyState('ready', null, new Date()));
  assert.doesNotThrow(() => installed[0]());
  await new Promise((resolve) => setImmediate(resolve));
});
