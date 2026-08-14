// Service worker: owns the privileged half of a capture.
//
// Ordering matters here. For region and viewport captures the tab is captured
// BEFORE the overlay is drawn, so the frozen image the user drags over is the
// clean page rather than a picture of our own UI. The content script does the
// cropping and stitching (it has a real DOM) and sends the PNG back to save.

import { loadSettings, migrateLegacySettings } from './config/settings.js';
import { buildName, sanitizeFileBase } from './naming/name-engine.js';

const CONTENT_SCRIPT = 'src/content/capture.js';
const CONTENT_STYLES = 'src/content/overlay.css';

// Chrome caps captureVisibleTab at roughly two calls a second and throws once
// the quota is exceeded. Full-page capture makes many calls back to back, so
// they are paced here rather than hoping for the best.
const MIN_GRAB_INTERVAL_MS = 600;
const QUOTA_BACKOFF_MS = 1200;

/** Pages where extensions are not allowed to run, so we fail loudly not silently. */
const RESTRICTED = [
  /^chrome:\/\//i,
  /^edge:\/\//i,
  /^brave:\/\//i,
  /^about:/i,
  /^devtools:\/\//i,
  /^view-source:/i,
  /^chrome-extension:\/\//i,
  /^https:\/\/chromewebstore\.google\.com/i,
  /^https:\/\/chrome\.google\.com\/webstore/i,
  /^https:\/\/microsoftedge\.microsoft\.com\/addons/i,
];

function restrictionFor(url) {
  if (!url) return 'This tab has no address Cutline can read.';
  if (RESTRICTED.some((re) => re.test(url))) {
    return 'Browsers block extensions on internal pages. Try a normal web page.';
  }
  if (/^file:\/\//i.test(url)) {
    return 'Enable "Allow access to file URLs" on the extensions page to capture local files.';
  }
  return null;
}

function notify(message, title = 'Cutline') {
  try {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title,
      message,
    });
  } catch {
    // Notifications are a nicety; never let them break a capture path.
  }
}

const errText = (err) => String((err && err.message) || err);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* --------------------------------------------------------------- capturing */

let lastGrabAt = 0;

async function grabVisible(windowId) {
  const wait = MIN_GRAB_INTERVAL_MS - (Date.now() - lastGrabAt);
  if (wait > 0) await sleep(wait);

  try {
    lastGrabAt = Date.now();
    return await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
  } catch (err) {
    // One retry: the quota window is short, and losing a whole full-page
    // capture to a single throttled frame would be a poor trade.
    if (!/quota/i.test(errText(err))) throw err;
    await sleep(QUOTA_BACKOFF_MS);
    lastGrabAt = Date.now();
    return chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
  }
}

function setProgress(done, total) {
  const showing = total > 0 && done > 0 && done < total;
  chrome.action.setBadgeText({ text: showing ? String(Math.round((done / total) * 100)) : '' });
  if (showing) chrome.action.setBadgeBackgroundColor({ color: '#6366f1' });
}

/* ------------------------------------------------------------- entry points */

async function startCapture(tab, mode) {
  if (!tab || tab.id == null) return;

  const blocked = restrictionFor(tab.url);
  if (blocked) { notify(blocked); return; }

  let settings;
  try {
    settings = await loadSettings();
  } catch {
    notify('Could not read settings.');
    return;
  }

  // Inject first: this adds no pixels (the overlay is only built on `begin`),
  // and it means the content script is listening before the image arrives.
  try {
    await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: [CONTENT_STYLES] });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: [CONTENT_SCRIPT] });
  } catch (err) {
    notify(`Cutline cannot run on this page. ${errText(err)}`);
    return;
  }

  // Full-page capture drives its own frames after each scroll, so a pre-capture
  // here would only burn a slot against the throttle.
  let shot = null;
  if (mode !== 'fullpage') {
    try {
      shot = await grabVisible(tab.windowId);
    } catch (err) {
      notify(`Capture failed: ${errText(err)}`);
      return;
    }
  }

  try {
    await chrome.tabs.sendMessage(tab.id, { k: 'cutline:begin', mode, shot, settings });
  } catch (err) {
    notify(`Could not start the overlay: ${errText(err)}`);
  }
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

const COMMANDS = {
  'capture-region': 'region',
  'capture-viewport': 'viewport',
  'capture-fullpage': 'fullpage',
};

chrome.commands.onCommand.addListener(async (command) => {
  const mode = COMMANDS[command];
  if (mode) await startCapture(await activeTab(), mode);
});

// The toolbar icon stays a one-click region capture — that is the common case
// and putting a popup in front of it would tax every use.
chrome.action.onClicked.addListener((tab) => startCapture(tab, 'region'));

/* ------------------------------------------------------------ context menu */

// Without this, full-page capture is reachable only by keyboard shortcut, and
// a user whose shortcut collides with something else would conclude the
// feature does not exist. Clicking a context menu item grants activeTab the
// same way the shortcut does, so this costs no extra page access.
const MENU_ITEMS = [
  { id: 'cutline-region', title: 'Capture region', mode: 'region' },
  { id: 'cutline-viewport', title: 'Capture visible page', mode: 'viewport' },
  { id: 'cutline-fullpage', title: 'Capture full scrolling page', mode: 'fullpage' },
];

const MENU_CONTEXTS = ['page', 'selection', 'image'];

function buildMenus() {
  // removeAll first: menu registrations survive a service worker restart, and
  // re-creating an existing id throws.
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'cutline-root',
      title: 'Cutline',
      contexts: MENU_CONTEXTS,
    });
    for (const item of MENU_ITEMS) {
      chrome.contextMenus.create({
        id: item.id,
        parentId: 'cutline-root',
        title: item.title,
        contexts: MENU_CONTEXTS,
      });
    }
  });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const item = MENU_ITEMS.find((m) => m.id === info.menuItemId);
  if (item) startCapture(tab, item.mode);
});

chrome.runtime.onStartup.addListener(buildMenus);

/* ----------------------------------------------------------------- messages */

async function saveImage({ png, base, folder }) {
  if (typeof png !== 'string' || !png.startsWith('data:image/png;base64,')) {
    throw new Error('unexpected image payload');
  }
  // The name may have been hand-edited in the toast, so it is untrusted input.
  const filename = [folder, `${sanitizeFileBase(base)}.png`].filter(Boolean).join('/');
  // `uniquify` gives us collision handling for free — a second
  // `amazon-lenovo-legion-79999.png` becomes `... (1).png` rather than
  // clobbering the first.
  const id = await chrome.downloads.download({
    url: png,
    filename,
    conflictAction: 'uniquify',
    saveAs: false,
  });
  return { ok: true, id, filename };
}

/**
 * A frame for the stitcher. Refuses if the requesting tab is no longer the
 * visible one — captureVisibleTab would happily photograph whatever the user
 * switched to and splice it into the middle of their screenshot.
 */
async function grabForSender(sender) {
  const tab = sender && sender.tab;
  if (!tab || tab.id == null) throw new Error('no tab');

  const [visible] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
  if (!visible || visible.id !== tab.id) {
    throw new Error('tab stopped being visible — capture aborted');
  }
  return grabVisible(tab.windowId);
}

const HANDLERS = {
  // The naming engine lives here rather than in the content script so a page
  // can never see or influence it.
  'cutline:propose': async (msg, sender) => {
    const settings = await loadSettings();
    const ctx = { ...(msg.ctx || {}), incognito: Boolean(sender.tab && sender.tab.incognito) };
    return { ok: true, proposal: buildName(ctx, settings) };
  },

  'cutline:grab': async (_msg, sender) => ({ ok: true, shot: await grabForSender(sender) }),

  'cutline:save': async (msg) => saveImage(msg),

  'cutline:progress': async (msg) => {
    setProgress(Number(msg.done) || 0, Number(msg.total) || 0);
    return { ok: true };
  },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.k !== 'string') return undefined;

  if (msg.k === 'cutline:open-options') {
    chrome.runtime.openOptionsPage();
    return undefined;
  }

  const handler = HANDLERS[msg.k];
  if (!handler) return undefined;

  (async () => {
    try {
      sendResponse(await handler(msg, sender));
    } catch (err) {
      setProgress(0, 0);
      sendResponse({ ok: false, error: errText(err) });
    }
  })();
  return true; // async response
});

chrome.runtime.onInstalled.addListener((details) => {
  buildMenus();
  if (details.reason === 'update') migrateLegacySettings();
  if (details.reason === 'install') chrome.runtime.openOptionsPage();
});
