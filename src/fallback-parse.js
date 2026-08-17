const PERCENT_USED_BLOCK = /^(\d{1,3})%\s+used$/i;
const SPENT_BLOCK = /^\$(\d+(?:\.\d{1,2})?)\s+spent$/i;
const TIME = '(?:1[0-2]|0?[1-9]):[0-5]\\d\\s*(?:AM|PM)';
const WEEKDAY = '(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)';
const MONTH = '(?:January|February|March|April|May|June|July|August|September|October|November|December)';
const RESET_BLOCK = new RegExp(
  `^Resets?\\s+(?:in\\s+\\d{1,3}\\s+(?:minutes?|hours?|days?|weeks?)|at\\s+${TIME}|on\\s+(?:${WEEKDAY}(?:\\s+at\\s+${TIME})?|${MONTH}\\s+\\d{1,2}(?:,\\s*\\d{4})?(?:\\s+at\\s+${TIME})?))$`,
  'i',
);

function trimmedBlock(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeResetLabel(value) {
  const block = trimmedBlock(value);
  return RESET_BLOCK.test(block) ? block : null;
}

export function parseAdjacentUsageBlocks(blocks) {
  let usedPercent = null;
  let resetLabel = null;
  let spent = null;

  for (const value of blocks) {
    const block = trimmedBlock(value);
    const percentMatch = block.match(PERCENT_USED_BLOCK);
    if (percentMatch) {
      const percent = Number(percentMatch[1]);
      if (percent >= 0 && percent <= 100) usedPercent = percent;
      continue;
    }

    const spentMatch = block.match(SPENT_BLOCK);
    if (spentMatch) {
      const amount = Number(spentMatch[1]);
      if (Number.isFinite(amount) && amount >= 0) spent = amount;
      continue;
    }

    const reset = normalizeResetLabel(block);
    if (reset) resetLabel = reset;
  }

  return { usedPercent, resetLabel, spent };
}
