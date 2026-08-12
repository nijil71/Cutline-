// Content script: the half of a capture that needs a DOM.
//
// Injected on demand by the service worker (classic script, not a module).
// Responsibilities: draw the region overlay over a frozen screenshot, run the
// scroll-and-stitch full-page capture, read page context, and show the
// confirm-and-rename toast.

(() => {
  if (window.__cutlineLoaded) return;
  window.__cutlineLoaded = true;

  const ID = { overlay: 'cl-overlay', toast: 'cl-toast' };

  // Time to let a page repaint (and lazy images decode) after a programmatic
  // scroll, before asking for the next frame.
  const SETTLE_MS = 300;

  // Device-pixel ceiling on a stitched full-page image. Chrome's hard canvas
  // limits are far higher, but the resulting PNG has to survive a base64 trip
  // through the message channel, and multi-hundred-megabyte strings do not.
  const MAX_STITCH_PX = 20000;

  // Backstop against pages that grow while being scrolled (infinite feeds).
  const MAX_SEGMENTS = 60;

  let teardown = null; // cancels whatever UI is currently up

  /* ------------------------------------------------------------- utilities */

  const text = (el) => (el && el.textContent ? el.textContent.trim() : '');

  const doc = () => document.documentElement;

  /** Viewport width excluding the classic scrollbar gutter. */
  const contentWidth = () =>
    Math.min(window.innerWidth, doc().clientWidth || window.innerWidth);

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

  const settle = () =>
    new Promise((resolve) => {
      requestAnimationFrame(() => setTimeout(resolve, SETTLE_MS));
    });

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
      test: (h) => /(^|\.)gitlab\./i.test(h),
      run() {
        const m = location.pathname.match(/\/-\/(issues|merge_requests)\/(\d+)/);
        if (!m) return { scope: 'gitlab' };
        return {
          scope: 'gitlab',
          trustedTicket: true,
          ticket: `${m[1] === 'merge_requests' ? 'MR' : 'ISSUE'}-${m[2]}`,
          subject: text(document.querySelector('h1.title, .issue-details h1')) || undefined,
        };
      },
    },
    {
      test: (h) => /\.zendesk\.com$/i.test(h),
      run() {
        const m = location.pathname.match(/\/tickets\/(\d+)/);
        return {
          scope: 'zendesk',
          trustedTicket: true,
          ticket: m ? `TICKET-${m[1]}` : null,
          subject: text(document.querySelector('[data-test-id="ticket-subject"], h1')) || undefined,
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
    {
      test: (h) => h === 'stackoverflow.com' || /\.stackexchange\.com$/i.test(h),
      run: () => ({
        scope: 'stackoverflow',
        subject: text(document.querySelector('#question-header h1, h1.fs-headline1')) || undefined,
      }),
    },
    {
      test: (h) => h === 'docs.google.com',
      run: () => ({
        scope: 'gdocs',
        subject: text(document.querySelector('.docs-title-input-label-inner')) || undefined,
      }),
    },
    {
      test: (h) => /\.notion\.(so|site)$/i.test(h),
      run: () => ({
        scope: 'notion',
        subject: text(document.querySelector('.notion-page-block [contenteditable], h1')) || undefined,
      }),
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
      // Used only for exception and issue-key detection, and only in-process.
      return ((document.body && document.body.innerText) || '').slice(0, 20000);
    } catch {
      return '';
    }
  }

  function gatherContext() {
    const adapter = runAdapter();
    // innerText forces a full layout pass, which is measurable on heavy pages.
    // When an adapter already produced an issue key, nothing downstream reads
    // the body text, so skip it entirely.
    const needsText = !(adapter && adapter.ticket);

    return {
      url: location.href,
      title: document.title,
      selection: String(window.getSelection() || '').trim().slice(0, 500),
      meta: metaTags(),
      jsonld: jsonLdNodes(),
      adapter,
      text: needsText ? bodyTextSample() : '',
    };
  }

  /* ------------------------------------------------------------------ crop */

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

  /* ------------------------------------------------------- full page stitch */

  /**
   * Tag every fixed/sticky element so it can be hidden on later segments.
   *
   * `visibility: hidden` rather than `position: static`: hiding preserves
   * layout, and any layout shift mid-capture would misalign every subsequent
   * segment of the stitch.
   */
  function tagStickyElements() {
    const tagged = [];
    if (!document.body) return tagged;
    const all = document.body.getElementsByTagName('*');
    const limit = Math.min(all.length, 8000);
    for (let i = 0; i < limit; i++) {
      const node = all[i];
      let position;
      try {
        position = getComputedStyle(node).position;
      } catch {
        continue;
      }
      if (position === 'fixed' || position === 'sticky') {
        node.setAttribute('data-cl-fixed', '');
        tagged.push(node);
      }
    }
    return tagged;
  }

  async function grabVisible() {
    const res = await chrome.runtime.sendMessage({ k: 'cutline:grab' });
    if (!res || !res.ok) throw new Error((res && res.error) || 'capture refused');
    return res.shot;
  }

  const reportProgress = (done, total) => {
    chrome.runtime.sendMessage({ k: 'cutline:progress', done, total }).catch(() => {});
  };

  async function captureFullPage() {
    const root = doc();
    const viewportH = window.innerHeight;
    const startX = window.scrollX;
    const startY = window.scrollY;

    const totalH = Math.max(
      root.scrollHeight,
      document.body ? document.body.scrollHeight : 0,
      viewportH,
    );

    const sticky = tagStickyElements();
    root.classList.add('cl-capturing');

    try {
      window.scrollTo(0, 0);
      await settle();

      let img = await loadImage(await grabVisible());
      const scale = img.naturalWidth / window.innerWidth;
      const width = Math.max(1, Math.round(contentWidth() * scale));

      const wanted = Math.round(totalH * scale);
      const height = Math.min(wanted, MAX_STITCH_PX);
      const truncated = height < wanted;

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx2d = canvas.getContext('2d');

      const total = Math.min(Math.ceil(totalH / viewportH), MAX_SEGMENTS);

      for (let i = 0; i < MAX_SEGMENTS; i++) {
        if (i > 0) {
          window.scrollTo(0, i * viewportH);
          await settle();
          // Only from the second frame on: a sticky header should appear once,
          // at the top, not repeated every viewport down the image.
          root.classList.add('cl-hide-fixed');
          img = await loadImage(await grabVisible());
        }

        // Read the *actual* offset — the final scroll clamps short, and using
        // the requested value instead would duplicate a slice of the page.
        const offsetY = Math.round(window.scrollY * scale);
        const drawH = Math.min(img.naturalHeight, height - offsetY);
        if (drawH > 0) {
          ctx2d.drawImage(img, 0, 0, width, drawH, 0, offsetY, width, drawH);
        }

        reportProgress(i + 1, total);

        const atBottom = window.scrollY + viewportH >= totalH - 1;
        if (atBottom || offsetY + img.naturalHeight >= height) break;
      }

      return { png: canvas.toDataURL('image/png'), truncated };
    } finally {
      root.classList.remove('cl-capturing', 'cl-hide-fixed');
      for (const node of sticky) node.removeAttribute('data-cl-fixed');
      window.scrollTo(startX, startY);
      reportProgress(0, 0);
    }
  }

  /* ------------------------------------------------------------- clipboard */

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

  /* --------------------------------------------------------------- overlay */

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

      // The frozen image would not move with the page, so scrolling underneath
      // it is purely disorienting. Block it for as long as the overlay is up.
      const blockScroll = (e) => e.preventDefault();
      const SCROLL_KEYS = new Set([
        'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
        'PageUp', 'PageDown', 'Home', 'End', ' ',
      ]);

      const onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); finish(null); return; }
        if (e.key === 'Enter') {
          e.preventDefault();
          finish({ x: 0, y: 0, w: contentWidth(), h: window.innerHeight });
          return;
        }
        if (SCROLL_KEYS.has(e.key)) e.preventDefault();
      };

      function close() {
        root.removeEventListener('pointerdown', onDown);
        window.removeEventListener('pointermove', onMove, true);
        window.removeEventListener('pointerup', onUp, true);
        window.removeEventListener('keydown', onKey, true);
        window.removeEventListener('wheel', blockScroll, true);
        window.removeEventListener('touchmove', blockScroll, true);
        root.remove();
        if (teardown === close) teardown = null;
      }

      root.addEventListener('pointerdown', onDown);
      window.addEventListener('pointermove', onMove, true);
      window.addEventListener('pointerup', onUp, true);
      window.addEventListener('keydown', onKey, true);
      window.addEventListener('wheel', blockScroll, { passive: false, capture: true });
      window.addEventListener('touchmove', blockScroll, { passive: false, capture: true });
      teardown = close;
    });
  }

  /* ----------------------------------------------------------------- toast */

  /**
   * The toast is the commit step, not an after-the-fact correction.
   *
   * chrome.downloads has no rename API, so "save now, fix the name later" is
   * not implementable. Holding the write for a few seconds costs nothing (the
   * image is already on the clipboard) and makes a wrong name free to fix.
   */
  function showToast(proposal, settings, note) {
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
      meta.textContent = [proposal.folder || 'Downloads', proposal.reason, note]
        .filter(Boolean).join('  ·  ');

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
      let input = null;
      let timer = null;
      let remaining = seconds * 1000;
      let startedAt = 0;

      const settleWith = (value) => { close(); resolve(value); };
      const commit = () => settleWith(input ? (input.value.trim() || current) : current);

      const startTimer = () => {
        if (timer || remaining <= 0) return;
        startedAt = Date.now();
        timer = setTimeout(commit, remaining);
        fill.style.animationPlayState = 'running';
      };

      // Pause keeps the remaining time so leaving the toast resumes where it
      // stopped. An earlier version cleared the timer outright, which meant a
      // stray mouseover silently cancelled the save forever.
      const pauseTimer = () => {
        if (!timer) return;
        clearTimeout(timer);
        timer = null;
        remaining = Math.max(0, remaining - (Date.now() - startedAt));
        fill.style.animationPlayState = 'paused';
      };

      const cancelTimer = () => {
        pauseTimer();
        remaining = 0; // editing means the user is in charge now
      };

      const beginEdit = () => {
        if (input) { input.focus(); return; }
        cancelTimer();
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
          else if (e.key === 'Escape') { e.preventDefault(); settleWith(null); }
        });
      };

      const onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); settleWith(null); }
      };

      function close() {
        if (timer) clearTimeout(timer);
        timer = null;
        window.removeEventListener('keydown', onKey, true);
        root.remove();
        if (teardown === close) teardown = null;
      }

      nameEl.addEventListener('click', beginEdit);
      renameBtn.addEventListener('click', beginEdit);
      saveBtn.addEventListener('click', commit);
      discardBtn.addEventListener('click', () => settleWith(null));
      root.addEventListener('pointerenter', pauseTimer);
      root.addEventListener('pointerleave', () => { if (!input) startTimer(); });
      window.addEventListener('keydown', onKey, true);

      teardown = close;
      startTimer();
    });
  }

  function flash(message, isError = true) {
    const existing = document.getElementById(ID.toast);
    if (existing) existing.remove();
    const node = el('div', null, document.documentElement);
    node.id = ID.toast;
    node.classList.add(isError ? 'cl-error' : 'cl-ok');
    node.textContent = message;
    setTimeout(() => node.remove(), 4500);
  }

  /* -------------------------------------------------------------- the flow */

  async function produceImage(mode, shot) {
    if (mode === 'fullpage') return captureFullPage();

    const rect = mode === 'viewport'
      ? { x: 0, y: 0, w: contentWidth(), h: window.innerHeight }
      : await showRegionOverlay(shot);

    if (!rect) return null; // cancelled
    return { png: await cropToDataUrl(shot, rect), truncated: false };
  }

  async function begin({ mode, shot, settings }) {
    if (teardown) teardown();

    let result;
    try {
      result = await produceImage(mode, shot);
    } catch (err) {
      flash(`Cutline could not capture this page: ${err.message}`);
      return;
    }
    if (!result) return;

    const { png, truncated } = result;
    if (settings.copyToClipboard) copyToClipboard(png);

    const res = await chrome.runtime.sendMessage({ k: 'cutline:propose', ctx: gatherContext() });
    if (!res || !res.ok) {
      flash(`Cutline could not build a name: ${(res && res.error) || 'unknown error'}`);
      return;
    }
    const proposal = res.proposal;
    const note = truncated ? 'page too tall — image was cut short' : '';

    let base = proposal.base;
    if (settings.showToast) {
      base = await showToast(proposal, settings, note);
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
