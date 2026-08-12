import { loadSettings, saveSettings, resetSettings, DEFAULTS } from '../src/config/settings.js';
import { buildName } from '../src/naming/name-engine.js';

const $ = (id) => document.getElementById(id);

const BOOLEANS = ['useDateFolder', 'copyToClipboard', 'showToast'];
const NUMBERS = ['maxWords', 'maxNameLength', 'toastSeconds'];
const STRINGS = ['baseFolder', 'dateFolderFormat'];

/* Sample pages used for the live preview, so the effect of a settings change
   is visible before you go and take a screenshot to find out. */
const SAMPLES = [
  {
    label: 'Product',
    ctx: {
      url: 'https://www.amazon.in/dp/B0D1234',
      title: 'Buy Lenovo Legion 5i Gen 9 Gaming Laptop Online at Low Prices in India : Amazon.in',
      jsonld: [{ '@type': 'Product', name: 'Lenovo Legion 5i Gen 9', offers: { price: '79999' } }],
    },
  },
  {
    label: 'Issue',
    ctx: {
      url: 'https://acme.atlassian.net/browse/Q-413488',
      title: '[Q-413488] Payment gateway timeout on checkout - Jira',
      adapter: { scope: 'jira', ticket: 'Q-413488', trustedTicket: true },
    },
  },
  {
    label: 'Error',
    ctx: {
      url: 'https://myapp.mendixcloud.com/p/home',
      title: 'MyApp',
      selection: 'Caused by: org.bouncycastle.crypto.InvalidCipherTextException: pad block corrupted',
    },
  },
  {
    label: 'Bank (private)',
    ctx: { url: 'https://hdfcbank.com/accounts', title: 'Savings balance' },
  },
];

/* ------------------------------------------------------------- serialising */

function parseFolderRules(raw) {
  return String(raw)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const idx = line.indexOf('=>');
      if (idx === -1) return null;
      const pattern = line.slice(0, idx).trim();
      const folder = line.slice(idx + 2).trim();
      return pattern && folder ? { pattern, folder } : null;
    })
    .filter(Boolean);
}

function formatFolderRules(rules) {
  return (rules || []).map((r) => `${r.pattern} => ${r.folder}`).join('\n');
}

function readForm() {
  const out = {};
  for (const key of STRINGS) out[key] = $(key).value.trim();
  for (const key of BOOLEANS) out[key] = $(key).checked;
  for (const key of NUMBERS) {
    const n = Number($(key).value);
    out[key] = Number.isFinite(n) && n > 0 ? n : DEFAULTS[key];
  }
  out.privateHosts = $('privateHosts').value.split('\n').map((s) => s.trim()).filter(Boolean);
  out.folderRules = parseFolderRules($('folderRules').value);
  return out;
}

function writeForm(settings) {
  for (const key of STRINGS) $(key).value = settings[key];
  for (const key of BOOLEANS) $(key).checked = Boolean(settings[key]);
  for (const key of NUMBERS) $(key).value = settings[key];
  $('privateHosts').value = (settings.privateHosts || []).join('\n');
  $('folderRules').value = formatFolderRules(settings.folderRules);
}

/* ---------------------------------------------------------------- preview */

function renderPreview() {
  const settings = readForm();
  const list = $('preview');
  list.textContent = '';

  for (const sample of SAMPLES) {
    const result = buildName(sample.ctx, settings);

    const li = document.createElement('li');

    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = sample.label;

    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.dataset.c = result.confidence;
    dot.title = result.reason;

    const name = document.createElement('span');
    name.textContent = `${result.folder}/${result.base}.png`;

    li.append(label, dot, name);
    list.appendChild(li);
  }
}

/* ------------------------------------------------------------------- wiring */

let statusTimer = null;
function status(message) {
  $('status').textContent = message;
  if (statusTimer) clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { $('status').textContent = ''; }, 2500);
}

async function init() {
  writeForm(await loadSettings());
  renderPreview();

  document.addEventListener('input', renderPreview);
  document.addEventListener('change', renderPreview);

  $('save').addEventListener('click', async () => {
    await saveSettings(readForm());
    status('Saved.');
  });

  $('reset').addEventListener('click', async () => {
    writeForm(await resetSettings());
    renderPreview();
    status('Reset to defaults.');
  });

  $('shortcuts').addEventListener('click', () => {
    // chrome:// links cannot be navigated from page markup, but an extension
    // page is allowed to open one programmatically.
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  });
}

init();
