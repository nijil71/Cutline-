// Turning a browser <title> into a usable subject.
//
// Titles are written for humans skimming a tab strip, not for filenames. They
// carry unread counters, browser suffixes, profile names and SEO boilerplate.
// Everything here is about stripping that back to the words that identify the
// page.

import { stripInvisible } from './text-utils.js';

// Applied repeatedly until stable — Edge produces stacked suffixes like
// "Title and 4 more pages - Personal - Microsoft Edge", and there is a
// zero-width space inside Edge's own name, hence stripInvisible running first.
const TRAILING_NOISE = [
  /\s*[-–—|]\s*(Google Chrome|Chromium|Microsoft\s*Edge|Mozilla Firefox|Firefox|Brave|Opera|Vivaldi|Safari|Arc)\s*$/i,
  /\s+and\s+\d+\s+more\s+pages?\s*$/i,
  /\s*[-–—]\s*(Personal|Work|Profile\s*\d+)\s*$/i,
  /\s*[-–—]\s*(Visual Studio Code|Visual Studio)\s*$/i,
];

const LEADING_NOISE = [
  /^\s*[([]\d+[)\]]\s*/,                    // (3) unread
  /^\s*\d+\s+new\s+\w+\s*[-–—]\s*/i,
  /^\s*[•●∙*◦·]\s*/,                        // modified / unsaved markers
];

const SEPARATORS = /\s+[|·»•]\s+|\s+[-–—]\s+|\s+::\s+|\s+:\s+/;

// Words that never help identify a screenshot.
const FILLER = new Set([
  'a', 'an', 'and', 'at', 'be', 'best', 'buy', 'by', 'cheap', 'deals', 'delivery',
  'discount', 'for', 'free', 'from', 'get', 'in', 'india', 'is', 'low', 'my',
  'new', 'of', 'off', 'offer', 'offers', 'official', 'on', 'online', 'or',
  'order', 'our', 'page', 'price', 'prices', 'purchase', 'reviews', 'sale',
  'shipping', 'shop', 'site', 'store', 'the', 'to', 'top', 'up', 'website',
  'welcome', 'with', 'your',
]);

// Segments that are pure site identity rather than page identity.
const SITE_SEGMENT = /^(home|homepage|dashboard|untitled|new tab|index|login|sign in|sign up)$/i;

export function stripTitleNoise(title) {
  if (!title) return '';
  let s = stripInvisible(title).trim();

  let changed = true;
  while (changed) {
    changed = false;
    for (const re of [...TRAILING_NOISE, ...LEADING_NOISE]) {
      const next = s.replace(re, '');
      if (next !== s) { s = next.trim(); changed = true; }
    }
  }
  return s;
}

/**
 * Pick the segment of a title that names the page.
 *
 * Web convention is `Page Title | Site Name`, so the first segment is almost
 * always the right one — taking the *longest* segment would give "Mendix
 * Documentation" instead of "Getting started". We only move past the first
 * segment when it is obviously junk.
 */
export function pickSegment(title, scope = '') {
  const cleaned = stripTitleNoise(title);
  if (!cleaned) return '';

  const segments = cleaned.split(SEPARATORS).map((x) => x.trim()).filter(Boolean);
  if (!segments.length) return cleaned;

  const scopeBare = String(scope).toLowerCase().replace(/[^a-z0-9]/g, '');
  const isJunk = (seg) => {
    const bare = seg.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (bare.length < 3) return true;
    if (SITE_SEGMENT.test(seg.trim())) return true;
    if (scopeBare && bare === scopeBare) return true; // segment is just the site name
    return false;
  };

  for (const seg of segments) if (!isJunk(seg)) return seg;
  return segments[0];
}

/**
 * Reduce a title to the words worth putting in a filename.
 * Falls back to the unfiltered words when filtering would leave nothing.
 */
export function subjectWords(title, opts = {}) {
  const { scope = '', maxWords = 5 } = opts;
  const segment = pickSegment(title, scope);
  if (!segment) return [];

  const raw = segment
    .split(/[^A-Za-z0-9]+/)
    .map((w) => w.trim())
    .filter(Boolean);

  const scopeLower = String(scope).toLowerCase();
  const filtered = raw.filter(
    (w) => !FILLER.has(w.toLowerCase()) && w.toLowerCase() !== scopeLower,
  );

  // Aggressive filtering can empty out a legitimately short title.
  const words = filtered.length >= 2 ? filtered : raw;
  return words.slice(0, maxWords);
}

export const _internals = { FILLER, SEPARATORS, TRAILING_NOISE };
