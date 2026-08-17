import { makeEmptyState, normalizePercent } from '../shared/model.js';

const UNSUPPORTED_DIAGNOSTIC = 'USAGE_SHAPE_UNRECOGNIZED';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function firstRecord(raw, snakeKey, camelKey) {
  if (!isRecord(raw)) return null;
  if (isRecord(raw[snakeKey])) return raw[snakeKey];
  if (isRecord(raw[camelKey])) return raw[camelKey];
  return null;
}

function firstValue(raw, keys) {
  if (!isRecord(raw)) return undefined;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(raw, key)) return raw[key];
  }
  return undefined;
}

function normalizeResetAt(raw) {
  const value = firstValue(raw, ['resets_at', 'resetsAt']);
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return null;
  return value;
}

function normalizeResetLabel(raw) {
  const value = firstValue(raw, ['reset_label', 'resetLabel']);
  return typeof value === 'string' && value.trim() ? value : null;
}

function normalizeUsageItem(raw, id, label) {
  if (!isRecord(raw)) return null;

  const usedPercent = normalizePercent(firstValue(raw, ['utilization', 'used_percent', 'usedPercent']));
  return {
    id,
    label,
    usedPercent,
    remainingPercent: usedPercent === null ? null : 100 - usedPercent,
    resetsAt: normalizeResetAt(raw),
    resetLabel: normalizeResetLabel(raw),
  };
}

function normalizeAmount(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function normalizeCurrency(value) {
  return typeof value === 'string' && value.trim() ? value : null;
}

function normalizeCredits(raw) {
  if (!isRecord(raw)) return null;
  const enabled = firstValue(raw, ['is_enabled', 'isEnabled']);
  if (enabled !== true) return null;

  const usedPercent = normalizePercent(firstValue(raw, ['utilization', 'used_percent', 'usedPercent']));
  const spent = normalizeAmount(firstValue(raw, ['used_credits', 'usedCredits']));
  const limit = normalizeAmount(firstValue(raw, ['monthly_limit', 'monthlyLimit']));
  const currency = normalizeCurrency(firstValue(raw, ['currency']));

  return {
    usedPercent,
    remainingPercent: usedPercent === null ? null : 100 - usedPercent,
    spent,
    limit,
    currency,
    resetsAt: normalizeResetAt(raw),
    resetLabel: normalizeResetLabel(raw),
  };
}

function hasRecognizedMetric(session, weekly, credits) {
  return Boolean(
    (session !== null && session.usedPercent !== null) ||
      (weekly !== null && weekly.usedPercent !== null) ||
      (credits !== null &&
        (credits.usedPercent !== null || credits.spent !== null || credits.limit !== null)),
  );
}

export function normalizeOrganizations(raw) {
  const organizations = Array.isArray(raw)
    ? raw
    : isRecord(raw) && Array.isArray(raw.organizations)
      ? raw.organizations
      : null;
  if (!organizations) return null;

  for (const organization of organizations) {
    if (!isRecord(organization)) continue;
    const uuid = organization.uuid;
    if (typeof uuid === 'string' && uuid.trim()) return { organizationId: uuid.trim() };
    const id = organization.id;
    if (typeof id === 'string' && id.trim()) return { organizationId: id.trim() };
  }
  return null;
}

export function normalizeUsage(raw, collectedAt) {
  const sessionRaw = firstRecord(raw, 'five_hour', 'fiveHour');
  const weeklyRaw = firstRecord(raw, 'seven_day', 'sevenDay');
  const creditsRaw = firstRecord(raw, 'extra_usage', 'extraUsage');
  const session = normalizeUsageItem(sessionRaw, 'session', 'Current session');
  const weekly = normalizeUsageItem(weeklyRaw, 'weekly', 'Weekly limits');
  const credits = normalizeCredits(creditsRaw);
  const recognized = hasRecognizedMetric(session, weekly, credits);
  const ready = session !== null && session.usedPercent !== null && weekly !== null && weekly.usedPercent !== null;
  const status = ready ? 'ready' : recognized ? 'partial' : 'unsupported';
  const state = makeEmptyState(status, status === 'unsupported' ? UNSUPPORTED_DIAGNOSTIC : null, collectedAt);

  state.source = 'api';
  state.items = { session, weekly };
  state.credits = credits;
  return state;
}
