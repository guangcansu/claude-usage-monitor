import { collectClaudeUsage } from './collector/claude-client.js';
import {
  getBadgePresentation,
  makeEmptyState,
  normalizePercent,
  withRefreshFailure,
} from './shared/model.js';

const REFRESH_ALARM = 'refresh-usage';
let inFlightRefresh = null;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function safeLabel(value) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 120) : null;
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

function fallbackState(payload, now = new Date()) {
  if (!isRecord(payload)) return null;
  const session = normalizeFallbackItem(payload.session, 'session', 'Current session');
  const weekly = normalizeFallbackItem(payload.weekly ?? payload.allModels, 'weekly', 'Weekly limits');
  const credits = normalizeFallbackCredits(payload.credits);
  if (!session && !weekly && !credits) return null;

  const state = makeEmptyState(session && weekly ? 'ready' : 'partial', null, now);
  state.source = 'page';
  state.items = { session, weekly };
  state.credits = credits;
  return state;
}

async function readUsageState() {
  const stored = await chrome.storage.local.get('usageState');
  return stored.usageState ?? null;
}

async function saveUsageState(state) {
  await chrome.storage.local.set({ usageState: state });
  const badge = getBadgePresentation(state);
  await chrome.action.setBadgeText({ text: badge.text });
  await chrome.action.setBadgeBackgroundColor({ color: badge.color });
}

function refreshFailure(state) {
  return state.status !== 'ready' && state.status !== 'partial';
}

export async function refreshUsage() {
  if (inFlightRefresh) return inFlightRefresh;

  inFlightRefresh = (async () => {
    const state = await collectClaudeUsage(fetch, new Date());
    const savedState = refreshFailure(state)
      ? withRefreshFailure(await readUsageState(), state.status, state.diagnostic, new Date())
      : state;
    await saveUsageState(savedState);
    return savedState;
  })();

  try {
    return await inFlightRefresh;
  } finally {
    inFlightRefresh = null;
  }
}

async function initialize() {
  chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: 2 });
  const stored = await chrome.storage.local.get('demoEnabled');
  if (typeof stored.demoEnabled !== 'boolean') {
    await chrome.storage.local.set({ demoEnabled: false });
  }
  await refreshUsage();
}

chrome.runtime.onInstalled.addListener(() => {
  void initialize();
});

chrome.runtime.onStartup.addListener(() => {
  void initialize();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === REFRESH_ALARM) void refreshUsage();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'REFRESH_USAGE') {
    void refreshUsage().then(
      (state) => sendResponse({ ok: state.status !== 'network-error', state }),
      () => sendResponse({ ok: false, state: null }),
    );
    return true;
  }

  if (message?.type === 'USAGE_PAGE_FALLBACK') {
    void (async () => {
      const state = fallbackState(message.payload);
      if (!state) return { ok: false };
      await saveUsageState(state);
      return { ok: true, state };
    })().then(sendResponse, () => sendResponse({ ok: false }));
    return true;
  }

  return false;
});
