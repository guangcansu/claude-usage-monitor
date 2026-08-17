import { formatDate, resetText } from './format.js';

const $ = (id) => document.getElementById(id);

const elements = {
  shell: document.querySelector('.popup-shell'),
  statusPill: $('status-pill'),
  statusMessage: $('status-message'),
  freshness: $('freshness'),
  refresh: $('refresh-button'),
  signIn: $('sign-in-button'),
  settings: $('settings-button'),
  demoToggle: $('demo-toggle'),
  metrics: {
    session: metricElements('session'),
    weekly: metricElements('weekly'),
    credits: metricElements('credits'),
  },
};

let displayedState = null;
let demoEnabled = false;

function metricElements(name) {
  const row = document.querySelector(`[data-metric="${name}"]`);
  return {
    row,
    value: $(`${name}-value`),
    detail: $(`${name}-detail`),
    progress: $(`${name}-progress`),
    progressbar: row.querySelector('[role="progressbar"]'),
  };
}

function isFinitePercentage(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
}

function formatMoney(value, currency = 'USD') {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return new Intl.NumberFormat(undefined, {
    style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 2,
  }).format(value);
}

function demoFixture() {
  return {
    version: 1,
    status: 'demo',
    diagnostic: null,
    collectedAt: new Date().toISOString(),
    stale: false,
    source: 'demo',
    items: {
      session: { id: 'session', label: 'Current session', usedPercent: 45, remainingPercent: 55, resetsAt: null, resetLabel: 'Resets in 20 minutes' },
      weekly: { id: 'weekly', label: 'Weekly limits', usedPercent: 27, remainingPercent: 73, resetsAt: null, resetLabel: 'Resets Wednesday 5:00 PM' },
    },
    credits: { usedPercent: 56, remainingPercent: 44, spent: 28.19, limit: 50, currency: 'USD', resetsAt: null, resetLabel: 'Resets September 1' },
  };
}

function hasUsageValues(state) {
  return ['session', 'weekly'].some((name) => isFinitePercentage(state?.items?.[name]?.usedPercent))
    || isFinitePercentage(state?.credits?.usedPercent);
}

function setMetric(name, metric, state) {
  const target = elements.metrics[name];
  const isUnavailableState = state?.status === 'signed-out' || state?.status === 'unsupported';
  const usedPercent = metric?.usedPercent;
  const available = isFinitePercentage(usedPercent) && !isUnavailableState;

  target.row.classList.toggle('is-unavailable', !available);
  target.value.textContent = available ? `${Math.round(usedPercent)}% used` : '—';
  target.progress.style.width = `${available ? usedPercent : 0}%`;
  target.progressbar.setAttribute('aria-valuenow', String(available ? usedPercent : 0));
  target.progressbar.setAttribute('aria-valuetext', available ? `${Math.round(usedPercent)} percent used` : 'Usage unavailable');

  if (!available) {
    target.detail.textContent = 'Unavailable';
    return;
  }

  const remaining = isFinitePercentage(metric.remainingPercent) ? metric.remainingPercent : 100 - usedPercent;
  const remainingText = `${Math.round(remaining)}% left`;
  if (name !== 'credits') {
    target.detail.textContent = `${remainingText} · ${resetText(metric)}`;
    return;
  }

  const spent = formatMoney(metric.spent, metric.currency);
  const limit = formatMoney(metric.limit, metric.currency);
  const creditAmount = spent && limit ? `${spent} of ${limit}` : 'Credit amount unavailable';
  target.detail.textContent = `${remainingText} · ${creditAmount} · ${resetText(metric)}`;
}

function statusPresentation(state) {
  if (demoEnabled) return { className: 'demo', pill: 'Demo data', message: 'Demo data is shown locally and never changes your live badge.' };
  if (!state) return { className: 'loading', pill: 'Loading', message: 'Checking your latest usage…' };
  if (state.stale && hasUsageValues(state)) return { className: 'stale', pill: 'Stale', message: 'Showing the last successful usage data while a refresh is unavailable.' };
  switch (state.status) {
    case 'ready': return { className: 'ready', pill: 'Up to date', message: 'Usage data is ready.' };
    case 'partial': return { className: 'partial', pill: 'Partial data', message: 'Some usage data is unavailable.' };
    case 'signed-out': return { className: 'signed-out', pill: 'Sign in', message: 'Sign in to Claude to view your usage.' };
    case 'unsupported': return { className: 'unsupported', pill: 'Unavailable', message: 'Claude usage data is unavailable right now.' };
    case 'network-error': return { className: 'network-error', pill: 'Refresh failed', message: 'Could not refresh usage. Try again shortly.' };
    default: return { className: 'loading', pill: 'Loading', message: 'Checking your latest usage…' };
  }
}

function freshnessText(state) {
  if (demoEnabled) return 'Demo data · stored only in this popup.';
  if (!state) return 'Checking for usage data…';
  const formatted = formatDate(state.collectedAt, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  if (state.stale && hasUsageValues(state)) return formatted ? `Last successful update ${formatted}` : 'Last successful update unavailable';
  return formatted ? `Updated ${formatted}` : 'Update time unavailable';
}

function render() {
  const state = demoEnabled ? demoFixture() : displayedState;
  const presentation = statusPresentation(state);
  elements.shell.dataset.state = presentation.className;
  elements.statusPill.textContent = presentation.pill;
  elements.statusMessage.textContent = presentation.message;
  elements.freshness.textContent = freshnessText(state);
  elements.demoToggle.checked = demoEnabled;
  elements.signIn.hidden = !(state?.status === 'signed-out' && !demoEnabled);

  setMetric('session', state?.items?.session, state);
  setMetric('weekly', state?.items?.weekly, state);
  setMetric('credits', state?.credits, state);
}

async function refreshUsage() {
  elements.refresh.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({ type: 'REFRESH_USAGE' });
    if (response?.state && !demoEnabled) displayedState = response.state;
  } catch {
    if (!demoEnabled) displayedState = { ...displayedState, status: 'network-error', stale: hasUsageValues(displayedState) };
  } finally {
    elements.refresh.disabled = false;
    render();
  }
}

function openClaudePage(path) {
  chrome.tabs.create({ url: `https://claude.ai${path}` });
}

elements.refresh.addEventListener('click', refreshUsage);
elements.signIn.addEventListener('click', () => openClaudePage('/login'));
elements.settings.addEventListener('click', () => openClaudePage('/settings/usage'));
elements.demoToggle.addEventListener('change', async () => {
  demoEnabled = elements.demoToggle.checked;
  await chrome.storage.local.set({ demoEnabled });
  render();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (changes.usageState && !demoEnabled) displayedState = changes.usageState.newValue ?? null;
  if (changes.demoEnabled) demoEnabled = changes.demoEnabled.newValue === true;
  render();
});

async function initialize() {
  try {
    const stored = await chrome.storage.local.get(['usageState', 'demoEnabled']);
    displayedState = stored.usageState ?? null;
    demoEnabled = stored.demoEnabled === true;
  } catch {
    displayedState = { status: 'network-error', stale: false, items: { session: null, weekly: null }, credits: null };
  }
  render();
}

void initialize();
