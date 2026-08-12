// Default settings. Kept free of chrome.* so tests can import it directly.

export const DEFAULTS = {
  /** Relative to the browser's Downloads folder — the only place we may write. */
  baseFolder: 'Screenshots',

  /** Date folders are derived from a fact, so they are never miscategorised. */
  useDateFolder: true,
  dateFolderFormat: 'YYYY-MM',   // YYYY | YYYY-MM | YYYY-MM-DD | YYYY/MM

  maxWords: 5,
  maxNameLength: 60,

  copyToClipboard: true,
  showToast: true,
  toastSeconds: 4,

  /**
   * Host globs (and `/path` fragments) that always produce a bare timestamp.
   * Deliberately opinionated out of the box: the cost of a missing name is
   * nothing, the cost of a leaked one is real.
   */
  privateHosts: [
    '*bank*',
    '*.paypal.com',
    'paypal.com',
    '*.stripe.com',
    '1password.com',
    '*.1password.com',
    'vault.bitwarden.com',
    '*.lastpass.com',
    'accounts.google.com',
    'login.microsoftonline.com',
    '*.coinbase.com',
    '/login',
    '/signin',
    '/sign-in',
    '/password',
    '/checkout',
  ],

  /**
   * Host glob -> subfolder. Empty by default: a misfiled screenshot is harder
   * to find than a well-named one in a flat folder, so the user opts in.
   * e.g. { pattern: '*.atlassian.net', folder: 'Work' }
   */
  folderRules: [],
};

/** Shallow-merge stored settings over the defaults, ignoring unknown keys. */
export function withDefaults(stored) {
  const out = { ...DEFAULTS };
  if (!stored || typeof stored !== 'object') return out;
  for (const key of Object.keys(DEFAULTS)) {
    if (stored[key] !== undefined && stored[key] !== null) out[key] = stored[key];
  }
  return out;
}
