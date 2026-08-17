import test from 'node:test';
import assert from 'node:assert/strict';

import { collectClaudeUsage } from '../src/collector/claude-client.js';

const NOW = new Date('2026-08-17T18:00:00.000Z');
const REQUEST_OPTIONS = {
  credentials: 'include',
  headers: { Accept: 'application/json' },
};

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (name.toLowerCase() === 'content-type' ? 'application/json; charset=utf-8' : null) },
    json: async () => body,
  };
}

function textResponse(status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'text/html' },
    json: async () => {
      throw new Error('must not parse a non-JSON response');
    },
  };
}

function queuedFetch(...responses) {
  const calls = [];
  return {
    calls,
    fetch: async (...args) => {
      calls.push(args);
      const next = responses.shift();
      if (next instanceof Error) throw next;
      if (!next) throw new Error('No queued response');
      return next;
    },
  };
}

function assertSafeState(state) {
  const serialized = JSON.stringify(state).toLowerCase();
  for (const forbidden of ['raw-response', 'cookie', 'authorization', 'do-not-retain']) {
    assert.equal(serialized.includes(forbidden), false, `state must not expose ${forbidden}`);
  }

  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    for (const [key, nested] of Object.entries(value)) {
      assert.equal(/raw|cookie|authorization/i.test(key), false, `state must not expose ${key}`);
      visit(nested);
    }
  };
  visit(state);
}

test('collects usage through the first valid organization with session credentials', async () => {
  const stub = queuedFetch(
    jsonResponse([{ uuid: 'team/alpha', cookie: 'do-not-retain' }]),
    jsonResponse({
      authorization: 'do-not-retain',
      rawResponse: 'do-not-retain',
      five_hour: { utilization: 45 },
      seven_day: { utilization: 27 },
    }),
  );

  const state = await collectClaudeUsage(stub.fetch, NOW);

  assert.equal(state.status, 'ready');
  assert.equal(state.source, 'api');
  assert.equal(state.items.session.remainingPercent, 55);
  assert.equal(state.items.weekly.remainingPercent, 73);
  assert.deepEqual(stub.calls, [
    ['https://claude.ai/api/organizations', REQUEST_OPTIONS],
    ['https://claude.ai/api/organizations/team%2Falpha/usage', REQUEST_OPTIONS],
  ]);
  assertSafeState(state);
});

test('maps organization authorization failures to signed out without exposing response data', async () => {
  const stub = queuedFetch(jsonResponse({ detail: 'private' }, 401));

  const state = await collectClaudeUsage(stub.fetch, NOW);

  assert.equal(state.status, 'signed-out');
  assert.equal(state.diagnostic, 'SIGNED_OUT');
  assert.equal(stub.calls.length, 1);
  assertSafeState(state);
});

test('maps usage authorization failures to signed out', async () => {
  const stub = queuedFetch(jsonResponse([{ id: 'org-123' }]), jsonResponse({}, 403));

  const state = await collectClaudeUsage(stub.fetch, NOW);

  assert.equal(state.status, 'signed-out');
  assert.equal(state.diagnostic, 'SIGNED_OUT');
  assertSafeState(state);
});

test('maps successful non-JSON responses to unsupported without parsing the body', async () => {
  const stub = queuedFetch(textResponse());

  const state = await collectClaudeUsage(stub.fetch, NOW);

  assert.equal(state.status, 'unsupported');
  assert.equal(state.diagnostic, 'NON_JSON_RESPONSE');
  assertSafeState(state);
});

test('maps non-auth HTTP failures to network error', async () => {
  const stub = queuedFetch(jsonResponse({ message: 'server error' }, 500));

  const state = await collectClaudeUsage(stub.fetch, NOW);

  assert.equal(state.status, 'network-error');
  assert.equal(state.diagnostic, 'HTTP_FAILURE');
  assertSafeState(state);
});

test('maps thrown fetch failures to a network diagnostic', async () => {
  const stub = queuedFetch(new Error('offline'));

  const state = await collectClaudeUsage(stub.fetch, NOW);

  assert.equal(state.status, 'network-error');
  assert.equal(state.diagnostic, 'NETWORK_FAILURE');
  assertSafeState(state);
});
