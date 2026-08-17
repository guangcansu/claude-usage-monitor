export function validDate(value) {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(value, options, locale) {
  const date = validDate(value);
  return date ? new Intl.DateTimeFormat(locale, options).format(date) : null;
}

export function resetText(metric, locale, timeZone) {
  const options = {
    weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  };
  if (timeZone) options.timeZone = timeZone;
  const formatted = formatDate(metric?.resetsAt, options, locale);
  if (formatted) return `Resets ${formatted}`;
  if (typeof metric?.resetLabel === 'string' && metric.resetLabel.trim()) return metric.resetLabel.trim();
  return 'Unavailable';
}
