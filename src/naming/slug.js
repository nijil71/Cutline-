// Filename-safe slugging. Deliberately conservative: a name that is merely
// short is fine, a name that breaks the filesystem is not.

import { stripInvisible, stripCombiningMarks } from './text-utils.js';

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** Cut to maxLen, but back off to the last `-` so we never end mid-word. */
function truncateAtBoundary(s, maxLen) {
  if (s.length <= maxLen) return s;
  const cut = s.slice(0, maxLen);
  const lastDash = cut.lastIndexOf('-');
  // Only honour the boundary if it leaves us something substantial.
  return (lastDash > maxLen * 0.5 ? cut.slice(0, lastDash) : cut).replace(/-+$/, '');
}

/**
 * @param {string} input
 * @param {{maxLen?: number, lower?: boolean}} [opts]
 */
export function slug(input, opts = {}) {
  const { maxLen = 48, lower = true } = opts;
  if (input == null) return '';

  let s = stripInvisible(String(input).normalize('NFKD'));
  s = stripCombiningMarks(s);

  // A few symbols carry meaning worth keeping as words.
  s = s.replace(/&/g, ' and ').replace(/\+/g, ' plus ').replace(/@/g, ' at ');

  s = s
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');

  if (lower) s = s.toLowerCase();
  s = truncateAtBoundary(s, maxLen);

  if (RESERVED.test(s)) s = `_${s}`;
  return s;
}

/**
 * Join already-slugged parts, dropping empties and any token that has already
 * appeared. Without the dedupe you get `jira-jira-Q-413488` on sites whose
 * <title> repeats the brand.
 */
export function joinSlug(parts, maxLen = 60) {
  const seen = new Set();
  const out = [];

  for (const part of parts) {
    if (!part) continue;
    for (const token of String(part).split('-')) {
      if (!token) continue;
      const key = token.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(token);
    }
  }

  return truncateAtBoundary(out.join('-'), maxLen);
}

/** `2026-08-12-010451` — the honest fallback when we know nothing useful. */
export function timestampSlug(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}` +
    `-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
  );
}

/** Date-based folder name. Derived from a fact, so it is never wrong. */
export function dateFolder(format, date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const Y = date.getFullYear();
  const M = p(date.getMonth() + 1);
  const D = p(date.getDate());
  switch (format) {
    case 'YYYY': return `${Y}`;
    case 'YYYY-MM-DD': return `${Y}-${M}-${D}`;
    case 'YYYY/MM': return `${Y}/${M}`;
    case 'YYYY-MM':
    default: return `${Y}-${M}`;
  }
}
