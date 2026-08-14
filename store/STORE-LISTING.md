# Chrome Web Store submission pack

Everything the Developer Dashboard asks for, written out so it can be pasted
directly. Fields marked **FILL IN** need something only you can supply.

---

## 1. Store listing tab

**Item name**

```
Cutline — smart screenshot names
```

**Summary** (132 character limit — this is 104)

```
Screenshots named from the page they came from — the product, ticket, or error — instead of a timestamp.
```

**Category:** Productivity → Workflow & Planning
**Language:** English (United States)

**Detailed description**

```
Every screenshot you take is called Screenshot 2026-08-12 01-04-51.png. Three
weeks later you need the one with the error in it, and you are opening files at
random.

Cutline names the file from what is actually on the page.

    amazon-lenovo-legion-5i-gen-9-79999.png
    jira-Q-413488-payment-gateway-timeout.png
    mendix-bouncycastle-invalid-cipher-text-error.png

The filename is the only piece of context that survives contact with the real
world. It still works after the file is dragged into Slack, attached to a
ticket, or emailed — no app, no database, no index required.

CAPTURE
• Region — drag over a frozen copy of the page, so nothing shifts under you
• Visible page — one keystroke
• Full scrolling page — captured in segments and stitched, with sticky headers
  hidden so they appear once instead of repeating down the image

Reach any of them from the keyboard, the toolbar icon, or a right-click.

HOW THE NAME IS BUILT
Cutline reads the page, not the pixels. A tool that inspects an image has to
find a price somewhere in it and hope it is the product rather than an instalment
figure or a struck-through original. Cutline reads what the site itself declares.

• Issue keys from Jira, Linear, GitHub, GitLab and Zendesk
• Exception names from your selection or a stack trace
• Product name and price from schema.org markup
• A cleaned page title, with unread counters, browser suffixes and marketing
  filler stripped out

IT WOULD RATHER SAY NOTHING THAN GUESS
A confidently wrong filename is worse than a timestamp, because it looks
meaningful and is not. So an issue key found in body text must also appear in
the page title. A denylist rejects lookalikes such as UTF-8 and RTX-4060. An
exception name needs nearby stack-trace wording, so a documentation page about
TypeError is not named after it. A price is only used on a page that declares
itself commerce. When nothing reliable is found, you get a timestamp and an
honest one.

BEFORE IT SAVES
A prompt shows the proposed name with a short countdown, then writes the file.
Click it to edit, hover to pause, or discard. The image is already on your
clipboard, so the wait costs you nothing.

PRIVACY
Cutline requests no host permissions. It cannot read pages in the background,
cannot read other tabs, and never shows the "read your data on all websites"
warning. It makes no network requests at all — no analytics, no accounts, no
remote code, nothing to sign up for.

Because filenames themselves can reveal things, banking sites, password
managers, and any address containing /login, /checkout or /password are saved
as a plain timestamp by default. Incognito windows always are. The list is
yours to edit.

WHERE FILES GO
Downloads/Screenshots/2026-08/ by default. Date folders can be turned off, and
you can add your own rules matching a hostname to a folder. Cutline will not
guess a category for you — a misfiled screenshot is harder to find than a
well-named one in a flat folder.

Open source under the MIT License.
```

---

## 2. Privacy practices tab

**Single purpose description**

```
Cutline captures a screenshot of the current browser tab and generates a
descriptive filename for it from that page's own content — its title, address,
structured product data, or a selected error message — instead of a timestamp.
Capturing an image and naming the resulting file is a single, narrow function.
```

**Permission justifications** — paste each into its own field.

| Permission | Justification |
|---|---|
| `activeTab` | Cutline must photograph the current tab and read its title, address and visible content in order to generate a descriptive filename. activeTab is used specifically so that this access exists only at the moment the user invokes a capture, and never in the background. |
| `scripting` | Cutline injects the region-selection overlay and the confirm-and-rename prompt into the current page, and runs the scroll-and-stitch routine used for full-page capture. These require running a script in the page. |
| `downloads` | Cutline saves the finished PNG into the user's Downloads folder, under a sub-folder and filename the user configures. |
| `storage` | Cutline stores the user's own settings: base folder, date-folder format, filename length limits, the list of sensitive sites to exclude, and any host-to-folder rules. |
| `clipboardWrite` | Cutline places the captured image on the clipboard immediately after capture, so it can be pasted straight into another application. |
| `notifications` | Cutline notifies the user when a capture cannot proceed — for example on a browser internal page where extensions are blocked, or when the browser's screenshot rate limit is hit. Without this the failure would be silent. |
| `contextMenus` | Cutline adds a right-click menu offering its three capture modes. Full-page capture would otherwise be reachable only by keyboard shortcut, leaving it inaccessible to any user whose shortcut is already claimed by another application. |

**Host permissions:** none requested.

**Remote code:** No. All code is contained in the package. No `eval`, no
external scripts, no remotely hosted modules.

**Data usage — declare all of the following as NOT collected:**

Personally identifiable information · Health information · Financial and
payment information · Authentication information · Personal communications ·
Location · Web history · User activity · Website content

> Cutline reads page content transiently, in memory, to construct a filename,
> and discards it. Nothing is collected, stored, transmitted, sold, or
> transferred. Tick all three certification boxes.

**Privacy policy URL:** **FILL IN** — host `store/privacy.html` and paste the URL.

---

## 3. Assets

| Asset | Size | File |
|---|---|---|
| Store icon | 128×128 | `icons/icon128.png` |
| Screenshot 1 | 1280×800 | `store/screenshots/01-the-point.png` |
| Screenshot 2 | 1280×800 | `store/screenshots/02-in-context.png` |
| Screenshot 3 | 1280×800 | `store/screenshots/03-signals.png` |
| Screenshot 4 | 1280×800 | `store/screenshots/04-privacy.png` |
| Small promo tile | 440×280 | `store/promo/tile-440x280.png` |

The supplied screenshots are faithful reproductions built from the extension's
real stylesheet. **Replacing them with genuine captures once you have run the
extension is worth doing** — real screenshots convert better and remove any
question about accuracy.

---

## 4. Before you submit

- [ ] Replace the copyright holder in `LICENSE`
- [ ] Replace the contact email in `store/privacy.html`
- [ ] Host `privacy.html` and put the URL in the dashboard
- [ ] Register/verify your developer account (one-time US$5 fee)
- [ ] Run `npm run package` and upload `dist/cutline-1.0.0.zip`
- [ ] Confirm the uploaded zip contains no `test/`, `store/`, or `package.json`
- [ ] Load the zip unpacked one final time and take one real screenshot with it

## 5. Publishing an update to an already-listed item

Same dashboard item, not a new one. Go to the existing listing → **Package** →
**Upload new package**.

1. **The version must increase.** The store refuses a package whose version
   already exists. Check the version shown on the dashboard and make sure
   `manifest.json` is higher before running `npm run package`.
2. **Re-upload the privacy policy** if its content changed, at the same URL the
   listing points to. A changed policy at a stale URL is a review problem.
3. **Justify any new permission** on the Privacy practices tab. Adding one that
   triggers a user-facing warning (host permissions, `tabs`, `history`)
   **disables the extension for every existing user** until each of them
   re-accepts it. Permissions that show no warning — `contextMenus`,
   `storage`, `notifications`, `clipboardWrite`, `scripting`, `activeTab` —
   update silently.
4. **Refresh the listing text and screenshots** if the feature set moved. Both
   are edited on the item, independently of the package.
5. Submit for review. The listing stays live and users keep the old version
   until the new one is approved, so a rejection is not an outage.
6. Existing installs update themselves within a few hours of approval. There is
   no way to force it sooner.

**Check before every update:** if a release changed a `chrome.storage` key,
ship a migration in the same version. Users' data is not lost when a key
changes, but it becomes unreachable, which looks identical to them.

## 6. After you submit

Review usually takes a few days. The most common rejections for an extension
like this are a permission justification that does not name a concrete feature,
and a privacy policy URL that 404s — both are covered above, so check the URL
resolves publicly before submitting.

`activeTab`-only extensions generally clear review faster than ones requesting
host permissions. Keep it that way: if you later add a feature that seems to
need `<all_urls>`, look hard for an `activeTab` route first.
