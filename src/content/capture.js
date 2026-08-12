// Content script: the half of a capture that needs a DOM.
//
// Injected on demand by the service worker (classic script, not a module).
// Responsibilities: draw the region overlay over a frozen screenshot, crop,
// read page context, and run the confirm-and-rename toast.

(() => {
  if (window.__cutlineLoaded) return;
  window.__cutlineLoaded = true;

  const ID = {
    overlay: 'cl-overlay',
    toast: 'cl-toast',
  };

  let session = null;   // { shot, settings, mode }
  let teardown = null;  // cancels whatever UI is currently up

  /* ------------------------------------------------------------- utilities */

  const text = (el) => (el && el.textContent ? el.textContent.trim() : '');

  function el(tag, className, parent) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (parent) parent.appendChild(node);
    return node;
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('could not decode capture'));
      img.src = src;
    });
  }

  /* --------------------------------------------------------- page context */

  function metaTags() {
    const out = {};
    for (const node of document.querySelectorAll('meta[property], meta[name]')) {
      const key = node.getAttribute('property') || node.getAttribute('name');
      const val = node.getAttribute('content');
      if (key && val && !(key in out)) out[key] = val;
    }
    return out;
  }

  function jsonLdNodes() {
    const out = [];
    for (const node of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        out.push(JSON.parse(node.textContent));
      } catch {
        // Malformed structured data is extremely common; just skip it.
      }
    }
    return out;
  }

  // Site adapters. These exist because a DOM selector on the real element beats
  // any amount of regex over rendered text — this is the whole reason an
  // extension names better than a screen-OCR tool can.
  const ADAPTERS = [
    {
      test: (h) => /\.atlassian\.net$/i.test(h),
      run() {
        const m = location.pathname.match(/\/browse\/([A-Za-z][A-Za-z0-9]*-\d+)/) ||
                  location.search.match(/[?&]selectedIssue=([A-Za-z][A-Za-z0-9]*-\d+)/);
        return {
          scope: 'jira',
          trustedTicket: true,
          ticket: m ? m[1].toUpperCase() : null,
          subject: text(document.querySelector('h1')) || undefined,
        };
      },
    },
    {
      test: (h) => h === 'linear.app',
      run() {
        const m = location.pathname.match(/\/issue\/([A-Za-z0-9]+-\d+)/);
        return {
          scope: 'linear',
          trustedTicket: true,
          ticket: m ? m[1].toUpperCase() : null,
          subject: text(document.querySelector('h1')) || undefined,
        };
      },
    },
    {
      test: (h) => h === 'github.com',
      run() {
        const m = location.pathname.match(/^\/([^/]+)\/([^/]+)\/(issues|pull)\/(\d+)/);
        if (!m) return { scope: 'github' };
        const kind = m[3] === 'pull' ? 'PR' : 'ISSUE';
        const heading = text(document.querySelector('.js-issue-title, bdi.js-issue-title'));
        return {
          scope: 'github',
          trustedTicket: true,
          ticket: `${kind}-${m[4]}`,
          subject: [m[2], heading].filter(Boolean).join(' ') || undefined,
        };
      },
    },
    {
      test: (h) => /(^|\.)amazon\./i.test(h),
      run() {
        const raw = text(document.querySelector(
          '.a-price .a-offscreen, #corePrice_feature_div .a-offscreen',
        ));
        const digits = raw.replace(/[^\d.]/g, '');
        return {
          scope: 'amazon',
          subject: text(document.querySelector('#productTitle')) || undefined,
          price: digits || null,
        };
      },
    },
  ];

  function runAdapter() {
    const host = location.hostname.replace(/^www\./i, '').toLowerCase();
    for (const adapter of ADAPTERS) {
      if (!adapter.test(host)) continue;
      try {
        return adapter.run() || null;
      } catch {
        return null; // a broken adapter must never block a capture
      }
    }
    return null;
  }

  function bodyTextSample() {
    try {
      // Used only for exception/ticket detection, and only ever in-process.
      return (document.body && document.body.innerText || '').slice(0, 20000);
    } catch {
      return '';
    }
  }

  function gatherContext() {
    return {
      url: location.href,
      title: document.title,
      selection: String(window.getSelection() || '').trim().slice(0, 500),
      meta: metaTags(),
      jsonld: jsonLdNodes(),
      adapter: runAdapter(),
      text: bodyTextSample(),
    };
  }

  /* ---------------------------------------------------------------- crop */

  async function cropToDataUrl(shot, rectCss) {
    const img = await loadImage(shot);

    // Deriving the scale from the image itself rather than devicePixelRatio
    // keeps this correct under browser zoom and on mixed-DPI multi-monitor
    // setups, where dPR alone lies.
    const scale = img.naturalWidth / window.innerWidth;

    const sx = Math.max(0, Math.round(rectCss.x * scale));
    const sy = Math.max(0, Math.round(rectCss.y * scale));
    const sw = Math.max(1, Math.min(Math.round(rectCss.w * scale), img.naturalWidth - sx));
    const sh = Math.max(1, Math.min(Math.round(rectCss.h * scale), img.naturalHeight - sy));

    const canvas = document.createElement('canvas');
    canvas.width = sw;
    canvas.height = sh;
    canvas.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    return canvas.toDataURL('image/png');
  }

  async function copyToClipboard(dataUrl) {
    try {
      const blob = await (await fetch(dataUrl)).blob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      return true;
    } catch {
      // Needs document focus and a live user gesture; not worth failing over.
      return false;
    }
  }

  /* ------------------------------------------------------------- overlay */

  function showRegionOverlay(shot) {
    return new Promise((resolve) => {
      const root = el('div', null, document.documentElement);
      root.id = ID.overlay;

      const frozen = el('img', 'cl-shot', root);
      frozen.src = shot;
      frozen.draggable = false;

      const dim = el('div', 'cl-dim', root);
      const sel = el('div', 'cl-sel', root);
      const size = el('div', 'cl-size', root);
      const hint = el('div', 'cl-hint', root);
      hint.textContent = 'Drag to select  ·  Enter for the whole page  ·  Esc to cancel';

      let start = null;
      let rect = null;

      const paint = () => {
        if (!rect) return;
        sel.style.display = 'block';
        dim.style.display = 'none';
        sel.style.left = `${rect.x}px`;
        sel.style.top = `${rect.y}px`;
        sel.style.width = `${rect.w}px`;
        sel.style.height = `${rect.h}px`;
        size.style.display = 'block';
        size.textContent = `${Math.round(rect.w)} x ${Math.round(rect.h)}`;
        size.style.left = `${rect.x}px`;
        size.style.top = `${Math.max(0, rect.y - 26)}px`;
      };

      const finish = (value) => {
        close();
        resolve(value);
      };

      const onDown = (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        start = { x: e.clientX, y: e.clientY };
        rect = { x: start.x, y: start.y, w: 0, h: 0 };
        hint.style.display = 'none';
      };

      const onMove = (e) => {
        if (!start) return;
        e.preventDefault();
        rect = {
          x: Math.min(start.x, e.clientX),
          y: Math.min(start.y, e.clientY),
          w: Math.abs(e.clientX - start.x),
          h: Math.abs(e.clientY - start.y),
        };
        paint();
      };

      const onUp = (e) => {
        if (!start) return;
        e.preventDefault();
        const done = rect;
        start = null;
        // A stray click is not a selection.
        if (!done || done.w < 8 || done.h < 8) {
          rect = null;
          sel.style.display = 'none';
          size.style.display = 'none';
          dim.style.display = 'block';
          hint.style.display = 'block';
          return;
        }
        finish(done);
      };

      const onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); finish(null); }
        else if (e.key === 'Enter') {
          e.preventDefault();
          finish({ x: 0, y: 0, w: window.innerWidth, h: window.innerHeight });
        }
      };

      function close() {
        root.removeEventListener('pointerdown', onDown);
        window.removeEventListener('pointermove', onMove, true);
        window.removeEventListener('pointerup', onUp, true);
        window.removeEventListener('keydown', onKey, true);
        root.remove();
        if (teardown === close) teardown = null;
      }

      root.addEventListener('pointerdown', onDown);
      window.addEventListener('pointermove', onMove, true);
      window.addEventListener('pointerup', onUp, true);
      window.addEventListener('keydown', onKey, true);
      teardown = close;
    });
  }

  /* --------------------------------------------------------------- toast */

  /**
   * The toast is the commit step, not an after-the-fact correction.
   *
   * chrome.downloads has no rename API, so "save now, fix the name later" is
   * not implementable. Holding the write for a few seconds costs nothing (the
   * image is already on the clipboard) and makes a wrong name free to fix.
   */
  function showToast(proposal, settings) {
    return new Promise((resolve) => {
      const seconds = Math.max(1, Number(settings.toastSeconds) || 4);

      const root = el('div', null, document.documentElement);
      root.id = ID.toast;

      const row = el('div', 'cl-row', root);
      const dot = el('span', 'cl-dot', row);
      dot.dataset.confidence = proposal.confidence;
      dot.title = `${proposal.confidence} confidence — ${proposal.reason}`;

      const nameEl = el('span', 'cl-name', row);
      nameEl.textContent = proposal.base;
      nameEl.title = 'Click to rename';
      el('span', 'cl-ext', row).textContent = '.png';

      const meta = el('div', 'cl-meta', root);
      meta.textContent = `${proposal.folder || 'Downloads'}  ·  ${proposal.reason}`;

      const actions = el('div', 'cl-actions', root);
      const saveBtn = el('button', 'cl-btn cl-primary', actions);
      saveBtn.textContent = 'Save';
      const renameBtn = el('button', 'cl-btn', actions);
      renameBtn.textContent = 'Rename';
      const discardBtn = el('button', 'cl-btn', actions);
      discardBtn.textContent = 'Discard';

      const bar = el('div', 'cl-progress', root);
      const fill = el('i', null, bar);
      fill.style.animationDuration = `${seconds}s`;

      let current = proposal.base;
      let timer = null;
      let input = null;

      const settle = (value) => { close(); resolve(value); };
      const commit = () => settle(input ? input.value.trim() || current : current);

      const startTimer = () => {
        timer = setTimeout(commit, seconds * 1000);
      };
      const stopTimer = () => {
        if (timer) clearTimeout(timer);
        timer = null;
        fill.style.animation = 'none';
        bar.classList.add('cl-paused');
      };

      const beginEdit = () => {
        if (input) { input.focus(); return; }
        stopTimer();
        input = el('input', 'cl-input');
        input.type = 'text';
        input.value = current;
        input.spellcheck = false;
        row.replaceChild(input, nameEl);
        input.focus();
        input.select();
        input.addEventListener('keydown', (e) => {
          e.stopPropagation();
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          else if (e.key === 'Escape') { e.preventDefault(); settle(null); }
        });
      };

      const onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); settle(null); }
      };

      function close() {
        stopTimer();
        window.removeEventListener('keydown', onKey, true);
        root.remove();
        if (teardown === close) teardown = null;
      }

      nameEl.addEventListener('click', beginEdit);
      renameBtn.addEventListener('click', beginEdit);
      saveBtn.addEventListener('click', commit);
      discardBtn.addEventListener('click', () => settle(null));
      // Hovering means the user is reading it; do not yank the file out from
      // under them mid-decision.
      root.addEventListener('pointerenter', stopTimer);
      window.addEventListener('keydown', onKey, true);

      teardown = close;
      startTimer();
    });
  }

  function flash(message, isError = true) {
    const node = el('div', null, document.documentElement);
    node.id = ID.toast;
    node.classList.add(isError ? 'cl-error' : 'cl-ok');
    node.textContent = message;
    setTimeout(() => node.remove(), 4000);
  }

  /* ------------------------------------------------------------ the flow */

  async function begin({ mode, shot, settings }) {
    if (teardown) teardown();
    session = { shot, settings, mode };

    let rect;
    if (mode === 'viewport') {
      rect = { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
    } else {
      rect = await showRegionOverlay(shot);
      if (!rect) return; // cancelled
    }

    let png;
    try {
      png = await cropToDataUrl(shot, rect);
    } catch (err) {
      flash(`Cutline could not crop the capture: ${err.message}`);
      return;
    }

    if (settings.copyToClipboard) copyToClipboard(png);

    const ctx = gatherContext();
    const res = await chrome.runtime.sendMessage({ k: 'cutline:propose', ctx });
    if (!res || !res.ok) {
      flash(`Cutline could not build a name: ${(res && res.error) || 'unknown error'}`);
      return;
    }
    const proposal = res.proposal;

    let base = proposal.base;
    if (settings.showToast) {
      base = await showToast(proposal, settings);
      if (base == null) return; // discarded
    }

    const saved = await chrome.runtime.sendMessage({
      k: 'cutline:save', png, base, folder: proposal.folder,
    });
    if (!saved || !saved.ok) {
      flash(`Save failed: ${(saved && saved.error) || 'unknown error'}`);
    }
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.k === 'cutline:begin') {
      begin(msg).catch((err) => flash(`Cutline error: ${err.message}`));
      sendResponse({ ok: true });
    }
    return undefined;
  });
})();
