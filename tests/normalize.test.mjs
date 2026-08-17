import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeOrganizations, normalizeUsage } from '../src/collector/normalize.js';

const COLLECTED_AT = new Date('2026-08-17T18:00:00.000Z');

test('normalizes organization arrays using the first allow-listed identifier', () => {
  assert.deepEqual(normalizeOrganizations([{ uuid: 'org-123', name: 'Personal' }]), {
    organizationId: 'org-123',
  });
  assert.deepEqual(normalizeOrganizations({ organizations: [{ id: 'org-123' }] }), {
    organizationId: 'org-123',
  });
});

test('rejects organization shapes without a non-empty uuid or id', () => {
  assert.equal(normalizeOrganizations(null), null);
  assert.equal(normalizeOrganizations({}), null);
  assert.equal(normalizeOrganizations({ organizations: [{ name: 'Personal' }] }), null);
  assert.equal(normalizeOrganizations([{ uuid: '' }, { id: 123 }]), null);
});

test('normalizes session, weekly, and enabled extra usage metrics', () => {
  const state = normalizeUsage(
    {
      five_hour: { utilization: 45, resets_at: '2026-08-17T19:00:00Z' },
      seven_day: { utilization: 27, resets_at: '2026-08-19T22:00:00Z' },
      extra_usage: {
        is_enabled: true,
        utilization: 56,
        used_credits: 28.19,
        monthly_limit: 50,
        currency: 'USD',
        resets_at: '2026-09-01T00:00:00Z',
      },
    },
    COLLECTED_AT,
  );

  assert.equal(state.status, 'ready');
  assert.equal(state.source, 'api');
  assert.equal(state.collectedAt, COLLECTED_AT.toISOString());
  assert.equal(state.items.session.usedPercent, 45);
  assert.equal(state.items.session.remainingPercent, 55);
  assert.equal(state.items.session.resetsAt, '2026-08-17T19:00:00Z');
  assert.equal(state.items.weekly.usedPercent, 27);
  assert.equal(state.items.weekly.remainingPercent, 73);
  assert.equal(state.items.weekly.resetsAt, '2026-08-19T22:00:00Z');
  assert.equal(state.credits.usedPercent, 56);
  assert.equal(state.credits.remainingPercent, 44);
  assert.equal(state.credits.spent, 28.19);
  assert.equal(state.credits.limit, 50);
  assert.equal(state.credits.currency, 'USD');
  assert.equal(state.credits.resetsAt, '2026-09-01T00:00:00Z');
});

test('supports camelCase reset fields and preserves only parseable timestamps', () => {
  const state = normalizeUsage(
    {
      fiveHour: { utilization: 10, resetsAt: '2026-08-17T20:00:00Z', resetLabel: 'in 2 hours' },
      sevenDay: { utilization: 20, resetsAt: 'not-a-date' },
    },
    COLLECTED_AT,
  );

  assert.equal(state.status, 'ready');
  assert.equal(state.items.session.resetsAt, '2026-08-17T20:00:00Z');
  assert.equal(state.items.session.resetLabel, 'in 2 hours');
  assert.equal(state.items.weekly.resetsAt, null);
});

test('malformed fields remain null and produce partial data rather than zeroes', () => {
  const state = normalizeUsage(
    {
      five_hour: { utilization: '45', resets_at: 'invalid' },
      seven_day: { utilization: 27 },
      extra_usage: { is_enabled: true, utilization: 120, used_credits: '28.19', monthly_limit: -1 },
    },
    COLLECTED_AT,
  );

  assert.equal(state.status, 'partial');
  assert.equal(state.items.session.usedPercent, null);
  assert.equal(state.items.session.remainingPercent, null);
  assert.equal(state.items.session.resetsAt, null);
  assert.equal(state.items.weekly.usedPercent, 27);
  assert.equal(state.items.weekly.remainingPercent, 73);
  assert.equal(state.credits.usedPercent, null);
  assert.equal(state.credits.remainingPercent, null);
  assert.equal(state.credits.spent, null);
  assert.equal(state.credits.limit, null);
});

test('returns unsupported for an unrecognized usage shape', () => {
  const state = normalizeUsage({ account: { plan: 'pro' } }, COLLECTED_AT);

  assert.equal(state.status, 'unsupported');
  assert.equal(state.diagnostic, 'USAGE_SHAPE_UNRECOGNIZED');
  assert.equal(state.items.session, null);
  assert.equal(state.items.weekly, null);
  assert.equal(state.credits, null);
});

test('returns unsupported when known sections contain no recognized usable metric', () => {
  const emptySession = normalizeUsage({ five_hour: {} }, COLLECTED_AT);
  assert.equal(emptySession.status, 'unsupported');
  assert.equal(emptySession.diagnostic, 'USAGE_SHAPE_UNRECOGNIZED');

  const disabledCredits = normalizeUsage({ extra_usage: { is_enabled: false } }, COLLECTED_AT);
  assert.equal(disabledCredits.status, 'unsupported');
  assert.equal(disabledCredits.diagnostic, 'USAGE_SHAPE_UNRECOGNIZED');
  assert.equal(disabledCredits.credits, null);
});

test('does not infer that malformed extra-usage enable flags mean enabled', () => {
  for (const isEnabled of [null, 'true', 1]) {
    const state = normalizeUsage(
      {
        extra_usage: {
          is_enabled: isEnabled,
          utilization: 56,
          used_credits: 28.19,
          monthly_limit: 50,
        },
      },
      COLLECTED_AT,
    );
    assert.equal(state.status, 'unsupported');
    assert.equal(state.credits, null);
  }
});
