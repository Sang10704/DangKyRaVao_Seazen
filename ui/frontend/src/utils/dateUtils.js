/**
 * Local Vietnam (PC timezone) date/time formatting helpers.
 * Avoids `new Date().toISOString().slice(0, 10)` UTC shift bug (00:00–06:59 UTC+7).
 */
export function getLocalDateStr(input = new Date()) {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return '';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function getLocalTimeStr(input = new Date()) {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return '';
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mi}`;
}

export function getLocalMonthStr(input = new Date()) {
  const s = getLocalDateStr(input);
  return s ? s.slice(0, 7) : '';
}
