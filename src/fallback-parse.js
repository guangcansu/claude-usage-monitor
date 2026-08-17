const PERCENT_USED_BLOCK = /^(\d{1,3})%\s+used$/i;
const SPENT_BLOCK = /^\$(\d+(?:\.\d{1,2})?)\s+spent$/i;
const TIME = '(?:1[0-2]|0?[1-9]):[0-5]\\d\\s*(?:AM|PM)';
const WEEKDAY = '(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)';
const SHORT_WEEKDAY = '(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)';
const MONTH = '(?:January|February|March|April|May|June|July|August|September|October|November|December)';
const SHORT_MONTH = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)';
const DURATION = '(?:\\d{1,3}\\s+(?:minutes?|hours?|days?|weeks?)|\\d{1,3}\\s+hr\\s+\\d{1,3}\\s+min)';
const RESET_BLOCK = new RegExp(
  `^Resets?\\s+(?:in\\s+${DURATION}|at\\s+${TIME}|on\\s+(?:${WEEKDAY}(?:\\s+at\\s+${TIME})?|${MONTH}\\s+\\d{1,2}(?:,\\s*\\d{4})?(?:\\s+at\\s+${TIME})?)|${SHORT_WEEKDAY}\\s+${TIME}|${SHORT_MONTH}\\s+\\d{1,2})$`,
  'i',
);
const MAX_ANCESTOR_LAYERS = 6;
const WEEKDAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function trimmedBlock(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeResetLabel(value) {
  const block = trimmedBlock(value);
  return RESET_BLOCK.test(block) ? block : null;
}

function parseTime(value) {
  const match = value.match(/^(1[0-2]|0?[1-9]):([0-5]\d)\s*(AM|PM)$/i);
  if (!match) return null;
  const hour = (Number(match[1]) % 12) + (match[3].toUpperCase() === 'PM' ? 12 : 0);
  return { hour, minute: Number(match[2]) };
}

function nextWeekday(observedAt, weekday, time) {
  const target = new Date(observedAt);
  const offset = (weekday - target.getDay() + 7) % 7;
  target.setDate(target.getDate() + offset);
  target.setHours(time?.hour ?? 0, time?.minute ?? 0, 0, 0);
  if (target <= observedAt) target.setDate(target.getDate() + 7);
  return target;
}

function monthDate(observedAt, month, day, explicitYear, time) {
  let year = explicitYear ?? observedAt.getFullYear();
  let target = new Date(year, month, day, time?.hour ?? 0, time?.minute ?? 0, 0, 0);
  if (target.getFullYear() !== year || target.getMonth() !== month || target.getDate() !== day) return null;
  if (explicitYear === null && target <= observedAt) {
    year += 1;
    target = new Date(year, month, day, time?.hour ?? 0, time?.minute ?? 0, 0, 0);
    if (target.getFullYear() !== year || target.getMonth() !== month || target.getDate() !== day) return null;
  }
  return target;
}

export function resetLabelExpiry(value, observedAt) {
  const label = normalizeResetLabel(value);
  const observed = observedAt instanceof Date ? new Date(observedAt.getTime()) : new Date(observedAt);
  if (!label || Number.isNaN(observed.getTime())) return null;
  const body = label.replace(/^Resets?\s+/i, '');

  let match = body.match(/^in\s+(\d{1,3})\s+hr\s+(\d{1,3})\s+min$/i);
  if (match) {
    return new Date(observed.getTime() + (Number(match[1]) * 60 + Number(match[2])) * 60_000).toISOString();
  }

  match = body.match(/^in\s+(\d{1,3})\s+(minutes?|hours?|days?|weeks?)$/i);
  if (match) {
    const milliseconds = {
      minute: 60_000,
      hour: 3_600_000,
      day: 86_400_000,
      week: 604_800_000,
    }[match[2].toLowerCase().replace(/s$/, '')];
    return new Date(observed.getTime() + Number(match[1]) * milliseconds).toISOString();
  }

  match = body.match(/^at\s+(.+)$/i);
  if (match) {
    const time = parseTime(match[1]);
    if (!time) return null;
    const target = new Date(observed);
    target.setHours(time.hour, time.minute, 0, 0);
    if (target <= observed) target.setDate(target.getDate() + 1);
    return target.toISOString();
  }

  match = body.match(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(.+)$/i);
  if (match) {
    const time = parseTime(match[2]);
    if (!time) return null;
    return nextWeekday(observed, WEEKDAY_NAMES.indexOf(match[1].slice(0, 3).toLowerCase()), time).toISOString();
  }

  match = body.match(/^on\s+(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)(?:\s+at\s+(.+))?$/i);
  if (match) {
    const time = match[2] ? parseTime(match[2]) : null;
    if (match[2] && !time) return null;
    return nextWeekday(observed, WEEKDAY_NAMES.indexOf(match[1].slice(0, 3).toLowerCase()), time).toISOString();
  }

  match = body.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})$/i);
  if (match) {
    return monthDate(observed, MONTH_NAMES.indexOf(match[1].slice(0, 3).toLowerCase()), Number(match[2]), null, null)?.toISOString() ?? null;
  }

  match = body.match(/^on\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:,\s*(\d{4}))?(?:\s+at\s+(.+))?$/i);
  if (match) {
    const time = match[4] ? parseTime(match[4]) : null;
    if (match[4] && !time) return null;
    const target = monthDate(
      observed,
      MONTH_NAMES.indexOf(match[1].slice(0, 3).toLowerCase()),
      Number(match[2]),
      match[3] ? Number(match[3]) : null,
      time,
    );
    return target?.toISOString() ?? null;
  }

  return null;
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

export function selectNearestUsageMetric(ancestorLayers) {
  if (!Array.isArray(ancestorLayers)) return null;

  for (const blocks of ancestorLayers.slice(0, MAX_ANCESTOR_LAYERS)) {
    if (!Array.isArray(blocks)) continue;
    const metric = parseAdjacentUsageBlocks(blocks);
    if (metric.usedPercent !== null || metric.spent !== null) return metric;
  }

  return null;
}
