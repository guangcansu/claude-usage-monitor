import { collectClaudeUsage } from './collector/claude-client.js';
import {
  getBadgePresentation,
  makeEmptyState,
  normalizePercent,
  withRefreshFailure,
} from './shared/model.js';
import { normalizeResetLabel } from './fallback-parse.js';

const REFRESH_ALARM = 'refresh-usage';

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
        const savedState = refreshFailure(state)
          ? withRefreshFailure(await readUsageState(), state.status, state.diagnostic, now())
          : state;
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

  async function applyPageFallback(payload) {
    const state = fallbackState(payload, now());
    if (!state) return { ok: false };
    const apiState = await (inFlightRefresh ?? refreshUsage());
    if (apiState && !refreshFailure(apiState)) return { ok: false, state: apiState };

    return enqueueCommit(async () => {
      const latestApiState = await waitForInFlightRefresh();
      if (latestApiState && !refreshFailure(latestApiState)) return { ok: false, state: latestApiState };
      const storedState = await readUsageState();
      if (storedState?.source === 'api' && !refreshFailure(storedState)) {
        return { ok: false, state: storedState };
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
