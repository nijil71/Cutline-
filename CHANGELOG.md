# Changelog

All notable changes to Cutline are documented here.
This project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-08-12

First public release.

### Capture

- **Region capture** over a frozen screenshot, so the overlay never appears in
  the image and the page cannot shift under the selection.
- **Visible page capture**, with the scrollbar gutter cropped off.
- **Full scrolling page capture** — scroll, grab, stitch. Fixed and sticky
  elements are hidden from the second segment onward so headers appear once
  rather than repeating down the image. Progress shows on the toolbar badge.
- Crop scale is derived from the captured image rather than `devicePixelRatio`,
  which keeps it correct under browser zoom and on mixed-DPI multi-monitor
  setups.
- Captures are paced against Chrome's `captureVisibleTab` rate limit, with one
  retry, and abort if the tab stops being visible mid-stitch.

### Naming

- Signals, in priority order: issue key, exception, HTTP status, product price,
  page title, then a timestamp fallback.
- Site adapters for Jira, Linear, GitHub, GitLab, Zendesk, Amazon,
  Stack Overflow, Google Docs and Notion.
- `schema.org/Product` structured data is read directly for product name and
  price, so neither is inferred.
- Title cleaning strips unread counters, browser suffixes, Edge's stacked
  profile names, and SEO filler.

### Failing safe

- Issue keys found in body text must also appear in the page title; a denylist
  rejects lookalikes such as `UTF-8`, `RTX-4060` and `RFC-2616`.
- Exception names in page text require nearby stack-trace or failure wording,
  so a documentation page about `TypeError` is not named after it.
- Prices are only used on pages that declare themselves commerce, and a zero
  price is discarded.
- Low-confidence results fall back to `scope-timestamp` rather than emitting a
  plausible-looking but meaningless name.

### Privacy

- No host permissions. `activeTab` means a page is readable only in the moment
  you invoke a capture on it.
- No network requests of any kind.
- Banking hosts, password managers, and `/login`, `/checkout` and `/password`
  paths save as a bare timestamp. Incognito windows are always redacted.

### Saving

- Files land in `Downloads/<base>/<date>/`, with date folders on by default.
- Optional host-to-folder rules, matched on hostname only — never on a guess
  about what a screenshot means.
- The rename prompt is the commit step, not a correction afterwards, because
  `chrome.downloads` has no rename API. Hovering pauses the countdown.
- Hand-edited names are sanitised before they reach the download API.
