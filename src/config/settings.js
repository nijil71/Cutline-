import { DEFAULTS, withDefaults } from './defaults.js';

const KEY = 'cutline.settings';

// The storage key changed when the project was renamed. Anyone updating from a
// build that predates the rename would otherwise silently lose their
// private-sites list and folder rules — the settings would still be sitting in
// storage under the old key, invisible and unreachable.
const LEGACY_KEY = 'stool.settings';

/**
 * One-shot move of pre-rename settings onto the current key. Safe to run on
 * every update: it does nothing once the old key is gone, and never overwrites
 * settings that already exist under the new key.
 */
export async function migrateLegacySettings() {
  try {
    const stored = await chrome.storage.sync.get([LEGACY_KEY, KEY]);
    const legacy = stored && stored[LEGACY_KEY];
    if (!legacy) return false;

    if (!stored[KEY]) await chrome.storage.sync.set({ [KEY]: withDefaults(legacy) });
    await chrome.storage.sync.remove(LEGACY_KEY);
    return true;
  } catch {
    // Losing a migration is recoverable; failing to start is not.
    return false;
  }
}

export async function loadSettings() {
  try {
    const got = await chrome.storage.sync.get(KEY);
    return withDefaults(got && got[KEY]);
  } catch {
    // sync storage can be unavailable (quota, managed profile); never block a
    // capture over settings.
    return { ...DEFAULTS };
  }
}

export async function saveSettings(patch) {
  const current = await loadSettings();
  const next = withDefaults({ ...current, ...patch });
  await chrome.storage.sync.set({ [KEY]: next });
  return next;
}

export async function resetSettings() {
  await chrome.storage.sync.remove(KEY);
  return { ...DEFAULTS };
}

export { DEFAULTS, withDefaults };
