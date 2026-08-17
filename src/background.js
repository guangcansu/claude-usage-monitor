import { collectClaudeUsage } from './collector/claude-client.js';
import {
  getBadgePresentation,
  makeEmptyState,
  normalizePercent,
  withRefreshFailure,
} from './shared/model.js';
import { normalizeResetLabel, resetLabelExpiry } from './fallback-parse.js';

const REFRESH_ALARM = 'refresh-usage';
const PAGE_RESET_FALLBACK_KEY = 'pageResetFallback';
const PAGE_RESET_FALLBACK_VERSION = 1;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function safeLabel(value) {
  return normalizeResetLabel(value);
}

function normalizeFallbackItem(value, id, label) {
  if (!isRecord(value)) return null;
  const usedPercent = normalizePercent(value.usedPercent);
  if (usedPercent === null) return null;
  return {
    id,
    label,
    usedPercent,
    remainingPercent: 100 - usedPercent,
    resetsAt: null,
    resetLabel: safeLabel(value.resetLabel),
  };
}

function normalizeFallbackCredits(value) {
  if (!isRecord(value)) return null;
  const usedPercent = normalizePercent(value.usedPercent);
  const spent = typeof value.spent === 'number' && Number.isFinite(value.spent) && value.spent >= 0 ? value.spent : null;
  if (usedPercent === null && spent === null) return null;
  return {
    usedPercent,
    remainingPercent: usedPercent === null ? null : 100 - usedPercent,
    spent,
    limit: null,
    currency: spent === null ? null : 'USD',
    resetsAt: null,
    resetLabel: safeLabel(value.resetLabel),
  };
}

export function fallbackState(payload, now = new Date()) {
  if (!isRecord(payload)) return null;
  const session = normalizeFallbackItem(payload.session, 'session', 'Current session');
  const normalizedWeekly = normalizeFallbackItem(payload.weekly, 'weekly', 'Weekly limits');
  const normalizedAllModels = normalizeFallbackItem(payload.allModels, 'weekly', 'Weekly limits');
  const weekly = normalizedWeekly ?? normalizedAllModels;
  const credits = normalizeFallbackCredits(payload.credits);
  if (!session && !weekly && !credits) return null;

  const state = makeEmptyState(session && weekly ? 'ready' : 'partial', null, now);
  state.source = 'page';
  state.items = { session, weekly };
  state.credits = credits;
  return state;
}

function refreshFailure(state) {
  return state.status !== 'ready' && state.status !== 'partial';
}

function isAuthoritativeApiState(state) {
  return state?.source === 'api' && state.stale !== true && !refreshFailure(state);
}

function safeTimestamp(value) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function pageResetEntry(value, collectedAt) {
  if (!isRecord(value)) return null;
  const resetsAt = safeTimestamp(value.resetsAt);
  const resetLabel = safeLabel(value.resetLabel);
  const labelExpiry = resetLabel ? resetLabelExpiry(resetLabel, collectedAt) : null;
  const targets = [resetsAt, labelExpiry].filter(Boolean).map((target) => Date.parse(target));
  if (targets.length === 0) return null;
  const expiresAt = new Date(Math.min(...targets)).toISOString();
  if (Date.parse(expiresAt) <= Date.parse(collectedAt)) return null;
  return {
    resetsAt,
    resetLabel: labelExpiry ? resetLabel : null,
    expiresAt,
  };
}

function makePageResetFallback(pageState) {
  if (pageState?.source !== 'page') return null;
  const collectedAt = safeTimestamp(pageState.collectedAt);
  if (!collectedAt) return null;
  const session = pageResetEntry(pageState.items?.session, collectedAt);
  const weekly = pageResetEntry(pageState.items?.weekly, collectedAt);
  const credits = pageResetEntry(pageState.credits, collectedAt);
  if (!session && !weekly && !credits) return null;
  return {
    version: PAGE_RESET_FALLBACK_VERSION,
    source: 'page',
    collectedAt,
    items: { session, weekly },
    credits,
  };
}

function selectResetEntries(pageState, predicate) {
  if (!pageState) return null;
  const session = pageState.items.session && predicate(pageState.items.session) ? pageState.items.session : null;
  const weekly = pageState.items.weekly && predicate(pageState.items.weekly) ? pageState.items.weekly : null;
  const credits = pageState.credits && predicate(pageState.credits) ? pageState.credits : null;
  if (!session && !weekly && !credits) return null;
  return { ...pageState, items: { session, weekly }, credits };
}

function validatePageResetFallback(value, at) {
  const atTimestamp = at instanceof Date ? at.getTime() : Date.parse(at);
  if (
    !isRecord(value) ||
    value.version !== PAGE_RESET_FALLBACK_VERSION ||
    value.source !== 'page' ||
    !Number.isFinite(atTimestamp)
  ) {
    return { active: null, expired: null };
  }
  const normalized = makePageResetFallback(value);
  if (!normalized || Date.parse(normalized.collectedAt) > atTimestamp) {
    return { active: null, expired: null };
  }
  return {
    active: selectResetEntries(normalized, (entry) => Date.parse(entry.expiresAt) > atTimestamp),
    expired: selectResetEntries(normalized, (entry) => Date.parse(entry.expiresAt) <= atTimestamp),
  };
}

function enrichResetFields(apiValue, pageValue) {
  if (!isRecord(apiValue) || !isRecord(pageValue)) return apiValue;
  const resetsAt = apiValue.resetsAt ?? pageValue.resetsAt ?? null;
  const resetLabel = apiValue.resetLabel ?? pageValue.resetLabel ?? null;
  if (resetsAt === apiValue.resetsAt && resetLabel === apiValue.resetLabel) return apiValue;
  return { ...apiValue, resetsAt, resetLabel };
}

export function enrichApiStateWithPageFallback(apiState, pageState) {
  if (!isAuthoritativeApiState(apiState) || pageState?.source !== 'page') return apiState;

  const session = enrichResetFields(apiState.items?.session, pageState.items?.session);
  const weekly = enrichResetFields(apiState.items?.weekly, pageState.items?.weekly);
  const credits = enrichResetFields(apiState.credits, pageState.credits);
  if (
    session === apiState.items?.session &&
    weekly === apiState.items?.weekly &&
    credits === apiState.credits
  ) {
    return apiState;
  }

  return {
    ...apiState,
    items: { session, weekly },
    credits,
  };
}

function removeExpiredPageResetFallback(state, pageState) {
  if (!isRecord(state) || !pageState) return state;

  function removeExpiredFields(value, expiredValue) {
    if (!isRecord(value) || !isRecord(expiredValue)) return value;
    const resetsAt = value.resetsAt === expiredValue.resetsAt ? null : value.resetsAt;
    const resetLabel = value.resetLabel === expiredValue.resetLabel ? null : value.resetLabel;
    if (resetsAt === value.resetsAt && resetLabel === value.resetLabel) return value;
    return { ...value, resetsAt, resetLabel };
  }

  const session = removeExpiredFields(state.items?.session, pageState.items?.session);
  const weekly = removeExpiredFields(state.items?.weekly, pageState.items?.weekly);
  const credits = removeExpiredFields(state.credits, pageState.credits);
  if (session === state.items?.session && weekly === state.items?.weekly && credits === state.credits) return state;
  return { ...state, items: { session, weekly }, credits };
}

export function createBackgroundController({ chromeApi, fetchImpl, collectUsage = collectClaudeUsage, now = () => new Date() }) {
  let inFlightRefresh = null;
  let commitQueue = Promise.resolve();

  async function readUsageState() {
    const stored = await chromeApi.storage.local.get('usageState');
    return stored.usageState ?? null;
  }

  async function saveUsageState(state) {
    await chromeApi.storage.local.set({ usageState: state });
    const badge = getBadgePresentation(state);
    await chromeApi.action.setBadgeText({ text: badge.text });
    await chromeApi.action.setBadgeBackgroundColor({ color: badge.color });
  }

  async function savePageResetFallback(state) {
    await chromeApi.storage.local.set({ [PAGE_RESET_FALLBACK_KEY]: state });
  }

  async function readPageResetFallback(at) {
    const stored = await chromeApi.storage.local.get(PAGE_RESET_FALLBACK_KEY);
    const rawState = stored[PAGE_RESET_FALLBACK_KEY] ?? null;
    const validated = validatePageResetFallback(rawState, at);
    if (JSON.stringify(rawState) !== JSON.stringify(validated.active)) {
      await savePageResetFallback(validated.active);
    }
    return validated;
  }

  function enqueueCommit(operation) {
    const commit = commitQueue.then(operation, operation);
    commitQueue = commit.catch(() => {});
    return commit;
  }

  function refreshUsage() {
    if (inFlightRefresh) return inFlightRefresh;

    const refresh = (async () => {
      let state;
      try {
        state = await collectUsage(fetchImpl, now());
      } catch {
        state = makeEmptyState('network-error', 'NETWORK_FAILURE', now());
      }
      return enqueueCommit(async () => {
        const pageResetFallback = await readPageResetFallback(now());
        let savedState;
        if (refreshFailure(state)) {
          const previousState = removeExpiredPageResetFallback(
            await readUsageState(),
            pageResetFallback.expired,
          );
          const enrichedPreviousState = enrichApiStateWithPageFallback(
            previousState,
            pageResetFallback.active,
          );
          savedState = withRefreshFailure(enrichedPreviousState, state.status, state.diagnostic, now());
        } else {
          savedState = enrichApiStateWithPageFallback(state, pageResetFallback.active);
        }
        await saveUsageState(savedState);
        return savedState;
      });
    })();
    inFlightRefresh = refresh;
    void refresh.then(
      () => {
        if (inFlightRefresh === refresh) inFlightRefresh = null;
      },
      () => {
        if (inFlightRefresh === refresh) inFlightRefresh = null;
      },
    );
    return refresh;
  }

  async function waitForInFlightRefresh() {
    const refresh = inFlightRefresh;
    return refresh ? refresh : null;
  }

  async function enrichApiStateAtCommit(apiState) {
    const pageResetFallback = await readPageResetFallback(now());
    const enrichedState = enrichApiStateWithPageFallback(apiState, pageResetFallback.active);
    if (enrichedState !== apiState) await saveUsageState(enrichedState);
    return enrichedState;
  }

  async function commitApiEnrichment(apiState) {
    return enqueueCommit(async () => {
      const storedState = await readUsageState();
      const currentApiState = isAuthoritativeApiState(storedState) ? storedState : apiState;
      return enrichApiStateAtCommit(currentApiState);
    });
  }

  async function applyPageFallback(payload) {
    const state = fallbackState(payload, now());
    if (!state) return { ok: false };
    const pageResetFallback = makePageResetFallback(state);
    await enqueueCommit(() => savePageResetFallback(pageResetFallback));
    const cachedApiState = await readUsageState();
    const apiState = await (inFlightRefresh ?? refreshUsage());
    if (apiState && !refreshFailure(apiState)) {
      return { ok: false, state: await commitApiEnrichment(apiState) };
    }
    if (isAuthoritativeApiState(cachedApiState)) return { ok: false, state: apiState ?? cachedApiState };

    return enqueueCommit(async () => {
      const latestApiState = await waitForInFlightRefresh();
      if (latestApiState && !refreshFailure(latestApiState)) {
        return { ok: false, state: await enrichApiStateAtCommit(latestApiState) };
      }
      const storedState = await readUsageState();
      if (storedState?.source === 'api' && !refreshFailure(storedState)) {
        return { ok: false, state: await enrichApiStateAtCommit(storedState) };
      }
      await saveUsageState(state);
      return { ok: true, state };
    });
  }

  async function initialize() {
    chromeApi.alarms.create(REFRESH_ALARM, { periodInMinutes: 2 });
    const stored = await chromeApi.storage.local.get('demoEnabled');
    if (typeof stored.demoEnabled !== 'boolean') await chromeApi.storage.local.set({ demoEnabled: false });
    await refreshUsage();
  }

  return { refreshUsage, applyPageFallback, initialize };
}

export function registerBackground(chromeApi = chrome, fetchImpl = fetch) {
  const controller = createBackgroundController({ chromeApi, fetchImpl });
  chromeApi.runtime.onInstalled.addListener(() => {
    void controller.initialize().catch(() => {});
  });
  chromeApi.runtime.onStartup.addListener(() => {
    void controller.initialize().catch(() => {});
  });
  chromeApi.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === REFRESH_ALARM) void controller.refreshUsage().catch(() => {});
  });
  chromeApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'REFRESH_USAGE') {
      void controller.refreshUsage().then(
        (state) => sendResponse({ ok: state.status !== 'network-error', state }),
        () => sendResponse({ ok: false, state: null }),
      );
      return true;
    }
    if (message?.type === 'USAGE_PAGE_FALLBACK') {
      void controller.applyPageFallback(message.payload).then(sendResponse, () => sendResponse({ ok: false }));
      return true;
    }
    return false;
  });
  return controller;
}

if (typeof chrome !== 'undefined') registerBackground(chrome, fetch);
