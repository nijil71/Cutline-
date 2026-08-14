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

Not on the Web Store yet — load it unpacked.

1. Open `chrome://extensions` (or `edge://extensions`)
2. Turn on **Developer mode**
3. **Load unpacked** → select this folder
4. The options page opens on first install

| Trigger | Action |
|---|---|
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> · toolbar icon | Capture a region |
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>E</kbd> | Capture the visible page |
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd> | Capture the full scrolling page |
| **Right-click any page → Cutline** | All three modes |

Change the shortcuts at `chrome://extensions/shortcuts`.

Every mode is reachable from the right-click menu, so a shortcut that collides
with another application never puts a feature out of reach. Note that Chrome
only auto-assigns a suggested shortcut on **first install** — a command added
in a later update usually arrives unbound, and you set it yourself on the
shortcuts page.

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
| Issue key | URL / DOM on Jira, Linear, GitHub, GitLab, Zendesk | `jira-Q-413488-payment-gateway-timeout` |
| Exception | Selected text, then page text | `mendix-bouncycastle-invalid-cipher-text-error` |
| HTTP status | Selected text or title | `acme-checkout-500-error` |
| Price | `schema.org/Product`, site adapter | `amazon-lenovo-legion-5i-gen-9-79999` |
| Page title | `<title>`, cleaned | `mendix-getting-started-with-widgets` |
| Nothing usable | — | `example-2026-08-12-010451` |

**Failing safe matters more than being clever.** A confidently wrong name is
worse than a timestamp, because it looks meaningful and isn't. So:

- Untrusted issue-key matches must also appear in the page title, and a
  denylist rejects `UTF-8`, `RTX-4060`, `RFC-2616`.
- An exception name found in page text needs nearby stack-trace or failure
  wording. A documentation page *about* `TypeError` is not named after it.
  A name in your **selection** is trusted outright — selecting it is the signal.
- A price is only used when the page declares itself commerce, and a zero price
  is discarded.
- Low-confidence results fall back to `scope-timestamp` rather than emitting
  `login.png` for the fortieth time. A one-word title still counts if the word
  is substantive — `TypeError` identifies a page, `Home` does not.

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

## Capture modes

**Region** drags over a frozen copy of the page. The tab is photographed
*before* the overlay is drawn, so our own UI never lands in the image and the
page cannot shift under the selection. Scrolling is blocked while it is up.

**Visible page** takes the viewport, with the scrollbar gutter cropped off.

**Full scrolling page** scrolls, grabs, and stitches. Two details make the
difference between this working and looking broken:

- Fixed and sticky elements are tagged up front and hidden with
  `visibility: hidden` from the second segment onward, so a sticky header
  appears once at the top instead of repeating down the image. Hiding rather
  than repositioning is deliberate — any layout shift mid-capture would
  misalign every segment after it.
- Each segment is pasted at the browser's *actual* scroll offset rather than
  the requested one, because the final scroll clamps short and using the
  requested value would duplicate a slice of the page.

Chrome rate-limits tab captures to roughly two per second, so a long page takes
a few seconds; progress shows on the toolbar badge. If you switch tabs
mid-capture it aborts rather than splicing another tab into your screenshot.

Crop scale is derived from the captured image rather than `devicePixelRatio`,
which keeps it correct under browser zoom and on mixed-DPI multi-monitor setups
where dPR alone lies.

---

## Privacy

- **No host permissions.** The manifest requests `activeTab`, so the extension
  can only read a page in the moment you press the shortcut on it. It cannot
  read anything in the background, on other tabs, or when you are not looking.
  It never shows the "read your data on all websites" warning.
- **Nothing leaves your machine.** No network calls, no telemetry, no model.
  Page text is read in-process to find exception names, and is discarded.
- **The filename itself leaks.** `amex-statement-balance-42000.png` in a
  screenshare is an exposure a plain timestamp never was. Banking hosts,
  password managers, and `/login`, `/checkout`, `/password` paths save as a
  bare timestamp by default. **Incognito windows are always redacted.** Edit
  the list in the options page.

Full policy: [`store/privacy.html`](store/privacy.html).

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
Hovering pauses the countdown and moving away resumes it; clicking the name
stops it entirely and hands you an editable field.

---

## Development

```bash
npm test          # 35 unit tests over the naming engine
npm run package   # build dist/cutline-<version>.zip for the Web Store
npm run assets    # re-render the store screenshots from store/assets-src/
```

The naming engine (`src/naming/`) is pure JavaScript with no `chrome.*` and no
DOM, which is what makes it testable. Everything browser-shaped lives in
`background.js` (privileged: capture, download) and `content/capture.js`
(DOM: overlay, stitching, page context).

```
src/
  background.js          service worker — capture, throttling, naming, download
  config/                defaults + chrome.storage wrapper
  content/
    capture.js           overlay, stitcher, site adapters, toast
    overlay.css          defensively scoped page-injected styles
  naming/
    name-engine.js       composition + scope + privacy + folders
    title-clean.js       <title> -> subject words
    extractors.js        ticket / price / exception / HTTP status
    slug.js              filename safety
    text-utils.js        invisible + control character handling
options/                 settings page with live name preview
store/                   listing copy, privacy policy, screenshot sources
tools/package.ps1        validated submission build
test/                    naming engine tests
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

## Publishing

[`store/STORE-LISTING.md`](store/STORE-LISTING.md) holds the paste-ready listing
copy, the single-purpose statement, and a justification for every permission.
`npm run package` produces the upload, refusing to build if a development file
would ship, a referenced path is missing, a stray control byte crept into a
source file, or the description exceeds the store's 132-character limit.

---

## Known limits

These are the real edges of the extension approach, not bugs:

1. **Browser tabs only.** Desktop apps, other windows, and the browser's own UI
   are out of reach. A native helper would be needed for those.
2. **The shortcut only fires while the browser has focus.** Chrome does not
   grant extensions true global hotkeys.
3. **Downloads folder only.** `Downloads/Screenshots/…` works; `D:\Screenshots`
   does not.
4. **Very tall pages are cut short.** Full-page stitching stops at 20,000 device
   pixels, because the resulting PNG has to survive a base64 trip through the
   extension message channel. The toast says so when it happens.
5. Internal pages (`chrome://`, the Web Store) block all extensions; Cutline
   reports this instead of failing silently.

---

## License

MIT — see [LICENSE](LICENSE).
