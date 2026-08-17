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

function nearbyText(block) {
  const parent = block.parentElement;
  if (!parent || !isVisible(parent)) return directVisibleText(block);
  const siblings = Array.from(parent.children);
  const index = siblings.indexOf(block);
  return siblings
    .slice(Math.max(0, index - 1), index + 3)
    .map(directVisibleText)
    .filter(Boolean)
    .join(' ');
}

function percentUsed(text) {
  const match = text.match(/\b(\d{1,3})%\s+used\b/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

function resetLabel(text) {
  const match = text.match(/\b(resets?\s+(?:in|at|on)\s+[^.\n]{1,80})/i);
  return match ? match[1].trim() : null;
}

function spentAmount(text) {
  const match = text.match(/\$(\d+(?:\.\d{1,2})?)\s+spent\b/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function extractBlock(root, label) {
  const labelBlock = Array.from(root.querySelectorAll(BLOCK_SELECTOR)).find((block) => {
    const text = directVisibleText(block);
    return text.includes(label);
  });
  if (!labelBlock) return null;

  const text = nearbyText(labelBlock);
  const usedPercent = percentUsed(text);
  const reset = resetLabel(text);
  const spent = spentAmount(text);
  if (usedPercent === null && reset === null && spent === null) return null;
  return { usedPercent, resetLabel: reset, spent };
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
