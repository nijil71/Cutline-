// Service worker: owns the privileged half of a capture.
//
// Ordering matters here. The tab is captured BEFORE the overlay is drawn, so
// the frozen image the user drags over is the clean page rather than a picture
// of our own UI. The content script then does the cropping (it has a real DOM)
// and sends the PNG back for download.

import { loadSettings } from './config/settings.js';
import { buildName, sanitizeFileBase } from './naming/name-engine.js';

const CONTENT_SCRIPT = 'src/content/capture.js';
const CONTENT_STYLES = 'src/content/overlay.css';

/** Pages where extensions are not allowed to run, so we fail loudly not silently. */
const RESTRICTED = [
  /^chrome:\/\//i,
  /^edge:\/\//i,
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
    notify(`Cutline cannot run on this page. ${String(err && err.message || err)}`);
    return;
  }

  let shot;
  try {
    shot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  } catch (err) {
    notify(`Capture failed: ${String(err && err.message || err)}`);
    return;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, {
      k: 'cutline:begin',
      mode,
      shot,
      settings,
      incognito: Boolean(tab.incognito),
    });
  } catch (err) {
    notify(`Could not start the overlay: ${String(err && err.message || err)}`);
  }
}

chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (command === 'capture-region') await startCapture(tab, 'region');
  else if (command === 'capture-viewport') await startCapture(tab, 'viewport');
});

chrome.action.onClicked.addListener((tab) => startCapture(tab, 'region'));

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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.k !== 'string') return undefined;

  // The naming engine lives here rather than in the content script so a page
  // can never see or influence it.
  if (msg.k === 'cutline:propose') {
    (async () => {
      try {
        const settings = await loadSettings();
        const ctx = { ...(msg.ctx || {}), incognito: Boolean(sender.tab && sender.tab.incognito) };
        sendResponse({ ok: true, proposal: buildName(ctx, settings) });
      } catch (err) {
        sendResponse({ ok: false, error: String(err && err.message || err) });
      }
    })();
    return true; // async response
  }

  if (msg.k === 'cutline:save') {
    (async () => {
      try {
        sendResponse(await saveImage(msg));
      } catch (err) {
        sendResponse({ ok: false, error: String(err && err.message || err) });
      }
    })();
    return true;
  }

  if (msg.k === 'cutline:open-options') {
    chrome.runtime.openOptionsPage();
    return undefined;
  }

  return undefined;
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') chrome.runtime.openOptionsPage();
});
