# Cutline

*A cutline is the caption printed beneath a photograph — the words that say what
the picture is.*

A Chrome/Edge extension that names screenshots from what is actually on the page.

```
Screenshot 2026-08-12 01-04-51.png     ->  amazon-lenovo-legion-5i-gen-9-79999.png
                                       ->  jira-Q-413488-payment-gateway-timeout.png
                                       ->  mendix-bouncycastle-invalid-cipher-text-error.png
```

---

## Install

Not on any store yet — load it unpacked.

1. Open `chrome://extensions` (or `edge://extensions`)
2. Turn on **Developer mode**
3. **Load unpacked** → select this folder
4. The options page opens on first install

| Shortcut | Action |
|---|---|
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> | Capture a region |
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>E</kbd> | Capture the whole visible page |
| Toolbar icon | Capture a region |

Change them at `chrome://extensions/shortcuts`.

### Brave: rebind the shortcut

**Brave owns `Ctrl+Shift+S`** for its own built-in screenshot tool. Browser-level
shortcuts are consumed before extension commands ever see them, so on Brave the
default binding silently does nothing — you get Brave's "Screenshot copied to
clipboard" dialog instead of Cutline's toast.

Open `brave://extensions/shortcuts` and rebind **Capture a region** to something
Brave does not reserve — `Alt+Shift+S` works well. The toolbar icon always
triggers a region capture regardless of shortcut state, so use it to confirm the
extension itself is healthy.

The same class of collision exists elsewhere: `Ctrl+Shift+A` is tab search,
`Ctrl+Shift+N`/`T`/`O`/`B`/`J` are all taken by Chrome itself.

---

## How a name gets built

The engine reads the DOM, not pixels. A screen-OCR tool has to find `₹79,999`
somewhere in an image and hope it is the product price rather than an EMI
figure or a struck-through MRP. An extension asks the page, which declares its
own answer in `schema.org` markup.

Signals, in the order they win:

| Signal | Source | Example output |
|---|---|---|
| Issue key | URL / DOM on Jira, Linear, GitHub | `jira-Q-413488-payment-gateway-timeout` |
| Exception | Selected text, then page text | `mendix-bouncycastle-invalid-cipher-text-error` |
| HTTP status | Selected text or title | `acme-checkout-500-error` |
| Price | `schema.org/Product`, site adapter | `amazon-lenovo-legion-5i-gen-9-79999` |
| Page title | `<title>`, cleaned | `mendix-getting-started-with-widgets` |
| Nothing usable | — | `example-2026-08-12-010451` |

**Failing safe matters more than being clever.** A confidently wrong name is
worse than a timestamp, because it looks meaningful and isn't. So:

- Untrusted issue-key matches must also appear in the page title, and a
  denylist rejects `UTF-8`, `RTX-4060`, `RFC-2616`.
- A price is only used when the page actually claims to sell something. A blog
  post mentioning `$12,000` does not become `-12000`.
- One-token or low-confidence results fall back to `scope-timestamp` rather
  than emitting `login.png` for the fortieth time.

### Title cleaning

Browser titles are written for a tab strip, not a filename. Stripped:
unread counters (`(3) `), browser suffixes (`— Google Chrome`), Edge's
`and 4 more pages - Personal - Microsoft Edge` stack (including the zero-width
space inside Edge's own name), and SEO filler (`Buy … Online at Low Prices in
India`).

Segment choice takes the **first** meaningful segment, not the longest —
`Getting started | Mendix Documentation` should yield "Getting started", and
longest-segment logic gets that backwards.

---

## Privacy

- **No host permissions.** The manifest requests `activeTab`, so the extension
  can only read a page in the moment you press the shortcut on it. It cannot
  read anything in the background, on other tabs, or when you are not looking.
- **Nothing leaves your machine.** No network calls, no telemetry, no model.
  Page text is read in-process to find exception names, and is discarded.
- **The filename itself leaks.** `amex-statement-balance-42000.png` in a
  screenshare is an exposure a plain timestamp never was. Banking hosts,
  password managers, and `/login`, `/checkout`, `/password` paths save as a
  bare timestamp by default. **Incognito windows are always redacted.** Edit
  the list in the options page.

---

## Where files go

Extensions may only write inside the browser's Downloads folder, so paths are
relative to it. Default: `Downloads/Screenshots/2026-08/`.

Date folders are on by default because they are derived from a fact and can
never be miscategorised. Semantic folders (`Work/`, `Shopping/`) are
deliberately **not** guessed — a misfiled screenshot is harder to find than a
well-named one in a flat folder. Instead the options page takes explicit
host rules you can read and correct:

```
*.atlassian.net => Work
*.amazon.*      => Shopping
```

---

## The rename prompt

After a capture, a toast shows the proposed name with a short countdown, then
writes the file.

It is the **commit** step, not a correction afterwards. `chrome.downloads` has
no rename API, so "save immediately, fix the name later" is not implementable —
the only options are holding the write briefly or leaving you with a wrong
name. Holding it costs nothing, because the image is already on your clipboard.
Hovering the toast pauses the countdown.

---

## Development

```bash
npm test          # 31 unit tests over the naming engine
```

The naming engine (`src/naming/`) is pure JavaScript with no `chrome.*` and no
DOM, which is what makes it testable. Everything browser-shaped lives in
`background.js` (privileged: capture, download) and `content/capture.js`
(DOM: overlay, crop, page context).

```
src/
  background.js          service worker — capture, name, download
  config/                defaults + chrome.storage wrapper
  content/
    capture.js           overlay, crop, site adapters, toast
    overlay.css          defensively scoped page-injected styles
  naming/
    name-engine.js       composition + scope + privacy + folders
    title-clean.js       <title> -> subject words
    extractors.js        ticket / price / exception / HTTP status
    slug.js              filename safety
    text-utils.js        invisible + control character handling
```

### Adding a site adapter

Adapters are how the extension beats generic heuristics. Add to `ADAPTERS` in
`src/content/capture.js`:

```js
{
  test: (host) => host === 'example.com',
  run: () => ({
    scope: 'example',
    ticket: location.pathname.match(/\/t\/(\d+)/)?.[1],
    trustedTicket: true,          // skip title corroboration
    subject: document.querySelector('h1')?.textContent,
    price: null,
  }),
}
```

A throwing adapter is caught and ignored — it can never block a capture.

---

## Known limits

These are the real edges of the extension approach, not bugs:

1. **Browser tabs only.** Desktop apps, other windows, and the browser's own UI
   are out of reach. A native helper would be needed for those.
2. **The shortcut only fires while the browser has focus.** Chrome does not
   grant extensions true global hotkeys.
3. **Downloads folder only.** `Downloads/Screenshots/…` works; `D:\Screenshots`
   does not.
4. **Visible viewport only.** Full-page capture would need scroll-and-stitch.
5. Internal pages (`chrome://`, the Web Store) block all extensions; Cutline
   reports this instead of failing silently.
