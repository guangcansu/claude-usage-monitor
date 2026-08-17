import { parseAdjacentUsageBlocks } from './fallback-parse.js';

const GATE_TEXT = 'Plan usage limits';
const LABELS = Object.freeze({
  session: 'Current session',
  weekly: 'Weekly limits',
  allModels: 'All models',
  credits: 'Usage credits',
});
const ROOT_SELECTOR = [
  '[data-testid*="usage" i]',
  '[aria-label*="usage" i]',
  '[role="dialog"]',
  'main section',
  '[role="main"] section',
].join(', ');
const BLOCK_SELECTOR = 'h1, h2, h3, h4, p, div, span, li';
const EXCLUDED_SELECTOR = [
  'a',
  'input',
  'textarea',
  'select',
  'button',
  'form',
  '[contenteditable="true"]',
  '[role="textbox"]',
  '[data-testid*="composer" i]',
  '[data-testid*="conversation" i]',
].join(', ');

function isVisible(element) {
  if (!(element instanceof Element) || element.closest(EXCLUDED_SELECTOR)) return false;
  const style = window.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
}

function directVisibleText(element) {
  if (!isVisible(element)) return '';
  return Array.from(element.childNodes)
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.nodeValue?.trim() ?? '')
    .filter(Boolean)
    .join(' ');
}

function usageRoot() {
  return Array.from(document.querySelectorAll(ROOT_SELECTOR)).find((element) => {
    if (!isVisible(element)) return false;
    return Array.from(element.querySelectorAll(BLOCK_SELECTOR)).some((block) => directVisibleText(block).includes(GATE_TEXT));
  });
}

function nearbyBlocks(block) {
  const parent = block.parentElement;
  if (!parent || !isVisible(parent)) return [directVisibleText(block)];
  const siblings = Array.from(parent.children);
  const index = siblings.indexOf(block);
  return siblings
    .slice(index, index + 4)
    .map(directVisibleText)
    .filter(Boolean)
    .slice(0, 4);
}

function extractBlock(root, label) {
  const labelBlock = Array.from(root.querySelectorAll(BLOCK_SELECTOR)).find((block) => {
    const text = directVisibleText(block);
    return text.includes(label);
  });
  if (!labelBlock) return null;

  const metric = parseAdjacentUsageBlocks(nearbyBlocks(labelBlock));
  if (metric.usedPercent === null && metric.resetLabel === null && metric.spent === null) return null;
  return metric;
}

function collectFallbackPayload(root) {
  const session = extractBlock(root, LABELS.session);
  const weekly = extractBlock(root, LABELS.weekly);
  const allModels = extractBlock(root, LABELS.allModels);
  const credits = extractBlock(root, LABELS.credits);
  if (!session && !weekly && !allModels && !credits) return null;

  return {
    session: session && { usedPercent: session.usedPercent, resetLabel: session.resetLabel },
    weekly: weekly && { usedPercent: weekly.usedPercent, resetLabel: weekly.resetLabel },
    allModels: allModels && { usedPercent: allModels.usedPercent, resetLabel: allModels.resetLabel },
    credits: credits && {
      usedPercent: credits.usedPercent,
      resetLabel: credits.resetLabel,
      spent: credits.spent,
    },
  };
}

function sendUsagePageFallback() {
  const root = usageRoot();
  if (!root) return;
  const payload = collectFallbackPayload(root);
  if (payload) chrome.runtime.sendMessage({ type: 'USAGE_PAGE_FALLBACK', payload });
}

sendUsagePageFallback();
