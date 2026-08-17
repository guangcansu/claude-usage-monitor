const VERSION = 1;

export const BADGE_COLORS = Object.freeze({
  neutral: '#5f5d58',
  warning: '#b66a32',
  danger: '#b13a35',
});

export function normalizePercent(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
    return null;
  }
  return value;
}

function normalizeTimestamp(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) {
    return new Date(value).toISOString();
  }

  return null;
}

function emptyUsage() {
  return {
    items: { session: null, weekly: null },
    credits: null,
  };
}

export function makeEmptyState(status, diagnostic, now) {
  return {
    version: VERSION,
    status,
    diagnostic: diagnostic ?? null,
    collectedAt: normalizeTimestamp(now),
    stale: false,
    source: 'none',
    ...emptyUsage(),
  };
}

function cloneUsage(previous) {
  return {
    items: {
      session: previous.items?.session ? { ...previous.items.session } : null,
      weekly: previous.items?.weekly ? { ...previous.items.weekly } : null,
    },
    credits: previous.credits ? { ...previous.credits } : null,
  };
}

export function withRefreshFailure(previous, status, diagnostic, now) {
  if (previous?.status !== 'ready' && previous?.status !== 'partial') {
    return makeEmptyState(status, diagnostic, now);
  }

  return {
    version: VERSION,
    status,
    diagnostic: diagnostic ?? null,
    collectedAt: normalizeTimestamp(now),
    stale: true,
    source: previous.source ?? 'none',
    ...cloneUsage(previous),
  };
}

function badgeColor(remaining) {
  if (remaining < 5) return BADGE_COLORS.danger;
  if (remaining < 20) return BADGE_COLORS.warning;
  return BADGE_COLORS.neutral;
}

export function getBadgePresentation(state) {
  const color = BADGE_COLORS.neutral;

  if (!state || state.status === 'demo' || state.source === 'demo' || state.status === 'signed-out') {
    return { text: '', color };
  }

  if (state.status === 'unsupported') {
    return { text: '?', color };
  }

  const session = state.items?.session;
  const used = normalizePercent(session?.usedPercent);
  const remaining = normalizePercent(session?.remainingPercent ?? (used === null ? null : 100 - used));
  if (remaining === null) {
    return { text: '?', color };
  }

  return {
    text: String(Math.round(remaining)),
    color: badgeColor(remaining),
  };
}

export { normalizeTimestamp };
