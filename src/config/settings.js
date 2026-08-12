import { DEFAULTS, withDefaults } from './defaults.js';

const KEY = 'cutline.settings';

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
