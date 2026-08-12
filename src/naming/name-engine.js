// Composes a filename from page context.
//
// Pure — no chrome.*, no DOM. Everything the engine needs arrives in `ctx`,
// which is why this file is directly unit-testable (see test/).

import { slug, joinSlug, timestampSlug, dateFolder } from './slug.js';
import { subjectWords } from './title-clean.js';
import { stripControls } from './text-utils.js';
import {
  findTicket, findPrice, findError, findHttpStatus, normalizePrice,
} from './extractors.js';

/* -------------------------------------------------------------------- scope */

// Suffix labels stripped when reducing a hostname to its identifying label.
const TLD_LABELS = new Set([
  'ae', 'ai', 'app', 'ar', 'at', 'au', 'be', 'biz', 'br', 'ca', 'cc', 'ch',
  'cl', 'cloud', 'cn', 'co', 'com', 'cz', 'de', 'dev', 'dk', 'edu', 'es', 'fi',
  'fr', 'gg', 'gov', 'gr', 'hk', 'hu', 'id', 'ie', 'il', 'in', 'info', 'int',
  'io', 'it', 'jp', 'kr', 'ly', 'me', 'mil', 'mx', 'my', 'net', 'nl', 'no',
  'nz', 'online', 'org', 'page', 'pe', 'ph', 'pl', 'pt', 'ro', 'ru', 'sa',
  'se', 'sg', 'sh', 'site', 'store', 'tech', 'th', 'to', 'tr', 'tv', 'ua',
  'uk', 'us', 'vn', 'xyz', 'za',
]);

// Hosts whose useful name is not their domain label.
const SCOPE_OVERRIDES = [
  [/\.atlassian\.net$/i, 'jira'],
  [/^linear\.app$/i, 'linear'],
  [/^github\.com$/i, 'github'],
  [/^gitlab\.com$/i, 'gitlab'],
  [/^dev\.azure\.com$/i, 'azdo'],
  [/^mail\.google\.com$/i, 'gmail'],
  [/^docs\.google\.com$/i, 'gdocs'],
  [/^drive\.google\.com$/i, 'gdrive'],
  [/^calendar\.google\.com$/i, 'gcal'],
  [/\.slack\.com$/i, 'slack'],
  [/^teams\.microsoft\.com$/i, 'teams'],
  [/\.sharepoint\.com$/i, 'sharepoint'],
  [/\.zendesk\.com$/i, 'zendesk'],
  [/\.mendixcloud\.com$/i, 'mendix'],
  [/\.mendix\.com$/i, 'mendix'],
];

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

/** `www.amazon.in` -> `amazon`, `docs.mendix.com` -> `mendix`. */
export function scopeFromUrl(url) {
  const host = hostOf(url);
  if (!host) return '';
  if (host === 'localhost' || host === '[::1]') return 'local';
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return 'local';

  for (const [re, name] of SCOPE_OVERRIDES) if (re.test(host)) return name;

  const labels = host.split('.');
  while (labels.length > 1 && TLD_LABELS.has(labels[labels.length - 1])) labels.pop();
  return labels[labels.length - 1] || host;
}

/* ------------------------------------------------------------------ matching */

export function globToRegExp(pattern) {
  const escaped = String(pattern)
    .trim()
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

/**
 * Screenshots are the most sensitive file type on a machine, and the filename
 * itself leaks — `amex-statement-balance-42000.png` in a screenshare is an
 * exposure a timestamp never was. When in doubt we say nothing.
 *
 * Patterns beginning with `/` are matched against the URL path, everything
 * else against the hostname.
 */
export function isPrivate(url, patterns = []) {
  const host = hostOf(url);
  if (!host) return false;
  let path = '';
  try { path = new URL(url).pathname.toLowerCase(); } catch { /* not a URL */ }

  for (const raw of patterns) {
    const pattern = String(raw || '').trim();
    if (!pattern) continue;
    if (pattern.startsWith('/')) {
      if (path.includes(pattern.replace(/\*/g, '').toLowerCase())) return true;
      continue;
    }
    if (globToRegExp(pattern).test(host)) return true;
  }
  return false;
}

/* ------------------------------------------------------------------- folders */

// Characters Windows rejects in a path component. Spaces and hyphens are
// deliberately kept — stripping them would turn `2026-08` into `202608`.
const BAD_PATH_CHARS = /[<>:"|?*\\]/g;

export function sanitizeFolderSegment(seg) {
  return stripControls(seg)
    .replace(BAD_PATH_CHARS, '')
    .replace(/\.+/g, '.')       // collapses `..` so it cannot traverse
    .replace(/^\.+|\.+$/g, '')
    .trim();
}

/**
 * Final gate before a name reaches chrome.downloads. The toast lets the user
 * type anything, so path separators and traversal have to die here rather than
 * relying on the browser to reject them.
 */
export function sanitizeFileBase(base, maxLen = 120) {
  const cleaned = stripControls(base)
    .replace(/[/\\]/g, '-')
    .replace(BAD_PATH_CHARS, '')
    .replace(/\.+/g, '.')
    .replace(/^[.\-\s]+|[.\-\s]+$/g, '')
    .slice(0, maxLen)
    .trim();
  return cleaned || `screenshot-${timestampSlug()}`;
}

export function folderFor(url, settings, now = new Date()) {
  const host = hostOf(url);
  const segments = [];

  if (settings.baseFolder) segments.push(settings.baseFolder);

  // Rules match on host, never on a semantic guess. Inspectable and editable.
  const rule = (settings.folderRules || []).find(
    (r) => r && r.pattern && r.folder && globToRegExp(r.pattern).test(host),
  );
  if (rule) segments.push(rule.folder);

  if (settings.useDateFolder) segments.push(dateFolder(settings.dateFolderFormat, now));

  return segments
    .flatMap((s) => String(s).split('/'))
    .map(sanitizeFolderSegment)
    .filter(Boolean)
    .join('/');
}

/* ---------------------------------------------------------------- structured */

function typesOf(node) {
  const t = node && node['@type'];
  if (!t) return [];
  return (Array.isArray(t) ? t : [t]).map((x) => String(x).toLowerCase());
}

/**
 * Pull name+price out of schema.org markup. This is the single biggest quality
 * win an extension has over OCR: the site declares its own product name and
 * price, so there is nothing to guess.
 */
export function productFromJsonLd(nodes) {
  if (!Array.isArray(nodes)) return null;

  const flat = [];
  const push = (n) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(push); return; }
    flat.push(n);
    if (Array.isArray(n['@graph'])) n['@graph'].forEach(push);
  };
  nodes.forEach(push);

  const product = flat.find((n) => typesOf(n).includes('product'));
  if (!product) return null;

  let price = null;
  const offers = Array.isArray(product.offers) ? product.offers[0] : product.offers;
  if (offers && typeof offers === 'object') {
    price = offers.price != null ? offers.price : (offers.lowPrice != null ? offers.lowPrice : null);
  }

  const name = typeof product.name === 'string' ? product.name : null;
  if (!name && price == null) return null;
  return { name, price: price == null ? null : String(price) };
}

/* ---------------------------------------------------------------- the engine */

/**
 * @param {object} ctx   page context gathered by the content script
 * @param {object} settings
 * @param {Date}   [now]
 * @returns {{base:string, folder:string, confidence:'high'|'medium'|'low',
 *            reason:string, redacted:boolean}}
 */
export function buildName(ctx, settings, now = new Date()) {
  const s = settings || {};
  const maxLen = s.maxNameLength || 60;
  const folder = folderFor(ctx.url, s, now);

  const redacted = Boolean(ctx.incognito) || isPrivate(ctx.url, s.privateHosts);
  if (redacted) {
    return {
      base: `screenshot-${timestampSlug(now)}`,
      folder,
      confidence: 'low',
      reason: 'private context — timestamp only',
      redacted: true,
    };
  }

  const adapter = ctx.adapter || {};
  const scope = adapter.scope || scopeFromUrl(ctx.url);
  const scopeSlug = slug(scope, { maxLen: 20 });

  const haystack = [ctx.selection, ctx.title, ctx.text].filter(Boolean).join('\n');

  const ticket =
    adapter.ticket ||
    findTicket(haystack, { trusted: Boolean(adapter.trustedTicket), title: ctx.title || '' });

  const product = productFromJsonLd(ctx.jsonld);
  let titleSource = adapter.subject || (product && product.name) || ctx.title || '';
  // Titles usually repeat the issue key ("[Q-413488] Payment gateway timeout").
  // Left in, it is re-tokenised into the subject, deduped away by joinSlug, and
  // silently eats the word budget — you get `jira-Q-413488-payment` instead of
  // `jira-Q-413488-payment-gateway-timeout`.
  if (ticket) titleSource = titleSource.split(ticket).join(' ');

  const words = subjectWords(titleSource, { scope, maxWords: s.maxWords || 5 });
  const subject = (n) => words.slice(0, n).map((w) => slug(w, { maxLen: 20 })).filter(Boolean);

  const errorWords = findError(ctx.selection) || findError(ctx.text);
  const status = findHttpStatus(ctx.selection || '') || findHttpStatus(ctx.title || '');

  // Only trust a price when the page actually claims to be selling something.
  // A blog post that mentions "$100" must not become `-100`.
  const ogType = String((ctx.meta && ctx.meta['og:type']) || '');
  const adapterPrice = adapter.price != null ? adapter.price : null;
  const jsonLdPrice = product && product.price != null ? product.price : null;
  const isCommerce = adapterPrice != null || jsonLdPrice != null || /product|item/i.test(ogType);
  const price = isCommerce
    ? normalizePrice(adapterPrice != null ? adapterPrice
      : (jsonLdPrice != null ? jsonLdPrice : findPrice(haystack)))
    : null;

  let parts;
  let confidence;
  let reason;

  if (ticket) {
    // Issue keys stay uppercase — that is how people search for them.
    parts = [scopeSlug, slug(ticket, { lower: false, maxLen: 16 }), ...subject(3)];
    confidence = 'high';
    reason = `issue key ${ticket}`;
  } else if (errorWords) {
    parts = [scopeSlug, ...errorWords.map((w) => slug(w, { maxLen: 20 })), 'error'];
    confidence = 'high';
    reason = `exception ${errorWords.join(' ')}`;
  } else if (status) {
    parts = [scopeSlug, ...subject(3), status, 'error'];
    confidence = 'high';
    reason = `HTTP ${status}`;
  } else if (price) {
    // Five words, not four: product names end in model numbers that matter
    // ("Legion 5i Gen 9"), and maxNameLength is the real guard against sprawl.
    parts = [scopeSlug, ...subject(5), price];
    confidence = 'high';
    reason = `product price ${price}`;
  } else {
    parts = [scopeSlug, ...subject(s.maxWords || 5)];
    confidence = words.length >= 2 ? 'medium' : 'low';
    reason = words.length >= 2 ? 'page title' : 'title too thin';
  }

  let base = joinSlug(parts, maxLen);

  // A single token is not a name, and neither is a low-confidence guess.
  // Rather than emit `example-home.png` for the fortieth time, fall back to
  // something honest and collision-free.
  if (confidence === 'low' || base.split('-').filter(Boolean).length < 2) {
    base = joinSlug([scopeSlug, timestampSlug(now)], maxLen) || `screenshot-${timestampSlug(now)}`;
    confidence = 'low';
    reason = 'no usable page signal — timestamp fallback';
  }

  return { base, folder, confidence, reason, redacted: false };
}
