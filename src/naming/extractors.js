// Signal extraction from page text.
//
// Every extractor here returns null rather than guessing. A confidently wrong
// filename is worse than a timestamp, because it looks meaningful and isn't.

/* ------------------------------------------------------------------ tickets */

// Single-letter project keys are legal and do occur (`Q-413488`), so the
// prefix is allowed to be one character. The corroboration rules below are
// what keep that from matching everything.
const TICKET_RE = /\b([A-Z][A-Z0-9]{0,9})-(\d{1,6})\b/g;

// Prefixes that look exactly like issue keys but never are. This list is why
// untrusted matches also have to appear in the page title (see findTicket).
const NOT_A_TICKET = new Set([
  'AES', 'ANSI', 'ASCII', 'CET', 'COVID', 'CSS', 'DDR', 'EN', 'ES', 'GB', 'GMT',
  'GTX', 'H', 'HDMI', 'HTML', 'HTTP', 'HTTPS', 'IEEE', 'IPV', 'ISBN', 'ISO',
  'JPEG', 'KB', 'LPDDR', 'MB', 'MD', 'MP', 'NVME', 'PB', 'PCIE', 'PDF', 'RFC',
  'RSA', 'RTX', 'RX', 'SHA', 'TB', 'TLS', 'USB', 'UTC', 'UTF', 'WCAG', 'X',
]);

/**
 * @param {string} text
 * @param {{trusted?: boolean, title?: string}} [opts]
 *   trusted — the URL or a site adapter already told us this is a tracker, so
 *   a bare regex hit is believable. Otherwise the key must also appear in the
 *   page title before we'll use it.
 */
export function findTicket(text, opts = {}) {
  const { trusted = false, title = '' } = opts;
  if (!text) return null;

  TICKET_RE.lastIndex = 0;
  const candidates = [];
  let m;
  while ((m = TICKET_RE.exec(text)) !== null) {
    const key = m[0];
    const prefix = m[1];
    const digits = m[2];
    if (NOT_A_TICKET.has(prefix)) continue;

    const inTitle = Boolean(title && title.includes(key));
    if (!trusted && !inTitle) continue;

    candidates.push({ key, inTitle, digitLen: digits.length, prefixLen: prefix.length });
  }
  if (!candidates.length) return null;

  // A key in the title beats one buried in body text; failing that, longer
  // keys are likelier to be real than an incidental "A-1".
  candidates.sort((a, b) =>
    (Number(b.inTitle) - Number(a.inTitle)) ||
    (b.digitLen - a.digitLen) ||
    (b.prefixLen - a.prefixLen));

  return candidates[0].key;
}

/* ------------------------------------------------------------------- prices */

const PRICE_RE =
  /(?:₹|Rs\.?\s?|INR\s?|\$|US\$|€|£|¥)\s*([0-9][0-9,]{0,12}(?:\.[0-9]{1,2})?)/g;

/** Returns a digits-only string like "79999", or null. */
export function findPrice(text) {
  if (!text) return null;

  PRICE_RE.lastIndex = 0;
  let m;
  while ((m = PRICE_RE.exec(text)) !== null) {
    // Test the numeric value *before* normalising: the filename form turns
    // "45.50" into "45-50", which is not a number.
    const value = Number(String(m[1]).replace(/,/g, ''));
    // Sub-currency-unit hits are almost always shipping or tax lines.
    if (!Number.isFinite(value) || value < 1) continue;

    const normalized = normalizePrice(m[1]);
    if (normalized) return normalized;
  }
  return null;
}

export function normalizePrice(raw) {
  if (raw == null) return null;
  const cleaned = String(raw).replace(/,/g, '');
  if (!/^[0-9]+(\.[0-9]{1,2})?$/.test(cleaned)) return null;
  // Drop trailing .00 — nobody wants `-7999900` or `-7999-00` in a filename.
  return cleaned.replace(/\.0+$/, '').replace(/\./g, '-');
}

/* ------------------------------------------------------------------- errors */

const EXCEPTION_RE =
  /\b((?:[A-Za-z_$][\w$]*\.)*[A-Z][A-Za-z0-9_$]*(?:Exception|Error))\b/g;

// Package/namespace segments that carry no identifying information.
const GENERIC_SEGMENT = new Set([
  'android', 'api', 'base', 'client', 'com', 'common', 'core', 'crypto',
  'error', 'errors', 'exception', 'exceptions', 'impl', 'internal', 'io',
  'java', 'javax', 'lang', 'microsoft', 'net', 'org', 'runtime', 'server',
  'sun', 'system', 'util', 'utils', 'www',
]);

function splitCamel(s) {
  return String(s)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[\s_$]+/)
    .filter(Boolean);
}

// Evidence that an exception name is being *reported* rather than merely
// mentioned. Without this, an MDN page about TypeError, or any blog post that
// says "ReferenceError", would name the screenshot after it.
const ERROR_CONTEXT_NEAR = [
  /caused by/i,
  /stack\s*trace/i,
  /traceback/i,
  /\bunhandled\b/i,
  /\buncaught\b/i,
  /\bthrew\b|\bthrown\b/i,
  /exception in thread/i,
  /\berror\s*:/i,
  /\bexception\s*:/i,
  /\bfailed\b/i,
];

// A stack frame reads `    at com.acme.Thing`, so the evidence sits directly
// before the class name. It has to be anchored to the end of the preceding
// text: the identifier that would normally follow `at` is the match itself,
// which is deliberately excluded from the context window.
const STACK_FRAME_BEFORE = /(^|\n)[ \t]*at[ \t]+$/;

/**
 * Turn `org.bouncycastle.crypto.InvalidCipherTextException` into
 * `["bouncycastle","invalid","cipher","text"]` — the distinctive package
 * segment plus the class name, minus the Exception/Error suffix.
 *
 * @param {string} text
 * @param {{maxWords?: number, requireContext?: boolean}} [opts]
 *   requireContext — demand nearby stack-trace/failure wording. Used for
 *   whole-page text, skipped for a deliberate selection (selecting the text
 *   *is* the signal).
 */
export function findError(text, opts = {}) {
  const { maxWords = 4, requireContext = false } = opts;
  if (!text) return null;

  EXCEPTION_RE.lastIndex = 0;
  let m;
  while ((m = EXCEPTION_RE.exec(text)) !== null) {
    const full = m[1];

    if (requireContext) {
      // Look either side of the match, never at the match itself — the class
      // name contains "Exception"/"Error" and would vacuously satisfy the test.
      const before = text.slice(Math.max(0, m.index - 160), m.index);
      const after = text.slice(m.index + full.length, m.index + full.length + 160);
      const around = `${before}\n${after}`;
      const supported =
        STACK_FRAME_BEFORE.test(before) || ERROR_CONTEXT_NEAR.some((re) => re.test(around));
      if (!supported) continue;
    }

    const segments = full.split('.');
    const className = segments[segments.length - 1];

    // A bare "Error" or "Exception" tells us nothing.
    const stripped = className.replace(/(Exception|Error)$/, '');
    if (!stripped) continue;

    const pkgSegments = segments
      .slice(0, -1)
      .filter((s) => !GENERIC_SEGMENT.has(s.toLowerCase()));
    // Most specific package segment is the last surviving one.
    const pkgWord = pkgSegments.length ? pkgSegments[pkgSegments.length - 1] : '';

    const words = [...(pkgWord ? [pkgWord] : []), ...splitCamel(stripped)];
    if (!words.length) continue;
    return words.slice(0, maxWords).map((w) => w.toLowerCase());
  }
  return null;
}

// Either an explicit label ("HTTP 500", "status: 404", "error 403") or a
// number followed by its real reason phrase. A bare `[45]\d\d` is far too
// common in ordinary text — "There are 500 Results" is not an outage.
const HTTP_STATUS_RE = new RegExp(
  '\\b(?:HTTP|status(?:\\s*code)?|error)\\s*[:=]?\\s*([45]\\d{2})\\b' +
  '|\\b([45]\\d{2})\\s+(?:Not Found|Forbidden|Unauthorized|Bad Request|' +
  'Internal Server Error|Bad Gateway|Service Unavailable|Gateway Timeout|' +
  'Too Many Requests|Not Acceptable|Conflict|Gone|Payload Too Large|' +
  'Unprocessable Entity|Request Timeout|Method Not Allowed)\\b',
  'i',
);

/** e.g. "404 Not Found", "HTTP 500", "502 Bad Gateway" -> "404" */
export function findHttpStatus(text) {
  if (!text) return null;
  const m = HTTP_STATUS_RE.exec(text);
  if (!m) return null;
  return m[1] || m[2] || null;
}

/** Numeric value of a price-ish string, or NaN. Used to reject 0 and junk. */
export function priceValue(raw) {
  if (raw == null) return NaN;
  return Number(String(raw).replace(/[^0-9.]/g, ''));
}

const FAILURE_PHRASE_RE =
  /\b(?:failed to|unable to|cannot|could not|couldn't)\s+([a-z]+(?:\s+[a-z]+){0,2})/i;

/** Last-resort error wording when there is no exception class to grab. */
export function findFailurePhrase(text) {
  if (!text) return null;
  const m = FAILURE_PHRASE_RE.exec(text);
  if (!m) return null;
  return m[1].toLowerCase().split(/\s+/).filter(Boolean);
}

export const _internals = { NOT_A_TICKET, GENERIC_SEGMENT, splitCamel };
